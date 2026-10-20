import type { PreparationInput, TestBookingInput } from '../src/booking-plan.js';
import type {FullPracticeInput} from '../src/full-practice.js';
import type {LockReview} from './locks.js';
import type { UiEvent } from '../src/ui-events.js';
import type { clockStatus } from './status.js';
import type { BookingView } from './booking.js';
import type { BookingSetup } from '../src/config.js';
import type { PracticeInput } from '../src/practice.js';
import type { DualPracticeInput } from '../src/dual-practice.js';
import type {PreparedContext} from '../src/prepared-context.js';
import type {FallbackReconciliation} from '../src/booking-setup.js';
import type {ScheduledReleaseContext} from '../src/scheduled-release.js';
import type {PreviousHold} from './status.js';
import type {CourtCount,WorkerId} from '../src/workers.js';
import type {BrowserFocusResult} from '../src/browser-window.js';
import type {SlotWatchDigest,SlotWatchView} from '../src/slot-watch.js';
import type {ReleaseForensicsDigest} from '../src/release-forensics.js';
import type {IntelligenceDigest} from '../src/release-intelligence.js';
import type {ReadinessResult} from '../src/network-readiness.js';
import type {WarmthAssessment} from '../src/checkout-path-research.js';
import type {AdvisorResult} from '../src/release-advisor.js';
import type {ReplaySummary} from './controller.js';
import type {ReleaseLabDigest} from '../src/release-lab-analysis.js';
export type DualPracticeCommand = { kind:'dualDry'; date:string } | { kind:'dualPractice'|'dualFullPractice'; input:DualPracticeInput };
export interface ConfirmRequest { id:string; tone:'question'|'warning'; title:string; message:string; detail:string; confirmLabel:string; cancelLabel?:string }
export interface ApiRunPreferences {wing?:'MANGO'|'BUKO';strategy:'standard'|'extended';date:string;start:string;duration:number;courtCount:CourtCount;maximum?:number;priority:number[];fallbackStarts:string[];exact?:number[][];workers?:WorkerId[]}
export type Command = {kind:'courtBrowse';date:string} | {kind:'timingCalibration';date:string} | {kind:'resetPrepare';input:PreparationInput} | {kind:'testBooking';input:TestBookingInput} | {kind:'apiRun';mode:import('../src/api-run-modes.js').ApiRunMode;date:string;fingerprint:string;checkoutMethod?:'proof-based'|'proofless';clockOffsetMs?:number;releaseMs?:number;preferences?:ApiRunPreferences;shotgunAttestation?:string} | {kind:'blockAudit';date:string} | {kind:'apiPreview';date:string} | DualPracticeCommand | 'chromeDual' | 'dualReadiness' | 'dualPrepare' | {kind:'fullPractice';input:FullPracticeInput} | 'chrome' | 'inspect' | 'observe' | { kind:'selection' | 'dry'; planHash:string } | {kind:'full';context:ScheduledReleaseContext;authorizeTerms:true} | { kind:'practice'; input:PracticeInput };
export type Inspection = Extract<UiEvent, { type: 'inspection' }>;
export interface Activity { at: string; text: string; level: 'info' | 'error'; elapsedMs?:number; deltaMs?:number }
export interface RunTiming { runId:string; label:string; startedAt:string; elapsedMs:number; endedAt?:string; logPath?:string; readyAt?:string; readyElapsedMs?:number }
export interface RunHistoryEntry { runId:string; label:string; startedAt:string; endedAt:string; outcome:string; totalElapsedMs:number; readyAt?:string; readyElapsedMs?:number; activities:Activity[]; qrHandoffs?:QrHandoffSummary[] }
export interface QrHandoffSummary { wing?:'MANGO'|'BUKO'; checkout?:WorkerId; status?:'hold-created'|'qr-ready'; courts:number[]; date:string; startTime:string; endTime:string; amount:number; verifiedAt:string; holdExpiresAt?:string; bookingId?:string; bookingNo?:string }
export interface PrecisionTargetView { workerId:WorkerId; court:number; startTime:string; endTime:string; durationHours:number; assumedPrice?:number;
  evidence?:string; eligible?:boolean; checkpoint?:string; state?:string; code?:string; duplicateOf?:WorkerId; security?:'ready'|'failed'; bookingNo?:string; holdExpiresAt?:string }
