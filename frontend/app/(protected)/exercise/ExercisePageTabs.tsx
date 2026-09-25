'use client';
import { Suspense, useState } from 'react';
import { Cpu, UserCheck, Workflow, ListTree } from 'lucide-react';
import MachineAccessExercise from './MachineAccessExercise';
import UserAccessExercise from './UserAccessExercise';
import ExerciseGraph from './graph/ExerciseGraph';

interface AgentOption { id: string; name: string; oktaAgentId?: string; }

const TABS = [
  { id: 'designer', label: 'Configuration designer', icon: Workflow },
  { id: 'manual', label: 'Manual configuration', icon: ListTree },
] as const;

type TabId = typeof TABS[number]['id'];

// Mirrors the tab pattern in Okta's own Admin Console agent detail page (Manual configuration /
// Configuration designer) — the graph is the new default view; the original step-by-step flow is
// kept unchanged underneath as a fallback rather than deleted.
export default function ExercisePageTabs({ agents }: { agents: AgentOption[] }) {
  const [tab, setTab] = useState<TabId>('designer');

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-[var(--border-default)] mb-6">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                active
                  ? 'border-[#1662dd] text-[#1662dd]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'designer' && <ExerciseGraph agents={agents} />}

      {tab === 'manual' && (
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
      )}
    </div>
  );
}
