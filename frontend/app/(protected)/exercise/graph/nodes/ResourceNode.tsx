import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Shield, Server, Zap } from 'lucide-react';
import type { ResourceNodeData } from '../graphData';
import TokenIcons, { type TokenIconsProps } from './TokenIcons';

// Same icon/colour/label grouping as RESOURCE_TYPES in components/ResourcePicker.tsx, kept as a
// small local copy rather than importing that file (which also carries its own picker state/UI).
const RESOURCE_STYLE: Record<ResourceNodeData['resourceTypeId'], { label: string; icon: typeof Shield; colour: string }> = {
  auth_server: { label: 'Authorization server', icon: Shield, colour: '#60a5fa' },
  secret: { label: 'Secret', icon: Server, colour: '#f87171' },
  service_account: { label: 'Service account', icon: Zap, colour: '#fb923c' },
  application: { label: 'Application', icon: Zap, colour: '#34d399' },
  mcp_server: { label: 'MCP server', icon: Server, colour: '#e879f9' },
};

export default function ResourceNode({ data }: NodeProps & { data: ResourceNodeData & TokenIconsProps & { selected: boolean; onSelect: () => void } }) {
  const style = RESOURCE_STYLE[data.resourceTypeId];
  const Icon = style.icon;
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
    </div>
  );
}
