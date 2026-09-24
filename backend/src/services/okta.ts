// Okta Management API + AI Agents (Secures AI / Workload Principals) API
// Auth mode is controlled by OKTA_AUTH_MODE:
//   'api_token'         (default) — static SSWS API token via OKTA_API_TOKEN
//   'client_credentials' — OAuth2 M2M via OKTA_M2M_CLIENT_ID/SECRET

import { randomUUID, generateKeyPairSync } from 'crypto';
import { importJWK, importPKCS8, SignJWT } from 'jose';
import { eventBus, nextId, labelForPath } from './eventBus';

const ORG = () => process.env.OKTA_ORG_URL!;
// The governance (IGA resource-owners) API lives on the admin hostname, not the org hostname.
const GOV_ORG = () => toAdminUrl(ORG());
const AUTH_MODE = () => process.env.OKTA_AUTH_MODE || 'api_token';
// okta.governance.resourceOwner.{read,manage}, okta.authorizationServers.read, and
// okta.clients.read (needed to read a native agent's real token_endpoint_auth_method from
// /oauth2/v1/clients/{id} — see getNativeAgentCredentials) must also be granted on the M2M
// app's API Scopes tab.
const M2M_SCOPES = 'okta.users.read okta.aiAgents.manage okta.apps.manage okta.governance.resourceOwner.read okta.governance.resourceOwner.manage okta.authorizationServers.read okta.clients.read';

function toAdminUrl(orgUrl: string): string {
  return orgUrl
    .replace(/\.okta\.com$/, '-admin.okta.com')
    .replace(/\.oktapreview\.com$/, '-admin.oktapreview.com');
}

let cachedToken: { value: string; expiresAt: number } | null = null;

// private_key_jwt client assertion — the org authorization server requires this
// for client_credentials instead of a plain client secret (RFC 7523 / 7521).
async function buildClientAssertion(clientId: string, tokenEndpoint: string): Promise<string> {
  const jwkJson = process.env.OKTA_M2M_PRIVATE_JWK;
  if (!jwkJson) {
    throw new Error('OKTA_AUTH_MODE=client_credentials requires OKTA_M2M_PRIVATE_JWK (the private JWK registered on the Okta app)');
  }
  const jwk = JSON.parse(jwkJson);
  const privateKey = await importJWK(jwk, 'RS256');

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience(tokenEndpoint)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

async function fetchM2MAccessToken(): Promise<string> {
  const clientId = process.env.OKTA_M2M_CLIENT_ID;
  if (!clientId) {
    throw new Error('OKTA_AUTH_MODE=client_credentials requires OKTA_M2M_CLIENT_ID');
  }

  const tokenEndpoint = `${ORG()}/oauth2/v1/token`;
  const clientAssertion = await buildClientAssertion(clientId, tokenEndpoint);

  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: M2M_SCOPES,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion,
    }),
  });

  if (!res.ok) {
    throw new Error(`M2M token request failed ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.value;
}

async function getAuthHeader(): Promise<string> {
  if (AUTH_MODE() === 'client_credentials') {
    if (cachedToken && cachedToken.expiresAt > Date.now()) return `Bearer ${cachedToken.value}`;
    return `Bearer ${await fetchM2MAccessToken()}`;
  }
  return `SSWS ${process.env.OKTA_API_TOKEN}`;
}

function maskSecrets(value: any): any {
  return JSON.parse(JSON.stringify(value, (k, v) =>
    ['client_secret', 'secret', 'password', 'token', 'Authorization'].includes(k)
      ? '***' : v
  ));
}

async function sswsFetch(path: string, init: RequestInit = {}, baseUrl: string = ORG()) {
  const method = (init.method || 'GET').toUpperCase();
  const startMs = Date.now();
  const eventId = nextId();

  // Parse request body for the event (mask sensitive fields)
  let requestBody: any;
  if (init.body && typeof init.body === 'string') {
    try {
      requestBody = maskSecrets(JSON.parse(init.body));
    } catch { requestBody = '[binary]'; }
  }

  // Emit request-start event
  eventBus.emit('okta:call', {
    id: eventId,
    ts: new Date().toISOString(),
    method,
    path,
    label: labelForPath(method, path),
    requestBody,
  });

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: await getAuthHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });

  // Capture response body for the event without consuming it for the caller
  let responseBody: any;
  if (res.status !== 204) {
    try {
      const text = await res.clone().text();
      if (text) {
        try {
          responseBody = maskSecrets(JSON.parse(text));
        } catch {
          responseBody = text;
        }
      }
    } catch { /* ignore — body unreadable (e.g. already consumed stream) */ }
  }

  // 202 Accepted responses often have no body — the Location header points to the async operation instead
  const location = res.headers.get('Location');
  if (location) {
    const base = responseBody && typeof responseBody === 'object' ? responseBody : {};
    responseBody = { ...base, Location: location };
  }

  // Emit completion with status + duration
  eventBus.emit('okta:response', {
    id: eventId,
    ts: new Date().toISOString(),
    method,
    path,
    label: labelForPath(method, path),
    requestBody,
    responseBody,
    status: res.status,
    durationMs: Date.now() - startMs,
  });

  return res;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export interface OktaUser {
  id: string; login: string; email: string;
  firstName: string; lastName: string; displayName: string; status: string;
}

export async function listUsers(query?: string, limit = 25): Promise<OktaUser[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set('q', query);
  const res = await sswsFetch(`/api/v1/users?${params}`);
  if (!res.ok) throw new Error(`listUsers ${res.status}: ${await res.text()}`);
  const users = await res.json() as any[];
  return users.map((u) => ({
    id: u.id, login: u.profile.login, email: u.profile.email,
    firstName: u.profile.firstName, lastName: u.profile.lastName,
    displayName: `${u.profile.firstName} ${u.profile.lastName}`.trim() || u.profile.login,
    status: u.status,
  }));
}

export async function getUser(userId: string): Promise<OktaUser> {
  const res = await sswsFetch(`/api/v1/users/${userId}`);
  if (!res.ok) throw new Error(`getUser ${res.status}`);
  const u = await res.json() as any;
  return {
    id: u.id, login: u.profile.login, email: u.profile.email,
    firstName: u.profile.firstName, lastName: u.profile.lastName,
    displayName: `${u.profile.firstName} ${u.profile.lastName}`.trim() || u.profile.login,
    status: u.status,
  };
}

// ── AI Agents (Secures AI / Workload Principals) ───────────────────────────────

export interface OktaAIAgent {
  id: string; platform: string; status: string; appId?: string;
  profile: { name: string; description?: string };
  created?: string; lastUpdated?: string; _links?: any;
  signOnProvider?: { appInstanceId?: string };
  resourceUrl?: string;
}

async function pollOperation(opUrl: string, maxAttempts = 15): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 1500));
    // opUrl is already a full URL (from the Location header) — pass it as the path with an empty base
    const res = await sswsFetch(opUrl, {}, '');
    if (!res.ok) throw new Error(`Operation poll failed: ${res.status}`);
    const op = await res.json() as any;
    if (op.status === 'COMPLETED') return op.resource?.id;
    if (op.status === 'FAILED') throw new Error(`Agent operation failed: ${JSON.stringify(op)}`);
  }
  throw new Error('Agent creation timed out');
}

export async function listAIAgents(limit = 50): Promise<OktaAIAgent[]> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents?limit=${limit}&orderBy=createdDate&sortOrder=desc`);
  if (!res.ok) throw new Error(`listAIAgents ${res.status}: ${await res.text()}`);
  const data = await res.json() as { data: OktaAIAgent[] };
  return data.data || [];
}