/** Live Precision race view built from runner stage events; purely informational. */
export interface PrecisionView { targets:PrecisionTargetView[]; frozen:boolean; frozenCount?:number; frozenAt?:string; checkpoint?:string; checkpointAt?:string; outcome?:string }
/** One independently tracked attempt (a fan-out child, or the single attempt of a target). */
export interface LiveChildView { attemptId:string; label:string; fanOutIndex:number; fanOutCount:number; shotIndex?:number;shotCount?:number;offsetMs?:number; state:string; code?:string }
/** A logical target (the parent goal) and its attempts, for the Live view. */
export interface LiveParentView { key:string; wave:'WAVE_1'|'WAVE_2'|'RESCUE'; workerId?:string; court?:number; startTime?:string; endTime?:string; candidateId?:string; children:LiveChildView[] }
export interface LivePredictionView { candidateId:string; court?:number; startTime?:string; endTime?:string; predictedStartMs:number; predictedEndMs:number; confidence:string;
  prewarm?:'PREPARING'|'READY'|'FAILED'; errorMs?:number }
export interface LiveRunView { parents:LiveParentView[]; tiers?:string; prewarm?:{leadMs:number;width:number;actualLeadMs?:number;lateByMs?:number}; predictions:LivePredictionView[];
  rescueEnabled?:boolean; rescueMax?:number; outcome?:string; notes:string[] }
/** Machine Fan-out Capacity Profile digest (fanout-capacity.ts), with the full newest compatible profile for timing presets. */
export interface FanOutWidthView { width:number; attempts:number; chromeP50:number|null; chromeP95:number|null; chromeP99:number|null; chromeMax:number|null; spreadP95:number|null; perChildP95:Array<number|null> }
export interface FanOutProfileView { createdAt:string; dispatcher:string; compatible:boolean; stale:boolean; notes:string[]; recommendedWidth:number; reasons:string[]; widths:FanOutWidthView[] }
export interface FanOutDigest { latest:(FanOutProfileView&{profile:import('../src/fanout-capacity.js').FanOutProfile})|null; history:FanOutProfileView[] }
/** Result of the last arm's Wave 1 preregistration for one release (absent until an arm reaches that step). */
export interface ArbitrationManifestView { status:'ready'|'blocked'; targetDate:string; releaseMs:number;
  /** true when an existing matching preregistration was verified and reused. */ verified?:boolean; createdAt?:string; code?:string; reason?:string }
