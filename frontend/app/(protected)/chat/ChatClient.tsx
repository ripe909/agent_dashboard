'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Send, RefreshCw, ChevronDown, ChevronRight, Bot, User, LogIn, LogOut, Calendar, DollarSign } from 'lucide-react';
import AgentCombobox from '@/components/AgentCombobox';
import type { TokenResult } from '@/components/TokenStepCard';
import ChatGraphPanel from './ChatGraphPanel';
import type { ChatHopTrace } from './chatGraph';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface AgentOption { id: string; name: string; description?: string; }
interface ToolCallRecord { name: string; args: any; result: any; }
interface Message { role: 'user' | 'assistant'; content: string; toolCalls?: ToolCallRecord[]; }

interface Campaign {
  id: string;
  name: string;
  description?: string | null;
  status?: string;
  budget?: string | number | null;
  startDate?: string | null;
  endDate?: string | null;
}

// Tool results come back as MCP content blocks — a JSON-stringified campaign (or array of them)
// inside a single text block. Pulls out anything shaped like a campaign so it can render as a
// card instead of raw JSON; skips delete_campaign's {deleted: id} result and anything else.
function extractCampaigns(toolCalls?: ToolCallRecord[]): Campaign[] {
  if (!toolCalls) return [];
  const byId = new Map<string, Campaign>();
  for (const tc of toolCalls) {
    const text = tc.result?.content?.[0]?.text;
    if (typeof text !== 'string') continue;
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { continue; }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const c of candidates) {
      if (c && typeof c === 'object' && typeof c.id === 'string' && typeof c.name === 'string') {
        byId.set(c.id, c);
      }
    }
  }
  return Array.from(byId.values());
}

type ScopeMode = 'readonly' | 'full';
const SCOPE_MODE_LABELS: Record<ScopeMode, string> = { readonly: 'Read-only', full: 'Full access' };

// loginRid -> which agent+scopeMode it's valid for, kept in sessionStorage so a page reload (or
// the full navigation the Okta login redirect causes) doesn't lose it — the id_token itself never
// reaches the browser at all, only this opaque rid the backend keeps mapped to it. Keyed by mode
// too so testing an agent under both read-only and full access doesn't require re-logging in each
// time you switch back and forth.
function storeLoginRid(agentId: string, mode: ScopeMode, rid: string) {
  sessionStorage.setItem(`chat-login:${agentId}:${mode}`, rid);
}
function getLoginRid(agentId: string, mode: ScopeMode): string | null {
  return sessionStorage.getItem(`chat-login:${agentId}:${mode}`);
}