export async function createAIAgent(name: string, description?: string): Promise<OktaAIAgent> {
  const body: any = { profile: { name } };
  if (description) body.profile.description = description;

  const res = await sswsFetch('/workload-principals/api/v1/ai-agents', {
    method: 'POST', body: JSON.stringify(body),
  });

  if (res.status === 202) {
    const opUrl = res.headers.get('Location');
    if (!opUrl) throw new Error('No Location header in 202 response');
    const agentId = await pollOperation(opUrl);
    return getAIAgent(agentId);
  }
  if (!res.ok) {
    const err = await res.json() as any;
    const causes = err.errorCauses || [];
    if (causes.some((c: any) => c.errorSummary?.includes('already exists'))) {
      throw new Error(`An agent named "${name}" already exists in Okta. Please choose a different name.`);
    }
    throw new Error(err.errorSummary || `createAIAgent ${res.status}`);
  }
  return res.json() as Promise<OktaAIAgent>;
}

export async function getAIAgent(agentId: string): Promise<OktaAIAgent> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}`);
  if (!res.ok) throw new Error(`getAIAgent ${res.status}`);
  return res.json() as Promise<OktaAIAgent>;
}

export async function deleteAIAgent(agentId: string): Promise<void> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}`, { method: 'DELETE' });
  if (res.status !== 204 && !res.ok) console.warn(`deleteAIAgent returned ${res.status}`);
}

export async function activateAIAgent(agentId: string): Promise<any> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}/lifecycle/activate`, { method: 'POST' });
  if (res.status === 202) {
    // Async — poll for completion
    const opUrl = res.headers.get('Location');
    if (opUrl) {
      try { await pollOperation(opUrl, 20); } catch {}
    }
    // Re-fetch agent to get updated status + appId
    await new Promise(r => setTimeout(r, 2000));
    return getAIAgent(agentId);
  }
  if (!res.ok) {
    const err = await res.json() as any;
    throw new Error(err.errorSummary || `activateAgent ${res.status}`);
  }
  return res.json();
}

export async function deactivateAIAgent(agentId: string): Promise<void> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}/lifecycle/deactivate`, { method: 'POST' });
  if (!res.ok && res.status !== 202 && res.status !== 204) {
    const err = await res.json() as any;
    throw new Error(err.errorSummary || `deactivateAgent ${res.status}`);
  }
}

// ── User Access (human sign-in) / Machine Access (agent-to-agent delegation) ──

