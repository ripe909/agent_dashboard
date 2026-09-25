'use client';
import { FileJson } from 'lucide-react';
import type { TokenResult } from './TokenStepCard';

function JsonBlock({ value }: { value: any }) {
  return (
    <pre className="text-[11px] text-[var(--text-primary)] bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded p-3 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed max-h-72">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export interface TokenInspectorTarget { mode: 'request' | 'response'; label: string; step: TokenResult; }

// Inline panel rendered below the graph canvas (ExerciseGraph.tsx) instead of a popup — clicking a
// node's request/response icon (TokenIcons.tsx) sets `target`, and this panel shows it in place.
// Replaces the old fixed-overlay TokenInspectorModal and the right-side PathPanel's per-hop
// TokenStepCard list, which duplicated the same information the node icons now expose on demand.
export default function TokenInspectorPanel({ target }: { target: TokenInspectorTarget | null }) {
  if (!target) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] italic py-10 justify-center border border-dashed border-[var(--border-default)] rounded-xl">
        <FileJson className="w-3.5 h-3.5" /> Click a node's request or response icon to inspect its token here
      </div>
    );
  }

  const { mode, label, step } = target;
  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {mode === 'request' ? 'Request' : 'Response'} — {label}
          </h3>
          {mode === 'request' && step.request && (
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5 font-mono truncate">{step.request.tokenEndpoint}</p>
          )}
        </div>
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${step.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {step.status}
        </span>
      </div>

      {mode === 'request' ? (
        <JsonBlock value={step.request?.body ?? 'No request captured'} />
      ) : step.decoded ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1">Header</div>
            <JsonBlock value={step.decoded.header} />
          </div>
          <div>
            <div className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1">Payload</div>
            <JsonBlock value={step.decoded.payload} />
          </div>
        </div>
      ) : (
        <JsonBlock value={step.raw} />
      )}
    </div>
  );
}
