'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Zap, ZapOff, Trash2, RefreshCw } from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface Props { agentId: string; agentName: string; currentStatus: string; }

export default function AgentActionsMenu({ agentId, agentName, currentStatus }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const status = currentStatus?.toLowerCase();
  const isActive = status === 'active';
  const isStaged = status === 'staged';
  const isInactive = status === 'inactive';

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setConfirmDelete(false); }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  async function lifecycle(action: 'activate' | 'deactivate') {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || `Failed to ${action}`); setLoading(false); return; }
      setOpen(false);
      router.refresh();
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function del() {
    setLoading(true); setError('');
    try {
      await fetch(`${BACKEND}/api/agents/${agentId}`, { method: 'DELETE' });
      router.push('/agents');
    } catch (e: any) { setError(e.message); setLoading(false); }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-4 py-2 bg-[#1662dd] hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        Actions <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-64 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg shadow-lg py-1.5 z-20">
          {confirmDelete ? (
            <div className="px-3 py-2.5">
              <p className="text-xs text-[var(--text-secondary)] mb-2">Delete &ldquo;{agentName}&rdquo;? This permanently removes it from Okta.</p>
              <div className="flex gap-2">
                <button
                  onClick={del}
                  disabled={loading}
                  className="flex-1 px-2.5 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-semibold rounded-md"
                >
                  {loading ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {(isStaged || isInactive) && (
                <button
                  onClick={() => lifecycle('activate')}
                  disabled={loading}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] disabled:opacity-40 text-left"
                >
                  {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-emerald-600" />}
                  Activate agent
                </button>
              )}
              {isActive && (
                <button
                  onClick={() => lifecycle('deactivate')}
                  disabled={loading}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] disabled:opacity-40 text-left"
                >
                  {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ZapOff className="w-3.5 h-3.5 text-[var(--text-secondary)]" />}
                  Deactivate agent
                </button>
              )}
              <div className="my-1 border-t border-[var(--border-default)]" />
              {isActive ? (
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2.5 text-sm text-[var(--text-muted)] cursor-not-allowed">
                    <Trash2 className="w-3.5 h-3.5" /> Delete agent
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Deactivate the agent first to enable deletion.</p>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 text-left"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete agent
                </button>
              )}
            </>
          )}
          {error && <div className="px-3 py-2 text-xs text-red-600">{error}</div>}
        </div>
      )}
    </div>
  );
}