async function patchAIAgent(agentId: string, body: any): Promise<void> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}`, {
    method: 'PATCH', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/merge-patch+json' },
  });
  if (res.status === 202) {
    const opUrl = res.headers.get('Location');
    if (opUrl) await pollOperation(opUrl);
    return;
  }
  if (!res.ok) {
    const err = await res.json() as any;
    throw new Error(err.errorSummary || `patchAIAgent ${res.status}`);
  }
}

export async function enableUserAccess(agentId: string): Promise<void> {
  await patchAIAgent(agentId, { signOnProvider: { type: 'NEW_OIDC_APP' } });
}

export async function setAgentResourceUrl(agentId: string, resourceUrl: string): Promise<void> {
  await patchAIAgent(agentId, { resourceUrl });
}

// Okta creates the backing OIDC app INACTIVE — assigning a user to an inactive app fails with a
// misleading "AppInstance not found" 404. It must be activated first. Re-activating an already
// active app is a no-op on Okta's side.
export async function activateApp(appId: string): Promise<void> {
  const res = await sswsFetch(`/api/v1/apps/${appId}/lifecycle/activate`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json() as any;
    throw new Error(err.errorSummary || `activateApp ${res.status}`);
  }
}

export async function assignUserToApp(appId: string, userId: string): Promise<void> {
  const res = await sswsFetch(`/api/v1/apps/${appId}/users`, {
    method: 'POST', body: JSON.stringify({ id: userId }),
  });
  if (!res.ok) {
    const err = await res.json() as any;
    throw new Error(err.errorSummary || `assignUserToApp ${res.status}`);
  }
}

export async function listAppUsers(appId: string): Promise<OktaUser[]> {
  const res = await sswsFetch(`/api/v1/apps/${appId}/users`);
  if (!res.ok) throw new Error(`listAppUsers ${res.status}: ${await res.text()}`);
  const appUsers = await res.json() as any[];
  const users = await Promise.all(appUsers.map((au) => getUser(au.id).catch(() => null)));
  return users.filter((u): u is OktaUser => !!u);
}

// Orchestrates the streamlined flow: ensure the agent has a backing OIDC app, ensure it's
// active, and return its appId — ready for assignUserToApp. Safe to call repeatedly; each
// step is a no-op if already done.
export async function ensureUserAccess(agentId: string): Promise<string> {
  let agent = await getAIAgent(agentId);
  if (!agent.signOnProvider?.appInstanceId) {
    await enableUserAccess(agentId);
    agent = await getAIAgent(agentId);
  }
  const appId = agent.signOnProvider?.appInstanceId;
  if (!appId) throw new Error('Failed to provision a backing app for this agent');
  await activateApp(appId);
  return appId;
}

export function orgIdFromAgentOrn(orn: string): string {
  // orn:<env>:directory:<orgId>:workload-principals:ai-agents:<id>
  return orn.split(':')[3];
}

// Org-level features (like the settings authz-server picker) have no specific agent in context,
// but every agent's ORN carries the same org ID — so any existing agent works as a source for it.
// (GET /api/v1/org would be a cleaner source but needs an extra OAuth scope we don't have granted.)
export async function getAnyOrgId(): Promise<string | undefined> {
  const agents = await listAIAgents(1);
  const orn = agents[0] ? agentOrnFromLinks(agents[0]._links) : '';
  return orn ? orgIdFromAgentOrn(orn) : undefined;
}

export function buildAuthorizationServerOrn(authServerId: string, orgId: string): string {
  return `orn:oktapreview:idp:${orgId}:authorization_servers:${authServerId}`;
}

// A service app (OAuth Service application) authorized as a Machine Access caller — the same
// delegation-links endpoint used for agent-to-agent callers, but from.clientOrn points at the
// app itself rather than at an agent's workload-principal ORN. Captured live from the Admin
// Console's "Add caller" flow when the caller type is an app instead of another AI agent.
export function buildAppOrn(appId: string, orgId: string): string {
  return `orn:oktapreview:idp:${orgId}:apps:oidc_client:${appId}`;
}

// An agent's own auto-created a2a resource server — the ORN a resource connection's `resource`
// field points at when the target is another AI agent (as opposed to an app instance, secret, etc).
export function buildA2AResourceOrn(agentId: string, orgId: string): string {
  return `orn:oktapreview:directory:${orgId}:resource-servers:a2a:${agentId}`;
}

export interface AppOption { id: string; label: string; applicationType?: string; }

// Search Okta OAuth apps by name — backs the "Service app" caller picker for Machine Access.
// Okta's Apps API has no server-side filter for application_type, so this fetches a larger batch
// (the org only has ~50-60 apps total) and filters to real service clients client-side — excluding
// Okta's own built-in system apps (Admin Console, Dashboard, Workflows, etc, all non-"service" type)
// and test agents' backing web apps, leaving only genuine machine/service OAuth clients.
export async function searchApps(query?: string, limit = 20): Promise<AppOption[]> {
  const params = new URLSearchParams({ limit: '200' });
  if (query) params.set('q', query);
  const res = await sswsFetch(`/api/v1/apps?${params}`);
  if (!res.ok) throw new Error(`searchApps ${res.status}: ${await res.text()}`);
  const apps = await res.json() as any[];
  return apps
    .filter((a) => a.settings?.oauthClient?.application_type === 'service')
    .slice(0, limit)
    .map((a) => ({ id: a.id, label: a.label, applicationType: a.settings?.oauthClient?.application_type }));
}

export async function getApp(appId: string): Promise<AppOption> {
  const res = await sswsFetch(`/api/v1/apps/${appId}`);
  if (!res.ok) throw new Error(`getApp ${res.status}`);
  const a = await res.json() as any;
  return { id: a.id, label: a.label, applicationType: a.settings?.oauthClient?.application_type };
}

export interface AuthorizationServer { id: string; name: string; orn: string; }

export async function listAuthorizationServers(orgId: string): Promise<AuthorizationServer[]> {
  const res = await sswsFetch('/api/v1/authorizationServers');
  if (!res.ok) throw new Error(`listAuthorizationServers ${res.status}: ${await res.text()}`);
  const servers = await res.json() as any[];
  return servers.map((s) => ({ id: s.id, name: s.name, orn: buildAuthorizationServerOrn(s.id, orgId) }));
}

// Unlike listAuthorizationServers (which only keeps id/name/orn for internal Okta linking calls),
// this surfaces the real issuer URL — needed to build a token endpoint for the Exercise feature.
export async function getAuthorizationServer(authServerId: string): Promise<{ id: string; name: string; issuer: string }> {
  const res = await sswsFetch(`/api/v1/authorizationServers/${authServerId}`);
  if (!res.ok) throw new Error(`getAuthorizationServer ${res.status}: ${await res.text()}`);
  const s = await res.json() as any;
  return { id: s.id, name: s.name, issuer: s.issuer };
}

// The agent's own /ai-agents/{id} response never includes resourceUrl — it only shows up on the
// auto-created a2a resource server once set (and can't be changed after that point).
export async function getAgentResourceUrl(agentId: string): Promise<string | undefined> {
  const res = await sswsFetch(`/resource-servers/api/v1/a2a-servers/${agentId}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`getAgentResourceUrl ${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  return data.resourceUrl;
}

export async function connectAuthorizationServer(agentId: string, authServerOrn: string): Promise<void> {
  const res = await sswsFetch(`/resource-servers/api/v1/a2a-servers/${agentId}/authorization-servers`, {
    method: 'POST', body: JSON.stringify({ orn: authServerOrn, type: 'OKTA' }),
  });
  if (res.status !== 204 && !res.ok) {
    const err = await res.json() as any;
    throw new Error(err.errorSummary || `connectAuthorizationServer ${res.status}`);
  }
}

// Orchestrates the streamlined Machine Access flow: ensure the target agent has an audience/
// resource URL (computing one from its own agent ID if it doesn't have one yet — Okta won't let
// an existing value be changed, so this is a no-op when already set), connect the given shared
// authorization server to it, and return both ORNs ready for createDelegationLink.
export async function ensureMachineAccess(agentId: string, authServerId: string): Promise<{ targetOrn: string; authServerOrn: string }> {
  const agent = await getAIAgent(agentId);
  const targetOrn = agentOrnFromLinks(agent._links);
  if (!targetOrn) throw new Error('Could not resolve agent ORN — agent may not be fully provisioned yet');

  const existingResourceUrl = await getAgentResourceUrl(agentId);
  if (!existingResourceUrl) {
    await setAgentResourceUrl(agentId, `https://${agentId}`);
  }

  const orgId = orgIdFromAgentOrn(targetOrn);
  const authServerOrn = buildAuthorizationServerOrn(authServerId, orgId);
  await connectAuthorizationServer(agentId, authServerOrn);

  return { targetOrn, authServerOrn };
}

