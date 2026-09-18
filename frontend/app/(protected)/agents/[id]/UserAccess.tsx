'use client';
import { useState } from 'react';
import { Check, RefreshCw, UserCheck } from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface Props {
  agentId: string;
  enabled: boolean;
}

export default function UserAccess({ agentId, enabled: initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function enable() {
    setSaving(true); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/user-access`, { method: 'PUT' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to enable user access'); return; }
      setEnabled(true);
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        {enabled ? (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <Check className="w-4 h-4" /> User sign-in enabled
          </div>
        ) : (
          <span className="text-sm text-slate-500 italic">Users can't sign in through this agent yet</span>
        )}
        {!enabled && (
          <button
            onClick={enable}
            disabled={saving}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd]/15 border border-[#1662dd]/25 text-[#60a5fa] rounded-lg hover:bg-[#1662dd]/25 transition-colors disabled:opacity-40 flex-shrink-0"
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
            Enable user sign-in
          </button>
        )}
      </div>
      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2 mt-2">{error}</div>}
    </div>
  );
}
