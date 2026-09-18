'use client';
import { useState, useEffect } from 'react';
import { X, RefreshCw } from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface Settings {
  streamlinedUserAccess: boolean;
  streamlinedMachineAccess: boolean;
  sharedAuthorizationServerId: string | null;
}
interface AuthServer { id: string; name: string; }

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [authServers, setAuthServers] = useState<AuthServer[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${BACKEND}/api/settings`)
      .then((r) => r.json())
      .then(setSettings)
      .catch((e) => setError(e.message || 'Failed to load settings'));
    fetch(`${BACKEND}/api/settings/authorization-servers`)
      .then((r) => r.json())
      .then((d) => setAuthServers(Array.isArray(d) ? d : []))
      .catch(() => setAuthServers([]));
  }, []);

  async function save(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save'); setSettings(settings); return; }
      setSettings(data);
    } catch (e: any) { setError(e.message); setSettings(settings); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[#111827] border border-[#1e293b] rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Dashboard Settings</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2 mb-3">{error}</div>}

        {!settings ? (
          <div className="text-xs text-slate-500 text-center py-6">
            <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Loading…
          </div>
        ) : (
          <div className="space-y-3">
            <label className="flex items-start gap-3 p-3 rounded-lg border border-[#1e293b] bg-[#0a0f1e] cursor-pointer">
              <input
                type="checkbox"
                checked={settings.streamlinedUserAccess}
                onChange={() => save({ streamlinedUserAccess: !settings.streamlinedUserAccess })}
                disabled={saving}
                className="mt-0.5 accent-[#1662dd] flex-shrink-0"
              />
              <div>
                <div className="text-sm font-semibold text-white">Streamlined User Access</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Assign users to an agent directly — the dashboard automatically creates and activates
                  the backing OIDC app behind the scenes. Turn off to use the older manual
                  &quot;Enable user sign-in&quot; flow instead.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-lg border border-[#1e293b] bg-[#0a0f1e] cursor-pointer">
              <input
                type="checkbox"
                checked={settings.streamlinedMachineAccess}
                onChange={() => save({ streamlinedMachineAccess: !settings.streamlinedMachineAccess })}
                disabled={saving}
                className="mt-0.5 accent-[#1662dd] flex-shrink-0"
              />
              <div>
                <div className="text-sm font-semibold text-white">Streamlined Machine Access</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Authorize another AI agent to call this one in a single step — the dashboard
                  computes the audience URL and connects the shared authorization server below
                  automatically. Turn off to manually configure both for every caller instead.
                </div>
              </div>
            </label>

            <div className="p-3 rounded-lg border border-[#1e293b] bg-[#0a0f1e]">
              <div className="text-sm font-semibold text-white mb-1">Shared Authorization Server</div>
              <div className="text-xs text-slate-500 mb-2">
                Used automatically by Streamlined Machine Access for every agent.
              </div>
              <select
                value={settings.sharedAuthorizationServerId || ''}
                onChange={(e) => save({ sharedAuthorizationServerId: e.target.value || null })}
                disabled={saving}
                className="w-full bg-[#111827] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#1662dd]/40"
              >
                <option value="">Not configured</option>
                {authServers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
