'use client';
import { useState } from 'react';
import { Copy, Check, RefreshCw, Key, Shield, Lock } from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
const OKTA_ORG = (process.env.NEXT_PUBLIC_OKTA_ORG || '').replace(/^https?:\/\//, '');

interface AgentJwk { kid: string; status: string; alg: string; created: string; }
interface AgentSecret { id: string; status: string; created: string; }

interface Credentials {
  source: 'app' | 'native';
  appId?: string; clientId: string; authMethod: string;
  hasSecret?: boolean; jwks?: AgentJwk[]; secrets?: AgentSecret[];
}

interface Props {
  agentId: string;
  credentials: Credentials;
}

const AUTH_METHODS = [
  {
    value: 'client_secret_basic',
    label: 'Client Secret',
    icon: Lock,
    description: 'Agent authenticates with a client ID and secret (OAuth2 client_secret_basic)',
  },
  {
    value: 'private_key_jwt',
    label: 'Public / Private Key',
    icon: Key,
    description: 'Agent uses a signed JWT with a private key — most secure option',
  },
  {
    value: 'none',
    label: 'Client ID Only',
    icon: Shield,
    description: 'Public client — PKCE only, no secret. Suitable for agents in trusted environments.',
  },
];

function ClientIdField({ clientId }: { clientId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Client ID</label>
      <div className="flex items-center gap-2 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg px-3 py-2.5">
        <span className="flex-1 text-sm text-[var(--text-primary)] font-mono truncate">{clientId}</span>
        <button
          onClick={() => { navigator.clipboard.writeText(clientId); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="text-[var(--text-secondary)] hover:text-[#1662dd] flex-shrink-0"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
      {OKTA_ORG && (
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Okta domain: <span className="font-mono">{OKTA_ORG}</span>
        </p>
      )}
    </div>
  );
}

function statusColour(status: string) {
  return status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-[var(--bg-surface-muted)] text-[var(--text-secondary)]';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function RevealOnce({ label, value, warning }: { label: string; value: string; warning: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
      <div className="text-xs font-semibold text-amber-700">{warning}</div>
      <div className="flex items-center gap-2 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg px-3 py-2.5">
        <span className="flex-1 text-xs text-[var(--text-primary)] font-mono truncate">{value}</span>
        <button
          onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="text-[var(--text-secondary)] hover:text-[#1662dd] flex-shrink-0"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

const NATIVE_OPTIONS = [
  {
    value: 'client_secret_basic',
    label: 'Client secret',
    icon: Lock,
    description: 'A shared secret for confidential, server-side agents.',
  },
  {
    value: 'private_key_jwt',
    label: 'Public/private key',
    icon: Key,
    description: 'For AI agents with a builder-managed key pair. (Most secure)',
  },
  {
    value: 'none',
    label: 'Client ID only',
    icon: Shield,
    description: "For public clients that can't store a secret, like local coding agents. (Least secure)",
  },
];

function NativeCredentials({ agentId, credentials: initial }: { agentId: string; credentials: Credentials }) {
  const [credentials, setCredentials] = useState(initial);
  const [loading, setLoading] = useState<'secret' | 'jwk' | null>(null);
  const [error, setError] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [newKey, setNewKey] = useState<{ kid: string; privateKeyPem: string } | null>(null);

  async function refresh() {
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}`);
      const data = await res.json();
      if (data.credentials) setCredentials(data.credentials);
    } catch {}
  }

  async function generateSecret() {
    setLoading('secret'); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/credentials/secret`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to generate secret'); return; }
      setNewSecret(data.clientSecret);
      await refresh();
    } catch (e: any) { setError(e.message); }
    setLoading(null);
  }

  async function generateKey() {
    setLoading('jwk'); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/credentials/jwk`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to generate key pair'); return; }
      setNewKey(data);
      await refresh();
    } catch (e: any) { setError(e.message); }
    setLoading(null);
  }

  return (
    <div className="space-y-4">
      <ClientIdField clientId={credentials.clientId} />

      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      <div>
        <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Client Registration</label>
        <div className="space-y-2">
          {NATIVE_OPTIONS.map(({ value, label, icon: Icon, description }) => {
            const isCurrent = credentials.authMethod === value;
            return (
              <div
                key={value}
                className={`p-3 rounded-lg border transition-all ${
                  isCurrent ? 'border-[#1662dd]/40 bg-[#1662dd]/8' : 'border-[var(--border-default)] bg-[var(--bg-surface-muted)]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <Icon className="w-4 h-4 text-[var(--text-muted)] mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">{label}</span>
                      {isCurrent && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-[#1662dd]/15 text-[#1662dd]">CURRENT</span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{description}</div>
                  </div>
                  {value === 'client_secret_basic' && (
                    <button
                      onClick={generateSecret}
                      disabled={loading !== null}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd]/15 border border-[#1662dd]/25 text-[#1662dd] rounded-lg hover:bg-[#1662dd]/25 transition-colors disabled:opacity-40 flex-shrink-0"
                    >
                      {loading === 'secret' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                      Generate
                    </button>
                  )}
                  {value === 'private_key_jwt' && (
                    <button
                      onClick={generateKey}
                      disabled={loading !== null}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd]/15 border border-[#1662dd]/25 text-[#1662dd] rounded-lg hover:bg-[#1662dd]/25 transition-colors disabled:opacity-40 flex-shrink-0"
                    >
                      {loading === 'jwk' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                      Generate
                    </button>
                  )}
                </div>

                {value === 'client_secret_basic' && newSecret && (
                  <div className="mt-3">
                    <RevealOnce
                      label="Client secret"
                      value={newSecret}
                      warning="Copy this secret now — it won't be shown again."
                    />
                  </div>
                )}
                {value === 'private_key_jwt' && newKey && (
                  <div className="mt-3 space-y-2">
                    <RevealOnce
                      label="Private key"
                      value={newKey.privateKeyPem}
                      warning="Copy this private key now — Okta only stored the public key, this won't be shown again."
                    />
                  </div>
                )}

                {value === 'client_secret_basic' && credentials.secrets && credentials.secrets.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {credentials.secrets.map((s) => (
                      <div key={s.id} className="flex items-center gap-3 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-xs">
                        <span className="text-[var(--text-secondary)] font-mono">•••• {s.id.slice(-6)}</span>
                        <span className="text-[var(--text-muted)]">created {formatDate(s.created)}</span>
                        <span className={`ml-auto px-1.5 py-0.5 rounded font-medium ${statusColour(s.status)}`}>{s.status}</span>
                      </div>
                    ))}
                  </div>
                )}
                {value === 'private_key_jwt' && credentials.jwks && credentials.jwks.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {credentials.jwks.map((k) => (
                      <div key={k.kid} className="flex items-center gap-3 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg px-3 py-2 text-xs">
                        <span className="text-[var(--text-primary)] font-mono truncate">{k.kid}</span>
                        <span className="text-[var(--text-muted)] flex-shrink-0">{k.alg} · {formatDate(k.created)}</span>
                        <span className={`ml-auto px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${statusColour(k.status)}`}>{k.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AppCredentials({ agentId, credentials }: { agentId: string; credentials: Credentials }) {
  const [method, setMethod] = useState(credentials.authMethod);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function saveMethod() {
    setSaving(true); setError(''); setSaved(false);
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authMethod: method }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to update'); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <ClientIdField clientId={credentials.clientId} />

      {/* Auth method picker */}
      <div>
        <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Authentication Method</label>
        <div className="space-y-2">
          {AUTH_METHODS.map(({ value, label, icon: Icon, description }) => (
            <label
              key={value}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                method === value
                  ? 'border-[#1662dd]/40 bg-[#1662dd]/8'
                  : 'border-[var(--border-default)] bg-[var(--bg-surface-muted)] hover:border-slate-400'
              }`}
            >
              <input
                type="radio"
                name="authMethod"
                value={value}
                checked={method === value}
                onChange={() => setMethod(value)}
                className="mt-0.5 accent-[#1662dd] flex-shrink-0"
              />
              <div className="flex items-start gap-2.5 min-w-0">
                <Icon className="w-4 h-4 text-[var(--text-muted)] mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">{label}</div>
                  <div className="text-xs text-[var(--text-secondary)] mt-0.5">{description}</div>
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={saveMethod}
          disabled={saving || method === credentials.authMethod}
          className="flex items-center gap-2 px-4 py-2 bg-[#1662dd] hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save Credential Settings'}
        </button>
        {saved && <span className="text-xs text-emerald-600 flex items-center gap-1"><Check className="w-3 h-3" />Saved</span>}
      </div>

      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      {method === 'private_key_jwt' && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 text-xs text-amber-700">
          <strong>Private Key JWT:</strong> Upload a public key to Okta Admin Console → Applications → {credentials.clientId} → Client Credentials tab.
        </div>
      )}
    </div>
  );
}

export default function AgentCredentials({ agentId, credentials }: Props) {
  return credentials.source === 'native'
    ? <NativeCredentials agentId={agentId} credentials={credentials} />
    : <AppCredentials agentId={agentId} credentials={credentials} />;
}
