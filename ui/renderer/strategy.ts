import type { Dashboard } from '../types.js';
import { compileSmartPlan, describeSmartPlan, resizeSmartFanOut, setSmartChildOffset, smartRange, smartSlotOffsets,
  type SmartDraft, type SmartSlot } from '../../src/precision-simple.js';
import { DEFAULT_STRATEGY_GOAL, draftFromSuggestion, enumeratePrimeWindows, isConflict, knownScheduleFromCells, presetAllocation, suggestPlan, validateGoal, windowEvidence, WINDOW_EVIDENCE_LABEL,
  type KnownSchedule, type ScoredWindow, type StrategyGoal, type StrategyHistoricalEvidence, type StrategyPreset, type SuggestedPlan, type SuggestionIntelligenceMode, type Window } from '../../src/strategy-engine.js';
import { describeChildTiming, fanOutTimingPlan } from '../../src/fanout-timing.js';
import { byId, el, empty, inputById, selectById } from './dom.js';

/**
 * STRATEGY: Goal → Known schedule → Preset → Suggested plan → Review & save; everything else is under Advanced overrides.
 * Suggestions only fill the Smart draft; the saved PRECISION_PHASE3 (compiled by precision-simple.ts) is the one authority,
 * and the review text is generated from it.
 */
export interface EditableSuggestionLineage { immediate: Array<string | null>; backups: Array<string | null> }
export const suggestionLineage = (draft: SmartDraft): EditableSuggestionLineage => ({ immediate: draft.immediate.map((_, index) => `I${index}`), backups: draft.backups.map((_, index) => `B${index}`) });
const acceptedByOrigin = (accepted: SmartDraft | null, kind: 'immediate' | 'backups', origin: string | null | undefined) => {
  if (!accepted || !origin) return undefined; const match = /^(I|B)(\d+)$/.exec(origin);
  if (!match || (kind === 'immediate') !== (match[1] === 'I')) return undefined;
  return accepted[kind][Number(match[2])];
};
export function reconstructLineage(current: SmartDraft, accepted: SmartDraft, saved?: EditableSuggestionLineage): EditableSuggestionLineage {
  const valid = (kind: 'immediate' | 'backups', values: Array<string | null> | undefined) => values?.length === current[kind].length &&
    values.every(value => value === null || !!acceptedByOrigin(accepted, kind, value)) && new Set(values.filter(Boolean)).size === values.filter(Boolean).length;
  if (valid('immediate', saved?.immediate) && valid('backups', saved?.backups)) return structuredClone(saved!);
  const recover = (kind: 'immediate' | 'backups') => { const used = new Set<number>(); return current[kind].map(slot => {
    const index = accepted[kind].findIndex((candidate, candidateIndex) => !used.has(candidateIndex) && JSON.stringify(candidate) === JSON.stringify(slot));
    if (index < 0) return null; used.add(index); return `${kind === 'immediate' ? 'I' : 'B'}${index}`;
  }); };
  return { immediate: recover('immediate'), backups: recover('backups') };
}
export function moveSuggestionRow(draft: SmartDraft, lineage: EditableSuggestionLineage, kind: 'immediate' | 'backups', index: number, step: number): void {
  const other = index + step; if (other < 0 || other >= draft[kind].length) return;
  [draft[kind][index], draft[kind][other]] = [draft[kind][other]!, draft[kind][index]!];
  [lineage[kind][index], lineage[kind][other]] = [lineage[kind][other]!, lineage[kind][index]!];
}
export function resetSuggestionRow(draft: SmartDraft, accepted: SmartDraft, lineage: EditableSuggestionLineage, kind: 'immediate' | 'backups', index: number): boolean {
  const original = acceptedByOrigin(accepted, kind, lineage[kind][index]); if (!original) return false;
  draft[kind][index] = structuredClone(original); return true;
}
export interface StrategyV2Meta { version: 1; preset: StrategyPreset; goal: StrategyGoal;
  fanOut: { width: number; source: 'MACHINE_RECOMMENDED' | 'OPERATOR_OVERRIDE' | 'NO_PROFILE'; acceptedSource?: 'MACHINE_RECOMMENDED' | 'OPERATOR_OVERRIDE' | 'NO_PROFILE'; recommendedWidth: number | null; timing: 'TIGHT' | 'BALANCED' | 'WIDE' | 'CUSTOM';
    basedOnTiming?: 'TIGHT' | 'BALANCED' | 'WIDE'; profileCreatedAt: string | null };
  acceptedPhase3?: NonNullable<ReturnType<typeof compileSmartPlan>['phase3']>;
  lineage?: EditableSuggestionLineage; intelligenceMode?: SuggestionIntelligenceMode;
  provenance?: { source: 'SMART_SUGGESTED' | 'EXISTING_SMART_PLAN' | 'OPERATOR_BUILT'; operatorModifications: number } }
