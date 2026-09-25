'use client';
import { useState, useEffect } from 'react';
import { X, Bot, UserCheck, Cpu, Shield, Zap, Server, Link2, RefreshCw, BadgeCheck, ArrowRight } from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface OktaUser { id: string; displayName: string; email: string; }
interface Caller { id: string; callerAgentId: string; callerName: string; }
interface AgentConnection {
  id: string; connectionType: string; status: string;
  authorizationServer?: { name: string };
  resource?: { appInstanceName?: string; name?: string; clientAuthSettings?: { name: string } };
}

interface Props {
  agentId: string;
  agentName: string;
  owner: { name: string; email: string } | null;
  onClose: () => void;
}

// Same taxonomy/colours already established in ResourcePicker and the agent request wizard, reused
// here so this reveal reads as "the same visual language, assembled in one place."
const CONNECTION_TYPE_META: Record<string, { label: string; icon: any; colour: string }> = {
  IDENTITY_ASSERTION_CUSTOM_AS: { label: 'Authorization server', icon: Shield, colour: '#60a5fa' },
  STS_VAULT_SECRET: { label: 'Secret', icon: Server, colour: '#f87171' },
  STS_SERVICE_ACCOUNT: { label: 'Service account', icon: Zap, colour: '#fb923c' },
  STS_ACCESS_TOKEN: { label: 'Application', icon: Zap, colour: '#34d399' },
  IDENTITY_ASSERTION_APP_INSTANCE: { label: 'Application', icon: Zap, colour: '#34d399' },
  IDENTITY_ASSERTION_VIRTUAL_MCP_SERVER: { label: 'MCP server', icon: Server, colour: '#e879f9' },
  IDENTITY_ASSERTION_A2A_SERVER: { label: 'AI agent', icon: Link2, colour: '#a78bfa' },
};

function connectionName(c: AgentConnection): string {
  return c.resource?.name || c.authorizationServer?.name || c.resource?.appInstanceName || c.resource?.clientAuthSettings?.name || c.connectionType;
}

function initials(name?: string) {
  return name?.trim()?.[0]?.toUpperCase() || '?';
}

function Chip({ icon: Icon, colour, name, sub, round }: { icon: any; colour: string; name: string; sub?: string; round?: boolean }) {
  return (
    <div className="flex items-start gap-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-3 py-2">
      <div
        className={`w-7 h-7 flex items-center justify-center flex-shrink-0 ${round ? 'rounded-full' : 'rounded-lg'}`}
        style={{ background: `${colour}1a` }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: colour }} />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-[var(--text-primary)] leading-snug break-words" title={name}>{name}</div>
        {sub && <div className="text-xs text-[var(--text-secondary)] truncate" title={sub}>{sub}</div>}
      </div>
    </div>
  );
}

const MAX_VISIBLE = 5;

function SubGroup({
  title, icon: Icon, colour, children, empty, emptyLabel, totalCount,
}: { title: string; icon: any; colour: string; children: React.ReactNode; empty: boolean; emptyLabel: string; totalCount: number }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3 h-3" style={{ color: colour }} />
        <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide">{title}</span>
        {totalCount > 0 && <span className="text-[10px] text-[var(--text-muted)]">({totalCount})</span>}
      </div>
      {empty ? (
        <div className="text-xs text-[var(--text-muted)] italic py-1.5">{emptyLabel}</div>
      ) : (
        <div className="space-y-1.5">{children}</div>
      )}
    </div>
  );
}

function MoreIndicator({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div className="text-xs text-[var(--text-muted)] italic px-3 py-1">+{count} more</div>
  );
}

function Connector({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-1 flex-shrink-0 self-center">
      <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide whitespace-nowrap">{label}</span>
      <ArrowRight className={`w-5 h-5 ${active ? 'text-[#1662dd]' : 'text-[var(--border-default)]'}`} />
    </div>
  );
}

