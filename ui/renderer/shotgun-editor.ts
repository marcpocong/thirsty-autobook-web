import type { CompiledCohort, CompiledObjective, ObjectiveShotgun } from '../../src/booking-objective.js';
import { applyPreset, BUILT_IN_PRESETS, comparePresets, duplicatePreset, removePreset, renamePreset, restorePreset, savePreset, scheduleMetrics, suggestShotgun,
  type SavedShotgunPreset, type ShotgunPresetId, type ShotgunSuggestion } from '../../src/shotgun-advisor.js';
import { SHOTGUN_MAX_TRIGGER_LATENESS_MS, SHOTGUN_MEANINGFUL_SPACING_MS } from '../../src/shotgun.js';
import { PRECISION_MAX_ATTEMPTS, PRECISION_MAX_FAN_OUT, PRECISION_MAX_SENDS } from '../../src/workers.js';
import { el, hourText, rangeText, wingName } from './navigation.js';

/**
 * Complete Shotgun editor inside Booking Setup. Every value it writes is the operator's literal choice: offsets are
 * never clamped, respaced or replaced. The compiled attempt table is produced by the shared compiler; editing a row
 * switches to Fully Custom with the exact (target, offset) pairs, which the compiler then preserves literally.
 */
export interface ShotgunEditorContext {
  compiled: CompiledObjective; cohort: CompiledCohort | undefined; settings: ObjectiveShotgun;
  meaningfulSpacingMs: number; readyWorkers: number; presets: SavedShotgunPreset[]; editable: boolean;
  timing: { status: 'READY' | 'AT_RISK' | 'FAILED' | 'NOT_TESTED'; shotCount: number; p95: number | null; max?: number | null; outsideTolerance?: number } | null;
  liveInvokeToChromeP95Ms: number | null; releasesWithTiming: number;
  onChange(next: ObjectiveShotgun): void; onPresets(next: SavedShotgunPreset[]): Promise<void>;
}
interface Row { index: number; targetId: string; offsetMs: number; workerId: string | null; wing: string; court: number; date: string; start: string; durationHours: number }
let selectedShot = -1, compareA = 'CURRENT', compareB = 'SUGGESTED';

/** Literal (target, offset, worker) rows in chronological order, from the compiled schedule and worker grouping. */
export function attemptRows(cohort: CompiledCohort | undefined): Row[] {
  const shots = cohort?.smart?.shotgun?.shots, phase3 = cohort?.smart?.phase3;
  if (!shots || !phase3) return [];
  const pool = phase3.wave1.flatMap(a => { const c = phase3.candidates[a.candidateIndex]!; const target = cohort!.immediate.find(t => t.spaceId === c.spaceId && t.start === c.start && t.bookingDate === c.bookingDate && t.durationHours === c.durationHours);
    return (a.fanOutOffsetsMs ?? [a.releaseOffsetMs ?? 0]).map(offset => ({ targetId: target?.id ?? '', offset, workerId: a.workerId as string, used: false })); });
  return [...shots].sort((a, b) => a.configuredOffsetMs - b.configuredOffsetMs || a.logicalTargetId.localeCompare(b.logicalTargetId)).map((shot, index) => {
    const target = cohort!.immediate.find(t => t.id === shot.logicalTargetId)!;
    const match = pool.find(p => !p.used && p.targetId === shot.logicalTargetId && p.offset === shot.configuredOffsetMs); if (match) match.used = true;
    return { index, targetId: shot.logicalTargetId, offsetMs: shot.configuredOffsetMs, workerId: match?.workerId ?? null, wing: target.wing, court: target.court, date: target.bookingDate, start: target.start, durationHours: target.durationHours };
  });
}
const literal = (rows: readonly { targetId: string; offsetMs: number }[]) => rows.map(r => ({ targetId: r.targetId, offsetMs: r.offsetMs }));
function customFrom(settings: ObjectiveShotgun, pairs: Array<{ targetId: string; offsetMs: number }>): ObjectiveShotgun {
  return { ...settings, timingMode: 'CUSTOM', allocationMode: 'CUSTOM', budget: Math.max(1, pairs.length), customOffsetsMs: pairs.map(p => p.offsetMs), customAssignments: pairs.map(p => p.targetId), presetId: 'FULLY_CUSTOM', source: 'CUSTOM' };
}
function numberField(label: string, value: number, attrs: Record<string, string>, onCommit: (value: number) => void, disabled: boolean) {
  const input = el('input', { type: 'number', value: String(value), step: '1', ...attrs }) as HTMLInputElement; input.disabled = disabled;
  input.addEventListener('change', () => { const n = Number(input.value); if (!Number.isFinite(n) || !Number.isInteger(n)) { input.setCustomValidity('Enter a whole number.'); input.reportValidity(); return; } input.setCustomValidity(''); onCommit(n); });
  return el('label', {}, label, input);
}

