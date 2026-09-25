import { useState, useEffect, useCallback } from 'react';
import type { TokenResult } from '@/components/TokenStepCard';
import type { OriginNodeData } from './graphData';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// One token per user-visible action now — the exchange (id-jag) and redemption (final token) are
// separate clicks/hops instead of a bundled step2+step3 pair, matching the real two-request
// mechanics: clicking the caller runs the exchange, clicking the target runs the redemption.
// tokenType labels the node icon chip (AT/ID/JAG) so it's clear which kind of token a given
// request/response pair actually produced, without the user having to open the inspector to tell.
export type TokenType = 'AT' | 'ID' | 'JAG';
export interface HopResult { label: string; result: TokenResult; tokenType: TokenType; }

export interface PendingExchange {
  exchangeRid: string; callerNodeId: string; targetNodeId: string; targetLabel: string; kind: 'agent' | 'authserver';
}

// Some failures never reach Okta at all (no credential stored, network error) — the backend
// returns a bare {error} with no step2/step3 to attach an icon to. Synthesizing a TokenResult
// here means every failure still shows a red icon on the node, per the "no separate error UI,
// show it as an error icon on the node" decision — there's no side panel anymore to put text in.
function errorResult(message: string): TokenResult {
  return { ok: false, status: 0, raw: { error: message } };
}