export async function createDelegationLink(callerOrn: string, targetOrn: string, authServerOrn: string): Promise<void> {
  // Newly-connected authorization servers (connectAuthorizationServer) can take a moment to
  // propagate before delegation-links accepts them — retry briefly on that specific validation error.
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await sswsFetch('/workload-principals/api/v1/delegation-links', {
      method: 'POST',
      body: JSON.stringify({
        from: { type: 'OKTA_AUTHORIZATION_SERVER', clientOrn: callerOrn, tokenType: 'ACCESS_TOKEN' },
        to: { resourceOrn: targetOrn, authorizationServerOrn: authServerOrn },
      }),
    });
    if (res.ok) return;

    const err = await res.json() as any;
    // Already linked — treat as success so callers (e.g. the reciprocal auto-link from
    // ensureAgentConnection) can call this unconditionally without needing to check first.
    const alreadyExists = err.errorCauses?.some((c: any) => c.reason === 'UNIQUE_CONSTRAINT');
    if (alreadyExists) return;

    const isPropagationDelay = err.errorCauses?.some((c: any) => c.location === 'to.authorizationServerOrn');
    if (isPropagationDelay && attempt < 4) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(err.errorSummary || `createDelegationLink ${res.status}`);
  }
}

// ── Exercise Agent: real 3-step delegation chain made AS onboarded agents ─────
// Unlike sswsFetch, these authenticate with the service client's or the caller agent's own
// credentials (not the backend's OKTA_API_TOKEN / OKTA_M2M_* creds) against a custom
// authorization server's token endpoint. Still emitted on the event bus so they show up in
// API Events. Modeled on the O4AA-A2A-TokenInspector reference repo's documented 3-step
// service-client -> token-exchange (id-jag) -> jwt-bearer chain, scaled to one delegation hop —
// the exact Okta parameter/response shape here is unverified against a live tenant and expected
// to need adjustment on first real run (see plan notes).

