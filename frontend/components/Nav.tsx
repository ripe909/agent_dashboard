'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Bot, Users, Puzzle, LayoutDashboard, LogOut, Settings, PlayCircle, Boxes, MessageSquare, ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import clsx from 'clsx';
import SettingsModal from './SettingsModal';
import { portalConfig } from '@/lib/portalConfig';

const links = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/agents', label: 'AI Agents', icon: Bot },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/resources', label: 'Resources', icon: Puzzle },
  { href: '/exercise', label: 'Exercise', icon: PlayCircle },
  { href: '/logging', label: 'Logging', icon: ScrollText },
];

interface Props {
  user: { name?: string; email?: string; image?: string };
}

function SectionHeader({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
    >
      {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      {label}
    </button>
  );
}

export default function Nav({ user }: Props) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Admin section starts collapsed, Portal section starts expanded — but a section containing the
  // current page auto-opens on first render so navigating there directly doesn't hide the active link.
  const [adminOpen, setAdminOpen] = useState(() => links.some((l) => (l.href === '/' ? pathname === '/' : pathname.startsWith(l.href))));
  const [portalOpen, setPortalOpen] = useState(true);

  return (
    <div className="w-56 flex flex-col bg-[var(--bg-surface)] border-r border-[var(--border-default)] flex-shrink-0">
      <div className="px-5 py-5 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#1662dd]/10 flex items-center justify-center">
            <Bot className="w-4 h-4 text-[#1662dd]" />
          </div>
          <span className="font-bold text-[var(--text-primary)] text-sm">AI Agent Console</span>
        </div>
        <div className="text-xs text-[var(--text-muted)] mt-0.5">Powered by Okta O4AA</div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <SectionHeader label="Admin" open={adminOpen} onToggle={() => setAdminOpen((v) => !v)} />
        {adminOpen && links.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors border-l-2',
                active
                  ? 'bg-blue-50 text-[#1662dd] border-[#1662dd]'
                  : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)]'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          );
        })}
        <div className="pt-2 mt-2 border-t border-[var(--border-default)]">
          <SectionHeader label="Portal" open={portalOpen} onToggle={() => setPortalOpen((v) => !v)} />
          {portalOpen && (
            <div className="space-y-0.5">
              <Link
                href="/request"
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium border-l-2 border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] transition-colors"
              >
                <Boxes className="w-4 h-4" />
                {portalConfig.name} Portal
              </Link>
              <Link
                href="/chat"
                className={clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors border-l-2',
                  pathname.startsWith('/chat')
                    ? 'bg-blue-50 text-[#1662dd] border-[#1662dd]'
                    : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)]'
                )}
              >
                <MessageSquare className="w-4 h-4" />
                Chat
              </Link>
            </div>
          )}
        </div>
      </nav>

      <div className="px-4 py-4 border-t border-[var(--border-default)]">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-[#1662dd]/15 flex items-center justify-center text-xs font-bold text-[#1662dd] flex-shrink-0">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-[var(--text-primary)] truncate">{user?.name || 'User'}</div>
            <div className="text-xs text-[var(--text-secondary)] truncate">{user?.email}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex-1 flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] rounded-lg transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)] rounded-lg transition-colors flex-shrink-0"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
