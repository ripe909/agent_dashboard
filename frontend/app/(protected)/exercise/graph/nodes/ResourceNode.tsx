import { useState, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Shield, Server, Zap, Check } from 'lucide-react';
import type { ResourceNodeData } from '../graphData';
import TokenIcons, { type TokenIconsProps } from './TokenIcons';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// Same icon/colour/label grouping as RESOURCE_TYPES in components/ResourcePicker.tsx, kept as a
// small local copy rather than importing that file (which also carries its own picker state/UI).
const RESOURCE_STYLE: Record<ResourceNodeData['resourceTypeId'], { label: string; icon: typeof Shield; colour: string }> = {
  auth_server: { label: 'Authorization server', icon: Shield, colour: '#60a5fa' },
  secret: { label: 'Secret', icon: Server, colour: '#f87171' },
  service_account: { label: 'Service account', icon: Zap, colour: '#fb923c' },
  application: { label: 'Application', icon: Zap, colour: '#34d399' },
  mcp_server: { label: 'MCP server', icon: Server, colour: '#e879f9' },
};

interface ScopeOption { id: string; name: string; description: string | null; system: boolean; }

interface AuthServerScopeProps {
  agentId?: string;
  authServerId?: string;
  selectedScopes?: string[];
  onScopesChange?: (scopes: string[]) => void;
}

// Real scopes defined on this specific authorization server, fetched live — not every Custom AS
// defines 'agent.invoke' (e.g. MARKETING MCP only has api.read/api.search/etc), so the exchange
// this node triggers needs to request a scope that actually exists on ITS OWN authorization
// server, not a hardcoded guess. Defaults to 'agent.invoke' if present, else the first scope.
function AuthServerScopes({ agentId, authServerId, selectedScopes, onScopesChange }: AuthServerScopeProps) {
  const [scopes, setScopes] = useState<ScopeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const defaulted = selectedScopes !== undefined && selectedScopes.length > 0;

  useEffect(() => {
    if (!authServerId || !agentId) { setLoading(false); return; }
    setLoading(true);
    fetch(`${BACKEND}/api/agents/${agentId}/authorization-servers/${authServerId}/scopes`)
      .then((r) => r.json())
      .then((d: ScopeOption[]) => {
        const list = Array.isArray(d) ? d : [];
        setScopes(list);
        if (!defaulted && onScopesChange && list.length > 0) {
          const agentInvoke = list.find((s) => s.name === 'agent.invoke');
          onScopesChange([agentInvoke ? agentInvoke.name : list[0].name]);
        }
      })
      .catch(() => setScopes([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, authServerId]);

  function toggle(e: React.MouseEvent, name: string) {
    e.stopPropagation();
    if (!onScopesChange) return;
    const current = new Set(selectedScopes || []);
    if (current.has(name)) current.delete(name); else current.add(name);
    onScopesChange(Array.from(current));
  }

  if (loading) {
    return <div className="text-[10px] text-[var(--text-muted)] mt-2">Loading scopes…</div>;
  }
  if (scopes.length === 0) {
    return <div className="text-[10px] text-[var(--text-muted)] mt-2">No custom scopes defined</div>;
  }

  return (
    <div className="mt-2 pt-2 border-t border-[var(--border-default)] space-y-0.5 max-h-24 overflow-y-auto">
      {scopes.map((s) => {
        const checked = (selectedScopes || []).includes(s.name);
        return (
          <button
            key={s.id}
            onClick={(e) => toggle(e, s.name)}
            className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left transition-colors ${
              checked ? 'bg-[#1662dd]/10' : 'hover:bg-[var(--bg-surface-muted)]'
            }`}
          >
            <div className={`w-3 h-3 rounded-sm border flex items-center justify-center flex-shrink-0 ${
              checked ? 'bg-[#1662dd] border-[#1662dd]' : 'border-[var(--border-default)]'
            }`}>
              {checked && <Check className="w-2 h-2 text-white" />}
            </div>
            <span className="text-[10px] font-mono text-[var(--text-primary)] truncate">{s.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function ResourceNode({
  data,
}: NodeProps & { data: ResourceNodeData & TokenIconsProps & AuthServerScopeProps & { selected: boolean; onSelect: () => void } }) {
  const style = RESOURCE_STYLE[data.resourceTypeId];
  const Icon = style.icon;
  const isAuthServer = data.resourceTypeId === 'auth_server';
  return (
    <div
      onClick={data.onSelect}
      className={`relative w-56 rounded-lg border bg-[var(--bg-surface)] px-3 py-2.5 shadow-sm cursor-pointer transition-colors ${
        data.selected ? 'border-[#1662dd] ring-2 ring-[#1662dd]/30' : 'border-[var(--border-default)] hover:border-[#1662dd]/40'
      }`}
    >
      <TokenIcons hops={data.hops} onInspect={data.onInspect} />
      <Handle type="target" position={Position.Left} className="!bg-[var(--border-default)]" />
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${style.colour}1a` }}>
          <Icon className="w-3.5 h-3.5" style={{ color: style.colour }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide">{style.label}</div>
          <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{data.name}</div>
          {data.sub && <div className="text-[11px] text-[var(--text-muted)] truncate">{data.sub}</div>}
        </div>
      </div>
      {isAuthServer && (
        <AuthServerScopes
          agentId={data.agentId}
          authServerId={data.authServerId}
          selectedScopes={data.selectedScopes}
          onScopesChange={data.onScopesChange}
        />
      )}
    </div>
  );
}