function decodeJwt(token: string): { header: any; payload: any } {
  const [headerB64, payloadB64] = token.split('.');
  const decode = (b64: string) => JSON.parse(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  return { header: decode(headerB64), payload: decode(payloadB64) };
}

export interface ExerciseTokenResult {
  ok: boolean;
  status: number;
  accessToken?: string;
  decoded?: { header: any; payload: any };
  raw: any;
}

// Generic client assertion signer — parallel to buildClientAssertion, but parameterized by an
// arbitrary key/kid/clientId instead of reading OKTA_M2M_PRIVATE_JWK, so it can sign on behalf
// of any exercised agent using the PEM captured once by createAgentJwk.
async function signAssertion(clientId: string, privateKeyPem: string, kid: string, audience: string): Promise<string> {
  const privateKey = await importPKCS8(privateKeyPem, 'RS256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience(audience)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

export interface AgentTestCredential {
  clientSecret?: string;
  privateKeyPem?: string;
  privateKeyKid?: string;
}

// Shared low-level POST to a token endpoint, authenticating either via Basic auth (client_secret)
// or a signed client_assertion (private_key_jwt) depending on which credential is supplied.
// Emits on the event bus so every hop of the chain shows up in the Okta API Events panel.
async function postToken(
  tokenEndpoint: string, clientId: string, cred: AgentTestCredential, params: Record<string, string>, label: string
): Promise<ExerciseTokenResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  const body: Record<string, string> = { ...params };

  if (cred.privateKeyPem && cred.privateKeyKid) {
    body.client_assertion_type = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
    body.client_assertion = await signAssertion(clientId, cred.privateKeyPem, cred.privateKeyKid, tokenEndpoint);
  } else if (cred.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${cred.clientSecret}`).toString('base64')}`;
  }

  const eventId = nextId();
  const startMs = Date.now();
  eventBus.emit('okta:call', { id: eventId, ts: new Date().toISOString(), method: 'POST', path: tokenEndpoint, label, requestBody: maskSecrets(body) });

  const res = await fetch(tokenEndpoint, { method: 'POST', headers, body: new URLSearchParams(body) });
  const text = await res.text();
  let responseBody: any;
  try { responseBody = JSON.parse(text); } catch { responseBody = text; }

  eventBus.emit('okta:response', {
    id: eventId, ts: new Date().toISOString(), method: 'POST', path: tokenEndpoint, label,
    requestBody: maskSecrets(body), responseBody: maskSecrets(responseBody), status: res.status, durationMs: Date.now() - startMs,
  });

  if (!res.ok) return { ok: false, status: res.status, raw: responseBody };
  const accessToken = responseBody.access_token;
  return { ok: true, status: res.status, accessToken, decoded: accessToken ? decodeJwt(accessToken) : undefined, raw: maskSecrets(responseBody) };
}

// Step 1: the configured service client originates the chain with a plain client_credentials grant.
export async function runServiceClientGrant(
  tokenEndpoint: string, serviceClientId: string, serviceClientSecret: string, resource: string
): Promise<ExerciseTokenResult> {
  return postToken(
    tokenEndpoint, serviceClientId, { clientSecret: serviceClientSecret },
    { grant_type: 'client_credentials', scope: 'agent.invoke', resource },
    'Exercise: Service Client Grant'
  );
}

// Step 2: the caller agent exchanges the service client's access token for an id-jag, authenticating
// with whichever credential is actually configured for it (client_secret_basic or private_key_jwt).
// Per Okta's official AI agent token-exchange docs, this hop targets the ORG-LEVEL default token
// endpoint (not the custom authorization server's own endpoint) and requires an explicit `audience`
// naming that authorization server's issuer — only steps 1 and 3 hit the custom AS endpoint directly.
// `resource` is required for an A2A hop (identifies the target agent) but must be OMITTED for a
// plain Custom Authorization Server hop — confirmed live: sending it there gets rejected with
// invalid_target/"'resource' is invalid or not supported", since audience alone already identifies
// the AS and its own configured resource/audience is what's actually being asserted.
export async function runIdJagExchange(
  orgTokenEndpoint: string, callerAgentId: string, callerCred: AgentTestCredential, subjectToken: string, resource: string | undefined, audience: string,
  subjectTokenType: string = 'urn:ietf:params:oauth:token-type:access_token'
): Promise<ExerciseTokenResult> {
  const params: Record<string, string> = {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: subjectToken,
    subject_token_type: subjectTokenType,
    requested_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
    audience,
    scope: 'agent.invoke',
  };
  if (resource) params.resource = resource;
  return postToken(orgTokenEndpoint, callerAgentId, callerCred, params, 'Exercise: Token Exchange (id-jag)');
}

// Step 3: the caller agent redeems the id-jag for the final delegated access token via a JWT-bearer
// grant, authenticating the same way it did for the exchange in step 2.
export async function runJwtBearerRedemption(
  tokenEndpoint: string, callerAgentId: string, callerCred: AgentTestCredential, idJag: string
): Promise<ExerciseTokenResult> {
  return postToken(
    tokenEndpoint, callerAgentId, callerCred,
    { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: idJag },
    'Exercise: JWT Bearer Redemption'
  );
}

export interface DelegationLink { id: string; callerOrn: string; authorizationServerOrn: string; }

export async function listDelegationLinksTo(targetOrn: string): Promise<DelegationLink[]> {
  const filter = encodeURIComponent(`to.resourceOrn eq "${targetOrn}"`);
  const res = await sswsFetch(`/workload-principals/api/v1/delegation-links?filter=${filter}&limit=20`);
  if (!res.ok) throw new Error(`listDelegationLinksTo ${res.status}: ${await res.text()}`);
  const data = await res.json() as { data: any[] };
  return (data.data || []).map((d) => ({
    id: d.id,
    callerOrn: d.from?.clientOrn || '',
    authorizationServerOrn: d.to?.authorizationServerOrn || '',
  }));
}

export interface DelegationLinkFrom { id: string; targetOrn: string; authorizationServerOrn: string; }

// Reverse lookup: given a caller's ORN, which targets is it authorized to call? Used by the
// Exercise page's caller-first flow (pick the caller agent, then only show targets it can reach).
export async function listDelegationLinksFrom(callerOrn: string): Promise<DelegationLinkFrom[]> {
  const filter = encodeURIComponent(`from.clientOrn eq "${callerOrn}"`);
  const res = await sswsFetch(`/workload-principals/api/v1/delegation-links?filter=${filter}&limit=20`);
  if (!res.ok) throw new Error(`listDelegationLinksFrom ${res.status}: ${await res.text()}`);
  const data = await res.json() as { data: any[] };
  return (data.data || []).map((d) => ({
    id: d.id,
    targetOrn: d.to?.resourceOrn || '',
    authorizationServerOrn: d.to?.authorizationServerOrn || '',
  }));
}

// ── Agent Credentials ─────────────────────────────────────────────────────────
// Two patterns exist depending on how the agent was provisioned:
//  - 'app':    a separate backing Okta App (appId) holds oauthClient credentials
//  - 'native': keys are registered directly on the agent's own workload principal

export interface AgentJwk { kid: string; status: string; alg: string; created: string; }
export interface AgentSecret { id: string; status: string; created: string; }

export interface AgentCredentials {
  source: 'app' | 'native';
  appId?: string; clientId: string; authMethod: string;
  clientSecret?: string; hasSecret?: boolean;
  jwks?: AgentJwk[];
  secrets?: AgentSecret[];
}

export async function getAgentCredentials(appId: string): Promise<AgentCredentials> {
  const res = await sswsFetch(`/api/v1/apps/${appId}`);
  if (!res.ok) throw new Error(`getAgentCredentials ${res.status}`);
  const app = await res.json() as any;
  const creds = app.credentials?.oauthClient || {};
  return {
    source: 'app',
    appId,
    clientId: creds.client_id || appId,
    authMethod: creds.token_endpoint_auth_method || 'client_secret_basic',
    hasSecret: !!creds.client_secret,
  };
}

export async function listAgentJwks(agentId: string): Promise<AgentJwk[]> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}/credentials/jwks`);
  if (!res.ok) throw new Error(`listAgentJwks ${res.status}: ${await res.text()}`);
  const data = await res.json() as { data: any[] };
  return (data.data || []).map((k) => ({ kid: k.kid, status: k.status, alg: k.alg, created: k.created }));
}

export async function listAgentSecrets(agentId: string): Promise<AgentSecret[]> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}/credentials/secrets`);
  if (!res.ok) throw new Error(`listAgentSecrets ${res.status}: ${await res.text()}`);
  const data = await res.json() as any[];
  return (data || []).map((s) => ({ id: s.id, status: s.status, created: s.created }));
}

