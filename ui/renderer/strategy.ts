import { fitNormalAttemptLimits } from '../../src/normal-strategy.js';
import {primaryShotgunTarget,fitQuickShotgun,shotgunSettingsKey,forecastPreparation,configurationFingerprint} from '../../src/quick-shotgun.js';
import type { Dashboard } from '../types.js';
import { compileSmartPlan, describeSmartPlan, resizeSmartFanOut, setSmartChildOffset, smartRange, smartSlotOffsets, SMART_WORKERS, SMART_MAX_SLOTS,
  type SmartDraft, type SmartSlot } from '../../src/precision-simple.js';
import {type PrewarmFeasibilityResult} from '../../src/api-booking/prewarm-feasibility.js';
import { rankTargetPlan, buildExecutionStrategy, normalizeStrategyGoal, DEFAULT_STRATEGY_GOAL, draftFromSuggestion, enumeratePrimeWindows, isConflict, knownScheduleFromCells, presetAllocation, validateGoal, windowEvidence, WINDOW_EVIDENCE_LABEL,
  type KnownSchedule, type ScoredWindow, type StrategyGoal, type StrategyHistoricalEvidence, type StrategyPreset, type SuggestedPlan, type SuggestionIntelligenceMode, type Window } from '../../src/strategy-engine.js';
import { describeChildTiming, fanOutTimingPlan, minimumMeaningfulSpacingMs } from '../../src/fanout-timing.js';
import { applyLiveAnchor, calibrateLiveAnchor, liveTimingSamples, type AnchoredTimingPlan, type LiveAnchorSource } from '../../src/live-anchor-calibration.js';
import { applyTimingDeskew, calibrateTimingDeskew } from '../../src/timing-deskew.js';
import { logicalTargetId, SHOTGUN_MEANINGFUL_SPACING_MS, type ShotgunSettings } from '../../src/shotgun.js';
import {PRECISION_MAX_FAN_OUT,PRECISION_MAX_SENDS} from '../../src/workers.js';
import { acknowledgementKind, offsetText, preparationText } from './operator-status.js';
import { byId, el, empty, inputById, selectById } from './dom.js';

