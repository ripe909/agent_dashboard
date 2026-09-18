'use client';
import { useState, useEffect, useRef } from 'react';
import { Search, Check, X, Plus } from 'lucide-react';

interface OktaUser { id: string; displayName: string; email: string; status: string; }
interface Props {
  agentId: string;
  currentOwner: { id: string; name: string; email: string } | null;
  onAssigned?: (user: OktaUser) => void;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export default function UserPicker({ agentId, currentOwner: initialOwner, onAssigned }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<OktaUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [owner, setOwner] = useState(initialOwner);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    setError('');
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${BACKEND}/api/users?q=${encodeURIComponent(query)}&limit=20`);
        const data = await res.json();
        setUsers(Array.isArray(data) ? data : []);
        if (!Array.isArray(data) && data.error) setError(data.error);
      } catch (e: any) {
        setError(e.message || 'Failed to load users');
        setUsers([]);
      }
      setLoading(false);
    }, 300);
  }, [query, open]);

  async function assign(user: OktaUser) {
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/owner`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Failed to assign owner');
        return;
      }
      const data = await res.json();
      setOwner({ id: user.id, name: user.displayName, email: user.email });
      setOpen(false);
      setQuery('');
      setSuccess(data.ownerNote || `Owner set to ${user.displayName}`);
      onAssigned?.(user);
      setTimeout(() => setSuccess(''), 8000);
    } catch (e: any) {
      setError(e.message || 'Failed to assign owner');
    }
  }

  const initials = (name: string) => name?.trim()?.[0]?.toUpperCase() || '?';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        {owner ? (
          <div className="flex items-center gap-2.5 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-[#1662dd]/15 flex items-center justify-center text-xs font-bold text-[#1662dd] flex-shrink-0">
              {initials(owner.name)}
            </div>
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">{owner.name}</div>
              <div className="text-xs text-[var(--text-secondary)]">{owner.email}</div>
            </div>
          </div>
        ) : (
          <span className="text-sm text-[var(--text-secondary)] italic">No owner assigned</span>
        )}
        <button
          onClick={() => { setOpen(o => !o); setError(''); setQuery(''); }}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd]/15 border border-[#1662dd]/25 text-[#1662dd] rounded-lg hover:bg-[#1662dd]/25 transition-colors ml-3 flex-shrink-0"
        >
          <Plus className="w-3.5 h-3.5" /> {owner ? 'Change owner' : 'Assign owner'}
        </button>
      </div>

      {success && (
        <div className="text-xs mb-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <div className="flex items-center gap-1.5 text-emerald-600">
            <Check className="w-3 h-3" /><span className="font-medium">{success}</span>
          </div>
        </div>
      )}

      {open && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-3 shadow-sm">
          <div className="flex items-center gap-2 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg px-3 py-2 mb-3">
            <Search className="w-3.5 h-3.5 text-[var(--text-secondary)] flex-shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users by name or email…"
              className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none min-w-0"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {error && <div className="text-xs text-red-600 mb-2 px-1">{error}</div>}
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {loading && <div className="text-xs text-[var(--text-secondary)] text-center py-4">Searching…</div>}
            {!loading && !error && users.length === 0 && (
              <div className="text-xs text-[var(--text-secondary)] text-center py-4">
                {query ? 'No users match that search' : 'Start typing to search users'}
              </div>
            )}
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => assign(u)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-surface-muted)] rounded-lg transition-colors text-left"
              >
                <div className="w-7 h-7 rounded-full bg-[#1662dd]/15 flex items-center justify-center text-xs font-bold text-[#1662dd] flex-shrink-0">
                  {initials(u.displayName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-[var(--text-primary)] font-medium truncate">{u.displayName}</div>
                  <div className="text-xs text-[var(--text-secondary)] truncate">{u.email}</div>
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
                  u.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-[var(--bg-surface-muted)] text-[var(--text-secondary)]'
                }`}>{u.status}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
