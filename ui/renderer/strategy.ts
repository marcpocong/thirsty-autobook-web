import type { Dashboard } from '../types.js';
import { compileSmartPlan, describeSmartPlan, resizeSmartFanOut, setSmartChildOffset, smartRange, smartSlotOffsets, SMART_WORKERS,
  type SmartDraft, type SmartSlot } from '../../src/precision-simple.js';
import {evaluatePrewarmFeasibility,type PrewarmFeasibilityResult} from '../../src/api-booking/prewarm-feasibility.js';
import { DEFAULT_STRATEGY_GOAL, draftFromSuggestion, enumeratePrimeWindows, isConflict, knownScheduleFromCells, presetAllocation, suggestPlan, validateGoal, windowEvidence, WINDOW_EVIDENCE_LABEL,
  type KnownSchedule, type ScoredWindow, type StrategyGoal, type StrategyHistoricalEvidence, type StrategyPreset, type SuggestedPlan, type SuggestionIntelligenceMode, type Window } from '../../src/strategy-engine.js';
import { describeChildTiming, fanOutTimingPlan, minimumMeaningfulSpacingMs } from '../../src/fanout-timing.js';
import { applyLiveAnchor, calibrateLiveAnchor, liveTimingSamples, type AnchoredTimingPlan, type LiveAnchorSource } from '../../src/live-anchor-calibration.js';
import { applyTimingDeskew, calibrateTimingDeskew } from '../../src/timing-deskew.js';
import { logicalTargetId, SHOTGUN_MEANINGFUL_SPACING_MS, type ShotgunSettings } from '../../src/shotgun.js';
import {PRECISION_MAX_FAN_OUT,PRECISION_MAX_SENDS} from '../../src/workers.js';
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
  timingCalibration?: { spacingSource: 'MACHINE_PROFILE' | 'FALLBACK'; anchorSource: LiveAnchorSource; groupShiftMs: number;
    matchingReleases: number; matchingSamples: number; evidenceStrength: 'NONE' | 'LIMITED' | 'USABLE' | 'STRONG'; generatedAt?: string;
    deskew?: { capMs:number; source:'LIVE_CALIBRATION'|'INSUFFICIENT_EVIDENCE'; corrections:Array<{workerId:'A'|'B'|'C'|'D'|'E'|'F'|'G';fanOutIndex:number;correctionMs:number;matchingReleases:number;evidenceStrength:'NONE'|'LIMITED'|'USABLE'|'STRONG'}> } };
  acceptedPhase3?: NonNullable<ReturnType<typeof compileSmartPlan>['phase3']>;
  shotgun?: ShotgunSettings & {version:1;counts:Record<string,number>;exactSchedule:Array<{logicalTargetId:string;shotIndex:number;configuredOffsetMs:number}>;
    capacity:{meaningfulSpacingMs:number;recommendedMaximum:number;warning:string|null;groupAnchorMs:number}};
  lineage?: EditableSuggestionLineage; intelligenceMode?: SuggestionIntelligenceMode;
  provenance?: { source: 'SMART_SUGGESTED' | 'EXISTING_SMART_PLAN' | 'OPERATOR_BUILT'; operatorModifications: number } }
