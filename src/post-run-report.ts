import type { Dashboard } from '../ui/types.js';
import type { RunOutcomeSummary } from './run-outcome.js';

export interface PostRunReport {
  version: 1; runId: string; createdAt: string; summary: RunOutcomeSummary; conclusion: string;
  workers: Array<{ worker: string; states: Record<string, number>; codes: string[] }>;
  calibration: { status: string; p95: number | null; max: number | null; matchesPlan: boolean };
  preparation: { p95Ms: number | null; samples: number; security: Array<{ worker: string; durationMs: number | null }> };
  recommendations: string[]; comparison: string | null;
  dispatch:{evidence:'MATCHED_RUN_TELEMETRY'|'NOT_AVAILABLE';p95Ms:number|null;maxMs:number|null;spreadMs:number|null;
    attempts:Array<{worker:string;offsetMs:number|null;triggerToChromeMs:number|null;httpStatus:number|null;throttled:boolean;finalState:string|null}>};
}
const code = (s: string) => /^[A-Z][A-Z0-9_]{0,100}$/.test(s) ? s : 'UNCLASSIFIED';
/** Sanitized projection. No raw activities, provider identifiers, contacts, URLs or tokens are exported. */
export function postRunReport(state: Dashboard, previous?: PostRunReport | null, now = Date.now()): PostRunReport | null {
  const summary = state.runSummary, runId = state.runTiming?.runId;
  if (!summary?.settled || !summary.planned || !runId || state.runSummaryRunId!==runId || !state.runTiming?.endedAt || !/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) return null;
  const recommendations: string[] = [];
  if (summary.unknown) recommendations.push('Reconcile UNKNOWN submissions with Onda; do not retry or reclassify them from elapsed time.');
  if (summary.holds) recommendations.push('Review every verified temporary hold and handle QR/payment manually; a hold is not a paid booking.');
  if (summary.unsent) recommendations.push('Review the recorded unsent reasons and worker failures before accepting a different plan.');
  if (state.shotgunTimingVerdict?.status !== 'READY') recommendations.push('Measure the exact saved topology locally before authorizing another Shotgun release.');
  const parents = state.live?.parents ?? [];
  const telemetry=state.runSummaryRunnerId?state.telemetry?.find(t=>t.runId===state.runSummaryRunnerId):null;
  if (parents.some(p => p.children.some(c => /THROTTL|RATE_LIMIT|429/.test(c.code ?? '')))) recommendations.push('Provider throttling was observed. Stop and confirm permitted request volume; do not increase traffic.');
  return { version: 1, runId, createdAt: new Date(now).toISOString(), summary: structuredClone(summary),
    conclusion: `${summary.planned} planned, ${summary.prepared} prepared, ${summary.initiated} initiated, ${summary.unsent} definitively unsent, ${summary.holds} verified temporary holds, ${summary.unknown} UNKNOWN.`,
    workers: parents.map(p => ({ worker: /^[A-H]$/.test(p.workerId ?? '') ? p.workerId! : 'unassigned',
      states: p.children.reduce<Record<string,number>>((counts,c) => { const k = code(c.state); counts[k] = (counts[k] ?? 0)+1; return counts; }, {}),
      codes: [...new Set(p.children.map(c => c.code ? code(c.code) : '').filter(Boolean))] })),
    calibration: { status: state.shotgunTimingVerdict?.status ?? 'NOT_TESTED', p95: state.shotgunTimingVerdict?.p95 ?? null, max: state.shotgunTimingVerdict?.max ?? null, matchesPlan: !!state.shotgunTimingVerdict?.matchesPlan },
    preparation: { p95Ms: state.prewarmFeasibility?.preparationP95Ms ?? null, samples: state.prewarmFeasibility?.sampleCount ?? 0,
      security: (state.securityCheck?.workers ?? []).map(w => ({ worker: w.id, durationMs: w.durationMs })) }, recommendations,
    comparison: previous ? `Previous recorded run: ${previous.summary.initiated} initiated, ${previous.summary.unsent} unsent, ${previous.summary.unknown} UNKNOWN. Different plans or conditions do not establish a timing advantage.` : null,
    dispatch:{evidence:telemetry?'MATCHED_RUN_TELEMETRY':'NOT_AVAILABLE',p95Ms:telemetry?.summary.configuredToChrome.p95??null,maxMs:telemetry?.summary.configuredToChrome.max??null,spreadMs:telemetry?.summary.spreadMs??null,
      attempts:(telemetry?.children??[]).map(c=>({worker:/^[A-H]$/.test(c.workerId)?c.workerId:'unassigned',offsetMs:c.configuredOffsetMs,triggerToChromeMs:c.errorMs,httpStatus:c.httpStatus,throttled:c.providerThrottleSignal,finalState:c.finalState?code(c.finalState):null}))} };
}
