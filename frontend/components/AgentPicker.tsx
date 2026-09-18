'use client';
import { useState, useEffect } from 'react';
import { Search, X, Bot } from 'lucide-react';

interface AgentOption { id: string; name: string; description?: string; }
interface Props {
  excludeAgentId: string;
  onSelect: (agent: AgentOption) => void;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export default function AgentPicker({ excludeAgentId, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${BACKEND}/api/agents`)
      .then((r) => r.json())
      .then((data) => setAgents(Array.isArray(data) ? data.filter((a: AgentOption) => a.id !== excludeAgentId) : []))
      .catch((e) => setError(e.message || 'Failed to load agents'))
      .finally(() => setLoading(false));
  }, [excludeAgentId]);

  const filtered = agents.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div>
      <div className="flex items-center gap-2 bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded-lg px-3 py-2 mb-3">
        <Search className="w-3.5 h-3.5 text-[var(--text-secondary)] flex-shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search AI agents by name…"
          className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none min-w-0"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {error && <div className="text-xs text-red-600 mb-2 px-1">{error}</div>}
      <div className="max-h-56 overflow-y-auto space-y-0.5">
        {loading && <div className="text-xs text-[var(--text-secondary)] text-center py-4">Loading agents…</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="text-xs text-[var(--text-secondary)] text-center py-4">
            {query ? 'No agents match that search' : 'No other agents available'}
          </div>
        )}
        {filtered.map((a) => (
          <button
            key={a.id}
            onClick={() => onSelect(a)}
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-surface-muted)] rounded-lg transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-full bg-[#1662dd]/15 flex items-center justify-center flex-shrink-0">
              <Bot className="w-3.5 h-3.5 text-[#1662dd]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-[var(--text-primary)] font-medium truncate">{a.name}</div>
              {a.description && <div className="text-xs text-[var(--text-secondary)] truncate">{a.description}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
