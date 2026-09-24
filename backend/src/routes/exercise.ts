import { Router, Request, Response } from 'express';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { store } from '../db/client';
import * as okta from '../services/okta';

const router = Router();

const ORG = () => process.env.OKTA_ORG_URL!;
const BACKEND_PUBLIC_URL = () => process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`;
const FRONTEND_URL = () => process.env.FRONTEND_URL || 'http://localhost:3000';

// Okta normalizes an ORN's env segment (position 1) to "okta" once it's stored on a delegation
// link, regardless of what was sent when the link was created — but agentOrnFromLinks derives an
// ORN from the org's own hostname-based _links, which still says "oktapreview". Comparing ORNs
// for equality has to ignore that segment or every match silently fails.
function ornsMatch(a: string, b: string): boolean {
  const normalize = (orn: string) => orn.split(':').map((seg, i) => (i === 1 ? 'okta' : seg)).join(':');
  return normalize(a) === normalize(b);
}

// ── Machine Access: does this agent have a stored test credential matching its auth method? ─

// Agents provisioned via different paths end up with the backing-app id under different fields:
// appId is set for Machine-Access-style provisioning, signOnProvider.appInstanceId for streamlined
// User Access — both mean "this agent has a real backing OIDC app," so check both before falling
// back to treating it as a native workload-principal.
function backingAppId(oktaAgent: okta.OktaAIAgent): string | undefined {
  return oktaAgent.appId || oktaAgent.signOnProvider?.appInstanceId;
}

async function detectCallerAuthMethod(oktaAgentId: string): Promise<string> {
  const oktaAgent = await okta.getAIAgent(oktaAgentId);
  const appId = backingAppId(oktaAgent);
  const creds = appId
    ? await okta.getAgentCredentials(appId)
    : await okta.getNativeAgentCredentials(oktaAgentId);
  return creds.authMethod;
}

// GET /api/exercise/agents/:id/machine-credential
router.get('/agents/:id/machine-credential', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });

    const authMethod = await detectCallerAuthMethod(agent.oktaAgentId);
    if (authMethod === 'none') {
      return res.json({ authMethod, exercisable: false });
    }
    const hasCredential = authMethod === 'private_key_jwt'
      ? !!(agent.testPrivateKeyPem && agent.testPrivateKeyKid)
      : !!agent.testClientSecret;
    res.json({ authMethod, exercisable: true, hasCredential });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/exercise/agents/:id/machine-credential
// client_secret_basic: { mode: 'generate' } or { mode: 'paste', clientSecret }
// private_key_jwt:     { mode: 'generate' } or { mode: 'paste', kid, privateKeyPem }
router.post('/agents/:id/machine-credential', async (req: Request, res: Response) => {
  const { mode, clientSecret, kid, privateKeyPem } = req.body;
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });

    const oktaAgent = await okta.getAIAgent(agent.oktaAgentId);
    const appId = backingAppId(oktaAgent);
    const authMethod = await detectCallerAuthMethod(agent.oktaAgentId);
    if (authMethod === 'private_key_jwt') {
      if (mode === 'generate') {
        const result = await okta.createAgentJwk(agent.oktaAgentId);
        await store.updateAgentById(agent.id, { testPrivateKeyPem: result.privateKeyPem, testPrivateKeyKid: result.kid });
      } else if (mode === 'paste' && kid && privateKeyPem) {
        await store.updateAgentById(agent.id, { testPrivateKeyPem: privateKeyPem, testPrivateKeyKid: kid });
      } else {
        return res.status(400).json({ error: 'mode must be "generate" or "paste" (with kid and privateKeyPem)' });
      }
    } else if (authMethod === 'client_secret_basic') {
      if (mode === 'generate') {
        // App-backed agents' real client_secret lives on their backing app, not the native
        // workload-principal credentials endpoint — use whichever one actually matches.
        const result = appId ? await okta.rotateAppSecret(appId) : await okta.createAgentSecret(agent.oktaAgentId);
        await store.updateAgentById(agent.id, { testClientSecret: result.clientSecret });
      } else if (mode === 'paste' && clientSecret) {
        await store.updateAgentById(agent.id, { testClientSecret: clientSecret });
      } else {
        return res.status(400).json({ error: 'mode must be "generate" or "paste" (with clientSecret)' });
      }
    } else {
      return res.status(400).json({ error: `Agent auth method "${authMethod}" cannot be exercised` });
    }

    res.json({ hasCredential: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Machine Access: get the initial subject token (step 1 only) ─────────────

// POST /api/exercise/agents/:id/machine-access/token — :id is the agent that will act on its
// own behalf downstream (the intermediary). Gets a client_credentials access token scoped to
// this agent's own resource from the configured service client, and stashes it in the shared
// `results` map so /agents/exercise/continue can use it as the subject token for a later hop.
router.post('/agents/:id/machine-access/token', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });

    const settings = await store.getSettings();
    if (!settings.serviceClientId || !settings.serviceClientSecret) {
      return res.status(400).json({ error: 'Configure a service client in Settings first' });
    }
    if (!settings.sharedAuthorizationServerId) {
      return res.status(400).json({ error: 'Configure a shared authorization server in Settings first' });
    }

    const authServer = await okta.getAuthorizationServer(settings.sharedAuthorizationServerId);
    if (!authServer.issuer) return res.status(500).json({ error: 'Could not resolve the shared authorization server issuer' });
    const authServerTokenEndpoint = `${authServer.issuer}/v1/token`;

    // Scoped to the agent's OWN resource — a later delegation link authorizes the service client
    // to call this agent specifically, so the token's audience/resource has to match for that
    // delegation policy to recognize it in the next hop.
    const resourceUrl = await okta.getAgentResourceUrl(agent.oktaAgentId);
    if (!resourceUrl) return res.status(400).json({ error: 'Agent has no resourceUrl configured yet' });

    const step1 = await okta.runServiceClientGrant(authServerTokenEndpoint, settings.serviceClientId, settings.serviceClientSecret, resourceUrl);
    if (!step1.ok || !step1.accessToken) return res.json({ step1 });

    pruneExpired(results, 10 * 60 * 1000);
    const rid = randomUUID();
    results.set(rid, {
      decoded: { accessToken: step1.decoded },
      rawToken: step1.accessToken,
      rawTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      agentId: agent.id,
      createdAt: Date.now(),
    });
    res.json({ step1, rid });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── User Access: real Authorization Code + PKCE login test ──────────────────

// In-memory only — test logins are short-lived and this dashboard already keeps other
// ephemeral state (like the M2M token cache in okta.ts) outside the DB the same way.
const pendingLogins = new Map<string, { codeVerifier: string; agentId: string; clientId: string; clientSecret: string; createdAt: number }>();
const results = new Map<string, { decoded: any; rawToken: string; rawTokenType: string; agentId: string; createdAt: number }>();

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pruneExpired<T extends { createdAt: number }>(map: Map<string, T>, maxAgeMs: number) {
  const now = Date.now();
  for (const [key, value] of map) {
    if (now - value.createdAt > maxAgeMs) map.delete(key);
  }
}

// POST /api/exercise/agents/:id/user-access/start
router.post('/agents/:id/user-access/start', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.id);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });

    const appId = await okta.ensureUserAccess(agent.oktaAgentId);
    const redirectUri = `${BACKEND_PUBLIC_URL()}/api/exercise/agents/user-access/callback`;
    const { clientId, clientSecret } = await okta.setAppAuthMethodAndRedirect(appId, redirectUri);
    // Persist the same way Machine Access callers do — needed if the user continues past login
    // to exercise this agent as a caller of another agent (see /agents/exercise/continue below).
    await store.updateAgentById(agent.id, { testClientSecret: clientSecret });

    pruneExpired(pendingLogins, 10 * 60 * 1000);
    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
    const state = randomUUID();
    pendingLogins.set(state, { codeVerifier, agentId: agent.id, clientId, clientSecret, createdAt: Date.now() });

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: 'openid profile',
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    res.json({ authorizeUrl: `${ORG()}/oauth2/v1/authorize?${params.toString()}` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/exercise/agents/user-access/callback — Okta redirects here after login
router.get('/agents/user-access/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query as Record<string, string>;
  const redirectUri = `${BACKEND_PUBLIC_URL()}/api/exercise/agents/user-access/callback`;

  if (error) {
    return res.redirect(`${FRONTEND_URL()}/exercise?error=${encodeURIComponent(error_description || error)}`);
  }
  const pending = state ? pendingLogins.get(state) : undefined;
  if (!pending || !code) {
    return res.redirect(`${FRONTEND_URL()}/exercise?error=${encodeURIComponent('Login session expired or invalid — please try again')}`);
  }
  pendingLogins.delete(state);

  try {
    const tokenRes = await fetch(`${ORG()}/oauth2/v1/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${pending.clientId}:${pending.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: pending.codeVerifier,
      }),
    });
    const body = await tokenRes.json() as any;
    if (!tokenRes.ok) {
      return res.redirect(`${FRONTEND_URL()}/exercise?error=${encodeURIComponent(body.error_description || body.error || 'Token exchange failed')}`);
    }

    const decode = (jwt?: string) => {
      if (!jwt) return undefined;
      const [, payloadB64] = jwt.split('.');
      return JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    };

    pruneExpired(results, 10 * 60 * 1000);
    const rid = randomUUID();
    results.set(rid, {
      decoded: {
        idToken: decode(body.id_token),
        accessToken: decode(body.access_token),
      },
      rawToken: body.id_token,
      rawTokenType: 'urn:ietf:params:oauth:token-type:id_token',
      agentId: pending.agentId,
      createdAt: Date.now(),
    });
    res.redirect(`${FRONTEND_URL()}/exercise?result=${rid}`);
  } catch (e: any) {
    res.redirect(`${FRONTEND_URL()}/exercise?error=${encodeURIComponent(e.message)}`);
  }
});

