import type { Dashboard } from '../types.js';
import { ENVIRONMENT_LABEL, OUTCOME_LABEL, withStrategy, type BookingObjective, type CompiledObjective, type ExecutionEnvironment, type ObjectiveOutcomeStatus } from '../../src/booking-objective.js';
import { STRATEGY_LABEL, strategiesFor, type StrategyId } from '../../src/capability-matrix.js';
import { hooks, el, fill, wingName } from './navigation.js';

/**
 * Booking Test Lab: the exact Booking Setup plan, never a second editor. Offline simulation runs here in an isolated
 * child with every checkout intercepted. Authorized live tests and production use the action bar's normal flow.
 */
const BROWSER_SCENARIOS: Array<[string, string]> = [['ALL_REJECTED', 'Every attempt rejected · timing comparison'], ['FIRST_SUCCESS', 'First attempt holds · partial completion'], ['LATER_SUCCESS', 'A later attempt holds'],
  ['BOTH_SUCCESS', 'Every response succeeds · quota fill and extra holds'], ['MANGO_SUCCESS', 'Only Mango succeeds · per-wing quota'], ['BUKO_SUCCESS', 'Only Buko succeeds · per-wing quota'],
  ['TWO_IN_FLIGHT_SUCCESS', 'Two concurrent holds while in flight'], ['WRONG_WING', 'Wrong wing/court in the response'], ['UNKNOWN', 'Unknown POST outcome'], ['PAYMENT_IN_PROGRESS', 'HTTP 409 payment already in progress'],
  ['THROTTLE', 'HTTP 429 throttling'], ['PREPARE_FAILED', 'Browser preparation failure'], ['WORKER_UNAVAILABLE', 'Worker unavailable'], ['MISSED_TRIGGER', 'Delayed attempt · missed deadline'],
  ['BROWSER_CLOSED', 'Browser closed before the trigger'], ['DUPLICATE_TARGET', 'Duplicate submission refused'], ['PREVIOUS_HOLD', 'Retained hold blocks the target'], ['APP_RESTART_RETAINED_UNKNOWN', 'Restart keeps UNKNOWN blocking'],
  ['STALE_AVAILABILITY', 'Stale availability refused'], ['MISSING_AVAILABILITY', 'Missing availability refused'], ['UNSUPPORTED_RELEASE_POLICY', 'Unsupported release policy refused']];
const NORMAL_SCENARIOS: Array<[string, string]> = [['NORMAL_SUCCESS', 'Normal success · every checkout holds'], ['PARTIAL_COMPLETION', 'Partial completion'], ['ALL_REJECTED', 'Every checkout rejected'],
  ['PAYMENT_IN_PROGRESS', 'HTTP 409 payment already in progress'], ['THROTTLE', 'HTTP 429 throttling'], ['UNKNOWN', 'Unknown POST outcome'], ['WRONG_WING', 'Wrong wing/court in the response'],
  ['MISSING_AVAILABILITY', 'Missing availability'], ['STALE_AVAILABILITY', 'Stale availability'], ['DUPLICATE_TARGET', 'Duplicate submission refused']];
interface Row { strategy: StrategyId; scenario: string; planned: number; initiated: number; omitted: number; missed: number | null; timing: string; holds: number; outcome: ObjectiveOutcomeStatus; cpu: string; errors: string; warnings: string[]; detail: string[] }
let ctx: { objective: () => BookingObjective; compiled: () => CompiledObjective; state: () => Dashboard | undefined } | undefined;
let environment: ExecutionEnvironment = 'OFFLINE_SIMULATION', scenario = '', countdown = 10, running = false, phase = '', results: Row[] = [], error = '';
const byId = (id: string) => document.getElementById(id)!;

