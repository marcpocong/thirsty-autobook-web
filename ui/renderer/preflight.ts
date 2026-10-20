import type { Dashboard } from '../types.js';
import type { ReadinessLayer, Recovery, RecoveryAction } from '../../src/execution-state.js';
import { releasePreflight, type Preflight, type PreflightInput, type PreflightRow } from '../../src/release-preflight.js';
import { el, fill, dateText, manilaTime, rangeText } from './navigation.js';

/**
 * Release Day Preflight and the saved-plan summary, rendered identically wherever the saved release authorization is
 * shown (Booking Setup step 5 and the execution console). Built only from controller-published state and the shared
 * readiness layers; nothing here validates, saves or arms.
 */
type Setup = NonNullable<Dashboard['booking']>['setup'];
const STATUS_TEXT: Record<PreflightRow['status'], string> = { VERIFIED: 'VERIFIED', NEEDS_ACTION: 'NEEDS ACTION', BLOCKED: 'BLOCKED', RUNNING: 'RUNNING', EXPIRED: 'EXPIRED', UNKNOWN: 'UNKNOWN' };
const INSPECTION_TEXT = { passive: '', genuine: 'genuine Onda check · nothing submitted', local: 'local only · nothing reaches Onda' } as const;

/** The plan's exact targets in worker order: courts, hours, attempts and browsers. */
function shape(setup: Setup) {
  const p = setup.PRECISION_PHASE3, shotgun = setup.STRATEGY_V2?.shotgun;
  if (!p) return { courts: `${setup.COURT_COUNT} best available`, time: rangeText(setup.START_TIME, setup.DURATION_HOURS), attempts: `${setup.COURT_COUNT} checkout${setup.COURT_COUNT === 1 ? '' : 's'}`, browsers: '—' };
  const assigned = p.wave1.map(a => ({ worker: a.workerId, c: p.candidates[a.candidateIndex]!, n: (a.fanOutOffsetsMs ?? [a.releaseOffsetMs ?? 0]).length }));
  const courts = [...new Set(assigned.map(a => a.c.court))], first = assigned[0]?.c;
  const offsets = shotgun?.enabled ? shotgun.exactSchedule.map(s => s.configuredOffsetMs) : p.wave1.flatMap(a => a.fanOutOffsetsMs ?? [a.releaseOffsetMs ?? 0]);
  const sameTime = assigned.every(a => a.c.start === first?.start && a.c.durationHours === first?.durationHours);
  const offsetText = offsets.length ? (Math.min(...offsets) === Math.max(...offsets) ? `at ${offsets[0]} ms` : `${Math.min(...offsets)} → ${Math.max(...offsets)} ms`) : '';
  return { courts: courts.map(c => `Court ${c}`).join(' · '), time: first ? `${rangeText(first.start, first.durationHours)}${sameTime ? '' : ' (varies)'}` : '—',
    attempts: `${offsets.length} ${shotgun?.enabled ? 'Shotgun' : 'Precision'} attempt${offsets.length === 1 ? '' : 's'} ${offsetText}`.trim(),
    browsers: assigned.map(a => `${a.worker} → Court ${a.c.court}${a.n > 1 ? ` ×${a.n}` : ''}`).join(' · ') };
}
const countdown = (ms: number) => { if (!Number.isFinite(ms) || ms <= 0) return ''; const m = Math.floor(ms / 60_000), h = Math.floor(m / 60);
  return ` · in ${h ? `${h} h ${m % 60} min` : m ? `${m} min` : 'under a minute'}`; };
/** Compact, scannable facts of the SAVED plan (never the draft). */
export function savedPlanFacts(state: Dashboard, stateLabel: string): Array<[string, string]> {
  const b = state.booking; if (!b) return [['Saved plan', 'None saved yet']];
  const s = shape(b.setup), objective = b.setup.STRATEGY_V2?.objective?.wings?.MANGO as { minimum?: number; ideal?: number } | undefined;
  const date = state.planDate?.planDate ?? b.targetDate;
  const required = objective?.minimum ? `${objective.minimum}${objective.ideal && objective.ideal !== objective.minimum ? `–${objective.ideal}` : ''} distinct court${objective.minimum === 1 && (objective.ideal ?? 1) === 1 ? '' : 's'}` : '1 court';
  return [['Wing · date', `Mango · ${dateText(date)}`], ['Courts', s.courts], ['Time', s.time], ['Required', required], ['Attempts', s.attempts], ['Browsers', s.browsers],
    ['Release', `${manilaTime(b.releaseMs)}${countdown(b.releaseMs - Date.now())}`], ['Plan', `${stateLabel} · ${b.fingerprint.slice(0, 12)}`]];
}
export function renderPlanSummary(host: HTMLElement, state: Dashboard, stateLabel: string, tone = 'info') {
  const stale = state.planDate && !['CURRENT', 'UNDATED'].includes(state.planDate.status);
  fill(host, el('div', { class: 'plan-summary-head' }, el('p', { class: 'eyebrow', text: 'Saved release plan' }),
    el('span', { class: 'state-badge', 'data-tone': stale ? 'bad' : tone, text: stale ? 'DATE PASSED' : stateLabel })),
  el('dl', { class: 'plan-summary-grid' }, ...savedPlanFacts(state, stateLabel).map(([k, v]) => el('div', { 'data-fact': k }, el('dt', { text: k }), el('dd', { text: v })))));
}

