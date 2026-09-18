import { apiFetch, OktaUser } from '@/lib/api';
import { Users } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function UsersPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = searchParams.q || '';
  let users: OktaUser[] = [];
  try { users = await apiFetch<OktaUser[]>(`/api/users?q=${encodeURIComponent(q)}&limit=50`); } catch {}

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Directory' }, { label: 'People' }]} />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Okta Users</h1>
          <p className="text-[var(--text-secondary)] text-sm mt-1">{users.length} user{users.length !== 1 ? 's' : ''} in your tenant</p>
        </div>
      </div>

      <form className="mb-5">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search users by name or email…"
          className="w-full max-w-sm bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#1662dd]"
        />
      </form>

      {users.length === 0 ? (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg py-14 text-center">
          <Users className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-2" />
          <div className="text-[var(--text-secondary)] text-sm">{q ? 'No users match that search' : 'No users found'}</div>
        </div>
      ) : (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg overflow-hidden">
          <div className="grid grid-cols-[2rem_1fr_1fr_6rem] gap-4 px-5 py-2.5 border-b border-[var(--border-default)] text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
            <div />
            <div>Name</div>
            <div>Email</div>
            <div>Status</div>
          </div>
          <div className="divide-y divide-[var(--border-default)]">
            {users.map((u) => (
              <div key={u.id} className="grid grid-cols-[2rem_1fr_1fr_6rem] gap-4 px-5 py-3 items-center hover:bg-[var(--bg-surface-muted)]">
                <div className="w-7 h-7 rounded-full bg-[#1662dd]/15 flex items-center justify-center text-xs font-bold text-[#1662dd]">
                  {u.displayName?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="text-sm text-[var(--text-primary)] font-medium truncate">{u.displayName}</div>
                <div className="text-sm text-[var(--text-secondary)] truncate">{u.email}</div>
                <StatusBadge status={u.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
