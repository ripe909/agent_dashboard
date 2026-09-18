'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface Props {
  scope: 'all' | { agentId: string };
  label?: string;
}

export default function SyncOwnersButton({ scope, label }: Props) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  async function sync() {
    setSyncing(true); setError('');
    try {
      const url = scope === 'all'
        ? `${BACKEND}/api/agents/sync-owners`
        : `${BACKEND}/api/agents/${scope.agentId}/sync-owner`;
      const res = await fetch(url, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Sync failed'); return; }
      router.refresh();
    } catch (e: any) { setError(e.message); }
    setSyncing(false);
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={sync}
        disabled={syncing}
        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd]/15 border border-[#1662dd]/25 text-[#1662dd] rounded-lg hover:bg-[#1662dd]/25 transition-colors disabled:opacity-40"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
        {label || (scope === 'all' ? 'Sync Owners' : 'Sync Owner')}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