export interface StrategyHost {
  state(): Dashboard | undefined;
  draft(): SmartDraft;
  unready(): Set<string>;
  /** Replaces the Smart draft with the suggestion (switching the plan to Smart Precision) and keeps `meta` to save with it. */
  useSuggestion(draft: SmartDraft, meta: StrategyV2Meta): void;
  accepted(): SmartDraft | null;
  lineage(): EditableSuggestionLineage;
  edit(mutate: (draft: SmartDraft, lineage: EditableSuggestionLineage) => void): void;
  resetAll(): void;
  save(): void;
}

let host: StrategyHost;
let goal: StrategyGoal = { ...DEFAULT_STRATEGY_GOAL };
let preset: StrategyPreset = 'BALANCED';
let forced: Window[] = [], removed: Window[] = [];
let suggestion: SuggestedPlan | null = null;
let suggestionGeneration = 0;
let pendingSuggestionGeneration: number | null = null;
let intelligenceMode: SuggestionIntelligenceMode = 'AUTO';
let loadedKey = '';
const hourLabel = (hour: number) => hour === 24 ? '12:00 MN' : `${hour % 12 || 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
const hourText = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
const sameWindow = (a: Window, b: Window) => a.court === b.court && a.start === b.start && a.durationHours === b.durationHours;
const windowText = (window: Window) => `Court ${window.court} · ${smartRange(window.start, window.durationHours)} (${window.durationHours} h)`;
const parseList = (value: string) => value.split(/[\s,>→]+/).map(Number).filter(Number.isFinite);

function recommendation(state: Dashboard | undefined) {
  const latest = state?.fanOut?.latest;
  return { width: latest?.recommendedWidth ?? 1, profile: latest?.profile ?? null, createdAt: latest?.createdAt ?? null, reasons: latest?.reasons ?? [], notes: latest?.notes ?? [] };
}
function chosenWidth(state: Dashboard | undefined) {
  const choice = selectById('strategy-fanout').value, machine = recommendation(state);
  return choice === 'auto' ? { width: machine.width, source: machine.profile ? 'MACHINE_RECOMMENDED' as const : 'NO_PROFILE' as const }
    : { width: Number(choice), source: 'OPERATOR_OVERRIDE' as const };
}
function childOffsets(state: Dashboard | undefined) {
  const { width } = chosenWidth(state), timing = selectById('strategy-timing').value as 'TIGHT' | 'BALANCED' | 'WIDE';
  return fanOutTimingPlan(timing, width, recommendation(state).profile);
}
function schedule(state: Dashboard | undefined): KnownSchedule | null {
  const audit = state?.blockAudit, date = state?.booking?.targetDate;
  return audit && date && audit.date === date ? knownScheduleFromCells(date, 'latest check', audit.cells) : null;
}
function readGoal(): StrategyGoal {
  return { primeFrom: selectById('strategy-prime-from').value, primeUntil: selectById('strategy-prime-until').value,
    durations: parseList(inputById('strategy-durations').value), courts: parseList(inputById('strategy-courts').value) };
}
function writeGoal(value: StrategyGoal) {
  selectById('strategy-prime-from').value = value.primeFrom; selectById('strategy-prime-until').value = value.primeUntil;
  inputById('strategy-durations').value = value.durations.join(','); inputById('strategy-courts').value = value.courts.join(',');
}
function invalidate() { suggestionGeneration++; pendingSuggestionGeneration = null; suggestion = null; byId('strategy-apply').toggleAttribute('disabled', true); render(); }

export function initStrategy(value: StrategyHost): void {
  host = value;
  selectById('strategy-prime-from').replaceChildren(...Array.from({ length: 16 }, (_, index) => { const option = el('option', '', hourLabel(index + 8)); option.value = hourText(index + 8); return option; }));
  selectById('strategy-prime-until').replaceChildren(...Array.from({ length: 16 }, (_, index) => { const hour = index + 9, option = el('option', '', hour === 24 ? 'Midnight' : hourLabel(hour));
    option.value = hour === 24 ? '24:00' : hourText(hour); return option; }));
  writeGoal(goal);
  for (const id of ['strategy-prime-from', 'strategy-prime-until', 'strategy-durations', 'strategy-courts'])
    byId(id).addEventListener('change', () => { goal = readGoal(); invalidate(); });
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="strategy-preset"]'))
    radio.addEventListener('change', () => { if (radio.checked) { preset = radio.value as StrategyPreset; invalidate(); } });
  byId('strategy-fanout').addEventListener('change', invalidate);
  byId('strategy-timing').addEventListener('change', invalidate);
  byId('strategy-check-schedule').addEventListener('click', () => {
    const date = host.state()?.booking?.targetDate; if (!date) return;
    byId('strategy-schedule-status').textContent = `Reading public bookings for ${date} (read only)…`;
    void window.thirsty.checkReleaseBlocks(date).catch(() => { byId('strategy-schedule-status').textContent = 'The public-booking check failed; evidence stays unknown.'; });
  });
  byId('strategy-intelligence').addEventListener('change', () => { intelligenceMode = selectById('strategy-intelligence').value as SuggestionIntelligenceMode; invalidate(); });
  byId('strategy-suggest').addEventListener('click', () => { void suggest().then(render); });
  byId('strategy-apply').addEventListener('click', () => {
    const state = host.state(); if (!suggestion) return;
    const timing = childOffsets(state), width = chosenWidth(state), machine = recommendation(state);
    const offsets = timing.children.map(child => child.configuredOffsetMs);
    const draft = draftFromSuggestion(suggestion, host.draft(), offsets);
    host.useSuggestion(draft, { version: 1, preset, goal: { ...goal }, lineage: suggestionLineage(draft), intelligenceMode,
      fanOut: { width: width.width, source: width.source, acceptedSource: width.source, recommendedWidth: machine.profile ? machine.width : null, timing: timing.preset,
        basedOnTiming: selectById('strategy-timing').value as 'TIGHT' | 'BALANCED' | 'WIDE', profileCreatedAt: machine.createdAt }, provenance: { source: 'SMART_SUGGESTED', operatorModifications: 0 } });
    byId('strategy-review-status').textContent = 'Suggested plan copied into the plan below. Review it, then Save plan.';
    render();
  });
  byId('strategy-reset-all').addEventListener('click', () => host.resetAll());
  byId('strategy-save').addEventListener('click', () => host.save());
  byId('strategy-suggestion').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-window]'); if (!button) return;
    const [court, start, duration] = button.dataset.window!.split('/'), window = { court: Number(court), start: start!, durationHours: Number(duration) };
    if (button.dataset.action === 'force') { forced = [...forced.filter(value => !sameWindow(value, window)), window]; removed = removed.filter(value => !sameWindow(value, window)); }
    if (button.dataset.action === 'unforce') forced = forced.filter(value => !sameWindow(value, window));
    if (button.dataset.action === 'remove') { removed = [...removed, window]; forced = forced.filter(value => !sameWindow(value, window)); }
    void suggest().then(render);
  });
}

async function suggest(): Promise<void> {
  const state = host.state();
  const generation = ++suggestionGeneration;
  suggestion = null; pendingSuggestionGeneration = generation;
  byId('strategy-apply').toggleAttribute('disabled', true);
  if (preset === 'CUSTOM' || validateGoal(goal).length) { pendingSuggestionGeneration = null; return; }
  const ready = 7 - [...host.unready()].filter(worker => 'ABCDEFG'.includes(worker)).length;
  const width = chosenWidth(state);
  const allocation = presetAllocation(preset, { readyWorkers: ready, recommendedFanOutWidth: recommendation(state).width,
    ...(width.source === 'OPERATOR_OVERRIDE' ? { fanOutWidthOverride: width.width } : {}) });
  const snapshot = { goal: structuredClone(goal), schedule: schedule(state), allocation, forceInclude: structuredClone(forced), exclude: structuredClone(removed),
    intelligenceMode, targetDate: state?.booking?.targetDate };
  render();
  let historicalEvidence: StrategyHistoricalEvidence | null = null;
  if (snapshot.intelligenceMode === 'AUTO' && snapshot.targetDate) try {
    historicalEvidence = await window.thirsty.strategyEvidence({ targetDate: snapshot.targetDate, ranges: enumeratePrimeWindows(snapshot.goal) });
  } catch { historicalEvidence = null; }
  if (generation !== suggestionGeneration) return;
  suggestion = suggestPlan({ goal: snapshot.goal, schedule: snapshot.schedule, allocation: snapshot.allocation, forceInclude: snapshot.forceInclude,
    exclude: snapshot.exclude, intelligenceMode: snapshot.intelligenceMode, historicalEvidence });
  pendingSuggestionGeneration = null;
  byId('strategy-apply').toggleAttribute('disabled', !suggestion.immediate.length);
}

function windowItem(window: ScoredWindow, actions: Array<['force' | 'unforce' | 'remove', string]>, extra = ''): HTMLElement {
  const item = el('li', window.forced ? 'forced' : '', `${windowText(window)} · ${WINDOW_EVIDENCE_LABEL[window.evidence]}${window.roleAffinity ? ` · ${window.roleAffinity.replaceAll('_', ' ').toLowerCase()}` : ''}${extra}`);
  const why = el('div', 'strategy-rationale'); why.append(...window.rationale.map(reason => el('p', 'small', `• ${reason}`))); item.append(why);
  if (window.forced) item.append(el('strong', '', ' · FORCE-INCLUDED (operator override)'));
  for (const [action, label] of actions) { const button = el('button', 'secondary compact', label); button.type = 'button'; button.dataset.window = `${window.court}/${window.start}/${window.durationHours}`;
    button.dataset.action = action; item.append(button); }
  return item;
}

function renderSuggestion(state: Dashboard | undefined) {
  const target = byId('strategy-suggestion');
  if (preset === 'CUSTOM') { target.replaceChildren(empty('Custom: build every attempt yourself under 6. Advanced overrides.')); return; }
  if (pendingSuggestionGeneration !== null) { target.replaceChildren(empty('Building suggestion…')); return; }
  if (!suggestion) { target.replaceChildren(empty(schedule(state) ? 'Choose a goal and preset, then Suggest plan.' : 'Tip: check public bookings first (step 2). Without it every window is unknown and nothing is suggested automatically (fail closed).')); return; }
  const timing = childOffsets(state), children = timing.children.map(child => `${child.configuredOffsetMs ? `−${-child.configuredOffsetMs}` : '0'} ms`).join(', ');
  const parts: HTMLElement[] = [];
  parts.push(el('p', 'small', suggestion.intelligence.label));
  parts.push(el('h3', '', `Immediate logical targets (${suggestion.immediate.length}) · ${suggestion.allocation.fanOutWidth} attempt${suggestion.allocation.fanOutWidth === 1 ? '' : 's'} each`));
  const immediate = el('ol'); immediate.append(...suggestion.immediate.map(window => windowItem(window, window.forced ? [['unforce', 'Remove override'], ['remove', 'Remove']] : [['remove', 'Remove']],
    suggestion!.allocation.fanOutWidth > 1 ? ` · children at ${children}` : ''))); parts.push(immediate);
  parts.push(el('p', 'small', `${suggestion.allocation.standby} standby worker${suggestion.allocation.standby === 1 ? '' : 's'} · Wave 2 ${suggestion.allocation.wave2 ? 'on' : 'off'} · Rescue ${suggestion.allocation.rescue ? `on (up to ${suggestion.allocation.rescueMax})` : 'off'}`));
  for (const reason of suggestion.reasons) parts.push(el('p', 'small', reason));
  const pool = el('details'); pool.append(el('summary', '', `Backup and Rescue pool (${suggestion.backups.length})`));
  const backups = el('ol'); backups.append(...suggestion.backups.map(window => windowItem(window, window.forced ? [['unforce', 'Remove override']] : [['remove', 'Remove']]))); pool.append(backups);
  parts.push(pool);
  const conflicts = suggestion.excluded.filter(window => window.reason === 'KNOWN_CONFLICT' || window.reason === 'EVIDENCE_UNKNOWN');
  if (conflicts.length) {
    const known = el('details'); known.append(el('summary', '', `Left out: known conflicts or unknown evidence (${conflicts.length})`));
    const list = el('ul'); list.append(...conflicts.map(window => windowItem(window, [['force', 'Force include']]))); known.append(list);
    parts.push(known);
  }
  target.replaceChildren(...parts);
}

function renderSchedule(state: Dashboard | undefined) {
  const grid = byId('strategy-schedule-grid'), known = schedule(state), date = state?.booking?.targetDate;
  byId('strategy-schedule-status').textContent = !date ? 'No target date yet.' : known ? `Public-booking evidence for ${date} (latest check).`
    : state?.blockAudit ? `The latest check was for ${state.blockAudit.date}; check ${date}.` : `Not checked yet for ${date}.`;
  if (validateGoal(goal).length) { grid.replaceChildren(); return; }
  const from = Number(goal.primeFrom.slice(0, 2)), until = goal.primeUntil === '24:00' ? 24 : Number(goal.primeUntil.slice(0, 2));
  const cells: HTMLElement[] = [el('span', 'head', ''), ...goal.courts.map(court => el('span', 'head', `C${court}`))];
  grid.style.gridTemplateColumns = `64px repeat(${goal.courts.length}, minmax(0, 1fr))`;
  const short: Record<string, string> = { NO_KNOWN_PUBLIC_CONFLICT: 'no record', KNOWN_PUBLIC_BOOKING_CONFLICT: 'booked', UNKNOWN_PUBLIC_QUERY_FAILED: 'unknown', PUBLISHED_OPEN: 'open', PUBLISHED_UNAVAILABLE: 'taken' };
  for (let hour = from; hour < until; hour++) {
    cells.push(el('span', 'head', hourLabel(hour)));
    for (const court of goal.courts) {
      const evidence = windowEvidence({ court, start: hourText(hour), durationHours: 1 }, known).evidence;
      const cell = el('span', '', short[evidence]); cell.dataset.evidence = evidence; cell.title = WINDOW_EVIDENCE_LABEL[evidence]; cells.push(cell);
    }
  }
  grid.replaceChildren(...cells);
}

function renderPreset(state: Dashboard | undefined) {
  const machine = recommendation(state), width = chosenWidth(state), note = byId('strategy-fanout-note');
  const parts: HTMLElement[] = [el('strong', '', machine.profile ? `Machine recommendation: ${machine.width} attempt${machine.width === 1 ? '' : 's'} per target` : 'No Fan-out Capacity Profile on this machine: 1 attempt per target')];
  if (width.source === 'OPERATOR_OVERRIDE') parts.push(el('span', 'warn-text', ` · Operator override: ${width.width} per target`));
  const reasons = el('ul', 'strategy-children'); reasons.append(...machine.reasons.map(reason => el('li', '', reason)), ...machine.notes.map(text => el('li', 'warn-text', text)),
    el('li', '', 'A local dispatch measurement, not a prediction that more attempts win a booking.'));
  note.replaceChildren(...parts, reasons);
  const timing = childOffsets(state);
  byId('strategy-timing-children').replaceChildren(...(timing.width > 1 ? timing.children.map(child => el('li', '', `Child ${child.fanOutIndex}: ${describeChildTiming(child)}`)) : []),
    ...timing.warnings.map(warning => el('li', 'warn-text', warning)), ...(timing.width > 1 ? [el('li', 'small', timing.basis)] : []));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const targetFields = (slot: SmartSlot | undefined) => slot && ({ court: slot.court, start: slot.start, durationHours: slot.durationHours });
export function strategyModificationCount(current: SmartDraft, accepted: SmartDraft | null, lineage?: EditableSuggestionLineage): number {
  if (!accepted) return 0;
  let count = 0;
  for (const kind of ['immediate', 'backups'] as const) {
    const origins = lineage?.[kind] ?? current[kind].map((_, index) => `${kind === 'immediate' ? 'I' : 'B'}${index}`);
    const present = new Set(origins.filter((value): value is string => !!value));
    count += origins.filter(value => value === null).length;
    count += accepted[kind].filter((_, index) => !present.has(`${kind === 'immediate' ? 'I' : 'B'}${index}`)).length;
    const order = origins.filter((value): value is string => !!value).map(value => Number(value.slice(1)));
    if (order.some((value, index) => index > 0 && value < order[index - 1]!)) count++;
    for (let index = 0; index < current[kind].length; index++) {
      const original = acceptedByOrigin(accepted, kind, origins[index]);
      if (!original) continue;
      if (!same(targetFields(current[kind][index]), targetFields(original))) count++;
      if (kind === 'immediate' && !same(smartSlotOffsets(current[kind][index]!), smartSlotOffsets(original))) count++;
    }
  }
  if (current.useBackupsImmediately !== accepted.useBackupsImmediately) count++;
  if (current.retryReopened !== accepted.retryReopened || current.maxReopenedAttempts !== accepted.maxReopenedAttempts) count++;
  return count;
}
function editorSelect(id: string, label: string, choices: Array<[string, string]>, value: string, change: (value: string) => void) {
  const wrap = el('label'), select = document.createElement('select'); select.id = id;
  select.replaceChildren(...choices.map(([text, option]) => new Option(text, option))); select.value = value;
  select.addEventListener('change', () => change(select.value)); wrap.append(label, select); return wrap;
}
function editorButton(text: string, label: string, disabled: boolean, click: () => void) {
  const button = el('button', 'secondary compact', text); button.type = 'button'; button.disabled = disabled; button.setAttribute('aria-label', label); button.onclick = click; return button;
}
function acceptedTiming(slot: SmartSlot | undefined) { return slot ? smartSlotOffsets(slot) : null; }
function inputTiming(slot: SmartSlot, child: number, offset: number) {
  if (Number.isSafeInteger(offset) && offset >= -2000 && offset <= 0) return setSmartChildOffset(slot, child, offset);
  const offsets = smartSlotOffsets(slot); offsets[child] = offset; const next = { ...slot }; delete next.releaseOffsetMs; delete next.fanOutOffsetsMs;
  if (offsets.length === 1) next.releaseOffsetMs = offsets[0]; else next.fanOutOffsetsMs = offsets; return next;
}
function resizeDefaults(state: Dashboard | undefined, width: number) {
  const selected = selectById('strategy-timing').value as 'TIGHT' | 'BALANCED' | 'WIDE';
  return fanOutTimingPlan(selected, width, recommendation(state).profile).children.map(child => child.configuredOffsetMs);
}
function editableRow(kind: 'immediate' | 'backups', slot: SmartSlot, index: number, state: Dashboard | undefined,
  compiled: ReturnType<typeof compileSmartPlan>, accepted: SmartDraft | null) {
  const origin = host.lineage()[kind][index], original = acceptedByOrigin(accepted, kind, origin), immediate = kind === 'immediate', letter = compiled.immediateWorkers[index] ?? String.fromCharCode(65 + index);
  const targetChanged = !original || !same(targetFields(slot), targetFields(original));
  const timingChanged = immediate && (!original || !same(smartSlotOffsets(slot), acceptedTiming(original)));
  const row = el('li', 'strategy-edit-row');
  const rowLabel = !origin ? 'Operator added' : targetChanged || timingChanged ? 'Customized' : 'Suggested';
  const heading = el('div', 'strategy-edit-heading'); heading.append(el('strong', '', immediate ? `Target ${String.fromCharCode(65 + index)}` : `Backup ${index + 1}`),
    el('span', `strategy-source ${rowLabel !== 'Suggested' ? 'modified' : ''}`, rowLabel));
  const fields = el('div', 'strategy-edit-fields');
  const patch = (value: Partial<SmartSlot>) => host.edit(draft => { draft[kind][index] = { ...draft[kind][index]!, ...value }; });
  fields.append(editorSelect(`strategy-${kind}-court-${index}`, 'Court', Array.from({ length: 7 }, (_, value) => [`Court ${value + 1}`, String(value + 1)]), String(slot.court), value => patch({ court: Number(value) })),
    editorSelect(`strategy-${kind}-start-${index}`, 'Start', Array.from({ length: 16 }, (_, value) => { const hour = value + 8, text = hourText(hour); return [hourLabel(hour), text]; }), slot.start, value => patch({ start: value })),
    editorSelect(`strategy-${kind}-duration-${index}`, 'Duration', [['1 hour', '1'], ['2 hours', '2'], ['3 hours', '3']], String(slot.durationHours), value => patch({ durationHours: Number(value) })));
  if (immediate) {
    const offsets = smartSlotOffsets(slot);
    fields.append(editorSelect(`strategy-immediate-width-${index}`, 'Fan-out', [1, 2, 3, 4].map(value => [`${value} child${value === 1 ? '' : 'ren'}`, String(value)]), String(offsets.length), value => {
      const width = Number(value), defaults = resizeDefaults(state, width); host.edit(draft => { draft.immediate[index] = resizeSmartFanOut(draft.immediate[index]!, width, defaults); });
    }));
    const worker = el('span', 'strategy-worker', `Worker ${letter} · automatically assigned`); fields.append(worker);
    const timing = el('div', 'strategy-child-timing'); timing.append(el('strong', '', 'Timing'));
    offsets.forEach((offset, child) => {
      const label = el('label'), input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '2000'; input.step = '1';
      input.id = `strategy-immediate-offset-${index}-${child}`; input.value = String(-offset);
      input.addEventListener('change', () => { const early = Number(input.value), next = Number.isSafeInteger(early) && early >= 0 && early <= 2000 ? -early : Number.NaN;
        host.edit(draft => { draft.immediate[index] = inputTiming(draft.immediate[index]!, child, next); }); });
      const childModified = !original || acceptedTiming(original)?.[child] !== offset;
      label.append(offsets.length === 1 ? 'Send early by ' : `${letter}${child} `, input, ' ms early ', el('span', `strategy-source ${childModified ? 'modified' : ''}`, childModified ? 'Modified' : 'Suggested'));
      timing.append(label);
    });
    fields.append(timing);
  }
  const items = host.draft()[kind], actions = el('div', 'strategy-edit-actions'), noun = immediate ? 'target' : 'backup';
  const move = (step: number) => host.edit((draft, lineage) => moveSuggestionRow(draft, lineage, kind, index, step));
  actions.append(editorButton('↑', `Move editable ${noun} ${index + 1} up`, index === 0, () => move(-1)), editorButton('↓', `Move editable ${noun} ${index + 1} down`, index === items.length - 1, () => move(1)));
  if (immediate) actions.append(editorButton('Reset timing', `Reset editable target ${index + 1} timing`, !original || !timingChanged, () => host.edit(draft => {
    const next = { ...draft.immediate[index]! }; delete next.releaseOffsetMs; delete next.fanOutOffsetsMs;
    const originalOffsets = smartSlotOffsets(original!);
    if (originalOffsets.length > 1) next.fanOutOffsetsMs = [...originalOffsets]; else if (originalOffsets[0] !== 0) next.releaseOffsetMs = originalOffsets[0];
    draft.immediate[index] = next;
  })));
  actions.append(editorButton('Reset target', `Reset editable ${noun} ${index + 1}`, !original || (!targetChanged && !timingChanged), () => host.edit((draft, lineage) => { if (accepted) resetSuggestionRow(draft, accepted, lineage, kind, index); })),
    editorButton('Remove', `Remove editable ${noun} ${index + 1}`, false, () => host.edit((draft, lineage) => { draft[kind].splice(index, 1); lineage[kind].splice(index, 1); })));
  row.append(heading, fields, actions); return row;
}
function renderEditable(state: Dashboard | undefined) {
  const section = byId('strategy-editable'), smart = state?.booking && (document.getElementById('precision-strategy') as HTMLSelectElement | null)?.value === 'precision'
    && (document.getElementById('precision-mode-smart') as HTMLInputElement | null)?.checked;
  section.hidden = !smart; if (!smart) return;
  const draft = host.draft(), accepted = host.accepted(), compiled = compileSmartPlan(draft, { targetDate: state?.booking?.targetDate ?? '', unavailable: host.unready() });
  const lineage = host.lineage(), modifications = strategyModificationCount(draft, accepted, lineage);
  byId('strategy-edit-provenance').textContent = accepted ? `Source: Smart generated · Operator modifications: ${modifications}` : 'Source: Existing Smart plan';
  (byId('strategy-reset-all') as HTMLButtonElement).disabled = !accepted || modifications === 0;
  byId('strategy-edit-immediate').replaceChildren(...draft.immediate.map((slot, index) => editableRow('immediate', slot, index, state, compiled, accepted)));
  byId('strategy-edit-backups').replaceChildren(...draft.backups.map((slot, index) => editableRow('backups', slot, index, state, compiled, accepted)));
  const baselineStarts = accepted ? new Set(accepted.immediate.map(slot => slot.start)).size : 0, currentStarts = new Set(draft.immediate.map(slot => slot.start)).size;
  byId('strategy-edit-warnings').replaceChildren(...(baselineStarts > currentStarts ? [el('li', '', `This change reduces start-time diversification from ${baselineStarts} unique starts to ${currentStarts}.`)] : []));
}

function renderReview(state: Dashboard | undefined) {
  const draft = host.draft(), compiled = compileSmartPlan(draft, { targetDate: state?.booking?.targetDate ?? '', unavailable: host.unready() });
  const smart = state?.booking && (document.getElementById('precision-strategy') as HTMLSelectElement | null)?.value === 'precision' && (document.getElementById('precision-mode-smart') as HTMLInputElement | null)?.checked;
  const warnings = [...draft.immediate, ...draft.backups].filter(slot => slot.publicEvidence?.override).map(slot =>
    `${windowText(slot)} was force-included despite ${slot.publicEvidence!.evidence === 'UNKNOWN_PUBLIC_QUERY_FAILED' ? 'a failed public-booking read' : 'a known public booking'} (OPERATOR_OVERRIDE_PUBLIC_CONFLICT).`);
  byId('strategy-review-warnings').replaceChildren(...[...warnings, ...compiled.problems].map(text => el('li', '', text)));
  const body = byId('strategy-review-body');
  if (!smart) { body.replaceChildren(empty('The current plan is not a Smart plan. Use a suggestion, or edit under Advanced overrides.')); return; }
  if (!compiled.phase3) { body.replaceChildren(empty('Fix the problems above to see what will happen.')); return; }
  const description = describeSmartPlan(compiled.phase3, { unavailable: host.unready() });
  body.replaceChildren(...description.sections.flatMap(section => [el('h4', '', section.title), ...section.lines.map(line => el('p', 'small', line))]),
    el('p', '', `${description.summary} · Maximum possible sends: ${description.maxSends}`));
}

/** Called on every status update. Loads the saved goal/preset once per saved plan. */
export function renderStrategy(state: Dashboard | undefined): void {
  if (!host) return;
  const saved = state?.booking?.setup.STRATEGY_V2, key = `${state?.booking?.targetDate ?? ''}|${saved ? JSON.stringify(saved) : ''}`;
  if (key !== loadedKey) {
    suggestionGeneration++; pendingSuggestionGeneration = null; suggestion = null; byId('strategy-apply').toggleAttribute('disabled', true);
    loadedKey = key;
    if (saved) { goal = { ...saved.goal }; preset = saved.preset; selectById('strategy-fanout').value = saved.fanOut.source === 'OPERATOR_OVERRIDE' ? String(saved.fanOut.width) : 'auto';
      intelligenceMode = saved.intelligenceMode ?? 'AUTO'; selectById('strategy-intelligence').value = intelligenceMode;
      if (saved.fanOut.timing !== 'CUSTOM') selectById('strategy-timing').value = saved.fanOut.timing;
      else if (saved.fanOut.basedOnTiming) selectById('strategy-timing').value = saved.fanOut.basedOnTiming; }
    else if (state?.booking?.setup.PREFERRED_COURTS?.length) goal = { ...goal, courts: [...state.booking.setup.PREFERRED_COURTS] };
    writeGoal(goal);
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="strategy-preset"]')) radio.checked = radio.value === preset;
  }
  byId('strategy-target-date').textContent = state?.booking?.targetDate ?? '—';
  byId('strategy-goal-problems').textContent = validateGoal(goal).join(' ');
  (byId('strategy-suggest') as HTMLButtonElement).disabled = preset === 'CUSTOM' || validateGoal(goal).length > 0;
  render();
}
function render() {
  const state = host.state();
  (byId('strategy-suggest') as HTMLButtonElement).disabled = preset === 'CUSTOM' || validateGoal(goal).length > 0;
  renderSchedule(state); renderPreset(state); renderSuggestion(state); renderEditable(state); renderReview(state);
}
/** Exposed for tests and the Next Release summary. */
export const strategySnapshot = () => ({ goal: { ...goal }, preset, forced: [...forced], suggestion, suggestionGeneration, pendingSuggestionGeneration });
export const conflictsIn = (plan: SuggestedPlan) => plan.immediate.filter(window => isConflict(window.evidence));
