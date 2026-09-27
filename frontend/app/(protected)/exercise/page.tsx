import { apiFetch } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import ExerciseGraph from './graph/ExerciseGraph';

interface AgentOption { id: string; name: string; oktaAgentId?: string; }

export default async function ExercisePage() {
  let agents: AgentOption[] = [];
  try { agents = await apiFetch<AgentOption[]>('/api/agents'); } catch {}

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Exercise' }]} />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Exercise Agent</h1>
        <p className="text-[var(--text-secondary)] text-sm mt-1">
          Run live token requests against onboarded agents.
        </p>
      </div>

      <ExerciseGraph agents={agents} />
    </div>
  );
}