export default function AgentRelationshipsModal({ agentId, agentName, owner, onClose }: Props) {
  const [signInUsers, setSignInUsers] = useState<OktaUser[]>([]);
  const [callers, setCallers] = useState<Caller[]>([]);
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${BACKEND}/api/agents/${agentId}/user-access/users`).then((r) => r.json()).catch(() => []),
      fetch(`${BACKEND}/api/agents/${agentId}/delegations`).then((r) => r.json()).catch(() => []),
      fetch(`${BACKEND}/api/agents/${agentId}/connections`).then((r) => r.json()).catch(() => []),
    ]).then(([users, callerList, conns]) => {
      setSignInUsers(Array.isArray(users) ? users : []);
      setCallers(Array.isArray(callerList) ? callerList : []);
      setConnections(Array.isArray(conns) ? conns : []);
      setLoading(false);
    });
  }, [agentId]);

  const hasEntry = signInUsers.length > 0 || callers.length > 0;
  const hasExit = connections.length > 0;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-2xl p-6 max-w-6xl w-full shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">Agent Relationships</h2>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-[var(--text-secondary)] mb-6">How this agent is entered, owned, and what it reaches downstream.</p>

        {loading ? (
          <div className="text-sm text-[var(--text-secondary)] text-center py-16">
            <RefreshCw className="w-5 h-5 animate-spin inline mr-2" />Loading relationships…
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-3 items-stretch">
            {/* ── Entry Points (inbound) ───────────────────────────────── */}
            <div className="flex-1 min-w-0 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-xl p-4">
              <div className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wide mb-0.5">Entry Points</div>
              <div className="text-[11px] text-[var(--text-muted)] mb-3">What can initiate this agent</div>
              <div className="space-y-4">
                <SubGroup title="Users" icon={UserCheck} colour="#1662dd" empty={signInUsers.length === 0} emptyLabel="No sign-in users" totalCount={signInUsers.length}>
                  {signInUsers.slice(0, MAX_VISIBLE).map((u) => (
                    <Chip key={u.id} icon={UserCheck} colour="#1662dd" round name={u.displayName} sub={u.email} />
                  ))}
                  <MoreIndicator count={signInUsers.length - MAX_VISIBLE} />
                </SubGroup>
                <SubGroup title="Machines" icon={Cpu} colour="#a78bfa" empty={callers.length === 0} emptyLabel="No authorized callers" totalCount={callers.length}>
                  {callers.slice(0, MAX_VISIBLE).map((c) => (
                    <Chip key={c.id} icon={Bot} colour="#a78bfa" name={c.callerName} sub="AI agent" />
                  ))}
                  <MoreIndicator count={callers.length - MAX_VISIBLE} />
                </SubGroup>
              </div>
            </div>

            <Connector label="initiates" active={hasEntry} />

            {/* ── Agent (center), owner appended ───────────────────────── */}
            <div className="flex-shrink-0 flex flex-col items-center justify-center gap-3 px-2 w-64">
              <div className="flex flex-col items-center text-center gap-2 bg-[#1662dd]/10 border border-[#1662dd]/25 rounded-xl px-5 py-4 w-full">
                <div className="w-10 h-10 rounded-lg bg-[#1662dd]/15 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-[#1662dd]" />
                </div>
                <div>
                  <div className="text-sm font-bold text-[var(--text-primary)] leading-snug whitespace-normal" title={agentName}>{agentName}</div>
                  <div className="text-xs text-[var(--text-muted)]">AI Agent Identity</div>
                </div>
              </div>
              {/* Owner, attached directly beneath the agent it belongs to */}
              {owner ? (
                <div className="flex flex-col items-center text-center gap-1 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2 w-full">
                  <BadgeCheck className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <div className="text-xs">
                    <span className="text-[var(--text-muted)]">Owner: </span>
                    <span className="font-semibold text-[var(--text-primary)]">{owner.name}</span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center text-center gap-1 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg px-3 py-2 w-full">
                  <BadgeCheck className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
                  <span className="text-xs italic text-[var(--text-muted)]">No owner assigned</span>
                </div>
              )}
            </div>

            <Connector label="connects to" active={hasExit} />

            {/* ── Downstream Resources (outbound) ──────────────────────── */}
            <div className="flex-1 min-w-0 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-xl p-4">
              <div className="flex items-center gap-1.5 mb-0.5">
                <div className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wide">Downstream Resources</div>
                {connections.length > 0 && <span className="text-[10px] text-[var(--text-muted)]">({connections.length})</span>}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mb-3">What this agent can call</div>
              {connections.length === 0 ? (
                <div className="text-xs text-[var(--text-muted)] italic py-1.5">No resource connections</div>
              ) : (
                <div className="space-y-1.5">
                  {connections.slice(0, MAX_VISIBLE).map((c) => {
                    const meta = CONNECTION_TYPE_META[c.connectionType] || { label: c.connectionType, icon: Server, colour: '#64748b' };
                    return (
                      <Chip key={c.id} icon={meta.icon} colour={meta.colour} name={connectionName(c)} sub={meta.label} />
                    );
                  })}
                  <MoreIndicator count={connections.length - MAX_VISIBLE} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