export async function createAgentSecret(agentId: string): Promise<{ id: string; clientSecret: string; status: string }> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}/credentials/secrets`, {
    method: 'POST', body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`createAgentSecret ${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  return { id: data.id, clientSecret: data.client_secret, status: data.status };
}

export async function createAgentJwk(agentId: string): Promise<{ kid: string; privateKeyPem: string }> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as any;
  const kid = randomUUID().replace(/-/g, '');

  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}/credentials/jwks`, {
    method: 'POST',
    body: JSON.stringify({ kty: jwk.kty, use: 'sig', kid, alg: 'RS256', n: jwk.n, e: jwk.e }),
  });
  if (!res.ok) throw new Error(`createAgentJwk ${res.status}: ${await res.text()}`);

  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  return { kid, privateKeyPem };
}

export async function getNativeAgentCredentials(agentId: string): Promise<AgentCredentials> {
  const [jwks, secrets, client] = await Promise.all([
    listAgentJwks(agentId),
    listAgentSecrets(agentId),
    sswsFetch(`/oauth2/v1/clients/${agentId}`).then((r) => (r.ok ? r.json() as Promise<any> : null)).catch(() => null),
  ]);
  // Okta will register a secret/jwk credential object even when the OAuth client itself is
  // configured for the other auth method (confirmed live: ET4 had an ACTIVE secret yet its real
  // token_endpoint_auth_method was private_key_jwt, so the secret never actually authenticated).
  // The client's own config is authoritative — same pattern getAgentCredentials already uses for
  // app-backed agents — inferring from which credential objects merely exist is not reliable.
  const hasActiveSecret = secrets.some((s) => s.status === 'ACTIVE');
  const hasActiveKey = jwks.some((k) => k.status === 'ACTIVE');
  const authMethod = client?.token_endpoint_auth_method
    || (hasActiveSecret ? 'client_secret_basic' : hasActiveKey ? 'private_key_jwt' : 'none');
  return { source: 'native', clientId: agentId, authMethod, jwks, secrets };
}

export async function setAgentAuthMethod(appId: string, authMethod: string): Promise<AgentCredentials> {
  // GET current app config then PUT it back with updated auth method
  const getRes = await sswsFetch(`/api/v1/apps/${appId}`);
  if (!getRes.ok) throw new Error(`getApp ${getRes.status}`);
  const app = await getRes.json() as any;

  app.credentials = app.credentials || {};
  app.credentials.oauthClient = app.credentials.oauthClient || {};
  app.credentials.oauthClient.token_endpoint_auth_method = authMethod;

  const putRes = await sswsFetch(`/api/v1/apps/${appId}`, {
    method: 'PUT', body: JSON.stringify(app),
  });
  if (!putRes.ok) {
    const err = await putRes.json() as any;
    throw new Error(err.errorSummary || `setAuthMethod ${putRes.status}`);
  }
  const updated = await putRes.json() as any;
  const creds = updated.credentials?.oauthClient || {};
  return {
    source: 'app',
    appId,
    clientId: creds.client_id || appId,
    authMethod: creds.token_endpoint_auth_method,
    hasSecret: authMethod !== 'none' && authMethod !== 'private_key_jwt',
  };
}

// Prepares an agent's backing OIDC app for a real Exercise Agent test login: workload-principal-
// backed apps reject token_endpoint_auth_method 'none' outright (confirmed live — only
// client_secret_basic/post/jwt or private_key_jwt are accepted), so this forces client_secret_basic
// instead and appends the given callback URL to its redirect_uris (appending, not overwriting, in
// case an admin already configured others). Returns the app's real client_id and secret so the
// backend can complete the code exchange server-side with Basic auth.
export async function setAppAuthMethodAndRedirect(appId: string, redirectUri: string): Promise<{ clientId: string; clientSecret: string }> {
  const getRes = await sswsFetch(`/api/v1/apps/${appId}`);
  if (!getRes.ok) throw new Error(`getApp ${getRes.status}`);
  const app = await getRes.json() as any;

  app.credentials = app.credentials || {};
  app.credentials.oauthClient = app.credentials.oauthClient || {};
  app.credentials.oauthClient.token_endpoint_auth_method = 'client_secret_basic';
  delete app.credentials.oauthClient.pkce_required;

  app.settings = app.settings || {};
  app.settings.oauthClient = app.settings.oauthClient || {};
  const existingRedirects: string[] = app.settings.oauthClient.redirect_uris || [];
  if (!existingRedirects.includes(redirectUri)) {
    app.settings.oauthClient.redirect_uris = [...existingRedirects, redirectUri];
  }
  // Workload-principal-backed OAuth clients require token-exchange and jwt-bearer to stay in
  // grant_types (Okta rejects a PUT that drops them) — append authorization_code, don't replace.
  const existingResponseTypes: string[] = app.settings.oauthClient.response_types || [];
  if (!existingResponseTypes.includes('code')) {
    app.settings.oauthClient.response_types = [...existingResponseTypes, 'code'];
  }
  const existingGrantTypes: string[] = app.settings.oauthClient.grant_types || [];
  if (!existingGrantTypes.includes('authorization_code')) {
    app.settings.oauthClient.grant_types = [...existingGrantTypes, 'authorization_code'];
  }

  const putRes = await sswsFetch(`/api/v1/apps/${appId}`, { method: 'PUT', body: JSON.stringify(app) });
  if (!putRes.ok) {
    const err = await putRes.json() as any;
    const causes = (err.errorCauses || []).map((c: any) => c.errorSummary).join('; ');
    throw new Error(causes || err.errorSummary || `setAppAuthMethodAndRedirect ${putRes.status}`);
  }
  const updated = await putRes.json() as any;
  return {
    clientId: updated.credentials?.oauthClient?.client_id || appId,
    clientSecret: updated.credentials?.oauthClient?.client_secret,
  };
}

// Generates a fresh client_secret on an app-backed agent's own backing app (as opposed to
// createAgentSecret, which posts to the native workload-principal credentials endpoint — the
// wrong one for an agent whose real client_secret lives on its backing OIDC app instead). Okta
// issues a new client_secret on a PUT that (re-)sets token_endpoint_auth_method, confirmed live.
export async function rotateAppSecret(appId: string): Promise<{ clientId: string; clientSecret: string }> {
  const getRes = await sswsFetch(`/api/v1/apps/${appId}`);
  if (!getRes.ok) throw new Error(`getApp ${getRes.status}`);
  const app = await getRes.json() as any;

  app.credentials = app.credentials || {};
  app.credentials.oauthClient = app.credentials.oauthClient || {};
  app.credentials.oauthClient.token_endpoint_auth_method = 'client_secret_basic';
  delete app.credentials.oauthClient.pkce_required;

  const putRes = await sswsFetch(`/api/v1/apps/${appId}`, { method: 'PUT', body: JSON.stringify(app) });
  if (!putRes.ok) {
    const err = await putRes.json() as any;
    const causes = (err.errorCauses || []).map((c: any) => c.errorSummary).join('; ');
    throw new Error(causes || err.errorSummary || `rotateAppSecret ${putRes.status}`);
  }
  const updated = await putRes.json() as any;
  return {
    clientId: updated.credentials?.oauthClient?.client_id || appId,
    clientSecret: updated.credentials?.oauthClient?.client_secret,
  };
}

// ── IGA Resource Owners ───────────────────────────────────────────────────────
// Governance API to assign owners in Okta's AI Agents "Owners" tab

export function agentOrnFromLinks(links: any): string {
  // Extract agent ORN from the delegationLinks href filter param (URL-encoded query string)
  const href = links?.delegationLinks?.href || '';
  const decoded = decodeURIComponent(href);
  const match = decoded.match(/to\.resourceOrn\s+eq\s+"([^"]+)"/);
  return match ? match[1] : '';
}

export async function getAgentAdminUrl(agentId: string): Promise<string> {
  // Build the Okta Admin Console deep-link for the agent's Owners tab
  return `${GOV_ORG()}/admin/ai-agent/${agentId}/edit#owners`;
}

