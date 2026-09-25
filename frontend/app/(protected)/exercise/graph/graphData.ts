const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export interface AgentOption { id: string; name: string; oktaAgentId?: string; }

// ── Node/edge shapes ──────────────────────────────────────────────────────────
// Plain data objects (no React Flow types here) — ExerciseGraph.tsx converts these into
// React Flow Node/Edge objects once dagre has computed positions.

export interface AgentNodeData { kind: 'agent'; dashboardId: string; oktaAgentId?: string; name: string; }
// isMachineOrigin marks the app that IS the configured service client (Settings > Service Client)
// — the same identity that performs the initial client_credentials grant, so rather than showing a
// separate synthetic "Machine access" node, this app node itself becomes the clickable start point.
// Which agent the grant is scoped to is derived from this node's outgoing edge at click time
// (ExerciseGraph.tsx), not stored here — the same app can be a caller for more than one agent.
export interface AppNodeData { kind: 'app'; oktaAppId: string; name: string; isMachineOrigin?: boolean; }
export interface ResourceNodeData {
  kind: 'resource'; connectionId: string; name: string;
  resourceTypeId: 'auth_server' | 'secret' | 'service_account' | 'application' | 'mcp_server';
  sub?: string; scopeCount?: number;
}
// User Access has no distinct app-caller identity in this codebase's model (it's the agent's own
// backing OIDC client, not a delegation-link caller) so it still needs a synthetic origin node —
// unlike Machine Access, which is now represented by the real service-client app node instead.
export interface OriginNodeData { kind: 'origin'; originKind: 'user'; agentDashboardId: string; label: string; }

export type GraphNodeData = AgentNodeData | AppNodeData | ResourceNodeData | OriginNodeData;
export interface GraphNode { id: string; data: GraphNodeData; }
export interface GraphEdge { id: string; source: string; target: string; label?: string; }

function agentNodeId(dashboardId: string) { return `agent:${dashboardId}`; }
function appNodeId(oktaAppId: string) { return `app:${oktaAppId}`; }
function resourceNodeId(connectionId: string) { return `resource:${connectionId}`; }
function originNodeId(agentDashboardId: string) { return `origin:user:${agentDashboardId}`; }

// Connection types that terminate the chain (everything except agent-to-agent, which instead
// produces an 'agent' node via delegations-from) — mirrors CONNECTION_TYPES minus A2A_SERVER,
// mapped to the same resource-type grouping ResourcePicker.tsx already defines for its own picker.
function resourceTypeIdFor(connectionType: string): ResourceNodeData['resourceTypeId'] | null {
  switch (connectionType) {
    case 'IDENTITY_ASSERTION_CUSTOM_AS': return 'auth_server';
    case 'STS_VAULT_SECRET': return 'secret';
    case 'STS_SERVICE_ACCOUNT': return 'service_account';
    case 'STS_ACCESS_TOKEN':
    case 'IDENTITY_ASSERTION_APP_INSTANCE': return 'application';
    case 'IDENTITY_ASSERTION_VIRTUAL_MCP_SERVER': return 'mcp_server';
    default: return null;
  }
}

function connectionName(c: any): string {
  if (c.authorizationServer?.name) return c.authorizationServer.name;
  if (c.resource?.appInstanceName) return c.resource.appInstanceName;
  if (c.resource?.name) return c.resource.name;
  if (c.resource?.clientAuthSettings?.name) return c.resource.clientAuthSettings.name;
  return c.connectionType;
}

interface Neighbors { nodes: GraphNode[]; edges: GraphEdge[]; }