export default function ChatClient({ agents }: { agents: AgentOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedAgent, setSelectedAgent] = useState<AgentOption | null>(null);
  // Which scope-mode session is currently active in the chat window, and the rid backing it.
  const [activeMode, setActiveMode] = useState<ScopeMode | null>(null);
  const [loginRid, setLoginRid] = useState<string | null>(null);
  const [loggingInMode, setLoggingInMode] = useState<ScopeMode | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  // The read-only token-flow graph's data — populated from /message's response on every send, and
  // hydrated from /session/:loginRid whenever an existing session is resumed (page reload, mode
  // switch) so the graph isn't blank until the next message.
  const [loginInfo, setLoginInfo] = useState<TokenResult | null>(null);
  const [tokenTrace, setTokenTrace] = useState<{ hops: ChatHopTrace[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Both panels' heights are user-resizable via the drag bar between them — chatHeight is the
  // chat card's own height (its internal message list is flex-1, so it absorbs the change);
  // graphCanvasHeight is just the React Flow canvas inside ChatGraphPanel, since that panel's
  // header/inspector below it size themselves to content either way.
  const [graphExpanded, setGraphExpanded] = useState(false);
  const [chatHeight, setChatHeight] = useState(600);
  const [graphCanvasHeight, setGraphCanvasHeight] = useState(260);
  const resizeRef = useRef<{ startY: number; startChatHeight: number; startGraphHeight: number } | null>(null);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    resizeRef.current = { startY: e.clientY, startChatHeight: chatHeight, startGraphHeight: graphCanvasHeight };
    function onMove(ev: MouseEvent) {
      const drag = resizeRef.current;
      if (!drag) return;
      const delta = ev.clientY - drag.startY;
      setChatHeight(Math.max(300, drag.startChatHeight + delta));
      // With the panel collapsed there's no visible canvas to trade height with — just resize the
      // chat card on its own; the canvas height still updates so it's not lost for next expand.
      if (graphExpanded) setGraphCanvasHeight(Math.max(140, drag.startGraphHeight - delta));
    }
    function onUp() {
      resizeRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Resume after the Okta login redirect lands back here — a full page navigation, so in-memory
  // state doesn't survive it; the agent selection and rid round-trip through the URL/sessionStorage.
  useEffect(() => {
    const result = searchParams.get('loginResult');
    const err = searchParams.get('loginError');
    const agentId = searchParams.get('agentId');
    const mode = searchParams.get('scopeMode');
    if (err) { setError(err); router.replace('/chat'); return; }
    if (result && agentId && (mode === 'readonly' || mode === 'full')) {
      const agent = agents.find((a) => a.id === agentId);
      if (agent) {
        storeLoginRid(agentId, mode, result);
        setSelectedAgent(agent);
        setActiveMode(mode);
        setLoginRid(result);
        setError('');
        checkSessionValid(agentId, result);
      }
      router.replace('/chat');
      return;
    }
    // Plain deep-link (e.g. the portal's "Chat with Agent" button) — pre-select the agent if
    // it's actually eligible (connected to the Campaigns AS); otherwise leave the picker as-is,
    // since there's nothing useful to select yet.
    if (agentId && !result) {
      const agent = agents.find((a) => a.id === agentId);
      if (agent) selectAgent(agent);
      router.replace('/chat');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, agents]);

  // A loginRid cached in sessionStorage can outlive the backend's own in-memory session for it —
  // e.g. a backend restart wipes chatSessions entirely, but sessionStorage still says "logged in".
  // Without checking, the UI would show a plain mode-switch button (no network call at all) that
  // silently does nothing forever, since switchMode never talks to the backend. Verifying first
  // means a stale rid always falls back to a real "Log in" click instead of a dead button.
  async function checkSessionValid(agentId: string, rid: string): Promise<boolean> {
    try {
      const res = await fetch(`${BACKEND}/api/chat/${agentId}/session/${rid}`);
      const data = await res.json();
      if (data.valid) {
        setLoginInfo(data.login ?? null);
        setTokenTrace(data.tokenTrace ?? null);
      }
      return !!data.valid;
    } catch {
      return false;
    }
  }

  async function selectAgent(agent: AgentOption) {
    setSelectedAgent(agent);
    setMessages([]);
    setError('');
    setLoginInfo(null); setTokenTrace(null);
    // Prefer a full-access session if one already exists, else read-only, else none — either way
    // the login buttons below make it obvious which mode (if any) is actually active.
    const fullRid = getLoginRid(agent.id, 'full');
    const readonlyRid = getLoginRid(agent.id, 'readonly');
    if (fullRid && await checkSessionValid(agent.id, fullRid)) { setActiveMode('full'); setLoginRid(fullRid); return; }
    if (fullRid) sessionStorage.removeItem(`chat-login:${agent.id}:full`);
    if (readonlyRid && await checkSessionValid(agent.id, readonlyRid)) { setActiveMode('readonly'); setLoginRid(readonlyRid); return; }
    if (readonlyRid) sessionStorage.removeItem(`chat-login:${agent.id}:readonly`);
    setActiveMode(null); setLoginRid(null);
  }

  async function login(mode: ScopeMode) {
    if (!selectedAgent) return;
    setLoggingInMode(mode);
    setError('');
    try {
      const res = await fetch(`${BACKEND}/api/chat/${selectedAgent.id}/login/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scopeMode: mode }),
      });
      const data = await res.json();
      if (!res.ok || !data.authorizeUrl) throw new Error(data.error || 'Failed to start login');
      window.location.href = data.authorizeUrl;
    } catch (e: any) {
      setError(e.message);
      setLoggingInMode(null);
    }
  }

  async function switchMode(mode: ScopeMode) {
    if (!selectedAgent) return;
    const rid = getLoginRid(selectedAgent.id, mode);
    if (rid && await checkSessionValid(selectedAgent.id, rid)) {
      setActiveMode(mode);
      setLoginRid(rid);
      setMessages([]);
      return;
    }
    // Stale — the cached rid no longer maps to a real backend session. Clear it and fall through
    // to a real login instead of leaving the button looking clickable but doing nothing.
    if (rid) sessionStorage.removeItem(`chat-login:${selectedAgent.id}:${mode}`);
    setActiveMode(null); setLoginRid(null);
    login(mode);
  }

  // Ends the active session both server-side (so a later switchMode/selectAgent can't silently
  // resume it — checkSessionValid would otherwise still find it and treat it as "already logged
  // in") and in sessionStorage, and clears everything the UI was showing for it.
  async function logout() {
    if (!selectedAgent || !activeMode || !loginRid) return;
    try {
      await fetch(`${BACKEND}/api/chat/${selectedAgent.id}/session/${loginRid}/logout`, { method: 'POST' });
    } catch {}
    sessionStorage.removeItem(`chat-login:${selectedAgent.id}:${activeMode}`);
    setActiveMode(null);
    setLoginRid(null);
    setMessages([]);
    setLoginInfo(null);
    setTokenTrace(null);
  }

  async function sendMessage() {
    if (!input.trim() || !selectedAgent || !loginRid || sending) return;
    const userMessage: Message = { role: 'user', content: input.trim() };
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setSending(true);
    setError('');

    try {
      const res = await fetch(`${BACKEND}/api/chat/${selectedAgent.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginRid, message: userMessage.content, history }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.requiresLogin && selectedAgent && activeMode) {
          sessionStorage.removeItem(`chat-login:${selectedAgent.id}:${activeMode}`);
          setLoginRid(null);
        }
        throw new Error(data.error || 'Chat request failed');
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply, toolCalls: data.toolCalls }]);
      if (data.login) setLoginInfo(data.login);
      if (data.tokenTrace) setTokenTrace(data.tokenTrace);
    } catch (e: any) {
      setError(e.message);
    }
    setSending(false);
  }

  return (
    <div>
      <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl flex flex-col" style={{ height: chatHeight }}>
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border-default)] rounded-t-xl">
          <div className="w-64">
            <AgentCombobox
              agents={agents}
              value={selectedAgent?.id || ''}
              onSelect={selectAgent}
              emptyMessage="No agents are connected to the Campaigns authorization server yet"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            {selectedAgent && (['readonly', 'full'] as const).map((mode) => {
              const hasSession = !!getLoginRid(selectedAgent.id, mode);
              const isActive = activeMode === mode && !!loginRid;
              return (
                <button
                  key={mode}
                  onClick={() => hasSession ? switchMode(mode) : login(mode)}
                  disabled={loggingInMode !== null}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
                    isActive
                      ? 'bg-[#1662dd] border-[#1662dd] text-white'
                      : 'bg-[#1662dd]/15 border-[#1662dd]/25 text-[#1662dd] hover:bg-[#1662dd]/25'
                  }`}
                >
                  {loggingInMode === mode ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
                  {hasSession ? SCOPE_MODE_LABELS[mode] : `Log in — ${SCOPE_MODE_LABELS[mode]}`}
                </button>
              );
            })}
            {selectedAgent && activeMode && loginRid && (
              <button
                onClick={logout}
                title="Log out of this session"
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" /> Log out
              </button>
            )}
            {sending && <RefreshCw className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {!selectedAgent ? (
            <div className="h-full flex items-center justify-center text-sm text-[var(--text-secondary)]">
              Select an agent above to start chatting
            </div>
          ) : !loginRid ? (
            <div className="h-full flex items-center justify-center text-sm text-[var(--text-secondary)]">
              Log in as {selectedAgent.name} (read-only or full access) to start chatting
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-[var(--text-secondary)]">
              Ask {selectedAgent.name} to create, search, read, update, or delete a marketing campaign
              {activeMode === 'readonly' && ' (read-only session — writes will be rejected)'}
            </div>
          ) : (
            messages.map((m, i) => <MessageBubble key={i} message={m} />)
          )}
        </div>

        {error && <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-t border-red-200">{error}</div>}

        <div className="p-3 border-t border-[var(--border-default)] flex items-center gap-2 rounded-b-xl">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            disabled={!selectedAgent || !loginRid || sending}
            placeholder={!selectedAgent ? 'Select an agent first' : !loginRid ? 'Log in first' : 'Type a message…'}
            className="flex-1 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[#1662dd]/40 disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={!selectedAgent || !loginRid || !input.trim() || sending}
            className="p-2 bg-[#1662dd] text-white rounded-lg hover:bg-[#1662dd]/90 transition-colors disabled:opacity-40"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      {selectedAgent && (
        <>
          <div
            onMouseDown={startResize}
            title="Drag to resize"
            className="group h-4 flex items-center justify-center cursor-row-resize"
          >
            <div className="w-10 h-1 rounded-full bg-[var(--border-default)] group-hover:bg-[#1662dd]/50 transition-colors" />
          </div>
          <ChatGraphPanel
            agentId={selectedAgent.id}
            login={loginInfo}
            hops={tokenTrace?.hops || []}
            scopeModeLabel={activeMode ? SCOPE_MODE_LABELS[activeMode] : ''}
            expanded={graphExpanded}
            onToggleExpanded={() => setGraphExpanded((v) => !v)}
            canvasHeight={graphCanvasHeight}
          />
        </>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const [expanded, setExpanded] = useState(false);
  const isUser = message.role === 'user';
  const campaigns = isUser ? [] : extractCampaigns(message.toolCalls);
  return (
    <div className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-[#1662dd]/15 flex items-center justify-center flex-shrink-0">
          <Bot className="w-3.5 h-3.5 text-[#1662dd]" />
        </div>
      )}
      <div className={`max-w-[75%] ${isUser ? 'order-1' : ''}`}>
        <div
          className={`rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
            isUser ? 'bg-[#1662dd] text-white' : 'bg-[var(--bg-surface-muted)] text-[var(--text-primary)] border border-[var(--border-default)]'
          }`}
        >
          {message.content}
        </div>
        {campaigns.length > 0 && (
          <div className="mt-2 space-y-2">
            {campaigns.map((c) => <CampaignCard key={c.id} campaign={c} />)}
          </div>
        )}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-1.5">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {message.toolCalls.length} tool call{message.toolCalls.length > 1 ? 's' : ''}
            </button>
            {expanded && (
              <div className="mt-1.5 space-y-1.5">
                {message.toolCalls.map((tc, i) => (
                  <div key={i} className="bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg p-2">
                    <div className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1">{tc.name}</div>
                    <pre className="text-[11px] text-[var(--text-primary)] overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed max-h-40">
                      {JSON.stringify({ args: tc.args, result: tc.result }, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-[var(--bg-surface-muted)] border border-[var(--border-default)] flex items-center justify-center flex-shrink-0">
          <User className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        </div>
      )}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  draft: 'bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] border-[var(--border-default)]',
  paused: 'bg-amber-50 text-amber-700 border-amber-200',
  completed: 'bg-[#1662dd]/10 text-[#1662dd] border-[#1662dd]/25',
};

// A stable per-campaign color, derived from its id (not the name — a rename shouldn't shuffle
// the logo) — there's no real logo/image asset for campaigns, so this "logo" is a colored
// initials avatar, deterministic so the same campaign always looks the same across cards.
const LOGO_COLORS = [
  { bg: 'bg-[#1662dd]/15', text: 'text-[#1662dd]' },
  { bg: 'bg-emerald-500/15', text: 'text-emerald-600' },
  { bg: 'bg-amber-500/15', text: 'text-amber-600' },
  { bg: 'bg-rose-500/15', text: 'text-rose-600' },
  { bg: 'bg-violet-500/15', text: 'text-violet-600' },
  { bg: 'bg-cyan-500/15', text: 'text-cyan-600' },
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

function campaignInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function CampaignLogo({ campaign }: { campaign: Campaign }) {
  const color = LOGO_COLORS[hashString(campaign.id) % LOGO_COLORS.length];
  return (
    <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${color.bg}`}>
      <span className={`text-[10px] font-bold ${color.text}`}>{campaignInitials(campaign.name)}</span>
    </div>
  );
}

function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const statusClass = STATUS_STYLES[campaign.status?.toLowerCase() || ''] || STATUS_STYLES.draft;
  const start = formatDate(campaign.startDate);
  const end = formatDate(campaign.endDate);
  const budget = campaign.budget != null && campaign.budget !== '' ? Number(campaign.budget) : null;

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-3 max-w-sm">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <CampaignLogo campaign={campaign} />
          <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{campaign.name}</div>
        </div>
        {campaign.status && (
          <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border flex-shrink-0 ${statusClass}`}>
            {campaign.status}
          </span>
        )}
      </div>
      {campaign.description && (
        <div className="text-xs text-[var(--text-secondary)] mb-2">{campaign.description}</div>
      )}
      {(budget != null || start || end) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
          {budget != null && (
            <span className="flex items-center gap-1">
              <DollarSign className="w-3 h-3" /> {budget.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          )}
          {(start || end) && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" /> {start || '?'} – {end || '?'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
