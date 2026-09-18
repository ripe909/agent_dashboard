import { notFound } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import Breadcrumbs from '@/components/Breadcrumbs';
import AgentDetailTabs from './AgentDetailTabs';
import AgentActionsMenu from './AgentActionsMenu';
import { Bot, ExternalLink } from 'lucide-react';

const OKTA_ORG = process.env.NEXT_PUBLIC_OKTA_ORG || '';

// Admin console lives on a "-admin" subdomain, e.g. https://foo.oktapreview.com -> https://foo-admin.oktapreview.com
function adminOrgUrl(orgUrl: string): string {
  return orgUrl.replace(/^(https?:\/\/)([^.]+)(\..+)$/, '$1$2-admin$3');
}

function systemLogUrl(orgUrl: string, agentOktaId?: string): string {
  if (!orgUrl) return '#';
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    fromTime: from.toISOString().replace(/\.\d+Z$/, 'Z'),
    toTime: now.toISOString().replace(/\.\d+Z$/, 'Z'),
    locale: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago',
    limit: '20',
    view: 'list',
    topLeftLongitude: '-174.375',
    topLeftLatitude: '77.23507365492469',
    bottomRightLongitude: '177.18749999999997',
    bottomRightLatitude: '-44.84029065139799',
    mapZoom: '2',
  });
  if (agentOktaId) params.set('search', agentOktaId);
  return `${adminOrgUrl(orgUrl)}/report/system_log_2?${params.toString()}`;
}

export default async function AgentDetailPage({ params }: { params: { id: string } }) {
  let agent: any;
  try {
    agent = await apiFetch<any>(`/api/agents/${params.id}`);
  } catch {
    notFound();
  }

  let streamlinedUserAccess = true;
  let streamlinedMachineAccess = true;
  try {
    const settings = await apiFetch<any>('/api/settings');
    streamlinedUserAccess = !!settings.streamlinedUserAccess;
    streamlinedMachineAccess = !!settings.streamlinedMachineAccess;
  } catch {}

  const liveStatus = agent.okta?.status || agent.status;
  const oktaOwner = agent.oktaOwners?.[0];
  const currentOwner = oktaOwner
    ? { id: oktaOwner.id, name: oktaOwner.name, email: oktaOwner.email }
    : agent.ownerId
      ? { id: agent.ownerId, name: agent.ownerName || '', email: agent.ownerEmail || '' }
      : null;

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Directory' }, { label: 'AI Agents', href: '/agents' }, { label: agent.name }]} />

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">AI Agents</div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#1662dd]/10 flex items-center justify-center">
              <Bot className="w-5 h-5 text-[#1662dd]" />
            </div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">{agent.name}</h1>
            <StatusBadge status={liveStatus} />
          </div>
          {agent.description && <p className="text-[var(--text-secondary)] text-sm mt-1.5 ml-12">{agent.description}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={systemLogUrl(OKTA_ORG, agent.oktaAgentId)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-4 py-2 border border-[var(--border-default)] text-sm font-semibold text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-surface-muted)] transition-colors"
          >
            View log <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <AgentActionsMenu agentId={agent.id} agentName={agent.name} currentStatus={liveStatus} />
        </div>
      </div>

      {/* Metadata row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Managed Status</div>
          <div className="mt-1"><StatusBadge status={liveStatus} /></div>
        </div>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Creation Date</div>
          <div className="text-sm text-[var(--text-primary)] mt-1">
            {new Date(agent.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        </div>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-4">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Update Date</div>
          <div className="text-sm text-[var(--text-primary)] mt-1">
            {agent.okta?.lastUpdated
              ? new Date(agent.okta.lastUpdated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
              : '—'}
          </div>
        </div>
      </div>

      <AgentDetailTabs
        agent={agent}
        currentOwner={currentOwner}
        streamlinedUserAccess={streamlinedUserAccess}
        streamlinedMachineAccess={streamlinedMachineAccess}
      />
    </div>
  );
}
