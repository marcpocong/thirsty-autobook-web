import type { Dashboard } from '../types.js';
import type { Wing } from '../../src/court-registry.js';
import { compileObjective, courtLabel, defaultObjective, enabledWings, evaluateObjectiveOutcome, objectiveFromLegacySetup, parseStoredObjective, savedMangoReleaseSetup, withMode, withStrategy, WINGS,
  OUTCOME_LABEL, type BookingObjective, type CompiledObjective, type NormalCheckoutStep, type ObjectiveShotgun, type WingGoal } from '../../src/booking-objective.js';
import { METHOD_LABEL, METHOD_TO_SETUP, STRATEGY_LABEL, evaluateCapability, methodsForStrategy, strategiesFor, type CapabilityVerdict, type CheckoutMethodId, type StrategyId } from '../../src/capability-matrix.js';
import { editEffect, executionState, type ExecutionView } from '../../src/execution-state.js';
import { nextReleaseFor, releaseInstantFor, WING_RELEASE_POLICIES } from '../../src/wing-release-data.js';
import { SHOTGUN_MEANINGFUL_SPACING_MS } from '../../src/shotgun.js';
import { minimumMeaningfulSpacingMs } from '../../src/fanout-timing.js';
import type { SavedShotgunPreset } from '../../src/shotgun-advisor.js';
import { hooks, onPane, onRender, el, fill, dateText, hourText, manilaTime, peso, rangeText, wingName } from './navigation.js';
import { renderShotgunEditor } from './shotgun-editor.js';
import { initTestLab, renderTestLab } from './test-lab.js';

/**
 * Booking Setup: one guided workspace from goal to QR. The objective is the single editable source; every plan,
 * inspector line and test comes from compileObjective. Preparation, arming and booking still run through the
 * existing app.ts flows (hooks), which supply exactly this compiled plan.
 */
interface ObjectiveBinding { objectiveFingerprint: string; configFingerprint: string; savedAt: string }
interface ObjectiveDocument { version: 1; objective: BookingObjective; savedAt: string; binding: ObjectiveBinding | null }
const HOURS = Array.from({ length: 16 }, (_, i) => `${String(8 + i).padStart(2, '0')}:00`);
let objective: BookingObjective = defaultObjective(Date.now());
let documentSaved: ObjectiveDocument | null = null, presets: SavedShotgunPreset[] = [], notes: string[] = [];
let step = 1, compiled: CompiledObjective = compileObjective(objective, { nowMs: Date.now() }), loaded = false, owns = true;
let state: Dashboard | undefined, pendingBind: { objectiveFingerprint: string; previousConfig: string | null } | null = null;
let activeStep = 0, preparedStepKey: string | null = null, editorKey = '', historyEvidence: string | null = null, invalidatedFor = '';
const byId = (id: string) => document.getElementById(id)!;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function context() {
  const now = Date.now(), status = state?.playerStatus, configured: Record<string, boolean | undefined> = { A: status?.primary, B: status?.extended, C: status?.third, D: status?.fourth, E: status?.fifth, F: status?.sixth, G: status?.seventh, H: status?.eighth };
  const unavailable = new Set(Object.entries(configured).filter(([, ok]) => ok === false).map(([w]) => w));
  const holds = activeHolds(now), normalSkip = new Set([...unavailable, ...holds.map(h => h.checkout!).filter(Boolean)]);
  const evidence = state?.courtBrowser, fresh = evidence && now - Date.parse(evidence.capturedAt) >= 0 && now - Date.parse(evidence.capturedAt) < 15_000;
  const openCells = fresh ? new Set(evidence!.cells.filter(c => (c.state ?? (c.available ? 'OPEN' : 'BLOCKED')) === 'OPEN' && objective.wings[c.wing].bookingDate === evidence!.date).map(c => `${c.wing}:${c.court}:${c.start}`)) : undefined;
  const profile = state?.fanOut?.latest, usable = profile?.compatible && !profile.stale ? profile.profile : null;
  const spacing = Math.max(SHOTGUN_MEANINGFUL_SPACING_MS, minimumMeaningfulSpacingMs(usable, Math.max(1, Math.min(6, objective.shotgun.budget))).spacingMs);
  return { nowMs: now, unavailableWorkers: new Set([...unavailable].filter(w => w !== 'H')), shotgunCapacity: { meaningfulSpacingMs: spacing }, normalSkip, ...(openCells ? { openCells } : {}) };
}
function activeHolds(now = Date.now()) { return (state?.qrHandoffs ?? []).filter(h => h.holdExpiresAt && Date.parse(h.holdExpiresAt) > now); }
function recompile() { compiled = compileObjective(objective, context()); }
const nextMangoDate = () => nextReleaseFor(Date.now(), 'MANGO').bookingDate;
function liveSetup() { return objective.mode === 'NEXT_RELEASE' ? savedMangoReleaseSetup(compiled, nextMangoDate()) : { setup: null, problems: [] as string[] }; }
const stepKey = (s: NormalCheckoutStep | undefined) => s ? JSON.stringify([s.wing, s.date, s.start, s.durationHours, s.courtCount, s.exact, s.priority, s.workers, s.method]) : '';

function bindingMatches() {
  const b = documentSaved?.binding, config = state?.booking?.fingerprint;
  return !!b && !!config && b.configFingerprint === config && b.objectiveFingerprint === compiled.fingerprint && !compiled.problems.length;
}
function outsideChange() { const b = documentSaved?.binding, config = state?.booking?.fingerprint; return !!b && !!config && b.configFingerprint !== config && !pendingBind; }
function view(): ExecutionView {
  const draftSaved = !!documentSaved && same(documentSaved.objective, objective);
  const savedFingerprint = objective.mode === 'NEXT_RELEASE' && liveSetup().setup ? (bindingMatches() ? compiled.fingerprint : null) : (draftSaved && !compiled.problems.length ? compiled.fingerprint : null);
  const s = state, operation = s?.operation ?? 'idle';
  const armed = !!s?.scheduledRelease || (operation === 'full' && !!s?.activeApiRelease && s.activeApiRelease.phase !== 'RUNNING');
  const dispatching = s?.activeApiRelease?.phase === 'RUNNING' || operation === 'fullPractice' || operation === 'selection';
  const prepared = !!s?.ready && (objective.mode === 'NEXT_RELEASE' ? s.workflow === 'release' && bindingMatches() : s.workflow === 'test' && preparedStepKey === stepKey(compiled.normalSteps[activeStep]));
  const outcome = runOutcome();
  return executionState({ draftFingerprint: compiled.problems.length ? null : compiled.fingerprint, savedFingerprint, problems: compiled.problems.length, operation: operation === 'scheduled' ? 'scheduled' : operation,
    prepared, armed, dispatching, outcome: outcome?.status ?? null, needsReview: !!s?.lock && !s.canPrepareOverHold && !s.ready && operation === 'idle' && !!s.retainedLockStage && s.retainedLockStage !== 'HOLD_VERIFIED' });
}
/** Outcome of holds created in this session for this objective's dates, reconciled per court. */
function runOutcome() {
  const holds = (state?.qrHandoffs ?? []).filter(h => h.status && enabledWings(objective).includes((h.wing ?? 'MANGO') as Wing) && objective.wings[(h.wing ?? 'MANGO') as Wing].bookingDate === h.date);
  if (!holds.length) return null;
  return evaluateObjectiveOutcome(compiled.quota, holds.flatMap(h => h.courts.map(court => ({ wing: (h.wing ?? 'MANGO') as Wing, court, date: h.date, start: h.startTime, end: h.endTime, state: 'HOLD_VERIFIED',
    ...(h.bookingId ? { bookingIds: [`${h.bookingId}:${court}`] } : {}), payment: 'PENDING' as const }))));
}

function edit(mutate: (draft: BookingObjective) => void) {
  const effect = editEffect(view().state);
  if (effect === 'REFUSE_DISARM_FIRST' || effect === 'REFUSE_RUNNING') { flash(effect === 'REFUSE_DISARM_FIRST' ? 'The plan is armed. Use Emergency Stop to disarm before changing it.' : 'A run is in progress. Changes are locked until it finishes.'); return; }
  const next = structuredClone(objective); mutate(next); objective = next; recompile();
  if (effect === 'INVALIDATES_PREPARATION' && invalidatedFor !== compiled.fingerprint) { invalidatedFor = compiled.fingerprint; void window.thirsty.invalidatePreparation().catch(() => undefined); flash('Plan changed: preparation is cleared. Prepare again before arming.'); }
  renderAll(true);
}
function flash(text: string) { const status = byId('setup-save-status'); status.textContent = text; status.dataset.tone = 'warn'; }