export interface Dashboard {
  phase3?:{fitness?:string;cache?:string;seq?:number;outcome?:string;frozen?:boolean;
    attempts:Array<{workerId:string;candidateId:string;wave:string;state:string}>};
  precision?:PrecisionView|null;
  /** Current run by logical target and fan-out child, prewarm tiers and Rescue predictions (Live view). */
  live?:LiveRunView|null;
  /** Fan-out Capacity Profile of this machine (Strategy recommendation, History & Insights). */
  fanOut?:FanOutDigest|null;
  /** Recent release dispatch telemetry (History & Insights). */
  telemetry?:import('../src/release-telemetry.js').RunTelemetry[];
  releaseReadiness?:import('../src/release-readiness-gate.js').ReleaseReadinessGate;
  /** Deterministic forecast for the exact saved PRECISION_PHASE3 Wave 1 authorization. */
  shotgunTiming?:import('../src/shotgun-timing.js').ShotgunTimingReadiness|null;
  /** Why the latest calibration does or does not authorize live Shotgun (READY is the only pass). */
  shotgunTimingVerdict?:import('../src/shotgun-timing.js').ShotgunTimingVerdict|null;
  /** The saved plan's booking date against the next release target; a STALE plan cannot be armed. */
  planDate?:import('../src/release-plan-date.js').SavedPlanDate|null;
  /** Pre-release security check for the saved plan: genuine verification minutes before release; only PASSED is evidence. */
  securityCheck?:import('../src/security-check.js').SecurityCheckVerdict|null;
  prewarmFeasibility?:import('../src/api-booking/prewarm-feasibility.js').PrewarmFeasibilityResult|null;
  /** Customer-identity problems found by the latest preparation or run (worker letters and codes only). */
  identityIssues?:string[];
  bookingResult?:Extract<UiEvent,{type:'bookingResult'}>;
  workflow?:'test'|'release';
  preparedAt?:number;
  preparedContext?:PreparedContext|null;
  browserHealth?:Record<WorkerId,boolean>;
  assumedPrice?:number|null;
  playerStatus?:{primary:boolean;extended:boolean;third:boolean;fourth:boolean;fifth?:boolean;sixth?:boolean;seventh?:boolean;eighth?:boolean;primaryDetails?:{fullName:string;phone:string;email:string};extendedDetails?:{fullName:string;phone:string;email:string};thirdDetails?:{fullName:string;phone:string;email:string};fourthDetails?:{fullName:string;phone:string;email:string};fifthDetails?:{fullName:string;phone:string;email:string};sixthDetails?:{fullName:string;phone:string;email:string};seventhDetails?:{fullName:string;phone:string;email:string};eighthDetails?:{fullName:string;phone:string;email:string}};
  dualWorkers?:Partial<Record<'A'|'B',Extract<UiEvent,{type:'dualWorker'}>>>;
  dualResult?:Extract<UiEvent,{type:'dualResult'}>|null;
  dualValidation?:{selection:boolean;full:boolean};
  dualActive?:boolean;
  releasePerformance?: Extract<UiEvent, { type: 'releasePerformance' }>['summary'] | null;
  lockReview?:LockReview|null;
  courtBrowser?:Extract<UiEvent,{type:'courtBrowser'}>|null;
  /** State of the one-click read-only availability check (independent of booking preparation). */
  availabilityCheck?:{status:'RUNNING'|'DONE'|'FAILED';date:string;startedAt:string;finishedAt?:string;code?:string}|null;
  operation: 'idle' | 'scheduled' | 'chrome' | 'inspect' | 'prepare' | 'confirming' | 'observe' | 'selection' | 'full' | 'dry' | 'practice' | 'stopping' | 'saving' | 'reviewing' | 'clearing' | 'resetting' | 'fullPractice' | 'apiPreview' | 'blockAudit' | 'closingBrowsers' | 'checkingSecurity' | 'calibrating';
  /** Live read-only court/hour observation around the next or current release. */
  slotWatch?:SlotWatchView|null;
  slotWatchHistory?:SlotWatchDigest[];
  /** Post-run forensic digests (newest first) for the Runs view. */
  releaseForensics?:ReleaseForensicsDigest[];
  /** Latest derived Release Lab summary; raw logs remain authoritative. */
  releaseLab?:ReleaseLabDigest|null;
  /** Phase 4 derived release intelligence (read-only digest). */
  intelligence?:IntelligenceDigest|null;
  phase4?:{busy:'rebuild'|'network'|null;message:string;networkReadiness?:ReadinessResult|null;networkHistory?:Array<{measuredAt:string;verdict:string;medianMs:number|null}>;warmth?:WarmthAssessment|null};
  /** Provenance of the running build (dist/build-info.json); null when started without a clean build. */
  build?:import('../src/build-info.js').BuildInfo|null;
  headline: string; detail: string; ready: boolean; cdp: boolean; lock: boolean;
  canPrepareOverHold?:boolean;
  retainedLockStage?:'HOLD_VERIFIED'|'FINAL_ACTION_DISPATCHING'|null;
  previousHolds?:PreviousHold[];
  inspection: Inspection | null; clock: ReturnType<typeof clockStatus> | null;
  plan: Extract<UiEvent, { type: 'plan' }> | null; logs: Activity[]; liveRace: boolean;
  booking: BookingView | null; termsAuthorized: boolean; apiFirstReady?: boolean;
  apiStage?:Extract<UiEvent,{type:'apiStage'}>|null;
  blockAudit?:Extract<UiEvent,{type:'blockAudit'}>|null;
  observedPrice?:number|null;
  qrHandoffs?:QrHandoffSummary[];
  runTiming?:RunTiming|null;
  runHistory?:RunHistoryEntry[];
  bookingAdjustment?:FallbackReconciliation|null;
  scheduledRelease?:ScheduledReleaseContext|null;
  /** Display-only record of the authorized API release owned by the active runner. */
  activeApiRelease?:{releaseMs:number;targetDate:string;phase:'PREPARING'|'WAITING'|'RUNNING'|'FAILED'}|null;
  sleepProtection?:boolean;
  /** The latest failure needing the operator: typed category, step, worker, retry safety and one recovery. */
  attention?:import('../src/preparation-failure.js').ClassifiedFailure|null;
  /** Saved-plan fingerprint the current preparation belongs to (null when nothing is prepared). */
  preparedPlanFingerprint?:string|null;
  /** Runtime events the UI contract rejected (stage, field paths and validation codes only). */
  protocolIssues?:Array<{at:string;text:string}>;
  /** Accounting of the latest release run: planned, prepared, initiated, holds, rejected, unsent, unknown. */
  runSummary?:import('../src/run-outcome.js').RunOutcomeSummary|null;
  /** Local source checkout compared with the installed build (read-only, from the Source folder's git metadata). */
  sourceStatus?:{headSha:string|null;branch:string|null;readAt:string}|null;
  /** The canonical updater's last lifecycle preflight (counts only), as of its own timestamp. */
  updatePreflight?:{gitSha:string|null;checkedAt:string;eligibility:string;blockers:number;historicalUnknown:number}|null;
  arbitrationManifest?:ArbitrationManifestView|null;
  scheduleStatus?:'WAITING'|'WAKE / RECONNECT'|'FINAL PREFLIGHT'|'RUNNING'|'MISSED'|null;
  capabilities: { selectionReady:boolean; checkoutReady:boolean; paymentBoundaryReady:boolean };
  selection: Extract<UiEvent, {type:'selection'}> | null;
  mode:'selection'|'full'; handoff:Extract<UiEvent,{type:'handoff'}>|null;
}
export interface Bridge {
  onLabPhase?(callback:(phase:string)=>void):()=>void;
  shotgunLab(request:{action:'defaults'|'preview'|'previewObjective'|'save'|'load'|'run'|'stop';value?:unknown}):Promise<any>;
  objective(request:{action:'load'|'save'|'savePresets'|'validateRelease';value?:unknown;binding?:{objectiveFingerprint:string;configFingerprint:string}|null}):Promise<any>;
  journalArchive(request:{action:'overview'|'verify'|'archive'|'restore';keys?:string[];note?:string}):Promise<any>;
  syncClock():Promise<void>;
  focusBrowser(request:{workerId:WorkerId;bookingId?:string}):Promise<BrowserFocusResult>;
  closeBotBrowsers():Promise<void>;
  /** Pre-release security check for the prepared saved plan (genuine verification, value discarded, nothing submitted). */
  checkSecurity():Promise<void>;
  /** Local-only timing calibration of the saved Shotgun plan (nothing reaches Onda). */
  calibrateTiming():Promise<void>;
  watchNextRelease():Promise<void>;
  stopSlotWatch():Promise<void>;
  rebuildIntelligence():Promise<void>; clearIntelligence():Promise<void>; runNetworkCheck():Promise<void>;
  replayPlan(input:{source:'saved'}|{source:'draft';phase3:unknown}|{source:'draft';targets:unknown}):Promise<ReplaySummary>;
  adviseFromHistory(input:Record<string,unknown>):Promise<AdvisorResult|{blocked:string}>;
  strategyEvidence(input:{targetDate:string;ranges:import('../src/strategy-engine.js').Window[]}):Promise<import('../src/strategy-engine.js').StrategyHistoricalEvidence>;
  resetPrepare(input:PreparationInput):Promise<void>;
  browseCourts(date:string):Promise<void>;
  apiPreview(date:string):Promise<void>;
  checkReleaseBlocks(date:string):Promise<void>;
  testBooking(input:TestBookingInput):Promise<void>;
  setWorkflow(workflow:'test'|'release'):Promise<void>;
  invalidatePreparation():Promise<void>;
  prepareDual():Promise<void>;
  runDualPractice(input:DualPracticeCommand):Promise<void>;
  reviewLock():Promise<void>; clearLock():Promise<void>; resetPractice():Promise<void>; runFullPractice(input:FullPracticeInput):Promise<void>;
  startChrome(): Promise<void>; inspectOnda(): Promise<void>; prepare(): Promise<void>;
  armObservation(): Promise<void>; abortAutomation(): Promise<void>; getStatus(): Promise<Dashboard>;
  saveBooking(input: BookingSetup): Promise<void>; armSelection(): Promise<void>; dryRace(): Promise<void>; runPractice(input:PracticeInput): Promise<void>;
  setMode(mode:'selection'|'full'):Promise<void>; authorizeTerms(value:boolean):Promise<void>; armFullBooking():Promise<void>; cancelScheduledRelease():Promise<void>;
  onStatus(callback: (status: Dashboard) => void): () => void;
  onConfirmRequest(callback: (request: ConfirmRequest) => void): () => void;
  confirmResponse(id: string, confirmed: boolean): Promise<void>;
}