export interface StrategyHost {
  state(): Dashboard | undefined;
  mainCourtOrder(): number[];
  draft(): SmartDraft;
  unready(): Set<string>;
  /** Replaces the Smart draft with the suggestion (switching the plan to Smart Precision) and keeps `meta` to save with it. */
  useSuggestion(draft: SmartDraft, meta: StrategyV2Meta): void;
  accepted(): SmartDraft | null;
  lineage(): EditableSuggestionLineage;
  edit(mutate: (draft: SmartDraft, lineage: EditableSuggestionLineage) => void): void;
  ensureMeta():void;
  meta():StrategyV2Meta|undefined;
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
let courtsOverridden = false;
const defaultShotgun=(targets:readonly SmartSlot[]):ShotgunSettings=>({enabled:true,budget:20,allocationMode:'EQUAL',
  selectedTargetIds:targets.map(logicalTargetId),windowStartMs:-1000,windowEndMs:0,timingMode:'DENSE_CORE',timingCapacityOverride:false,allowStandbyConsumption:false});
const hourLabel = (hour: number) => hour === 24 ? '12:00 MN' : `${hour % 12 || 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
const hourText = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
const sameWindow = (a: Window, b: Window) => a.court === b.court && a.start === b.start && a.durationHours === b.durationHours;
const windowText = (window: Window) => `Court ${window.court} · ${smartRange(window.start, window.durationHours)} (${window.durationHours} h)`;
const parseList = (value: string) => value.split(/[\s,>→]+/).map(Number).filter(Number.isFinite);

function recommendation(state: Dashboard | undefined) {
  const latest = state?.fanOut?.latest;
  const usable=latest?.compatible&&!latest.stale;
  return { width: usable ? latest.recommendedWidth : 1, profile: usable ? latest.profile : null, createdAt: usable ? latest.createdAt : null,
    reasons: latest?.reasons ?? [], notes: [...(latest?.notes ?? []),...(latest&&!usable?['Auto falls back to 1 because the newest profile is stale or incompatible.']:[])] };
}
const shotgunCapacity=(state:Dashboard|undefined,budget:number,groupAnchorMs=0)=>({meaningfulSpacingMs:Math.max(SHOTGUN_MEANINGFUL_SPACING_MS,
  minimumMeaningfulSpacingMs(recommendation(state).profile,Math.max(1,Math.min(PRECISION_MAX_FAN_OUT,budget))).spacingMs),
  recommendedBurstChildren:recommendation(state).width,groupAnchorMs});
const draftFeasibility=(state:Dashboard|undefined,phase3:ReturnType<typeof compileSmartPlan>['phase3']):PrewarmFeasibilityResult|null=>{
  if(!phase3)return null;const unavailable=host.unready(),available=new Set(SMART_WORKERS.filter(worker=>!unavailable.has(worker))),prior=state?.prewarmFeasibility;
  return evaluatePrewarmFeasibility({phase3,prepP95Ms:prior?.p95Source==='COMPATIBLE_MEASURED_HISTORY'?prior.preparationP95Ms:null,sampleCount:prior?.sampleCount??0,
    availableWorkers:available,globalConcurrency:Math.max(1,new Set(phase3.wave1.map(value=>value.workerId)).size)});
};
const feasibilityLines=(value:PrewarmFeasibilityResult|null):string[]=>value?[`Preparation feasibility: ${value.verdict.replaceAll('_',' ')}`,
  `Configured Wave 1 attempts: ${value.configuredWave1Attempts} · tasks ${value.preparationTaskCount} · tiers ${value.tiers} · worker groups ${value.groups}`,
  `Prewarm lead ${(value.prewarmLeadMs/1000).toFixed(1)} s · prep p95 ${(value.preparationP95Ms/1000).toFixed(1)} s · ${value.p95Source==='FALLBACK'?'fallback':`${value.sampleCount} compatible samples`}`,
  `Projected: READY ${value.projectedReady} · AT RISK ${value.projectedAtRisk} · OMITTED ${value.projectedOmitted}`,
  `Earliest preparation T${value.predictedPreparationStartMs>=0?'+':''}${(value.predictedPreparationStartMs/1000).toFixed(1)} s · freshness margin ${(value.freshnessMarginMs/1000).toFixed(1)} s`,
  `Assumptions: global ${value.concurrency.global} · per browser ${value.concurrency.perGroup} · tier barrier ${(value.concurrency.tierBarrierTimeoutMs/1000).toFixed(1)} s · first attempt succeeds at p95; retry remains runtime-only before T-${value.retryAssumption.retryCutoffLeadMs/1000} s`,
  ...value.attempts.filter(attempt=>attempt.verdict==='OMITTED').map(attempt=>`${attempt.logicalTargetId} · Worker ${attempt.workerId} shot ${attempt.tier+1} · ${attempt.reason}`)]:[];
function chosenWidth(state: Dashboard | undefined) {
  const choice = selectById('strategy-fanout').value, machine = recommendation(state);
  return choice === 'auto' ? { width: machine.width, source: machine.profile ? 'MACHINE_RECOMMENDED' as const : 'NO_PROFILE' as const }
    : { width: Number(choice), source: 'OPERATOR_OVERRIDE' as const };
}
function childOffsets(state: Dashboard | undefined) {
  const { width } = chosenWidth(state), timing = selectById('strategy-timing').value as 'TIGHT' | 'BALANCED' | 'WIDE';
  const machine = recommendation(state).profile?.machine;
  const machineKey = machine ? JSON.stringify({ cpuModel: machine.cpuModel, logicalCores: machine.logicalCores, totalMemGb: machine.totalMemGb,
    platform: machine.platform, osRelease: machine.osRelease }) : null;
  const calibration = calibrateLiveAnchor(liveTimingSamples(state?.telemetry ?? []), { dispatchMode: 'node', fanOutWidth: width, machineKey,
    runtimeKey: machine?.chromeVersion ?? null });
  const manual = selectById('strategy-anchor-mode').value === 'MANUAL';
  const early = Number(inputById('strategy-anchor-shift').value), shift = manual && Number.isSafeInteger(early) && early >= 0 ? -early : undefined;
  try { return applyLiveAnchor(fanOutTimingPlan(timing, width, recommendation(state).profile), calibration, shift); }
  catch { return applyLiveAnchor(fanOutTimingPlan(timing, width, recommendation(state).profile), calibration); }
}
function timingEvidence(state: Dashboard | undefined, anchored = childOffsets(state)) {
  const machine = recommendation(state).profile?.machine;
  const identity = { dispatchMode: 'node', fanOutWidth: anchored.width,
    machineKey: machine ? JSON.stringify({ cpuModel: machine.cpuModel, logicalCores: machine.logicalCores, totalMemGb: machine.totalMemGb, platform: machine.platform, osRelease: machine.osRelease }) : null,
    runtimeKey: machine?.chromeVersion ?? null };
  return calibrateTimingDeskew(liveTimingSamples(state?.telemetry ?? []), anchored.calibration, identity);
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
  selectById('strategy-fanout').replaceChildren(new Option('Machine recommendation','auto'),...Array.from({length:PRECISION_MAX_FAN_OUT},(_,index)=>new Option(`${index+1} attempt${index?'s':''} (override)`,String(index+1))));
  inputById('strategy-shotgun-budget').max=String(PRECISION_MAX_SENDS);
  for (const id of ['strategy-prime-from', 'strategy-prime-until', 'strategy-durations', 'strategy-courts'])
    byId(id).addEventListener('change', () => { goal = readGoal(); if(id==='strategy-courts')courtsOverridden=true; invalidate(); });
  byId('strategy-sync-courts').addEventListener('click',()=>{courtsOverridden=false;strategyMainCourtOrderChanged();});
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="strategy-preset"]'))
    radio.addEventListener('change', () => { if (radio.checked) { preset = radio.value as StrategyPreset; invalidate(); } });
  byId('strategy-fanout').addEventListener('change', invalidate);
  byId('strategy-timing').addEventListener('change', invalidate);
  byId('strategy-anchor-mode').addEventListener('change', () => { byId('strategy-anchor-shift-label').hidden = selectById('strategy-anchor-mode').value !== 'MANUAL'; invalidate(); });
  byId('strategy-anchor-shift').addEventListener('change', invalidate);
  for(const radio of document.querySelectorAll<HTMLInputElement>('input[name="strategy-intensity"]'))radio.addEventListener('change',()=>{
    if(!radio.checked)return;host.ensureMeta();host.edit(draft=>{if(radio.value==='SHOTGUN')draft.shotgun=draft.shotgun??defaultShotgun(draft.immediate);else delete draft.shotgun;});
});

  for(const id of ['strategy-shotgun-budget','strategy-shotgun-allocation','strategy-shotgun-start','strategy-shotgun-end','strategy-shotgun-timing','strategy-shotgun-timing-override','strategy-shotgun-standby-override','strategy-shotgun-custom-offsets'])
    byId(id).addEventListener('change',()=>host.edit(draft=>{const current=draft.shotgun??defaultShotgun(draft.immediate);draft.shotgun={...current,
      budget:Number(inputById('strategy-shotgun-budget').value),allocationMode:selectById('strategy-shotgun-allocation').value as ShotgunSettings['allocationMode'],
      windowStartMs:Number(inputById('strategy-shotgun-start').value),windowEndMs:Number(inputById('strategy-shotgun-end').value),
      timingMode:selectById('strategy-shotgun-timing').value as ShotgunSettings['timingMode'],
      customOffsetsMs:(byId('strategy-shotgun-custom-offsets') as HTMLTextAreaElement).value.split(',').map(value=>value.trim()).filter(Boolean).map(Number),
      timingCapacityOverride:(byId('strategy-shotgun-timing-override') as HTMLInputElement).checked,
      allowStandbyConsumption:(byId('strategy-shotgun-standby-override') as HTMLInputElement).checked};delete draft.shotgun.capacityOverride;}));
  byId('strategy-shotgun-preset').addEventListener('click',()=>host.edit(draft=>{draft.shotgun={...(draft.shotgun??defaultShotgun(draft.immediate)),enabled:true,budget:20,
    windowStartMs:-1000,windowEndMs:0,allocationMode:'EQUAL',timingMode:'DENSE_CORE',selectedTargetIds:draft.immediate.map(logicalTargetId)};}));
  byId('strategy-shotgun-focus').addEventListener('click',()=>host.edit(draft=>{
    const primary=draft.immediate[0];if(!primary)return;const current=draft.shotgun??defaultShotgun(draft.immediate),id=logicalTargetId(primary);
    draft.shotgun={...current,enabled:true,allocationMode:'CUSTOM',selectedTargetIds:[id],customCounts:{[id]:current.budget}};
  }));
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
    const calibration = timingEvidence(state, timing), base = draftFromSuggestion(suggestion, host.draft(), timing.children.map(child => child.configuredOffsetMs));
    // Worker assignment is deterministic (A..G) and the final literal values are copied into the
    // draft. From here through Review, Save and backend authorization there is nothing left to add.
    const shotgunOn=document.querySelector<HTMLInputElement>('input[name="strategy-intensity"]:checked')?.value==='SHOTGUN';
    const draft = { ...base, ...(shotgunOn?{shotgun:defaultShotgun(base.immediate)}:{}), immediate: base.immediate.map((slot, index) => {
      const workerId = String.fromCharCode(65 + index), plan = applyTimingDeskew(timing, calibration, workerId);
      const offsets = plan.children.map(child => child.finalConfiguredOffsetMs), next = { ...slot }; delete next.releaseOffsetMs; delete next.fanOutOffsetsMs;
      if (offsets.length > 1) next.fanOutOffsetsMs = offsets; else if (offsets[0] !== 0) next.releaseOffsetMs = offsets[0]; return next;
    }) };
    host.useSuggestion(draft, { version: 1, preset, goal: { ...goal }, lineage: suggestionLineage(draft), intelligenceMode,
      fanOut: { width: width.width, source: width.source, acceptedSource: width.source, recommendedWidth: machine.profile ? machine.width : null, timing: timing.preset,
        basedOnTiming: selectById('strategy-timing').value as 'TIGHT' | 'BALANCED' | 'WIDE', profileCreatedAt: machine.createdAt },
      timingCalibration: { spacingSource: machine.profile ? 'MACHINE_PROFILE' : 'FALLBACK', anchorSource: timing.anchorSource, groupShiftMs: timing.groupShiftMs,
        matchingReleases: timing.matchingReleases, matchingSamples: timing.matchingSamples, evidenceStrength: timing.calibration.evidenceStrength, generatedAt: timing.calibration.generatedAt,
        deskew:{capMs:calibration.capMs,source:calibration.corrections.some(value=>value.matchingReleases>=2)?'LIVE_CALIBRATION':'INSUFFICIENT_EVIDENCE',
          corrections:calibration.corrections.filter(value=>/^[A-G]$/.test(value.workerId)).map(value=>({workerId:value.workerId as 'A'|'B'|'C'|'D'|'E'|'F'|'G',fanOutIndex:value.fanOutIndex,
            correctionMs:value.correctionMs,matchingReleases:value.matchingReleases,evidenceStrength:value.evidenceStrength}))}},
      provenance: { source: 'SMART_SUGGESTED', operatorModifications: 0 } });
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
  if (width.source === 'OPERATOR_OVERRIDE') parts.push(el('span', 'warn-text', ` · Operator override: ${width.width} per target${width.width>machine.width?' exceeds the current machine recommendation; inspect readiness and local timing limits':''}`));
  const reasons = el('ul', 'strategy-children'); reasons.append(...machine.reasons.map(reason => el('li', '', reason)), ...machine.notes.map(text => el('li', 'warn-text', text)),
    el('li', '', 'A local dispatch measurement, not a prediction that more attempts win a booking.'));
  note.replaceChildren(...parts, reasons);
  const timing = childOffsets(state);
  const anchor = timing as AnchoredTimingPlan, calibration = anchor.calibration;
  const latest = calibration.latestSampleAt ? ` · latest ${calibration.latestSampleAt.slice(0, 10)}${calibration.stale ? ' · STALE' : ''}` : '';
  const shift = anchor.groupShiftMs < 0 ? `${-anchor.groupShiftMs} ms early` : anchor.groupShiftMs > 0 ? `${anchor.groupShiftMs} ms late` : 'no additional shift';
  const context = calibration.sampleCount ? `${calibration.sampleCount} samples · ${calibration.releaseCount} matching real release${calibration.releaseCount === 1 ? '' : 's'} · ${calibration.evidenceStrength}${latest}`
    : `No usable matching width-${timing.width} live calibration`;
  const otherWidthOne = calibrateLiveAnchor(liveTimingSamples(state?.telemetry ?? []), { dispatchMode: 'node', fanOutWidth: 1 });
  byId('strategy-anchor-note').replaceChildren(el('strong', '', 'Live anchor: '), document.createTextNode(`${shift} · ${anchor.anchorSource.replaceAll('_', ' ').toLowerCase()}`),
    el('p', 'small', context), ...(timing.width > 1 && !calibration.sampleCount && otherWidthOne.sampleCount ? [el('p', 'small', `${otherWidthOne.sampleCount} single-attempt timing samples are available, but they are not width-${timing.width} matching evidence.`)] : []));
  const deskew=timingEvidence(state,timing),workers=Array.from({length:Math.min(7,suggestion?.allocation.immediateTargets??0)},(_,index)=>String.fromCharCode(65+index));
  byId('strategy-timing-children').replaceChildren(...(timing.width > 1 ? timing.children.map(child => el('li', '', `Child ${child.fanOutIndex}: ${describeChildTiming(child)}`)) : []),
    ...workers.flatMap(worker=>applyTimingDeskew(timing,deskew,worker).children.filter(child=>child.correctionMs!==0).map(child=>el('li','',
      `${worker}${child.fanOutIndex}: base ${child.baseConfiguredOffsetMs} ms + local de-skew ${child.correctionMs} ms = final ${child.finalConfiguredOffsetMs} ms · ${child.evidenceStrength}`))),
    ...timing.warnings.map(warning => el('li', 'warn-text', warning)), el('li', 'small', `Fan-out spacing ${timing.spacingMs} ms · ${timing.basis}`));
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
  const current = selectById('strategy-fanout').value; selectById('strategy-fanout').value = String(width);
  const offsets = childOffsets(state).children.map(child => child.configuredOffsetMs); selectById('strategy-fanout').value = current;
  return offsets;
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
    fields.append(editorSelect(`strategy-immediate-width-${index}`, 'Fan-out', Array.from({length:PRECISION_MAX_FAN_OUT},(_,index)=>index+1).map(value => [`${value} child${value === 1 ? '' : 'ren'}`, String(value)]), String(offsets.length), value => {
      const width = Number(value), defaults = resizeDefaults(state, width); host.edit(draft => { draft.immediate[index] = resizeSmartFanOut(draft.immediate[index]!, width, defaults); });
    }));
    const worker = el('span', 'strategy-worker', `Worker ${letter} · automatically assigned`); fields.append(worker);
    const timing = el('div', 'strategy-child-timing'); timing.append(el('strong', '', 'Timing'));
    offsets.forEach((offset, child) => {
      const label = el('label'), input = document.createElement('input'); input.type = 'text'; input.inputMode = 'numeric';
      input.id = `strategy-immediate-offset-${index}-${child}`; input.value = String(-offset);
      const commit=()=>{const early=input.value.trim()===''?Number.NaN:Number(input.value),next=Number.isSafeInteger(early)&&early>=0&&early<=2000?-early:Number.NaN;
        if(!Number.isFinite(next)){input.setCustomValidity('Enter a whole number from 0 to 2000.');input.reportValidity();return;}input.setCustomValidity('');
        if(next!==offset)host.edit(draft => { draft.immediate[index] = inputTiming(draft.immediate[index]!, child, next); });};
      input.addEventListener('input',()=>input.setCustomValidity(''));input.addEventListener('blur',commit);input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();input.blur();}});
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
  if(document.activeElement instanceof HTMLInputElement&&document.activeElement.id.startsWith('strategy-immediate-offset-'))return;
  const draft = host.draft(), accepted = host.accepted(), compiled = compileSmartPlan(draft, { targetDate: state?.booking?.targetDate ?? '', unavailable: host.unready(),shotgunCapacity:shotgunCapacity(state,draft.shotgun?.budget??1,host.meta()?.timingCalibration?.groupShiftMs??0) });
  const lineage = host.lineage(), modifications = strategyModificationCount(draft, accepted, lineage);
  byId('strategy-edit-provenance').textContent = accepted ? `Source: Smart generated · Operator modifications: ${modifications}` : 'Source: Existing Smart plan';
  (byId('strategy-reset-all') as HTMLButtonElement).disabled = !accepted || modifications === 0;
  byId('strategy-edit-immediate').replaceChildren(...draft.immediate.map((slot, index) => editableRow('immediate', slot, index, state, compiled, accepted)));
  byId('strategy-edit-backups').replaceChildren(...draft.backups.map((slot, index) => editableRow('backups', slot, index, state, compiled, accepted)));
  const baselineStarts = accepted ? new Set(accepted.immediate.map(slot => slot.start)).size : 0, currentStarts = new Set(draft.immediate.map(slot => slot.start)).size;
  byId('strategy-edit-warnings').replaceChildren(...(baselineStarts > currentStarts ? [el('li', '', `This change reduces start-time diversification from ${baselineStarts} unique starts to ${currentStarts}.`)] : []));
}

function renderShotgun(state:Dashboard|undefined){
  const draft=host.draft(),settings=draft.shotgun;
  for(const radio of document.querySelectorAll<HTMLInputElement>('input[name="strategy-intensity"]'))radio.checked=radio.value===(settings?.enabled?'SHOTGUN':'NORMAL');
  byId('strategy-shotgun').hidden=!settings?.enabled;
  byId('strategy-normal-settings').hidden=!!settings?.enabled;
  if(!settings?.enabled)return;
  inputById('strategy-shotgun-budget').value=String(settings.budget);selectById('strategy-shotgun-allocation').value=settings.allocationMode;
  inputById('strategy-shotgun-start').value=String(settings.windowStartMs);inputById('strategy-shotgun-end').value=String(settings.windowEndMs);
  selectById('strategy-shotgun-timing').value=settings.timingMode;
  (byId('strategy-shotgun-timing-override') as HTMLInputElement).checked=!!(settings.timingCapacityOverride??settings.capacityOverride);
  (byId('strategy-shotgun-standby-override') as HTMLInputElement).checked=!!settings.allowStandbyConsumption;
  if(settings.timingMode==='CUSTOM')byId('strategy-shotgun-advanced').setAttribute('open','');
  const customInput=byId('strategy-shotgun-custom-offsets') as HTMLTextAreaElement;if(document.activeElement!==customInput)customInput.value=(settings.customOffsetsMs??[]).map(value=>value>=0?`+${value}`:String(value)).join(', ');
  const targets=byId('strategy-shotgun-targets');targets.replaceChildren(...draft.immediate.map((slot,index)=>{
    const id=logicalTargetId(slot),label=el('label','strategy-shotgun-target'),check=document.createElement('input');check.type='checkbox';check.checked=settings.selectedTargetIds.includes(id);
    check.addEventListener('change',()=>host.edit(next=>{const current=next.shotgun!;current.selectedTargetIds=check.checked?[...new Set([...current.selectedTargetIds,id])]:current.selectedTargetIds.filter(value=>value!==id);}));
    label.append(check,document.createTextNode(` Court ${slot.court} · ${smartRange(slot.start,slot.durationHours)} · ${slot.durationHours} h · priority ${slot.priority??index+1}`));
    if(settings.allocationMode==='CUSTOM'){const count=document.createElement('input');count.type='number';count.min='0';count.step='1';count.value=String(settings.customCounts?.[id]??0);
      count.setAttribute('aria-label',`Custom shots for Court ${slot.court}`);count.addEventListener('change',()=>host.edit(next=>{const current=next.shotgun!;current.customCounts={...(current.customCounts??{}),[id]:Number(count.value)};}));label.append(count);}
    return label;
  }));
  const compiled=compileSmartPlan(draft,{targetDate:state?.booking?.targetDate??'',unavailable:host.unready(),shotgunCapacity:shotgunCapacity(state,settings.budget,host.meta()?.timingCalibration?.groupShiftMs??0)}),plan=compiled.shotgun;
  const feasibility=draftFeasibility(state,compiled.phase3);
  const groupCount=Object.values(plan?.counts??{}).reduce((sum,count)=>sum+Math.ceil(count/6),0),ordered=[...(plan?.shots??[])].sort((a,b)=>a.configuredOffsetMs-b.configuredOffsetMs||a.logicalTargetId.localeCompare(b.logicalTargetId));
  const labels=new Map(draft.immediate.map(slot=>[logicalTargetId(slot),`Court ${slot.court} · ${smartRange(slot.start,slot.durationHours)}`]));
  const primary=ordered[0]&&labels.get(ordered[0].logicalTargetId),first=ordered[0]?.configuredOffsetMs??settings.windowStartMs,last=ordered.at(-1)?.configuredOffsetMs??settings.windowEndMs;
  const readiness=feasibility?`${feasibility.projectedReady}/${feasibility.configuredWave1Attempts} can be prepared`:'Preparation forecast pending';
  const facts=[['Target',primary??'Choose a target'],['Attempts',String(ordered.length||settings.budget)],['Timing',settings.timingMode==='DENSE_CORE'?'Pre-release Dense Core':settings.timingMode.replaceAll('_',' ')],['First attempt',`${first} ms`],['Last attempt',`${last>=0?'+':''}${last} ms`],['Browsers required',String(groupCount||'—')],['Preparation status',readiness]];
  const preview=byId('strategy-shotgun-preview');preview.replaceChildren(...facts.map(([label,value])=>{const row=el('div','dense-fact');row.append(el('span','',label),el('strong','',value));return row;}));
  if(plan?.capacityWarning){const risk=el('div','plain-warning');risk.append(el('strong','','⚠ AGGRESSIVE TIMING'),el('p','',`Some attempts are closer together than this PC has demonstrated. The exact schedule will not be changed.`),el('small','',`Machine timing reference: ${plan.meaningfulSpacingMs} ms · acknowledge under Advanced Shotgun settings.`));preview.append(risk);}
  for(const problem of compiled.problems)preview.append(el('p','warn-text',`✕ BLOCKED · ${problem}`));
  const track=byId('strategy-shotgun-timeline'),range=Math.max(1,last-first);track.replaceChildren(...ordered.map((shot,index)=>{const dot=el('span','shotgun-dot');dot.style.left=`${Math.max(0,Math.min(100,(shot.configuredOffsetMs-first)/range*100))}%`;dot.title=`Attempt ${index+1}: ${shot.configuredOffsetMs} ms`;return dot;}));
  byId('strategy-shotgun-first').textContent=`${first} ms`;
  byId('strategy-shotgun-exact-list').replaceChildren(...ordered.map((shot,index)=>el('span','',`#${index+1} · ${shot.configuredOffsetMs>=0?'+':''}${shot.configuredOffsetMs} ms · ${labels.get(shot.logicalTargetId)??shot.logicalTargetId}`)));
}