function userOrnFromAgentOrn(agentOrn: string, userId: string): string {
  const parts = agentOrn.split(':');
  const env = parts[1]; const orgId = parts[3];
  return `orn:${env}:directory:${orgId}:users:${userId}`;
}

export async function removeAgentOwner(agentId: string, userId: string): Promise<void> {
  // The IGA API supports REMOVE. Use it when revoking an owner.
  const agent = await getAIAgent(agentId);
  const agentOrn = agentOrnFromLinks(agent._links);
  if (!agentOrn) return;

  const userOrn = userOrnFromAgentOrn(agentOrn, userId);

  const res = await sswsFetch('/governance/api/v1/resource-owners', {
    method: 'PATCH',
    body: JSON.stringify({ resourceOrn: agentOrn, data: [{ op: 'REMOVE', path: '/principalOrn', value: userOrn }] }),
  }, GOV_ORG());
  if (res.status !== 204 && !res.ok) {
    console.warn(`IGA REMOVE owner returned ${res.status}`);
  }
}

export interface ResourceOwner { id: string; name: string; email: string; }

export async function listResourceOwnersByOrn(agentOrn: string): Promise<ResourceOwner[]> {
  if (!agentOrn) return [];

  const filter = encodeURIComponent(`parentResourceOrn eq "${agentOrn}"`);
  const res = await sswsFetch(`/governance/api/v1/resource-owners?limit=20&filter=${filter}`, {}, GOV_ORG());
  if (!res.ok) throw new Error(`listResourceOwners ${res.status}: ${await res.text()}`);

  const data = await res.json() as any;
  const rows: any[] = data.data || [];

  return rows.flatMap((r) => r.principals || [])
    .filter((p: any) => p.type === 'users')
    .map((p: any) => ({ id: p.id, name: p.profile?.name || '', email: p.profile?.email || '' }));
}

export async function listResourceOwners(agentId: string): Promise<ResourceOwner[]> {
  const agent = await getAIAgent(agentId);
  return listResourceOwnersByOrn(agentOrnFromLinks(agent._links));
}

export async function setAgentOwner(agentId: string, userId: string): Promise<void> {
  const agent = await getAIAgent(agentId);
  const agentOrn = agentOrnFromLinks(agent._links);
  if (!agentOrn) throw new Error('Could not resolve agent ORN — agent may not be fully provisioned yet');

  const userOrn = userOrnFromAgentOrn(agentOrn, userId);

  const res = await sswsFetch('/governance/api/v1/resource-owners', {
    method: 'POST',
    body: JSON.stringify({ resourceOrns: [agentOrn], principalOrns: [userOrn] }),
  }, GOV_ORG());
  if (!res.ok) {
    throw new Error(`Failed to register owner in Okta: ${res.status} ${await res.text()}`);
  }
}

// ── Potential Connections (what can be connected to an agent) ─────────────────

export const CONNECTION_TYPES = [
  'IDENTITY_ASSERTION_CUSTOM_AS',
  'IDENTITY_ASSERTION_A2A_SERVER',
  'IDENTITY_ASSERTION_APP_INSTANCE',
  'STS_ACCESS_TOKEN',
  'STS_VAULT_SECRET',
  'STS_SERVICE_ACCOUNT',
  'IDENTITY_ASSERTION_VIRTUAL_MCP_SERVER',
] as const;

export type ConnectionType = typeof CONNECTION_TYPES[number];