export function initTestLab(context: NonNullable<typeof ctx>) { ctx = context; window.thirsty.onLabPhase?.(value => { phase = value; renderTestLab(); }); }
function rowFrom(strategy: StrategyId, raw: any): Row {
  const outcome = raw.objectiveOutcome?.status ?? 'NONE';
  const codes = [...new Set([...(raw.outcomes ?? []), ...(raw.steps ?? [])].map((o: any) => o.code).filter(Boolean))] as string[];
  const t = raw.timing;
  return { strategy, scenario: raw.scenario, planned: raw.planned ?? 0, initiated: raw.initiated ?? 0, omitted: raw.omitted ?? 0, missed: raw.missedDeadlines ?? null,
    timing: t && t.p50 !== null ? `${t.p50?.toFixed?.(1) ?? t.p50} / ${t.p95?.toFixed?.(1) ?? t.p95} / ${t.max?.toFixed?.(1) ?? t.max} ms` : 'n/a (no browser dispatch)',
    holds: raw.objectiveOutcome?.holds ?? 0, outcome, cpu: raw.cpuBusyPercent !== undefined && raw.cpuBusyPercent !== null ? `${Math.round(raw.cpuBusyPercent)}% CPU · ${raw.memoryUsedPercent ?? '?'}% mem` : '—',
    errors: codes.join(', ') || '—', warnings: raw.warnings ?? [],
    detail: [...(raw.wings ?? []).map((w: any) => `${wingName(w.wing)}: ${w.distinctCourts}/${w.ideal ?? '?'} courts · ${w.initiated}/${w.planned} sent${w.complete ? ' · quota met' : ''}`),
      ...(raw.steps ?? []).map((s: any) => `Checkout ${s.step} ${wingName(s.wing)} Browser ${s.worker}: ${s.state}${s.code ? ` (${s.code})` : ''}`),
      `Outcome: ${OUTCOME_LABEL[outcome as ObjectiveOutcomeStatus] ?? outcome}${raw.objectiveOutcome?.extraHolds ? ` · ${raw.objectiveOutcome.extraHolds} extra simulated hold(s)` : ''}`] };
}
async function runOne(objective: BookingObjective, chosen: string) {
  const raw = await window.thirsty.shotgunLab({ action: 'run', value: { objective, scenario: chosen, countdownSeconds: countdown } });
  return rowFrom(objective.strategy, raw);
}
async function run(compare: boolean) {
  if (!ctx || running) return;
  running = true; error = ''; hooks.setLabRunning(true); renderTestLab();
  try {
    const base = ctx.objective();
    if (!compare) results = [await runOne(base, scenario || defaultScenario(base.strategy)), ...results].slice(0, 12);
    else {
      const success = scenario === 'BOTH_SUCCESS' || scenario === 'NORMAL_SUCCESS';
      for (const strategy of strategiesFor(base.mode)) {
        const candidate = withStrategy(base, strategy);
        results = [await runOne(candidate, strategy === 'NORMAL' ? (success ? 'NORMAL_SUCCESS' : 'ALL_REJECTED') : (success ? 'BOTH_SUCCESS' : 'ALL_REJECTED')), ...results].slice(0, 12);
        renderTestLab();
      }
    }
  } catch (e) { error = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '') : String(e); }
  finally { running = false; phase = ''; hooks.setLabRunning(false); renderTestLab(); }
}
const defaultScenario = (strategy: StrategyId) => strategy === 'NORMAL' ? 'NORMAL_SUCCESS' : 'ALL_REJECTED';
export function renderTestLab() {
  if (!ctx) return;
  const host = byId('test-lab'), objective = ctx.objective(), compiled = ctx.compiled(), strategy = objective.strategy;
  const scenarios = strategy === 'NORMAL' ? NORMAL_SCENARIOS : BROWSER_SCENARIOS;
  if (!scenarios.some(([id]) => id === scenario)) scenario = defaultScenario(strategy);
  const envChoice = el('div', { class: 'env-choice', role: 'radiogroup', 'aria-label': 'Test environment' }, ...(['OFFLINE_SIMULATION', 'AUTHORIZED_LIVE_TEST', 'PRODUCTION'] as const).map(id => {
    const radio = el('input', { type: 'radio', name: 'lab-environment', value: id }) as HTMLInputElement; radio.checked = environment === id; radio.disabled = running;
    radio.onchange = () => { environment = id; renderTestLab(); };
    return el('label', { 'data-env': id }, radio, el('span', { text: ENVIRONMENT_LABEL[id] })); }));
  const banner = el('div', { class: 'env-banner', id: 'lab-environment-banner', 'data-env': environment }, el('strong', { text: ENVIRONMENT_LABEL[environment] }),
    el('span', { text: environment === 'OFFLINE_SIMULATION' ? ' All provider checkout calls are intercepted locally. No reservation, hold or QR can be created. Security preparation and responses are synthetic.'
      : environment === 'AUTHORIZED_LIVE_TEST' ? ' Real provider interaction against the exact reviewed target. It may create a genuine pending hold and QR; payment is never automated. Use the action bar: Prepare, tick Terms, Authorize.'
      : ' The real intended booking with this exact approved plan. Use the action bar: Prepare, tick Terms, Authorize and Arm. Stops at QR; payment is manual.' }));
  const plan = el('p', { class: 'small', text: compiled.problems.length ? `The plan has ${compiled.problems.length} problem(s); offline tests run only a compilable plan.` : `Plan ${compiled.fingerprint.slice(0, 12)} · ${STRATEGY_LABEL[strategy]} · ${compiled.attemptCount} attempt(s) · ideal ${compiled.expectedHolds.ideal} court(s).` });
  const scenarioSelect = el('select', { id: 'lab-scenario-select', 'aria-label': 'Test scenario' }) as HTMLSelectElement;
  scenarioSelect.replaceChildren(...scenarios.map(([id, label]) => new Option(label, id))); scenarioSelect.value = scenario; scenarioSelect.disabled = running; scenarioSelect.onchange = () => { scenario = scenarioSelect.value; };
  const countdownInput = el('input', { type: 'number', id: 'lab-countdown-seconds', min: '8', max: '30', value: String(countdown), 'aria-label': 'Test countdown seconds' }) as HTMLInputElement;
  countdownInput.disabled = running || strategy === 'NORMAL'; countdownInput.onchange = () => { const n = Number(countdownInput.value); if (Number.isInteger(n) && n >= 8 && n <= 30) countdown = n; };
  const offline = environment === 'OFFLINE_SIMULATION', busy = (ctx.state()?.operation ?? 'idle') !== 'idle';
  const runButton = el('button', { type: 'button', class: 'primary-action compact', id: 'lab-run-offline', text: running ? 'Running offline test…' : 'Run offline test' }) as HTMLButtonElement;
  runButton.disabled = running || !offline || busy || compiled.problems.length > 0; runButton.onclick = () => void run(false);
  const compare = el('button', { type: 'button', class: 'secondary', id: 'lab-compare', text: 'Compare strategies on this goal' }) as HTMLButtonElement;
  compare.disabled = running || !offline || busy || compiled.problems.length > 0 || strategiesFor(objective.mode).length < 2; compare.onclick = () => void run(true);
  const stop = el('button', { type: 'button', class: 'secondary', id: 'lab-stop-offline', text: 'Stop test' }) as HTMLButtonElement; stop.disabled = !running;
  stop.onclick = () => { void window.thirsty.shotgunLab({ action: 'stop' }).catch(() => undefined); };
  const table = results.length ? el('div', { class: 'table-scroll' }, el('table', { class: 'attempt-table lab-results', id: 'lab-results-table' },
    el('thead', {}, el('tr', {}, ...['Strategy', 'Scenario', 'Planned', 'Initiated', 'Omitted', 'Missed deadlines', 'Trigger → Chrome request p50/p95/max', 'Simulated holds', 'Goal', 'Load', 'Errors'].map(h => el('th', { text: h })))),
    el('tbody', {}, ...results.map(r => el('tr', { 'data-outcome': r.outcome }, el('td', { text: STRATEGY_LABEL[r.strategy] }), el('td', { text: r.scenario }), el('td', { text: String(r.planned) }), el('td', { text: String(r.initiated) }), el('td', { text: String(r.omitted) }),
      el('td', { text: r.missed === null ? '—' : String(r.missed) }), el('td', { text: r.timing }), el('td', { text: String(r.holds) }), el('td', { text: OUTCOME_LABEL[r.outcome] ?? r.outcome }), el('td', { text: r.cpu }), el('td', { class: 'small', text: r.errors }))))))
    : el('p', { class: 'small', text: 'No offline test yet in this session. Results are kept in the isolated run directory.' });
  const last = results[0];
  fill(host, el('div', { class: 'section-title' }, el('div', {}, el('p', { class: 'eyebrow', text: 'Booking Test Lab · the exact plan above' }), el('h3', { text: 'Test this plan' }))),
    envChoice, banner, plan,
    el('div', { class: 'setup-grid' }, el('label', {}, 'Scenario', scenarioSelect), el('label', {}, 'Countdown (seconds)', countdownInput)),
    el('div', { class: 'button-row' }, runButton, compare, stop), phase ? el('p', { class: 'small', role: 'status', text: phase }) : null, error ? el('p', { class: 'warn-text', role: 'alert', text: error }) : null,
    table, last ? el('details', { class: 'tool-details', open: '' }, el('summary', { text: `Latest result · ${STRATEGY_LABEL[last.strategy]} · ${last.scenario}` }), el('ul', {}, ...last.detail.map(line => el('li', { text: line }))),
      el('ul', { class: 'small' }, ...last.warnings.map(line => el('li', { text: line })))) : null,
    el('p', { class: 'small muted', text: 'Timing is configured trigger to local Chrome request initiation — never provider receipt. Simulated holds are not reservations. Repeated identical runs add little; vary the scenario that tests what you changed.' }));
}