/** One input shape for every view: the saved plan, its runtime state and the shared readiness layers. */
export function preflightInput(state: Dashboard, layers: readonly ReadinessLayer[], extra: { prepared: boolean; forOther: boolean; armed: boolean; running: boolean;
  securityCheck: Dashboard['securityCheck'] | null; draft?: PreflightInput['savedPlan']['draft'] }): PreflightInput {
  const b = state.booking, setup = b?.setup, f = state.prewarmFeasibility;
  const s = setup ? shape(setup) : null;
  return { now: Date.now(), shotgun: !!setup?.STRATEGY_V2?.shotgun?.enabled && !!setup.PRECISION_PHASE3,
    savedPlan: { exists: !!b, fingerprint: b?.fingerprint ?? null, summary: s ? `${s.courts} · ${s.time} · ${s.attempts}` : '', ...(extra.draft !== undefined ? { draft: extra.draft } : {}) },
    planDate: state.planDate ?? null, releaseMs: b?.releaseMs ?? null, layers, checks: state.releaseReadiness?.checks ?? [],
    operation: state.operation, prepared: { forSaved: extra.prepared, forOther: extra.forOther }, armed: extra.armed, running: extra.running,
    securityCheck: extra.securityCheck ?? null,
    forecast: f && typeof f.prewarmLeadMs === 'number' && typeof f.preparationP95Ms === 'number' ? { leadMs: f.prewarmLeadMs, p95Ms: f.preparationP95Ms, measured: f.p95Source !== 'FALLBACK', samples: f.sampleCount ?? 0,
      retryCutoffLeadMs: f.retryAssumption?.retryCutoffLeadMs } : null,
    timing: state.shotgunTimingVerdict ?? null,
    lock: { present: !!state.lock, unresolvedSubmission: !!state.lock && !state.canPrepareOverHold && state.retainedLockStage === 'FINAL_ACTION_DISPATCHING', canPrepareOver: !!state.canPrepareOverHold },
    unknownResults: state.runSummary?.unknown ?? 0, termsAuthorized: !!state.termsAuthorized };
}

export function renderPreflight(host: HTMLElement, preflight: Preflight, options: { summaryLine?: string; onRecover?: (action: RecoveryAction) => void; securityButtonId?: string; busy?: boolean; compact?: boolean }) {
  const button = (recovery: Recovery | null | undefined, row: PreflightRow) => {
    if (!recovery || !options.onRecover || recovery.action === 'WAIT') return null;
    const b = el('button', { type: 'button', class: 'secondary compact recovery', 'data-recovery': recovery.action, text: recovery.label,
      ...(row.id === 'security' && recovery.action === 'CHECK_SECURITY' && options.securityButtonId ? { id: options.securityButtonId } : {}) }) as HTMLButtonElement;
    // Inspections and recoveries run only when nothing else is in progress; the controller refuses otherwise anyway.
    b.disabled = !!options.busy && recovery.action !== 'STOP'; b.onclick = () => options.onRecover!(recovery.action); return b;
  };
  host.dataset.verdict = preflight.verdict;
  fill(host,
    el('div', { class: 'preflight-head' }, el('div', {}, el('p', { class: 'eyebrow', text: 'Release day preflight' }),
      el('strong', { class: 'preflight-verdict', 'data-verdict': preflight.verdict, text: preflight.title })),
      el('p', { class: 'preflight-next', text: preflight.summary })),
    options.summaryLine ? el('p', { class: 'readiness-summary', text: options.summaryLine }) : null,
    el('ul', { class: `preflight-rows${options.compact ? ' compact' : ''}` }, ...preflight.rows.map(row => el('li', { 'data-row': row.id, ...(row.layer ? { 'data-layer': row.layer } : {}), 'data-status': row.status },
      el('span', { class: 'status-chip', 'data-status': row.status, text: STATUS_TEXT[row.status] }),
      el('div', { class: 'row-main' }, el('div', { class: 'row-title' }, el('strong', { text: row.label }), row.inspection && INSPECTION_TEXT[row.inspection] ? el('span', { class: 'row-tag', text: INSPECTION_TEXT[row.inspection] }) : null),
        el('p', { class: 'row-detail', text: row.detail }), row.caution ? el('p', { class: 'row-caution', text: row.caution }) : null),
      options.compact ? null : button(row.recovery, row)))));
}
export { releasePreflight };
