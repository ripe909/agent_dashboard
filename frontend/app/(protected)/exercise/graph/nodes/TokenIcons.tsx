import { Send, KeyRound } from 'lucide-react';
import type { TokenResult } from '@/components/TokenStepCard';
import type { HopResult } from '../usePathRunner';

export interface TokenIconsProps {
  hops?: HopResult[];
  onInspect: (mode: 'request' | 'response', label: string, step: TokenResult) => void;
}

// Small request/response icon pair, shown top-right on a node, one pair per hop whose token
// belongs to this node — a node can accumulate more than one (e.g. the caller in a split
// exchange/redeem hop gets its arrival token AND its outgoing exchange's id-jag).
export default function TokenIcons({ hops, onInspect }: TokenIconsProps) {
  if (!hops || hops.length === 0) return null;

  return (
    <div className="absolute -top-2 -right-2 flex items-center gap-1">
      {hops.map((hop, i) => (
        <div
          key={i}
          className={`flex items-center gap-0.5 rounded-full border px-1 py-0.5 shadow-sm ${
            hop.result.ok ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
          }`}
        >
          <span
            title={`${hop.label} — ${hop.tokenType === 'AT' ? 'access token' : hop.tokenType === 'ID' ? 'ID token' : 'id-jag'}`}
            className={`text-[8px] font-bold leading-none px-0.5 rounded ${
              hop.result.ok ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {hop.tokenType}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onInspect('request', hop.label, hop.result); }}
            title={`${hop.label} — request`}
            className="w-4 h-4 flex items-center justify-center text-[var(--text-secondary)] hover:text-[#1662dd] transition-colors"
          >
            <Send className="w-2.5 h-2.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onInspect('response', hop.label, hop.result); }}
            title={`${hop.label} — response token`}
            className="w-4 h-4 flex items-center justify-center text-[var(--text-secondary)] hover:text-[#1662dd] transition-colors"
          >
            <KeyRound className="w-2.5 h-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