// GET /api/exercise/agents/user-access/result/:rid — returns decoded claims only, never the raw
// token. Not deleted on read (unlike a one-time secret reveal) — the raw token needs to survive
// so /agents/exercise/continue can use it, and expires via the existing 10-minute TTL instead.
router.get('/agents/user-access/result/:rid', (req: Request, res: Response) => {
  const result = results.get(req.params.rid);
  if (!result) return res.status(404).json({ error: 'Result not found or expired' });
  // agentId is included so the frontend can restore which agent this login was for — the
  // redirect back from Okta is a full page navigation, so client state (the dropdown selection)
  // doesn't survive it.
  res.json({ ...result.decoded, agentId: result.agentId });
});

// POST /api/exercise/agents/exercise/continue — { rid, targetAgentId }: shared downstream step
// for both Machine Access and User Access. `rid` refers to a token already stashed in `results`
// (by /machine-access/token for a client_credentials access_token, or by the login callback for a
// real user's id_token) — the agent that produced/owns that token exchanges it for an id-jag scoped
// to a downstream agent (target) it's authorized to call, then redeems that id-jag for a delegated
// access token. Works identically regardless of which flow produced the initial token, since
// runIdJagExchange takes the subject token type as a parameter (result.rawTokenType).
router.post('/agents/exercise/continue', async (req: Request, res: Response) => {
  const { rid, targetAgentId } = req.body;
  if (!rid || !targetAgentId) return res.status(400).json({ error: 'rid and targetAgentId are required' });
  try {
    const result = results.get(rid);
    if (!result) return res.status(404).json({ error: 'Token expired — please get a new one' });

    const caller = await store.findAgentById(result.agentId);
    if (!caller?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    if (!caller.testClientSecret && !(caller.testPrivateKeyPem && caller.testPrivateKeyKid)) {
      return res.status(400).json({ error: 'No credential stored for this agent yet' });
    }

    const target = await store.findAgentById(targetAgentId);
    if (!target?.oktaAgentId) return res.status(404).json({ error: 'Target agent not found' });

    const callerOktaAgent = await okta.getAIAgent(caller.oktaAgentId);
    const callerOrn = okta.agentOrnFromLinks(callerOktaAgent._links);
    if (!callerOrn) return res.status(400).json({ error: 'Could not resolve the logged-in agent\'s ORN' });

    const targetOktaAgent = await okta.getAIAgent(target.oktaAgentId);
    const targetOrn = okta.agentOrnFromLinks(targetOktaAgent._links);
    if (!targetOrn) return res.status(400).json({ error: 'Could not resolve the target agent\'s ORN' });

    // Resolve the specific authorization server actually configured for this caller→target
    // delegation link — not the global Settings shared authz server, which may have changed
    // since this particular link was created.
    const links = await okta.listDelegationLinksFrom(callerOrn);
    const link = links.find((l) => ornsMatch(l.targetOrn, targetOrn));
    if (!link) return res.status(400).json({ error: 'This agent is not authorized to call the selected target — configure Machine Access first' });
    const authServerId = link.authorizationServerOrn.split(':').pop();
    if (!authServerId) return res.status(500).json({ error: 'Could not resolve the delegation link\'s authorization server' });
    const authServer = await okta.getAuthorizationServer(authServerId);
    if (!authServer.issuer) return res.status(500).json({ error: 'Could not resolve the authorization server issuer' });

    const targetResourceUrl = await okta.getAgentResourceUrl(target.oktaAgentId);
    if (!targetResourceUrl) return res.status(400).json({ error: 'Target agent has no resourceUrl configured yet' });

    const orgTokenEndpoint = `${ORG()}/oauth2/v1/token`;
    const authServerTokenEndpoint = `${authServer.issuer}/v1/token`;
    // The caller's real auth method varies (client_secret_basic vs private_key_jwt — see
    // getNativeAgentCredentials) — postToken picks the right assertion type based on which
    // fields are populated here, so both credential shapes must be passed through, not just secret.
    const callerCred: okta.AgentTestCredential = caller.testPrivateKeyPem && caller.testPrivateKeyKid
      ? { privateKeyPem: caller.testPrivateKeyPem, privateKeyKid: caller.testPrivateKeyKid }
      : { clientSecret: caller.testClientSecret! };

    // Subject token type varies by which flow produced it (client_credentials access_token for
    // Machine Access, or a real user's id_token for User Access/XAA) — stored alongside the raw
    // token itself so this shared step doesn't need to know or care which flow it came from.
    const step2 = await okta.runIdJagExchange(
      orgTokenEndpoint, caller.oktaAgentId, callerCred, result.rawToken, targetResourceUrl, authServer.issuer,
      result.rawTokenType
    );
    if (!step2.ok || !step2.accessToken) return res.json({ step2, step3: null });

    const step3 = await okta.runJwtBearerRedemption(authServerTokenEndpoint, caller.oktaAgentId, callerCred, step2.accessToken);
    if (!step3.ok || !step3.accessToken) return res.json({ step2, step3 });

    // Stash the delegated token under the TARGET agent so the frontend can recurse
    // AgentExerciseStep one level deeper, treating the target as the new caller.
    pruneExpired(results, 10 * 60 * 1000);
    const nextRid = randomUUID();
    results.set(nextRid, {
      decoded: { accessToken: step3.decoded },
      rawToken: step3.accessToken,
      rawTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      agentId: target.id,
      createdAt: Date.now(),
    });
    res.json({ step2, step3, nextRid });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/exercise/agents/exercise/continue-to-authserver — { rid, connectionId }: terminal hop
// against a Custom Authorization Server resource connection already active on the caller (the
// "Authorization server" resource type in ResourcePicker.tsx). Unlike the a2a hop above, Custom AS
// connections aren't governed by delegation links in this codebase's model — the connection itself
// (its authorizationServer.issuerUrl + resourceIndicator) is what authorizes the exchange, so this
// skips the delegation-link lookup entirely. Never produces a nextRid — an AS resource can't call
// further agents, so the chain ends here.
router.post('/agents/exercise/continue-to-authserver', async (req: Request, res: Response) => {
  const { rid, connectionId } = req.body;
  if (!rid || !connectionId) return res.status(400).json({ error: 'rid and connectionId are required' });
  try {
    const result = results.get(rid);
    if (!result) return res.status(404).json({ error: 'Token expired — please get a new one' });

    const caller = await store.findAgentById(result.agentId);
    if (!caller?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    if (!caller.testClientSecret && !(caller.testPrivateKeyPem && caller.testPrivateKeyKid)) {
      return res.status(400).json({ error: 'No credential stored for this agent yet' });
    }

    const connections = await okta.listAgentConnections(caller.oktaAgentId);
    const connection = connections.find((c) => c.id === connectionId && c.connectionType === 'IDENTITY_ASSERTION_CUSTOM_AS');
    if (!connection?.authorizationServer?.issuerUrl || !connection.resourceIndicator) {
      return res.status(400).json({ error: 'Authorization server connection not found or missing issuer/resource' });
    }

    const orgTokenEndpoint = `${ORG()}/oauth2/v1/token`;
    const authServerTokenEndpoint = `${connection.authorizationServer.issuerUrl}/v1/token`;
    const callerCred: okta.AgentTestCredential = caller.testPrivateKeyPem && caller.testPrivateKeyKid
      ? { privateKeyPem: caller.testPrivateKeyPem, privateKeyKid: caller.testPrivateKeyKid }
      : { clientSecret: caller.testClientSecret! };

    // Unlike the a2a hop, a Custom AS exchange must NOT send `resource` — confirmed live, Okta
    // rejects it with invalid_target ("'resource' is invalid or not supported") for this
    // connection type; `audience` alone (the AS's own issuer) is enough to identify the target.
    const step2 = await okta.runIdJagExchange(
      orgTokenEndpoint, caller.oktaAgentId, callerCred, result.rawToken,
      undefined, connection.authorizationServer.issuerUrl, result.rawTokenType
    );
    if (!step2.ok || !step2.accessToken) return res.json({ step2, step3: null });

    const step3 = await okta.runJwtBearerRedemption(authServerTokenEndpoint, caller.oktaAgentId, callerCred, step2.accessToken);
    res.json({ step2, step3 });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
