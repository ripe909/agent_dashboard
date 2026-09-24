import { Suspense } from 'react';
import { apiFetch } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import { Cpu, UserCheck } from 'lucide-react';
import MachineAccessExercise from './MachineAccessExercise';
import UserAccessExercise from './UserAccessExercise';

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
          Run real live token requests against onboarded agents to prove access actually works.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <section className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-[#a78bfa]" /> Machine Access
          </h2>
          <MachineAccessExercise agents={agents} />
        </section>

        <section className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <UserCheck className="w-3.5 h-3.5 text-emerald-600" /> User Access
          </h2>
          <Suspense fallback={null}>
            <UserAccessExercise agents={agents} />
          </Suspense>
        </section>
      </div>
    </div>
  );
}
