'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, X, Bot, Blocks, RefreshCw, Cpu, ChevronRight, ArrowLeft } from 'lucide-react';
import AgentPicker from '@/components/AgentPicker';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface Caller { id: string; callerAgentId: string; callerName: string; }
interface AuthServer { id: string; name: string; orn: string; }
interface AgentOption { id: string; name: string; }

interface Props {
  agentId: string;
  resourceUrl?: string;
  streamlined: boolean;
}

type WizardStep = 'closed' | 'type' | 'agent' | 'details';

// ── Streamlined flow: pick a caller, submit — audience + shared authz server handled server-side ──
function StreamlinedMachineAccess({ agentId }: { agentId: string }) {
  const [callers, setCallers] = useState<Caller[]>([]);
  const [loadingCallers, setLoadingCallers] = useState(true);
  const [picking, setPicking] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState('');

  const loadCallers = useCallback(async () => {
    setLoadingCallers(true);
    try {
      const r = await fetch(`${BACKEND}/api/agents/${agentId}/delegations`);
      const d = await r.json();
      setCallers(Array.isArray(d) ? d : []);
    } catch { setCallers([]); }
    setLoadingCallers(false);
  }, [agentId]);

  useEffect(() => { loadCallers(); }, [loadCallers]);

  async function assign(agent: AgentOption) {
    setAssigning(true); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/machine-access/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerAgentId: agent.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to add caller'); setAssigning(false); return; }
      setPicking(false);
      await loadCallers();
    } catch (e: any) { setError(e.message); }
    setAssigning(false);
  }

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Authorized Callers ({loadingCallers ? '…' : callers.length})
          </span>
          <button
            onClick={() => { setPicking((o) => !o); setError(''); }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd]/15 border border-[#1662dd]/25 text-[#60a5fa] rounded-lg hover:bg-[#1662dd]/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add caller
          </button>
        </div>

        {loadingCallers ? (
          <div className="text-xs text-slate-500 text-center py-4">
            <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Loading callers…
          </div>
        ) : callers.length === 0 ? (
          <div className="text-xs text-slate-500 italic py-4 text-center border border-dashed border-[#1e293b] rounded-lg">
            No authorized callers yet
          </div>
        ) : (
          <div className="space-y-2">
            {callers.map((c) => (
              <div key={c.id} className="flex items-center gap-3 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#a78bfa]/15 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-[#a78bfa]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{c.callerName}</div>
                  <div className="text-xs text-slate-500">AI agent</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && !picking && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">{error}</div>
      )}

      {picking && (
        <div className="bg-[#0d1525] border border-[#1e293b] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Select the calling agent</h3>
            <button onClick={() => setPicking(false)} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2 mb-3">{error}</div>}
          {assigning ? (
            <div className="text-xs text-slate-500 text-center py-6">
              <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Authorizing…
            </div>
          ) : (
            <AgentPicker excludeAgentId={agentId} onSelect={assign} />
          )}
        </div>
      )}
    </div>
  );
}

export default function MachineAccess({ agentId, resourceUrl: initialResourceUrl, streamlined }: Props) {
  if (streamlined) return <StreamlinedMachineAccess agentId={agentId} />;
  return <LegacyMachineAccess agentId={agentId} resourceUrl={initialResourceUrl} />;
}

function LegacyMachineAccess({ agentId, resourceUrl: initialResourceUrl }: { agentId: string; resourceUrl?: string }) {
  const [resourceUrl, setResourceUrl] = useState(initialResourceUrl);
  const [callers, setCallers] = useState<Caller[]>([]);
  const [loadingCallers, setLoadingCallers] = useState(true);
  const [authServers, setAuthServers] = useState<AuthServer[]>([]);

  const [step, setStep] = useState<WizardStep>('closed');
  const [selectedAgent, setSelectedAgent] = useState<AgentOption | null>(null);
  const [selectedAuthServerId, setSelectedAuthServerId] = useState('');
  const [audienceInput, setAudienceInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadCallers = useCallback(async () => {
    setLoadingCallers(true);
    try {
      const r = await fetch(`${BACKEND}/api/agents/${agentId}/delegations`);
      const d = await r.json();
      setCallers(Array.isArray(d) ? d : []);
    } catch { setCallers([]); }
    setLoadingCallers(false);
  }, [agentId]);

  useEffect(() => {
    loadCallers();
    fetch(`${BACKEND}/api/agents/${agentId}/authorization-servers`)
      .then((r) => r.json())
      .then((d) => setAuthServers(Array.isArray(d) ? d : []))
      .catch(() => setAuthServers([]));
  }, [agentId, loadCallers]);

  function openWizard() {
    setStep('type');
    setSelectedAgent(null);
    setSelectedAuthServerId('');
    setAudienceInput('');
    setError('');
  }

  async function submit() {
    if (!selectedAgent || !selectedAuthServerId) return;
    setSaving(true); setError('');
    try {
      const body: any = { callerAgentId: selectedAgent.id, authorizationServerId: selectedAuthServerId };
      if (!resourceUrl) body.resourceUrl = audienceInput.trim();
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/delegations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to add caller'); setSaving(false); return; }
      if (!resourceUrl) setResourceUrl(audienceInput.trim());
      setStep('closed');
      await loadCallers();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  const needsAudience = !resourceUrl;
  const canSubmit = !!selectedAgent && !!selectedAuthServerId && (!needsAudience || audienceInput.trim().length > 0);

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Authorized Callers ({loadingCallers ? '…' : callers.length})
          </span>
          <button
            onClick={openWizard}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd]/15 border border-[#1662dd]/25 text-[#60a5fa] rounded-lg hover:bg-[#1662dd]/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add caller
          </button>
        </div>

        {loadingCallers ? (
          <div className="text-xs text-slate-500 text-center py-4">
            <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Loading callers…
          </div>
        ) : callers.length === 0 ? (
          <div className="text-xs text-slate-500 italic py-4 text-center border border-dashed border-[#1e293b] rounded-lg">
            No authorized callers yet
          </div>
        ) : (
          <div className="space-y-2">
            {callers.map((c) => (
              <div key={c.id} className="flex items-center gap-3 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#a78bfa]/15 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-[#a78bfa]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{c.callerName}</div>
                  <div className="text-xs text-slate-500">AI agent</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && step === 'closed' && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">{error}</div>
      )}

      {/* Step 1: select caller type */}
      {step === 'type' && (
        <div className="bg-[#0d1525] border border-[#1e293b] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">What is calling this agent?</h3>
            <button onClick={() => setStep('closed')} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setStep('agent')}
              className="flex flex-col items-start gap-2 px-4 py-3.5 bg-[#0a0f1e] border border-[#1e293b] hover:border-[#1662dd]/40 rounded-lg text-left transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-[#a78bfa]/15 flex items-center justify-center">
                <Bot className="w-4 h-4 text-[#a78bfa]" />
              </div>
              <div className="text-sm font-semibold text-white">AI agent</div>
              <div className="text-xs text-slate-500">Another AI agent registered in Okta.</div>
            </button>
            <div className="flex flex-col items-start gap-2 px-4 py-3.5 bg-[#0a0f1e]/50 border border-[#1e293b] rounded-lg text-left opacity-50 cursor-not-allowed">
              <div className="w-8 h-8 rounded-lg bg-slate-500/15 flex items-center justify-center">
                <Blocks className="w-4 h-4 text-slate-500" />
              </div>
              <div className="text-sm font-semibold text-slate-400">Application or service</div>
              <div className="text-xs text-slate-600">Coming soon</div>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: pick the calling agent */}
      {step === 'agent' && (
        <div className="bg-[#0d1525] border border-[#1e293b] rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => setStep('type')} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white">
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <span className="text-slate-600">·</span>
            <h3 className="text-sm font-semibold text-white">Select the calling agent</h3>
            <button onClick={() => setStep('closed')} className="ml-auto text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <AgentPicker
            excludeAgentId={agentId}
            onSelect={(a) => { setSelectedAgent(a); setStep('details'); }}
          />
        </div>
      )}

      {/* Step 3: authorization server + audience, then save */}
      {step === 'details' && selectedAgent && (
        <div className="bg-[#0d1525] border border-[#1e293b] rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => setStep('agent')} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white">
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <span className="text-slate-600">·</span>
            <h3 className="text-sm font-semibold text-white">Configure access</h3>
            <button onClick={() => setStep('closed')} className="ml-auto text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
          </div>

          <div className="flex items-center gap-2 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2.5 mb-4">
            <Cpu className="w-4 h-4 text-[#a78bfa] flex-shrink-0" />
            <span className="text-sm text-white truncate">{selectedAgent.name}</span>
          </div>

          {needsAudience && (
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                Audience / Resource URL
              </label>
              <input
                value={audienceInput}
                onChange={(e) => setAudienceInput(e.target.value)}
                placeholder="https://your-agent"
                className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-[#1662dd]/40"
              />
              <p className="text-[11px] text-amber-300/80 mt-1.5">
                Identifies this agent as a protected resource. Cannot be changed after saving.
              </p>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
              Authorization server
            </label>
            <select
              value={selectedAuthServerId}
              onChange={(e) => setSelectedAuthServerId(e.target.value)}
              className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#1662dd]/40"
            >
              <option value="">Select a custom authorization server…</option>
              {authServers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-600 mt-1.5">
              The Okta org authorization server isn&apos;t supported for machine callers.
            </p>
          </div>

          {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2 mb-3">{error}</div>}

          <button
            onClick={submit}
            disabled={!canSubmit || saving}
            className="flex items-center gap-2 px-4 py-2 bg-[#1662dd] hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}
