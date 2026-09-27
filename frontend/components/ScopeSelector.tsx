'use client';
import { useState, useEffect } from 'react';
import { Check, RefreshCw } from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface ScopeOption { id: string; name: string; description: string | null; system: boolean; }

interface Props {
  agentId: string;
  authServerOrn: string;
  onChange: (selectedScopes: string[] | undefined) => void;
  // Pre-checks these scopes and starts in "Only these scopes" mode — used when editing an
  // EXISTING connection's current grant, as opposed to picking scopes while creating a new one
  // (which always starts from "All scopes").
  initialScopes?: string[];
}

// Lets the caller pick between "All scopes" (the default — same behavior as before this
// component existed) and "Only these scopes", backed by the target authorization server's own
// scope catalog. onChange fires with undefined for "All scopes" and a non-empty array for a
// specific selection — matching okta.ts's PotentialConnection.selectedScopes contract exactly.
export default function ScopeSelector({ agentId, authServerOrn, onChange, initialScopes }: Props) {
  const [scopes, setScopes] = useState<ScopeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'all' | 'specific'>(initialScopes && initialScopes.length > 0 ? 'specific' : 'all');
  const [selected, setSelected] = useState<Set<string>>(new Set(initialScopes || []));

  useEffect(() => {
    const authServerId = authServerOrn.split(':').pop();
    if (!authServerId) { setLoading(false); setError('Could not resolve authorization server id'); return; }
    setLoading(true);
    fetch(`${BACKEND}/api/agents/${agentId}/authorization-servers/${authServerId}/scopes`)
      .then((r) => r.json())
      .then((d) => setScopes(Array.isArray(d) ? d : []))
      .catch(() => setError('Failed to load scopes'))
      .finally(() => setLoading(false));
  }, [agentId, authServerOrn]);

  useEffect(() => {
    onChange(mode === 'specific' && selected.size > 0 ? Array.from(selected) : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selected]);

  function toggleScope(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setMode('all')}
          className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
            mode === 'all' ? 'bg-[#1662dd]/15 border-[#1662dd]/25 text-[#1662dd]' : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          All scopes
        </button>
        <button
          onClick={() => setMode('specific')}
          className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
            mode === 'specific' ? 'bg-[#1662dd]/15 border-[#1662dd]/25 text-[#1662dd]' : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          Only these scopes
        </button>
      </div>

      {mode === 'specific' && (
        <div className="border border-[var(--border-default)] rounded-lg p-2 max-h-48 overflow-y-auto space-y-1">
          {loading ? (
            <div className="text-xs text-[var(--text-secondary)] text-center py-3">
              <RefreshCw className="w-3.5 h-3.5 animate-spin inline mr-1.5" />Loading scopes…
            </div>
          ) : error ? (
            <div className="text-xs text-red-600 text-center py-3">{error}</div>
          ) : scopes.length === 0 ? (
            <div className="text-xs text-[var(--text-secondary)] text-center py-3">No custom scopes defined on this authorization server</div>
          ) : (
            scopes.map((s) => {
              const checked = selected.has(s.name);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleScope(s.name)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors ${
                    checked ? 'bg-[#1662dd]/10' : 'hover:bg-[var(--bg-surface-muted)]'
                  }`}
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                    checked ? 'bg-[#1662dd] border-[#1662dd]' : 'border-[var(--border-default)]'
                  }`}>
                    {checked && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-[var(--text-primary)] font-mono">{s.name}</div>
                    {s.description && <div className="text-xs text-[var(--text-secondary)] truncate">{s.description}</div>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
