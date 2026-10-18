import type { UiEvent } from '../src/ui-events.js';
import type { LiveChildView, LiveParentView, LiveRunView } from './types.js';

/**
 * Live view model: the current run grouped by LOGICAL TARGET (the parent goal) with its independently tracked attempts
 * (fan-out children, or the single attempt of a target) underneath, plus prewarm tiers and Rescue predictions.
 * Pure reducer over the runner's stage events; nothing here decides or sends anything.
 */
type Stage = Extract<UiEvent, { type: 'apiStage' }>;
export const emptyLiveRun = (): LiveRunView => ({ parents: [], predictions: [], notes: [] });
const TERMINAL = new Set(['REJECTED', 'UNKNOWN', 'VERIFIED', 'QR_READY', 'HOLD_VERIFIED', 'HOLD_VERIFIED_QR_ATTENTION', 'NOT_DISPATCHED', 'WINDOW_MISSED',
  'PREWARM_FAILED', 'OMITTED', 'EXCLUDED_BEFORE_FREEZE', 'JOURNAL_BLOCKED', 'BROWSER_FAILED', 'IDENTITY_FAILED']);

function parentFor(view: LiveRunView, key: string, init: Omit<LiveParentView, 'key' | 'children'>): LiveParentView {
  let parent = view.parents.find(value => value.key === key);
  if (!parent) { parent = { key, ...init, children: [] }; view.parents.push(parent); }
  else Object.assign(parent, Object.fromEntries(Object.entries(init).filter(([, value]) => value !== undefined)));
  return parent;
}
function childFor(parent: LiveParentView, event: Stage, fallbackIndex = 0): LiveChildView {
  const index = event.fanOutIndex ?? fallbackIndex, count = event.fanOutCount ?? 1;
  let child = event.attemptId ? parent.children.find(value => value.attemptId === event.attemptId) : undefined;
  child ??= parent.children.find(value => value.fanOutIndex === index && (!event.attemptId || value.attemptId.startsWith('pending-')));
  if (!child) {
    child = { attemptId: event.attemptId ?? `pending-${index}`, label: `${parent.workerId ?? '?'}${count > 1 || index > 0 ? index : ''}`, fanOutIndex: index, fanOutCount: count, state: 'ARMED' };
    parent.children.push(child); parent.children.sort((a, b) => a.fanOutIndex - b.fanOutIndex);
  }
  if (event.attemptId && child.attemptId.startsWith('pending-')) child.attemptId = event.attemptId;
  child.fanOutCount = Math.max(child.fanOutCount, count);
  if(event.shotIndex!==undefined)child.shotIndex=event.shotIndex;if(event.shotCount!==undefined)child.shotCount=event.shotCount;
  return child;
}
const setState = (child: LiveChildView, state: string, code?: string) => {
  // A terminal outcome is never overwritten by a late non-terminal event.
  if (TERMINAL.has(child.state) && !TERMINAL.has(state)) return;
  child.state = state; if (code) child.code = code;
};

