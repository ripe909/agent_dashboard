import { Router, Request, Response } from 'express';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { execFile } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { store } from '../db/client';
import * as okta from '../services/okta';

const router = Router();

const ORG = () => process.env.OKTA_ORG_URL!;
const BACKEND_PUBLIC_URL = () => process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`;
const FRONTEND_URL = () => process.env.FRONTEND_URL || 'http://localhost:3000';

// Lets a test session log in with either the full scope set or a deliberately narrowed one, so an
// agent's behavior under reduced privilege can be exercised without touching its real Okta
// connection — the scope choice rides through login → the XAA exchange, since login itself
// (a plain OIDC code flow against the agent's own app) carries no scopes; only the id-jag exchange
// that follows does.
type ScopeMode = 'readonly' | 'full';
const SCOPES_BY_MODE: Record<ScopeMode, string> = {
  readonly: 'api.read api.search',
  full: 'api.read api.search api.create api.update api.delete',
};
function isScopeMode(value: unknown): value is ScopeMode {
  return value === 'readonly' || value === 'full';
}

// ── Per-agent login (User Access) ────────────────────────────────────────────
// Chat's subject token has to be an id_token issued by the SELECTED AGENT'S OWN backing app —
// not the dashboard's own NextAuth login app, which Okta rejects with "the client application is
// not registered for delegation to this agent" since it was never linked as a delegation caller.
// Logging in directly against the agent's own app needs no such registration (self-authorized),
// same reasoning as the Exercise page's real User Access flow in exercise.ts, whose pattern this
// mirrors (separate in-memory maps here rather than importing exercise.ts's, since those are
// private to that file's stepwise-click flow).
const pendingLogins = new Map<string, { codeVerifier: string; agentId: string; clientId: string; clientSecret: string; scopeMode: ScopeMode; createdAt: number }>();
interface ChatSession {
  agentId: string; idToken: string; scopeMode: ScopeMode; createdAt: number;
  campaignsAccessToken?: string; campaignsTokenExpiresAt?: number;
}
const chatSessions = new Map<string, ChatSession>();

function pruneExpired<T extends { createdAt: number }>(map: Map<string, T>, maxAgeMs: number) {
  const now = Date.now();
  for (const [key, value] of map) {
    if (now - value.createdAt > maxAgeMs) map.delete(key);
  }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Runs `fn` over `items` with at most `limit` in flight at once — checking every onboarded agent's
// connections for /eligible-agents below used to fire all of them via a single Promise.all, which
// (confirmed live) burns through Okta's per-endpoint rate limit (x-rate-limit-limit: 100 on
// /ai-agents/{id}/connections) in one burst on any org with a few dozen agents, 429-ing most of
// the batch — listAgentConnections silently treats a 429 as "no connections", so the whole picker
// would intermittently come back empty. A small concurrency cap keeps every request under budget.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Short-lived cache — connection state changes rarely (only when someone edits a resource
// connection), so it's safe to reuse the last result for a few seconds instead of re-querying
// Okta for every onboarded agent on every picker open.
let eligibleAgentsCache: { value: any[]; expiresAt: number } | null = null;

function hasDirectCampaignsConnection(connections: okta.AgentConnection[], campaignsIssuer: string): boolean {
  return connections.some(
    (c) => c.connectionType === 'IDENTITY_ASSERTION_CUSTOM_AS' && c.status === 'ACTIVE' && c.authorizationServer?.issuerUrl === campaignsIssuer
  );
}

// GET /api/chat/eligible-agents — an agent can chat if it EITHER has a direct ACTIVE Custom AS
// connection to the configured Campaigns authorization server, OR has an ACTIVE agent-to-agent
// (A2A) connection to some other onboarded agent that itself has that direct connection — in the
// second case the primary agent asks the secondary one to perform the MCP action on its behalf
// (see resolveCampaignsAccessPath below, used by /:agentId/message). One connections fetch per
// onboarded agent either way — no extra Okta calls for the A2A check, it's computed in-memory
// from the same pass.
router.get('/eligible-agents', async (_req: Request, res: Response) => {
  try {
    if (eligibleAgentsCache && eligibleAgentsCache.expiresAt > Date.now()) {
      return res.json(eligibleAgentsCache.value);
    }

    const settings = await store.getSettings();
    if (!settings.campaignsAuthorizationServerId) return res.json([]);
    const campaignsAS = await okta.getAuthorizationServer(settings.campaignsAuthorizationServerId);
    if (!campaignsAS.issuer) return res.json([]);

    const all = await store.listAgents();
    const withAgentId = all.filter((a) => a.oktaAgentId);
    const connectionsByOktaId = new Map<string, okta.AgentConnection[]>();
    await mapWithConcurrency(withAgentId, 5, async (a) => {
      const connections = await okta.listAgentConnections(a.oktaAgentId!).catch(() => []);
      connectionsByOktaId.set(a.oktaAgentId!, connections);
    });

    const directOktaIds = new Set(
      withAgentId.filter((a) => hasDirectCampaignsConnection(connectionsByOktaId.get(a.oktaAgentId!) || [], campaignsAS.issuer!)).map((a) => a.oktaAgentId!)
    );

    const eligible = withAgentId.filter((a) => {
      if (directOktaIds.has(a.oktaAgentId!)) return true;
      const connections = connectionsByOktaId.get(a.oktaAgentId!) || [];
      return connections.some((c) => {
        if (c.connectionType !== 'IDENTITY_ASSERTION_A2A_SERVER' || c.status !== 'ACTIVE') return false;
        const targetOktaId = c.resource?.orn?.split(':').pop();
        return !!targetOktaId && directOktaIds.has(targetOktaId);
      });
    });

    const result = eligible.map((a) => ({ id: a.id, name: a.name, description: a.description }));
    eligibleAgentsCache = { value: result, expiresAt: Date.now() + 30_000 };
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/chat/:agentId/login/start — body { scopeMode: 'readonly' | 'full' }
router.post('/:agentId/login/start', async (req: Request, res: Response) => {
  try {
    const scopeMode = req.body?.scopeMode;
    if (!isScopeMode(scopeMode)) return res.status(400).json({ error: "scopeMode must be 'readonly' or 'full'" });

    const agent = await store.findAgentById(req.params.agentId);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });

    const appId = await okta.ensureUserAccess(agent.oktaAgentId);
    const redirectUri = `${BACKEND_PUBLIC_URL()}/api/chat/login/callback`;
    const { clientId, clientSecret } = await okta.setAppAuthMethodAndRedirect(appId, redirectUri);

    pruneExpired(pendingLogins, 10 * 60 * 1000);
    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
    const state = randomUUID();
    pendingLogins.set(state, { codeVerifier, agentId: agent.id, clientId, clientSecret, scopeMode, createdAt: Date.now() });

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

// GET /api/chat/login/callback — Okta redirects here after login
router.get('/login/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query as Record<string, string>;
  const redirectUri = `${BACKEND_PUBLIC_URL()}/api/chat/login/callback`;

  if (error) {
    return res.redirect(`${FRONTEND_URL()}/chat?loginError=${encodeURIComponent(error_description || error)}`);
  }
  const pending = state ? pendingLogins.get(state) : undefined;
  if (!pending || !code) {
    return res.redirect(`${FRONTEND_URL()}/chat?loginError=${encodeURIComponent('Login session expired or invalid — please try again')}`);
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
    if (!tokenRes.ok || !body.id_token) {
      return res.redirect(`${FRONTEND_URL()}/chat?loginError=${encodeURIComponent(body.error_description || body.error || 'Token exchange failed')}`);
    }

    pruneExpired(chatSessions, 60 * 60 * 1000);
    const rid = randomUUID();
    chatSessions.set(rid, { agentId: pending.agentId, idToken: body.id_token, scopeMode: pending.scopeMode, createdAt: Date.now() });
    res.redirect(`${FRONTEND_URL()}/chat?loginResult=${rid}&agentId=${pending.agentId}&scopeMode=${pending.scopeMode}`);
  } catch (e: any) {
    res.redirect(`${FRONTEND_URL()}/chat?loginError=${encodeURIComponent(e.message)}`);
  }
});

function resolveCallerCred(agent: { testClientSecret: string | null; testPrivateKeyPem: string | null; testPrivateKeyKid: string | null }): okta.AgentTestCredential {
  return agent.testPrivateKeyPem && agent.testPrivateKeyKid
    ? { privateKeyPem: agent.testPrivateKeyPem, privateKeyKid: agent.testPrivateKeyKid }
    : { clientSecret: agent.testClientSecret! };
}

// Onboarded agents don't automatically get a persisted testClientSecret/testPrivateKeyPem — only
// the Exercise page's real User Access login flow does that today. Lazily provision one here the
// first time an agent is used in chat, using the same app-backed-vs-native detection routes.ts's
// credential endpoints already rely on (oktaAgent.appId truthy => app-backed).
async function ensureCallerCredential(agent: NonNullable<Awaited<ReturnType<typeof store.findAgentById>>>) {
  if (agent.testPrivateKeyPem && agent.testPrivateKeyKid) return resolveCallerCred(agent);
  if (agent.testClientSecret) return resolveCallerCred(agent);

  const oktaAgent = await okta.getAIAgent(agent.oktaAgentId!);
  let clientSecret: string;
  if (oktaAgent.appId) {
    const rotated = await okta.rotateAppSecret(oktaAgent.appId);
    clientSecret = rotated.clientSecret;
  } else {
    const created = await okta.createAgentSecret(agent.oktaAgentId!);
    clientSecret = created.clientSecret;
  }
  await store.updateAgentById(agent.id, { testClientSecret: clientSecret });
  return { clientSecret };
}

type DashboardAgent = NonNullable<Awaited<ReturnType<typeof store.findAgentById>>>;

type CampaignsAccessPath =
  | { kind: 'direct' }
  | { kind: 'via-agent'; a2aConnection: okta.AgentConnection; secondaryAgent: DashboardAgent };

// Resolves how `agent` can reach the Campaigns MCP server: either it has a direct connection
// (today's only path), or it has an ACTIVE agent-to-agent connection to some other onboarded
// agent that itself has the direct connection — in which case the primary agent delegates to that
// secondary agent, same one-hop-deep pattern exercise.ts's A2A branch already proves out. Returns
// null if neither applies.
async function resolveCampaignsAccessPath(agent: DashboardAgent, campaignsIssuer: string): Promise<CampaignsAccessPath | null> {
  const connections = await okta.listAgentConnections(agent.oktaAgentId!);
  if (hasDirectCampaignsConnection(connections, campaignsIssuer)) return { kind: 'direct' };

  for (const c of connections) {
    if (c.connectionType !== 'IDENTITY_ASSERTION_A2A_SERVER' || c.status !== 'ACTIVE') continue;
    const targetOktaId = c.resource?.orn?.split(':').pop();
    if (!targetOktaId) continue;
    const secondaryAgent = await store.findAgentByOktaId(targetOktaId);
    if (!secondaryAgent?.oktaAgentId) continue;
    const secondaryConnections = await okta.listAgentConnections(secondaryAgent.oktaAgentId).catch(() => []);
    if (hasDirectCampaignsConnection(secondaryConnections, campaignsIssuer)) {
      return { kind: 'via-agent', a2aConnection: c, secondaryAgent };
    }
  }
  return null;
}

interface ChatMessage { role: 'user' | 'assistant'; content: string; }
interface ToolCallRecord { name: string; args: any; result: any; }

// Same auth pattern as the reference app's scripts/llm-proxy.js: the corporate LiteLLM endpoint
// takes a short-lived token minted by `ocm auth litellm`, not a static API key — ocm caches/
// refreshes it internally, so calling it per-request is cheap. This backend runs natively (no
// Docker container boundary to cross), so it calls ocm directly instead of going through a proxy.
function getLiteLLMToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('ocm', ['auth', 'litellm', '--key-type', 'llm_api'], (err, stdout, stderr) => {
      if (err) { reject(new Error(stderr?.trim() || err.message)); return; }
      resolve(stdout.trim());
    });
  });
}

async function callLlm(messages: any[], tools: any[]): Promise<any> {
  const baseUrl = (process.env.LLM_BASE_URL || 'https://llm.atko.ai/').replace(/\/$/, '');
  const token = await getLiteLLMToken();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
      temperature: process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : 0.7,
      max_tokens: process.env.LLM_MAX_TOKENS ? parseInt(process.env.LLM_MAX_TOKENS, 10) : 1000,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    }),
  });
  const data = await res.json() as any;
  if (!res.ok) throw new Error(data.error?.message || `LLM request failed: ${res.status}`);
  return data.choices[0].message;
}

// POST /api/chat/:agentId/message — loginRid identifies a completed per-agent login (see
// /login/start and /login/callback above); the id_token itself never leaves the backend.
router.post('/:agentId/message', async (req: Request, res: Response) => {
  const { loginRid, message, history } = req.body as { loginRid: string; message: string; history?: ChatMessage[] };
  if (!loginRid || !message) return res.status(400).json({ error: 'loginRid and message are required' });

  try {
    const session = chatSessions.get(loginRid);
    if (!session || session.agentId !== req.params.agentId) {
      return res.status(401).json({ error: 'Not logged in for this agent — please log in first', requiresLogin: true });
    }
    const subjectIdToken = session.idToken;

    const agent = await store.findAgentById(req.params.agentId);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });

    const settings = await store.getSettings();
    if (!settings.campaignsAuthorizationServerId) {
      return res.status(400).json({ error: 'Configure the Campaigns authorization server in Settings first' });
    }
    const campaignsAS = await okta.getAuthorizationServer(settings.campaignsAuthorizationServerId);
    if (!campaignsAS.issuer) return res.status(500).json({ error: 'Could not resolve the campaigns authorization server issuer' });

    // Reuse the campaigns access token across turns of the same login session instead of
    // re-running the full XAA chain (exchange + redemption) on every message — it's only
    // re-minted once it's actually expired (with a small safety margin).
    let accessToken = session.campaignsAccessToken;
    const isExpired = !session.campaignsTokenExpiresAt || Date.now() > session.campaignsTokenExpiresAt - 30_000;
    if (!accessToken || isExpired) {
      const path = await resolveCampaignsAccessPath(agent, campaignsAS.issuer);
      if (!path) {
        return res.status(400).json({ error: 'This agent has no connection to the Campaigns authorization server, directly or through another agent — configure one from the Resources tab first' });
      }

      let finalAccessToken: string;
      if (path.kind === 'direct') {
        const callerCred = await ensureCallerCredential(agent);

        const exchange = await okta.runIdJagExchange(
          `${ORG()}/oauth2/v1/token`, agent.oktaAgentId, callerCred, subjectIdToken,
          undefined, campaignsAS.issuer, 'urn:ietf:params:oauth:token-type:id_token', SCOPES_BY_MODE[session.scopeMode]
        );
        if (!exchange.ok || !exchange.accessToken) return res.status(400).json({ error: exchange.raw?.error_description || exchange.raw?.error || 'Token exchange failed', step: exchange });

        const redemption = await okta.runJwtBearerRedemption(`${campaignsAS.issuer}/v1/token`, agent.oktaAgentId, callerCred, exchange.accessToken);
        if (!redemption.ok || !redemption.accessToken) return res.status(400).json({ error: redemption.raw?.error_description || redemption.raw?.error || 'Token redemption failed', step: redemption });

        finalAccessToken = redemption.accessToken;
        session.campaignsTokenExpiresAt = typeof redemption.decoded?.payload?.exp === 'number' ? redemption.decoded.payload.exp * 1000 : Date.now() + 60 * 60 * 1000;
      } else {
        // Hop 1 — primary agent delegates the human's identity to the secondary agent's own
        // resource (agent.invoke, the same default scope Exercise's own A2A hop uses).
        const primaryCred = await ensureCallerCredential(agent);
        const hop1Exchange = await okta.runIdJagExchange(
          `${ORG()}/oauth2/v1/token`, agent.oktaAgentId, primaryCred, subjectIdToken,
          path.a2aConnection.resourceIndicator, path.a2aConnection.authorizationServer!.issuerUrl, 'urn:ietf:params:oauth:token-type:id_token'
        );
        if (!hop1Exchange.ok || !hop1Exchange.accessToken) return res.status(400).json({ error: hop1Exchange.raw?.error_description || hop1Exchange.raw?.error || 'Delegation exchange failed', step: hop1Exchange });

        const hop1Redemption = await okta.runJwtBearerRedemption(`${path.a2aConnection.authorizationServer!.issuerUrl}/v1/token`, agent.oktaAgentId, primaryCred, hop1Exchange.accessToken);
        if (!hop1Redemption.ok || !hop1Redemption.accessToken) return res.status(400).json({ error: hop1Redemption.raw?.error_description || hop1Redemption.raw?.error || 'Delegation redemption failed', step: hop1Redemption });

        // Hop 2 — secondary agent, now authenticating as itself, redeems the hop-1 token for the
        // real Campaigns access token on the primary's behalf.
        const secondaryCred = await ensureCallerCredential(path.secondaryAgent);
        const hop2Exchange = await okta.runIdJagExchange(
          `${ORG()}/oauth2/v1/token`, path.secondaryAgent.oktaAgentId!, secondaryCred, hop1Redemption.accessToken,
          undefined, campaignsAS.issuer, 'urn:ietf:params:oauth:token-type:access_token', SCOPES_BY_MODE[session.scopeMode]
        );
        if (!hop2Exchange.ok || !hop2Exchange.accessToken) return res.status(400).json({ error: hop2Exchange.raw?.error_description || hop2Exchange.raw?.error || 'Token exchange failed', step: hop2Exchange });

        const hop2Redemption = await okta.runJwtBearerRedemption(`${campaignsAS.issuer}/v1/token`, path.secondaryAgent.oktaAgentId!, secondaryCred, hop2Exchange.accessToken);
        if (!hop2Redemption.ok || !hop2Redemption.accessToken) return res.status(400).json({ error: hop2Redemption.raw?.error_description || hop2Redemption.raw?.error || 'Token redemption failed', step: hop2Redemption });

        finalAccessToken = hop2Redemption.accessToken;
        session.campaignsTokenExpiresAt = typeof hop2Redemption.decoded?.payload?.exp === 'number' ? hop2Redemption.decoded.payload.exp * 1000 : Date.now() + 60 * 60 * 1000;
      }

      accessToken = finalAccessToken;
      session.campaignsAccessToken = accessToken;
    }

    const transport = new StreamableHTTPClientTransport(new URL(`${BACKEND_PUBLIC_URL()}/mcp/campaigns`), {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}`, 'x-campaigns-issuer': campaignsAS.issuer } },
    });
    const mcpClient = new Client({ name: 'agent-dashboard-chat', version: '1.0.0' });
    await mcpClient.connect(transport);

    try {
      const { tools: mcpTools } = await mcpClient.listTools();
      const openAiTools = mcpTools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));

      const messages: any[] = [
        { role: 'system', content: `You are a helpful assistant that manages marketing campaigns via the available tools. Use tools to create, search, read, update, and delete campaigns. Never fabricate campaign data — always use a tool to look it up first.

CRITICAL FORMATTING RULE: The chat UI automatically renders a visual card for every campaign object a tool call returns (with its name, status, description, budget, and dates). Your text reply is shown ABOVE those cards, so you must NEVER repeat any campaign field — no name, status, budget, dates, description, ID, list, bullet points, or table — anywhere in your reply. This applies even when listing multiple campaigns. Your reply must be ONLY a short conversational sentence with no campaign data in it, for example: "Here's your current campaign." or "Found 3 campaigns — take a look below." or "Done, I've created that campaign." or "Updated." Nothing else.`.trim() },
        ...(history || []).map((h) => ({ role: h.role, content: h.content })),
        { role: 'user', content: message },
      ];

      const toolCalls: ToolCallRecord[] = [];
      const MAX_ITERATIONS = 5;
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const response = await callLlm(messages, openAiTools);
        messages.push(response);

        if (!response.tool_calls || response.tool_calls.length === 0) {
          return res.json({ reply: response.content || 'I was unable to generate a response.', toolCalls });
        }

        for (const call of response.tool_calls) {
          const args = JSON.parse(call.function.arguments || '{}');
          let result: any;
          try {
            result = await mcpClient.callTool({ name: call.function.name, arguments: args });
          } catch (e: any) {
            result = { isError: true, content: [{ type: 'text', text: e.message }] };
          }
          toolCalls.push({ name: call.function.name, args, result });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
      }

      res.json({ reply: 'I was unable to complete your request after multiple attempts. Please try again.', toolCalls });
    } finally {
      await mcpClient.close();
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
