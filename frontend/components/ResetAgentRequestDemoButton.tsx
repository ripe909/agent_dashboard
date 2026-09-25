'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { portalConfig } from '@/lib/portalConfig';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export default function ResetAgentRequestDemoButton() {
  const router = useRouter();
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');

  async function reset() {
    if (!confirm(`Delete every agent created via the ${portalConfig.name} request form (in Okta and locally)? This cannot be undone.`)) return;
    setResetting(true); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agent-requests/reset`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Reset failed'); return; }
      router.refresh();
    } catch (e: any) { setError(e.message); }
    setResetting(false);
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={reset}
        disabled={resetting}
        title={`Delete all agents created via the ${portalConfig.name} request form`}
        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-red-50 border border-red-200 text-red-600 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-40"
      >
        <Trash2 className="w-3.5 h-3.5" />
        {resetting ? 'Resetting…' : `Reset ${portalConfig.name} Demo Agents`}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
