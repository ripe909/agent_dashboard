'use client';
import { useState, useEffect } from 'react';
import { RefreshCw, Play, Key, AlertCircle, Link2 } from 'lucide-react';
import TokenStepCard, { TokenResult } from '@/components/TokenStepCard';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface AgentOption { id: string; name: string; oktaAgentId?: string; }
interface Target { id: string; targetAgentId: string; targetName: string; }
interface AuthServerConnection { id: string; connectionType: string; authorizationServer?: { name: string; issuerUrl?: string }; resourceIndicator?: string; }

interface CredentialStatus {
  authMethod: string;
  exercisable: boolean;
  hasCredential?: boolean;
}

// Value-prefixed selection so a single dropdown can offer both kinds of "next step": another
// AI agent to continue the chain to, or a Custom Authorization Server connection that terminates it.
type NextStepValue = `agent:${string}` | `authserver:${string}`;

// Shared downstream step for both Machine Access and User Access: given an agent that already
// holds an initial subject token (rid, stashed server-side by whichever flow produced it), check
// it has a test credential of its own, then let the user pick either a downstream agent it's
// authorized to call (continuing the chain) or a connected Authorization Server (a terminal hop) —
// recursing this same component one level deeper for an agent hop, since the delegated token that
// hop produces gives the target its own rid to exercise from.
export default function AgentExerciseStep({ agentId, agentName, agents, rid }: { agentId: string; agentName: string; agents: AgentOption[]; rid: string }) {
  const [credStatus, setCredStatus] = useState<CredentialStatus | null>(null);
  const [checkingCredential, setCheckingCredential] = useState(false);
  const [credentialMode, setCredentialMode] = useState<'generate' | 'paste'>('generate');
  const [pastedSecret, setPastedSecret] = useState('');
  const [pastedKid, setPastedKid] = useState('');
  const [pastedKey, setPastedKey] = useState('');
  const [savingCredential, setSavingCredential] = useState(false);

  const [targets, setTargets] = useState<Target[]>([]);
  const [authServerConnections, setAuthServerConnections] = useState<AuthServerConnection[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [selection, setSelection] = useState<NextStepValue | ''>('');

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ step2: TokenResult; step3: TokenResult | null } | null>(null);
  const [next, setNext] = useState<{ rid: string; agentId: string; agentName: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setCheckingCredential(true);
    setResult(null); setNext(null); setError(''); setSelection('');
    fetch(`${BACKEND}/api/exercise/agents/${agentId}/machine-credential`)
      .then((r) => r.json())
      .then(setCredStatus)
      .catch(() => setCredStatus(null))
      .finally(() => setCheckingCredential(false));
  }, [agentId]);

  useEffect(() => {
    if (!credStatus?.hasCredential) { setTargets([]); setAuthServerConnections([]); return; }
    setLoadingTargets(true);
    Promise.all([
      fetch(`${BACKEND}/api/agents/${agentId}/delegations-from`).then((r) => r.json()).catch(() => []),
      fetch(`${BACKEND}/api/agents/${agentId}/connections`).then((r) => r.json()).catch(() => []),
    ]).then(([delegations, connections]) => {
      setTargets(Array.isArray(delegations) ? delegations : []);
      setAuthServerConnections(
        Array.isArray(connections) ? connections.filter((c: AuthServerConnection) => c.connectionType === 'IDENTITY_ASSERTION_CUSTOM_AS') : []
      );
    }).finally(() => setLoadingTargets(false));
  }, [agentId, credStatus?.hasCredential]);

  async function saveCredential() {
    setSavingCredential(true); setError('');
    try {
      const body = credentialMode === 'generate'
        ? { mode: 'generate' }
        : credStatus?.authMethod === 'private_key_jwt'
          ? { mode: 'paste', kid: pastedKid.trim(), privateKeyPem: pastedKey.trim() }
          : { mode: 'paste', clientSecret: pastedSecret.trim() };
      const res = await fetch(`${BACKEND}/api/exercise/agents/${agentId}/machine-credential`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save credential'); setSavingCredential(false); return; }
      setCredStatus((prev) => (prev ? { ...prev, hasCredential: true } : prev));
      setPastedSecret(''); setPastedKid(''); setPastedKey('');
    } catch (e: any) { setError(e.message); }
    setSavingCredential(false);
  }

  async function run() {
    if (!selection) return;
    setRunning(true); setError(''); setResult(null); setNext(null);
    try {
      const [kind, id] = selection.split(':', 2) as ['agent' | 'authserver', string];
      const endpoint = kind === 'agent' ? 'continue' : 'continue-to-authserver';
      const body = kind === 'agent' ? { rid, targetAgentId: id } : { rid, connectionId: id };
      const res = await fetch(`${BACKEND}/api/exercise/agents/exercise/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to run exercise'); setRunning(false); return; }
      setResult(data);
      if (kind === 'agent' && data.nextRid) {
        const target = targets.find((t) => agents.find((a) => a.oktaAgentId === t.targetAgentId)?.id === id);
        if (target) setNext({ rid: data.nextRid, agentId: id, agentName: target.targetName });
      }
    } catch (e: any) { setError(e.message); }
    setRunning(false);
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-[var(--text-secondary)]">
        Using: <span className="font-semibold text-[var(--text-primary)]">{agentName}</span>
      </div>

      {checkingCredential && (
        <div className="text-xs text-[var(--text-secondary)] py-2"><RefreshCw className="w-3.5 h-3.5 animate-spin inline mr-2" />Checking test credential…</div>
      )}

      {credStatus && !credStatus.exercisable && (
        <div className="text-xs text-[var(--text-secondary)] italic py-2 text-center border border-dashed border-[var(--border-default)] rounded-lg">
          This agent&apos;s auth method (&quot;none&quot;) has no credential to exercise with
        </div>
      )}

      {credStatus?.exercisable && credStatus.hasCredential === false && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-700">
            <Key className="w-3.5 h-3.5" /> No test credential stored for this agent yet ({credStatus.authMethod})
          </div>
          <div className="flex items-center gap-4 text-xs">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={credentialMode === 'generate'} onChange={() => setCredentialMode('generate')} className="accent-[#1662dd]" />
              Generate a new {credStatus.authMethod === 'private_key_jwt' ? 'key' : 'secret'}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={credentialMode === 'paste'} onChange={() => setCredentialMode('paste')} className="accent-[#1662dd]" />
              Paste an existing one
            </label>
          </div>
          {credentialMode === 'paste' && credStatus.authMethod === 'private_key_jwt' ? (
            <>
              <input
                value={pastedKid}
                onChange={(e) => setPastedKid(e.target.value)}
                placeholder="Key ID (kid)"
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[#1662dd]/40"
              />
              <textarea
                value={pastedKey}
                onChange={(e) => setPastedKey(e.target.value)}
                placeholder="Private key (PEM)"
                rows={4}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[#1662dd]/40 font-mono resize-none"
              />
            </>
          ) : credentialMode === 'paste' ? (
            <input
              value={pastedSecret}
              onChange={(e) => setPastedSecret(e.target.value)}
              placeholder="Client secret"
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[#1662dd]/40"
            />
          ) : null}
          <button
            onClick={saveCredential}
            disabled={savingCredential || (credentialMode === 'paste' && (credStatus.authMethod === 'private_key_jwt' ? !pastedKid.trim() || !pastedKey.trim() : !pastedSecret.trim()))}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1662dd] hover:bg-blue-600 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {savingCredential ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
            {savingCredential ? 'Saving…' : 'Save credential'}
          </button>
          <p className="text-[11px] text-amber-700/80">Stored server-side so future exercises can reuse it — this dashboard never re-shows it.</p>
        </div>
      )}

      {credStatus?.exercisable && credStatus.hasCredential === true && (
        <div>
          <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1.5">Next step</label>
          {loadingTargets ? (
            <div className="text-xs text-[var(--text-secondary)] py-2"><RefreshCw className="w-3.5 h-3.5 animate-spin inline mr-2" />Loading what this agent can reach…</div>
          ) : targets.length === 0 && authServerConnections.length === 0 ? (
            <div className="text-xs text-[var(--text-secondary)] italic py-2 text-center border border-dashed border-[var(--border-default)] rounded-lg">
              This agent has no further downstream agents or connected resources — configure Machine Access or a Resource Connection first
            </div>
          ) : (
            <select
              value={selection}
              onChange={(e) => { setSelection(e.target.value as NextStepValue); setResult(null); setNext(null); }}
              className="w-full bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#1662dd]/40"
            >
              <option value="">Select the next hop…</option>
              {targets.map((t) => {
                // delegations-from returns targetAgentId as the OKTA agent id — resolve it back
                // to this dashboard's internal id so exercise routes get the right value.
                const dashboardId = agents.find((a) => a.oktaAgentId === t.targetAgentId)?.id;
                if (!dashboardId) return null;
                return <option key={t.id} value={`agent:${dashboardId}`}>{t.targetName} (AI agent)</option>;
              })}
              {authServerConnections.map((c) => (
                <option key={c.id} value={`authserver:${c.id}`}>{c.authorizationServer?.name || 'Authorization server'} (final step)</option>
              ))}
            </select>
          )}
        </div>
      )}

      {selection && (
        <button
          onClick={run}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2 bg-[#1662dd] hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {running ? 'Running…' : 'Exercise this agent'}
        </button>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <TokenStepCard title="ID-JAG (Token Exchange)" step={result.step2} />
          <TokenStepCard title="Final Delegated Token" step={result.step3} />
        </div>
      )}

      {next && (
        <div className="pl-4 border-l-2 border-[#1662dd]/25 ml-1 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1662dd]">
            <Link2 className="w-3.5 h-3.5" /> Continuing as {next.agentName}
          </div>
          <AgentExerciseStep agentId={next.agentId} agentName={next.agentName} agents={agents} rid={next.rid} />
        </div>
      )}
    </div>
  );
}