export function reduceLiveRun(previous: LiveRunView | null | undefined, event: Stage, candidates: Map<string, { court: number; startTime: string; endTime: string }>): LiveRunView | null {
  if (event.stage === 'RUN_STARTED') { candidates.clear(); return emptyLiveRun(); }
  const view = previous ? structuredClone(previous) : emptyLiveRun();
  const wave = event.wave ?? 'WAVE_1';
  const target = (candidateId?: string) => candidateId ? candidates.get(candidateId) : undefined;
  switch (event.stage) {
    case 'PHASE3_AUTHORIZATION': view.rescueEnabled = (event.maxRescue ?? 0) > 0; view.rescueMax = event.maxRescue; return view;
    case 'PHASE3_CANDIDATE':
      if (event.candidateId && event.court && event.startTime && event.endTime) candidates.set(event.candidateId, { court: event.court, startTime: event.startTime, endTime: event.endTime });
      return previous ?? null;
    case 'PHASE3_FAN_OUT_CHILD': case 'PHASE3_WAVE1_STARTED': case 'PHASE3_SETTLED': case 'PHASE3_ATTEMPT_RESERVED': case 'PHASE3_DISPATCH': {
      if (!event.candidateId && !event.workerId) return previous ?? null;
      const known = target(event.candidateId);
      // Wave 1 groups by immediate target; Wave 2 and Rescue group every attempt at the same candidate (e.g. two reopen epochs).
      const key = event.stage === 'PHASE3_FAN_OUT_CHILD' || wave === 'WAVE_1' ? `W1/${event.candidateId ?? event.workerId}` : `${wave}/${event.candidateId ?? event.attemptId}`;
      const parent = parentFor(view, key, { wave: event.stage === 'PHASE3_FAN_OUT_CHILD' ? 'WAVE_1' : wave, workerId: event.workerId, candidateId: event.candidateId,
        court: event.court ?? known?.court, startTime: event.startTime ?? known?.startTime, endTime: event.endTime ?? known?.endTime });
      const child = childFor(parent, event);
      if (event.stage === 'PHASE3_FAN_OUT_CHILD') { child.offsetMs = event.releaseOffsetMs; return view; }
      if (event.stage === 'PHASE3_WAVE1_STARTED' || event.stage === 'PHASE3_DISPATCH') setState(child, 'IN_FLIGHT');
      else if (event.stage === 'PHASE3_ATTEMPT_RESERVED') setState(child, 'RESERVED');
      else setState(child, event.state ?? 'UNKNOWN', event.code);
      return view;
    }
    case 'PHASE3_WAVE1_UNSENT': case 'PHASE3_WAVE1_EXCLUDED': case 'PHASE3_OVERRIDE_KEPT': {
      const parent = view.parents.find(value => value.wave === 'WAVE_1' && (value.candidateId === event.candidateId || (!event.candidateId && value.workerId === event.workerId)));
      if (event.stage === 'PHASE3_OVERRIDE_KEPT') { view.notes.push(`Worker ${event.workerId}: kept despite a known public booking (operator override).`); return view; }
      if (event.stage === 'PHASE3_WAVE1_EXCLUDED') { view.notes.push(`Worker ${event.workerId}: left out at freeze (${(event.code ?? 'EXCLUDED').replaceAll('_', ' ').toLowerCase()}).`); return view; }
      if (parent) setState(childFor(parent, event), event.code==='PREWARM_TIER_OMITTED'?'OMITTED':event.state ?? 'NOT_DISPATCHED', event.code);
      return view;
    }
    case 'PRECISION_ATTEMPT_STATE': {
      if (!event.workerId) return previous ?? null;
      const parent = parentFor(view, `F/${event.workerId}`, { wave: 'WAVE_1', workerId: event.workerId, court: event.court, startTime: event.startTime, endTime: event.endTime });
      setState(childFor(parent, event), event.attemptState ?? 'UNKNOWN', event.code);
      return view;
    }
    case 'PREWARM_PLAN': view.prewarm = { leadMs: event.prewarmLeadMs ?? 0, width: event.fanOutCount ?? 1 }; return view;
    // What the run actually obtained, against the earliest trigger (October 18: planned 105 s, obtained about 30 s).
    case 'PREWARM_WINDOW': view.prewarm = { leadMs: event.prewarmLeadMs ?? view.prewarm?.leadMs ?? 0, width: view.prewarm?.width ?? 1,
      ...(event.leadBeforeTriggerMs !== undefined ? { actualLeadMs: event.leadBeforeTriggerMs } : {}), ...(event.lateByMs !== undefined ? { lateByMs: event.lateByMs } : {}) }; return view;
    case 'SECURITY_PREWARM_STARTED': case 'SECURITY_PREWARM_READY': case 'SECURITY_PREWARM_FAILED': {
      if(!event.attemptId)return previous??null;const parent=view.parents.find(value=>value.children.some(child=>child.attemptId===event.attemptId));if(!parent)return previous??null;
      const child=childFor(parent,event);setState(child,event.stage==='SECURITY_PREWARM_STARTED'?'PREPARING':event.stage==='SECURITY_PREWARM_READY'?'READY':'FAILED',event.code);return view;
    }
    case 'PREWARM_TIER_STATUS': view.tiers = event.message; return view;
    case 'RESCUE_PREDICTION': {
      if (!event.candidateId || event.predictedStartMs === undefined || event.predictedEndMs === undefined) return previous ?? null;
      const known = target(event.candidateId), existing = view.predictions.find(value => value.candidateId === event.candidateId);
      const next = { candidateId: event.candidateId, ...(known ? { court: known.court, startTime: known.startTime, endTime: known.endTime } : {}),
        predictedStartMs: event.predictedStartMs, predictedEndMs: event.predictedEndMs, confidence: event.confidence ?? 'LOW' };
      if (existing) Object.assign(existing, next); else view.predictions.push(next);
      return view;
    }
    case 'RESCUE_PREWARM': case 'RESCUE_PREWARM_READY': case 'RESCUE_PREWARM_FAILED': case 'RESCUE_PREDICTION_OUTCOME': {
      const prediction = view.predictions.find(value => value.candidateId === event.candidateId);
      if (!prediction) return previous ?? null;
      if (event.stage === 'RESCUE_PREDICTION_OUTCOME') prediction.errorMs = event.errorMs;
      else prediction.prewarm = event.stage === 'RESCUE_PREWARM' ? 'PREPARING' : event.stage === 'RESCUE_PREWARM_READY' ? 'READY' : 'FAILED';
      return view;
    }
    case 'PHASE3_OUTCOME': case 'PRECISION_OUTCOME': view.outcome = event.outcome; return view;
    default: return previous ?? null;
  }
}

/** One-line summary of a parent's children, e.g. "3 attempts: 2 rejected, 1 in flight". */
export function describeChildren(parent: LiveParentView): string {
  const counts = new Map<string, number>();
  for (const child of parent.children) counts.set(child.state, (counts.get(child.state) ?? 0) + 1);
  const words = [...counts].map(([state, count]) => `${count} ${state.replaceAll('_', ' ').toLowerCase()}`);
  return `${parent.children.length} attempt${parent.children.length === 1 ? '' : 's'}: ${words.join(', ')}`;
}