export interface PotentialConnection {
  connectionType: ConnectionType;
  // IDENTITY_ASSERTION_CUSTOM_AS / A2A_SERVER
  authorizationServer?: { name: string; issuerUrl: string; orn: string; _links?: any };
  resourceIndicator?: string;
  // STS_ACCESS_TOKEN / APP_INSTANCE
  resource?: {
    appInstanceId?: string; appInstanceName?: string;
    clientAuthSettings?: { name: string; orn: string };
    resourceType?: string; orn?: string; _links?: any;
  };
}

export async function listPotentialConnections(types?: ConnectionType[]): Promise<PotentialConnection[]> {
  const targetTypes = types || CONNECTION_TYPES;
  const results: PotentialConnection[] = [];

  await Promise.all(targetTypes.map(async (type) => {
    try {
      const filter = encodeURIComponent(`connectionType eq "${type}"`);
      const res = await sswsFetch(`/workload-principals/api/v1/potential-connections?filter=${filter}&limit=50`);
      if (!res.ok) return;
      const data = await res.json() as { data: any[] };
      if (data.data) results.push(...data.data);
    } catch {}
  }));

  return results;
}

// ── Agent Connections (what is currently connected) ───────────────────────────

export interface AgentConnection {
  id: string; connectionType: string; status: string; orn?: string;
  authorizationServer?: { name: string; issuerUrl: string; orn: string };
  resourceIndicator?: string; scopeCondition?: string; scopes?: string[];
  resource?: any; _links?: any;
}

export async function listAgentConnections(agentId: string): Promise<AgentConnection[]> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}/connections`);
  if (!res.ok) return [];
  const data = await res.json() as any;
  return (data.data || data || []) as AgentConnection[];
}

export async function createAgentConnection(
  agentId: string,
  connection: PotentialConnection
): Promise<AgentConnection> {
  let body: any;

  switch (connection.connectionType) {
    case 'IDENTITY_ASSERTION_CUSTOM_AS':
      body = {
        connectionType: connection.connectionType,
        authorizationServer: { orn: connection.authorizationServer!.orn },
        scopeCondition: 'ALL_SCOPES',
        scopes: ['*'],
      };
      if (connection.resourceIndicator) body.resourceIndicator = connection.resourceIndicator;
      break;

    // A2A connections identify the target agent via resource.orn (its a2a resource-server ORN),
    // not resourceIndicator — Okta rejects the request as malformed if resourceIndicator is sent
    // as a top-level field here; it derives that value itself from the resource once connected.
    case 'IDENTITY_ASSERTION_A2A_SERVER':
      body = {
        connectionType: connection.connectionType,
        authorizationServer: { orn: connection.authorizationServer!.orn },
        resource: { orn: connection.resource!.orn },
        scopeCondition: 'ALL_SCOPES',
        scopes: ['*'],
      };
      break;

    case 'IDENTITY_ASSERTION_APP_INSTANCE':
      body = {
        connectionType: connection.connectionType,
        appInstance: { orn: connection.resource?.orn },
        scopeCondition: 'ALL_SCOPES',
        scopes: ['*'],
      };
      break;

    case 'STS_ACCESS_TOKEN':
      body = {
        connectionType: connection.connectionType,
        resource: {
          appInstanceId: connection.resource?.appInstanceId,
          clientAuthSettings: { orn: connection.resource?.clientAuthSettings?.orn },
        },
      };
      break;

    default:
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { connectionType: _ct, ...rest } = connection as any;
      body = { connectionType: connection.connectionType, ...rest };
  }

  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}/connections`, {
    method: 'POST', body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json() as any;
    throw new Error(err.errorSummary || `createConnection ${res.status}: ${JSON.stringify(err.errorCauses || [])}`);
  }

  const raw = await res.text();
  return raw ? JSON.parse(raw) : body;
}

// Auto-creates the reciprocal resource connection for a caller→target Machine Access
// authorization, matching the real Okta Admin Console's behavior of keeping the delegation link
// and the resource connection in sync in both directions — this dashboard previously only ever
// created one or the other depending on which UI action was used (see createDelegationLink for
// the reverse direction: auto-creating a delegation link when a resource connection is made).
export async function ensureAgentConnection(callerAgentId: string, targetOrn: string, authServerOrn: string): Promise<void> {
  const targetAgentId = targetOrn.split(':').pop();
  if (!targetAgentId) throw new Error('Could not resolve target agent id from ORN');
  const orgId = orgIdFromAgentOrn(targetOrn);
  const targetResourceOrn = buildA2AResourceOrn(targetAgentId, orgId);

  // POSTs directly (rather than going through createAgentConnection) so the structured
  // errorCauses survive intact — createAgentConnection's generic error path collapses them into
  // a message string via errorSummary, losing the "reason": "DUPLICATE_CONNECTION" detail this
  // needs to treat an already-connected pairing as a no-op, the same way createDelegationLink
  // inspects its own parsed error directly instead of string-matching a thrown message.
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${callerAgentId}/connections`, {
    method: 'POST',
    body: JSON.stringify({
      connectionType: 'IDENTITY_ASSERTION_A2A_SERVER',
      authorizationServer: { orn: authServerOrn },
      resource: { orn: targetResourceOrn },
      scopeCondition: 'ALL_SCOPES',
      scopes: ['*'],
    }),
  });
  if (res.ok) return;

  const err = await res.json() as any;
  const alreadyExists = err.errorCauses?.some((c: any) => c.reason === 'DUPLICATE_CONNECTION');
  if (alreadyExists) return;
  throw new Error(err.errorSummary || `ensureAgentConnection ${res.status}`);
}

export async function deleteAgentConnection(agentId: string, connectionId: string): Promise<void> {
  const res = await sswsFetch(
    `/workload-principals/api/v1/ai-agents/${agentId}/connections/${connectionId}`,
    { method: 'DELETE' }
  );
  if (res.status !== 204 && !res.ok) throw new Error(`deleteConnection ${res.status}`);
}
