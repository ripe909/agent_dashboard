'use client';
import { useState, useEffect } from 'react';
import { X, RefreshCw } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface Settings {
  streamlinedUserAccess: boolean;
  streamlinedMachineAccess: boolean;
  sharedAuthorizationServerId: string | null;
  serviceClientId: string | null;
  serviceClientSecret: string | null;
}
interface AuthServer { id: string; name: string; }

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [authServers, setAuthServers] = useState<AuthServer[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [serviceClientId, setServiceClientId] = useState('');
  const [serviceClientSecret, setServiceClientSecret] = useState('');
  const [savedServiceClient, setSavedServiceClient] = useState(false);

  useEffect(() => {
    fetch(`${BACKEND}/api/settings`)
      .then((r) => r.json())
      .then((d) => { setSettings(d); setServiceClientId(d.serviceClientId || ''); })
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

  async function saveServiceClient() {
    setSaving(true); setError(''); setSavedServiceClient(false);
    try {
      const patch: Partial<Settings> = { serviceClientId: serviceClientId.trim() || null };
      if (serviceClientSecret.trim()) patch.serviceClientSecret = serviceClientSecret.trim();
      const res = await fetch(`${BACKEND}/api/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save'); setSaving(false); return; }
      setSettings(data);
      setServiceClientSecret('');
      setSavedServiceClient(true);
      setTimeout(() => setSavedServiceClient(false), 3000);
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Dashboard Settings</h2>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">{error}</div>}

        {!settings ? (
          <div className="text-xs text-[var(--text-secondary)] text-center py-6">
            <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Loading…
          </div>
        ) : (
          <div className="space-y-3">
            <ThemeToggle />

            <label className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={settings.streamlinedUserAccess}
                onChange={() => save({ streamlinedUserAccess: !settings.streamlinedUserAccess })}
                disabled={saving}
                className="mt-0.5 accent-[#1662dd] flex-shrink-0"
              />
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">Streamlined User Access</div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Assign users to an agent directly — the dashboard automatically creates and activates
                  the backing OIDC app behind the scenes. Turn off to use the older manual
                  &quot;Enable user sign-in&quot; flow instead.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={settings.streamlinedMachineAccess}
                onChange={() => save({ streamlinedMachineAccess: !settings.streamlinedMachineAccess })}
                disabled={saving}
                className="mt-0.5 accent-[#1662dd] flex-shrink-0"
              />
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">Streamlined Machine Access</div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Authorize another AI agent to call this one in a single step — the dashboard
                  computes the audience URL and connects the shared authorization server below
                  automatically. Turn off to manually configure both for every caller instead.
                </div>
              </div>
            </label>

            <div className="p-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-muted)]">
              <div className="text-sm font-semibold text-[var(--text-primary)] mb-1">Shared Authorization Server</div>
              <div className="text-xs text-[var(--text-secondary)] mb-2">
                Used automatically by Streamlined Machine Access for every agent.
              </div>
              <select
                value={settings.sharedAuthorizationServerId || ''}
                onChange={(e) => save({ sharedAuthorizationServerId: e.target.value || null })}
                disabled={saving}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[#1662dd]/40"
              >
                <option value="">Not configured</option>
                {authServers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="p-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-muted)]">
              <div className="text-sm font-semibold text-[var(--text-primary)] mb-1">Service Client</div>
              <div className="text-xs text-[var(--text-secondary)] mb-2">
                Originates the delegation chain used by Exercise Agent&apos;s Machine Access tests.
              </div>
              <input
                value={serviceClientId}
                onChange={(e) => setServiceClientId(e.target.value)}
                placeholder="Client ID"
                className="w-full mb-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[#1662dd]/40"
              />
              <input
                value={serviceClientSecret}
                onChange={(e) => setServiceClientSecret(e.target.value)}
                type="password"
                placeholder={settings.serviceClientSecret ? 'Client secret (already saved — leave blank to keep)' : 'Client secret'}
                className="w-full mb-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[#1662dd]/40"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={saveServiceClient}
                  disabled={saving}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd]/15 border border-[#1662dd]/25 text-[#1662dd] rounded-lg hover:bg-[#1662dd]/25 transition-colors disabled:opacity-40"
                >
                  {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                  Save
                </button>
                {savedServiceClient && <span className="text-xs text-emerald-600">Saved</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
