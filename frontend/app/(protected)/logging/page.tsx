import { apiFetch } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import LoggingGraph from './LoggingGraph';

interface AgentOption { id: string; name: string; oktaAgentId?: string; }

export default async function LoggingPage() {
  let agents: AgentOption[] = [];
  try { agents = await apiFetch<AgentOption[]>('/api/agents'); } catch {}

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Logging' }]} />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Logging</h1>
        <p className="text-[var(--text-secondary)] text-sm mt-1">
          Reconstructed token-flow history from Okta&apos;s System Log — read-only, filtered by time range, caller, agent, or resource.
        </p>
      </div>

      <LoggingGraph agents={agents} />
    </div>
  );
}
