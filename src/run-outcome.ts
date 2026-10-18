/**
 * Final-outcome accounting for one release run, from the per-attempt states the runner reported. Dependency-free.
 *
 * Every attempt lands in exactly one bucket. "Unsent" is used only for states the dispatcher assigns after it revoked
 * the one-shot permit without initiating a request (NOT_DISPATCHED, WINDOW_MISSED, OMITTED, …). An attempt that may
 * have been sent without a confirmed result is UNKNOWN and is never counted as rejected. A provider rejection (the
 * provider answered and refused) is kept apart from internal failures (browser, identity, security preparation, journal).
 */
export const HOLD_STATES: ReadonlySet<string> = new Set(['VERIFIED', 'QR_READY', 'HOLD_VERIFIED', 'HOLD_VERIFIED_QR_ATTENTION']);
export const UNSENT_STATES: ReadonlySet<string> = new Set(['NOT_DISPATCHED', 'WINDOW_MISSED', 'PREWARM_FAILED', 'OMITTED', 'EXCLUDED_BEFORE_FREEZE', 'JOURNAL_BLOCKED', 'BROWSER_FAILED', 'IDENTITY_FAILED']);
const IN_FLIGHT_STATES: ReadonlySet<string> = new Set(['IN_FLIGHT', 'RESERVED']);
const PREPARED_STATES: ReadonlySet<string> = new Set(['READY', 'IN_FLIGHT', 'RESERVED', 'REJECTED', 'UNKNOWN', ...HOLD_STATES]);
/** Unsent reasons that are failures inside this application or its browsers, not provider decisions. */
const INTERNAL_UNSENT: ReadonlySet<string> = new Set(['PREWARM_FAILED', 'BROWSER_FAILED', 'IDENTITY_FAILED', 'JOURNAL_BLOCKED']);

export interface RunOutcomeSummary {
  planned: number; prepared: number; initiated: number; holds: number; rejected: number; unsent: number; unknown: number; pending: number;
  internalFailures: number; unsentReasons: Record<string, number>;
  settled: boolean;
  headline: 'HOLD VERIFIED' | 'OUTCOME UNKNOWN' | 'ALL SENT ATTEMPTS REJECTED' | 'NOTHING DISPATCHED' | 'IN PROGRESS' | 'NO ATTEMPTS';
  detail: string;
  /** What the operator should do next; never a retry of an uncertain submission. */
  nextStep: string;
}
export function summarizeRunOutcome(attempts: ReadonlyArray<{ state: string; code?: string }>, plannedCount?: number): RunOutcomeSummary {
  const planned = Math.max(plannedCount ?? 0, attempts.length);
  let holds = 0, rejected = 0, unsent = 0, unknown = 0, pending = 0, prepared = 0, internalFailures = 0;
  const unsentReasons: Record<string, number> = {};
  for (const attempt of attempts) {
    if (PREPARED_STATES.has(attempt.state)) prepared++;
    if (HOLD_STATES.has(attempt.state)) holds++;
    else if (attempt.state === 'REJECTED') rejected++;
    else if (attempt.state === 'UNKNOWN') { unknown++; if (attempt.code === 'PRECISION_DISPATCH_UNCLASSIFIED') internalFailures++; }
    else if (UNSENT_STATES.has(attempt.state)) {
      unsent++; const reason = attempt.code ?? attempt.state; unsentReasons[reason] = (unsentReasons[reason] ?? 0) + 1;
      if (INTERNAL_UNSENT.has(attempt.state)) internalFailures++;
    } else pending++;
  }
  // Attempts the plan authorized but that never reported a state are still pending, not unsent.
  pending += planned - attempts.length;
  const initiated = holds + rejected + unknown + attempts.filter(a => IN_FLIGHT_STATES.has(a.state)).length;
  const settled = pending === 0;
  const headline: RunOutcomeSummary['headline'] = !planned ? 'NO ATTEMPTS' : holds ? 'HOLD VERIFIED' : unknown ? 'OUTCOME UNKNOWN' : !settled ? 'IN PROGRESS'
    : rejected ? 'ALL SENT ATTEMPTS REJECTED' : 'NOTHING DISPATCHED';
  const reasons = Object.entries(unsentReasons).sort((a, b) => b[1] - a[1]).map(([code, n]) => `${n} ${code}`).join(', ');
  const detail = `${planned} planned · ${prepared} prepared · ${initiated} request${initiated === 1 ? '' : 's'} initiated · ${holds} verified hold${holds === 1 ? '' : 's'} · ${rejected} rejected by the provider · ${unsent} definitively unsent${reasons ? ` (${reasons})` : ''} · ${unknown} unknown${pending ? ` · ${pending} still pending` : ''}`;
  const nextStep = holds ? 'Open the QR page and pay manually before the hold expires. Nothing is paid or cancelled automatically.'
    : unknown ? 'An attempt may have been sent without a confirmed result. Do NOT retry. Check Onda manually; the record stays UNKNOWN.'
      : !settled ? 'Wait for every attempt to settle.'
        : rejected ? 'The provider refused every sent attempt. No hold exists from this run. Review Activity before preparing another run.'
          : 'No checkout request was sent. Review the reasons above, then save and prepare a new run if you want to try again.';
  return { planned, prepared, initiated, holds, rejected, unsent, unknown, pending, internalFailures, unsentReasons, settled, headline, detail, nextStep };
}