function renderReview(state: Dashboard | undefined) {
  const draft = host.draft(), compiled = compileSmartPlan(draft, { targetDate: state?.booking?.targetDate ?? '', unavailable: host.unready(),shotgunCapacity:shotgunCapacity(state,draft.shotgun?.budget??1,host.meta()?.timingCalibration?.groupShiftMs??0) });
  const smart = state?.booking && (document.getElementById('precision-strategy') as HTMLSelectElement | null)?.value === 'precision' && (document.getElementById('precision-mode-smart') as HTMLInputElement | null)?.checked;
  const feasibility=draftFeasibility(state,compiled.phase3);
  const warnings = [...draft.immediate, ...draft.backups].filter(slot => slot.publicEvidence?.override).map(slot =>
    `${windowText(slot)} was force-included despite ${slot.publicEvidence!.evidence === 'UNKNOWN_PUBLIC_QUERY_FAILED' ? 'a failed public-booking read' : 'a known public booking'} (OPERATOR_OVERRIDE_PUBLIC_CONFLICT).`);
  const plainProblem=(text:string)=>/meaningful-spacing|spacing reaches/i.test(text)
    ? 'Aggressive Dense Core timing needs your acknowledgement. The exact schedule will not be changed; review the machine timing reference under Advanced Shotgun settings.'
    : /standby consumption/i.test(text)?'This Dense Core plan needs more initial browsers than are currently available without reducing backup capacity. Review the standby choice under Advanced Shotgun settings.':text;
  byId('strategy-review-warnings').replaceChildren(...[...warnings, ...compiled.problems].map(text => el('li', '', plainProblem(text))));
  const body = byId('strategy-review-body'),technical=byId('strategy-review-technical');
  if (!smart) { body.replaceChildren(empty('The current plan is not a Smart plan. Use a suggestion, or edit under Advanced overrides.'));technical.replaceChildren(); return; }
  if (!compiled.phase3) { body.replaceChildren(empty('Fix the problems above to see what will happen.'));technical.replaceChildren(); return; }
  const description = describeSmartPlan(compiled.phase3, { unavailable: host.unready() });
  const shotgun=compiled.shotgun,shotgunReview=shotgun&&draft.shotgun?[el('h4','','Shotgun'),
    el('p','small',`Enabled · budget ${draft.shotgun.budget} · ${draft.shotgun.allocationMode.replaceAll('_',' ').toLowerCase()} · window ${draft.shotgun.windowStartMs>=0?'+':''}${draft.shotgun.windowStartMs} ms → ${draft.shotgun.windowEndMs>=0?'+':''}${draft.shotgun.windowEndMs} ms · ${draft.shotgun.timingMode.replaceAll('_',' ').toLowerCase()} · group anchor ${shotgun.groupAnchorMs>=0?'+':''}${shotgun.groupAnchorMs} ms (${host.meta()?.timingCalibration?.anchorSource??'no fresh anchor evidence'})`),
    el('p','small','Shotgun never sends after release. Configured offsets are browser-local authorization; provider receipt and arbitration order remain unknown.'),
    ...Object.entries(shotgun.counts).map(([id,count])=>el('p','small',`${id} → ${count} Shotgun attempt${count===1?'':'s'}`)),
    ...shotgun.shots.map(shot=>el('p','small',`${shot.logicalTargetId} · shot ${shot.shotIndex+1}/${shot.shotCount} · FINAL SAVED TRIGGER ${shot.configuredOffsetMs>=0?'+':''}${shot.configuredOffsetMs} ms`)),
    el('p',(draft.shotgun.timingCapacityOverride??draft.shotgun.capacityOverride)||draft.shotgun.allowStandbyConsumption?'warn-text':'small',`Timing capacity override: ${(draft.shotgun.timingCapacityOverride??draft.shotgun.capacityOverride)?'ACTIVE':'off'} · Standby consumption: ${draft.shotgun.allowStandbyConsumption?'ACTIVE':'protected'}`),
    el('p',shotgun.capacityWarning?'warn-text':'small',shotgun.capacityWarning??`Capacity: ${shotgun.meaningfulSpacingMs} ms meaningful spacing · recommended maximum ~${shotgun.recommendedMaximum}.`),
    ...(shotgun.coincidentWarning?[el('p','warn-text',shotgun.coincidentWarning)]:[]),...feasibilityLines(feasibility).map(line=>el('p',feasibility?.verdict==='READY'?'small':'warn-text',line))] : [el('h4','','Shotgun'),el('p','small','Disabled · Normal machine-recommended fan-out applies.'),...feasibilityLines(feasibility).map(line=>el('p',feasibility?.verdict==='READY'?'small':'warn-text',line))];
  const saved=state?.booking?.setup,savedMeta=saved?.STRATEGY_V2?.timingCalibration;
  const decomposition=saved?.PRECISION_PHASE3===compiled.phase3||JSON.stringify(saved?.PRECISION_PHASE3)===JSON.stringify(compiled.phase3)
    ? compiled.phase3.wave1.flatMap(assignment=>(assignment.fanOutOffsetsMs??[assignment.releaseOffsetMs??0]).map((final,index)=>{
      const correction=savedMeta?.deskew?.corrections.find(value=>value.workerId===assignment.workerId&&value.fanOutIndex===index)?.correctionMs??0;
      return el('p','small',`${assignment.workerId}${(assignment.fanOutOffsetsMs?.length??1)>1?index:''} · base + group anchor ${final-correction} ms · worker/index correction ${correction>=0?'+':''}${correction} ms · FINAL SAVED TRIGGER ${final} ms`);
    })):[];
  const primary=draft.immediate[0],attempts=shotgun?.shots.length??compiled.phase3.wave1.reduce((sum,value)=>sum+(value.fanOutOffsetsMs?.length??1),0);
  const range=shotgun?.shots.length?`${shotgun.shots[0]!.configuredOffsetMs} ms → ${shotgun.shots.at(-1)!.configuredOffsetMs} ms`:'Measured release timing';
  const checklist=[['Target valid',compiled.problems.length===0],['Rates confirmed',!compiled.problems.some(value=>/rate/i.test(value))],[`${attempts} attempts authorized`,attempts>0],[`${feasibility?.projectedReady??attempts} attempts can be prepared`,!feasibility||feasibility.projectedOmitted===0],['No positive offsets',!shotgun||shotgun.shots.every(value=>value.configuredOffsetMs<=0)]];
  body.replaceChildren(el('h4','','Primary target'),el('p','',primary?`Court ${primary.court} · ${smartRange(primary.start,primary.durationHours)}`:'No target'),el('h4','','Release'),el('p','',shotgun?`${attempts} Dense Core attempts · ${range} · nothing will be sent after release.`:`${attempts} normal measured attempts.`),el('h4','','Browsers'),el('p','',`${new Set(compiled.phase3.wave1.map(value=>value.workerId)).size} browser groups · ${feasibility?`${feasibility.projectedReady}/${feasibility.configuredWave1Attempts} attempts projected ready`:'preparation checked before arming'}`),el('h4','','Backup attempts'),el('p','',`Up to ${compiled.budgets.wave2} fresh backup attempts · reopened-slot rescue ${compiled.phase3.rescueEnabled?'ON':'OFF'}.`),el('h4','','Payment'),el('p','','The bot stops at QR. Payment remains manual.'),...checklist.map(([label,ok])=>el('p',ok?'check-ok':'warn-text',`${ok?'✓ READY':'✕ BLOCKED'} · ${label}`)));
  technical.replaceChildren(...shotgunReview,...description.sections.flatMap(section => [el('h4', '', section.title), ...section.lines.map(line => el('p', 'small', line))]),
    ...(decomposition.length?[el('h4','','Saved timing decomposition'),...decomposition]:[]),
    el('p', '', `${description.summary} · Maximum possible sends: ${description.maxSends}`));
}

