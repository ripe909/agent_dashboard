import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import SyncOwnersButton from '@/components/SyncOwnersButton';
import Breadcrumbs from '@/components/Breadcrumbs';
import { Bot, Plus, User, Puzzle, Shield, Zap } from 'lucide-react';

interface AgentRow {
  id: string; name: string; description?: string; oktaAgentId?: string;
  ownerId?: string; ownerName?: string; ownerEmail?: string;
  status: string; oktaStatus?: string;
  resourceCount?: number; createdAt: string;
}

function initials(name?: string) { return name?.trim()?.[0]?.toUpperCase() || '?'; }

export default async function AgentsPage() {
  let agents: AgentRow[] = [];
  try { agents = await apiFetch<AgentRow[]>('/api/agents'); } catch {}

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Directory' }, { label: 'AI Agents' }]} />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">AI Agents</h1>
          <p className="text-[var(--text-secondary)] text-sm mt-1">
            {agents.length} agent{agents.length !== 1 ? 's' : ''} registered in Okta — live sync
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SyncOwnersButton scope="all" />
          <Link href="/agents/new" className="flex items-center gap-2 px-4 py-2 bg-[#1662dd] hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> New Agent
          </Link>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-6 py-16 text-center">
          <Bot className="w-10 h-10 text-[var(--text-muted)] mx-auto mb-3" />
          <div className="text-[var(--text-primary)] font-medium mb-1">No agents yet</div>
          <p className="text-[var(--text-secondary)] text-sm mb-5">Register your first AI agent in Okta</p>
          <Link href="/agents/new" className="inline-flex items-center gap-2 px-4 py-2 bg-[#1662dd] text-white text-sm rounded-lg font-semibold">
            <Plus className="w-4 h-4" /> Create Agent
          </Link>
        </div>
      ) : (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg overflow-hidden">
          <div className="divide-y divide-[var(--border-default)]">
            {agents.map((a) => {
              const liveStatus = a.oktaStatus || a.status;
              return (
                <Link
                  key={a.id}
                  href={`/agents/${a.id}`}
                  className="block px-4 py-4 hover:bg-[var(--bg-surface-muted)] transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-9 h-9 rounded-lg bg-[#1662dd]/10 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-5 h-5 text-[#1662dd]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-[var(--text-primary)] text-sm">{a.name}</span>
                        <StatusBadge status={liveStatus} />
                      </div>
                      {a.description && <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate max-w-md">{a.description}</p>}
                      {a.oktaAgentId && (
                        <span className="text-xs text-[var(--text-muted)] font-mono">{a.oktaAgentId}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0 text-xs text-[var(--text-secondary)]">
                      {a.ownerId ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-[#1662dd]/15 flex items-center justify-center text-xs font-bold text-[#1662dd]">
                            {initials(a.ownerName)}
                          </div>
                          <span className="text-[var(--text-primary)] text-xs">{a.ownerName}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[var(--text-muted)]">
                          <User className="w-3.5 h-3.5" /><span className="italic">No owner</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-[var(--text-muted)]">
                        <Puzzle className="w-3.5 h-3.5" />
                        <span>{a.resourceCount || 0} connections</span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
