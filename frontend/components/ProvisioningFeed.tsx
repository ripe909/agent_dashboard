'use client';
import { useEffect, useRef, useState } from 'react';
import { Sparkles, ChevronDown, ChevronRight, X, Wifi, WifiOff, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import EventLog from './EventLog';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface Milestone {
  id: string; ts: string; label: string; status: 'done' | 'error';
  detail?: string; error?: string;
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const DEFAULT_WIDTH = 340;

export default function ProvisioningFeed() {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [connected, setConnected] = useState(false);
  const [visible, setVisible] = useState(true);
  const [showRaw, setShowRaw] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  function connect() {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`${BACKEND}/api/agent-requests/events`, { withCredentials: true });
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'connected') return;
        setMilestones((prev) => [...prev.slice(-49), data as Milestone]);
        setVisible(true);
      } catch {}
    };
  }

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [milestones.length]);

  if (!visible) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--portal-primary)]/40 transition-colors shadow-sm"
      >
        <Sparkles className="w-3.5 h-3.5 text-[var(--portal-primary)]" />
        Provisioning
        {milestones.length > 0 && (
          <span className="bg-[var(--portal-primary)]/10 text-[var(--portal-primary)] px-1.5 py-0.5 rounded font-semibold">{milestones.length}</span>
        )}
      </button>
    );
  }

  return (
    <div className="relative flex-shrink-0 flex flex-col border-l border-[var(--border-default)] bg-[var(--bg-surface)]" style={{ width: DEFAULT_WIDTH }}>
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-default)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-[var(--portal-primary)]" />
          <span className="text-xs font-semibold text-[var(--text-primary)]">Provisioning</span>
        </div>
        <div className="flex items-center gap-1.5">
          {connected
            ? <span title="Connected"><Wifi className="w-3 h-3 text-emerald-600" /></span>
            : <span title="Disconnected"><WifiOff className="w-3 h-3 text-red-600" /></span>}
          {milestones.length > 0 && (
            <button onClick={() => setMilestones([])} title="Clear" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5">
              <X className="w-3 h-3" />
            </button>
          )}
          <button onClick={() => setVisible(false)} title="Hide" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5">
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto text-xs">
        {milestones.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-muted)] px-6 text-center">
            <Sparkles className="w-6 h-6 opacity-30" />
            <p>Submit an agent request to watch Okta provision it live</p>
          </div>
        ) : (
          <div className="py-2 px-3 space-y-2.5">
            {milestones.map((m) => (
              <div key={m.id} className="flex items-start gap-2.5">
                {m.status === 'done' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--text-primary)]">{m.label}</div>
                  {(m.detail || m.error) && (
                    <div className={`text-xs mt-0.5 ${m.status === 'error' ? 'text-red-600' : 'text-[var(--text-secondary)]'}`}>
                      {m.error || m.detail}
                    </div>
                  )}
                  <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{timeStr(m.ts)}</div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border-default)] flex-shrink-0">
        <button
          onClick={() => setShowRaw((s) => !s)}
          className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <span>Show raw API log</span>
          {showRaw ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        {showRaw && (
          <div className="flex border-t border-[var(--border-default)]" style={{ height: 320 }}>
            <EventLog />
          </div>
        )}
      </div>
    </div>
  );
}