export function renderShotgunEditor(host: HTMLElement, ctx: ShotgunEditorContext) {
  const s = ctx.settings, cohort = ctx.cohort, rows = attemptRows(cohort), targets = cohort?.immediate ?? [];
  const suggestion: ShotgunSuggestion = suggestShotgun({ immediateTargets: Math.max(1, targets.length), targetWings: [...new Set(targets.map(t => t.wing))], idealCourts: ctx.compiled.expectedHolds.ideal,
    readyWorkers: ctx.readyWorkers, meaningfulSpacingMs: ctx.meaningfulSpacingMs > SHOTGUN_MEANINGFUL_SPACING_MS ? ctx.meaningfulSpacingMs : null,
    timing: ctx.timing ? { status: ctx.timing.status, shotCount: ctx.timing.shotCount, p95: ctx.timing.p95 } : null, liveInvokeToChromeP95Ms: ctx.liveInvokeToChromeP95Ms, releasesWithTiming: ctx.releasesWithTiming });
  const set = (patch: Partial<ObjectiveShotgun>) => ctx.onChange({ ...s, ...patch, presetId: patch.presetId ?? (s.presetId === 'SUGGESTED' || BUILT_IN_PRESETS.some(p => p.id === s.presetId) ? 'FULLY_CUSTOM' : s.presetId), source: patch.source ?? 'CUSTOM' });
  const disabled = !ctx.editable;
  // 1. Suggested configuration
  const suggested = el('section', { class: 'shotgun-card', id: 'shotgun-suggestion' },
    el('div', { class: 'section-title' }, el('div', {}, el('p', { class: 'eyebrow', text: 'Suggested configuration' }), el('h3', { text: `${suggestion.settings.budget} attempts · ${suggestion.settings.allocationMode === 'EQUAL' ? 'equal across targets' : 'priority weighted'} · even spacing` })),
      el('span', { class: 'confidence', 'data-tone': suggestion.confidence === 'HEURISTIC' ? 'warn' : 'good', text: suggestion.confidence === 'HEURISTIC' ? 'HEURISTIC · not experimentally proven' : 'LOCALLY BENCHMARKED' })),
    el('ul', { class: 'rationale' }, ...suggestion.rationale.map(line => el('li', { text: line }))),
    el('details', { class: 'tool-details' }, el('summary', { text: 'Evidence used' }), el('ul', {}, ...suggestion.evidence.map(line => el('li', { text: line })), ...suggestion.warnings.map(line => el('li', { class: 'warn-text', text: line })))),
    el('p', { class: 'small', text: 'A suggestion predicts nothing about who wins. It is a starting point; your saved presets and custom timing are never overwritten by new suggestions.' }));
  const usingSuggestion = s.timingMode === suggestion.settings.timingMode && s.budget === suggestion.settings.budget && s.allocationMode === suggestion.settings.allocationMode && s.windowStartMs === suggestion.settings.windowStartMs && s.windowEndMs === suggestion.settings.windowEndMs;
  const apply = el('button', { type: 'button', class: 'secondary', id: 'shotgun-apply-suggestion', text: usingSuggestion ? 'Using the suggestion' : 'Use this suggestion' }) as HTMLButtonElement;
  apply.disabled = disabled || usingSuggestion; apply.onclick = () => ctx.onChange({ ...suggestion.settings });
  suggested.append(apply);
  // 2. Presets
  const presetButtons = el('div', { class: 'preset-row', role: 'group', 'aria-label': 'Shotgun presets' }, ...BUILT_IN_PRESETS.map(p => {
    const b = el('button', { type: 'button', class: 'preset', 'data-preset': p.id, 'aria-pressed': String(s.presetId === p.id), title: p.detail }, el('strong', { text: p.label }), el('small', { text: p.detail })) as HTMLButtonElement;
    b.disabled = disabled; b.onclick = () => ctx.onChange(applyPreset(p.id as ShotgunPresetId, s, { suggestion, literal: literal(rows) })); return b; }));
  const nameInput = el('input', { type: 'text', id: 'shotgun-preset-name', placeholder: 'Preset name', maxlength: '60' }) as HTMLInputElement;
  const savedList = el('ul', { class: 'saved-presets', id: 'shotgun-saved-presets' }, ...(ctx.presets.length ? ctx.presets.map(p => {
    const restore = el('button', { type: 'button', class: 'secondary compact', text: 'Restore' }) as HTMLButtonElement; restore.disabled = disabled; restore.onclick = () => ctx.onChange(restorePreset(ctx.presets, p.id));
    const rename = el('button', { type: 'button', class: 'secondary compact', text: 'Rename' }) as HTMLButtonElement; rename.onclick = () => { const name = nameInput.value.trim(); if (!name) { nameInput.focus(); return; } void ctx.onPresets(renamePreset(ctx.presets, p.id, name)).catch(e => alertText(host, e)); };
    const copy = el('button', { type: 'button', class: 'secondary compact', text: 'Duplicate' }) as HTMLButtonElement; copy.onclick = () => void ctx.onPresets(duplicatePreset(ctx.presets, p.id)).catch(e => alertText(host, e));
    const remove = el('button', { type: 'button', class: 'secondary compact', text: 'Delete' }) as HTMLButtonElement; remove.onclick = () => void ctx.onPresets(removePreset(ctx.presets, p.id));
    return el('li', { 'aria-current': String(s.presetId === p.id) }, el('strong', { text: p.name }), el('span', { class: 'small', text: ` ${p.settings.timingMode === 'CUSTOM' ? `${p.settings.customOffsetsMs?.length ?? 0} literal attempts` : `${p.settings.budget} attempts · ${p.settings.timingMode}`}` }), restore, rename, copy, remove);
  }) : [el('li', { class: 'empty', text: 'No saved presets yet.' })]));
  const save = el('button', { type: 'button', class: 'secondary compact', id: 'shotgun-save-preset', text: 'Save current as preset' }) as HTMLButtonElement;
  save.onclick = () => void ctx.onPresets(savePreset(ctx.presets, nameInput.value || `Preset ${ctx.presets.length + 1}`, s)).then(() => { nameInput.value = ''; }).catch(e => alertText(host, e));
  const options: Array<[string, string, ObjectiveShotgun]> = [['CURRENT', 'Current plan', s], ['SUGGESTED', 'Suggested', suggestion.settings], ...ctx.presets.map(p => [p.id, p.name, p.settings] as [string, string, ObjectiveShotgun])];
  const pick = (value: string, onPick: (v: string) => void) => { const select = el('select', {}) as HTMLSelectElement; select.replaceChildren(...options.map(([id, name]) => new Option(name, id))); select.value = options.some(o => o[0] === value) ? value : 'CURRENT'; select.onchange = () => { onPick(select.value); renderShotgunEditor(host, ctx); }; return select; };
  const a = options.find(o => o[0] === compareA)?.[2] ?? s, b = options.find(o => o[0] === compareB)?.[2] ?? suggestion.settings;
  const compare = el('details', { class: 'tool-details', id: 'shotgun-compare' }, el('summary', { text: 'Compare presets' }), el('div', { class: 'compare-pick' }, el('label', {}, 'A ', pick(compareA, v => { compareA = v; })), el('label', {}, 'B ', pick(compareB, v => { compareB = v; }))),
    el('table', { class: 'compare-table' }, el('thead', {}, el('tr', {}, el('th', { text: 'Setting' }), el('th', { text: 'A' }), el('th', { text: 'B' }))),
      el('tbody', {}, ...comparePresets(a, b).map(row => el('tr', { 'data-differs': String(row.differs) }, el('td', { text: row.label }), el('td', { text: row.a }), el('td', { text: row.b }))))));
  const presets = el('section', { class: 'shotgun-card', id: 'shotgun-presets' }, el('p', { class: 'eyebrow', text: 'Presets' }), presetButtons,
    el('div', { class: 'preset-save' }, nameInput, save), savedList, compare);
  // 3. Manual timing
  const custom = s.timingMode === 'CUSTOM';
  const allocation = el('select', { id: 'shotgun-allocation' }) as HTMLSelectElement;
  allocation.replaceChildren(new Option('Equal across targets', 'EQUAL'), new Option('Priority weighted', 'PRIORITY_WEIGHTED'), new Option('Custom counts per target', 'CUSTOM'));
  allocation.value = s.allocationMode; allocation.disabled = disabled || custom; allocation.onchange = () => set({ allocationMode: allocation.value as ObjectiveShotgun['allocationMode'] });
  const timingMode = el('select', { id: 'shotgun-timing-mode' }) as HTMLSelectElement;
  timingMode.replaceChildren(...[['AUTO', 'Even spacing across the window'], ['TIGHT', 'Tight (1× spacing reference)'], ['BALANCED', 'Balanced (2×)'], ['WIDE', 'Wide (4×)'], ['DENSE_CORE', 'Dense Core (experimental)'], ['CUSTOM', 'Fully custom (literal offsets)']].map(([v, t]) => new Option(t, v)));
  timingMode.value = s.timingMode; timingMode.disabled = disabled;
  timingMode.onchange = () => { const next = timingMode.value as ObjectiveShotgun['timingMode']; if (next === 'CUSTOM') ctx.onChange(customFrom(s, literal(rows))); else { const { customAssignments: _a, customOffsetsMs: _o, ...rest } = s; ctx.onChange({ ...rest, timingMode: next, presetId: 'FULLY_CUSTOM', source: 'CUSTOM' }); } };
  const counts = s.allocationMode === 'CUSTOM' && !custom ? el('div', { class: 'custom-counts' }, ...targets.map(t => numberField(`${wingName(t.wing)} Court ${t.court} · ${rangeText(t.start, t.durationHours)}`, s.customCounts?.[t.id] ?? 0, { min: '0', max: String(PRECISION_MAX_SENDS) },
    value => set({ customCounts: { ...(s.customCounts ?? {}), [t.id]: value } }), disabled))) : null;
  const override = el('label', { class: 'terms-choice' }, el('input', { type: 'checkbox', id: 'shotgun-capacity-override' }), ' Accept timing closer than the meaningful-spacing reference (exact offsets are kept)');
  (override.firstChild as HTMLInputElement).checked = !!s.timingCapacityOverride; (override.firstChild as HTMLInputElement).disabled = disabled;
  (override.firstChild as HTMLInputElement).onchange = event => set({ timingCapacityOverride: (event.target as HTMLInputElement).checked });
  const standby = el('label', { class: 'terms-choice' }, el('input', { type: 'checkbox', id: 'shotgun-standby-override' }), ' Let Shotgun use workers that would otherwise be held back for backups');
  (standby.firstChild as HTMLInputElement).checked = !!s.allowStandbyConsumption; (standby.firstChild as HTMLInputElement).disabled = disabled;
  (standby.firstChild as HTMLInputElement).onchange = event => set({ allowStandbyConsumption: (event.target as HTMLInputElement).checked });
  const manual = el('section', { class: 'shotgun-card', id: 'shotgun-manual' }, el('p', { class: 'eyebrow', text: 'Manual timing' }),
    el('div', { class: 'setup-grid' },
      numberField('Total attempts', custom ? rows.length || (s.customOffsetsMs?.length ?? 0) : s.budget, { id: 'shotgun-budget', min: '1', max: String(PRECISION_MAX_SENDS) }, value => set({ budget: value }), disabled || custom),
      el('label', {}, 'Allocation', allocation), el('label', {}, 'Timing', timingMode),
      numberField('First attempt (ms before release)', s.windowStartMs, { id: 'shotgun-window-start', min: '-2000', max: '0' }, value => set({ windowStartMs: value }), disabled || custom || s.timingMode === 'DENSE_CORE'),
      numberField('Last attempt (ms)', s.windowEndMs, { id: 'shotgun-window-end', min: '-2000', max: '0' }, value => set({ windowEndMs: value }), disabled || custom || s.timingMode === 'DENSE_CORE')),
    counts, override, standby,
    el('p', { class: 'small', text: `Supported limits (unchanged, audited): offsets −2000…0 ms (positive offsets are invalid, never clamped); strict ${SHOTGUN_MAX_TRIGGER_LATENESS_MS} ms local lateness bound; ${SHOTGUN_MEANINGFUL_SPACING_MS} ms meaningful-spacing reference; up to ${PRECISION_MAX_FAN_OUT} tabs per worker × ${PRECISION_MAX_ATTEMPTS} Precision workers = ${PRECISION_MAX_FAN_OUT * PRECISION_MAX_ATTEMPTS} immediate attempts (${PRECISION_MAX_SENDS} total sends including backups and Rescue). More attempts are not automatically better.` }));
  // 4. Literal attempt table
  const metrics = scheduleMetrics(rows.map(r => ({ targetId: r.targetId, offsetMs: r.offsetMs, workerId: r.workerId })), ctx.meaningfulSpacingMs);
  const sourceRows: Array<Row | { index: number; targetId: string; offsetMs: number; workerId: null; invalid: true }> = custom && s.customOffsetsMs && s.customAssignments && (!rows.length || ctx.compiled.problems.length)
    ? s.customAssignments.map((targetId, index) => ({ index, targetId, offsetMs: s.customOffsetsMs![index]!, workerId: null, invalid: true as const })) : rows;
  // Edits are positional over the displayed literal rows, so simultaneous attempts are never ambiguous.
  const writeRows = (mutate: (pairs: Array<{ targetId: string; offsetMs: number }>) => void) => { const pairs = literal(sourceRows); mutate(pairs); ctx.onChange(customFrom(s, pairs)); };
  const table = el('table', { class: 'attempt-table', id: 'shotgun-attempt-table' }, el('thead', {}, el('tr', {}, ...['#', 'Wing', 'Court', 'Date · time', 'Offset (ms)', 'Gap', 'Browser', 'Method', 'Status', ''].map(h => el('th', { text: h })))),
    el('tbody', {}, ...sourceRows.map((row, position) => {
      const target = targets.find(t => t.id === row.targetId), previous = position > 0 ? sourceRows[position - 1]!.offsetMs : null;
      const offset = el('input', { type: 'number', step: '1', value: String(row.offsetMs), 'aria-label': `Shot ${position + 1} offset in milliseconds`, 'data-shot': String(position) }) as HTMLInputElement;
      offset.disabled = disabled;
      offset.onchange = () => { const n = Number(offset.value); if (!Number.isInteger(n)) { offset.setCustomValidity('Whole milliseconds only.'); offset.reportValidity(); return; } writeRows(pairs => { pairs[position] = { ...pairs[position]!, offsetMs: n }; }); };
      const targetSelect = el('select', { 'aria-label': `Shot ${position + 1} target` }) as HTMLSelectElement;
      targetSelect.replaceChildren(...targets.map(t => new Option(`${wingName(t.wing)} ${t.court} · ${hourText(t.start)}`, t.id))); targetSelect.value = row.targetId; targetSelect.disabled = disabled;
      targetSelect.onchange = () => writeRows(pairs => { pairs[position] = { ...pairs[position]!, targetId: targetSelect.value }; });
      const removeButton = el('button', { type: 'button', class: 'secondary compact', text: 'Remove', 'aria-label': `Remove shot ${position + 1}` }) as HTMLButtonElement;
      removeButton.disabled = disabled || sourceRows.length <= 1;
      removeButton.onclick = () => writeRows(pairs => { pairs.splice(position, 1); });
      const invalid = !Number.isSafeInteger(row.offsetMs) || row.offsetMs < -2000 || row.offsetMs > 0;
      const gap = previous === null ? '—' : `${row.offsetMs - previous} ms`, close = previous !== null && row.offsetMs - previous < ctx.meaningfulSpacingMs;
      return el('tr', { 'data-wing': target?.wing ?? '', 'aria-selected': String(selectedShot === position), 'data-invalid': String(invalid) },
        el('td', { text: String(position + 1) }), el('td', { text: target ? wingName(target.wing) : '?' }), el('td', {}, targetSelect),
        el('td', { text: target ? `${target.bookingDate} · ${rangeText(target.start, target.durationHours)}` : '—' }), el('td', {}, offset),
        el('td', { 'data-tone': close ? 'warn' : 'muted', text: gap }), el('td', { text: row.workerId ? `Browser ${row.workerId}` : '—' }), el('td', { text: 'Proofless' }),
        el('td', { 'data-tone': invalid ? 'bad' : 'muted', text: invalid ? 'INVALID · outside −2000…0' : ctx.compiled.problems.length ? 'Plan has problems' : 'Planned' }), el('td', {}, removeButton));
    })));
  const addRow = el('button', { type: 'button', class: 'secondary compact', id: 'shotgun-add-shot', text: 'Add attempt' }) as HTMLButtonElement;
  addRow.disabled = disabled || !targets.length; addRow.onclick = () => writeRows(pairs => { const last = pairs.at(-1); pairs.push({ targetId: last?.targetId ?? targets[0]!.id, offsetMs: last?.offsetMs ?? 0 }); });
  const tableCard = el('section', { class: 'shotgun-card', id: 'shotgun-table' }, el('div', { class: 'section-title' }, el('div', {}, el('p', { class: 'eyebrow', text: 'Literal attempt table' }), el('h3', { text: `${sourceRows.length} attempt${sourceRows.length === 1 ? '' : 's'}` })), addRow),
    el('p', { class: 'small', text: 'Editing any offset, target or row switches to Fully Custom and saves your exact values. Nothing is respaced.' }), el('div', { class: 'table-scroll' }, table));
  // 5. Timeline
  const lanes = [...new Set(rows.map(r => r.workerId ?? '?'))].sort();
  const track = el('div', { class: 'shotgun-lanes', role: 'listbox', 'aria-label': 'Planned attempt timeline, −2000 to 0 ms before release. Use arrow keys to move the selected attempt.' },
    ...lanes.map(lane => el('div', { class: 'lane' }, el('span', { class: 'lane-label', text: lane === '?' ? 'Unassigned' : `Browser ${lane}` }),
      el('div', { class: 'lane-track' }, ...rows.filter(r => (r.workerId ?? '?') === lane).map(r => {
        const position = rows.indexOf(r), dot = el('button', { type: 'button', class: 'shot-dot', 'data-wing': r.wing, role: 'option', 'aria-selected': String(selectedShot === position),
          title: `Shot ${position + 1} · ${wingName(r.wing)} Court ${r.court} · ${r.offsetMs} ms · Browser ${r.workerId ?? '—'}`, style: `left:${Math.min(100, Math.max(0, (r.offsetMs + 2000) / 20))}%` }) as HTMLButtonElement;
        dot.disabled = disabled;
        dot.onclick = () => { selectedShot = position; renderShotgunEditor(host, ctx); host.querySelector<HTMLElement>(`[data-shot="${position}"]`)?.focus(); };
        dot.onkeydown = event => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowLeft' ? -1 : 1);
          selectedShot = position; writeRows(pairs => { pairs[position] = { ...pairs[position]!, offsetMs: pairs[position]!.offsetMs + step }; }); };
        return dot; })))));
  const density = el('div', { class: 'density', 'aria-label': 'Attempts per 250 ms' }, ...metrics.density.map(d => el('span', { style: `--n:${d.count}`, title: `${d.fromMs}…${d.toMs} ms: ${d.count}`, text: String(d.count || '') })));
  const risk: string[] = [];
  if (metrics.invalid.length) risk.push(`${metrics.invalid.length} offset${metrics.invalid.length === 1 ? ' is' : 's are'} outside −2000…0 and will not be accepted.`);
  if (metrics.closeGaps) risk.push(`${metrics.closeGaps} gap${metrics.closeGaps === 1 ? '' : 's'} below the ${ctx.meaningfulSpacingMs} ms meaningful-spacing reference: local dispatch may compress them.`);
  if (metrics.coincident.length) risk.push(`Simultaneous attempts: ${metrics.coincident.map(c => `${c.count} at ${c.offsetMs} ms`).join(', ')}.`);
  if (ctx.timing) risk.push(`Local timing for this exact schedule: ${ctx.timing.status}${ctx.timing.p95 !== null ? ` · p95 ${ctx.timing.p95} ms` : ''}${ctx.timing.outsideTolerance ? ` · ${ctx.timing.outsideTolerance} outside the ${SHOTGUN_MAX_TRIGGER_LATENESS_MS} ms bound (predicted missed deadlines)` : ''}.`);
  else risk.push('Local timing not measured for this exact schedule. Test This Plan (offline) measures trigger → local Chrome request initiation.');
  const timeline = el('section', { class: 'shotgun-card', id: 'shotgun-timeline' }, el('p', { class: 'eyebrow', text: 'Timeline relative to release' }),
    el('dl', { class: 'fact-grid compact-facts' }, ...([['Earliest', metrics.earliestMs === null ? '—' : `${metrics.earliestMs} ms`], ['Latest', metrics.latestMs === null ? '—' : `${metrics.latestMs} ms`], ['Smallest gap', metrics.minimumGapMs === null ? '—' : `${metrics.minimumGapMs} ms`], ['Browsers', String(lanes.filter(l => l !== '?').length)]] as const)
      .flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
    track, el('div', { class: 'timeline-axis' }, el('span', { text: '−2000 ms' }), el('span', { text: '−1000' }), el('span', { text: '0 · release' })), density,
    el('ul', { class: 'strategy-warnings' }, ...risk.map(text => el('li', { 'data-tone': /INVALID|outside|missed/.test(text) ? 'bad' : 'warn', text }))));
  host.replaceChildren(el('div', { class: 'shotgun-editor', id: 'shotgun-editor' }, suggested, presets, manual, tableCard, timeline));
}
function alertText(host: HTMLElement, error: unknown) {
  const text = error instanceof Error ? ({ PRESET_NAME_EXISTS: 'A preset with that name already exists.', PRESET_NAME_REQUIRED: 'Type a preset name first.' } as Record<string, string>)[error.message] ?? error.message : String(error);
  host.querySelector('#shotgun-presets')?.append(el('p', { class: 'warn-text', role: 'alert', text }));
}
