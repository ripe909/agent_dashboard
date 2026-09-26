import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Boxes } from 'lucide-react';
import type { AppNodeData } from '../graphData';
import TokenIcons, { type TokenIconsProps } from './TokenIcons';

// The service-client app (Settings > Service Client) is rendered as a normal app-caller node but
// doubles as the Machine Access "start here" point — same identity, so no separate origin node —
// styled with a dashed border and the same "Start here" header OriginNode.tsx uses for User
// Access, so both start points read consistently regardless of which access pattern they're for.
export default function AppNode({ data }: NodeProps & { data: AppNodeData & TokenIconsProps & { selected: boolean; onSelect: () => void } }) {
  return (
    <div
      onClick={data.onSelect}
      className={`relative w-56 rounded-lg border bg-[var(--bg-surface)] px-3 py-2.5 shadow-sm cursor-pointer transition-colors ${
        data.isMachineOrigin ? 'border-dashed' : ''
      } ${
        data.selected ? 'border-[#1662dd] ring-2 ring-[#1662dd]/30' : 'border-[var(--border-default)] hover:border-[#1662dd]/40'
      }`}
    >
      <TokenIcons hops={data.hops} onInspect={data.onInspect} />
      <Handle type="target" position={Position.Left} className="!bg-[var(--border-default)]" />
      <Handle type="source" position={Position.Right} className="!bg-[var(--border-default)]" />
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
          <Boxes className="w-3.5 h-3.5 text-emerald-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
            {data.isMachineOrigin ? 'Start here' : 'Application'}
          </div>
          <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{data.name}</div>
        </div>
      </div>
    </div>
  );
}
