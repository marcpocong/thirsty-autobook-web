import type { ReadinessLayer, Recovery } from './execution-state.js';
import type { SavedPlanDate } from './release-plan-date.js';
import type { ShotgunTimingVerdict } from './shotgun-timing.js';

/**
 * Release Day Preflight: one operator-facing verdict over the SAVED release authorization and the actual runtime.
 * Dependency-free (renderer-safe). It validates nothing itself: every row restates a controller check, readiness layer
 * or published verdict, so Booking Setup and the execution console cannot disagree. A row's recovery is a typed action;
 * none of them saves, re-dates, authorizes Terms, attests or arms. Owner authorization is always the operator's final
 * step and never counted as ready.
 */
export type PreflightStatus = 'VERIFIED' | 'NEEDS_ACTION' | 'BLOCKED' | 'RUNNING' | 'EXPIRED' | 'UNKNOWN';
export type PreflightVerdict = 'READY_FOR_AUTHORIZATION' | 'NEEDS_ACTION' | 'BLOCKED' | 'ARMED';
/** passive: read from state · genuine: a real Onda verification (nothing submitted) · local: offline on this computer. */
export type PreflightInspection = 'passive' | 'genuine' | 'local';
export interface PreflightRow {
  id: 'plan' | 'date' | 'browsers' | 'security' | 'timing' | 'forecast' | 'clock' | 'machine' | 'locks' | 'other' | 'authorization';
  /** The readiness layer this row restates, when there is one (kept for stable selectors). */ layer?: ReadinessLayer['id'];
  label: string; status: PreflightStatus; detail: string; caution?: string; recovery?: Recovery | null; inspection?: PreflightInspection;
}
export interface PreflightCheck { id: string; label: string; level: 'GOOD' | 'DEGRADED' | 'UNAVAILABLE'; hardBlock: boolean; detail: string }
export interface PreflightInput {
  now: number;
  /** Live Shotgun requirements (genuine security check, READY calibration) apply. */ shotgun: boolean;
  savedPlan: { exists: boolean; fingerprint: string | null; summary: string;
    /** Booking Setup only: the on-screen draft against the saved plan. */ draft?: { matches: boolean | null; differences: number; problems: number } | null };
  planDate: SavedPlanDate | null;
  releaseMs: number | null;
  layers: readonly ReadinessLayer[];
  checks: readonly PreflightCheck[];
  operation: string;
  prepared: { forSaved: boolean; forOther: boolean };
  armed: boolean; running: boolean;
  securityCheck: { status: 'PASSED' | 'FAILED' | 'STALE' | 'OTHER_PLAN' | 'OTHER_BROWSER' | 'MISSING'; detail: string; checkedAt: string | null; expiresAt?: string | null;
    workers?: ReadonlyArray<{ id: string; outcome: string; durationMs: number | null; challengeFrame: string | null }> } | null;
  /** The engine's preparation forecast for the saved plan (lead and the measured duration it was sized for). */
  forecast: { leadMs: number; p95Ms: number; measured: boolean; samples: number; retryCutoffLeadMs?: number } | null;
  timing: ShotgunTimingVerdict | null;
  lock: { present: boolean; unresolvedSubmission: boolean; canPrepareOver: boolean };
  unknownResults: number;
  termsAuthorized: boolean;
}
export interface Preflight { verdict: PreflightVerdict; title: string; summary: string; rows: PreflightRow[] }

const manila = (ms: number, withDay = false) => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false,
  ...(withDay ? { weekday: 'short', day: 'numeric', month: 'short' } : {}) }).format(ms);
const at = (iso: string | null | undefined, now: number) => { const ms = iso ? Date.parse(iso) : NaN; if (!Number.isFinite(ms)) return '—';
  return manila(ms, Math.abs(ms - now) > 18 * 3600_000); };
const s1 = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const day = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(Date.parse(`${iso}T00:00:00Z`)) : iso;
const fromCheck = (check: PreflightCheck | undefined): PreflightStatus => !check ? 'UNKNOWN' : check.level === 'GOOD' ? 'VERIFIED' : check.hardBlock ? 'BLOCKED' : 'NEEDS_ACTION';
const PREPARING = new Set(['prepare', 'resetting', 'chrome', 'inspect']);

