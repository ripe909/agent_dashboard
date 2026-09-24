export interface TokenResult {
  ok: boolean;
  status: number;
  accessToken?: string;
  decoded?: { header: any; payload: any };
  raw: any;
}

function JsonBlock({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1">{label}</div>
      <pre className="text-[11px] text-[var(--text-primary)] bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed max-h-56">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default function TokenStepCard({ title, step }: { title: string; step: TokenResult | null }) {
  if (!step) return null;
  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${step.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {step.status}
        </span>
      </div>
      {step.decoded ? (
        <>
          <JsonBlock label="Header" value={step.decoded.header} />
          <JsonBlock label="Payload" value={step.decoded.payload} />
        </>
      ) : (
        <JsonBlock label="Response" value={step.raw} />
      )}
    </div>
  );
}
