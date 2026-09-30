import { Handle, Position, type NodeProps } from '@xyflow/react';
import { UserCheck } from 'lucide-react';
import type { OriginNodeData } from '../graphData';
import TokenIcons, { type TokenIconsProps } from './TokenIcons';

// Only represents User Access now — Machine Access's start point is the real service-client
// app node (AppNode.tsx, isMachineOrigin) instead of a synthetic node, since that IS the
// identity that performs the initial grant.
export default function OriginNode({ data }: NodeProps & { data: OriginNodeData & TokenIconsProps & { selected: boolean; onSelect: () => void } }) {
  const Icon = UserCheck;
  const colour = '#10b981';
  return (
    <div
      onClick={data.onSelect}
      className={`relative w-48 rounded-lg border border-dashed bg-[var(--bg-surface)] px-3 py-2.5 shadow-sm cursor-pointer transition-colors ${
        data.selected ? 'border-[#1662dd] ring-2 ring-[#1662dd]/30' : 'border-[var(--border-default)] hover:border-[#1662dd]/40'
      }`}
    >
      <TokenIcons hops={data.hops} incoming={data.incoming} onInspect={data.onInspect} />
      <Handle type="source" position={Position.Right} className="!bg-[var(--border-default)]" />
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${colour}1a` }}>
          <Icon className="w-3.5 h-3.5" style={{ color: colour }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide">{data.supertitle || 'Start here'}</div>
          <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{data.label}</div>
        </div>
      </div>
    </div>
  );
}
