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
const CAMPAIGNS_SCOPES = 'api.read api.search api.create api.update api.delete';

// ── Per-agent login (User Access) ────────────────────────────────────────────
// Chat's subject token has to be an id_token issued by the SELECTED AGENT'S OWN backing app —
// not the dashboard's own NextAuth login app, which Okta rejects with "the client application is
// not registered for delegation to this agent" since it was never linked as a delegation caller.
// Logging in directly against the agent's own app needs no such registration (self-authorized),
// same reasoning as the Exercise page's real User Access flow in exercise.ts, whose pattern this
// mirrors (separate in-memory maps here rather than importing exercise.ts's, since those are
// private to that file's stepwise-click flow).
const pendingLogins = new Map<string, { codeVerifier: string; agentId: string; clientId: string; clientSecret: string; createdAt: number }>();
interface ChatSession {
  agentId: string; idToken: string; createdAt: number;
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

// POST /api/chat/:agentId/login/start
router.post('/:agentId/login/start', async (req: Request, res: Response) => {
  try {
    const agent = await store.findAgentById(req.params.agentId);
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });

    const appId = await okta.ensureUserAccess(agent.oktaAgentId);
    const redirectUri = `${BACKEND_PUBLIC_URL()}/api/chat/login/callback`;
    const { clientId, clientSecret } = await okta.setAppAuthMethodAndRedirect(appId, redirectUri);

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
    chatSessions.set(rid, { agentId: pending.agentId, idToken: body.id_token, createdAt: Date.now() });
    res.redirect(`${FRONTEND_URL()}/chat?loginResult=${rid}&agentId=${pending.agentId}`);
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
      const connections = await okta.listAgentConnections(agent.oktaAgentId);
      const connection = connections.find(
        (c) => c.connectionType === 'IDENTITY_ASSERTION_CUSTOM_AS' && c.authorizationServer?.issuerUrl === campaignsAS.issuer
      );
      if (!connection) {
        return res.status(400).json({ error: 'This agent is not connected to the Campaigns authorization server — configure it from the Resources tab first' });
      }

      const callerCred = await ensureCallerCredential(agent);

      const exchange = await okta.runIdJagExchange(
        `${ORG()}/oauth2/v1/token`, agent.oktaAgentId, callerCred, subjectIdToken,
        undefined, campaignsAS.issuer, 'urn:ietf:params:oauth:token-type:id_token', CAMPAIGNS_SCOPES
      );
      if (!exchange.ok || !exchange.accessToken) return res.status(400).json({ error: exchange.raw?.error_description || exchange.raw?.error || 'Token exchange failed', step: exchange });

      const redemption = await okta.runJwtBearerRedemption(`${campaignsAS.issuer}/v1/token`, agent.oktaAgentId, callerCred, exchange.accessToken);
      if (!redemption.ok || !redemption.accessToken) return res.status(400).json({ error: redemption.raw?.error_description || redemption.raw?.error || 'Token redemption failed', step: redemption });

      accessToken = redemption.accessToken;
      const expClaim = redemption.decoded?.payload?.exp;
      session.campaignsAccessToken = accessToken;
      session.campaignsTokenExpiresAt = typeof expClaim === 'number' ? expClaim * 1000 : Date.now() + 60 * 60 * 1000;
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