async function load() {
  try {
    const result = await window.thirsty.objective({ action: 'load' }) as { document: ObjectiveDocument | null; migrated: BookingObjective | null; notes: string[]; presets: SavedShotgunPreset[] };
    presets = result.presets ?? [];
    if (result.document) { documentSaved = result.document; objective = parseStoredObjective(result.document.objective) ?? objective; }
    else if (result.migrated) { objective = parseStoredObjective(result.migrated) ?? objective; notes = result.notes ?? []; }
  } catch { notes = ['The saved Booking Setup draft could not be read. A new draft was started; nothing was overwritten.']; }
  // A stored next-release date that has already been released is moved to the next release only with a visible note.
  if (objective.mode === 'NEXT_RELEASE') for (const wing of WINGS) { try { if (releaseInstantFor(objective.wings[wing].bookingDate, wing) <= Date.now()) { const next = nextReleaseFor(Date.now(), wing).bookingDate; notes.push(`${wingName(wing)} ${objective.wings[wing].bookingDate} has already been released; the draft now targets the next release date ${next}. Review before saving.`); objective.wings[wing].bookingDate = next; } } catch { /* reported by compile */ } }
  loaded = true; recompile(); renderAll(true);
}
async function saveDraft(binding?: ObjectiveBinding | null) {
  const result = await window.thirsty.objective({ action: 'save', value: objective, ...(binding !== undefined ? { binding: binding ? { objectiveFingerprint: binding.objectiveFingerprint, configFingerprint: binding.configFingerprint } : null } : {}) }) as ObjectiveDocument;
  documentSaved = result; notes = [];
  const status = byId('setup-save-status'); status.textContent = `Draft saved ${manilaTime(Date.now(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`; status.dataset.tone = 'good';
}

export function initBookingSetup() {
  hooks.desiredWorkflow = () => objective.mode === 'AVAILABLE_NOW' ? 'test' : 'release';
  // Booking Setup owns Prepare unless the saved plan was edited in the legacy editor and the operator has not chosen.
  hooks.releaseSetup = () => owns && objective.mode === 'NEXT_RELEASE' ? liveSetup().setup : null;
  hooks.testRequest = () => {
    if (!owns || objective.mode !== 'AVAILABLE_NOW' || compiled.problems.length) return null;
    const s = compiled.normalSteps[activeStep]; if (!s) return null;
    return { method: METHOD_TO_SETUP[s.method], request: { wing: s.wing, strategy: 'standard', date: s.date, start: s.start, duration: s.durationHours, courtCount: s.courtCount, priority: s.priority,
      fallbackStarts: s.fallbackStarts, ...(s.exact ? { exact: [s.exact] } : {}), ...(s.workers.length && (s.method === 'API_FRESH_PROOF' || s.method === 'PROOFLESS') ? { workers: s.workers } : {}), ...(s.maximum !== null ? { maximum: s.maximum } : {}) } };
  };
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="setup-mode"]')) radio.addEventListener('change', () => { if (radio.checked) edit(d => { Object.assign(d, withMode(d, radio.value as BookingObjective['mode'], Date.now())); }); syncPane(); });
  for (const button of document.querySelectorAll<HTMLButtonElement>('#setup-steps [data-step]')) button.addEventListener('click', () => goStep(Number(button.dataset.step)));
  byId('setup-back').addEventListener('click', () => goStep(Math.max(1, step - 1)));
  byId('setup-next').addEventListener('click', () => goStep(Math.min(5, step + 1)));
  byId('save-draft').addEventListener('click', () => { void saveDraft().then(() => renderAll(true)).catch(() => flash('The draft could not be saved.')); });
  byId('inline-stop').addEventListener('click', () => { void window.thirsty.abortAutomation().catch(() => undefined); });
  byId('test-this-plan').addEventListener('click', () => { byId('test-lab').scrollIntoView({ block: 'start' }); byId('test-lab').querySelector<HTMLButtonElement>('#lab-run-offline')?.focus(); });
  byId('browse-courts').addEventListener('click', () => { const date = (byId('availability-date') as HTMLInputElement | null)?.value || objective.wings.MANGO.bookingDate; void window.thirsty.browseCourts(date).catch(() => undefined); });
  // Binding: the saved release plan produced by Prepare is recorded against this objective's fingerprint.
  byId('main-action').addEventListener('click', () => { const text = byId('main-action').textContent ?? '';
    if (objective.mode === 'NEXT_RELEASE' && owns && /Prepare/.test(text)) pendingBind = { objectiveFingerprint: compiled.fingerprint, previousConfig: state?.booking?.fingerprint ?? null }; }, true);
  byId('test-main-action').addEventListener('click', () => { if ((byId('test-main-action').textContent ?? '').includes('Prepare')) preparedStepKey = stepKey(compiled.normalSteps[activeStep]); }, true);
  const drawer = byId('legacy-editor-drawer') as HTMLDetailsElement;
  drawer.addEventListener('toggle', () => { if (step === 3) hooks.showView(drawer.open ? 'strategy' : 'setup'); });
  onRender(next => { state = next; handleBinding(next); recompile(); renderAll(false); });
  onPane(pane => { if (pane === 'release' || pane === 'tests') { if (step !== 5) { step = 5; renderAll(true); } }
    else if (pane === 'strategy') { if (step !== 3) { step = 3; renderAll(true); } drawer.open = true; } });
  // The legacy editor's Buko / Both selector hands off to the goal step here.
  document.addEventListener('booking-setup:wing', event => { const value = (event as CustomEvent<string>).detail;
    edit(d => { d.wings.BUKO.enabled = true; d.wings.MANGO.enabled = value !== 'BUKO'; }); goStep(1); });
  initTestLab({ objective: () => objective, compiled: () => compiled, state: () => state });
  void load();
}
function handleBinding(next: Dashboard) {
  if (!pendingBind || !next.booking) return;
  const changed = next.booking.fingerprint !== pendingBind.previousConfig;
  if (!changed && !(next.operation === 'idle' && next.ready)) { if (next.operation === 'idle' && !next.ready && next.headline !== 'PREPARING') pendingBind = null; return; }
  const binding = { objectiveFingerprint: pendingBind.objectiveFingerprint, configFingerprint: next.booking.fingerprint, savedAt: new Date().toISOString() };
  pendingBind = null;
  void saveDraft(binding).then(() => renderAll(true)).catch(() => flash('Prepared, but the Booking Setup binding could not be recorded.'));
}
function goStep(next: number) { step = next; renderAll(true); syncPane(); window.scrollTo({ top: 0 }); }
function syncPane() {
  const drawer = byId('legacy-editor-drawer') as HTMLDetailsElement;
  hooks.showView(step === 5 ? (objective.mode === 'AVAILABLE_NOW' ? 'tests' : 'release') : step === 3 && drawer.open ? 'strategy' : 'setup');
}

