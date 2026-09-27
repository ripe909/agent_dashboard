'use client';
import { useState, useEffect, useCallback } from 'react';
import { Check, X, Plus, Shield, Server, Zap, Link2, Trash2, RefreshCw, ChevronRight, ArrowLeft, Pencil } from 'lucide-react';
import ScopeSelector from './ScopeSelector';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PotentialConnection {
  connectionType: string;
  authorizationServer?: { name: string; issuerUrl?: string; orn: string };
  resourceIndicator?: string;
  resource?: {
    appInstanceId?: string; appInstanceName?: string;
    clientAuthSettings?: { name: string; orn: string };
    orn?: string; name?: string;
  };
  selectedScopes?: string[];
}

interface AgentConnection {
  id: string; connectionType: string; status: string; orn?: string;
  authorizationServer?: { name: string; issuerUrl?: string; orn: string };
  resource?: any; resourceIndicator?: string; scopeCondition?: string; scopes?: string[];
}

interface AgentTarget { id: string; oktaAgentId: string; name: string; machineAccessReady: boolean; }

// ── Admin-console resource type definitions ───────────────────────────────────

const RESOURCE_TYPES = [
  {
    id: 'auth_server',
    label: 'Authorization server',
    description: 'Select a custom authorization server. Allows the agent to gain access to resources protected by it.',
    connectionTypes: ['IDENTITY_ASSERTION_CUSTOM_AS'],
    icon: Shield,
    colour: '#60a5fa',
  },
  {
    id: 'secret',
    label: 'Secret',
    description: 'Select a stored secret in Okta Privileged Access that your AI agent should be allowed access.',
    connectionTypes: ['STS_VAULT_SECRET'],
    icon: Server,
    colour: '#f87171',
  },
  {
    id: 'service_account',
    label: 'Service account',
    description: 'Select the service account in Okta Privileged Access that your AI agent should be allowed to access.',
    connectionTypes: ['STS_SERVICE_ACCOUNT'],
    icon: Zap,
    colour: '#fb923c',
  },
  {
    id: 'application',
    label: 'Application',
    description: 'Select an app configured in Okta or a custom resource server for AI Agent access.',
    connectionTypes: ['STS_ACCESS_TOKEN', 'IDENTITY_ASSERTION_APP_INSTANCE'],
    icon: Zap,
    colour: '#34d399',
  },
  {
    id: 'mcp_server',
    label: 'MCP server',
    description: 'Select a Model Context Protocol (MCP) server for your AI agent to access.',
    connectionTypes: ['IDENTITY_ASSERTION_VIRTUAL_MCP_SERVER'],
    icon: Server,
    colour: '#e879f9',
  },
  {
    id: 'ai_agent',
    label: 'Connect to another AI agent',
    description: 'Set up a bilateral connection with another AI agent as a resource.',
    connectionTypes: ['IDENTITY_ASSERTION_A2A_SERVER'],
    icon: Link2,
    colour: '#a78bfa',
  },
] as const;

