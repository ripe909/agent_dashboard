'use client';
import { useState } from 'react';
import { Check, AlertTriangle, Circle } from 'lucide-react';
import UserPicker from '@/components/UserPicker';
import ResourcePicker from '@/components/ResourcePicker';
import SyncOwnersButton from '@/components/SyncOwnersButton';
import AgentCredentials from './AgentCredentials';
import UserAccess from './UserAccess';
import MachineAccess from './MachineAccess';

type TabId = 'profile' | 'owners' | 'registration' | 'user_access' | 'machine_access' | 'connections';

interface Props {
  agent: any;
  currentOwner: { id: string; name: string; email: string } | null;
  streamlinedUserAccess: boolean;
  streamlinedMachineAccess: boolean;
}

function formatDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Attribute({ label, attrKey, value }: { label: string; attrKey: string; value?: string }) {
  return (
    <div>
      <div className="text-sm font-semibold text-[var(--text-primary)]">{label}</div>
      <div className="text-xs text-[var(--text-muted)] font-mono">{attrKey}</div>
      <div className="text-sm text-[var(--text-primary)] mt-1">{value || '—'}</div>
    </div>
  );
}

export default function AgentDetailTabs({ agent, currentOwner, streamlinedUserAccess, streamlinedMachineAccess }: Props) {
  const [tab, setTab] = useState<TabId>('profile');

  const tabs: { id: TabId; label: string; complete: 'check' | 'warn' | 'empty' }[] = [
    { id: 'profile', label: 'Profile', complete: 'check' },
    { id: 'owners', label: 'Owners', complete: currentOwner ? 'check' : 'warn' },
    { id: 'registration', label: 'Client registration', complete: agent.credentials ? 'check' : 'empty' },
    { id: 'user_access', label: 'User access', complete: agent.userAccessEnabled ? 'check' : 'empty' },
    { id: 'machine_access', label: 'Machine access', complete: agent.resourceUrl ? 'check' : 'empty' },
    { id: 'connections', label: 'Resource connections', complete: (agent.resources?.length || 0) > 0 ? 'check' : 'empty' },
  ];

  return (
    <div className="grid grid-cols-[240px_1fr] gap-6">
      {/* Tab rail */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg py-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-left transition-colors ${
              tab === t.id ? 'bg-blue-50 text-[#1662dd] font-semibold' : 'text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)]'
            }`}
          >
            <span>{t.label}</span>
            {t.complete === 'check' && <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
            {t.complete === 'warn' && <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
            {t.complete === 'empty' && <Circle className="w-3 h-3 text-[var(--text-muted)] flex-shrink-0" />}
          </button>
        ))}
      </div>

      {/* Content panel */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-6">
        {tab === 'profile' && (
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)] mb-1">Profile</h2>
            <p className="text-sm text-[var(--text-secondary)] mb-6">View and update the attributes for this registered AI agent in Okta.</p>
            <div className="grid grid-cols-2 gap-6">
              <Attribute label="Name" attrKey="agentName" value={agent.name} />
              <Attribute label="Description" attrKey="agentDescription" value={agent.description} />
              <Attribute label="Platform" attrKey="agentPlatform" value={agent.okta?.platform} />
              <Attribute label="External ID" attrKey="externalAgentId" value={agent.oktaAgentId} />
            </div>
          </div>
        )}

        {tab === 'owners' && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">Owners</h2>
              <SyncOwnersButton scope={{ agentId: agent.id }} />
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-6">Assigning an owner registers it directly in Okta&apos;s IGA governance registry for this agent.</p>
            <UserPicker agentId={agent.id} currentOwner={currentOwner} />
          </div>
        )}

        {tab === 'registration' && (
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)] mb-1">Client registration</h2>
            <p className="text-sm text-[var(--text-secondary)] mb-6">How this agent authenticates its identity to Okta.</p>
            {agent.credentials ? (
              <AgentCredentials agentId={agent.id} credentials={agent.credentials} />
            ) : (
              <p className="text-sm text-[var(--text-secondary)] italic">Credentials are available after the agent is activated.</p>
            )}
          </div>
        )}

        {tab === 'user_access' && (
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)] mb-1">User access</h2>
            <p className="text-sm text-[var(--text-secondary)] mb-6">Who can access this agent.</p>
            <UserAccess agentId={agent.id} enabled={!!agent.userAccessEnabled} streamlined={streamlinedUserAccess} />
          </div>
        )}

        {tab === 'machine_access' && (
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)] mb-1">Machine access</h2>
            <p className="text-sm text-[var(--text-secondary)] mb-6">What can call this agent — other AI agents authorized to call this agent.</p>
            <MachineAccess agentId={agent.id} resourceUrl={agent.resourceUrl} streamlined={streamlinedMachineAccess} />
          </div>
        )}

        {tab === 'connections' && (
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)] mb-1">Resource connections</h2>
            <p className="text-sm text-[var(--text-secondary)] mb-6">Resources this agent is configured to access — Auth Servers, Apps, MCP Servers, Secrets &amp; more.</p>
            <ResourcePicker agentId={agent.id} />
          </div>
        )}
      </div>
    </div>
  );
}