// ── Rendering ─────────────────────────────────────────────────────────────────────────────────────────────
function renderAll(force: boolean) {
  if (!loaded) return;
  const v = view();
  renderHead(v);
  for (let i = 1; i <= 5; i++) byId(`setup-step-${i}`).hidden = i !== step;
  (byId('setup-back') as HTMLButtonElement).disabled = step === 1; const next = byId('setup-next') as HTMLButtonElement; next.hidden = step === 5;
  next.textContent = ['', 'Choose strategy →', 'Customize →', 'Browsers →', 'Review & Run →'][step] ?? 'Next →';
  const editable = v.can.edit;
  const key = JSON.stringify([objective, step, editable, presets, notes, historyEvidence, state?.courtBrowser?.capturedAt, state?.availabilityCheck?.status, compiled.fingerprint]);
  const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.closest('#dest-setup') && document.activeElement.type !== 'checkbox' && document.activeElement.type !== 'radio';
  if (force || (key !== editorKey && !typing)) {
    editorKey = key;
    if (step === 1) { renderGoal(editable); renderSuggestions(editable); }
    if (step === 2) renderStrategy(editable);
    if (step === 3) renderCustomize(editable);
  }
  if (step === 1) renderAvailability(editable);
  if (step === 4) renderBrowsers();
  if (step === 5) renderReview(v);
}
function renderHead(v: ExecutionView) {
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="setup-mode"]')) { radio.checked = radio.value === objective.mode; radio.disabled = !v.can.edit; }
  const badge = byId('setup-state'); badge.textContent = v.label; badge.dataset.tone = v.tone; badge.title = v.detail;
  byId('setup-fingerprint').textContent = compiled.problems.length ? 'plan incomplete' : `plan ${compiled.fingerprint.slice(0, 12)}`;
  for (const button of document.querySelectorAll<HTMLButtonElement>('#setup-steps [data-step]')) {
    const n = Number(button.dataset.step); button.setAttribute('aria-current', n === step ? 'step' : 'false');
    button.dataset.done = String(n < step); button.dataset.attention = String(n === 1 && compiled.problems.length > 0);
  }
  byId('mode-label').textContent = objective.mode === 'AVAILABLE_NOW' ? 'AVAILABLE NOW · NORMAL' : `NEXT RELEASE · ${STRATEGY_LABEL[objective.strategy].toUpperCase()}`;
}
const field = (label: string, control: HTMLElement, hint?: string) => el('label', {}, label, control, hint ? el('small', { text: hint }) : null);
function select(id: string, options: Array<[string, string]>, value: string, onChange: (value: string) => void, disabled: boolean) {
  const s = el('select', { id }) as HTMLSelectElement; s.replaceChildren(...options.map(([text, v]) => new Option(text, v))); s.value = value; s.disabled = disabled; s.onchange = () => onChange(s.value); return s;
}
function stepper(id: string, value: number, min: number, max: number, onChange: (value: number) => void, disabled: boolean, label: string) {
  const input = el('input', { id, type: 'number', min: String(min), max: String(max), value: String(value), 'aria-label': label }) as HTMLInputElement; input.disabled = disabled;
  input.onchange = () => { const n = Number(input.value); if (Number.isInteger(n) && n >= min && n <= max) onChange(n); else { input.setCustomValidity(`Enter ${min}–${max}.`); input.reportValidity(); } };
  return input;
}
function wingCard(wing: Wing, editable: boolean) {
  const g = objective.wings[wing], name = wingName(wing), policy = WING_RELEASE_POLICIES[wing];
  const setGoal = (mutate: (goal: WingGoal) => void) => edit(d => mutate(d.wings[wing]));
  const include = el('input', { type: 'checkbox', id: `goal-${wing}-enabled` }) as HTMLInputElement; include.checked = g.enabled; include.disabled = !editable; include.onchange = () => setGoal(goal => { goal.enabled = include.checked; });
  const head = el('div', { class: 'wing-head' }, el('label', { class: 'wing-toggle' }, include, el('strong', { text: `${name} Wing` })),
    el('span', { class: 'evidence-chip', 'data-tone': policy?.status === 'VERIFIED' ? 'good' : 'warn', title: policy?.evidence ?? '', text: `${policy?.status?.replace('_', ' ') ?? 'UNKNOWN'} · ${policy?.releaseTime.slice(0, 5) ?? '?'} · +${policy?.horizonOffsetDays ?? '?'} days` }));
  if (!g.enabled) return el('section', { class: 'wing-card', 'data-wing': wing, 'data-enabled': 'false' }, head, el('p', { class: 'small muted', text: `${name} is not part of this goal.` }));
  let releaseNote = '';
  try { const r = releaseInstantFor(g.bookingDate, wing); releaseNote = r > Date.now() ? `Releases ${manilaTime(r)} Manila` : objective.mode === 'NEXT_RELEASE' ? 'Already released — use Available Now' : 'Published'; } catch { releaseNote = 'Choose a valid date'; }
  const date = el('input', { type: 'date', id: `goal-${wing}-date`, value: g.bookingDate }) as HTMLInputElement; date.disabled = !editable; date.onchange = () => setGoal(goal => { goal.bookingDate = date.value; });
  const ordered = [...g.courts].sort((a, b) => a.priority - b.priority || a.court - b.court);
  const chips = el('div', { class: 'court-chips', role: 'group', 'aria-label': `${name} acceptable courts` }, ...[1, 2, 3, 4, 5, 6, 7].map(court => {
    const chosen = g.courts.find(c => c.court === court), chip = el('button', { type: 'button', class: 'court-chip', 'aria-pressed': String(!!chosen), 'data-court': String(court), title: courtLabel(wing, court) }, el('span', { text: String(court) }), chosen ? el('small', { text: `#${ordered.indexOf(chosen) + 1}` }) : null) as HTMLButtonElement;
    chip.disabled = !editable; chip.onclick = () => setGoal(goal => { goal.courts = chosen ? goal.courts.filter(c => c.court !== court) : [...goal.courts, { court, priority: Math.max(0, ...goal.courts.map(c => c.priority)) + 1 }]; });
    return chip; }));
  const priority = el('ol', { class: 'court-priority' }, ...ordered.map((choice, index) => {
    const move = (delta: number) => setGoal(goal => { const list = [...goal.courts].sort((a, b) => a.priority - b.priority || a.court - b.court); const other = index + delta; if (other < 0 || other >= list.length) return; [list[index], list[other]] = [list[other]!, list[index]!]; goal.courts = list.map((c, i) => ({ ...c, priority: i + 1 })); });
    const up = el('button', { type: 'button', class: 'secondary compact', 'aria-label': `Move ${name} Court ${choice.court} up`, text: '↑' }) as HTMLButtonElement; up.disabled = !editable || index === 0; up.onclick = () => move(-1);
    const down = el('button', { type: 'button', class: 'secondary compact', 'aria-label': `Move ${name} Court ${choice.court} down`, text: '↓' }) as HTMLButtonElement; down.disabled = !editable || index === ordered.length - 1; down.onclick = () => move(1);
    const exact = el('label', { class: 'exact-toggle' }, el('input', { type: 'checkbox', 'aria-label': `${name} Court ${choice.court} is an exact required court` }), ' exact');
    const box = exact.firstChild as HTMLInputElement; box.checked = !!choice.mandatory; box.disabled = !editable || objective.targetMode !== 'EXACT';
    box.onchange = () => setGoal(goal => { goal.courts = goal.courts.map(c => c.court === choice.court ? { ...c, mandatory: box.checked } : c); });
    return el('li', {}, el('span', { text: `Court ${choice.court}` }), up, down, objective.targetMode === 'EXACT' ? exact : null); }));
  const start = select(`goal-${wing}-start`, HOURS.map(h => [hourText(h), h]), g.startTimes[0] ?? '19:00', value => setGoal(goal => { goal.startTimes = [value, ...goal.startTimes.slice(1).filter(s => s !== value)]; }), !editable);
  const alternatives = el('div', { class: 'alt-times' }, ...g.startTimes.slice(1).map(alt => { const remove = el('button', { type: 'button', class: 'chip-remove', 'aria-label': `Remove alternative start ${hourText(alt)}`, text: `${hourText(alt)} ✕` }) as HTMLButtonElement;
    remove.disabled = !editable; remove.onclick = () => setGoal(goal => { goal.startTimes = goal.startTimes.filter(s => s !== alt); }); return remove; }));
  const addAlt = select(`goal-${wing}-add-alt`, [['+ Alternative start', ''], ...HOURS.filter(h => !g.startTimes.includes(h)).map(h => [hourText(h), h] as [string, string])], '', value => { if (value) setGoal(goal => { goal.startTimes = [...goal.startTimes, value]; }); }, !editable);
  const duration = select(`goal-${wing}-duration`, [['1 hour', '1'], ['2 hours', '2'], ['3 hours', '3']], String(g.durationHours), value => setGoal(goal => { goal.durationHours = Number(value); }), !editable);
  const needsDay = g.startTimes.some(s => Number(s.slice(0, 2)) < 16) && objective.mode === 'NEXT_RELEASE';
  const dayRate = needsDay ? (() => { const input = el('input', { type: 'number', id: `goal-${wing}-day-rate`, min: '1', step: '1', value: g.dayRate && g.dayRate.date === g.bookingDate ? String(g.dayRate.perHour) : '', placeholder: '₱ per hour' }) as HTMLInputElement; input.disabled = !editable;
    input.onchange = () => setGoal(goal => { const n = Number(input.value); goal.dayRate = Number.isFinite(n) && n > 0 ? { perHour: Math.round(n), confirmedAt: new Date().toISOString(), date: goal.bookingDate } : null; });
    return field(`Confirmed daytime rate for ${dateText(g.bookingDate)} (before 4 PM)`, input, 'Evening hours use the venue\'s fixed ₱700 rate. Daytime needs your confirmation for this date.'); })() : null;
  const quota = objective.quotaScope === 'PER_WING' ? el('div', { class: 'quota-row' },
    field('Minimum courts', stepper(`goal-${wing}-minimum`, g.minimum, 1, 7, value => setGoal(goal => { goal.minimum = value; if (goal.ideal < value) goal.ideal = value; }), !editable, `${name} minimum courts`), 'Below this the goal is not met'),
    field('Ideal courts', stepper(`goal-${wing}-ideal`, g.ideal, 1, 7, value => setGoal(goal => { goal.ideal = value; if (goal.minimum > value) goal.minimum = value; }), !editable, `${name} ideal courts`), 'Stops this wing once reached')) : null;
  return el('section', { class: 'wing-card', 'data-wing': wing, 'data-enabled': 'true' }, head,
    el('div', { class: 'setup-grid' }, field('Booking date', date, releaseNote), field('Preferred start', start), field('Duration', duration)),
    el('div', { class: 'alt-row' }, el('span', { class: 'small', text: 'Alternative starts' }), alternatives, addAlt), quota,
    el('div', { class: 'courts-block' }, el('span', { class: 'small', text: 'Acceptable courts — click to include; order is priority' }), chips, priority), dayRate);
}
function renderGoal(editable: boolean) {
  const host = byId('objective-editor');
  const scope = select('goal-scope', [['Count courts in each wing separately', 'PER_WING'], ['Count courts across both wings', 'ANY_WING']], objective.quotaScope, value => edit(d => { d.quotaScope = value as BookingObjective['quotaScope']; }), !editable);
  const mode = select('goal-target-mode', [['Flexible · any acceptable court', 'FLEXIBLE'], ['Exact · only the marked courts', 'EXACT']], objective.targetMode, value => edit(d => { d.targetMode = value as BookingObjective['targetMode']; }), !editable);
  const overall = objective.quotaScope === 'ANY_WING' ? el('div', { class: 'quota-row' },
    field('Minimum courts overall', stepper('goal-overall-minimum', objective.overall.minimum, 1, 14, value => edit(d => { d.overall.minimum = value; if (d.overall.ideal < value) d.overall.ideal = value; }), !editable, 'Minimum courts overall')),
    field('Ideal courts overall', stepper('goal-overall-ideal', objective.overall.ideal, 1, 14, value => edit(d => { d.overall.ideal = value; if (d.overall.minimum > value) d.overall.minimum = value; }), !editable, 'Ideal courts overall'))) : null;
  const priceInput = (key: 'maxPerCheckout' | 'maxTotal', label: string) => { const input = el('input', { type: 'number', id: `goal-${key}`, min: '1', step: '1', placeholder: 'No limit', value: objective.price[key] === null ? '' : String(objective.price[key]) }) as HTMLInputElement;
    input.disabled = !editable; input.onchange = () => edit(d => { const n = Number(input.value); d.price[key] = input.value === '' ? null : Number.isFinite(n) && n > 0 ? n : d.price[key]; }); return field(label, input); };
  const problems = compiled.problems.length ? el('ul', { class: 'strategy-warnings', id: 'goal-problems' }, ...compiled.problems.map(p => el('li', { 'data-tone': 'bad', text: p }))) : el('p', { class: 'small good-text', id: 'goal-problems', text: '✓ The goal is complete and compiles to an exact plan.' });
  fill(host, el('div', { class: 'section-title' }, el('div', {}, el('p', { class: 'eyebrow', text: 'Step 1 · Goal' }), el('h3', { text: objective.mode === 'NEXT_RELEASE' ? 'What should the next release get you?' : 'What do you want to book now?' }))),
    ...notes.map(note => el('p', { class: 'notice', text: note })),
    el('div', { class: 'setup-grid' }, field('Courts', mode), field('Counting', scope)), overall,
    el('div', { class: 'wing-cards' }, ...WINGS.map(w => wingCard(w, editable))),
    el('div', { class: 'setup-grid price-row' }, priceInput('maxPerCheckout', 'Maximum per checkout (₱)'), priceInput('maxTotal', 'Maximum total (₱)')), problems);
}
function renderAvailability(editable: boolean) {
  const panel = document.querySelector<HTMLElement>('#setup-step-1 .court-browser')!;
  let date = byId('availability-date') as HTMLInputElement | null;
  if (!date) { date = el('input', { type: 'date', id: 'availability-date', 'aria-label': 'Availability date' }) as HTMLInputElement; panel.querySelector('.section-title')!.insertBefore(date, byId('browse-courts')); }
  if (!date.value || document.activeElement !== date && date.dataset.auto !== 'off') date.value = objective.wings[enabledWings(objective)[0] ?? 'MANGO'].bookingDate;
  date.onchange = () => { date!.dataset.auto = 'off'; };
  const check = state?.availabilityCheck, evidence = state?.courtBrowser, now = Date.now();
  const button = byId('browse-courts') as HTMLButtonElement; button.disabled = check?.status === 'RUNNING' || (state?.operation ?? 'idle') !== 'idle' || !!state?.scheduledRelease;
  button.textContent = check?.status === 'RUNNING' ? 'Checking…' : 'Check Availability';
  const age = evidence ? now - Date.parse(evidence.capturedAt) : NaN, fresh = evidence && age >= 0 && age < 15_000 && evidence.date === date.value;
  const grid = byId('court-browser-grid');
  const wings = (['MANGO', 'BUKO'] as const);
  fill(grid, ...wings.map(wing => {
    const read = evidence?.wings?.find(w => w.wing === wing);
    const table = el('div', { class: 'availability-wing', 'data-wing': wing }, el('div', { class: 'availability-head' }, el('strong', { text: `${wingName(wing)} Wing` }),
      el('span', { class: 'small', 'data-tone': !fresh ? 'muted' : read?.status === 'ERROR' ? 'bad' : read?.status === 'UNRELEASED' ? 'warn' : 'good',
        text: !evidence || evidence.date !== date!.value ? 'UNKNOWN · not checked' : !fresh ? 'UNKNOWN · evidence older than 15 s' : read?.status === 'ERROR' ? `UNKNOWN · read failed (${read.code ?? 'error'})` : read?.status === 'UNRELEASED' ? 'UNRELEASED · not published yet' : 'Fresh' })));
    table.append(el('div', { class: 'court-browser-row hour-header', 'aria-hidden': 'true' }, el('span', { text: '' }), ...HOURS.map(h => el('span', { text: String(Number(h.slice(0, 2)) % 12 || 12) + (Number(h.slice(0, 2)) < 12 ? 'a' : 'p') }))));
    for (let court = 1; court <= 7; court++) {
      const row = el('div', { class: 'court-browser-row' }, el('strong', { text: `Court ${court}` }));
      for (const start of HOURS) {
        const cell = fresh ? evidence!.cells.find(c => c.wing === wing && c.court === court && c.start === start) : undefined;
        const s = cell ? cell.state ?? (cell.available ? 'OPEN' : 'BLOCKED') : 'UNKNOWN';
        const b = el('button', { type: 'button', class: 'court-cell', 'data-state': s.toLowerCase(), title: `${wingName(wing)} Court ${court} · ${hourText(start)} · ${s}${cell?.price !== null && cell?.price !== undefined ? ` · ₱${cell.price}` : ''}`,
          text: s === 'OPEN' && cell?.price !== null && cell?.price !== undefined ? `₱${cell.price}` : s === 'BLOCKED' ? '×' : s === 'UNRELEASED' ? '·' : '?' }) as HTMLButtonElement;
        b.disabled = s !== 'OPEN' || !editable || objective.mode !== 'AVAILABLE_NOW';
        b.onclick = () => edit(d => { const g = d.wings[wing]; g.enabled = true; if (!g.courts.some(c => c.court === court)) g.courts = [{ court, priority: 0 }, ...g.courts].map((c, i) => ({ ...c, priority: i + 1 })); else g.courts = [...g.courts].sort((a, b2) => (a.court === court ? -1 : b2.court === court ? 1 : a.priority - b2.priority)).map((c, i) => ({ ...c, priority: i + 1 })); g.startTimes = [start, ...g.startTimes.filter(t => t !== start)]; });
        row.append(b);
      }
      table.append(row);
    }
    return table;
  }));
  const status = byId('court-browser-status');
  status.textContent = check?.status === 'RUNNING' ? 'Opening the dedicated read-only observer and reading both wings…' : check?.status === 'FAILED' && !fresh ? `Availability could not be read (${check.code ?? 'unknown'}). Every cell stays UNKNOWN; nothing was booked.`
    : fresh ? `Verified ${manilaTime(Date.parse(evidence!.capturedAt), { hour: '2-digit', minute: '2-digit', second: '2-digit' })} Manila (oldest wing read) · expires after 15 s · dedicated read-only ${evidence!.observer ?? 'browser'} · checkout always rechecks every hour and price.${objective.mode === 'AVAILABLE_NOW' ? ' Click an open cell to make it your first choice.' : ''}`
    : 'UNKNOWN · press Check Availability. Absence of bookings never means a court is open.';
}
function renderSuggestions(editable: boolean) {
  const host = byId('smart-suggestions'), evidence = state?.courtBrowser, now = Date.now();
  const head = el('div', { class: 'section-title' }, el('div', {}, el('p', { class: 'eyebrow', text: 'Smart suggestions · you decide' }), el('h3', { text: objective.mode === 'AVAILABLE_NOW' ? 'Open windows that fit your goal' : 'Release planning hints' })));
  if (objective.mode === 'AVAILABLE_NOW') {
    const fresh = evidence && now - Date.parse(evidence.capturedAt) >= 0 && now - Date.parse(evidence.capturedAt) < 15_000;
    if (!fresh) { fill(host, head, el('p', { class: 'small', text: 'Check availability to see complete open windows. Suggestions never use stale or missing evidence.' })); return; }
    const items = enabledWings(objective).filter(w => objective.wings[w].bookingDate === evidence!.date).flatMap(wing => {
      const g = objective.wings[wing], ordered = [...g.courts].sort((a, b) => a.priority - b.priority).map(c => c.court);
      const candidates = [...new Set([...ordered, 1, 2, 3, 4, 5, 6, 7])].flatMap(court => HOURS.filter(h => Number(h.slice(0, 2)) + g.durationHours <= 24).map(start => {
        const hours = Array.from({ length: g.durationHours }, (_, i) => `${String(Number(start.slice(0, 2)) + i).padStart(2, '0')}:00`);
        const cells = hours.map(h => evidence!.cells.find(c => c.wing === wing && c.court === court && c.start === h));
        if (!cells.every(c => c && (c.state ?? (c.available ? 'OPEN' : 'BLOCKED')) === 'OPEN' && c.price !== null)) return null;
        const rank = (g.startTimes.indexOf(start) === -1 ? 50 + Math.abs(Number(start.slice(0, 2)) - Number((g.startTimes[0] ?? '19:00').slice(0, 2))) : g.startTimes.indexOf(start)) * 10 + (ordered.indexOf(court) === -1 ? 9 : ordered.indexOf(court));
        return { wing, court, start, price: cells.reduce((s, c) => s + (c!.price ?? 0), 0), rank, acceptable: ordered.includes(court) };
      }).filter(Boolean) as Array<{ wing: Wing; court: number; start: string; price: number; rank: number; acceptable: boolean }>);
      return candidates.sort((a, b) => a.rank - b.rank).slice(0, 5);
    });
    fill(host, head, items.length ? el('ul', { class: 'suggestion-list' }, ...items.map(item => {
      const use = el('button', { type: 'button', class: 'secondary compact', text: 'Use as first choice' }) as HTMLButtonElement; use.disabled = !editable;
      use.onclick = () => edit(d => { const g = d.wings[item.wing]; g.courts = [{ court: item.court, priority: 0 }, ...g.courts.filter(c => c.court !== item.court)].map((c, i) => ({ ...c, priority: i + 1 })); g.startTimes = [item.start, ...g.startTimes.filter(s => s !== item.start)]; });
      return el('li', {}, el('strong', { text: `${wingName(item.wing)} Court ${item.court} · ${rangeText(item.start, objective.wings[item.wing].durationHours)}` }), el('span', { class: 'small', text: ` ${peso(item.price)} observed${item.acceptable ? '' : ' · not in your acceptable courts yet'}` }), use); }))
      : el('p', { class: 'small', text: 'No complete open window matches the chosen duration in the fresh evidence.' }));
    return;
  }
  const load = el('button', { type: 'button', class: 'secondary compact', id: 'load-history', text: 'Load recorded Mango release history' }) as HTMLButtonElement;
  load.disabled = !objective.wings.MANGO.enabled;
  load.onclick = () => { const mango = compiled.targets.filter(t => t.wing === 'MANGO').slice(0, 21);
    void window.thirsty.strategyEvidence({ targetDate: objective.wings.MANGO.bookingDate, ranges: mango.map(t => ({ court: t.court, start: t.start, durationHours: t.durationHours })) }).then(result => {
      historyEvidence = `${result.wellObservedReleases} well-observed past release${result.wellObservedReleases === 1 ? '' : 's'} (${result.strength}). ` + result.ranges.slice(0, 6).map(r => `Court ${r.court} ${hourText(r.start)}: open first ${r.fullyOpenFirst}/${r.wellObserved}, still open at 1 s ${r.stillOpenAt1s.open}/${r.stillOpenAt1s.observed}`).join(' · ');
      renderAll(true); }).catch(() => { historyEvidence = 'Recorded history could not be read.'; renderAll(true); }); };
  fill(host, head, el('p', { class: 'small', text: 'Before 8:00 the target dates are unreleased: openness is unknown and an absent public booking is not proof a court will open. Suggestions use your priorities and recorded history only, and change the draft only when you accept them.' }),
    load, historyEvidence ? el('p', { class: 'small', id: 'history-evidence', text: historyEvidence }) : null,
    objective.wings.BUKO.enabled ? el('p', { class: 'small muted', text: 'No recorded Buko release history exists; Buko releases have not been observed.' }) : null);
}
function capabilityBlock(verdict: CapabilityVerdict | null, wing: Wing) {
  if (!verdict) return null;
  return el('div', { class: 'capability', 'data-status': verdict.status }, el('div', { class: 'capability-head' }, el('strong', { text: `${wingName(wing)} · ${verdict.status.replace('_', ' ')}` }),
    verdict.checkoutShape ? el('span', { class: 'small', text: verdict.checkoutShape }) : null), el('ul', {}, ...verdict.reasons.map(r => el('li', { text: r }))),
    verdict.evidence.length ? el('p', { class: 'small', text: `Evidence: ${verdict.evidence.map(e => `${e.date} — ${e.summary}`).join(' · ')}` }) : null, verdict.verify ? el('p', { class: 'small muted', text: `How to verify: ${verdict.verify}` }) : null);
}
const STRATEGY_TEXT: Record<StrategyId, Record<BookingObjective['mode'], string>> = {
  SHOTGUN: { NEXT_RELEASE: 'Many pre-armed attempts from −2000 to 0 ms before 8:00, spread over your acceptable courts. Default for scheduled releases.', AVAILABLE_NOW: '' },
  PRECISION: { NEXT_RELEASE: 'One pre-armed attempt per court (optionally a few timed children), with optional backups and reopened-slot rescue.', AVAILABLE_NOW: '' },
  NORMAL: { NEXT_RELEASE: 'Reads the published schedule at release, then checks out the best available courts from your priority list.', AVAILABLE_NOW: 'Fresh availability and proofs when you book; exact or best-available courts. Default for open dates.' } };
