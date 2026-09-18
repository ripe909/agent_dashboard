'use client';
import { useEffect, useRef, useState } from 'react';
import { Activity, ChevronDown, ChevronRight, X, RotateCcw, Wifi, WifiOff, Copy, Check } from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface ApiEvent {
  id: string; ts: string; method: string; path: string; label: string;
  requestBody?: any; responseBody?: any; status?: number; durationMs?: number; error?: string;
}

const METHOD_STYLE: Record<string, string> = {
  GET:    'bg-sky-100 text-sky-700 border-sky-200',
  POST:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  PUT:    'bg-amber-100 text-amber-700 border-amber-200',
  PATCH:  'bg-violet-100 text-violet-700 border-violet-200',
  DELETE: 'bg-red-100 text-red-700 border-red-200',
};

function statusColour(s?: number) {
  if (!s) return 'text-[var(--text-secondary)]';
  if (s < 300) return 'text-emerald-600';
  if (s < 400) return 'text-amber-600';
  return 'text-red-600';
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Shorten long ORNs and IDs in displayed paths
function shortenPath(path: string) {
  return path
    .replace(/[a-z0-9]{20,}/gi, (m) => m.slice(0, 8) + '…')
    .replace(process.env.NEXT_PUBLIC_OKTA_ORG || '', '');
}

function toCurl(evt: ApiEvent) {
  const org = process.env.NEXT_PUBLIC_OKTA_ORG || 'https://your-org.okta.com';
  const url = `${org}${evt.path}`;
  const isM2M = process.env.NEXT_PUBLIC_OKTA_AUTH_MODE === 'client_credentials';
  const authHeader = isM2M
    ? `-H "Authorization: Bearer \${OKTA_ACCESS_TOKEN}"`
    : `-H "Authorization: SSWS \${OKTA_API_TOKEN}"`;
  const parts = [`curl -X ${evt.method}`, `'${url}'`, authHeader, `-H 'Content-Type: application/json'`];
  if (evt.requestBody && Object.keys(evt.requestBody).length > 0) {
    parts.push(`-d '${JSON.stringify(evt.requestBody)}'`);
  }
  const cmd = parts.join(' \\\n  ');
  return isM2M
    ? `# OKTA_ACCESS_TOKEN must come from a client_credentials + private_key_jwt token request first\n${cmd}`
    : cmd;
}

const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 260;
const MAX_WIDTH = 800;

export default function EventLog() {
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const [visible, setVisible] = useState(true);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [hideGet, setHideGet] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const saved = Number(localStorage.getItem('eventLogWidth'));
    if (saved >= MIN_WIDTH && saved <= MAX_WIDTH) setWidth(saved);
    setHideGet(localStorage.getItem('eventLogHideGet') === 'true');
  }, []);

  function toggleHideGet() {
    setHideGet((prev) => {
      const next = !prev;
      localStorage.setItem('eventLogHideGet', String(next));
      return next;
    });
  }

  useEffect(() => {
    if (!resizing) return;
    function onMouseMove(e: MouseEvent) {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - e.clientX));
      setWidth(next);
    }
    function onMouseUp() {
      setResizing(false);
      setWidth((w) => {
        localStorage.setItem('eventLogWidth', String(w));
        return w;
      });
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [resizing]);

  function connect() {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`${BACKEND}/api/events`, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => { setConnected(false); };
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'connected') return;
        setEvents(prev => [...prev.slice(-99), data as ApiEvent]); // keep last 100
      } catch {}
    };
  }

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
  }, []);

  const filteredEvents = hideGet ? events.filter((evt) => evt.method !== 'GET') : events;

  // Auto-scroll to bottom on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [filteredEvents.length]);

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (!visible) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[#1662dd]/40 transition-colors"
      >
        <Activity className="w-3.5 h-3.5 text-[#1662dd]" />
        API Events
        {events.length > 0 && (
          <span className="bg-blue-100 text-[#1662dd] px-1.5 py-0.5 rounded font-semibold">{events.length}</span>
        )}
      </button>
    );
  }

  return (
    <div
      className="relative flex-shrink-0 flex flex-col border-l border-[var(--border-default)] bg-[var(--bg-surface)]"
      style={{ width, userSelect: resizing ? 'none' : undefined }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={() => setResizing(true)}
        className={`absolute left-0 top-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize z-10 group ${resizing ? 'bg-[#1662dd]/40' : ''}`}
      >
        <div className="h-full w-px mx-auto bg-transparent group-hover:bg-[#1662dd]/40" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-default)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[#1662dd]" />
          <span className="text-xs font-semibold text-[var(--text-primary)]">Okta API Events</span>
          {events.length > 0 && (
            <span className="text-xs bg-blue-50 text-[#1662dd] px-1.5 py-0.5 rounded font-semibold">{events.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {connected
            ? <span title="Connected"><Wifi className="w-3 h-3 text-emerald-600" /></span>
            : <span title="Disconnected"><WifiOff className="w-3 h-3 text-red-600" /></span>
          }
          <button onClick={connect} title="Reconnect" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5">
            <RotateCcw className="w-3 h-3" />
          </button>
          {events.length > 0 && (
            <button onClick={() => setEvents([])} title="Clear" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5">
              <X className="w-3 h-3" />
            </button>
          )}
          <button onClick={() => setVisible(false)} title="Hide" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5">
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-3 py-1.5 border-b border-[var(--border-default)] flex-shrink-0">
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideGet}
            onChange={toggleHideGet}
            className="accent-[#1662dd] w-3 h-3"
          />
          Hide GET calls
        </label>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto text-xs">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-muted)]">
            <Activity className="w-6 h-6 opacity-30" />
            <p className="text-center px-4">
              {connected ? 'Perform any action to see live API calls' : 'Connecting to event stream…'}
            </p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-muted)]">
            <Activity className="w-6 h-6 opacity-30" />
            <p className="text-center px-4">All events are GET calls, hidden by the filter above</p>
          </div>
        ) : (
          <div className="py-1">
            {filteredEvents.map((evt) => {
              const isExpanded = expanded.has(evt.id);
              const hasRequestBody = evt.requestBody && Object.keys(evt.requestBody).length > 0;
              const hasResponseBody = evt.responseBody !== undefined && evt.responseBody !== null &&
                (typeof evt.responseBody !== 'object' || Object.keys(evt.responseBody).length > 0);
              const hasBody = hasRequestBody || hasResponseBody;
              return (
                <div key={evt.id} className="border-b border-[var(--border-default)] last:border-0 group/row relative">
                  <div
                    onClick={() => hasBody && toggleExpand(evt.id)}
                    className={`w-full text-left px-3 py-2 hover:bg-[var(--bg-surface-muted)] transition-colors ${hasBody ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      {/* Method badge */}
                      <span className={`px-1 py-0.5 rounded border text-[10px] font-bold font-mono flex-shrink-0 ${METHOD_STYLE[evt.method] || 'bg-[var(--bg-surface-muted)] text-[var(--text-primary)] border-[var(--border-default)]'}`}>
                        {evt.method}
                      </span>
                      {/* Status */}
                      {evt.status && (
                        <span className={`font-mono font-semibold flex-shrink-0 ${statusColour(evt.status)}`}>
                          {evt.status}
                        </span>
                      )}
                      {/* Duration */}
                      {evt.durationMs && (
                        <span className="text-[var(--text-muted)] flex-shrink-0">{evt.durationMs}ms</span>
                      )}
                      <span className="text-[var(--text-muted)] flex-shrink-0">{timeStr(evt.ts)}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(toCurl(evt));
                          setCopiedId(evt.id);
                          setTimeout(() => setCopiedId((id) => (id === evt.id ? null : id)), 1500);
                        }}
                        title="Copy as cURL"
                        className="ml-auto flex-shrink-0 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-page)] opacity-0 group-hover/row:opacity-100 transition-opacity"
                      >
                        {copiedId === evt.id ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                      </button>
                      {hasBody && (
                        isExpanded
                          ? <ChevronDown className="w-3 h-3 text-[var(--text-muted)] flex-shrink-0" />
                          : <ChevronRight className="w-3 h-3 text-[var(--text-muted)] flex-shrink-0" />
                      )}
                    </div>
                    {/* Label */}
                    <div className="text-[var(--text-primary)] font-medium truncate">{evt.label}</div>
                    {/* Path */}
                    <div className="text-[var(--text-secondary)] font-mono truncate mt-0.5">{shortenPath(evt.path)}</div>
                  </div>

                  {/* Expanded request/response bodies */}
                  {isExpanded && hasBody && (
                    <div className="px-3 pb-2 space-y-2">
                      {hasRequestBody && (
                        <div>
                          <div className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1">Request Body</div>
                          <pre className="text-[10px] text-[var(--text-primary)] bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
                            {JSON.stringify(evt.requestBody, null, 2)}
                          </pre>
                        </div>
                      )}
                      {hasResponseBody && (
                        <div>
                          <div className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1">Response Body</div>
                          <pre className="text-[10px] text-[var(--text-primary)] bg-[var(--bg-surface-muted)] border border-[var(--border-default)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
                            {typeof evt.responseBody === 'string' ? evt.responseBody : JSON.stringify(evt.responseBody, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-[var(--border-default)] flex-shrink-0">
        <p className="text-[10px] text-[var(--text-muted)] text-center">
          Live Okta Management API · {BACKEND.replace('https://','').replace('http://','').split('/')[0]}
        </p>
      </div>
    </div>
  );
}