// Ports AgentExerciseStep.tsx's credential-check-then-run logic into a form driven by graph node
// clicks (an ordered path) instead of a <select> + recursive component nesting. Behavior and
// backend calls are identical for the initial grant/login — the downstream hop is split into two
// explicit calls (runExchange, then runRedeem) matching the two real Okta requests per hop.
export function usePathRunner() {
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [actingAgentId, setActingAgentId] = useState<string | null>(null);
  const [rid, setRid] = useState<string | null>(null);
  const [awaitingLogin, setAwaitingLogin] = useState(false);
  const [complete, setComplete] = useState(false);
  const [pendingExchange, setPendingExchange] = useState<PendingExchange | null>(null);

  const [steps, setSteps] = useState<HopResult[]>([]);
  // Parallel to `steps` — pathNodeIds[i] is the graph node steps[i]'s token belongs to (the start
  // node for steps[0]; the CALLER node for an exchange; the TARGET node for a redemption). Lets
  // ExerciseGraph.tsx attach request/response icons to the specific node each token belongs to.
  const [pathNodeIds, setPathNodeIds] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setCurrentNodeId(null); setActingAgentId(null); setRid(null);
    setAwaitingLogin(false); setComplete(false); setPendingExchange(null);
    setSteps([]); setPathNodeIds([]); setError('');
  }, []);

  // Triggered by clicking the service-client app node (AppNode.tsx, isMachineOrigin) — that node
  // IS the caller identity for this grant, so its request/response icons belong on the APP node
  // (appNodeId), not on the agent the grant is scoped to. The path's current position still moves
  // to that agent (agentNodeId) once the token exists, since that's the next clickable node.
  async function startMachine(agentDashboardId: string, appNodeId: string, agentNodeId: string) {
    reset(); setRunning(true);
    try {
      const res = await fetch(`${BACKEND}/api/exercise/agents/${agentDashboardId}/machine-access/token`, { method: 'POST' });
      const data = await res.json();
      // The backend still returns the real request/response as `step1` even when the grant
      // itself failed (postToken captures both regardless of Okta's response) — attach it to the
      // app node either way so its red icon shows what actually went wrong. If it's a pre-flight
      // failure with no step1 at all (e.g. Settings misconfigured), synthesize one so the node
      // still gets a red icon instead of no feedback.
      const step1 = data.step1 || (!res.ok ? errorResult(data.error || 'Failed to get initial token') : undefined);
      if (step1) { setSteps([{ label: 'Service Client Grant', result: step1, tokenType: 'AT' }]); setPathNodeIds([appNodeId]); }
      if (!res.ok || !data.rid) {
        setError(data.error || data.step1?.raw?.error_description || data.step1?.raw?.error || 'Failed to get initial token');
        setRunning(false);
        return;
      }
      setCurrentNodeId(agentNodeId);
      setActingAgentId(agentDashboardId);
      setRid(data.rid);
    } catch (e: any) { setError(e.message); }
    setRunning(false);
  }

  async function startUser(origin: OriginNodeData) {
    reset(); setRunning(true);
    try {
      const res = await fetch(`${BACKEND}/api/exercise/agents/${origin.agentDashboardId}/user-access/start`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to start login'); setRunning(false); return; }
      window.open(data.authorizeUrl, '_blank', 'noopener,noreferrer');
      setAwaitingLogin(true);
    } catch (e: any) { setError(e.message); }
    setRunning(false);
  }

  // Called once the Okta redirect callback delivers a rid (see ExerciseGraph's searchParams
  // effect) — resumes the path exactly as if the origin's token had arrived synchronously. The
  // login's own request/response icons belong on the "User login" origin node (originNodeId),
  // same reasoning as startMachine's app node; the path's position moves to the agent node.
  function resumeFromLogin(loginRid: string, agentDashboardId: string, originNodeId: string, agentNodeId: string, decoded: { idToken?: any; accessToken?: any }) {
    setAwaitingLogin(false); setComplete(false); setPendingExchange(null);
    setSteps([
      { label: 'User Login', result: { ok: true, status: 200, decoded: decoded.idToken ? { header: {}, payload: decoded.idToken } : undefined, raw: decoded }, tokenType: 'ID' },
    ]);
    setPathNodeIds([originNodeId]);
    setCurrentNodeId(agentNodeId);
    setActingAgentId(agentDashboardId);
    setRid(loginRid);
  }

  // Runs the token-exchange half of a hop, triggered by clicking the CALLER node (currentNodeId)
  // itself when it has exactly one downstream option. Doesn't move the path — the hop's token
  // lands on the caller's own node, and pendingExchange records what's needed to redeem it once
  // the target node is clicked. Accepts explicit rid/callerNodeId overrides (rather than always
  // reading the hook's own state) so a redeem that lands on a new node can chain straight into
  // that node's exchange in the same click, before React has re-rendered with the new state.
  async function runExchange(
    kind: 'agent' | 'authserver', targetId: string, targetNodeId: string, targetLabel: string,
    overrides?: { rid: string; callerNodeId: string }
  ): Promise<PendingExchange | null> {
    const effectiveRid = overrides?.rid ?? rid;
    const effectiveCallerNodeId = overrides?.callerNodeId ?? currentNodeId;
    if (!effectiveRid || !effectiveCallerNodeId) return null;
    setRunning(true); setError('');
    try {
      const body = kind === 'agent' ? { rid: effectiveRid, targetAgentId: targetId } : { rid: effectiveRid, connectionId: targetId };
      const res = await fetch(`${BACKEND}/api/exercise/agents/exercise/exchange`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      // Same reasoning as startMachine: step2 is present even on failure, so the exchange's icon
      // shows up in red on the caller node instead of vanishing when Okta rejects the request —
      // and a pre-flight failure (no credential stored, etc) with no step2 at all still gets a
      // synthesized one, since there's no side panel left to show the error text in.
      const step2 = data.step2 || (!res.ok ? errorResult(data.error || 'Failed to run exchange') : undefined);
      if (step2) {
        setSteps((prev) => [...prev, { label: `Exchange → ${targetLabel}`, result: step2, tokenType: 'JAG' }]);
        setPathNodeIds((prev) => [...prev, effectiveCallerNodeId]);
      }
      if (!res.ok || !data.exchangeRid) {
        setError(data.error || data.step2?.raw?.error_description || data.step2?.raw?.error || 'Failed to run exchange');
        setRunning(false);
        return null;
      }
      const pending: PendingExchange = { exchangeRid: data.exchangeRid, callerNodeId: effectiveCallerNodeId, targetNodeId, targetLabel, kind };
      setPendingExchange(pending);
      setRunning(false);
      return pending;
    } catch (e: any) { setError(e.message); }
    setRunning(false);
    return null;
  }

  // Runs the redemption half of a hop, triggered by clicking the TARGET node once its caller's
  // exchange has already produced a pendingExchange. Both the exchange AND the redemption
  // authenticate as the CALLER (same credential, confirmed against the backend's runIdJagExchange/
  // runJwtBearerRedemption calls — both use caller.oktaAgentId) — so both requests' icons belong
  // on the caller's node, not split across caller/target. The target node shows nothing until it
  // becomes a caller itself for a further hop. Moves the path onto the target on success (agent
  // hop) or marks the chain complete (authserver hop — terminal, no further nextRid).
  //
  // Returns where the path landed so the caller (ExerciseGraph) can decide whether to immediately
  // chain into that node's own exchange — reading it from this return value rather than the hook's
  // state, since state updates from the setState calls above aren't visible on `this` closure yet
  // by the time the caller's await resolves.
  async function runRedeem(pendingOverride?: PendingExchange): Promise<{ landedNodeId: string; isAgentHop: boolean; nextRid?: string } | null> {
    const effectivePending = pendingOverride ?? pendingExchange;
    if (!effectivePending) return null;
    setRunning(true); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/exercise/agents/exercise/redeem`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exchangeRid: effectivePending.exchangeRid }),
      });
      const data = await res.json();
      // Same reasoning as the exchange/grant above: step3 is present even on failure, so the
      // redemption's icon shows up in red on the CALLER node instead of vanishing — and a
      // pre-flight failure with no step3 at all still gets a synthesized one.
      const step3 = data.step3 || (!res.ok ? errorResult(data.error || 'Failed to redeem') : undefined);
      if (step3) {
        setSteps((prev) => [...prev, { label: `Redeem — ${effectivePending.targetLabel}`, result: step3, tokenType: 'AT' }]);
        setPathNodeIds((prev) => [...prev, effectivePending.callerNodeId]);
      }
      if (!res.ok) {
        setError(data.error || data.step3?.raw?.error_description || data.step3?.raw?.error || 'Failed to redeem');
        setRunning(false);
        return null;
      }
      const targetNodeId = effectivePending.targetNodeId;
      const wasAgentHop = effectivePending.kind === 'agent';
      setPendingExchange(null);
      if (wasAgentHop && data.nextRid) {
        const targetDashboardId = targetNodeId.replace(/^agent:/, '');
        setCurrentNodeId(targetNodeId);
        setActingAgentId(targetDashboardId);
        setRid(data.nextRid);
        setRunning(false);
        return { landedNodeId: targetNodeId, isAgentHop: true, nextRid: data.nextRid };
      } else {
        // Terminal authserver hop — no further hop to select, but the "current position" still
        // moves to the target so its icon (and the selected-node ring) reflects where the chain
        // actually ended, instead of leaving the ring stuck on the node clicked to trigger redeem.
        setCurrentNodeId(targetNodeId);
        setComplete(true);
        setRunning(false);
        return { landedNodeId: targetNodeId, isAgentHop: false };
      }
    } catch (e: any) { setError(e.message); }
    setRunning(false);
    return null;
  }

  return {
    currentNodeId, actingAgentId, awaitingLogin, complete, pendingExchange,
    steps, pathNodeIds, running, error,
    startMachine, startUser, resumeFromLogin,
    runExchange, runRedeem, reset,
  };
}

export type PathRunner = ReturnType<typeof usePathRunner>;
