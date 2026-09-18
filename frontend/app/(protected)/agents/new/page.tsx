'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { ArrowLeft, Bot } from 'lucide-react';

export default function NewAgentPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': (session?.user as any)?.id || '',
        },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create agent');
      }
      const agent = await res.json();
      router.push(`/agents/${agent.id}`);
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg">
      <Link href="/agents" className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-6">
        <ArrowLeft className="w-4 h-4" /> Back to Agents
      </Link>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-[#1662dd]/10 flex items-center justify-center">
          <Bot className="w-5 h-5 text-[#1662dd]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Register AI Agent</h1>
          <p className="text-[var(--text-secondary)] text-xs mt-0.5">Creates an identity in Okta's AI Agent directory</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-6 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Agent Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sales Intelligence Agent"
            required
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#1662dd] transition-colors"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this agent do?"
            rows={3}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#1662dd] transition-colors resize-none"
          />
        </div>
        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex gap-3 pt-1">
          <Link href="/agents" className="px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] border border-[var(--border-default)] rounded-lg hover:text-[var(--text-primary)] hover:border-slate-400 transition-colors">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="flex-1 px-4 py-2.5 bg-[#1662dd] hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {loading ? 'Registering…' : 'Register Agent in Okta'}
          </button>
        </div>
      </form>
    </div>
  );
}
