import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import ProvisioningFeed from '@/components/ProvisioningFeed';
import { Boxes, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { portalConfig } from '@/lib/portalConfig';

export default async function AgentRequestLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login');

  // Inline overrides win over the .agent-request-theme CSS defaults when a deployment
  // configures its own colours — see globals.css for the defaults these replace.
  const themeStyle: React.CSSProperties = {};
  if (portalConfig.primaryColor) (themeStyle as any)['--portal-primary'] = portalConfig.primaryColor;
  if (portalConfig.accentColor) (themeStyle as any)['--portal-accent'] = portalConfig.accentColor;

  return (
    <div className="agent-request-theme flex h-screen bg-[var(--bg-page)] overflow-hidden" style={themeStyle}>
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="grid grid-cols-3 items-center px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)] flex-shrink-0">
          <div className="flex items-center gap-2.5 justify-self-start">
            <div className="w-8 h-8 rounded-lg bg-[var(--portal-primary)] flex items-center justify-center">
              <Boxes className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <div className="font-bold text-[var(--text-primary)] text-sm leading-tight">{portalConfig.name}</div>
              <div className="text-[10px] text-[var(--text-muted)] leading-tight">{portalConfig.tagline}</div>
            </div>
          </div>
          <div className="justify-self-center">
            {portalConfig.logoPath && (
              // Plain <img>, not next/image: the logo path/URL is deployment-configured and
              // arbitrary (could be any external domain), which next/image can't allowlist
              // ahead of time.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={portalConfig.logoPath} alt={portalConfig.logoAlt} className="h-6 w-auto object-contain" />
            )}
          </div>
          <Link
            href="/agents"
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors justify-self-end"
          >
            View in Okta Admin Console <ExternalLink className="w-3 h-3" />
          </Link>
        </header>
        <main className="flex-1 overflow-y-auto min-w-0">
          <div className="max-w-3xl mx-auto px-8 py-10">{children}</div>
        </main>
      </div>
      <ProvisioningFeed />
    </div>
  );
}
