import Link from 'next/link';
import { apiFetch, Agent } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import { Bot, Users, Puzzle, Plus } from 'lucide-react';

export default async function DashboardPage() {
  let agents: Agent[] = [];
  let resourceCount = 0;

  try {
    agents = await apiFetch<Agent[]>('/api/agents');
    const resources = await apiFetch<any[]>('/api/resources');
    resourceCount = resources.length;
  } catch {}

  const withOwners = agents.filter((a) => a.ownerId).length;
  const recent = agents.slice(0, 5);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Dashboard</h1>
          <p className="text-[var(--text-secondary)] text-sm mt-1">Manage your AI agents registered in Okta</p>
        </div>
        <Link
          href="/agents/new"
          className="flex items-center gap-2 px-4 py-2 bg-[#1662dd] hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> New Agent
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Total Agents', value: agents.length, icon: Bot, colour: '#1662dd' },
          { label: 'Agents with Owners', value: withOwners, icon: Users, colour: '#10b981' },
          { label: 'Available Resources', value: resourceCount, icon: Puzzle, colour: '#8b5cf6' },
        ].map(({ label, value, icon: Icon, colour }) => (
          <div key={label} className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${colour}1a` }}>
                <Icon className="w-5 h-5" style={{ color: colour }} />
              </div>
              <div>
                <div className="text-2xl font-bold text-[var(--text-primary)]">{value}</div>
                <div className="text-xs text-[var(--text-secondary)]">{label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg">
        <div className="px-5 py-4 border-b border-[var(--border-default)] flex items-center justify-between">
          <h2 className="font-semibold text-[var(--text-primary)] text-sm">Recent Agents</h2>
          <Link href="/agents" className="text-xs text-[#1662dd] hover:underline">View all →</Link>
        </div>
        {recent.length === 0 ? (
          <div className="px-5 py-10 text-center text-[var(--text-secondary)] text-sm">
            No agents yet.{' '}
            <Link href="/agents/new" className="text-[#1662dd] hover:underline">Create your first agent</Link>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-default)]">
            {recent.map((a) => (
              <Link key={a.id} href={`/agents/${a.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-[var(--bg-surface-muted)] transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-[#1662dd]/10 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-[#1662dd]" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-[var(--text-primary)]">{a.name}</div>
                    <div className="text-xs text-[var(--text-secondary)]">{a.ownerName || 'No owner'} · {a.resourceCount || 0} resources</div>
                  </div>
                </div>
                <StatusBadge status={a.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