/**
 * STRATEGY: Booking Goal → Target Plan → Release Mode → Save → Next Release.
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
export interface StrategyV2Meta { targetPlan?: {ranked:Window[];date?:string;historyLabel?:string;publicWarning?:string}; version: 1; preset: StrategyPreset; goal: StrategyGoal;
  fanOut: { width: number; source: 'MACHINE_RECOMMENDED' | 'OPERATOR_OVERRIDE' | 'NO_PROFILE'; acceptedSource?: 'MACHINE_RECOMMENDED' | 'OPERATOR_OVERRIDE' | 'NO_PROFILE'; recommendedWidth: number | null; timing: 'TIGHT' | 'BALANCED' | 'WIDE' | 'CUSTOM';
    basedOnTiming?: 'TIGHT' | 'BALANCED' | 'WIDE'; profileCreatedAt: string | null };
  timingCalibration?: { spacingSource: 'MACHINE_PROFILE' | 'FALLBACK'; anchorSource: LiveAnchorSource; groupShiftMs: number;
    matchingReleases: number; matchingSamples: number; evidenceStrength: 'NONE' | 'LIMITED' | 'USABLE' | 'STRONG'; generatedAt?: string;
    deskew?: { capMs:number; source:'LIVE_CALIBRATION'|'INSUFFICIENT_EVIDENCE'; corrections:Array<{workerId:'A'|'B'|'C'|'D'|'E'|'F'|'G';fanOutIndex:number;correctionMs:number;matchingReleases:number;evidenceStrength:'NONE'|'LIMITED'|'USABLE'|'STRONG'}> } };
  quickShotgun?: {version:1;settingsKey:string;normalized?:Array<'total'|'wave2'|'rescue'|'standby'>};
  acceptedPhase3?: NonNullable<ReturnType<typeof compileSmartPlan>['phase3']>;
  shotgun?: ShotgunSettings & {version:1;counts:Record<string,number>;exactSchedule:Array<{logicalTargetId:string;shotIndex:number;configuredOffsetMs:number}>;
    capacity:{meaningfulSpacingMs:number;recommendedMaximum:number;warning:string|null;groupAnchorMs:number}};
  lineage?: EditableSuggestionLineage; intelligenceMode?: SuggestionIntelligenceMode;
  publicScheduleMode?: 'CHECK' | 'CACHED_ONLY';
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
  addTarget(slot: SmartSlot, kind: 'immediate' | 'backups'): void;
  meta():StrategyV2Meta|undefined;
  resetAll(): void;
  save(): Promise<boolean>;
  activateSmart(): void;
  nextRelease(): void;
}

let host: StrategyHost;
let goal: StrategyGoal = { ...DEFAULT_STRATEGY_GOAL };
let preset: StrategyPreset = 'BALANCED';
let forced: Window[] = [], removed: Window[] = [];
let suggestion: SuggestedPlan | null = null;
let suggestionGeneration = 0;
let pendingSuggestionGeneration: number | null = null;
let intelligenceMode: SuggestionIntelligenceMode = 'AUTO';
let publicScheduleMode: 'CHECK' | 'CACHED_ONLY' = 'CHECK';
let loadedKey = '';
let scheduleCheckingDate:string|null=null;
let scheduleCheckError='';
let publicPlanWarning='';
let historyPlanLabel='Historical evidence insufficient · preference ranking used';
let normalError='';
let courtsOverridden = false;
let priorityProposal = false;
let savedDraftKey = '';
let savedGoalKey='';
export function strategySaveSnapshot():string{return JSON.stringify(host.draft());}
const goalSettingsKey=()=>JSON.stringify({goal,publicScheduleMode});
export function strategySaved(key:string):void{savedDraftKey=key;savedGoalKey=goalSettingsKey();}
const focusControl=(id:string)=>{const node=byId(id);for(let parent:HTMLElement|null=node.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;if(!node.matches('input,select,button,textarea,a'))node.tabIndex=-1;node.scrollIntoView({block:'center',behavior:'smooth'});node.focus();};
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
  return phase3?forecastPreparation(phase3,host.unready(),state?.prewarmFeasibility):null;
};
function quickShotgunFit(state:Dashboard|undefined,draft:SmartDraft){
  return fitQuickShotgun(draft,budget=>({targetDate:state?.booking?.targetDate??'',unavailable:host.unready(),
    shotgunCapacity:shotgunCapacity(state,budget,host.meta()?.timingCalibration?.groupShiftMs??0)}),phase3=>draftFeasibility(state,phase3));
}
let quickProof: {draft:string;dependencies:string}|null=null;
let rememberedShotgun:ShotgunSettings|undefined;
let quickBusy=false,quickError='',quickChoice=false;
const quickSettingsKey=()=>shotgunSettingsKey(host.draft().shotgun);
const quickEnvironment=()=>{const state=host.state(),prior=state?.prewarmFeasibility;return configurationFingerprint({
  goal,date:state?.booking?.targetDate,unavailable:[...host.unready()].sort(),browserHealth:state?.browserHealth,cdp:state?.cdp,
  history:{p95Source:prior?.p95Source,p95Ms:prior?.preparationP95Ms,samples:prior?.sampleCount},fanOut:state?.fanOut,
  calibration:host.meta()?.timingCalibration});};
const quickDependencies=()=>configurationFingerprint({draft:{...host.draft(),shotgun:undefined},environment:quickEnvironment(),
  ready:host.state()?.ready,apiFirstReady:host.state()?.apiFirstReady});
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
  return { idealStart: selectById('strategy-ideal-start').value, primeFrom: selectById('strategy-prime-from').value, primeUntil: selectById('strategy-prime-until').value,
    durations: parseList(inputById('strategy-durations').value), courts: parseList(inputById('strategy-courts').value) };
}
function writeGoal(value: StrategyGoal) {
  selectById('strategy-ideal-start').value = normalizeStrategyGoal(value).idealStart!;
  selectById('strategy-prime-from').value = value.primeFrom; selectById('strategy-prime-until').value = value.primeUntil;
  inputById('strategy-durations').value = value.durations.join(','); inputById('strategy-courts').value = value.courts.join(',');
}
function invalidate() { suggestionGeneration++; pendingSuggestionGeneration = null; suggestion = null; byId('strategy-apply').toggleAttribute('disabled', true); render(); }

export function initStrategy(value: StrategyHost): void {
  host = value;
  // One secondary expert area; the normal workflow never exposes compiled internals.
  const advanced=byId('strategy-advanced');
  for(const id of ['strategy-normal-settings','strategy-shotgun-advanced','strategy-sync-courts','strategy-edit-targets','strategy-normal-auto-limits'])advanced.append(byId(id));
  advanced.append(byId('strategy-public-data').closest('label')!,byId('strategy-review-technical').closest('details')!,byId('strategy-gate'),byId('strategy-current-plan'));
  const replace=el('button','secondary','REPLACE WITH QUICK SHOTGUN');replace.id='strategy-replace-quick';replace.type='button';advanced.append(replace);replace.addEventListener('click',()=>byId('strategy-shotgun-quick-ready').click());
  const overrides=el('div');overrides.id='strategy-evidence-overrides';advanced.append(overrides);
  selectById('strategy-ideal-start').replaceChildren(...Array.from({length:16},(_,i)=>new Option(hourLabel(i+8),hourText(i+8))));
  byId('strategy-normal-next').addEventListener('click',()=>host.nextRelease());
  byId('strategy-public-data').addEventListener('change',()=>{
    publicScheduleMode=selectById('strategy-public-data').value as typeof publicScheduleMode;
    host.ensureMeta();host.meta()!.publicScheduleMode=publicScheduleMode;host.edit(()=>{});invalidate();
  });
  byId('strategy-normal-auto-limits').addEventListener('click',()=>{
    normalError='';host.edit(draft=>{delete draft.advanced.wave2;delete draft.advanced.rescue;delete draft.advanced.total;});
  });
  byId('strategy-normal-save').addEventListener('click',()=>{void(async()=>{
    try {normalError='';const fit=fitNormalAttemptLimits(host.draft(),{targetDate:host.state()?.booking?.targetDate??'',unavailable:host.unready()});
      if(!fit.compiled.phase3||fit.compiled.problems.length){normalError=fit.compiled.problems[0]??'Review your targets before saving.';return;}
      if(fit.normalized.length)host.edit(draft=>{draft.advanced=fit.draft.advanced;});
      host.activateSmart();if(!await host.save())normalError='Could not save. Review Advanced strategy settings for the blocker.';}
    catch {normalError='Could not save. Try again.';}render();
  })();});
  selectById('strategy-prime-from').replaceChildren(...Array.from({ length: 16 }, (_, index) => { const option = el('option', '', hourLabel(index + 8)); option.value = hourText(index + 8); return option; }));
  selectById('strategy-prime-until').replaceChildren(...Array.from({ length: 16 }, (_, index) => { const hour = index + 9, option = el('option', '', hour === 24 ? 'Midnight' : hourLabel(hour));
    option.value = hour === 24 ? '24:00' : hourText(hour); return option; }));
  writeGoal(goal);
  selectById('strategy-fanout').replaceChildren(new Option('Machine recommendation','auto'),...Array.from({length:PRECISION_MAX_FAN_OUT},(_,index)=>new Option(`${index+1} attempt${index?'s':''} (override)`,String(index+1))));
  inputById('strategy-shotgun-budget').max=String(PRECISION_MAX_SENDS);
  for (const id of ['strategy-ideal-start', 'strategy-prime-from', 'strategy-prime-until', 'strategy-durations', 'strategy-courts'])
    byId(id).addEventListener('change', () => { goal = readGoal(); if(id==='strategy-courts')courtsOverridden=true; host.ensureMeta();host.meta()!.goal=structuredClone(goal);host.edit(()=>{}); invalidate(); });
  byId('strategy-sync-courts').addEventListener('click',()=>{courtsOverridden=false;strategyMainCourtOrderChanged();});
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="strategy-preset"]'))
    radio.addEventListener('change', () => { if (radio.checked) { preset = radio.value as StrategyPreset; invalidate(); } });
  byId('strategy-fanout').addEventListener('change', invalidate);
  byId('strategy-timing').addEventListener('change', invalidate);
  byId('strategy-anchor-mode').addEventListener('change', () => { byId('strategy-anchor-shift-label').hidden = selectById('strategy-anchor-mode').value !== 'MANUAL'; invalidate(); });
  byId('strategy-anchor-shift').addEventListener('change', invalidate);
  for(const radio of document.querySelectorAll<HTMLInputElement>('input[name="strategy-intensity"]'))radio.addEventListener('change',()=>{
    if(!radio.checked)return;
    quickChoice=radio.value==='SHOTGUN'&&!rememberedShotgun&&!host.draft().shotgun;savedDraftKey='';quickProof=null;host.ensureMeta();
    host.edit((draft,lineage)=>{
      if(radio.value==='SHOTGUN')draft.shotgun=draft.shotgun??(rememberedShotgun?structuredClone(rememberedShotgun):defaultShotgun(draft.immediate));
      else {
        rememberedShotgun=draft.shotgun?structuredClone(draft.shotgun):undefined;
        const accepted=host.accepted(),currentTargets=new Set([...draft.immediate,...draft.backups].map(logicalTargetId));
        // Normal restores the accepted portfolio after Quick concentration only when every original
        // target still exists. Manual target changes never trigger a hidden reset.
        if(host.meta()?.quickShotgun && accepted && new Set([...accepted.immediate,...accepted.backups].map(logicalTargetId)).size===currentTargets.size && [...accepted.immediate,...accepted.backups].every(slot=>currentTargets.has(logicalTargetId(slot)))) {
          draft.immediate=structuredClone(accepted.immediate);draft.backups=structuredClone(accepted.backups);draft.advanced=structuredClone(accepted.advanced);
          const restored=suggestionLineage(draft);lineage.immediate=restored.immediate;lineage.backups=restored.backups;
        }
        delete draft.shotgun;
      }
    });
});
  byId('strategy-shotgun-next').addEventListener('click',()=>host.nextRelease());
  byId('strategy-shotgun-quick-ready').addEventListener('click',()=>{void(async()=>{
    if(quickBusy)return;quickBusy=true;quickError='';quickProof=null;
    try {
      render();
      host.ensureMeta();const {fit,reason}=quickShotgunFit(host.state(),host.draft());
      if(!fit){quickError=`SHOTGUN NOT READY · Shotgun needs one setting resolved: ${reason}`;return;}
      quickChoice=false;priorityProposal=true;host.activateSmart();host.edit((draft,lineage)=>{lineage.immediate=[null];lineage.backups=fit.draft.backups.map(()=>null);draft.immediate=fit.draft.immediate;draft.backups=fit.draft.backups;draft.shotgun=fit.settings;draft.advanced=fit.draft.advanced;});
      host.meta()!.quickShotgun={version:1,settingsKey:quickSettingsKey(),normalized:fit.normalized};
      const dependencies=quickEnvironment();
      if(!await host.save()){quickError='SHOTGUN NOT SAVED · Resolve the save blocker and try again.';return;}
      const saved=host.state()?.booking?.setup.STRATEGY_V2?.shotgun;
      if(!saved || configurationFingerprint(host.state()?.booking?.setup.PRECISION_PHASE3)!==configurationFingerprint(fit.compiled.phase3) || configurationFingerprint(saved.exactSchedule)!==configurationFingerprint(fit.compiled.shotgun!.shots.map(({logicalTargetId,shotIndex,configuredOffsetMs})=>({logicalTargetId,shotIndex,configuredOffsetMs}))) ||
        shotgunSettingsKey(saved)!==shotgunSettingsKey(fit.settings) || dependencies!==quickEnvironment()){
        quickError='SHOTGUN NEEDS REFRESH · Saved configuration or preparation state changed.';return;
      }
      quickProof={draft:quickSettingsKey(),dependencies:quickDependencies()};
    } catch {quickError='SHOTGUN NOT SAVED · Could not save. Try again.';}
    finally {quickBusy=false;render();}
  })();});

  for(const id of ['strategy-shotgun-budget','strategy-shotgun-allocation','strategy-shotgun-start','strategy-shotgun-end','strategy-shotgun-timing','strategy-shotgun-timing-override','strategy-shotgun-standby-override','strategy-shotgun-custom-offsets'])
    byId(id).addEventListener('change',()=>{quickChoice=false;host.edit(draft=>{const current=draft.shotgun??defaultShotgun(draft.immediate);draft.shotgun={...current,
      budget:Number(inputById('strategy-shotgun-budget').value),allocationMode:selectById('strategy-shotgun-allocation').value as ShotgunSettings['allocationMode'],
      windowStartMs:Number(inputById('strategy-shotgun-start').value),windowEndMs:Number(inputById('strategy-shotgun-end').value),
      timingMode:selectById('strategy-shotgun-timing').value as ShotgunSettings['timingMode'],
      customOffsetsMs:(byId('strategy-shotgun-custom-offsets') as HTMLTextAreaElement).value.split(',').map(value=>value.trim()).filter(Boolean).map(Number),
      timingCapacityOverride:(byId('strategy-shotgun-timing-override') as HTMLInputElement).checked,
      allowStandbyConsumption:(byId('strategy-shotgun-standby-override') as HTMLInputElement).checked};delete draft.shotgun.capacityOverride;});});
  for(const radio of document.querySelectorAll<HTMLInputElement>('input[name="release-priority"]'))radio.addEventListener('change',()=>{priorityProposal=radio.value==='MAXIMUM';if(!priorityProposal)host.edit(draft=>{if(draft.shotgun)draft.shotgun.allowStandbyConsumption=false;});else render();});
  byId('shotgun-restore-balanced').addEventListener('click',()=>{priorityProposal=false;host.edit(draft=>{if(draft.shotgun){draft.shotgun.timingMode='BALANCED';draft.shotgun.timingCapacityOverride=false;draft.shotgun.allowStandbyConsumption=false;delete draft.shotgun.capacityOverride;}draft.advanced={};});});
  byId('strategy-shotgun-preset').addEventListener('click',()=>host.edit(draft=>{draft.shotgun={...(draft.shotgun??defaultShotgun(draft.immediate)),enabled:true,budget:20,
    windowStartMs:-1000,windowEndMs:0,allocationMode:'EQUAL',timingMode:'DENSE_CORE',selectedTargetIds:draft.immediate.map(logicalTargetId)};}));
  byId('strategy-shotgun-focus').addEventListener('click',()=>host.edit(draft=>{
    const primary=[...draft.immediate].filter(slot=>draft.shotgun?.selectedTargetIds.includes(logicalTargetId(slot))).sort((a,b)=>(a.priority??draft.immediate.indexOf(a)+1)-(b.priority??draft.immediate.indexOf(b)+1))[0];if(!primary)return;const current=draft.shotgun??defaultShotgun(draft.immediate),id=logicalTargetId(primary);
    draft.shotgun={...current,enabled:true,allocationMode:'CUSTOM',selectedTargetIds:[id],customCounts:{[id]:current.budget}};
  }));
  byId('strategy-check-schedule').addEventListener('click',()=>{void(async()=>{
    const date=host.state()?.booking?.targetDate;if(!date||scheduleCheckingDate)return;
    scheduleCheckingDate=date;scheduleCheckError='';renderSchedule(host.state());
    try {await window.thirsty.checkReleaseBlocks(date);if(host.state()?.blockAudit?.date!==date)scheduleCheckError='Check did not return a schedule. Review Activity and try again.';}
    catch {scheduleCheckError='Public-booking check failed. Review Activity and try again; unresolved cells remain UNKNOWN.';}
    finally {scheduleCheckingDate=null;renderSchedule(host.state());}
  })();});
  byId('strategy-intelligence').addEventListener('change', () => { intelligenceMode = selectById('strategy-intelligence').value as SuggestionIntelligenceMode; invalidate(); });
  byId('strategy-suggest').addEventListener('click', () => { void suggest().then(render); });
  byId('strategy-apply').addEventListener('click', () => {
    const state = host.state(); if (!suggestion) return;
    const timing = childOffsets(state), width = chosenWidth(state), machine = recommendation(state);
    const calibration = timingEvidence(state, timing), base = draftFromSuggestion(suggestion, host.draft(), timing.children.map(child => child.configuredOffsetMs));
    // Worker assignment is deterministic (A..G) and the final literal values are copied into the
    // draft. From here through Review, Save and backend authorization there is nothing left to add.
    const shotgunOn=document.querySelector<HTMLInputElement>('input[name="strategy-intensity"]:checked')?.value==='SHOTGUN';
    // A rebuilt target plan invalidates preparation, not Quick-vs-Custom provenance.
    // Keep the marker only while the literal settings still match the accepted Quick settings.
    const quickProvenance=shotgunOn&&host.meta()?.quickShotgun?.settingsKey===shotgunSettingsKey(base.shotgun)
      ?structuredClone(host.meta()!.quickShotgun):undefined;
    const draft = { ...base, ...(shotgunOn?{shotgun:base.shotgun??defaultShotgun(base.immediate)}:{}), immediate: base.immediate.map((slot, index) => {
      const workerId = String.fromCharCode(65 + index), plan = applyTimingDeskew(timing, calibration, workerId);
      const offsets = plan.children.map(child => child.finalConfiguredOffsetMs), next = { ...slot }; delete next.releaseOffsetMs; delete next.fanOutOffsetsMs;
      if (offsets.length > 1) next.fanOutOffsetsMs = offsets; else if (offsets[0] !== 0) next.releaseOffsetMs = offsets[0]; return next;
    }) };
    if(!shotgunOn)rememberedShotgun=undefined;
    host.useSuggestion(draft, { version: 1, publicScheduleMode, ...(quickProvenance?{quickShotgun:quickProvenance}:{}), targetPlan:{date:state?.booking?.targetDate,historyLabel:historyPlanLabel,publicWarning:publicPlanWarning,ranked:(suggestion.ranked??[...suggestion.immediate,...suggestion.backups]).map(({court,start,durationHours})=>({court,start,durationHours}))}, preset, goal: { ...goal }, lineage: suggestionLineage(draft), intelligenceMode,
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
  for (const kind of ['immediate', 'backups'] as const) byId(`strategy-add-${kind}`).addEventListener('click', () => {
    goal = readGoal(); if (validateGoal(goal).length) { render(); return; }
    const slot = { court: goal.courts[0]!, start: goal.primeFrom, durationHours: goal.durations[0]! };
    const evidence = windowEvidence(slot, schedule(host.state())).evidence;
    host.ensureMeta();
    host.addTarget({ ...slot, publicEvidence: { evidence, ...(isConflict(evidence) || evidence === 'UNKNOWN_PUBLIC_QUERY_FAILED'
      ? { override: 'OPERATOR_OVERRIDE_PUBLIC_CONFLICT' as const } : {}) } }, kind);
    render();
  });
  byId('strategy-save').addEventListener('click', () => host.save());
  byId('strategy-evidence-overrides').addEventListener('click', event => {
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
  if (!state?.booking?.targetDate || validateGoal(goal).length) { pendingSuggestionGeneration = null; return; }
  const ready = 7 - [...host.unready()].filter(worker => 'ABCDEFG'.includes(worker)).length;
  const width = chosenWidth(state);
  const allocation = presetAllocation(preset==='CUSTOM'?'BALANCED':preset, { readyWorkers: ready, recommendedFanOutWidth: recommendation(state).width,
    ...(width.source === 'OPERATOR_OVERRIDE' ? { fanOutWidthOverride: width.width } : {}) });
  const snapshot = { goal: structuredClone(goal), schedule: schedule(state), allocation, forceInclude: structuredClone(forced), exclude: structuredClone(removed),
    intelligenceMode, publicScheduleMode, targetDate: state?.booking?.targetDate };
  render();
  let readWarning='',readFailed=false;
  if(snapshot.publicScheduleMode==='CHECK'&&snapshot.targetDate)try {await window.thirsty.checkReleaseBlocks(snapshot.targetDate);} catch {readFailed=true;readWarning='Public schedule could not be fully verified. Some targets are ranked from preferences/history only.';}
  if(generation!==suggestionGeneration)return;
  const currentSchedule=readFailed?{date:snapshot.targetDate!,checkedAt:'failed read',hours:new Map<string,import('../../src/strategy-engine.js').HourEvidence>()}:schedule(host.state());
  if(snapshot.publicScheduleMode==='CHECK'&&(!currentSchedule||[...currentSchedule.hours.values()].some(v=>v==='UNKNOWN_PUBLIC_QUERY_FAILED')))readWarning='Public schedule could not be fully verified. Some targets are ranked from preferences/history only.';
  if(snapshot.publicScheduleMode==='CACHED_ONLY')readWarning='No new public-booking check requested. Preferences and available history used; already-known public conflicts remain excluded.';
  // Keep previously known conflicts even if a subsequent partial read fails.
  if(currentSchedule&&snapshot.schedule)for(const [key,evidence] of snapshot.schedule.hours)if(isConflict(evidence))(currentSchedule.hours as Map<string,typeof evidence>).set(key,evidence);
  let historicalEvidence: StrategyHistoricalEvidence | null = null;
  if (snapshot.intelligenceMode === 'AUTO' && snapshot.targetDate) try {
    historicalEvidence = await window.thirsty.strategyEvidence({ targetDate: snapshot.targetDate, ranges: enumeratePrimeWindows(snapshot.goal) });
  } catch { historicalEvidence = null; }
  if (generation !== suggestionGeneration) return;
  const targets=rankTargetPlan({goal:snapshot.goal,schedule:currentSchedule??snapshot.schedule??(snapshot.publicScheduleMode==='CHECK'&&readWarning?{date:snapshot.targetDate!,checkedAt:'failed read',hours:new Map()}:null),forceInclude:snapshot.forceInclude,
    exclude:snapshot.exclude,intelligenceMode:snapshot.intelligenceMode,historicalEvidence});
  publicPlanWarning=readWarning;
  historyPlanLabel=targets.intelligence.label;
  suggestion=buildExecutionStrategy(targets,snapshot.allocation);
  pendingSuggestionGeneration = null;
  byId('strategy-apply').toggleAttribute('disabled', !suggestion.immediate.length);
  if(suggestion.immediate.length)(byId('strategy-apply') as HTMLButtonElement).click();
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
  byId('strategy-suggested').querySelector('h3')!.textContent='Build your target plan';
  byId('strategy-suggestion').replaceChildren(...(pendingSuggestionGeneration!==null?[el('p','','Building target plan…')]:[]));
  const draft=host.draft(),targets=[...draft.immediate,...draft.backups];
  const primary=primaryShotgunTarget(draft);
  const summary=byId('strategy-target-summary');
  const conflicts=suggestion?.excluded.filter(w=>w.reason==='KNOWN_CONFLICT')??[];
  byId('strategy-evidence-overrides').replaceChildren(el('h3','','Public conflict overrides'),...conflicts.map(w=>windowItem(w,[['force','Force include']])));
  summary.replaceChildren(...(primary?[el('h3','','PRIMARY'),el('p','target-primary',windowText(primary)),el('h4','','BACKUPS'),
    ...[...draft.immediate.filter(t=>t!==primary),...draft.backups].slice(0,3).map((t,i)=>el('p','',`${i+1}. ${windowText(t)}`)),
    ...(targets.length>4?[el('p','small',`${targets.length-4} more choices in Edit targets`)]:[]),
    el('p','small',publicPlanWarning|| (schedule(state)?`Known conflicts excluded${targets.some(t=>t.publicEvidence?.override)?' except your explicit overrides':''}. Public records do not promise availability at release.`:'Public schedule not checked.')),
    el('p','small',historyPlanLabel)]:[empty('Tell us what you want, then build your target plan.') ]));
}

function renderSchedule(state: Dashboard | undefined) {
  const grid = byId('strategy-schedule-grid'), known = schedule(state), date = state?.booking?.targetDate;
  const checking=!!scheduleCheckingDate||state?.operation==='blockAudit',audit=state?.blockAudit&&state.blockAudit.date===date?state.blockAudit:null;
  const button=byId('strategy-check-schedule') as HTMLButtonElement;button.disabled=checking||!!state&&state?.operation!=='idle';
  button.textContent=checking?'Checking…':'Check public bookings';
  const diagnostic=audit?.diagnostics,availability=diagnostic?.availability,unknown=audit?.cells.filter(cell=>cell.status==='UNKNOWN').length??0;
  byId('strategy-schedule-status').textContent=checking?`Reading public bookings for ${scheduleCheckingDate??date} (read only)…`:scheduleCheckError||(!date?'No target date yet.':audit
    ? availability?.status==='FAILED'
      ?`Check finished in ${(diagnostic!.durationMs/1000).toFixed(2)} s. Availability read failed${availability.httpStatus?` — provider returned HTTP ${availability.httpStatus}`:` (${availability.code})`}. Confirmed bookings are shown; ${unknown} cells remain UNKNOWN.${availability.httpStatus===403?' Repeated checks cannot resolve access denial.':availability.httpStatus===429?' Provider rate limited this read. Wait before checking again.':''}`
      :`Public-booking evidence for ${date}${diagnostic?` · checked in ${(diagnostic.durationMs/1000).toFixed(2)} s`:''}.${unknown?` ${unknown} cells remain UNKNOWN; no usable availability evidence for those hours.`:''}${diagnostic?.publicBookings.failedCourts.length?` Public booking reads failed for courts ${diagnostic.publicBookings.failedCourts.join(', ')}.`:''}`
    :state?.blockAudit?`The latest check was for ${state.blockAudit.date}; check ${date}.`:`Not checked yet for ${date}.`);
  if (validateGoal(goal).length) { grid.replaceChildren(); return; }
  const from = Number(goal.primeFrom.slice(0, 2)), until = goal.primeUntil === '24:00' ? 24 : Number(goal.primeUntil.slice(0, 2));
  const cells: HTMLElement[] = [el('span', 'head', ''), ...goal.courts.map(court => el('span', 'head', `C${court}`))];
  grid.style.gridTemplateColumns = `64px repeat(${goal.courts.length}, minmax(0, 1fr))`;
  const short: Record<string, string> = { NOT_CHECKED:'not checked', NO_KNOWN_PUBLIC_CONFLICT: 'no record', KNOWN_PUBLIC_BOOKING_CONFLICT: 'booked', UNKNOWN_PUBLIC_QUERY_FAILED: 'unknown', PUBLISHED_OPEN: 'open', PUBLISHED_UNAVAILABLE: 'taken' };
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
    if(host.draft().shotgun?.enabled){timing.hidden=true;worker.hidden=true;fields.querySelector<HTMLElement>(`#strategy-immediate-width-${index}`)!.parentElement!.hidden=true;}
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
  section.hidden = false;
  const count = host.draft().immediate.length + host.draft().backups.length;
  (byId('strategy-add-immediate') as HTMLButtonElement).disabled = validateGoal(goal).length > 0 || count >= SMART_MAX_SLOTS || host.draft().immediate.length >= SMART_WORKERS.length;
  (byId('strategy-add-backups') as HTMLButtonElement).disabled = validateGoal(goal).length > 0 || count >= SMART_MAX_SLOTS;
  if(document.activeElement instanceof HTMLInputElement&&document.activeElement.id.startsWith('strategy-immediate-offset-'))return;
  const draft = host.draft(), accepted = host.accepted(), compiled = compileSmartPlan(draft, { targetDate: state?.booking?.targetDate ?? '', unavailable: host.unready(),shotgunCapacity:shotgunCapacity(state,draft.shotgun?.budget??1,host.meta()?.timingCalibration?.groupShiftMs??0) });
  const lineage = host.lineage(), modifications = strategyModificationCount(draft, accepted, lineage);
  byId('strategy-edit-provenance').textContent = accepted ? `Source: Smart generated · Operator modifications: ${modifications}` : host.meta()?.provenance?.source === 'OPERATOR_BUILT' || !smart ? 'Source: Operator built' : 'Source: Existing Smart plan';
  (byId('strategy-reset-all') as HTMLButtonElement).disabled = !accepted || modifications === 0;
  byId('strategy-edit-immediate').replaceChildren(...draft.immediate.map((slot, index) => editableRow('immediate', slot, index, state, compiled, accepted)));
  byId('strategy-edit-backups').replaceChildren(...draft.backups.map((slot, index) => editableRow('backups', slot, index, state, compiled, accepted)));
  const baselineStarts = accepted ? new Set(accepted.immediate.map(slot => slot.start)).size : 0, currentStarts = new Set(draft.immediate.map(slot => slot.start)).size;
  byId('strategy-edit-warnings').replaceChildren(...(baselineStarts > currentStarts ? [el('li', '', `This change reduces start-time diversification from ${baselineStarts} unique starts to ${currentStarts}.`)] : []));
}

function shotgunPresentation(state:Dashboard|undefined){
  const draft=host.draft(),context={targetDate:state?.booking?.targetDate??'',unavailable:host.unready(),shotgunCapacity:shotgunCapacity(state,draft.shotgun?.budget??1,host.meta()?.timingCalibration?.groupShiftMs??0)};
  const previewDraft=structuredClone(draft);
  // Consequence forecast only: the actual draft/compiler remains the Save authority.
  if(previewDraft.shotgun){previewDraft.shotgun.timingCapacityOverride=true;previewDraft.shotgun.allowStandbyConsumption=true;}
  const preview=compileSmartPlan(previewDraft,context);
  const normalDraft=structuredClone(draft);delete normalDraft.shotgun;
  const normal=compileSmartPlan(normalDraft,context);
  return {preview,normal,feasibility:draftFeasibility(state,preview.phase3)};
}
function renderShotgun(state:Dashboard|undefined){
  const draft=host.draft(),settings=draft.shotgun,quickPrimary=primaryShotgunTarget(draft);
  byId('strategy-preset').hidden=!draft.immediate.length;byId('strategy-review').hidden=!draft.immediate.length;
  for(const radio of document.querySelectorAll<HTMLInputElement>('input[name="strategy-intensity"]'))radio.checked=radio.value===(settings?.enabled?'SHOTGUN':'NORMAL');
  byId('strategy-shotgun-fast-path').hidden=!settings?.enabled;
  byId('strategy-normal-fast-path').hidden=!!settings?.enabled;
  byId('strategy-shotgun').hidden=!settings?.enabled;
  byId('strategy-normal-settings').hidden=false;
  const knownQuick=host.meta()?.quickShotgun?.settingsKey===quickSettingsKey();
  const custom=!!settings?.enabled&&!knownQuick&&!quickChoice;
  byId('strategy-replace-quick').hidden=!custom;
  const stale=!!settings?.enabled&&knownQuick&&(!quickProof||quickProof.draft!==quickSettingsKey()||quickProof.dependencies!==quickDependencies());
  const current=!!quickProof&&!custom&&!stale&&savedDraftKey!=='';
  const quickButton=byId('strategy-shotgun-quick-ready') as HTMLButtonElement;quickButton.disabled=!quickPrimary||quickBusy;quickButton.hidden=current;
  quickButton.textContent=quickBusy?'SAVING SHOTGUN…':stale?'REFRESH & SAVE SHOTGUN':custom?'REPLACE WITH QUICK SHOTGUN':'APPLY & SAVE SHOTGUN';
  byId('strategy-shotgun-quick-status').textContent=quickError||(!quickPrimary?'SHOTGUN NOT READY · Add at least one release target first.':current
    ?`SHOTGUN SAVED ✓ · Court ${quickPrimary.court} · ${smartRange(quickPrimary.start,quickPrimary.durationHours)} · ${settings!.budget} attempts · Dense Core · −1000 → 0 ms · Preparation forecast · ${shotgunPresentation(state).feasibility?.projectedReady}/${shotgunPresentation(state).feasibility?.configuredWave1Attempts} READY · Next: Prepare for Release`
    :stale?'SHOTGUN NEEDS REFRESH · Refresh for your current #1 target and preparation state.':custom?'CUSTOM SHOTGUN · Your manual settings are preserved. Replace only when you choose.':'Choose your target, then apply and save Shotgun.');
  if(current){
    const forecast=shotgunPresentation(state).feasibility;
    byId('strategy-shotgun-quick-status').replaceChildren(el('strong','','SHOTGUN SAVED ✓'),el('p','',`Court ${quickPrimary!.court} · ${smartRange(quickPrimary!.start,quickPrimary!.durationHours)}`),
      el('p','',`${settings!.budget} attempts · Dense Core · −1000 → 0 ms`),el('p','',`Preparation forecast · ${forecast?.projectedReady}/${forecast?.configuredWave1Attempts} READY${(forecast?.configuredWave1Attempts??0)>settings!.budget?' (includes other release targets)':''}`),el('p','','Next: Prepare for Release'),...(host.meta()?.quickShotgun?.normalized?.length?[el('p','small',`Returned incompatible ${host.meta()!.quickShotgun!.normalized!.map(key=>({total:'total attempt limit',wave2:'backup attempt limit',rescue:'Rescue attempt limit',standby:'reserved browser groups'}[key])).join(', ')} to automatic settings.`)]:[]));
  }
  byId('strategy-shotgun-next').hidden=!current;
  if(!settings?.enabled)return;
  inputById('strategy-shotgun-budget').value=String(settings.budget);selectById('strategy-shotgun-allocation').value=settings.allocationMode;
  inputById('strategy-shotgun-start').value=String(settings.windowStartMs);inputById('strategy-shotgun-end').value=String(settings.windowEndMs);
  selectById('strategy-shotgun-timing').value=settings.timingMode;
  (byId('strategy-shotgun-timing-override') as HTMLInputElement).checked=!!(settings.timingCapacityOverride??settings.capacityOverride);
  (byId('strategy-shotgun-standby-override') as HTMLInputElement).checked=!!settings.allowStandbyConsumption;

  const customInput=byId('strategy-shotgun-custom-offsets') as HTMLTextAreaElement;if(document.activeElement!==customInput)customInput.value=(settings.customOffsetsMs??[]).map(value=>value>0?`+${value}`:String(value)).join(', ');
  const targets=byId('strategy-shotgun-targets');targets.replaceChildren(...draft.immediate.map((slot,index)=>{
    const id=logicalTargetId(slot),label=el('label','strategy-shotgun-target'),check=document.createElement('input');check.type='checkbox';check.checked=settings.selectedTargetIds.includes(id);
    check.addEventListener('change',()=>host.edit(next=>{const current=next.shotgun!;current.selectedTargetIds=check.checked?[...new Set([...current.selectedTargetIds,id])]:current.selectedTargetIds.filter(value=>value!==id);}));
    label.append(check,document.createTextNode(` Court ${slot.court} · ${smartRange(slot.start,slot.durationHours)} · ${slot.durationHours} h · priority ${slot.priority??index+1}`));
    if(settings.allocationMode==='CUSTOM'){const count=document.createElement('input');count.type='number';count.min='0';count.step='1';count.value=String(settings.customCounts?.[id]??0);
      count.setAttribute('aria-label',`Custom shots for Court ${slot.court}`);count.addEventListener('change',()=>host.edit(next=>{const current=next.shotgun!;current.customCounts={...(current.customCounts??{}),[id]:Number(count.value)};}));label.append(count);}
    return label;
  }));
  const {preview:projected,normal,feasibility}=shotgunPresentation(state),plan=projected.shotgun;
  const groupCount=Object.values(plan?.counts??{}).reduce((sum,count)=>sum+Math.ceil(count/6),0),ordered=[...(plan?.shots??[])].sort((a,b)=>a.configuredOffsetMs-b.configuredOffsetMs||a.logicalTargetId.localeCompare(b.logicalTargetId));
  const labels=new Map(draft.immediate.map(slot=>[logicalTargetId(slot),`Court ${slot.court} · ${smartRange(slot.start,slot.durationHours)}`]));
  const primary=ordered[0]&&labels.get(ordered[0].logicalTargetId),first=ordered[0]?.configuredOffsetMs??settings.windowStartMs,last=ordered.at(-1)?.configuredOffsetMs??settings.windowEndMs;
  const facts=[['Target',primary??'Choose a target'],['Attempts',String(ordered.length||settings.budget)],['Timing',settings.timingMode==='DENSE_CORE'?'Pre-release Dense Core':settings.timingMode.replaceAll('_',' ')],['First attempt',offsetText(first)],['Last attempt',offsetText(last)],['Browsers required',`${groupCount||'—'} Shotgun · ${new Set(projected.phase3?.wave1.map(value=>value.workerId)??[]).size||groupCount} total`],['After release','Nothing after release']];
  const preview=byId('strategy-shotgun-preview');preview.replaceChildren(...facts.map(([label,value])=>{const row=el('div','dense-fact');row.append(el('span','',label),el('strong','',value));return row;}));
  const timingRequired=!!plan?.capacityWarning,standbyRequired=projected.standby.length<normal.standby.length;
  const timingAck=!!(settings.timingCapacityOverride??settings.capacityOverride),standbyAck=!!settings.allowStandbyConsumption;
  const remaining=Number(timingRequired&&!timingAck)+Number(standbyRequired&&!standbyAck);
  byId('shotgun-attention').hidden=!timingRequired&&!standbyRequired;
  byId('shotgun-attention-title').textContent=remaining?`${remaining} THING${remaining===1?'':'S'} NEED YOUR ATTENTION`:'✓ TRADE-OFFS ACKNOWLEDGED';
  byId('shotgun-timing-attention').hidden=!timingRequired;byId('shotgun-standby-attention').hidden=!standbyRequired;
  byId('shotgun-timing-state').textContent=`${timingAck?'✓ ACKNOWLEDGED':'⚠ NEEDS ACKNOWLEDGEMENT'} · Aggressive timing`;
  byId('shotgun-standby-state').textContent=`${standbyAck?'✓ ACKNOWLEDGED':'⚠ NEEDS ACKNOWLEDGEMENT'} · Initial release vs backup capacity`;
  byId('shotgun-timing-detail').textContent=`Configured minimum ${plan?.requestedSpacingMs??'—'} ms · ${recommendation(state).profile?'machine':'fallback'} reference ${plan?.meaningfulSpacingMs??'—'} ms. ${recommendation(state).profile?'Local spaced-load timing is measured':'No compatible measured machine profile; fallback reference used'}; provider arbitration remains unknown.`;
  byId('shotgun-standby-detail').textContent=`This ${ordered.length}-attempt Shotgun requires ${groupCount} browsers. Wave 2 standby: ${normal.standby.length} → ${projected.standby.length}. Rescue remains ${projected.phase3?.rescueEnabled?'enabled':'disabled'}.`;
  for(const radio of document.querySelectorAll<HTMLInputElement>('input[name="release-priority"]'))radio.checked=radio.value===((priorityProposal||standbyAck)?'MAXIMUM':'BALANCED');
  byId('shotgun-resource-effect').textContent=`RESOURCE EFFECT${priorityProposal&&!standbyAck?' · Maximum release focus proposed':''} · Initial Shotgun: ${groupCount} browsers (${new Set(projected.phase3?.wave1.map(value=>value.workerId)??[]).size||groupCount} total release browsers) · Wave 2 standby: ${normal.standby.length} → ${projected.standby.length} · Rescue: ${projected.phase3?.rescueEnabled?'Enabled':'Disabled'}${standbyRequired&&!standbyAck?' · Explicit standby acknowledgement required':''}`;
  byId('shotgun-preparation').textContent=projected.problems.length?`✕ PREPARATION NOT FORECASTABLE · ${projected.problems[0]}`:preparationText(feasibility,settings.budget);
  byId('shotgun-allocation-summary').replaceChildren(...Object.entries(plan?.counts??{}).map(([id,count])=>{const row=el('div','allocation-row'),meter=document.createElement('meter');meter.min=0;meter.max=settings.budget;meter.value=count;meter.setAttribute('aria-label',`${labels.get(id)??id}: ${count} of ${settings.budget} attempts`);row.append(el('span','',labels.get(id)??id),meter,el('strong','',`${count} / ${settings.budget}`));return row;}));
  const early=ordered.filter(shot=>shot.configuredOffsetMs< -250).length;
  byId('shotgun-timeline-summary').textContent=settings.timingMode==='DENSE_CORE'?`${early} early probes · ${ordered.length-early} concentrated attempts (−250 ms through release)`:'Exact saved timing preview';
  const track=byId('strategy-shotgun-timeline'),range=Math.max(1,last-first);const denseBoundary=Math.max(0,Math.min(100,(-250-first)/range*100));track.style.background=`linear-gradient(to right,rgba(100,140,110,.08) ${denseBoundary}%,rgba(185,255,75,.12) ${denseBoundary}%)`;track.replaceChildren(...ordered.map((shot,index)=>{const dot=el('span','shotgun-dot');dot.style.left=`${Math.max(0,Math.min(100,(shot.configuredOffsetMs-first)/range*100))}%`;dot.title=`Attempt ${index+1}: ${shot.configuredOffsetMs} ms`;return dot;}));
  byId('strategy-shotgun-first').textContent=`${first} ms`;
  byId('strategy-shotgun-exact-list').replaceChildren(...ordered.map((shot,index)=>el('span','',`#${index+1} · ${shot.configuredOffsetMs>0?'+':''}${shot.configuredOffsetMs} ms · ${labels.get(shot.logicalTargetId)??shot.logicalTargetId}`)));
}

function renderReview(state: Dashboard | undefined) {
  const draft=host.draft(),context={targetDate:state?.booking?.targetDate??'',unavailable:host.unready(),shotgunCapacity:shotgunCapacity(state,draft.shotgun?.budget??1,host.meta()?.timingCalibration?.groupShiftMs??0)};
  const compiled=draft.shotgun?.enabled?compileSmartPlan(draft,context):fitNormalAttemptLimits(draft,context).compiled;
  const smart = state?.booking && (document.getElementById('precision-strategy') as HTMLSelectElement | null)?.value === 'precision' && (document.getElementById('precision-mode-smart') as HTMLInputElement | null)?.checked;
  const feasibility=draftFeasibility(state,compiled.phase3);
  const warnings = [...draft.immediate, ...draft.backups].filter(slot => slot.publicEvidence?.override).map(slot =>
    `${windowText(slot)} was force-included despite ${slot.publicEvidence!.evidence === 'UNKNOWN_PUBLIC_QUERY_FAILED' ? 'a failed public-booking read' : 'a known public booking'} (OPERATOR_OVERRIDE_PUBLIC_CONFLICT).`);
  const presentation=shotgunPresentation(state),unknown=compiled.problems.filter(text=>!acknowledgementKind(text));
  byId('strategy-review-warnings').replaceChildren(...warnings.map(text=>el('li','',text)));
  const gate=byId('strategy-gate'),items:Array<{label:string;control:string}>=[];
  for(const text of [...new Set(compiled.problems)])items.push({label:acknowledgementKind(text)==='timing'?'Aggressive timing acknowledgement':acknowledgementKind(text)==='standby'?'Initial-release resource trade-off acknowledgement':text,control:acknowledgementKind(text)==='timing'?'strategy-shotgun-timing-override':acknowledgementKind(text)==='standby'?'strategy-shotgun-standby-override':/rate/i.test(text)?'smart-review-rates':draft.shotgun?.enabled?'strategy-shotgun-budget':'strategy-edit-immediate'});
  if(!draft.immediate.length&&!items.length)items.push({label:'Target required',control:'strategy-edit-immediate'});
  if(presentation.feasibility?.projectedOmitted)items.push({label:`Preparation forecast incomplete: ${presentation.feasibility.projectedReady}/${presentation.feasibility.configuredWave1Attempts} feasible · ${presentation.feasibility.projectedOmitted} omitted`,control:'shotgun-preparation'});
  const valid=!!smart&&!!compiled.phase3,saveDisabled=draft.shotgun?.enabled?(byId('save-booking') as HTMLButtonElement).disabled:state?.operation!=='idle'||!compiled.phase3||compiled.problems.length>0;
  const remaining=items.length,status=remaining?`${unknown.length||presentation.feasibility?.projectedOmitted?'✕ BLOCKED':'⚠ NEEDS ATTENTION'} · ${remaining} item${remaining===1?'':'s'} remaining`:valid&&savedDraftKey===JSON.stringify(draft)?'✓ STRATEGY SAVED':valid&&!saveDisabled?'✓ READY TO SAVE':valid?'INFO · SAVE UNAVAILABLE':'⚠ NEEDS ATTENTION';
  gate.replaceChildren(el('h4','','RELEASE PLAN STATUS'),el('strong','',status),...items.map(item=>{const button=el('button','secondary gate-link',item.label);button.type='button';button.addEventListener('click',()=>focusControl(item.control));return button;}));
  if(valid)gate.append(el('p','check-ok','✓ Target configured · Rates confirmed · Attempts authorized'),el('p','check-ok',draft.shotgun?.enabled?'✓ No post-release Shotgun offsets':'✓ Literal release timing configured'),...(!presentation.feasibility?.projectedOmitted?[el('p','',preparationText(presentation.feasibility,draft.shotgun?.budget??presentation.preview.phase3?.wave1.length??0))]:[]),...(draft.shotgun?.enabled?[el('p','check-ok',`${draft.shotgun.timingCapacityOverride?'✓ Aggressive timing acknowledged':'INFO · Machine timing respected'} · ${draft.shotgun.allowStandbyConsumption?'✓ Initial-release trade-off acknowledged':'INFO · Backup capacity protected'}`)]:[]));
  const primarySlot=draft.immediate[0],schedule=presentation.preview.shotgun?.shots??[],groups=new Set(presentation.preview.phase3?.wave1.map(value=>value.workerId)??[]).size;
  byId('strategy-current-plan').textContent=`CURRENT PLAN · ${primarySlot?windowText(primarySlot):'Choose a target'} · ${draft.shotgun?.enabled?`${draft.shotgun.timingMode.replaceAll('_',' ')} · ${schedule.length} attempts · ${groups} browsers · ${offsetText(schedule.length?Math.min(...schedule.map(value=>value.configuredOffsetMs)):draft.shotgun.windowStartMs)} → ${offsetText(schedule.length?Math.max(...schedule.map(value=>value.configuredOffsetMs)):draft.shotgun.windowEndMs)}`:'Normal measured timing'} · ${status}`;
  const save=byId('strategy-save') as HTMLButtonElement;save.disabled=!valid||saveDisabled||remaining>0;
  save.hidden=!draft.shotgun?.enabled||host.meta()?.quickShotgun?.settingsKey===quickSettingsKey()||quickChoice||savedDraftKey===JSON.stringify(draft);
  // Invalid Custom settings must not strand the normal workflow behind a disabled Save.
  // Offer the existing explicit replacement action; building targets never replaces them.
  const blockedCustom=!save.hidden&&save.disabled;
  if(blockedCustom){
    save.hidden=true;
    if(!quickError)byId('strategy-shotgun-quick-status').textContent='CUSTOM SHOTGUN NEEDS UPDATE · These settings cannot be saved with the current plan. Replace with Quick Shotgun for your #1 target, or edit Custom settings in Advanced.';
  }
  byId('strategy-shotgun-quick-ready').hidden=byId('strategy-shotgun-quick-ready').hidden||(!save.hidden);
  if(draft.shotgun?.enabled && host.meta()?.quickShotgun?.settingsKey!==quickSettingsKey() && !quickChoice)byId('strategy-shotgun-next').hidden=savedDraftKey!==JSON.stringify(draft);
  save.textContent=savedDraftKey===JSON.stringify(draft)?'✓ STRATEGY SAVED':'SAVE CUSTOM SHOTGUN';
  byId('strategy-review-status').textContent=remaining?`${remaining} items need attention before saving.`:saveDisabled?'Saving is unavailable during the current operation.':'Saving does not prepare, authorize Terms or arm the release.';
  const body = byId('strategy-review-body'),technical=byId('strategy-review-technical');
  if (!smart) { body.replaceChildren(empty('The current plan is not a Smart plan. Use a suggestion, or edit under Advanced overrides.'));technical.replaceChildren(); return; }
  if (!compiled.phase3) { body.replaceChildren(empty('Resolve the attention items above. The Dense Core card shows the exact timing and resource consequences.'));technical.replaceChildren(...compiled.problems.map(text=>el('p','small',text)),...feasibilityLines(presentation.feasibility).map(text=>el('p','small',text))); return; }
  const description = describeSmartPlan(compiled.phase3, { unavailable: host.unready() });
  const shotgun=compiled.shotgun,shotgunReview=shotgun&&draft.shotgun?[el('h4','','Shotgun'),
    el('p','small',`Enabled · budget ${draft.shotgun.budget} · ${draft.shotgun.allocationMode.replaceAll('_',' ').toLowerCase()} · window ${draft.shotgun.windowStartMs>0?'+':''}${draft.shotgun.windowStartMs} ms → ${draft.shotgun.windowEndMs>0?'+':''}${draft.shotgun.windowEndMs} ms · ${draft.shotgun.timingMode.replaceAll('_',' ').toLowerCase()} · group anchor ${shotgun.groupAnchorMs>0?'+':''}${shotgun.groupAnchorMs} ms (${host.meta()?.timingCalibration?.anchorSource??'no fresh anchor evidence'})`),
    el('p','small','Shotgun never sends after release. Configured offsets are browser-local authorization; provider receipt and arbitration order remain unknown.'),
    ...Object.entries(shotgun.counts).map(([id,count])=>el('p','small',`${id} → ${count} Shotgun attempt${count===1?'':'s'}`)),
    ...shotgun.shots.map(shot=>el('p','small',`${shot.logicalTargetId} · shot ${shot.shotIndex+1}/${shot.shotCount} · FINAL SAVED TRIGGER ${shot.configuredOffsetMs>0?'+':''}${shot.configuredOffsetMs} ms`)),
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
  body.replaceChildren(el('p','',`${draft.immediate.length} immediate target${draft.immediate.length===1?'':'s'} · ${draft.backups.length} backup choices`),el('h4','','Primary target'),el('p','',primary?`Court ${primary.court} · ${smartRange(primary.start,primary.durationHours)}`:'No target'),el('h4','','Release'),el('p','',shotgun?`${attempts} Dense Core attempts · ${range} · nothing will be sent after release.`:`${attempts} normal measured attempts.`),el('h4','','Browsers'),el('p','',`${new Set(compiled.phase3.wave1.map(value=>value.workerId)).size} browser groups · ${feasibility?`${feasibility.projectedReady}/${feasibility.configuredWave1Attempts} attempts projected ready`:'preparation checked before arming'}`),el('h4','','Backup attempts'),el('p','',`Up to ${compiled.budgets.wave2} fresh backup attempts · reopened-slot rescue ${compiled.phase3.rescueEnabled?'ON':'OFF'}.`),el('h4','','Payment'),el('p','','The bot stops at QR. Payment remains manual.'),);
  technical.replaceChildren(...compiled.problems.map(text=>el('p','small',text)),...shotgunReview,...description.sections.flatMap(section => [el('h4', '', section.title), ...section.lines.map(line => el('p', 'small', line))]),
    ...(decomposition.length?[el('h4','','Saved timing decomposition'),...decomposition]:[]),
    el('p', '', `${description.summary} · Maximum possible sends: ${description.maxSends}`),el('p','small',`Saved fingerprint: ${state?.booking?.fingerprint??'none'} · Build: ${state?.build?.gitSha??'unknown'}${state?.build?.dirty?' (uncommitted)':''}`));
}

/** Called on every status update. Loads the saved goal/preset once per saved plan. */
export function renderStrategy(state: Dashboard | undefined): void {
  if (!host) return;
  const saved = state?.booking?.setup.STRATEGY_V2, key = `${state?.booking?.targetDate ?? ''}|${saved ? JSON.stringify(saved) : ''}`;
  if (key !== loadedKey) {
    suggestionGeneration++; pendingSuggestionGeneration = null; suggestion = null; byId('strategy-apply').toggleAttribute('disabled', true);
    loadedKey = key;
    if (saved) { historyPlanLabel=saved.targetPlan?.date===state?.booking?.targetDate?saved.targetPlan?.historyLabel??'Historical evidence insufficient · preference ranking used':'Historical evidence insufficient · preference ranking used';publicPlanWarning=saved.targetPlan?.date===state?.booking?.targetDate?saved.targetPlan?.publicWarning??'':'';goal = normalizeStrategyGoal(saved.goal); courtsOverridden=JSON.stringify(saved.goal.courts)!==JSON.stringify(host.mainCourtOrder());preset = saved.preset; selectById('strategy-fanout').value = saved.fanOut.source === 'OPERATOR_OVERRIDE' ? String(saved.fanOut.width) : 'auto';
      intelligenceMode = saved.intelligenceMode ?? 'AUTO'; selectById('strategy-intelligence').value = intelligenceMode;
      publicScheduleMode = saved.publicScheduleMode ?? 'CHECK';selectById('strategy-public-data').value=publicScheduleMode;
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
  (byId('strategy-suggest') as HTMLButtonElement).disabled = pendingSuggestionGeneration!==null || !state?.booking?.targetDate || validateGoal(goal).length > 0;
  render();
}
export function strategyMainCourtOrderChanged():void {
  if(!host||courtsOverridden)return;
  const courts=host.mainCourtOrder();if(JSON.stringify(goal.courts)===JSON.stringify(courts))return;
  goal={...goal,courts:[...courts]};writeGoal(goal);invalidate();
}
function render() {
  const state = host.state();
  byId('strategy-target-date').textContent = state?.booking?.targetDate ?? state?.clock?.targetDate ?? '—';
  (byId('strategy-suggest') as HTMLButtonElement).disabled = pendingSuggestionGeneration!==null || !state?.booking?.targetDate || validateGoal(goal).length > 0;
  renderSchedule(state); renderPreset(state); renderSuggestion(state); renderEditable(state); renderShotgun(state); renderReview(state); renderNormal(state);
}
/** Exposed for tests and the Next Release summary. */
export const strategySnapshot = () => ({ goal: { ...goal }, preset, forced: [...forced], suggestion, suggestionGeneration, pendingSuggestionGeneration });
export const conflictsIn = (plan: SuggestedPlan) => plan.immediate.filter(window => isConflict(window.evidence));

function renderNormal(state:Dashboard|undefined){
 const draft=host.draft(),fit=fitNormalAttemptLimits(draft,{targetDate:state?.booking?.targetDate??'',unavailable:host.unready()}),compiled=fit.compiled;
 const saved=savedDraftKey!==''&&savedDraftKey===JSON.stringify(draft)&&savedGoalKey===goalSettingsKey();
 byId('strategy-normal-summary').textContent=`Immediate targets: ${draft.immediate.length} · Release attempts: ${compiled.phase3?.wave1.reduce((n,a)=>n+(a.fanOutOffsetsMs?.length??1),0)??0} · Backup choices: ${draft.backups.length} · Reopened-slot rescue: ${draft.retryReopened?'ON':'OFF'}`;
 const busy=state?.operation!=='idle';
 byId('strategy-normal-status').textContent=normalError||(saved?'NORMAL STRATEGY SAVED ✓':compiled.problems.length?`UNSAVED CHANGES · Cannot save: ${compiled.problems.join(' ')}`:busy?'Wait for the current operation to finish before saving.':fit.normalized.length?`UNSAVED CHANGES · Old attempt limits no longer fit. Saving will use automatic limits: ${compiled.budgets.total} total (${compiled.budgets.wave2} backup + ${compiled.budgets.rescue} rescue).`:'UNSAVED CHANGES');
 const autoDraft=structuredClone(draft);delete autoDraft.advanced.wave2;delete autoDraft.advanced.rescue;delete autoDraft.advanced.total;
 const automatic=compileSmartPlan(autoDraft,{targetDate:state?.booking?.targetDate??'',unavailable:host.unready()});
 const repair=byId('strategy-normal-auto-limits') as HTMLButtonElement;
 repair.hidden=!compiled.problems.some(text=>text.startsWith('Attempt limits are inconsistent.'));
 repair.disabled=busy||!automatic.phase3;
 repair.textContent=`Use automatic attempt limits (${automatic.budgets.total} total: ${automatic.budgets.wave2} backup + ${automatic.budgets.rescue} rescue)`;
 (byId('strategy-normal-save') as HTMLButtonElement).disabled=saved||!compiled.phase3||compiled.problems.length>0||host.state()?.operation!=='idle';
 byId('strategy-normal-save').hidden=saved;byId('strategy-normal-next').hidden=!saved;
}