export function releasePreflight(i: PreflightInput): Preflight {
  const rows: PreflightRow[] = [], check = (id: string) => i.checks.find(c => c.id === id), layer = (id: ReadinessLayer['id']) => i.layers.find(l => l.id === id);
  const live = i.armed || i.running, covered = new Set<string>(['config']);
  const prepareRecovery: Recovery = { label: i.prepared.forOther ? 'Prepare again' : 'Prepare', action: 'PREPARE' };

  // 1. The saved authorization (never the draft on screen).
  const config = check('config'), planLayer = layer('PLAN');
  if (!i.savedPlan.exists) rows.push({ id: 'plan', layer: 'PLAN', label: 'Saved release plan', status: 'BLOCKED', detail: 'There is no saved release plan. Build the plan, then Save release plan.', recovery: { label: 'Review plan', action: 'REVIEW_PROBLEMS' } });
  else if (config && config.level !== 'GOOD' && !(i.planDate && i.planDate.status !== 'CURRENT' && i.planDate.status !== 'UNDATED'))
    rows.push({ id: 'plan', layer: 'PLAN', label: 'Saved release plan', status: 'BLOCKED', detail: config.detail, recovery: { label: 'Review plan', action: 'REVIEW_PROBLEMS' } });
  else {
    // The saved plan is what Prepare and Arm use; an unsaved or invalid draft is named as such, never as the saved plan's state.
    const draft = i.savedPlan.draft;
    const differs = !!draft && draft.matches === false, broken = !!draft && draft.problems > 0;
    rows.push({ id: 'plan', layer: 'PLAN', label: 'Saved release plan', status: differs ? 'NEEDS_ACTION' : 'VERIFIED', detail: i.savedPlan.summary,
      ...(differs ? { caution: `Your draft differs from it (${draft!.differences} change${draft!.differences === 1 ? '' : 's'}). Prepare and Arm use only the saved plan: save the draft deliberately or load the saved plan back.`,
        recovery: { label: 'Review differences', action: 'REVIEW_CHANGES' } }
        : broken ? { caution: `The draft on screen has ${draft!.problems} problem${draft!.problems === 1 ? '' : 's'} and cannot be saved yet; the saved plan above is unchanged.` }
          : planLayer && planLayer.status === 'BLOCKED' ? { caution: planLayer.detail } : {}) });
  }
  // 2. Target date: a plan saved for an earlier release is blocked, never re-dated.
  const pd = i.planDate, release = i.releaseMs ? manila(i.releaseMs, true) : 'the next release';
  if (i.savedPlan.exists && pd) rows.push(pd.status === 'CURRENT' || pd.status === 'UNDATED'
    ? { id: 'date', label: 'Target date', status: 'VERIFIED', detail: `${day(pd.planDate ?? pd.targetDate)} · published by the ${release} release` }
    : { id: 'date', label: 'Target date', status: 'BLOCKED', detail: pd.detail, recovery: { label: 'Review plan date', action: 'REVIEW_PLAN_DATE' } });

  // 3. Dedicated browsers (environment layer plus the exact Shotgun tab topology).
  const env = layer('ENVIRONMENT'), topology = check('shotgun-topology'); covered.add('shotgun-topology');
  const workerChecks = i.checks.filter(c => c.id.startsWith('worker-')); workerChecks.forEach(c => covered.add(c.id));
  if (PREPARING.has(i.operation)) rows.push({ id: 'browsers', layer: 'ENVIRONMENT', label: 'Dedicated browsers', status: 'RUNNING', detail: 'Preparing the browsers the saved plan needs. Nothing is sent.' });
  else if (i.prepared.forOther) rows.push({ id: 'browsers', layer: 'ENVIRONMENT', label: 'Dedicated browsers', status: 'NEEDS_ACTION', detail: env?.detail ?? 'Prepared for an older plan — prepare again', recovery: prepareRecovery });
  else if (!i.prepared.forSaved && !live) rows.push({ id: 'browsers', layer: 'ENVIRONMENT', label: 'Dedicated browsers', status: 'NEEDS_ACTION',
    detail: `${env?.detail ?? 'Not prepared'} · Prepare opens each assigned browser, checks the Onda page and then runs the security check.`, recovery: prepareRecovery });
  else {
    const bad = env?.status === 'BLOCKED' || (topology && topology.level !== 'GOOD');
    rows.push({ id: 'browsers', layer: 'ENVIRONMENT', label: 'Dedicated browsers', status: bad ? 'BLOCKED' : 'VERIFIED',
      detail: [env?.detail, topology ? `${topology.level === 'GOOD' ? 'exact tabs open' : 'required tabs missing'} (${topology.detail})` : ''].filter(Boolean).join(' · '),
      ...(bad ? { recovery: { label: 'Recheck browsers', action: 'RECHECK_BROWSERS' } } : {}) });
  }
  // 4. Security: the genuine pre-release check before arming; actual live evidence once armed.
  covered.add('security-check');
  const sec = layer('SECURITY'), sc = i.securityCheck;
  if (live && sec) rows.push({ id: 'security', layer: 'SECURITY', label: sec.label, inspection: 'genuine',
    status: sec.status === 'OK' ? 'VERIFIED' : sec.status === 'BLOCKED' ? 'BLOCKED' : sec.status === 'WARN' ? 'NEEDS_ACTION' : 'RUNNING', detail: sec.detail });
  else if (i.operation === 'checkingSecurity') rows.push({ id: 'security', layer: 'SECURITY', label: 'Security check', status: 'RUNNING', inspection: 'genuine',
    detail: 'One genuine Onda verification per bot browser. The result is discarded; nothing is submitted or held. If a THIRSTY BOT window says VERIFY HERE, complete the check there.' });
  else if (!i.prepared.forSaved && i.shotgun) rows.push({ id: 'security', layer: 'SECURITY', label: 'Security check', status: 'NEEDS_ACTION', inspection: 'genuine',
    detail: 'Runs at the end of Prepare: one genuine Onda verification per bot browser, result discarded, nothing submitted.', recovery: prepareRecovery });
  else if (sc && (i.shotgun || sc.status === 'PASSED' || sc.status === 'FAILED')) {
    const recovery: Recovery = i.prepared.forSaved ? { label: sc.status === 'PASSED' ? 'Check again' : 'Run security check', action: 'CHECK_SECURITY' } : prepareRecovery;
    const cautions: string[] = [];
    if (sc.status === 'PASSED') {
      const slow = (sc.workers ?? []).filter(w => w.durationMs !== null && i.forecast && w.durationMs > i.forecast.p95Ms);
      if (slow.length) cautions.push(`${slow.map(w => `${w.id} took ${s1(w.durationMs!)}`).join(', ')} — slower than the ${s1(i.forecast!.p95Ms)} the release lead is sized for. Check again closer to release.`);
      const challenged = (sc.workers ?? []).filter(w => w.challengeFrame === 'visible' || w.challengeFrame === 'hidden');
      if (challenged.length) cautions.push(`Onda showed a verification frame in browser ${challenged.map(w => w.id).join(', ')}. Stay at this computer at release: if a window says VERIFY HERE, complete it there.`);
    }
    const timing = sc.checkedAt ? ` · checked ${at(sc.checkedAt, i.now)}${sc.status === 'PASSED' && sc.expiresAt ? ` · counts until ${at(sc.expiresAt, i.now)}` : ''}` : '';
    rows.push({ id: 'security', layer: 'SECURITY', label: 'Security check', inspection: 'genuine',
      // Only live Shotgun requires the check; otherwise it informs and never blocks.
      status: sc.status === 'PASSED' ? 'VERIFIED' : sc.status === 'FAILED' ? (i.shotgun ? 'BLOCKED' : 'NEEDS_ACTION') : sc.status === 'STALE' ? 'EXPIRED' : 'NEEDS_ACTION',
      detail: `${sec?.label === 'Security check' ? sec.detail : sc.detail}${timing}`, ...(cautions.length ? { caution: cautions.join(' ') } : {}), recovery });
  } else if (sec && i.shotgun) rows.push({ id: 'security', layer: 'SECURITY', label: sec.label, status: 'NEEDS_ACTION', detail: sec.detail, inspection: 'genuine' });

  // 5. Local timing calibration (live Shotgun only): READY is the only pass.
  covered.add('shotgun-timing');
  if (i.shotgun) {
    const t = i.timing, unknownChrome = !!t && t.mismatches.length === 1 && t.mismatches[0]!.includes('not open');
    const recovery: Recovery | null = !t || ['NOT_TESTED', 'EXPIRED'].includes(t.status) || (t.status === 'INCOMPATIBLE' && !unknownChrome) ? { label: 'Run timing calibration', action: 'CALIBRATE_TIMING' }
      : unknownChrome ? prepareRecovery : t.status === 'FAILED' || t.status === 'AT_RISK' ? { label: 'Review capacity', action: 'REVIEW_CAPACITY' } : null;
    const measured = t && t.p95 !== null ? `p95 ${t.p95} ms · max ${t.max} ms · ${t.shotCount ?? '?'} attempt${t.shotCount === 1 ? '' : 's'} × ${t.runs ?? '?'} runs` : '';
    const when = t?.testedAt ? `tested ${at(t.testedAt, i.now)}${t.expiresAt ? ` · valid until ${at(t.expiresAt, i.now)}` : ''}` : '';
    rows.push({ id: 'timing', label: 'Timing calibration', inspection: 'local',
      status: i.operation === 'calibrating' ? 'RUNNING' : !t || t.status === 'NOT_TESTED' ? 'NEEDS_ACTION' : t.status === 'READY' ? 'VERIFIED' : t.status === 'EXPIRED' ? 'EXPIRED'
        : t.status === 'INCOMPATIBLE' ? 'NEEDS_ACTION' : 'BLOCKED',
      detail: i.operation === 'calibrating' ? 'Running locally: isolated Chrome windows open briefly; every checkout is answered on this computer.'
        : [t ? `${t.status.replaceAll('_', ' ')} · ${t.reason}` : 'NOT TESTED · No local timing calibration has been run on this machine.', measured, when, t?.matchesPlan ? 'matches this saved plan' : ''].filter(Boolean).join(' · '),
      ...(recovery && i.operation !== 'calibrating' ? { recovery } : {}) });
  }
  // 6. Preparation forecast (a forecast, never security evidence).
  const fl = layer('FORECAST'), capacity = check('wave1-preparation-capacity'); covered.add('wave1-preparation-capacity');
  if (fl && fl.status !== 'NA') {
    const status: PreflightStatus = capacity ? fromCheck(capacity) : fl.status === 'OK' ? 'VERIFIED' : fl.status === 'BLOCKED' ? 'BLOCKED' : fl.status === 'WARN' ? 'NEEDS_ACTION' : 'UNKNOWN';
    const f = i.forecast, retryWithinMs = f ? f.leadMs - (f.retryCutoffLeadMs ?? 7_000) : 0;
    rows.push({ id: 'forecast', layer: 'FORECAST', label: 'Preparation forecast', status, detail: fl.detail,
      ...(f ? { caution: `Starts ${s1(f.leadMs)} before the first trigger for a ${s1(f.p95Ms)} ${f.measured ? `measured p95 (${f.samples} successful preparations; failures are not in this figure)` : 'fallback estimate'}. A first attempt that fails within ${s1(Math.max(0, retryWithinMs))} can be retried once; a longer stall fails closed and nothing is sent late.` } : {}),
      ...(status === 'BLOCKED' || status === 'NEEDS_ACTION' ? { recovery: { label: 'Review capacity', action: 'REVIEW_CAPACITY' } } : {}) });
  }
  // 7. Trusted clock and machine.
  const clock = check('clock'); covered.add('clock');
  if (clock) rows.push({ id: 'clock', label: 'Trusted clock', status: fromCheck(clock), detail: `${clock.detail}${clock.level === 'GOOD' ? '' : ' · arming refreshes it again, but refresh now to confirm'}`,
    ...(clock.level === 'GOOD' ? {} : { recovery: { label: 'Refresh clock', action: 'SYNC_CLOCK' } }) });
  const machine = check('machine'), build = check('build'); covered.add('machine'); covered.add('build');
  if (machine) rows.push({ id: 'machine', label: 'Machine & build', status: fromCheck(machine) === 'VERIFIED' && build && build.level !== 'GOOD' ? 'NEEDS_ACTION' : fromCheck(machine),
    detail: [machine.detail, build ? `build ${build.detail}` : ''].filter(Boolean).join(' · ') });
  // 8. Locks, holds and unknown results: review-first, never cleared or retried automatically.
  rows.push(i.lock.present && i.lock.unresolvedSubmission
    ? { id: 'locks', label: 'Locks, holds & unknown results', status: 'BLOCKED', detail: 'An earlier checkout outcome is UNKNOWN and its lock is retained. It is never retried or cleared automatically; check Onda manually and review it.', recovery: { label: 'Review previous submission', action: 'REVIEW_SUBMISSION' } }
    : i.unknownResults > 0
      ? { id: 'locks', label: 'Locks, holds & unknown results', status: 'BLOCKED', detail: `The last run has ${i.unknownResults} UNKNOWN result${i.unknownResults === 1 ? '' : 's'}. Check Onda manually; it stays UNKNOWN and that target is never retried.`, recovery: { label: 'Open Activity', action: 'OPEN_ACTIVITY' } }
    : i.lock.present && i.lock.canPrepareOver
      ? { id: 'locks', label: 'Locks, holds & unknown results', status: 'NEEDS_ACTION', detail: 'A verified temporary hold is still pending manual payment. It stays with the provider until it expires or you pay.', recovery: { label: 'Review hold', action: 'REVIEW_LOCK' } }
      : i.lock.present
        ? { id: 'locks', label: 'Locks, holds & unknown results', status: 'BLOCKED', detail: 'A retained automation lock needs review before another run.', recovery: { label: 'Review lock', action: 'REVIEW_LOCK' } }
        : { id: 'locks', label: 'Locks, holds & unknown results', status: 'VERIFIED', detail: 'No retained lock, pending hold or unknown result.' });
  // 9. Any other controller hard block is shown, never dropped.
  const other = i.checks.filter(c => !covered.has(c.id) && c.hardBlock && c.level !== 'GOOD');
  if (other.length) rows.push({ id: 'other', label: 'Other release checks', status: 'BLOCKED', detail: other.map(c => `${c.label}: ${c.detail}`).join(' · '), recovery: { label: 'Review readiness', action: 'REVIEW_READINESS' } });
  // 10. The operator's own decision, last.
  rows.push(live ? { id: 'authorization', layer: 'ARMED', label: 'Owner authorization', status: 'VERIFIED', detail: 'AUTHORIZED FOR THIS RUN · Terms and owner attestation recorded for this exact plan.' }
    : { id: 'authorization', layer: 'ARMED', label: 'Owner authorization', status: 'NEEDS_ACTION', detail: `Your final step${i.termsAuthorized ? ' · Terms authorized' : ''}: ${i.termsAuthorized ? '' : 'tick Terms, then '}press Authorize and Arm${i.shotgun ? ' and attest as owner for this exact plan' : ''}. Nothing is authorized automatically.` });

  const counted = rows.filter(r => r.id !== 'authorization');
  const verdict: PreflightVerdict = live ? 'ARMED' : counted.some(r => r.status === 'BLOCKED') ? 'BLOCKED'
    : counted.some(r => r.status !== 'VERIFIED') ? 'NEEDS_ACTION' : 'READY_FOR_AUTHORIZATION';
  const next = counted.find(r => r.status === 'BLOCKED') ?? counted.find(r => r.status !== 'VERIFIED');
  const title = verdict === 'ARMED' ? (i.running ? 'RELEASE IN PROGRESS' : 'ARMED · WAITING FOR RELEASE') : verdict === 'READY_FOR_AUTHORIZATION' ? 'READY FOR OPERATOR AUTHORIZATION' : verdict === 'BLOCKED' ? 'BLOCKED' : 'NEEDS ACTION';
  const summary = verdict === 'ARMED' ? 'The exact plan is armed. Emergency Stop cancels attempts that have not been sent.'
    : verdict === 'READY_FOR_AUTHORIZATION' ? `Every current check passes. ${i.shotgun ? 'Release-time security is acquired again shortly before the trigger; provider acceptance at the release boundary is not proven by these checks.' : 'Provider acceptance is not proven by these checks.'}`
      : `Next: ${next!.label} — ${next!.recovery?.label ?? 'see details'}.`;
  return { verdict, title, summary, rows };
}
