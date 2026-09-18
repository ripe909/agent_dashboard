'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Check, RefreshCw, UserCheck, Search, X, Plus } from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface OktaUser { id: string; displayName: string; email: string; status: string; }

interface Props {
  agentId: string;
  enabled: boolean;
  streamlined: boolean;
}

function initials(name?: string) { return name?.trim()?.[0]?.toUpperCase() || '?'; }

// ── Legacy flow: bare "enable" button, no assignment ────────────────────────
function LegacyUserAccess({ agentId, enabled: initialEnabled }: { agentId: string; enabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function enable() {
    setSaving(true); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/user-access`, { method: 'PUT' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to enable user access'); return; }
      setEnabled(true);
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        {enabled ? (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <Check className="w-4 h-4" /> User sign-in enabled
          </div>
        ) : (
          <span className="text-sm text-slate-500 italic">Users can't sign in through this agent yet</span>
        )}
        {!enabled && (
          <button
            onClick={enable}
            disabled={saving}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd]/15 border border-[#1662dd]/25 text-[#60a5fa] rounded-lg hover:bg-[#1662dd]/25 transition-colors disabled:opacity-40 flex-shrink-0"
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
            Enable user sign-in
          </button>
        )}
      </div>
      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2 mt-2">{error}</div>}
    </div>
  );
}

// ── Streamlined flow: assign users directly, app auto-provisioned behind the scenes ──
function StreamlinedUserAccess({ agentId }: { agentId: string }) {
  const [assignedUsers, setAssignedUsers] = useState<OktaUser[]>([]);
  const [loadingAssigned, setLoadingAssigned] = useState(true);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<OktaUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const loadAssigned = useCallback(async () => {
    setLoadingAssigned(true);
    try {
      const r = await fetch(`${BACKEND}/api/agents/${agentId}/user-access/users`);
      const d = await r.json();
      setAssignedUsers(Array.isArray(d) ? d : []);
    } catch { setAssignedUsers([]); }
    setLoadingAssigned(false);
  }, [agentId]);

  useEffect(() => { loadAssigned(); }, [loadAssigned]);

  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    setError('');
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`${BACKEND}/api/users?q=${encodeURIComponent(query)}&limit=20`);
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data : []);
        if (!Array.isArray(data) && data.error) setError(data.error);
      } catch (e: any) {
        setError(e.message || 'Failed to load users');
        setSearchResults([]);
      }
      setSearching(false);
    }, 300);
  }, [query, open]);

  const assignedIds = new Set(assignedUsers.map((u) => u.id));

  async function assign(user: OktaUser) {
    setAssigning(user.id); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/user-access/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to assign user'); setAssigning(null); return; }
      await loadAssigned();
      setOpen(false);
      setQuery('');
    } catch (e: any) { setError(e.message); }
    setAssigning(null);
  }

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Assigned Users ({loadingAssigned ? '…' : assignedUsers.length})
          </span>
          <button
            onClick={() => { setOpen((o) => !o); setError(''); setQuery(''); }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd]/15 border border-[#1662dd]/25 text-[#60a5fa] rounded-lg hover:bg-[#1662dd]/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add user
          </button>
        </div>

        {loadingAssigned ? (
          <div className="text-xs text-slate-500 text-center py-4">
            <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Loading users…
          </div>
        ) : assignedUsers.length === 0 ? (
          <div className="text-xs text-slate-500 italic py-4 text-center border border-dashed border-[#1e293b] rounded-lg">
            No users assigned yet
          </div>
        ) : (
          <div className="space-y-2">
            {assignedUsers.map((u) => (
              <div key={u.id} className="flex items-center gap-3 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2.5">
                <div className="w-7 h-7 rounded-full bg-[#1662dd]/20 flex items-center justify-center text-xs font-bold text-[#60a5fa] flex-shrink-0">
                  {initials(u.displayName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-white truncate">{u.displayName}</div>
                  <div className="text-xs text-slate-500 truncate">{u.email}</div>
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
                  u.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'
                }`}>{u.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && !open && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">{error}</div>
      )}

      {open && (
        <div className="bg-[#0d1525] border border-[#1e293b] rounded-xl p-3">
          <div className="flex items-center gap-2 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 mb-3">
            <Search className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users by name or email…"
              className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none min-w-0"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-slate-500 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {error && <div className="text-xs text-red-400 mb-2 px-1">{error}</div>}
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {searching && <div className="text-xs text-slate-500 text-center py-4">Searching…</div>}
            {!searching && !error && searchResults.length === 0 && (
              <div className="text-xs text-slate-500 text-center py-4">
                {query ? 'No users match that search' : 'Start typing to search users'}
              </div>
            )}
            {searchResults.map((u) => {
              const alreadyAssigned = assignedIds.has(u.id);
              return (
                <button
                  key={u.id}
                  onClick={() => !alreadyAssigned && assign(u)}
                  disabled={alreadyAssigned || assigning === u.id}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-lg transition-colors text-left disabled:opacity-50 disabled:cursor-default"
                >
                  <div className="w-7 h-7 rounded-full bg-[#1662dd]/20 flex items-center justify-center text-xs font-bold text-[#60a5fa] flex-shrink-0">
                    {initials(u.displayName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white font-medium truncate">{u.displayName}</div>
                    <div className="text-xs text-slate-500 truncate">{u.email}</div>
                  </div>
                  {assigning === u.id ? (
                    <RefreshCw className="w-3.5 h-3.5 text-[#60a5fa] animate-spin flex-shrink-0" />
                  ) : alreadyAssigned ? (
                    <span className="text-xs text-slate-600 flex-shrink-0">Assigned</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-600 mt-3">
        Assigning a user automatically creates and activates a backing OIDC app for this agent if one doesn&apos;t exist yet.
      </p>
    </div>
  );
}

export default function UserAccess({ agentId, enabled, streamlined }: Props) {
  return streamlined
    ? <StreamlinedUserAccess agentId={agentId} />
    : <LegacyUserAccess agentId={agentId} enabled={enabled} />;
}