type ResourceTypeId = typeof RESOURCE_TYPES[number]['id'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function connectionName(conn: PotentialConnection | AgentConnection): string {
  const r = (conn as any).resource;
  // For agent-to-agent connections, the target agent (resource.name) is the identity of the
  // row — matching Okta's own console, which shows "AI agent / TEST10", not the authz server name.
  if (conn.connectionType === 'IDENTITY_ASSERTION_A2A_SERVER' && r?.name) return r.name;
  if (conn.authorizationServer?.name) return conn.authorizationServer.name;
  if (r?.appInstanceName) return r.appInstanceName;
  if (r?.name) return r.name;
  if (r?.clientAuthSettings?.name) return r.clientAuthSettings.name;
  return conn.connectionType;
}

function connectionSub(conn: PotentialConnection | AgentConnection): string {
  if (conn.connectionType === 'IDENTITY_ASSERTION_A2A_SERVER' && conn.authorizationServer?.name) {
    return `via ${conn.authorizationServer.name}`;
  }
  if (conn.authorizationServer?.issuerUrl) return conn.authorizationServer.issuerUrl;
  const orn = conn.authorizationServer?.orn || (conn as any).resource?.orn || (conn as any).resource?.clientAuthSettings?.orn || '';
  return orn ? orn.substring(0, 60) + (orn.length > 60 ? '…' : '') : '';
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface Props { agentId: string; onStatusChange?: (hasConnections: boolean) => void; }

export default function ResourcePicker({ agentId, onStatusChange }: Props) {
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [allPotential, setAllPotential] = useState<PotentialConnection[]>([]);
  const [agentTargets, setAgentTargets] = useState<AgentTarget[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [loadingPotential, setLoadingPotential] = useState(true);

  // Picker state: null = closed, resourceTypeId = step 2
  const [step, setStep] = useState<'closed' | 'type' | ResourceTypeId>('closed');

  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Custom AS connections go through an extra confirm step (pick scopes, then Connect) instead
  // of adding immediately on click, like every other resource type does.
  const [pendingAuthServer, setPendingAuthServer] = useState<PotentialConnection | null>(null);
  const [pendingScopes, setPendingScopes] = useState<string[] | undefined>(undefined);
  // Editing an EXISTING Custom AS connection's scopes (as opposed to picking scopes while
  // creating a new one, above) — tracked separately since it operates on an AgentConnection
  // (already has an id) rather than a not-yet-created PotentialConnection.
  const [editingConnId, setEditingConnId] = useState<string | null>(null);
  const [editingScopes, setEditingScopes] = useState<string[] | undefined>(undefined);
  const [saving, setSaving] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    setLoadingConnections(true);
    try {
      const r = await fetch(`${BACKEND}/api/agents/${agentId}/connections`);
      const d = await r.json();
      setConnections(Array.isArray(d) ? d : []);
    } catch { setConnections([]); }
    setLoadingConnections(false);
  }, [agentId]);

  useEffect(() => {
    loadConnections();
    // Load potential connections once
    fetch(`${BACKEND}/api/agents/${agentId}/potential-connections`)
      .then(r => r.json())
      .then(d => setAllPotential(Array.isArray(d) ? d : []))
      .catch(() => setAllPotential([]))
      .finally(() => setLoadingPotential(false));
    // Load every other agent as a "Connect to another AI agent" candidate — unlike
    // potential-connections above, this includes agents with no Machine Access set up yet.
    fetch(`${BACKEND}/api/agents/${agentId}/agent-targets`)
      .then(r => r.json())
      .then(d => setAgentTargets(Array.isArray(d) ? d : []))
      .catch(() => setAgentTargets([]));
  }, [agentId, loadConnections]);

  useEffect(() => {
    if (!loadingConnections) onStatusChange?.(connections.length > 0);
  }, [loadingConnections, connections.length]);

  // Leaving the auth-server resource-type step (back, close, or switching types) should always
  // collapse any open scope-confirm panel — it's meaningless once its row is no longer visible.
  useEffect(() => {
    if (step !== 'auth_server') { setPendingAuthServer(null); setPendingScopes(undefined); }
  }, [step]);

  // ── Connected ORNs (to skip already-connected items) ──────────────────────
  const connectedOrns = new Set(connections.map(c =>
    c.authorizationServer?.orn ||
    (c as any).resource?.orn ||
    (c as any).resource?.clientAuthSettings?.orn || ''
  ).filter(Boolean));

  // Agent-to-agent connections are keyed by the target's Okta agent id (parsed off the tail of
  // its a2a resource-server ORN) rather than the ORN itself — a not-yet-provisioned target has
  // no resource-server ORN at all yet, so ORN-based matching alone can't exclude it once connected.
  const connectedAgentOktaIds = new Set(
    connections
      .filter(c => c.connectionType === 'IDENTITY_ASSERTION_A2A_SERVER')
      .map(c => (c as any).resource?.orn?.split(':').pop())
      .filter(Boolean)
  );

  // ── Add connection ─────────────────────────────────────────────────────────
  // trackingKey lets a caller add scopes to `conn` (which would otherwise change its
  // JSON.stringify key) while still matching the row's own isAdding/spinner check.
  async function addConnection(conn: PotentialConnection, trackingKey?: string) {
    const key = trackingKey ?? JSON.stringify(conn);
    setAdding(key); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/connections`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conn),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to create connection'); setAdding(null); return; }
      await loadConnections();
      setStep('closed');
      setPendingAuthServer(null);
      setPendingScopes(undefined);
    } catch (e: any) { setError(e.message); }
    setAdding(null);
  }

  async function addAgentTarget(target: AgentTarget) {
    setAdding(target.id); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/connections`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionType: 'IDENTITY_ASSERTION_A2A_SERVER', targetAgentId: target.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to create connection'); setAdding(null); return; }
      await loadConnections();
      setStep('closed');
    } catch (e: any) { setError(e.message); }
    setAdding(null);
  }

  // ── Remove connection ──────────────────────────────────────────────────────
  // The backend deactivates before deleting — Okta otherwise rejects deleting an ACTIVE
  // connection outright — so this always succeeds instead of surfacing a 409.
  async function removeConnection(connId: string) {
    setRemoving(connId); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/connections/${connId}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to remove'); setRemoving(null); return; }
      setConnections(prev => prev.filter(c => c.id !== connId));
    } catch (e: any) { setError(e.message); }
    setRemoving(null);
  }

  // ── Edit an existing connection's scopes ───────────────────────────────────
  async function saveConnectionScopes(connId: string) {
    setSaving(connId); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/connections/${connId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedScopes: editingScopes }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to update scopes'); setSaving(null); return; }
      setConnections(prev => prev.map(c => c.id === connId ? data : c));
      setEditingConnId(null);
      setEditingScopes(undefined);
    } catch (e: any) { setError(e.message); }
    setSaving(null);
  }

  // ── Filtered potential connections for selected type ───────────────────────
  const selectedType = step !== 'closed' && step !== 'type'
    ? RESOURCE_TYPES.find(t => t.id === step)
    : null;

  const filteredConnections = selectedType && selectedType.id !== 'ai_agent'
    ? allPotential.filter(p =>
        (selectedType.connectionTypes as readonly string[]).includes(p.connectionType) &&
        !connectedOrns.has(
          p.authorizationServer?.orn || p.resource?.orn || p.resource?.clientAuthSettings?.orn || ''
        )
      )
    : [];

  // "Connect to another AI agent" sources from every dashboard agent (agentTargets), not just
  // Okta's potential-connections — a target with no Machine Access configured yet still shows up
  // here, flagged via machineAccessReady, and gets auto-provisioned on select (see addAgentTarget).
  const filteredAgentTargets = selectedType?.id === 'ai_agent'
    ? agentTargets.filter(t => !connectedAgentOktaIds.has(t.oktaAgentId))
    : [];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Active connections list */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
            Active Connections ({loadingConnections ? '…' : connections.length})
          </span>
          <button
            onClick={() => { setStep('type'); setError(''); }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd]/15 border border-[#1662dd]/25 text-[#1662dd] rounded-lg hover:bg-[#1662dd]/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add resource connection
          </button>
        </div>

        {loadingConnections ? (
          <div className="text-xs text-[var(--text-secondary)] text-center py-4">
            <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Loading connections…
          </div>
        ) : connections.length === 0 ? (
          <div className="text-xs text-[var(--text-secondary)] italic py-4 text-center border border-dashed border-[var(--border-default)] rounded-lg">
            No resource connections yet
          </div>
        ) : (
          <div className="space-y-2">
            {connections.map((c) => {
              const typeDef = RESOURCE_TYPES.find(t => (t.connectionTypes as readonly string[]).includes(c.connectionType));
              const Icon = typeDef?.icon || Shield;
              const colour = typeDef?.colour || '#64748b';
              const isCustomAS = c.connectionType === 'IDENTITY_ASSERTION_CUSTOM_AS';
              const isEditing = editingConnId === c.id;
              const scopesSummary = c.scopeCondition === 'INCLUDE_ONLY' && c.scopes && c.scopes.length > 0
                ? `${c.scopes.length} scope${c.scopes.length > 1 ? 's' : ''}: ${c.scopes.join(', ')}`
                : 'All scopes';
              return (
                <div key={c.id}>
                  <div className="flex items-center gap-3 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg px-3 py-2.5">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${colour}1a` }}>
                      <Icon className="w-4 h-4" style={{ color: colour }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--text-primary)] truncate">{connectionName(c)}</div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--text-secondary)] truncate">{typeDef?.label || c.connectionType}</span>
                        {connectionSub(c) && <span className="text-xs text-[var(--text-muted)] truncate">· {connectionSub(c)}</span>}
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
                          c.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-[var(--bg-surface-muted)] text-[var(--text-secondary)]'
                        }`}>{c.status}</span>
                      </div>
                      {isCustomAS && (
                        <div className="text-xs text-[var(--text-muted)] truncate mt-0.5" title={scopesSummary}>{scopesSummary}</div>
                      )}
                    </div>
                    {isCustomAS && (
                      <button
                        onClick={() => {
                          if (isEditing) { setEditingConnId(null); setEditingScopes(undefined); }
                          else { setEditingConnId(c.id); setEditingScopes(c.scopeCondition === 'INCLUDE_ONLY' ? c.scopes : undefined); }
                        }}
                        className="text-[var(--text-muted)] hover:text-[#1662dd] transition-colors p-1 flex-shrink-0"
                        title="Edit scopes"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => removeConnection(c.id)}
                      disabled={removing === c.id}
                      className="text-[var(--text-muted)] hover:text-red-600 transition-colors p-1 flex-shrink-0"
                      title="Remove connection"
                    >
                      {removing === c.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {isEditing && c.authorizationServer?.orn && (
                    <div className="mt-2 p-3 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg space-y-3">
                      <ScopeSelector
                        agentId={agentId}
                        authServerOrn={c.authorizationServer.orn}
                        initialScopes={c.scopeCondition === 'INCLUDE_ONLY' ? c.scopes : undefined}
                        onChange={setEditingScopes}
                      />
                      <button
                        onClick={() => saveConnectionScopes(c.id)}
                        disabled={saving === c.id}
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd] text-white rounded-lg hover:bg-[#1662dd]/90 transition-colors disabled:opacity-40"
                      >
                        {saving === c.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Save
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3 flex items-center justify-between">
          {error}
          <button onClick={() => setError('')}><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* ── Step 1: Select resource type ── */}
      {step === 'type' && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Add resource connection</h3>
            <button onClick={() => setStep('closed')} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mb-4">Select a resource type</p>
          <div className="space-y-2">
            {RESOURCE_TYPES.map((type) => {
              const Icon = type.icon;
              const available = type.id === 'ai_agent'
                ? agentTargets.length
                : allPotential.filter(p =>
                    (type.connectionTypes as readonly string[]).includes(p.connectionType)
                  ).length;
              return (
                <button
                  key={type.id}
                  onClick={() => { if (!loadingPotential) setStep(type.id); }}
                  disabled={loadingPotential}
                  className="w-full flex items-center gap-3 px-4 py-3.5 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] hover:border-[#1662dd]/40 rounded-lg text-left transition-colors disabled:opacity-50 group"
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${type.colour}1a` }}>
                    <Icon className="w-4 h-4" style={{ color: type.colour }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{type.label}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{type.description}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {loadingPotential ? (
                      <RefreshCw className="w-3 h-3 text-[var(--text-muted)] animate-spin" />
                    ) : available > 0 ? (
                      <span className="text-xs text-[#1662dd] font-medium">{available} available</span>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">None configured</span>
                    )}
                    <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--text-muted)]" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Step 2: Pick specific resource ── */}
      {selectedType && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => setStep('type')}
              className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <span className="text-[var(--text-muted)]">·</span>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{selectedType.label}</h3>
            <button onClick={() => setStep('closed')} className="ml-auto text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mb-3">Select a resource</p>

          {selectedType.id === 'ai_agent' ? (
            filteredAgentTargets.length === 0 ? (
              <div className="text-xs text-[var(--text-secondary)] text-center py-6 border border-dashed border-[var(--border-default)] rounded-lg">
                No other AI agent resources available or all are already connected
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {filteredAgentTargets.map((target) => {
                  const isAdding = adding === target.id;
                  const Icon = selectedType.icon;
                  return (
                    <button
                      key={target.id}
                      onClick={() => addAgentTarget(target)}
                      disabled={!!adding}
                      className="w-full flex items-center gap-3 px-3 py-3 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] hover:border-[#1662dd]/40 rounded-lg text-left transition-colors disabled:opacity-50"
                    >
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${selectedType.colour}1a` }}>
                        <Icon className="w-3.5 h-3.5" style={{ color: selectedType.colour }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[var(--text-primary)] truncate">{target.name}</div>
                        {!target.machineAccessReady && (
                          <div className="text-xs text-amber-600">Needs Machine Access setup — will configure automatically</div>
                        )}
                      </div>
                      {isAdding ? (
                        <RefreshCw className="w-4 h-4 text-[#1662dd] animate-spin flex-shrink-0" />
                      ) : (
                        <Plus className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            )
          ) : filteredConnections.length === 0 ? (
            <div className="text-xs text-[var(--text-secondary)] text-center py-6 border border-dashed border-[var(--border-default)] rounded-lg">
              {loadingPotential ? (
                <><RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Loading…</>
              ) : (
                `No ${selectedType.label.toLowerCase()} resources available or all are already connected`
              )}
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {filteredConnections.map((conn, idx) => {
                const key = JSON.stringify(conn);
                const isAdding = adding === key;
                const name = connectionName(conn);
                const sub = connectionSub(conn);
                const Icon = selectedType.icon;
                const isPending = pendingAuthServer === conn;
                return (
                  <div key={idx}>
                    <button
                      onClick={() => selectedType.id === 'auth_server'
                        ? setPendingAuthServer(isPending ? null : conn)
                        : addConnection(conn)}
                      disabled={!!adding}
                      className={`w-full flex items-center gap-3 px-3 py-3 bg-[var(--bg-surface-muted)] border rounded-lg text-left transition-colors disabled:opacity-50 ${
                        isPending ? 'border-[#1662dd]/40' : 'border-[var(--border-default)] hover:border-[#1662dd]/40'
                      }`}
                    >
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${selectedType.colour}1a` }}>
                        <Icon className="w-3.5 h-3.5" style={{ color: selectedType.colour }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[var(--text-primary)] truncate">{name}</div>
                        {sub && <div className="text-xs text-[var(--text-secondary)] truncate font-mono">{sub}</div>}
                      </div>
                      {isAdding ? (
                        <RefreshCw className="w-4 h-4 text-[#1662dd] animate-spin flex-shrink-0" />
                      ) : (
                        <Plus className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
                      )}
                    </button>
                    {isPending && conn.authorizationServer?.orn && (
                      <div className="mt-2 p-3 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg space-y-3">
                        <ScopeSelector
                          agentId={agentId}
                          authServerOrn={conn.authorizationServer.orn}
                          onChange={setPendingScopes}
                        />
                        <button
                          onClick={() => addConnection({ ...conn, selectedScopes: pendingScopes }, key)}
                          disabled={!!adding}
                          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd] text-white rounded-lg hover:bg-[#1662dd]/90 transition-colors disabled:opacity-40"
                        >
                          {adding === key ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                          Connect
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