function renderStrategy(editable: boolean) {
  const host = byId('strategy-picker'), wings = enabledWings(objective);
  const cards = el('div', { class: 'strategy-cards', role: 'radiogroup', 'aria-label': 'Booking strategy' }, ...strategiesFor(objective.mode).map((id, index) => {
    const verdicts = wings.map(w => evaluateCapability({ wing: w, mode: objective.mode, strategy: id, method: methodsForStrategy(id, objective.mode)[0]!, courts: Math.max(1, objective.wings[w].ideal) }));
    const radio = el('input', { type: 'radio', name: 'strategy-choice', value: id }) as HTMLInputElement; radio.checked = objective.strategy === id; radio.disabled = !editable;
    radio.onchange = () => edit(d => { Object.assign(d, withStrategy(d, id)); });
    return el('label', { class: 'strategy-card', 'data-selected': String(objective.strategy === id) }, radio, el('span', {}, el('strong', { text: `${STRATEGY_LABEL[id]}${index === 0 ? ' · default' : ''}` }), el('small', { text: STRATEGY_TEXT[id][objective.mode] }),
      el('span', { class: 'cap-badges' }, ...verdicts.map((v, i) => el('span', { class: 'cap-badge', 'data-status': v.status, text: `${wingName(wings[i]!)}: ${v.status.replace('_', ' ')}` })))));
  }));
  const methods = methodsForStrategy(objective.strategy, objective.mode);
  const method = el('select', { id: 'checkout-method' }) as HTMLSelectElement;
  method.replaceChildren(...methods.map(m => { const verdicts = wings.map(w => evaluateCapability({ wing: w, mode: objective.mode, strategy: objective.strategy, method: m, courts: Math.max(1, objective.wings[w].ideal) }));
    const blocked = verdicts.some(v => v.status === 'BLOCKED'), option = new Option(`${METHOD_LABEL[m]}${blocked ? ' — not available for this goal' : ''}`, m); option.disabled = blocked && m !== objective.checkoutMethod; return option; }));
  method.value = objective.checkoutMethod; method.disabled = !editable || methods.length === 1;
  method.onchange = () => edit(d => { d.checkoutMethod = method.value as CheckoutMethodId; });
  const unsupported = methods.filter(m => wings.some(w => evaluateCapability({ wing: w, mode: objective.mode, strategy: objective.strategy, method: m, courts: Math.max(1, objective.wings[w].ideal) }).status === 'BLOCKED'));
  fill(host, el('div', { class: 'section-title' }, el('div', {}, el('p', { class: 'eyebrow', text: 'Step 2 · Strategy' }), el('h3', { text: 'How should attempts be scheduled?' }))), cards,
    el('div', { class: 'method-block' }, field('Checkout method', method, objective.strategy === 'NORMAL' ? 'How each attempt checks out. Separate from the strategy.' : 'Pre-armed strategies use proofless direct checkout; methods that read availability at send time cannot be pre-armed.'),
      unsupported.length ? el('ul', { class: 'small method-reasons' }, ...unsupported.map(m => el('li', { text: `${METHOD_LABEL[m]}: ${wings.map(w => evaluateCapability({ wing: w, mode: objective.mode, strategy: objective.strategy, method: m, courts: Math.max(1, objective.wings[w].ideal) })).find(v => v.status === 'BLOCKED')?.reasons[0] ?? ''}` }))) : null),
    el('div', { class: 'capability-panel', id: 'capability-panel' }, el('p', { class: 'eyebrow', text: 'Capability for this exact goal' }), ...wings.map(w => capabilityBlock(compiled.capability[w], w))));
}
function renderCustomize(editable: boolean) {
  const host = byId('customize-host');
  const title = el('div', { class: 'section-title' }, el('div', {}, el('p', { class: 'eyebrow', text: 'Step 3 · Customize' }), el('h3', { text: `${STRATEGY_LABEL[objective.strategy]} settings` })));
  if (objective.strategy === 'SHOTGUN') {
    const panel = el('div', { class: 'panel' }, title), editorHost = el('div', {});
    if (compiled.cohorts.length > 1) panel.append(el('p', { class: 'notice', text: `This goal has ${compiled.cohorts.length} release cohorts. The editor shows the first (${manilaTime(compiled.cohorts[0]!.releaseMs)}); each cohort is prepared and armed for its own release.` }));
    if (compiled.problems.length && !compiled.cohorts[0]?.smart) panel.append(el('ul', { class: 'strategy-warnings' }, ...compiled.problems.map(p => el('li', { 'data-tone': 'bad', text: p }))));
    panel.append(editorHost); fill(host, panel);
    const timing = state?.shotgunTiming;
    renderShotgunEditor(editorHost, { compiled, cohort: compiled.cohorts[0], settings: objective.shotgun, meaningfulSpacingMs: context().shotgunCapacity.meaningfulSpacingMs,
      readyWorkers: 7 - context().unavailableWorkers.size, presets, editable, timing: timing ? { status: timing.status, shotCount: timing.shotCount, p95: timing.p95, max: timing.max, outsideTolerance: timing.outsideTolerance } : null,
      liveInvokeToChromeP95Ms: null, releasesWithTiming: state?.telemetry?.length ?? 0,
      onChange: (next: ObjectiveShotgun) => edit(d => { d.shotgun = next; }),
      onPresets: async next => { presets = await window.thirsty.objective({ action: 'savePresets', value: next }) as SavedShotgunPreset[]; renderAll(true); } });
    if (compiled.problems.length) editorHost.prepend(el('ul', { class: 'strategy-warnings' }, ...compiled.problems.map(p => el('li', { 'data-tone': 'bad', text: p }))));
    return;
  }
  if (objective.strategy === 'PRECISION') {
    const cohort = compiled.cohorts[0], phase3 = cohort?.smart?.phase3;
    const rows = (cohort?.immediate ?? []).map((t, index) => {
      const offsets = objective.precision.offsetsMs[t.id] ?? [0], worker = phase3?.wave1.find(a => phase3.candidates[a.candidateIndex]?.spaceId === t.spaceId && phase3.candidates[a.candidateIndex]?.start === t.start)?.workerId ?? '—';
      const width = select(`precision-width-${index}`, [1, 2, 3, 4, 5, 6].map(n => [`${n} attempt${n === 1 ? '' : 's'}`, String(n)]), String(offsets.length), value => edit(d => { const current = d.precision.offsetsMs[t.id] ?? [0]; d.precision.offsetsMs[t.id] = Array.from({ length: Number(value) }, (_, i) => current[i] ?? 0); }), !editable);
      const inputs = offsets.map((offset, child) => { const input = el('input', { type: 'number', step: '1', value: String(offset), 'aria-label': `${wingName(t.wing)} Court ${t.court} attempt ${child + 1} offset (ms)` }) as HTMLInputElement; input.disabled = !editable;
        input.onchange = () => { const n = Number(input.value); if (!Number.isInteger(n)) { input.setCustomValidity('Whole milliseconds'); input.reportValidity(); return; } edit(d => { const list = [...(d.precision.offsetsMs[t.id] ?? [0])]; list[child] = n; d.precision.offsetsMs[t.id] = list; }); }; return input; });
      return el('tr', {}, el('td', { text: String(index + 1) }), el('td', { text: `${wingName(t.wing)} Court ${t.court}` }), el('td', { text: `${t.bookingDate} · ${rangeText(t.start, t.durationHours)}` }), el('td', { text: `Browser ${worker}` }), el('td', {}, width), el('td', { class: 'offset-cells' }, ...inputs));
    });
    const backups = el('label', { class: 'terms-choice' }, el('input', { type: 'checkbox', id: 'precision-use-backups' }), ' Keep the remaining acceptable targets as backups (sent only if a fresh, complete schedule shows them open)');
    (backups.firstChild as HTMLInputElement).checked = objective.precision.useBackups; (backups.firstChild as HTMLInputElement).disabled = !editable;
    (backups.firstChild as HTMLInputElement).onchange = event => edit(d => { d.precision.useBackups = (event.target as HTMLInputElement).checked; });
    const rescue = el('label', { class: 'terms-choice' }, el('input', { type: 'checkbox', id: 'precision-rescue' }), ' Retry approved slots if they reopen later (only after every earlier attempt was conclusively rejected)');
    (rescue.firstChild as HTMLInputElement).checked = objective.precision.retryReopened; (rescue.firstChild as HTMLInputElement).disabled = !editable;
    (rescue.firstChild as HTMLInputElement).onchange = event => edit(d => { d.precision.retryReopened = (event.target as HTMLInputElement).checked; });
    fill(host, el('div', { class: 'panel' }, title, el('div', { class: 'table-scroll' }, el('table', { class: 'attempt-table', id: 'precision-table-editor' }, el('thead', {}, el('tr', {}, ...['#', 'Court', 'Date · time', 'Browser', 'Attempts', 'Offsets (ms, −2000…0)'].map(h => el('th', { text: h })))), el('tbody', {}, ...rows))),
      backups, rescue, el('p', { class: 'small', text: 'Offsets are literal. A value outside −2000…0 is reported as a problem, never changed.' }),
      compiled.problems.length ? el('ul', { class: 'strategy-warnings' }, ...compiled.problems.map(p => el('li', { 'data-tone': 'bad', text: p }))) : null));
    return;
  }
  if (objective.mode === 'NEXT_RELEASE') {
    const g = compiled.generalRelease;
    fill(host, el('div', { class: 'panel' }, title, g ? el('p', { text: `At 8:00 the bot reads the published Mango schedule and books ${g.COURT_COUNT} court${g.COURT_COUNT === 1 ? '' : 's'} at ${hourText(g.START_TIME)}${g.FALLBACK_TIMES.length ? ` (then ${g.FALLBACK_TIMES.map(hourText).join(', ')})` : ''} for ${g.DURATION_HOURS} h, in your court priority, using ${METHOD_LABEL[objective.checkoutMethod]}.` }) : el('p', { class: 'warn-text', text: 'Normal release planning covers Mango only.' }),
      objective.wings.BUKO.enabled ? el('p', { class: 'notice', text: 'Buko scheduled release is offline-only (owner-assumed release time; Normal release planner is Mango-only). Book open Buko dates with Available Now.' }) : null));
    return;
  }
  fill(host, el('div', { class: 'panel' }, title, el('p', { class: 'small', text: 'Each row is one provider checkout with its own browser and customer. A pending checkout in one customer context can block another (HTTP 409), so wings never share a browser.' }),
    stepsTable(false), compiled.warnings.length ? el('ul', { class: 'strategy-warnings' }, ...compiled.warnings.map(w => el('li', { 'data-tone': 'warn', text: w }))) : null));
}
function stepsTable(selectable: boolean) {
  const holds = state?.qrHandoffs ?? [];
  return el('div', { class: 'table-scroll' }, el('table', { class: 'attempt-table', id: selectable ? 'available-steps-table' : 'available-plan-table' }, el('thead', {}, el('tr', {}, ...['Checkout', 'Wing', 'Courts', 'Date · time', 'Browser', 'Method', 'Status', ...(selectable ? [''] : [])].map(h => el('th', { text: h })))),
    el('tbody', {}, ...compiled.normalSteps.map((s, index) => {
      const done = holds.some(h => (h.wing ?? 'MANGO') === s.wing && h.date === s.date && h.startTime === s.start && (s.exact ? s.exact.every(c => h.courts.includes(c)) : h.courts.length === s.courtCount));
      const status = done ? 'Hold verified · payment pending' : index === activeStep && state?.ready && state.workflow === 'test' && preparedStepKey === stepKey(s) ? 'Prepared' : index === activeStep ? 'Current' : 'Waiting';
      const choose = el('button', { type: 'button', class: 'secondary compact', text: index === activeStep ? 'Current' : 'Make current' }) as HTMLButtonElement;
      choose.disabled = index === activeStep || (state?.operation ?? 'idle') !== 'idle'; choose.onclick = () => { activeStep = index; void window.thirsty.invalidatePreparation().catch(() => undefined); renderAll(true); };
      return el('tr', { 'aria-current': String(index === activeStep) }, el('td', { text: `${index + 1} of ${compiled.normalSteps.length}` }), el('td', { text: wingName(s.wing) }), el('td', { text: s.exact ? s.exact.map(c => `Court ${c}`).join(' + ') : `Best ${s.courtCount} of ${s.priority.join(', ')}` }),
        el('td', { text: `${s.date} · ${rangeText(s.start, s.durationHours)}${s.fallbackStarts.length ? ` (alt ${s.fallbackStarts.map(hourText).join(', ')})` : ''}` }), el('td', { text: s.workers.map(w => `Browser ${w}`).join(', ') }), el('td', { text: METHOD_LABEL[s.method] }),
        el('td', { 'data-tone': done ? 'good' : 'muted', text: status }), ...(selectable ? [el('td', {}, choose)] : []));
    }))));
}
function renderBrowsers() {
  const host = byId('browser-manager'), s = state, now = Date.now(), status = s?.playerStatus;
  const details: Record<string, { fullName: string; email: string } | undefined> = { A: status?.primaryDetails, B: status?.extendedDetails, C: status?.thirdDetails, D: status?.fourthDetails, E: status?.fifthDetails, F: status?.sixthDetails, G: status?.seventhDetails, H: status?.eighthDetails };
  const configured: Record<string, boolean | undefined> = { A: status?.primary, B: status?.extended, C: status?.third, D: status?.fourth, E: status?.fifth, F: status?.sixth, G: status?.seventh, H: status?.eighth };
  const assigned = new Map<string, string[]>();
  for (const step of compiled.normalSteps) for (const w of step.workers) assigned.set(w, [...(assigned.get(w) ?? []), `${wingName(step.wing)} ${step.exact ? step.exact.join('+') : `${step.courtCount} court(s)`} ${hourText(step.start)}`]);
  const phase3 = compiled.cohorts[0]?.smart?.phase3;
  for (const a of phase3?.wave1 ?? []) { const c = phase3!.candidates[a.candidateIndex]!; assigned.set(a.workerId, [...(assigned.get(a.workerId) ?? []), `${wingName(c.wing ?? 'MANGO')} ${c.court} ${hourText(c.start)} ×${a.fanOutOffsetsMs?.length ?? 1}`]); }
  const mask = (email?: string) => email ? email.replace(/^(.).*(@.*)$/, '$1•••$2') : '';
  const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(worker => {
    const hold = (s?.qrHandoffs ?? []).find(h => h.checkout === worker && h.holdExpiresAt && Date.parse(h.holdExpiresAt) > now);
    const open = !!s?.browserHealth?.[worker as 'A'], issue = (s?.identityIssues ?? []).find(i => i.startsWith(`Worker ${worker} `));
    const reuse = !hold && configured[worker] !== false && !issue;
    const show = el('button', { type: 'button', class: 'secondary compact', text: 'Show' }) as HTMLButtonElement; show.disabled = !open;
    show.onclick = () => { void window.thirsty.focusBrowser({ workerId: worker as 'A', ...(hold?.bookingId ? { bookingId: hold.bookingId } : {}) }).catch(() => undefined); };
    return el('tr', { 'data-worker': worker }, el('td', { text: worker }), el('td', { text: configured[worker] ? `${details[worker]?.fullName?.split(' ')[0] ?? 'Configured'} · ${mask(details[worker]?.email)}` : configured[worker] === false ? 'Not configured' : 'Unknown' }),
      el('td', { 'data-tone': open ? 'good' : 'muted', text: open ? (s?.ready ? 'Open · prepared' : 'Open') : 'Not running' }), el('td', { class: 'small', text: `Dedicated profile ${worker} · localhost debugging` }),
      el('td', { class: 'small', text: (assigned.get(worker) ?? []).join(' · ') || '—' }),
      el('td', { 'data-tone': hold ? 'warn' : 'muted', text: hold ? `Verified hold · ${hold.courts.map(c => `Court ${c}`).join('+')} · until ${manilaTime(Date.parse(hold.holdExpiresAt!), { hour: '2-digit', minute: '2-digit' })} · payment pending` : issue ? issue.replace(`Worker ${worker} `, '') : 'None' }),
      el('td', { 'data-tone': reuse ? 'good' : 'bad', text: reuse ? 'Yes' : hold ? 'No · pending checkout in this customer context' : 'No' }), el('td', {}, show));
  });
  const close = el('button', { type: 'button', class: 'danger-button', id: 'manager-close-browsers', text: 'Close all bot browsers' }) as HTMLButtonElement;
  close.onclick = () => { void window.thirsty.closeBotBrowsers().catch(() => undefined); };
  fill(host, el('div', { class: 'section-title' }, el('div', {}, el('p', { class: 'eyebrow', text: 'Step 4 · Browsers & readiness' }), el('h3', { text: 'One dedicated browser and customer per checkout' })), close),
    el('div', { class: 'table-scroll' }, el('table', { class: 'attempt-table browser-table' }, el('thead', {}, el('tr', {}, ...['Browser', 'Customer', 'Session', 'Identity', 'Assigned', 'Pending / hold', 'Reuse allowed', ''].map(h => el('th', { text: h })))), el('tbody', {}, ...rows))),
    el('p', { class: 'small', text: 'A browser with a pending checkout is never assigned a new checkout: the provider can refuse a second checkout in the same customer context (HTTP 409). Opening another window does not clear that. Closing a browser that shows a QR asks first; it never cancels a hold.' }),
    el('p', { class: 'small', text: 'Preparation opens exactly the browsers this plan needs. The availability check uses its own read-only observer, not these browsers.' }));
}
function inspectorFacts(): Array<[string, string]> {
  const o = objective, wings = enabledWings(o), rows: Array<[string, string]> = [];
  rows.push(['Booking objective', o.quotaScope === 'ANY_WING' ? `${o.overall.minimum}–${o.overall.ideal} distinct courts across ${wings.map(wingName).join(' and ')}` : wings.map(w => `${wingName(w)} ${o.wings[w].minimum === o.wings[w].ideal ? o.wings[w].ideal : `${o.wings[w].minimum}–${o.wings[w].ideal}`} court${o.wings[w].ideal === 1 ? '' : 's'}`).join(' · ')]);
  for (const w of wings) { let release = ''; try { release = ` · releases ${manilaTime(releaseInstantFor(o.wings[w].bookingDate, w))} (${WING_RELEASE_POLICIES[w]?.status?.replace('_', ' ')})`; } catch { /* invalid date */ }
    rows.push([`${wingName(w)} date`, `${dateText(o.wings[w].bookingDate)}${o.mode === 'NEXT_RELEASE' ? release : ''}`]); }
  rows.push(['Mode · strategy · checkout', `${o.mode === 'AVAILABLE_NOW' ? 'Available Now' : 'Next Release'} · ${STRATEGY_LABEL[o.strategy]} · ${METHOD_LABEL[o.checkoutMethod]}`]);
  const cohort = compiled.cohorts[0];
  if (cohort?.immediate.length) rows.push(['Immediate targets', cohort.immediate.map(t => `${wingName(t.wing)} ${t.court} ${rangeText(t.start, t.durationHours)}`).join(' · ')]);
  if (cohort?.backups.length) rows.push(['Backups', cohort.backups.map(t => `${wingName(t.wing)} ${t.court} ${hourText(t.start)}`).join(' · ')]);
  if (compiled.normalSteps.length) rows.push(['Checkouts', compiled.normalSteps.map((s, i) => `${i + 1}) ${wingName(s.wing)} ${s.exact ? s.exact.join('+') : `best ${s.courtCount}`} ${rangeText(s.start, s.durationHours)} · Browser ${s.workers.join('+')}`).join('  ')]);
  rows.push(['Attempts', String(compiled.attemptCount)]);
  const shots = cohort?.smart?.shotgun?.shots;
  if (shots?.length) rows.push(['Exact offsets (ms)', [...shots].map(s => s.configuredOffsetMs).sort((a, b) => a - b).join(', ')]);
  const wave1 = cohort?.smart?.phase3?.wave1;
  if (wave1?.length) rows.push(['Assigned browsers', wave1.map(a => `${a.workerId}: ${(a.fanOutOffsetsMs ?? [a.releaseOffsetMs ?? 0]).length} tab(s)`).join(' · ')]);
  rows.push(['Maximum expected price', compiled.price.perHoldMax === null ? (o.mode === 'AVAILABLE_NOW' ? `Checked against fresh prices at checkout${o.price.maxPerCheckout ? ` · cap ${peso(o.price.maxPerCheckout)} per checkout` : ''}` : 'Needs rates')
    : `${peso(compiled.price.perHoldMax)} per hold · ${peso(compiled.price.expectedIdealTotal!)} for the ideal · worst case ${peso(compiled.price.worstCaseTotal!)} if every in-flight attempt holds`]);
  rows.push(['Temporary QR holds', `minimum ${compiled.expectedHolds.minimum} · ideal ${compiled.expectedHolds.ideal} · up to ${compiled.expectedHolds.maximumPossible} possible`]);
  rows.push(['Live capability', `${compiled.liveStatus.replace('_', ' ')}${wings.length > 1 ? ' (most restrictive wing)' : ''}`]);
  return rows;
}
function renderReview(v: ExecutionView) {
  const host = byId('strategy-inspector'), outcome = runOutcome();
  const risks = [...compiled.problems.map(p => ({ tone: 'bad', text: p })), ...wingsBlocked(), ...compiled.warnings.map(w => ({ tone: 'warn', text: w }))];
  const live = liveSetup(), b = documentSaved?.binding;
  const bindingText = objective.mode === 'NEXT_RELEASE' ? live.setup ? bindingMatches() ? `Saved release plan ${state?.booking?.fingerprint.slice(0, 12)} was produced from this exact plan; preparation, arming and dispatch use it.`
    : outsideChange() ? 'The saved release plan was changed outside Booking Setup (advanced editor). Choose which plan to use below.' : 'Prepare saves this exact plan as the release authorization (replacing the current saved plan), then prepares browsers.'
    : `Not live-saveable: ${live.problems.join(' ')} Use Test This Plan for an offline rehearsal.` : 'Available Now runs each checkout directly; nothing is pre-armed.';
  const choice = outsideChange() ? el('div', { class: 'button-row' }, Object.assign(el('button', { type: 'button', class: 'secondary compact', text: 'Use this Booking Setup plan' }) as HTMLButtonElement, { onclick: () => { owns = true; renderAll(true); } }),
    Object.assign(el('button', { type: 'button', class: 'secondary compact', text: 'Keep the saved plan (advanced editor)' }) as HTMLButtonElement, { onclick: () => { owns = false; renderAll(true); } }),
    Object.assign(el('button', { type: 'button', class: 'secondary compact', text: 'Load the saved plan into Booking Setup' }) as HTMLButtonElement, { onclick: () => { if (state?.booking) { const m = objectiveFromLegacySetup(state.booking.setup as never, Date.now()); objective = m.objective; notes = m.notes; owns = true; recompile(); renderAll(true); } } })) : null;
  fill(host, el('div', { class: 'section-title' }, el('div', {}, el('p', { class: 'eyebrow', text: 'Step 5 · Strategy Inspector' }), el('h3', { text: 'Exactly what will run' })),
    el('span', { class: 'state-badge', 'data-tone': v.tone, text: v.label })), el('p', { class: 'small', text: v.detail }),
    el('dl', { class: 'fact-grid inspector-facts' }, ...inspectorFacts().flatMap(([k, val]) => [el('dt', { text: k }), el('dd', { text: val })])),
    el('p', { class: 'small', id: 'inspector-binding', text: `${owns ? '' : 'Using the saved plan from the advanced editor, not this draft. '}${bindingText}` }), choice,
    outcome ? el('p', { class: 'outcome', 'data-status': outcome.status, text: `${OUTCOME_LABEL[outcome.status]} · ${outcome.counted} court${outcome.counted === 1 ? '' : 's'} counted${outcome.extraHolds ? ` · ${outcome.extraHolds} extra hold${outcome.extraHolds === 1 ? '' : 's'}` : ''} · ${outcome.paymentPending} payment pending (manual)${outcome.paymentConfirmed ? ` · ${outcome.paymentConfirmed} confirmed by provider record` : ''}` }) : null,
    risks.length ? el('ul', { class: 'strategy-warnings', id: 'inspector-risks' }, ...risks.map(r => el('li', { 'data-tone': r.tone, text: r.text }))) : el('p', { class: 'small good-text', text: '✓ No known risks or missing prerequisites in the compiled plan.' }),
    el('details', { class: 'tool-details' }, el('summary', { text: `Compiled plan · fingerprint ${compiled.fingerprint.slice(0, 12)}…` }), el('pre', { class: 'smart-adv-json', text: JSON.stringify({ fingerprint: compiled.fingerprint, quota: compiled.quota, cohorts: compiled.cohorts.map(c => ({ releaseAt: c.releaseAt, phase3: c.smart?.phase3 ?? null, schedule: c.smart?.shotgun?.shots ?? null })), checkouts: compiled.normalSteps, general: compiled.generalRelease, binding: b ?? null }, null, 2) })));
  // Action bar: one state-dependent primary button for the active mode; no overlapping duplicates.
  const now = objective.mode === 'AVAILABLE_NOW', main = byId('main-action') as HTMLButtonElement, test = byId('test-main-action') as HTMLButtonElement;
  main.hidden = now; test.hidden = !now; byId('main-action-hint').hidden = now; byId('test-main-action-hint').hidden = !now;
  const primary = now ? test : main, label = primary.textContent ?? '';
  let blocked = '';
  if (owns && /Prepare/.test(label)) {
    if (compiled.problems.length) blocked = 'Resolve the problems listed in the inspector before preparing.';
    else if (!now && !live.setup) blocked = live.problems.join(' ');
    else if (now && !compiled.normalSteps[activeStep]) blocked = 'No checkout step is available for this goal.';
  }
  if (blocked) { primary.disabled = true; primary.title = blocked; } else primary.title = '';
  (byId('save-draft') as HTMLButtonElement).disabled = !v.can.save && v.state !== 'DRAFT' && v.state !== 'SAVED' || !v.can.edit;
  byId('action-bar-hint').textContent = blocked || (v.state === 'PREPARED' ? 'Tick the Terms authorization, then Authorize. A final confirmation shows the exact plan.' : v.state === 'ARMED' ? 'Armed. Emergency Stop disarms; holds already created stay with the provider.' : v.detail);
  const stepsHost = byId('available-now-steps'); stepsHost.hidden = !now || compiled.normalSteps.length < 1;
  if (now) fill(stepsHost, el('p', { class: 'eyebrow', text: `Checkouts for this goal · run one at a time (${compiled.normalSteps.length})` }), stepsTable(true));
  renderTestLab();
}
function wingsBlocked() {
  return enabledWings(objective).flatMap(w => { const v = compiled.capability[w]; return v && !v.live && v.status !== 'BLOCKED' ? [{ tone: 'warn', text: `${wingName(w)} is ${v.status.replace('_', ' ')} for live use: ${v.reasons[0]}` }] : []; });
}
export const bookingSetupState = () => ({ objective, compiled, documentSaved, view: loaded ? view() : null });