/** Called on every status update. Loads the saved goal/preset once per saved plan. */
export function renderStrategy(state: Dashboard | undefined): void {
  if (!host) return;
  const saved = state?.booking?.setup.STRATEGY_V2, key = `${state?.booking?.targetDate ?? ''}|${saved ? JSON.stringify(saved) : ''}`;
  if (key !== loadedKey) {
    suggestionGeneration++; pendingSuggestionGeneration = null; suggestion = null; byId('strategy-apply').toggleAttribute('disabled', true);
    loadedKey = key;
    if (saved) { goal = { ...saved.goal }; courtsOverridden=JSON.stringify(saved.goal.courts)!==JSON.stringify(host.mainCourtOrder());preset = saved.preset; selectById('strategy-fanout').value = saved.fanOut.source === 'OPERATOR_OVERRIDE' ? String(saved.fanOut.width) : 'auto';
      intelligenceMode = saved.intelligenceMode ?? 'AUTO'; selectById('strategy-intelligence').value = intelligenceMode;
      if (saved.fanOut.timing !== 'CUSTOM') selectById('strategy-timing').value = saved.fanOut.timing;
      else if (saved.fanOut.basedOnTiming) selectById('strategy-timing').value = saved.fanOut.basedOnTiming;
      selectById('strategy-anchor-mode').value = saved.timingCalibration?.anchorSource === 'OPERATOR_OVERRIDE' ? 'MANUAL' : 'AUTO';
      inputById('strategy-anchor-shift').value = String(Math.max(0, -(saved.timingCalibration?.groupShiftMs ?? 0)));
      byId('strategy-anchor-shift-label').hidden = selectById('strategy-anchor-mode').value !== 'MANUAL'; }
    else {courtsOverridden=false;goal = { ...goal, courts: host.mainCourtOrder() };}
    writeGoal(goal);
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="strategy-preset"]')) radio.checked = radio.value === preset;
  }
  strategyMainCourtOrderChanged();
  byId('strategy-target-date').textContent = state?.booking?.targetDate ?? '—';
  byId('strategy-goal-problems').textContent = validateGoal(goal).join(' ');
  (byId('strategy-suggest') as HTMLButtonElement).disabled = preset === 'CUSTOM' || validateGoal(goal).length > 0;
  render();
}
export function strategyMainCourtOrderChanged():void {
  if(!host||courtsOverridden)return;
  const courts=host.mainCourtOrder();if(JSON.stringify(goal.courts)===JSON.stringify(courts))return;
  goal={...goal,courts:[...courts]};writeGoal(goal);invalidate();
}
function render() {
  const state = host.state();
  (byId('strategy-suggest') as HTMLButtonElement).disabled = preset === 'CUSTOM' || validateGoal(goal).length > 0;
  renderSchedule(state); renderPreset(state); renderSuggestion(state); renderEditable(state); renderShotgun(state); renderReview(state);
}
/** Exposed for tests and the Next Release summary. */
export const strategySnapshot = () => ({ goal: { ...goal }, preset, forced: [...forced], suggestion, suggestionGeneration, pendingSuggestionGeneration });
export const conflictsIn = (plan: SuggestedPlan) => plan.immediate.filter(window => isConflict(window.evidence));