// Fetches everything one hop away from `dashboardAgentId` in both directions: who can call it
// (delegations — agents and apps), what it can call (delegations-from — other agents), and what
// non-agent resources it's connected to (connections, filtered to terminal types). Callers are
// resolved by okta id where possible; delegations-from resolves Okta ids back to dashboard ids via
// the already-fetched `agents` list, matching what AgentExerciseStep.tsx already does inline.
export async function fetchNeighbors(dashboardAgentId: string, agents: AgentOption[]): Promise<Neighbors> {
  const self = agents.find((a) => a.id === dashboardAgentId);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const [agentDetail, callers, downstream, connections, settings] = await Promise.all([
    fetch(`${BACKEND}/api/agents/${dashboardAgentId}`).then((r) => r.json()).catch(() => null),
    fetch(`${BACKEND}/api/agents/${dashboardAgentId}/delegations`).then((r) => r.json()).catch(() => []),
    fetch(`${BACKEND}/api/agents/${dashboardAgentId}/delegations-from`).then((r) => r.json()).catch(() => []),
    fetch(`${BACKEND}/api/agents/${dashboardAgentId}/connections`).then((r) => r.json()).catch(() => []),
    fetch(`${BACKEND}/api/settings`).then((r) => r.json()).catch(() => null),
  ]);
  const serviceClientId: string | null = settings?.serviceClientId ?? null;

  const selfNodeId = agentNodeId(dashboardAgentId);

  // Callers feeding in from the left (Machine Access — agents and apps already authorized).
  if (Array.isArray(callers)) {
    for (const c of callers) {
      if (!c.callerAgentId) continue;
      if (c.callerType === 'app') {
        const id = appNodeId(c.callerAgentId);
        const isMachineOrigin = !!serviceClientId && c.callerAgentId === serviceClientId;
        nodes.push({ id, data: { kind: 'app', oktaAppId: c.callerAgentId, name: c.callerName || 'App', isMachineOrigin } });
        edges.push({ id: `e:${id}->${selfNodeId}`, source: id, target: selfNodeId, label: 'Machine access' });
      } else {
        const callerAgent = agents.find((a) => a.oktaAgentId === c.callerAgentId);
        const id = agentNodeId(callerAgent?.id || c.callerAgentId);
        nodes.push({
          id,
          data: { kind: 'agent', dashboardId: callerAgent?.id || c.callerAgentId, oktaAgentId: c.callerAgentId, name: c.callerName || callerAgent?.name || 'Agent' },
        });
        edges.push({ id: `e:${id}->${selfNodeId}`, source: id, target: selfNodeId, label: 'Machine access' });
      }
    }
  }

  // Real user login is a distinct entry point in this codebase's model (the agent's own backing
  // OIDC client, not a delegation-link caller) — synthesize a single origin node for it when enabled.
  if (agentDetail?.userAccessEnabled) {
    const id = originNodeId(dashboardAgentId);
    nodes.push({ id, data: { kind: 'origin', originKind: 'user', agentDashboardId: dashboardAgentId, label: 'User login' } });
    edges.push({ id: `e:${id}->${selfNodeId}`, source: id, target: selfNodeId, label: 'User access' });
  }

  // Downstream agents fanning out to the right.
  if (Array.isArray(downstream)) {
    for (const d of downstream) {
      const targetAgent = agents.find((a) => a.oktaAgentId === d.targetAgentId);
      const id = agentNodeId(targetAgent?.id || d.targetAgentId);
      nodes.push({
        id,
        data: { kind: 'agent', dashboardId: targetAgent?.id || d.targetAgentId, oktaAgentId: d.targetAgentId, name: d.targetName || targetAgent?.name || 'Agent' },
      });
      edges.push({ id: `e:${selfNodeId}->${id}`, source: selfNodeId, target: id, label: 'Machine access' });
    }
  }

  // Terminal resources (Custom AS, MCP server, vault secret, service account, app instance) —
  // agent-to-agent connections are skipped here since delegations-from already covers those.
  if (Array.isArray(connections)) {
    for (const c of connections) {
      const resourceTypeId = resourceTypeIdFor(c.connectionType);
      if (!resourceTypeId) continue;
      const id = resourceNodeId(c.id);
      nodes.push({
        id,
        data: {
          kind: 'resource', connectionId: c.id, name: connectionName(c), resourceTypeId,
          sub: c.authorizationServer?.name && resourceTypeId !== 'auth_server' ? `via ${c.authorizationServer.name}` : undefined,
          scopeCount: Array.isArray(c.scopes) && !c.scopes.includes('*') ? c.scopes.length : undefined,
        },
      });
      const label = c.scopes && Array.isArray(c.scopes) && !c.scopes.includes('*') ? `${c.scopes.length} scopes` : undefined;
      edges.push({ id: `e:${selfNodeId}->${id}`, source: selfNodeId, target: id, label });
    }
  }

  // Ensure the center node itself is present even if it has no neighbors yet.
  if (!nodes.some((n) => n.id === selfNodeId)) {
    nodes.push({ id: selfNodeId, data: { kind: 'agent', dashboardId: dashboardAgentId, oktaAgentId: self?.oktaAgentId, name: self?.name || 'Agent' } });
  }

  return { nodes, edges };
}

export { agentNodeId, appNodeId, resourceNodeId, originNodeId };
