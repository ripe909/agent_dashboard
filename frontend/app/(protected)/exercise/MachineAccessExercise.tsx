'use client';
import { useState } from 'react';
import { RefreshCw, Play, AlertCircle } from 'lucide-react';
import TokenStepCard, { TokenResult } from '@/components/TokenStepCard';
import AgentExerciseStep from './AgentExerciseStep';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface AgentOption { id: string; name: string; oktaAgentId?: string; }

export default function MachineAccessExercise({ agents }: { agents: AgentOption[] }) {
  const [agentId, setAgentId] = useState('');
  const [running, setRunning] = useState(false);
  const [step1, setStep1] = useState<TokenResult | null>(null);
  const [rid, setRid] = useState('');
  const [error, setError] = useState('');

  async function getToken() {
    setRunning(true); setError(''); setStep1(null); setRid('');
    try {
      const res = await fetch(`${BACKEND}/api/exercise/agents/${agentId}/machine-access/token`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to get token'); setRunning(false); return; }
      setStep1(data.step1);
      if (data.rid) setRid(data.rid);
    } catch (e: any) { setError(e.message); }
    setRunning(false);
  }

  const agentName = agents.find((a) => a.id === agentId)?.name || '';

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1.5">Agent</label>
        <select
          value={agentId}
          onChange={(e) => { setAgentId(e.target.value); setStep1(null); setRid(''); setError(''); }}
          className="w-full bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#1662dd]/40"
        >
          <option value="">Which agent will act on its own behalf?</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {agentId && (
        <button
          onClick={getToken}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2 bg-[#1662dd] hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {running ? 'Getting token…' : 'Get access token'}
        </button>
      )}

      <p className="text-[11px] text-[var(--text-muted)]">
        Runs a real client_credentials grant as the configured service client, scoped to this
        agent&apos;s own resource — proving the agent can obtain a token it can then use to call
        downstream agents on its own behalf.
      </p>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </div>
      )}

      {step1 && <TokenStepCard title="Access Token (Service Client Grant)" step={step1} />}

      {rid && step1?.ok && (
        <AgentExerciseStep agentId={agentId} agentName={agentName} agents={agents} rid={rid} />
      )}
    </div>
  );
}
