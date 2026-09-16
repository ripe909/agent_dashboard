// Okta Management API + AI Agents (Secures AI / Workload Principals) API
// Auth mode is controlled by OKTA_AUTH_MODE:
//   'api_token'         (default) — static SSWS API token via OKTA_API_TOKEN
//   'client_credentials' — OAuth2 M2M via OKTA_M2M_CLIENT_ID/SECRET

import { randomUUID } from 'crypto';
import { importJWK, SignJWT } from 'jose';
import { eventBus, nextId, labelForPath } from './eventBus';

const ORG = () => process.env.OKTA_ORG_URL!;
// The governance (IGA resource-owners) API lives on the admin hostname, not the org hostname.
const GOV_ORG = () => toAdminUrl(ORG());
const AUTH_MODE = () => process.env.OKTA_AUTH_MODE || 'api_token';
// okta.governance.resourceOwner.{read,manage} must also be granted on the M2M app's API Scopes tab.
const M2M_SCOPES = 'okta.users.read okta.aiAgents.manage okta.apps.manage okta.governance.resourceOwner.read okta.governance.resourceOwner.manage';

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

// ── Agent Credentials (backing app) ──────────────────────────────────────────

export interface AgentCredentials {
  appId: string; clientId: string; authMethod: string;
  clientSecret?: string; hasSecret?: boolean;
}

export async function getAgentCredentials(appId: string): Promise<AgentCredentials> {
  const res = await sswsFetch(`/api/v1/apps/${appId}`);
  if (!res.ok) throw new Error(`getAgentCredentials ${res.status}`);
  const app = await res.json() as any;
  const creds = app.credentials?.oauthClient || {};
  return {
    appId,
    clientId: creds.client_id || appId,
    authMethod: creds.token_endpoint_auth_method || 'client_secret_basic',
    hasSecret: !!creds.client_secret,
  };
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
    appId,
    clientId: creds.client_id || appId,
    authMethod: creds.token_endpoint_auth_method,
    hasSecret: authMethod !== 'none' && authMethod !== 'private_key_jwt',
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
    case 'IDENTITY_ASSERTION_A2A_SERVER':
      body = {
        connectionType: connection.connectionType,
        authorizationServer: { orn: connection.authorizationServer!.orn },
        scopeCondition: 'ALL_SCOPES',
        scopes: ['*'],
      };
      if (connection.resourceIndicator) body.resourceIndicator = connection.resourceIndicator;
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

export async function deleteAgentConnection(agentId: string, connectionId: string): Promise<void> {
  const res = await sswsFetch(
    `/workload-principals/api/v1/ai-agents/${agentId}/connections/${connectionId}`,
    { method: 'DELETE' }
  );
  if (res.status !== 204 && !res.ok) throw new Error(`deleteConnection ${res.status}`);
}
