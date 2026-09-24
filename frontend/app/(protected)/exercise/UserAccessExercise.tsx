'use client';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { UserCheck, RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';
import AgentExerciseStep from './AgentExerciseStep';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface AgentOption { id: string; name: string; oktaAgentId?: string; }

function JsonBlock({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1">{label}</div>
      <pre className="text-[11px] text-[var(--text-primary)] bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed max-h-64">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default function UserAccessExercise({ agents }: { agents: AgentOption[] }) {
  const [agentId, setAgentId] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [decoded, setDecoded] = useState<{ idToken: any; accessToken: any } | null>(null);
  const [rid, setRid] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const resultRid = searchParams.get('result');
    const err = searchParams.get('error');
    if (err) { setError(err); router.replace('/exercise'); return; }
    if (!resultRid) return;
    fetch(`${BACKEND}/api/exercise/agents/user-access/result/${resultRid}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) {
          const { agentId: resultAgentId, ...decodedTokens } = d;
          setDecoded(decodedTokens);
          setRid(resultRid);
          if (resultAgentId) setAgentId(resultAgentId);
        }
      })
      .catch(() => {})
      .finally(() => router.replace('/exercise'));
  }, [searchParams, router]);

  async function startLogin() {
    setStarting(true); setError(''); setDecoded(null); setRid('');
    try {
      const res = await fetch(`${BACKEND}/api/exercise/agents/${agentId}/user-access/start`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to start login'); setStarting(false); return; }
      window.open(data.authorizeUrl, '_blank', 'noopener,noreferrer');
    } catch (e: any) { setError(e.message); }
    setStarting(false);
  }

  const agentName = agents.find((a) => a.id === agentId)?.name || '';

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1.5">Agent</label>
        <select
          value={agentId}
          onChange={(e) => { setAgentId(e.target.value); setDecoded(null); setRid(''); setError(''); }}
          className="w-full bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#1662dd]/40"
        >
          <option value="">Select the agent to sign in through…</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {agentId && (
        <button
          onClick={startLogin}
          disabled={starting}
          className="flex items-center gap-2 px-4 py-2 bg-[#1662dd] hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {starting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
          {starting ? 'Starting…' : 'Start test login'}
          {!starting && <ExternalLink className="w-3.5 h-3.5 opacity-60" />}
        </button>
      )}

      <p className="text-[11px] text-[var(--text-muted)]">
        Opens a real Okta login in a new tab. This configures the agent&apos;s backing app for a
        real code exchange and a callback back to this dashboard — after signing in you&apos;ll be
        redirected here with the decoded tokens below.
      </p>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </div>
      )}

      {decoded && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Login result</h3>
          <p className="text-[11px] text-[var(--text-muted)]">Decoded claims — signature not verified, this is an inspector, not a security check.</p>
          {decoded.idToken && <JsonBlock label="ID Token claims" value={decoded.idToken} />}
          {decoded.accessToken && <JsonBlock label="Access Token claims" value={decoded.accessToken} />}
        </div>
      )}

      {rid && decoded && (
        <AgentExerciseStep agentId={agentId} agentName={agentName} agents={agents} rid={rid} />
      )}
    </div>
  );
}
