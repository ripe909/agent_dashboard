'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, type Node, type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { RefreshCw, Maximize2 } from 'lucide-react';
import AgentPicker from '@/components/AgentPicker';
import type { TokenResult } from '@/components/TokenStepCard';
import TokenInspectorPanel, { type TokenInspectorTarget } from '@/components/TokenInspectorPanel';
import {
  fetchNeighbors, agentNodeId,
  type AgentOption, type GraphNode, type GraphEdge, type GraphNodeData, type AgentNodeData, type AppNodeData, type OriginNodeData,
} from './graphData';
import { usePathRunner } from './usePathRunner';
import AgentNode from './nodes/AgentNode';
import AppNode from './nodes/AppNode';
import ResourceNode from './nodes/ResourceNode';
import OriginNode from './nodes/OriginNode';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

const NODE_TYPES = { agent: AgentNode, app: AppNode, resource: ResourceNode, origin: OriginNode };
const NODE_WIDTH = 224;
const NODE_HEIGHT = 56;

interface LayoutedNode { id: string; type: string; position: { x: number; y: number }; data: GraphNodeData; }

function layout(nodes: GraphNode[], edges: GraphEdge[]): LayoutedNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 96 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { id: n.id, type: n.data.kind, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 }, data: n.data };
  });
}

export default function ExerciseGraph({ agents }: { agents: AgentOption[] }) {
  return (
    <ReactFlowProvider>
      <ExerciseGraphInner agents={agents} />
    </ReactFlowProvider>
  );
}

function ExerciseGraphInner({ agents }: { agents: AgentOption[] }) {
  const [centerAgentId, setCenterAgentId] = useState('');
  const [rawNodes, setRawNodes] = useState<GraphNode[]>([]);
  const [rawEdges, setRawEdges] = useState<GraphEdge[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandingId, setExpandingId] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const seenNodeIds = useRef<Set<string>>(new Set());

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [inspecting, setInspecting] = useState<TokenInspectorTarget | null>(null);

  const runner = usePathRunner();
  const router = useRouter();
  const searchParams = useSearchParams();

  // pathNodeIds[i] is the node steps[i]'s token belongs to — a node can now accumulate more than
  // one hop (e.g. the caller in a split exchange/redeem gets both its arrival token and its
  // outgoing exchange's id-jag), so this groups rather than overwriting by node id.
  const hopByNodeId = useMemo(() => {
    const map = new Map<string, (typeof runner.steps)>();
    runner.pathNodeIds.forEach((nodeId, i) => {
      if (!runner.steps[i]) return;
      const existing = map.get(nodeId) || [];
      map.set(nodeId, [...existing, runner.steps[i]]);
    });
    return map;
  }, [runner.pathNodeIds, runner.steps]);

  function inspectToken(mode: 'request' | 'response', label: string, step: TokenResult) {
    setInspecting({ mode, label, step });
  }

  // Resolves a graph node into the {kind, id, label} shape runExchange needs. Accepts an explicit
  // node list (rather than always reading rawNodes state) so a caller that just merged in fresh
  // nodes via expandAgent's return value can resolve against them before React re-renders.
  function resolveHopTarget(nodeId: string, nodes: GraphNode[] = rawNodes): { kind: 'agent' | 'authserver'; id: string; label: string } | null {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    if (node.data.kind === 'agent') return { kind: 'agent', id: node.data.dashboardId, label: node.data.name };
    if (node.data.kind === 'resource') return { kind: 'authserver', id: node.data.connectionId, label: node.data.name };
    return null;
  }

  // A node's own next-hop target, resolved only when it has EXACTLY one outgoing edge — clicking
  // the node itself (or auto-chaining after a redeem lands on it) only fires its exchange when
  // there's no ambiguity about where it's headed. 0 or 2+ edges means the click does nothing
  // (0: nothing to expand into; 2+: not implemented — would need disambiguation). Same explicit-
  // override reasoning as resolveHopTarget above.
  function soleDownstream(
    nodeId: string, edges: GraphEdge[] = rawEdges, nodes: GraphNode[] = rawNodes
  ): { nodeId: string; kind: 'agent' | 'authserver'; id: string; label: string } | null {
    const outgoing = edges.filter((e) => e.source === nodeId);
    if (outgoing.length !== 1) return null;
    const target = resolveHopTarget(outgoing[0].target, nodes);
    return target ? { nodeId: outgoing[0].target, ...target } : null;
  }

  const mergeGraph = useCallback((newNodes: GraphNode[], newEdges: GraphEdge[]) => {
    setRawNodes((prev) => {
      const ids = new Set(prev.map((n) => n.id));
      return [...prev, ...newNodes.filter((n) => !ids.has(n.id))];
    });
    setRawEdges((prev) => {
      const ids = new Set(prev.map((e) => e.id));
      return [...prev, ...newEdges.filter((e) => !ids.has(e.id))];
    });
  }, []);

  // Recursively fetches neighbors for `dashboardId` and every downstream agent node it leads to
  // (breadth-first, skipping ids already visited so cycles/diamonds don't loop forever), so the
  // whole reachable tree renders expanded from the start instead of requiring a click on every
  // intermediate agent. Returns the fully merged node/edge lists and the set of agent node ids
  // that got expanded along the way.
  async function fetchFullTree(dashboardId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; expanded: Set<string> }> {
    const allNodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];
    const expanded = new Set<string>();
    const queue = [dashboardId];
    const seenAgentIds = new Set<string>([dashboardId]);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const { nodes: n, edges: e } = await fetchNeighbors(currentId, agents);
      const existingIds = new Set(allNodes.map((node) => node.id));
      allNodes.push(...n.filter((node) => !existingIds.has(node.id)));
      const existingEdgeIds = new Set(allEdges.map((edge) => edge.id));
      allEdges.push(...e.filter((edge) => !existingEdgeIds.has(edge.id)));
      expanded.add(agentNodeId(currentId));

      for (const node of n) {
        if (node.data.kind === 'agent' && !seenAgentIds.has(node.data.dashboardId)) {
          seenAgentIds.add(node.data.dashboardId);
          queue.push(node.data.dashboardId);
        }
      }
    }

    return { nodes: allNodes, edges: allEdges, expanded };
  }

  async function loadCenter(dashboardId: string) {
    setLoadingInitial(true);
    runner.reset();
    setExpandedIds(new Set());
    try {
      const { nodes: n, edges: e, expanded } = await fetchFullTree(dashboardId);
      setRawNodes(n);
      setRawEdges(e);
      setExpandedIds(expanded);
      setCenterAgentId(dashboardId);
    } finally {
      setLoadingInitial(false);
    }
  }

  // Returns the freshly-fetched nodes/edges directly (not just via setRawNodes/setRawEdges) — a
  // caller that needs to read them synchronously right after (e.g. handleNodeClick's
  // soleDownstream check) can't rely on rawNodes/rawEdges state, since awaiting the setState calls
  // above doesn't wait for React to actually re-render with the new value.
  async function expandAgent(agentDashboardId: string, nodeId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    setExpandingId(nodeId);
    try {
      const { nodes: n, edges: e } = await fetchNeighbors(agentDashboardId, agents);
      mergeGraph(n, e);
      setExpandedIds((prev) => new Set(prev).add(nodeId));
      return { nodes: n, edges: e };
    } finally {
      setExpandingId(null);
    }
  }

  async function expandAll() {
    const agentNodes = rawNodes.filter((n) => n.data.kind === 'agent' && !expandedIds.has(n.id));
    for (const n of agentNodes) {
      const data = n.data as AgentNodeData;
      await expandAgent(data.dashboardId, n.id);
    }
  }

  // Resume a User Access path after the real Okta login redirect lands back here — the redirect
  // is a full page navigation, so in-memory path state can't survive it; agentId round-trips
  // through the backend's result payload the same way UserAccessExercise.tsx already relies on.
  useEffect(() => {
    const resultRid = searchParams.get('result');
    const err = searchParams.get('error');
    if (err) { router.replace('/exercise'); return; }
    if (!resultRid) return;
    fetch(`${BACKEND}/api/exercise/agents/user-access/result/${resultRid}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error || !d.agentId) return;
        const { agentId: resultAgentId, ...decodedTokens } = d;
        loadCenter(resultAgentId).then(() => {
          const originId = `origin:user:${resultAgentId}`;
          runner.resumeFromLogin(resultRid, resultAgentId, originId, agentNodeId(resultAgentId), decodedTokens);
        });
      })
      .catch(() => {})
      .finally(() => router.replace('/exercise'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const layoutedNodes = useMemo(() => layout(rawNodes, rawEdges), [rawNodes, rawEdges]);

  // Before any click has happened (currentNodeId is still null), there's no real "current
  // position" yet — but the "start here" nodes (the service-client app, or a User Access origin)
  // are still the next thing to click, so their outgoing edges get the same highlight treatment
  // a real current node's edges get once the path is underway. Without this, the very first edge
  // (app → first agent) never highlights, since currentNodeId only becomes that agent AFTER the
  // click, by which point the edge's source no longer matches it.
  const highlightSources = useMemo(() => {
    if (runner.currentNodeId) return new Set([runner.currentNodeId]);
    const startNodeIds = rawNodes
      .filter((n) => n.data.kind === 'origin' || (n.data.kind === 'app' && n.data.isMachineOrigin))
      .map((n) => n.id);
    return new Set(startNodeIds);
  }, [runner.currentNodeId, rawNodes]);

  useEffect(() => {
    setNodes(
      layoutedNodes.map((n) => {
        const isAgent = n.data.kind === 'agent';
        const selected = n.id === runner.currentNodeId;
        return {
          ...n,
          data: {
            ...n.data,
            selected,
            onSelect: () => handleNodeClick(n),
            hops: hopByNodeId.get(n.id),
            onInspect: inspectToken,
            ...(isAgent ? { expanded: expandedIds.has(n.id), expanding: expandingId === n.id, onExpand: () => expandAgent((n.data as AgentNodeData).dashboardId, n.id) } : {}),
          },
        };
      })
    );
    setEdges(
      rawEdges.map((e) => ({
        id: e.id, source: e.source, target: e.target, label: e.label,
        animated: highlightSources.has(e.source),
        style: highlightSources.has(e.source) ? { stroke: '#1662dd', strokeWidth: 2 } : undefined,
        labelStyle: { fontSize: 11, fill: 'var(--text-secondary)' },
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutedNodes, rawEdges, expandedIds, expandingId, runner.currentNodeId, hopByNodeId, highlightSources]);

  // Click model (4 clicks for a 3-hop chain — service app, EC10, ET10, authz server):
  // 1. Click the "start here" node (app/origin) → gets the initial token, lands on the first agent.
  // 2. Click the current node itself → fires ITS OWN exchange toward its sole downstream (no
  //    picker — the node must have exactly one outgoing edge, since there's nothing to click to
  //    disambiguate otherwise).
  // 3. Click the pending exchange's target node → fires the redemption. If the node the path lands
  //    on ALSO has exactly one outgoing edge, immediately chain into that node's own exchange too
  //    (same click) — this is what makes ET10 show its own id-jag icon right after redeeming EC10's
  //    delegated token, without a separate click on ET10.
  // 4. Click the (now pending) final target → redeems the last hop; terminal nodes get no further
  //    chaining since soleDownstream returns null for them (0 outgoing edges).
  async function handleNodeClick(n: { id: string; data: GraphNodeData }) {
    const data = n.data as any;
    if (data.kind === 'origin') {
      runner.startUser(data as OriginNodeData);
      return;
    }
    if (data.kind === 'app' && (data as AppNodeData).isMachineOrigin) {
      const targetEdge = rawEdges.find((e) => e.source === n.id);
      if (targetEdge) runner.startMachine(targetEdge.target.replace(/^agent:/, ''), n.id, targetEdge.target);
      return;
    }
    if (runner.pendingExchange && n.id === runner.pendingExchange.targetNodeId) {
      const result = await runner.runRedeem();
      if (result?.isAgentHop && result.nextRid) {
        // The landed node's own outgoing edges may not be fetched yet — expand it (if not
        // already) before checking whether it has exactly one downstream to auto-chain into.
        // With 2+ downstream options this intentionally does nothing here — the user disambiguates
        // by clicking the specific neighbor directly (handled by the branch below).
        if (!expandedIds.has(result.landedNodeId)) {
          const targetAgentData = resolveHopTarget(result.landedNodeId);
          if (targetAgentData) await expandAgent(targetAgentData.id, result.landedNodeId);
        }
        const next = soleDownstream(result.landedNodeId);
        if (next) runner.runExchange(next.kind, next.id, next.nodeId, next.label, { rid: result.nextRid, callerNodeId: result.landedNodeId });
      }
      return;
    }
    // Clicking a node directly downstream of the current position (but not the sole option, or
    // clicked explicitly instead of via the current-node shortcut below) disambiguates which
    // neighbor to head toward — this is how a node with 2+ downstream options (e.g. ET10
    // connected to two different authorization servers) picks one, rather than relying on the
    // "only one option" shortcut. Once that specific node is chosen there's no more ambiguity, so
    // this single click runs BOTH the exchange (id-jag, scoped to this exact target) and the
    // redemption (final token) in sequence, instead of requiring a second click to redeem.
    if (runner.currentNodeId && !runner.pendingExchange && n.id !== runner.currentNodeId) {
      const isDirectNeighbor = rawEdges.some((e) => e.source === runner.currentNodeId && e.target === n.id);
      if (isDirectNeighbor) {
        const target = resolveHopTarget(n.id);
        if (target) {
          const pending = await runner.runExchange(target.kind, target.id, n.id, target.label);
          if (pending) await runner.runRedeem(pending);
        }
        return;
      }
    }
    if (n.id === runner.currentNodeId && !runner.pendingExchange) {
      let freshEdges = rawEdges;
      let freshNodes = rawNodes;
      if (data.kind === 'agent' && !expandedIds.has(n.id)) {
        const merged = await expandAgent(data.dashboardId, n.id);
        freshEdges = [...rawEdges, ...merged.edges];
        freshNodes = [...rawNodes, ...merged.nodes];
      }
      const next = soleDownstream(n.id, freshEdges, freshNodes);
      if (next) runner.runExchange(next.kind, next.id, next.nodeId, next.label);
      return;
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl overflow-hidden" style={{ height: 560 }}>
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border-default)]">
          <div className="w-64">
            <AgentPickerInline agents={agents} value={centerAgentId} onSelect={loadCenter} />
          </div>
          {loadingInitial && <RefreshCw className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />}
          {centerAgentId && (
            <button
              onClick={expandAll}
              className="ml-auto flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" /> Expand all
            </button>
          )}
        </div>
        <div style={{ height: 'calc(100% - 45px)' }}>
          {centerAgentId ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={NODE_TYPES}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable style={{ background: 'var(--bg-surface-muted)' }} />
            </ReactFlow>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-[var(--text-secondary)]">
              Select an agent above to see its callers and downstream chain
            </div>
          )}
        </div>
      </div>

      <TokenInspectorPanel target={inspecting} />
    </div>
  );
}

// Thin wrapper reusing AgentPicker's search UX inline instead of in a modal — same component,
// just rendered directly rather than behind an "Add" button + popover.
function AgentPickerInline({ agents, value, onSelect }: { agents: AgentOption[]; value: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const selectedName = agents.find((a) => a.id === value)?.name;
  if (!open && value) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left text-sm font-semibold text-[var(--text-primary)] px-2 py-1.5 rounded-lg hover:bg-[var(--bg-surface-muted)] transition-colors truncate"
      >
        {selectedName}
      </button>
    );
  }
  return (
    <div className="relative">
      <AgentPicker excludeAgentId="" onSelect={(a) => { onSelect(a.id); setOpen(false); }} />
    </div>
  );
}

