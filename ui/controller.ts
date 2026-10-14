import {SHOTGUN_MAX_TRIGGER_LATENESS_MS,shotgunCriticalInterval} from '../src/shotgun.js';
import {exactShotgunTopology,assertShotgunSchedule,assertShotgunPrewarm,assertShotgunTabs,readShotgunTiming,shotgunBrowserVersion} from '../src/shotgun-timing.js';
import { PreparationSchema, TestBookingSchema, type BookingPlan } from '../src/booking-plan.js';
import { z } from 'zod';
import { DualPracticeSchema, requireDualFullAuthorization } from '../src/dual-practice.js';
import type { DualPracticeCommand } from './types.js';
import {FullPracticeSchema,type FullPracticeInput} from '../src/full-practice.js';
import type {LockReview} from './locks.js';
import type { UiEvent } from '../src/ui-events.js';
import type { Runner, RunningCommand } from './processes.js';
import { assertWingNormalRequest } from '../src/wing-normal-booking.js';
import type { ApiRunPreferences, Command, Dashboard, QrHandoffSummary } from './types.js';
import type { ActivityJournal } from './activity-journal.js';
import { randomUUID } from 'node:crypto';
import type { readClock } from './status.js';
import type { RetainedHoldStatus } from './status.js';
import type { BookingView } from './booking.js';
import { PracticeSchema } from '../src/practice.js';
import { BookingSetupSchema } from '../src/config.js';
import {bookingSetupProblem,reconcileBookingSetupFallbacks,type FallbackReconciliation} from '../src/booking-setup.js';
import { capabilities,fullBookingReady } from '../src/capabilities.js';
import {expectedPreparationFingerprint,makePreparedContext} from '../src/prepared-context.js';
import type {PreparationInput,PreparationResult} from '../src/booking-plan.js';
import {scheduledReleaseContext,type ScheduledReleaseContext} from '../src/scheduled-release.js';
import {formatReleaseOffset} from '../src/release-offset.js';
import {normalWorkerIds,planWorkerIds,requiredWorkerIds,type CourtCount,type WorkerId} from '../src/workers.js';
import type {SlotWatchCandidate,SlotWatchDigest,SlotWatchSummary,SlotWatchView} from '../src/slot-watch.js';
import type {AvailabilityObservation} from '../src/slot-evidence.js';
import type {ReleaseForensicsDigest} from '../src/release-forensics.js';
import type {ReleaseLabDigest} from '../src/release-lab-analysis.js';
import {PrecisionPhase3Schema,PrecisionTargetSchema} from '../src/config.js';
import type {IntelligenceDigest,IntelligenceSummary} from '../src/release-intelligence.js';
import type {AdvisorInput,AdvisorResult} from '../src/release-advisor.js';
import {STRATEGY_MAX_ENUMERATED_WINDOWS,type StrategyHistoricalEvidence,type Window as StrategyWindow} from '../src/strategy-engine.js';
import type {ReplayPlan,ReplayResult} from '../src/strategy-replay.js';
import type {ReadinessResult} from '../src/network-readiness.js';
import {evaluateReleaseReadiness,type MachineHealth} from '../src/release-readiness-gate.js';
import {evaluatePrewarmFeasibility} from '../src/api-booking/prewarm-feasibility.js';
import {securityPrepHistory} from '../src/security-prep-history.js';
import type {WarmthAssessment} from '../src/checkout-path-research.js';
import {TARGET_EVIDENCE_LABEL,type TargetEvidence} from '../src/api-booking/pre-release-evidence.js';
import type {PrecisionView} from './types.js';
import {reduceLiveRun} from './live-run.js';
import type {EnsureManifestResult} from '../src/arbitration/experiment-manifest.js';

/** Race-group headline: the operator's goal is one court, so any verified hold achieves it. */
const PRECISION_OUTCOME_HEADLINE:Record<string,string>={
  OBJECTIVE_ACHIEVED:'OBJECTIVE ACHIEVED · 1 temporary QR hold',
  OBJECTIVE_ACHIEVED_EXTRA_HOLD:'OBJECTIVE ACHIEVED · EXTRA HOLD — more than one temporary QR hold exists',
  OBJECTIVE_ACHIEVED_UNRESOLVED_EXTRA_ATTEMPT:'OBJECTIVE ACHIEVED · UNRESOLVED EXTRA ATTEMPT — another attempt may also hold a court',
  OBJECTIVE_NOT_CONFIRMED_MANUAL_RECONCILIATION:'OBJECTIVE NOT CONFIRMED · MANUAL RECONCILIATION REQUIRED',
  OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED:'OBJECTIVE NOT ACHIEVED · ALL REJECTED',
  OBJECTIVE_NOT_ACHIEVED_NOTHING_DISPATCHED:'OBJECTIVE NOT ACHIEVED · NOTHING DISPATCHED',
};
const precisionOutcomeHeadline=(code:string|undefined)=>code?PRECISION_OUTCOME_HEADLINE[code]:undefined;
/** Operator text for an invalid customer identity. Uses worker letters and codes only, never a customer ID. */
function identityIssueText(event:{workerId?:string;code?:string;duplicateOf?:string},precision:boolean){
  const problem=event.code==='DUPLICATE_ONDA_CUSTOMER_ID'&&event.duplicateOf?`duplicates Worker ${event.duplicateOf}`:event.code??'binding invalid';
  return `Worker ${event.workerId} — customer identity invalid: ${problem}`+(precision?`. Worker ${event.workerId} will not dispatch; the other valid Precision attempts remain usable.`:'. This plan cannot run until it is fixed.');
}
export const PRECISION_STATE_LABEL:Record<string,string>={
  EXCLUDED_BEFORE_FREEZE:'NOT DISPATCHED — excluded before freeze',BROWSER_FAILED:'NOT DISPATCHED — browser failed',
  IDENTITY_FAILED:'NOT DISPATCHED — player/customer binding missing',JOURNAL_BLOCKED:'NOT DISPATCHED — earlier attempt on record',
  PREWARM_FAILED:'NOT DISPATCHED — PREWARM FAILED',WINDOW_MISSED:'NOT DISPATCHED — window missed',NOT_DISPATCHED:'NOT DISPATCHED',
  REJECTED:'REJECTED by Onda',UNKNOWN:'UNKNOWN — may have been sent; do not retry',HOLD_VERIFIED:'HOLD VERIFIED',
  HOLD_VERIFIED_QR_ATTENTION:'HOLD VERIFIED · QR HANDOFF NEEDS ATTENTION',QR_READY:'HOLD VERIFIED · QR READY',
};

const preparationHeadlines:Record<string,string>={EXTENDED_PLAYER_INFO_MISSING:'EXTENDED PLAYER REQUIRED',PLAYER_INFO_MISSING:'PLAYER CONFIGURATION REQUIRED',TARGET_DATE_UNAVAILABLE:'TARGET NOT AVAILABLE',TARGET_NOT_AVAILABLE:'TARGET NOT AVAILABLE',PAYMENT_HOLD_MAY_BE_ACTIVE:'PAYMENT HOLD ACTIVE',LOCK_PID_RUNNING:'AUTOMATION STILL RUNNING',TODAYS_RELEASE_PASSED:"TODAY'S RELEASE HAS PASSED",CHROME_NOT_INSTALLED:'CHROME NOT INSTALLED',CHROME_START_TIMEOUT:'DEDICATED CHROME DID NOT START',CHROME_START_FAILED:'DEDICATED CHROME DID NOT START',CDP_ENDPOINT_UNAVAILABLE:'DEDICATED CHROME UNAVAILABLE',ONDA_TAB_AMBIGUOUS_OR_MISSING:'ONDA TAB NOT READY',WRONG_VENUE:'WRONG VENUE'};
const errors: Record<string, string> = {
  DIRECT_AVAILABILITY_READ_FAILED:'Onda availability could not be read after bounded retries. Nothing was sent; the release stopped safely.',
  DIRECT_TARGET_DATE_STATE_UNKNOWN:'Onda returned an unexpected availability shape for the target date. Nothing was sent; the release stopped safely.',
  NETWORK_CLOCK_STALE:'The Google network clock could not be refreshed and the last sync is too old. Nothing was sent.',
  PRECISION_NO_ELIGIBLE_TARGET:'No Precision target is currently eligible (public booking or unknown evidence on every target). Edit the targets.',
  PRECISION_TOO_LATE_TO_ARM:'Precision Release must be armed at least 3 minutes before release so the target set can be frozen at T-2 min.',
  PREWARM_PLAN_NOT_FEASIBLE:'The exact saved Wave 1 plan has projected preparation omissions. Edit the Strategy and save a new PRECISION_PHASE3 authorization before arming.',
  SHOTGUN_PLAN_INCOMPATIBLE_POSITIVE_OFFSET:'This saved Shotgun plan contains a post-release offset. It remains visible for review but cannot be armed. Edit it to -2000 through 0 ms and save a new exact schedule.',
  SHOTGUN_PREWARM_NOT_FULLY_READY:'Shotgun timing is not fully ready on this machine. Reduce the shot count, widen the timing schedule, or prepare again.',
  SHOTGUN_TOPOLOGY_NOT_READY:'The exact Shotgun browser tabs are not ready. Reset & Prepare, then check every required browser group.',
  SHOTGUN_TIMING_NOT_READY:'The matching local Shotgun timing test failed or showed compression. Reduce the shot count, widen the schedule, or test again.',
  SHOTGUN_MACHINE_NOT_READY:'Machine load exceeds the strict Shotgun timing allowance. Prepare again when the machine is less busy.',
  PREWARM_FEASIBILITY_UNAVAILABLE:'Preparation feasibility for the exact saved Wave 1 plan is unavailable. Reset & Prepare, then recheck Release Readiness before arming.',
  ARBITRATION_MANIFEST_STORAGE_FAILED:'Investigation setup could not be saved. Nothing was armed. Check that the app can write to its local data folder, then try again.',
  ARBITRATION_MANIFEST_MISMATCH:'An investigation setup already exists for this release but does not match the current release. Nothing was armed.',
  ARBITRATION_MANIFEST_MALFORMED:'The saved investigation setup for this release is damaged; it was kept, not replaced. Nothing was armed.',
  ARBITRATION_MANIFEST_TOO_LATE:'The investigation setup must be created before the release. This release was not armed.',
  ARBITRATION_RELEASE_CONTEXT_INVALID:'The release date or time could not be verified. Nothing was armed.',
  ARBITRATION_MANIFEST_UNAVAILABLE:'This app build cannot create the investigation setup. Nothing was armed.',
  PRECISION_TOO_LATE_TO_FREEZE:'The Precision target set could not be frozen before release. Nothing was sent.',
  SHOTGUN_LIVE_ATTESTATION_REQUIRED:'Live Shotgun is a pilot: arming requires your explicit attestation for this exact plan. Nothing was armed.',
  SHOTGUN_IMMEDIATE_BURST_BLOCKED:'A Shotgun burst against currently open slots is not offered. Use Available Now (Normal) for open dates.',
  BUKO_SCHEDULED_LIVE_BLOCKED:'Buko scheduled release is offline-only: the Buko release policy is owner-assumed and Buko proofless checkout is unverified. Book open Buko dates with Available Now.',
  SHOTGUN_LIVE_COMPATIBILITY_UNVERIFIED:'Live Shotgun is blocked: proofless release checkout and provider request-rate permission remain unverified. You can edit, save and test the plan offline.',
  AVAILABILITY_BROWSER_PREPARATION_REQUIRED:'Prepare and verify the booking browser before checking live availability.',
  AVAILABILITY_CHECK_RUNNING:'An availability check is already running. Wait for it to finish.',
  AVAILABILITY_CHECK_REFUSED_ACTIVE_RUN:'Availability checks are paused while a release is armed or an automation is running, so they cannot compete with dispatch.',
  AVAILABILITY_CHECK_FAILED:'Availability could not be read. Every cell stays UNKNOWN; nothing was booked.',
  OBSERVER_PROFILE_BUSY:'The availability observer window from a previous check is still open. Close it, then check again.',
  OBSERVER_START_TIMEOUT:'The availability observer Chrome did not start in time. Check that Google Chrome is installed, then try again.',
  OBSERVER_VENUE_UNVERIFIED:'The observer could not verify the Thirsty Pickle booking page. Availability stays UNKNOWN.',
  PRECISION_REQUIRES_PROOFLESS_STANDARD:'Precision Release uses Proofless Direct with Standard 1-3 hour targets.',
  OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED:'Every dispatched Precision attempt was rejected by Onda. No hold was created.',
  OBJECTIVE_NOT_ACHIEVED_NOTHING_DISPATCHED:'No Precision attempt was dispatched. See each attempt for the reason.',
  OBJECTIVE_NOT_CONFIRMED_MANUAL_RECONCILIATION:'An attempt may have been sent without a confirmed outcome. DO NOT retry. Check Onda and Chrome manually; the lock is retained.',
  DUPLICATE_ONDA_CUSTOMER_ID:'Two workers in this plan share one Onda customer ID. Fix ONDA_CUSTOMER_*_ID in .local/private/.env.local. Nothing was sent.',
  PRECISION_NO_VALID_CUSTOMER_IDENTITY:'No Precision worker has a valid, unique Onda customer identity. Nothing was sent.',
  EXTENDED_DURATION_LIMIT:'Extended two-browser booking currently supports up to 6 consecutive hours.',
  PAYMENT_HOLD_MAY_BE_ACTIVE:'A retained payment hold may still be active. Reset & Prepare cannot clear it until its timer has elapsed and the browser is verified clean.',
  TARGET_NOT_AVAILABLE:'TARGET NOT AVAILABLE. No booking was created.',
  LOCK_PID_RUNNING:'AUTOMATION STILL RUNNING. Stop the external run first, then Reset & Prepare.',
  AUTOMATION_STILL_RUNNING:'AUTOMATION STILL RUNNING. Stop the external run first, then Reset & Prepare.',
  STOP_NOT_CONFIRMED:'STOP NOT CONFIRMED. Reset was not performed.',
  EXTENDED_PLAYER_INFO_MISSING:'EXTENDED PLAYER CONFIGURATION REQUIRED',
  TARGET_DATE_UNAVAILABLE:'TARGET NOT AVAILABLE. Choose a reachable date, then Reset & Prepare.',
  LOCK_SELECTED_SLOTS:'SELECTED SLOTS STILL PRESENT. Inspect and clear them manually, then Review Lock again.',
  LOCK_PAYMENT_HOLD_ACTIVE:'PAYMENT HOLD ACTIVE. Complete payment, cancel manually if appropriate, or wait for expiry; then return to a clean schedule and Review Lock.',
  LOCK_BROWSER_STATE_UNKNOWN:'Browser state is unknown or not a clean schedule. Manual review required.',
  PRACTICE_RESET_HOLD_ACTIVE:'A QR/payment hold is still recorded. Complete, cancel, or let that hold expire in Chrome before resetting practice.',
  PRACTICE_RESET_FAILED:'The dedicated practice browser could not be reset safely. Check Chrome manually and try again.',
  PRACTICE_RESET_UNAVAILABLE:'Practice reset is unavailable in this build.',
  DEDICATED_CHROME_NOT_IDENTIFIED:'The CDP port belongs to an unidentified Chrome process. Close it manually before resetting practice.',
  DEDICATED_CHROME_CLOSE_TIMEOUT:'Dedicated Chrome did not close in time. Check it manually before resetting practice.',
  PRACTICE_TARGET_UNAVAILABLE:'PRACTICE TARGET NOT AVAILABLE. No alternative court or time will be selected.',
  PRACTICE_DATE_UNAVAILABLE:'This date is not available through the normal Onda calendar.',
  TERMS_AUTHORIZATION_REQUIRED:'Authorize accepting Onda Terms for this run first.',
  TERMS_STRUCTURE_CHANGED:'Onda Terms checkbox could not be uniquely identified in Payment Summary. Automation stopped for manual review.',
  TERMS_NOT_ACTIONABLE:'The Onda Terms checkbox is not visible or enabled in Payment Summary. Automation stopped.',
  TERMS_NOT_CHECKED:'Onda Terms were not confirmed in Payment Summary. The payment handoff was not dispatched.',
  PLAYER_INFO_MISSING:'Player information is missing or invalid. Configure local player information first.',
  QR_HANDOFF_FAILED:'QR handoff could not be verified. Inspect Chrome manually; the lock remains active.',
  AUTOMATION_LOCK_EXISTS: 'Automation lock exists. Use Review Lock. Booking actions are blocked; local booking settings can still be edited and saved.',
  CDP_PROFILE_OR_BIND_UNVERIFIED: 'Chrome/CDP unavailable or dedicated profile not verified. Use Start / Attach Chrome.',
  WRONG_CHROME_PROFILE: 'Port 9222 belongs to a different Chrome profile.',
  CDP_ENDPOINT_UNAVAILABLE:'No safe local debugging endpoint is available for the dedicated Chrome browser.',
  CHROME_NOT_INSTALLED:'Google Chrome is not installed or could not be found.',
  CHROME_START_TIMEOUT:'Dedicated Chrome did not become ready in time. Reset & Prepare can be retried safely.',
  CHROME_START_FAILED:'Dedicated Chrome could not be started. Check Activity, then retry Reset & Prepare.',
  PREPARATION_INPUT_INVALID:'The preparation request was invalid. Review the current fields and retry Reset & Prepare.',
  ONDA_TAB_AMBIGUOUS_OR_MISSING: 'Leave exactly one Thirsty Pickle booking tab open in dedicated Chrome.',
  WRONG_VENUE: 'The expected Thirsty Pickle venue was not verified.',
  TOO_LATE_FOR_PREFLIGHT: 'Too late for today’s preflight. Prepare again before the next release; no observation was scheduled.',
  STALE_OR_INCOMPLETE_GRID: 'Today’s grid is not verified. Select today and All Courts in Chrome, then Prepare again.',
  SECURITY_CHALLENGE: 'Onda requires a human/security check. Automation stopped.',
  RATE_LIMITED: 'Onda reported rate limiting. Automation stopped.',
  PREEXISTING_SELECTION: 'Selected slots are present. Clear them manually in Chrome before preparing.',
  TAB_NOT_VISIBLE: 'Keep the Onda tab visible, active and not minimized.',
  CHROME_DISCONNECTED: 'Chrome disconnected. Automation stopped; prepare a new run manually.',
  CONFIG_INVALID: 'Booking or local player configuration is invalid. Review Booking Setup and the local player fields.',
  COURT_FILTER_NOT_ALL: 'Select All Courts in Chrome, then Prepare again.',
  RESET_REQUIRED:'RESET REQUIRED. Press Reset & Prepare for these settings.',
  TODAYS_RELEASE_PASSED:"TODAY'S RELEASE HAS PASSED. This release can no longer be armed today.",
  API_FIRST_METHOD_REQUIRED:'API-FIRST must be selected before running the read-only API preview.',
  API_FIRST_LIVE_CHECKOUT_BLOCKED:'API-FIRST reservation submission is disabled until Oonda provides a supported current security context and checkout handoff.',
  API_FIRST_COURT_COUNT_UNSUPPORTED:'API-FIRST supports one to four courts.',
  LOCAL_CUSTOMER_ID_UNVERIFIED:'Primary API customer binding is missing or does not match the configured primary player.',
  LOCAL_EXTENDED_CUSTOMER_ID_UNVERIFIED:'Extended API customer binding is missing or does not match the configured Extended player.',
  LOCAL_PLAYER_C_CUSTOMER_ID_UNVERIFIED:'Player 3 API customer binding is missing or does not match Player 3.',
  LOCAL_PLAYER_D_CUSTOMER_ID_UNVERIFIED:'Player 4 API customer binding is missing or does not match Player 4.',
  LOCAL_PLAYER_E_CUSTOMER_ID_UNVERIFIED:'Player 5 API customer binding is missing or does not match Player 5.',
  LOCAL_PLAYER_F_CUSTOMER_ID_UNVERIFIED:'Player 6 API customer binding is missing or does not match Player 6.',
  LOCAL_PLAYER_G_CUSTOMER_ID_UNVERIFIED:'Player 7 API customer binding is missing or does not match Player 7.',
  LOCAL_PLAYER_H_CUSTOMER_ID_UNVERIFIED:'Player 8 API customer binding is missing or does not match Player 8.',
  THIRD_PLAYER_INFO_MISSING:'Player 3 configuration is missing, invalid, or duplicates another player.',
  FOURTH_PLAYER_INFO_MISSING:'Player 4 configuration is missing, invalid, or duplicates another player.',
  API_EXTENDED_WORKER_MISSING:'Both dedicated API browsers and both player profiles are required for Extended.',
  DUPLICATE_LOGICAL_BOOKING_BLOCKED:'This exact court, date, and time already has a durable submission record. The API runner will use another available court after Reset & Prepare.',
  API_NO_UNUSED_CANDIDATE:'Available courts still have active or unresolved submission records. Expired verified holds and confirmed rejected attempts are archived for reuse; uncertain outcomes remain blocked.',
  NETWORK_CLOCK_SYNC_REQUIRED:'Synchronize with Google Public NTP before arming Release.',
  NETWORK_CLOCK_SYNC_FAILED:'Google Public NTP could not be verified. Release remains unarmed.',
  CLOSE_BROWSERS_UNAVAILABLE:'Closing bot browsers is not available in this build.',
  BOT_BROWSER_CLOSE_FAILED:'The bot browsers could not be checked or closed. Close the THIRSTY BOT Chrome windows manually.',
  BOT_BROWSER_CLOSE_TIMEOUT:'Some bot Chrome windows did not close in time. Close them manually from the taskbar.',
  SLOT_WATCH_UNAVAILABLE:'Release slot watch is not available in this build.',
};
/** A slot watch the controller started, and why; manual watches are only stopped explicitly. */
interface SlotWatchHandle { id:string; reason:'release'|'manual'; date:string; releaseMs:number; stop(reason:string):Promise<unknown>; done:Promise<SlotWatchSummary> }
export interface Dependencies {
  activityJournal?:Pick<ActivityJournal,'begin'|'record'|'ready'|'handoff'|'end'|'history'>;
  /** Live Shotgun pilot: explicit owner attestation for this exact plan (warning dialog). Absent means refuse. */
  confirmShotgunLive?:(plan:BookingView)=>Promise<boolean>;
  recordShotgunAttestation?:(record:{fingerprint:string;targetDate:string;releaseMs:number;attempts:number})=>void;
  confirmStopPrepare?:()=>Promise<boolean>;
  confirmBooking?:(plan:BookingPlan,maximum?:number)=>Promise<boolean>;
  confirmApiTest?:(input:{wing?:'MANGO'|'BUKO';method:'api-first'|'proofless';strategy:'standard'|'extended';date:string;start:string;duration:number;courtCount:CourtCount;maximum?:number;priority:number[];workers?:WorkerId[]})=>Promise<boolean>;
  runner: Runner; lock(): Promise<boolean>; cdp(): Promise<boolean>; clock: typeof readClock; syncClock?():Promise<void>;
  /** Creates or verifies the Wave 1 preregistration manifest in the app's .local (main process), before the runner starts. */
  ensureArbitrationManifest?(input:{targetDate:string;releaseMs:number;clockOffsetMs:number}):EnsureManifestResult;
  retainedHold?():Promise<RetainedHoldStatus|null>;
  recentQrHandoffs?(expiresAt:string):Promise<QrHandoffSummary[]>;
  previousHolds?():Promise<Dashboard['previousHolds']>;
  browserHealth?():Promise<Partial<Record<WorkerId,boolean>>>;
  browserReadiness?():Promise<Partial<Record<WorkerId,{connected:boolean;commandLatencyMs:number|null;tabCount:number;targetReady:boolean;chromeVersion?:string|null}>>>;
  playerStatus?():Pick<NonNullable<Dashboard['playerStatus']>,'primary'|'extended'> & Partial<NonNullable<Dashboard['playerStatus']>>;
  confirm(kind?: 'observe'|'selection'|'dry'|'full', plan?:BookingView): Promise<boolean>; publish(status: Dashboard): void;
  booking(): BookingView; saveBooking(input:unknown): BookingView;
  reviewLock?(owned:boolean):Promise<LockReview>;
  clearLock?(fingerprint:string,owned:()=>boolean):Promise<void>;
  confirmClear?(review:LockReview):Promise<boolean>;
  resetPractice?():Promise<void>;
  confirmReset?():Promise<boolean>;
  confirmPractice?(input:FullPracticeInput):Promise<boolean>;
  dualEvidence?():Promise<{selection:boolean;full:boolean}>;
  confirmDualPractice?(input:DualPracticeCommand):Promise<boolean>;
  handoff?():Promise<Dashboard['handoff']>;
  startSleepProtection?():number;
  stopSleepProtection?(id:number):void;
  countBotBrowsers?():Promise<number>;
  closeBotBrowsers?():Promise<{found:number;closed:number;forced:number}>;
  confirmCloseBrowsers?(input:{open:number;qrPages:number;lock:boolean}):Promise<boolean>;
  startSlotWatch?(input:{date:string;releaseMs:number;clockOffsetMs:number;clockSynced:boolean;candidates?:SlotWatchCandidate[]},onUpdate:(view:SlotWatchView)=>void,
    onObservation?:(observation:AvailabilityObservation)=>void):{id:string;done:Promise<SlotWatchSummary>;stop(reason:string):Promise<SlotWatchSummary>};
  slotWatchHistory?():SlotWatchDigest[];
  /** Builds the post-run forensic report from local files (after the runner has exited). */
  buildReleaseForensics?(input:{runId:string;status:'preliminary'|'final'}):ReleaseForensicsDigest|undefined;
  releaseForensicsHistory?():ReleaseForensicsDigest[];
  releaseLabHistory?():ReleaseLabDigest[];
  /** Phase 4 (desktop main process only; never in the runner). */
  rebuildReleaseIntelligence?():IntelligenceSummary;
  clearReleaseIntelligence?():number;
  intelligenceDigest?():{digest:IntelligenceDigest;warmth:WarmthAssessment|null};
  confirmClearIntelligence?():Promise<boolean>;
  runNetworkReadiness?():Promise<ReadinessResult>;
  networkReadinessHistory?():ReadinessResult[];
  replayPlan?(plan:ReplayPlan):{results:ReplayResult[];skipped:Array<{releaseKey:string;reason:string}>};
  adviseFromHistory?(input:AdvisorInput):AdvisorResult;
  strategyEvidence?(targetDate:string,ranges:StrategyWindow[]):StrategyHistoricalEvidence;
  /** This machine's Fan-out Capacity Profiles (newest compatible one in full, for the Strategy timing presets). */
  fanOutDigest?():import('./types.js').FanOutDigest|null;
  /** Recent release dispatch telemetry (per child: configured trigger vs Chrome request, compression, prewarm headroom). */
  releaseTelemetry?():import('../src/release-telemetry.js').RunTelemetry[];
  /** Provenance of the running build (read once at startup). */
  buildInfo?():import('../src/build-info.js').BuildInfo|null;
  machineHealth?():MachineHealth;
  testedBuild?():{gitSha:string;dirty:boolean|null;finishedAt:string;packaged:boolean}|null;
}
const AdvisorRequestSchema=z.object({courts:z.array(z.number().int().min(1).max(7)).min(1).max(7),earliestStart:z.string().regex(/^(0[89]|1\d|2[0-3]):00$/),
  latestStart:z.string().regex(/^(0[89]|1\d|2[0-3]):00$/),durationHours:z.number().int().min(1).max(3),immediate:z.number().int().min(0).max(7),backups:z.number().int().min(0).max(14),
  exclude:z.array(z.object({court:z.number().int().min(1).max(7),start:z.string().regex(/^\d{2}:00$/)}).strict()).max(40).default([]),
  existing:z.array(z.object({court:z.number().int().min(1).max(7),start:z.string().regex(/^\d{2}:00$/),durationHours:z.number().int().min(1).max(3)}).strict()).max(21).default([])}).strict();
const ReplayRequestSchema=z.union([z.object({source:z.literal('saved')}).strict(),z.object({source:z.literal('draft'),phase3:PrecisionPhase3Schema}).strict(),
  z.object({source:z.literal('draft'),targets:z.array(PrecisionTargetSchema).min(1).max(7)}).strict()]);
export interface ReplaySummary {blocked?:string;plan?:'saved'|'draft';results:ReplayResult[];skipped:Array<{releaseKey:string;reason:string}>}
export class Controller {
  readonly state: Dashboard = { operation: 'idle', headline: 'RESET REQUIRED', workflow:'release', detail: 'Configure your booking, then Reset & Prepare.', ready: false,
    cdp: false, lock: false, inspection: null, clock: null, plan: null, logs: [], liveRace: fullBookingReady(), booking:null, termsAuthorized:false, apiFirstReady:false, capabilities, selection:null,mode:fullBookingReady()?'full':'selection',handoff:null,qrHandoffs:[],preparedContext:null,browserHealth:{A:false,B:false,C:false,D:false,E:false,F:false,G:false,H:false},playerStatus:{primary:false,extended:false,third:false,fourth:false},scheduledRelease:null,sleepProtection:false,scheduleStatus:null };
  private active?: RunningCommand;
  private pendingPreparation?:{input:PreparationInput;fingerprint:string;release?:BookingView;players:NonNullable<Dashboard['playerStatus']>};
  private preparationResult?:PreparationResult;
  private generation = 0;
  private scheduledTimer?:ReturnType<typeof setTimeout>;
  private sleepBlockerId?:number;
  private apiTestFingerprint?:string;
  private apiTestStrategy?:'standard'|'extended';
  private apiTestCheckoutMethod?:'proof-based'|'proofless';
  private apiTestPreferences?:ApiRunPreferences;
  private polling = false;
  private qrRecoveryChecked = false;
  private runStartedMono = 0;
  private lastLogMono = 0;
  private runReadyMono?:number;
  private apiReadyWorkers=new Set<WorkerId>();
  private workerProbes:Partial<Record<WorkerId,{connected:boolean;commandLatencyMs:number|null;tabCount:number;targetReady:boolean;chromeVersion?:string|null}>>={};
  private slotWatch?:SlotWatchHandle;
  /** The watch shown in the UI; it keeps showing its final state after it ends until another watch replaces it. */
  private displayedSlotWatchId?:string;
  /** Runner run ID of the latest API process, from its RUN_STARTED event. */
  private runnerRunId?:string;
  /** Runner runs whose forensic report waits for this slot watch (by watch ID) to finish. */
  private readonly pendingForensics=new Map<string,string[]>();
  constructor(private deps: Dependencies) {try{this.state.build=this.deps.buildInfo?.()??null;}catch{this.state.build=null;}
    try{this.state.fanOut=this.deps.fanOutDigest?.()??null;}catch{this.state.fanOut=null;}this.state.runHistory=this.deps.activityJournal?.history?.()??[];this.state.slotWatch=null;this.state.slotWatchHistory=this.readSlotWatchHistory();this.state.releaseForensics=this.readForensicsHistory();this.state.releaseLab=this.readReleaseLabHistory()[0]??null;
    this.state.phase4={busy:null,message:'',networkReadiness:this.readNetworkHistory()[0]??null,networkHistory:this.networkHistorySummary()};this.readIntelligence();}
  // Phase 4: read-only analysis in this (desktop) process only, never while a release is close or running.
  private readIntelligence(){try{const loaded=this.deps.intelligenceDigest?.();if(loaded){this.state.intelligence=loaded.digest;this.state.phase4!.warmth=loaded.warmth;}}catch{/* derived data only */}}
  private readNetworkHistory(){try{return this.deps.networkReadinessHistory?.()??[];}catch{return [];}}
  private networkHistorySummary(){return this.readNetworkHistory().slice(0,5).map(value=>({measuredAt:value.measuredAt,verdict:value.verdict,medianMs:value.medianMs}));}
  /** Refuses Phase 4 work during a run, an armed/scheduled release, a slot watch, or from 10 minutes before release. */
  phase4Blocked(options:{afterRelease?:boolean}={}):string|null{
    if(this.active||this.state.operation!=='idle')return 'A run or armed release is active. Release tools are paused until it ends.';
    if(this.slotWatch)return 'A release slot watch is running. Release tools are paused until it ends.';
    if(options.afterRelease)return null;
    try{const clock=this.deps.clock(),now=Date.now()+(clock.clockOffsetMs??0);
      if(now>=clock.releaseMs-10*60_000&&now<=clock.releaseMs+15*60_000)return 'Release tools are paused from 10 minutes before until 15 minutes after the 08:00 release.';}catch{/* no clock: allowed */}
    return null;
  }
  private phase4Message(message:string,busy:NonNullable<Dashboard['phase4']>['busy']=null){this.state.phase4={...this.state.phase4!,busy,message};this.publish();}
  /** After the final post-run report the runner has exited; retry each minute while a run or watch is still active. */
  private postRunRebuild(attempt=0){
    if(!this.deps.rebuildReleaseIntelligence)return;
    if(this.phase4Blocked({afterRelease:true})){if(attempt<30)setTimeout(()=>this.postRunRebuild(attempt+1),60_000).unref?.();return;}
    void this.rebuildIntelligence('after release',true).catch(()=>undefined);
  }
  async rebuildIntelligence(reason='operator',afterRelease=false){
    if(!this.deps.rebuildReleaseIntelligence)throw Error('INTELLIGENCE_UNAVAILABLE');
    const blocked=this.phase4Blocked({afterRelease});if(blocked){this.phase4Message(blocked);return;}
    if(this.state.phase4?.busy)return;
    this.phase4Message('Rebuilding release intelligence from local raw logs…','rebuild');
    await new Promise(done=>setImmediate(done));
    try{const summary=this.deps.rebuildReleaseIntelligence();this.readIntelligence();
      this.phase4Message(`Release intelligence rebuilt (${reason}): ${summary.realReleases} real release${summary.realReleases===1?'':'s'}, ${summary.adequateReleases} well observed, ${summary.synthetic} synthetic kept separate.`);}
    catch{this.phase4Message('Release intelligence could not be rebuilt. Raw logs are unchanged.');}
  }
  async clearIntelligence(){
    if(!this.deps.clearReleaseIntelligence)throw Error('INTELLIGENCE_UNAVAILABLE');
    const blocked=this.phase4Blocked();if(blocked){this.phase4Message(blocked);return;}
    if(this.deps.confirmClearIntelligence&&!await this.deps.confirmClearIntelligence()){this.phase4Message('Nothing was cleared.');return;}
    try{const removed=this.deps.clearReleaseIntelligence();this.state.intelligence=null;this.state.phase4!.warmth=null;
      this.phase4Message(`Derived intelligence cleared (${removed} file${removed===1?'':'s'}). Slot watch logs, journals, run logs, holds and forensics were not touched.`);}
    catch{this.phase4Message('Derived intelligence could not be cleared.');}
  }
  async runNetworkCheck(){
    if(!this.deps.runNetworkReadiness)throw Error('NETWORK_CHECK_UNAVAILABLE');
    const blocked=this.phase4Blocked();if(blocked){this.phase4Message(blocked);return;}
    if(this.state.phase4?.busy)return;
    this.phase4Message('Running a bounded read-only network check…','network');
    try{const result=await this.deps.runNetworkReadiness();this.state.phase4={...this.state.phase4!,networkReadiness:result,networkHistory:this.networkHistorySummary()};
      this.phase4Message(`Network check: ${result.verdict.replaceAll('_',' ')}.`);}
    catch{this.phase4Message('The network check could not run.');}
  }
  async replayPlan(input:unknown):Promise<ReplaySummary>{
    const blocked=this.phase4Blocked();if(blocked)return {blocked,results:[],skipped:[]};
    if(!this.deps.replayPlan)throw Error('REPLAY_UNAVAILABLE');
    const request=ReplayRequestSchema.parse(input);
    let plan:ReplayPlan;
    if(request.source==='saved'){
      const setup=this.deps.booking().setup;
      if(setup.RELEASE_STRATEGY!=='precision')return {blocked:'The saved plan is not a Precision Release plan.',results:[],skipped:[]};
      plan=setup.PRECISION_PHASE3?setup.PRECISION_PHASE3 as ReplayPlan:await import('../src/strategy-replay.js').then(module=>module.replayPlanFromFixed(setup.PRECISION_TARGETS));
    } else plan='phase3' in request?request.phase3 as ReplayPlan:await import('../src/strategy-replay.js').then(module=>module.replayPlanFromFixed(request.targets));
    if(!this.state.intelligence?.generatedAt)await this.rebuildIntelligence('before replay');
    return {plan:request.source,...this.deps.replayPlan(plan)};
  }
  async adviseFromHistory(input:unknown):Promise<AdvisorResult|{blocked:string}>{
    const blocked=this.phase4Blocked();if(blocked)return {blocked};
    if(!this.deps.adviseFromHistory)throw Error('ADVISOR_UNAVAILABLE');
    const request=AdvisorRequestSchema.parse(input);
    if(!this.state.intelligence?.generatedAt)await this.rebuildIntelligence('before suggestions');
    return this.deps.adviseFromHistory({...request,targetDate:this.deps.clock().targetDate});
  }
  async strategyEvidence(input:unknown):Promise<StrategyHistoricalEvidence>{
    if(!this.deps.strategyEvidence)throw Error('STRATEGY_EVIDENCE_UNAVAILABLE');
    const request=z.object({targetDate:z.iso.date(),ranges:z.array(z.object({court:z.number().int().min(1).max(7),start:z.string().regex(/^(0[89]|1\d|2[0-3]):00$/),durationHours:z.number().int().min(1).max(3)}).strict()).max(STRATEGY_MAX_ENUMERATED_WINDOWS)}).strict().parse(input);
    const clock=this.deps.clock();
    if(request.targetDate!==clock.targetDate)throw Error('STRATEGY_EVIDENCE_WRONG_TARGET_DATE');
    return this.deps.strategyEvidence(request.targetDate,request.ranges);
  }
  private readSlotWatchHistory(){try{return this.deps.slotWatchHistory?.()??[];}catch{return [];}}
  private readForensicsHistory(){try{this.state.telemetry=this.deps.releaseTelemetry?.()??[];}catch{this.state.telemetry=[];}try{return this.deps.releaseForensicsHistory?.()??[];}catch{return [];}}
  private readReleaseLabHistory(){try{return this.deps.releaseLabHistory?.()??[];}catch{return [];}}
  /** Post-run forensics: file reads and two small writes in this process, never in the runner, never before the runner has exited. */
  private buildForensics(runId:string,status:'preliminary'|'final'){
    if(!this.deps.buildReleaseForensics)return;
    try{
      const digest=this.deps.buildReleaseForensics({runId,status});
      this.state.releaseForensics=this.readForensicsHistory();
      this.state.releaseLab=this.readReleaseLabHistory()[0]??null;
      if(digest)this.log(`Release forensics ${status}: ${digest.reportPath}`);
    }catch{this.log('Release forensics report could not be written; the raw logs are unchanged.',true);}
    this.publish();
    if(status==='final')setImmediate(()=>this.postRunRebuild());
  }
  /** After a live API run: a final report now, or a preliminary one now and the final one when its slot watch ends. */
  private scheduleForensics(runId:string,date:string,releaseMs:number|undefined){
    const watch=releaseMs!==undefined&&this.slotWatch?.date===date&&this.slotWatch.releaseMs===releaseMs?this.slotWatch:undefined;
    if(watch)this.pendingForensics.set(watch.id,[...(this.pendingForensics.get(watch.id)??[]),runId]);
    setImmediate(()=>this.buildForensics(runId,watch?'preliminary':'final'));
  }
  /** Starts the read-only court/hour watch for one release; a watch already covering it is kept. */
  private configuredWatchCandidates():SlotWatchCandidate[]{try{const setup=this.deps.booking().setup;
    if(setup.RELEASE_STRATEGY!=='precision')return[];
    const end=(start:string,duration:number)=>`${String(Number(start.slice(0,2))+duration).padStart(2,'0')}:00`;
    if(setup.PRECISION_PHASE3){const workers=new Map(setup.PRECISION_PHASE3.wave1.map(value=>[value.candidateIndex,value.workerId]));
      return setup.PRECISION_PHASE3.candidates.map((candidate,index)=>({id:`candidate-${index+1}`,court:candidate.court,start:candidate.start,
        end:end(candidate.start,candidate.durationHours),label:`C${candidate.court} ${candidate.start}–${end(candidate.start,candidate.durationHours)}`,
        ...(workers.get(index)?{workerId:workers.get(index)}:{})}));}
    return setup.PRECISION_TARGETS.map((candidate,index)=>({id:`fixed-${index+1}`,court:candidate.court,start:candidate.start,
      end:end(candidate.start,candidate.durationHours),label:`C${candidate.court} ${candidate.start}–${end(candidate.start,candidate.durationHours)}`,
      workerId:String.fromCharCode(65+index)}));}catch{return[];}}
  private beginSlotWatch(date:string,releaseMs:number,reason:'release'|'manual'){
    if(!this.deps.startSlotWatch)return false;
    const current=this.slotWatch;
    if(current&&current.date===date&&current.releaseMs===releaseMs){if(reason==='release')current.reason='release';return true;}
    if(current){this.slotWatch=undefined;void current.stop('replaced by a newer watch').catch(()=>undefined);}
    const clock=this.deps.clock();
    let id:string|undefined;const early:SlotWatchView[]=[];
    const handle=this.deps.startSlotWatch({date,releaseMs,clockOffsetMs:clock.clockOffsetMs,clockSynced:clock.networkSynced,
      candidates:this.configuredWatchCandidates()},view=>{
      if(id===undefined){early.push(view);return;}
      if(view.id!==this.displayedSlotWatchId)return;
      this.state.slotWatch=view;this.publish();
    },observation=>{try{this.active?.sendObservation?.(observation,date,releaseMs);}catch{/* telemetry only */}});
    id=handle.id;this.displayedSlotWatchId=id;
    const watch:SlotWatchHandle={id,reason,date,releaseMs,stop:reason=>handle.stop(reason),done:handle.done};
    this.slotWatch=watch;
    const first=early.at(-1);if(first)this.state.slotWatch=first;
    this.log(`Slot watch scheduled for ${date}: every court/hour is read from 60 s before release until 15 min after${reason==='manual'?' (read only, no booking)':''}.`);
    void handle.done.then(summary=>{
      if(this.slotWatch?.id===watch.id)this.slotWatch=undefined;
      this.state.slotWatchHistory=this.readSlotWatchHistory();
      const reads=summary.availability,first=summary.publication?.firstPublished;
      this.log(`Slot watch ${summary.status} for ${summary.date}: ${reads?.answered??0} reads answered${reads?.notLaunched?` · ${reads.notLaunched} not launched`:''}${first?` · first published grid requested ${(first.requestOffsetMs/1000).toFixed(3)} s, answered ${(first.responseOffsetMs/1000).toFixed(3)} s after release`:''} · ${summary.openToUnavailable?.length??0} open → unavailable. Report: ${summary.reportPath}`);
      for(const runId of this.pendingForensics.get(watch.id)??[])this.buildForensics(runId,'final');
      this.pendingForensics.delete(watch.id);
    }).catch(()=>{if(this.slotWatch?.id===watch.id)this.slotWatch=undefined;
      if(this.state.slotWatch?.id===watch.id)this.state.slotWatch={...this.state.slotWatch,status:'stopped',inFlight:0,lastError:'OBSERVER_OFFLINE'};
      this.log('Slot Watch observer is offline. Wave 1 authorization is unchanged; Wave 2 and Rescue still require new valid evidence.',true);this.publish();
      for(const runId of this.pendingForensics.get(watch.id)??[])this.buildForensics(runId,'final');this.pendingForensics.delete(watch.id);});
    return true;
  }
  /** A cancelled or aborted release has nothing to observe; an operator-started watch keeps running. */
  private stopReleaseSlotWatchBeforeRelease(reason:string){
    const watch=this.slotWatch;
    if(watch?.reason==='release'&&Date.now()+(this.deps.clock().clockOffsetMs??0)<watch.releaseMs){this.slotWatch=undefined;void watch.stop(reason).catch(()=>undefined);}
  }
  async watchNextRelease(){
    if(!this.deps.startSlotWatch)throw Error('SLOT_WATCH_UNAVAILABLE');
    const clock=this.deps.clock();
    this.beginSlotWatch(clock.targetDate,clock.releaseMs,'manual');
    this.publish();
  }
  async stopSlotWatch(reason='stopped by operator'){
    const watch=this.slotWatch;if(!watch)return;
    this.slotWatch=undefined;await watch.stop(reason).catch(()=>undefined);this.publish();
  }
  private players():NonNullable<Dashboard['playerStatus']>{if(this.deps.playerStatus)return {third:false,fourth:false,...this.deps.playerStatus()};try{const b=this.deps.booking();return {primary:b.playerConfigured,extended:b.extendedPlayerConfigured,third:b.thirdPlayerConfigured,fourth:b.fourthPlayerConfigured,fifth:b.fifthPlayerConfigured,sixth:b.sixthPlayerConfigured,seventh:b.seventhPlayerConfigured,eighth:b.eighthPlayerConfigured};}catch{return {primary:false,extended:false,third:false,fourth:false};}}
  private forecastPrewarm(plan:BookingView){const phase3=plan.setup.PRECISION_PHASE3;if(!phase3)return null;
    const ids=new Set(phase3.wave1.map(value=>value.workerId)),availableWorkers=new Set([...ids].filter(id=>{const worker=id as WorkerId,probe=this.workerProbes[worker];
      return (probe?.connected??!!this.state.browserHealth?.[worker])&&probe?.targetReady!==false&&probe?.tabCount!==0&&!(this.state.identityIssues??[]).some(issue=>issue.startsWith(`Worker ${id} `));}));
    const groupCount=ids.size,history=securityPrepHistory('.',Math.max(1,groupCount));
    return evaluatePrewarmFeasibility({phase3,prepP95Ms:history.atConcurrency===groupCount?history.p95Ms:null,sampleCount:history.samples,availableWorkers,globalConcurrency:Math.max(1,groupCount)});
  }
  private requirePlayers(workers:readonly WorkerId[]){
    const players=this.players(),map={A:players.primary,B:players.extended,C:players.third,D:players.fourth,E:!!players.fifth,F:!!players.sixth,G:!!players.seventh,H:!!players.eighth};
    const missing=workers.find(worker=>!map[worker]);
    if(missing)throw Error(missing==='A'?'PLAYER_INFO_MISSING':missing==='B'?'EXTENDED_PLAYER_INFO_MISSING':missing==='C'?'THIRD_PLAYER_INFO_MISSING':missing==='D'?'FOURTH_PLAYER_INFO_MISSING':`PLAYER_${missing}_INFO_MISSING`);
    return players;
  }
  private releaseSetup(input:unknown):{setup:ReturnType<typeof BookingSetupSchema.parse>;reconciliation:FallbackReconciliation}{
    const repaired=reconcileBookingSetupFallbacks(input),parsed=BookingSetupSchema.safeParse(repaired.setup);
    if(!parsed.success){this.state.headline='BOOKING SETTINGS NEED ATTENTION';this.state.detail=`Check the highlighted booking fields and press Reset & Prepare again.\n${bookingSetupProblem(repaired.setup)??'The current Release booking settings are invalid.'}`;throw Error('BOOKING_SETTINGS_INVALID');}
    return {setup:parsed.data,reconciliation:repaired.reconciliation};
  }
  private clearPreparation(){this.state.preparedContext=null;this.state.preparedAt=undefined;this.state.apiFirstReady=false;this.apiTestFingerprint=undefined;this.apiTestStrategy=undefined;this.apiTestCheckoutMethod=undefined;this.apiTestPreferences=undefined;this.state.ready=false;this.state.termsAuthorized=false;}
  private stopSleepProtection(){if(this.sleepBlockerId!==undefined)this.deps.stopSleepProtection?.(this.sleepBlockerId);this.sleepBlockerId=undefined;this.state.sleepProtection=false;}
  private clearScheduled(){if(this.scheduledTimer)clearTimeout(this.scheduledTimer);this.scheduledTimer=undefined;this.state.scheduledRelease=null;this.state.scheduleStatus=null;this.stopSleepProtection();}
  async cancelScheduledRelease(reason='SCHEDULE CANCELLED'){
    if(!this.state.scheduledRelease&&this.state.operation!=='scheduled')return;
    ++this.generation;this.clearScheduled();this.state.termsAuthorized=false;this.clearPreparation();
    this.stopReleaseSlotWatchBeforeRelease('release cancelled');
    const active=this.active;this.active=undefined;if(active)await active.stop().catch(()=>{});
    this.log(reason,true);this.finishRun('cancelled');this.state.operation='idle';this.state.headline=reason;this.state.detail=reason==='RELEASE MISSED'?'The exact armed release time passed. No booking action was started. Reset & Prepare and explicitly arm a new run.':'The armed release was cancelled. Terms and preparation were cleared.';this.publish();
  }
  async invalidatePreparation(){if(this.state.scheduledRelease){await this.cancelScheduledRelease('SCHEDULE CANCELLED - SETTINGS CHANGED');return;}if(this.state.operation!=='idle')throw Error('OPERATION_ALREADY_RUNNING');this.clearPreparation();this.state.headline='SETTINGS CHANGED';this.state.detail='Press Reset & Prepare to prepare these settings.';this.publish();}
  private async health(){const observed=this.deps.browserHealth?await this.deps.browserHealth():await this.deps.cdp().then(A=>({A,B:A}));const h={A:false,B:false,C:false,D:false,E:false,F:false,G:false,H:false,...observed};this.state.browserHealth=h;this.state.cdp=h.A;return h;}
  private async requirePrepared(workflow:'test'|'release',fingerprint:string,strategy:'standard'|'extended'){
    const context=this.state.preparedContext;
    if(!context||context.workflow!==workflow||context.strategy!==strategy||context.configFingerprint!==fingerprint||this.state.workflow!==workflow)throw Error('RESET_REQUIRED');
    if(await this.deps.lock())throw Error('RESET_REQUIRED');
    const h=await this.health(),required=context.requiredBrowsers;
    if(required.some(id=>!h[id])){this.clearPreparation();throw Error('RESET_REQUIRED');}
  }
  private publish() { this.deps.publish(structuredClone(this.state)); }
  private trackIdentity(event:Extract<UiEvent,{type:'apiStage'}>){
    if(event.stage!=='CUSTOMER_IDENTITY_INVALID'||!event.workerId)return;
    const text=identityIssueText(event,this.state.booking?.setup.RELEASE_STRATEGY==='precision');
    const issues=(this.state.identityIssues??[]).filter(issue=>!issue.startsWith(`Worker ${event.workerId} `));
    this.state.identityIssues=[...issues,text].sort();
  }
  private trackPrecision(event:Extract<UiEvent,{type:'apiStage'}>){
    if(event.stage==='RUN_STARTED'){this.state.precision=null;this.state.phase3=undefined;return;}
    const perAttempt=['SECURITY_PREWARM_READY','SECURITY_PREWARM_FAILED','PENDING_HOLD','OFFICIAL_QRPH_HANDOFF','QR_HANDOFF_NEEDS_ATTENTION'];
    if(!event.stage.startsWith('PRECISION_')&&!(this.state.precision&&perAttempt.includes(event.stage)))return;
    const view:PrecisionView=this.state.precision?structuredClone(this.state.precision):{targets:[],frozen:false};
    const entry=()=>{if(!event.workerId)return undefined;let found=view.targets.find(target=>target.workerId===event.workerId);
      if(!found&&event.court&&event.startTime){found={workerId:event.workerId,court:event.court,startTime:event.startTime,endTime:event.endTime??'',durationHours:event.durationHours??0};view.targets.push(found);}return found;};
    const target=entry();
    if(event.stage==='PRECISION_TARGET'&&target){target.endTime=event.endTime??target.endTime;target.durationHours=event.durationHours??target.durationHours;if(event.assumedPrice!==undefined)target.assumedPrice=event.assumedPrice;}
    if(event.stage==='PRECISION_TARGET_EVIDENCE'&&target){target.evidence=event.evidence;target.eligible=event.eligible;target.checkpoint=event.checkpoint;view.checkpoint=event.checkpoint;view.checkpointAt=event.at;}
    if(event.stage==='PRECISION_ATTEMPT_STATE'&&target){target.state=event.attemptState;target.code=event.code;if(event.duplicateOf)target.duplicateOf=event.duplicateOf;}
    if(event.stage==='SECURITY_PREWARM_READY'&&target)target.security='ready';
    if(event.stage==='SECURITY_PREWARM_FAILED'&&target)target.security='failed';
    if(event.stage==='PENDING_HOLD'&&target){target.state=target.state==='QR_READY'?'QR_READY':'HOLD_VERIFIED';target.bookingNo=event.bookingNo;target.holdExpiresAt=event.holdExpiresAt;}
    if(event.stage==='OFFICIAL_QRPH_HANDOFF'&&target)target.state='QR_READY';
    if(event.stage==='QR_HANDOFF_NEEDS_ATTENTION'&&target)target.state='HOLD_VERIFIED_QR_ATTENTION';
    if(event.stage==='PRECISION_FROZEN'){view.frozen=true;view.frozenCount=event.frozenCount;view.frozenAt=event.at;}
    if(event.stage==='PRECISION_OUTCOME')view.outcome=event.outcome;
    this.state.precision=view;
  }
  private readonly liveCandidates=new Map<string,{court:number;startTime:string;endTime:string}>();
  /** Live view: the run by logical target and fan-out child (ui/live-run.ts). */
  private trackLive(event:Extract<UiEvent,{type:'apiStage'}>){try{const next=reduceLiveRun(this.state.live,event,this.liveCandidates);if(next!==undefined)this.state.live=next;}catch{/* view model only */}}
  private trackPhase3(event:Extract<UiEvent,{type:'apiStage'}>){
    if(!event.stage.startsWith('PHASE3_'))return;
    const view=this.state.phase3??{attempts:[]};
    if(event.stage==='PHASE3_FROZEN')view.frozen=true;
    if(event.stage==='PHASE3_EVIDENCE'){view.fitness=event.fitness;view.cache=event.cache;view.seq=event.seq;}
    if(event.stage==='PHASE3_OUTCOME')view.outcome=event.outcome;
    if((event.stage==='PHASE3_ATTEMPT_RESERVED'||event.stage==='PHASE3_DISPATCH'||event.stage==='PHASE3_SETTLED')&&event.workerId&&event.candidateId&&event.wave){
      const found=view.attempts.find(value=>value.workerId===event.workerId&&value.candidateId===event.candidateId&&value.wave===event.wave);
      if(found){if(event.stage==='PHASE3_SETTLED'||!['REJECTED','UNKNOWN','VERIFIED','QR_READY','HOLD_VERIFIED_QR_ATTENTION'].includes(found.state))
        found.state=event.stage==='PHASE3_ATTEMPT_RESERVED'?'RESERVED':event.stage==='PHASE3_DISPATCH'?'IN_FLIGHT':event.state??'UNKNOWN';}
      else view.attempts.push({workerId:event.workerId,candidateId:event.candidateId,wave:event.wave,
        state:event.stage==='PHASE3_ATTEMPT_RESERVED'?'RESERVED':event.stage==='PHASE3_DISPATCH'?'IN_FLIGHT':event.state??'UNKNOWN'});
    }
    this.state.phase3=view;
  }
  private clearApiStage() { this.state.apiStage=null;this.state.observedPrice=null;this.state.assumedPrice=null; }
  private rememberQrHandoff(summary:QrHandoffSummary){
    const same=(value:QrHandoffSummary)=>value.checkout&&summary.checkout
      ? value.checkout===summary.checkout
      : value.date===summary.date&&value.startTime===summary.startTime&&value.endTime===summary.endTime&&value.courts.join(',')===summary.courts.join(',');
    const existing=this.state.qrHandoffs??[],previous=existing.find(same);
    const merged=previous?{...previous,...summary,status:previous.status==='qr-ready'?'qr-ready':summary.status}:summary;
    const next=[...existing.filter(value=>!same(value)),merged];
    this.state.qrHandoffs=next.sort((a,b)=>(a.checkout??'A').localeCompare(b.checkout??'A'));
    const run=this.state.runTiming;
    if(run&&!run.endedAt)try{this.deps.activityJournal?.handoff(run.runId,merged);}catch{/* best-effort run history enrichment */}
  }
  private holdDetail(hold:RetainedHoldStatus){
    if(hold.stage==='HOLD_VERIFIED'){
      if(!hold.expiresAt)return 'A verified payment hold remains recorded. Payment is manual. Prepare New Run makes a fresh schedule in the same bot while retaining the previous hold and QR tab.';
      const recorded=new Date(hold.expiresAt).toLocaleString('en-GB',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'medium'});
      // Once the timer is spent the same "recorded until" wording reads as a future
      // deadline, which made an elapsed hold look like it was still blocking a run.
      return hold.remainingSeconds===0
        ? `The recorded hold timer elapsed at ${recorded} Manila, so nothing is waiting on it. The hold stays on record for your reference. Press Prepare New Run to verify the browsers and open a fresh schedule in the same bot. Payment remains manual.`
        : `A verified payment hold remains recorded until ${recorded} Manila. Payment is manual. Prepare New Run makes a fresh schedule in the same bot while retaining the previous hold and QR tab.`;
    }
    if(!hold.expiresAt)return hold.stage==='FINAL_ACTION_DISPATCHING'
      ? 'The previous checkout stopped while its final action was unresolved. Reset & Prepare will inspect every required Onda browser and will recover only after the safety window has passed and all browsers are conclusively clean.'
      : 'A retained payment hold has no verified expiry. Inspect the Onda browser and use Review Lock; no new test can start.';
    const until=new Date(hold.expiresAt).toLocaleString('en-GB',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'medium'});
    return hold.remainingSeconds!>0?`A previous payment hold is recorded until ${until} Manila (${Math.floor(hold.remainingSeconds!/60)}:${String(hold.remainingSeconds!%60).padStart(2,'0')} remaining). Payment remains manual. Reset & Prepare can recheck after expiry.`:
      `The recorded hold timer elapsed at ${until} Manila. Reset & Prepare will verify the browser, selected slots, and old worker before clearing the stale lock.`;
  }
  private async reconcileLockForApiPrepare(generation:number,input:PreparationInput){
    if(!await this.deps.lock())return;
    const hold=await this.deps.retainedHold?.();
    if(!this.deps.reviewLock||!this.deps.clearLock)throw Error('LOCK_BROWSER_STATE_UNKNOWN');
    this.state.headline='CHECKING RETAINED SESSION';this.state.detail='Checking the old worker, Onda browser, selected slots, and payment hold before API preparation.';this.log(this.state.detail);
    const review=await this.deps.reviewLock(false);this.state.lockReview=review;
    const unresolvedFinalAction=hold?.stage==='FINAL_ACTION_DISPATCHING'&&hold.remainingSeconds===null;
    if(review.reason==='USE_RESET_AND_PREPARE'||unresolvedFinalAction||hold?.stage==='HOLD_VERIFIED'||hold?.remainingSeconds===0&&review.reason==='LOCK_BROWSER_STATE_UNKNOWN'){
      this.log(hold?.stage==='HOLD_VERIFIED'?'Preparing a fresh schedule while retaining the previous verified hold record and QR tab.':unresolvedFinalAction?'Unresolved final action requires every API browser to be inspected by Reset & Prepare.':review.reason==='USE_RESET_AND_PREPARE'?'Extended retained session requires both browsers to be checked by Reset & Prepare.':'Expired API hold requires Reset & Prepare to normalize the checkout browser safely.');
      await this.run({kind:'resetPrepare',input},generation);
      await this.noLock();this.state.lockReview=null;this.state.handoff=null;
      this.log('New schedule verified. Continuing API preparation; previous verified holds remain recorded.');
      return;
    }
    if(!review.canClear){
      this.state.headline=review.reason==='LOCK_PID_RUNNING'?'AUTOMATION STILL RUNNING':review.reason==='LOCK_PAYMENT_HOLD_ACTIVE'?'PAYMENT HOLD ACTIVE':'ONDA NEEDS ATTENTION';
      this.state.detail=errors[review.reason]??`Retained lock cannot be cleared: ${review.reason}. Inspect Onda and use Review Lock.`;
      this.log(this.state.detail,true);throw Error(review.reason);
    }
    await this.deps.clearLock(review.fingerprint,()=>!!this.active||generation!==this.generation);
    this.state.lockReview=null;this.state.handoff=null;this.state.lock=false;
    this.log('Expired hold and stale lock verified clean and cleared. Continuing API preparation.');
    await this.noLock();
  }
  private beginRun(label:string) {
    const at=new Date().toISOString();
    const journal=this.deps.activityJournal?.begin(label,at);
    this.runStartedMono=performance.now(); this.lastLogMono=this.runStartedMono;this.runReadyMono=undefined;
    this.state.runTiming={runId:journal?.runId??randomUUID(),label,startedAt:at,elapsedMs:0,...(journal?{logPath:journal.path}:{})};
    this.log(`Run started: ${label}${journal?` · Timing log: ${journal.path}`:''}`);
  }
  private markBrowserReady(at=new Date().toISOString()){
    const run=this.state.runTiming;if(!run||run.endedAt||run.readyAt)return;
    const mono=performance.now(),elapsedMs=Math.max(0,Math.round(mono-this.runStartedMono));
    this.runReadyMono=mono;run.readyAt=at;run.readyElapsedMs=0;
    try{this.deps.activityJournal?.ready(run.runId,at,elapsedMs);}catch{this.state.logs.push({at:new Date().toISOString(),text:'TIMING_LOG_WRITE_FAILED',level:'error'});}
  }
  private finishRun(outcome:string) {
    const run=this.state.runTiming;
    if(!run||run.endedAt)return;
    this.log(`Run finished: ${outcome}`,outcome==='failed');
    const elapsedMs=Math.max(0,Math.round(performance.now()-this.runStartedMono));
    run.elapsedMs=elapsedMs;run.endedAt=new Date().toISOString();
    if(this.runReadyMono!==undefined)run.readyElapsedMs=Math.max(0,Math.round(performance.now()-this.runReadyMono));
    try {this.deps.activityJournal?.end(run.runId,run.endedAt,elapsedMs,outcome,run.readyElapsedMs,run.label);this.state.runHistory=this.deps.activityJournal?.history?.()??this.state.runHistory;}
    catch {this.state.logs.push({at:new Date().toISOString(),text:'TIMING_LOG_WRITE_FAILED',level:'error'});}
    this.publish();
  }
  private log(text: string, error = false, at = new Date().toISOString()) {
    const run=this.state.runTiming,mono=performance.now(),active=!!run&&!run.endedAt;
    const entry={ at, text, level: error ? 'error' as const : 'info' as const,...(active?{elapsedMs:Math.max(0,Math.round(mono-this.runStartedMono)),deltaMs:Math.max(0,Math.round(mono-this.lastLogMono))}:{})};
    if(active){this.lastLogMono=mono;try{this.deps.activityJournal?.record(run.runId,entry);}catch{entry.text+=' · TIMING_LOG_WRITE_FAILED';}}
    this.state.logs.push(entry);
    if (this.state.logs.length > 400) this.state.logs.splice(0, this.state.logs.length - 400);
    this.publish();
  }
  async refresh() {
    if(this.state.booking?.setup.STRATEGY_V2?.shotgun?.enabled && this.state.activeApiRelease && shotgunCriticalInterval(this.state.activeApiRelease.releaseMs,Date.now()+(this.state.clock?.clockOffsetMs??0)))return;
    if (this.polling) return;
    this.polling = true;
    try {
      const wasReady = this.state.ready;
      const [lock, observedHealth,workerProbes] = await Promise.all([this.deps.lock(), this.deps.browserHealth?this.deps.browserHealth():this.deps.cdp().then(A=>({A,B:A,C:false,D:false})),
        this.deps.browserReadiness?.()??Promise.resolve({} as Partial<Record<WorkerId,{connected:boolean;commandLatencyMs:number|null;tabCount:number;targetReady:boolean;chromeVersion?:string|null}>>)]);
      const health:Record<WorkerId,boolean>={A:false,B:false,C:false,D:false,E:false,F:false,G:false,H:false,...observedHealth};
      this.workerProbes=workerProbes;
      const savedSetup=this.state.booking?.setup;
      if(savedSetup?.STRATEGY_V2?.shotgun?.enabled && savedSetup.PRECISION_PHASE3){
        try{const topology=exactShotgunTopology(savedSetup.PRECISION_PHASE3,savedSetup.STRATEGY_V2.shotgun.exactSchedule);
          this.state.shotgunTiming=readShotgunTiming('.local/shotgun-timing/latest.json',topology,this.state.build?.dirty?'dirty':this.state.build?.gitSha??'unknown',shotgunBrowserVersion(topology,workerProbes));}catch{this.state.shotgunTiming=null;}
      }else this.state.shotgunTiming=null;
      this.state.lock = lock; this.state.browserHealth=health;this.state.cdp = !!health.A;this.state.playerStatus=this.players();
      const retained=lock&&this.state.operation==='idle'?await this.deps.retainedHold?.():null;
      if(retained?.stage==='HOLD_VERIFIED'&&retained.expiresAt&&!this.qrRecoveryChecked&&!this.state.qrHandoffs?.length){
        this.qrRecoveryChecked=true;
        for(const summary of await this.deps.recentQrHandoffs?.(retained.expiresAt)??[])this.rememberQrHandoff(summary);
      }
      this.state.retainedLockStage=retained?.stage??null;
      this.state.canPrepareOverHold=!!lock&&(retained?.stage==='FINAL_ACTION_DISPATCHING'||retained?.stage==='HOLD_VERIFIED'&&!!retained.expiresAt);
      this.state.previousHolds=await this.deps.previousHolds?.()??[];
      if(lock&&!this.state.handoff&&this.state.operation==='idle'&&this.deps.handoff){
        this.state.handoff=await this.deps.handoff();
        if(this.state.handoff){const hold=this.state.handoff,last=hold.hours.at(-1)!;this.rememberQrHandoff({courts:[hold.court],date:hold.date,startTime:hold.hours[0]!,endTime:`${String(Number(last.slice(0,2))+1).padStart(2,'0')}:00`,amount:hold.amount,verifiedAt:hold.verifiedAt});this.state.headline='Payment handoff recorded';this.state.detail='Automation stopped. Lock retained. Check the last observed hold and complete payment manually in Chrome.';}
      }
      try { this.state.clock = this.deps.clock(); }
      catch { this.state.clock = null; this.state.ready = false; this.state.detail = errors.CONFIG_INVALID!; }
      if (this.state.operation === 'idle'||this.state.operation==='scheduled') {
        try { const booking=this.deps.booking(); if (this.state.preparedContext?.workflow==='release'&&this.state.preparedContext.configFingerprint!==booking.fingerprint)this.clearPreparation(); this.state.booking=booking; if(booking.setup.BOOKING_TYPE==='extended'&&this.deps.dualEvidence)this.state.dualValidation=await this.deps.dualEvidence(); }
        catch { this.state.booking=null; this.state.ready=false; }
      }
      const scheduled=this.state.scheduledRelease;
      if(scheduled&&this.state.operation==='scheduled'&&Date.now()+(this.state.clock?.clockOffsetMs??0)>=scheduled.releaseMs){await this.cancelScheduledRelease('RELEASE MISSED');return;}
      if(scheduled&&this.state.operation==='scheduled'&&this.state.booking?.fingerprint!==scheduled.configFingerprint){await this.cancelScheduledRelease('SCHEDULE CANCELLED - SETTINGS CHANGED');return;}
      const context=this.state.preparedContext,required=context?.requiredBrowsers??[];
      const apiWorkers=this.state.workflow==='test'&&this.apiTestPreferences
        ? normalWorkerIds(this.apiTestPreferences.strategy,this.apiTestPreferences.courtCount,this.apiTestPreferences.workers)
        : this.state.booking?planWorkerIds(this.state.booking.setup):[];
      const apiFirstReady=this.state.apiFirstReady&&apiWorkers.length>0&&apiWorkers.every(id=>health[id])&&!lock&&(
        this.state.workflow==='test'?!!this.apiTestFingerprint:['api-first','proofless'].includes(this.state.booking?.setup.BOOKING_METHOD??''));
      this.state.ready=!!apiFirstReady||!!context&&context.workflow===this.state.workflow&&!lock&&(this.state.operation==='scheduled'||required.every(id=>health[id]));
      if(context&&this.state.operation==='idle'&&!this.state.ready)this.clearPreparation();
      if (wasReady && !this.state.ready && this.state.operation === 'idle') {
        this.state.headline = 'Preparation needs rechecking';
        this.state.detail = lock ? errors.AUTOMATION_LOCK_EXISTS! : required.some(id=>!health[id]) ? 'A required browser disconnected. Press Reset & Prepare again.' : !this.state.clock?.canArmToday ? errors.TODAYS_RELEASE_PASSED! : errors.RESET_REQUIRED!;
      }
      if(retained&&['RESET REQUIRED','Preparation needs rechecking','PAYMENT HOLD ACTIVE','UNRESOLVED CHECKOUT LOCK','API BROWSER READY','API READY TO TEST','HOLD TIMER ELAPSED'].includes(this.state.headline)){
        this.state.headline=retained.stage==='FINAL_ACTION_DISPATCHING'?'UNRESOLVED CHECKOUT LOCK':retained.remainingSeconds===0?'HOLD TIMER ELAPSED':'PAYMENT HOLD ACTIVE';this.state.detail=this.holdDetail(retained);
      }
      const clock=this.state.clock,clockAt=clock?.clockSynchronizedAt?Date.parse(clock.clockSynchronizedAt):NaN,clockRoundTrip=clock?.clockRoundTripMs;
      const workerIds=this.state.booking?planWorkerIds(this.state.booking.setup):[];
      const workers=Object.fromEntries(workerIds.map(id=>{const probe=workerProbes[id];return [id,{connected:probe?.connected??!!health[id],identityValid:!(this.state.identityIssues??[]).some(issue=>issue.startsWith(`Worker ${id} `)),
        securityReady:this.apiReadyWorkers.has(id)||!!this.state.apiFirstReady,...(probe?{targetReady:probe.targetReady,tabCount:probe.tabCount,latencyP95Ms:probe.commandLatencyMs}: {})}];})) as Record<string,{connected:boolean;identityValid:boolean;securityReady:boolean;targetReady?:boolean;tabCount?:number;latencyP95Ms?:number|null}>;
      const latestProfile=this.state.fanOut?.latest,observerView=this.state.slotWatch,latestRead=observerView?.lastPollAt?Date.parse(observerView.lastPollAt):NaN;
      this.state.prewarmFeasibility=this.state.booking?this.forecastPrewarm(this.state.booking):null;
      const fallbackMachine:MachineHealth={measuredAt:new Date().toISOString(),cpuCount:0,memoryUsedPct:100,eventLoopP95Ms:100,processRssMb:0};
      this.state.releaseReadiness=evaluateReleaseReadiness({build:this.state.build??null,testedBuild:this.deps.testedBuild?.()??null,configValid:!!this.state.booking,
        authorizationValid:!!this.state.booking&&(this.state.booking.setup.RELEASE_STRATEGY!=='precision'||!!this.state.booking.setup.PRECISION_PHASE3),
        clock:{synced:!!clock?.networkSynced,ageMs:Number.isFinite(clockAt)?Date.now()-clockAt:null,uncertaintyMs:clockRoundTrip===null||clockRoundTrip===undefined?null:clockRoundTrip/2,offsetMs:clock?.clockOffsetMs??null},
        machine:this.deps.machineHealth?.()??fallbackMachine,workers,
        ...(this.state.booking?.setup.STRATEGY_V2?.shotgun?.enabled&&this.state.booking.setup.PRECISION_PHASE3?{shotgun:{...(()=>{const t=exactShotgunTopology(this.state.booking!.setup.PRECISION_PHASE3!,this.state.booking!.setup.STRATEGY_V2!.shotgun!.exactSchedule);return {tabsPerWorker:t.tabsPerWorker,shotCount:t.shots.length};})(),timingStatus:this.state.shotgunTiming?.status}}:{}),observer:{online:!!this.slotWatch&&!!observerView&&['waiting','watching'].includes(observerView.status),
          lastReadAgeMs:Number.isFinite(latestRead)?Date.now()-latestRead:null,availabilityLatencyMs:observerView?.lastLatencyMs??null},
        fanOut:latestProfile?{compatible:latestProfile.compatible,stale:latestProfile.stale,width:latestProfile.recommendedWidth}:null,prewarm:!!this.state.apiFirstReady,
        prewarmFeasibility:this.state.prewarmFeasibility});
      this.publish();
    } finally { this.polling = false; }
  }
  async syncClock(){
    if(this.state.operation!=='idle')throw Error('OPERATION_ALREADY_RUNNING');
    this.state.headline='SYNCING NETWORK CLOCK';this.state.detail='Contacting Google Public NTP. The Windows clock will not be changed.';this.publish();
    try{await this.deps.syncClock?.();this.state.clock=this.deps.clock();this.state.headline='NETWORK CLOCK SYNCHRONIZED';this.state.detail=`Source: ${this.state.clock.clockSource} · offset ${this.state.clock.clockOffsetMs.toFixed(1)} ms · round trip ${this.state.clock.clockRoundTripMs?.toFixed(1)??'unknown'} ms`;}
    catch{this.state.headline='NETWORK CLOCK SYNC FAILED';this.state.detail='Google Public NTP could not be verified. Release arming remains blocked.';throw Error('NETWORK_CLOCK_SYNC_FAILED');}
    finally{this.publish();}
  }
  private event = (event: UiEvent) => {
    if(event.type==='apiStage'){
      if(this.state.activeApiRelease){
        if(['WAITING_FOR_RELEASE','PRECISION_ARMED','WAITING_FOR_BLOCK_AUDIT','PHASE3_AUTHORIZATION'].includes(event.stage))this.state.activeApiRelease.phase='WAITING';
        else if(['RELEASE_TRIGGERED','PRECISION_DISPATCHING','PRIMARY_PROOFLESS_DISPATCHING','PHASE3_WAVE1_STARTED','PHASE3_DISPATCH'].includes(event.stage))this.state.activeApiRelease.phase='RUNNING';
        else if(event.stage==='FAILED')this.state.activeApiRelease.phase='FAILED';
      }
      this.trackIdentity(event);
       if(event.price!==undefined)this.state.observedPrice=event.price;
       if(event.assumedPrice!==undefined)this.state.assumedPrice=event.assumedPrice;
      if(event.stage==='RUN_STARTED'){this.apiReadyWorkers.clear();if(event.runId)this.runnerRunId=event.runId;}
      if(event.stage==='BROWSER_READY'&&this.state.operation!=='prepare'&&event.workerId){
        this.apiReadyWorkers.add(event.workerId);
        const required=this.state.workflow==='test'&&this.apiTestPreferences
          ? normalWorkerIds(this.apiTestPreferences.strategy,this.apiTestPreferences.courtCount,this.apiTestPreferences.workers)
          : this.state.booking?planWorkerIds(this.state.booking.setup):[];
        if(required.length&&required.every(worker=>this.apiReadyWorkers.has(worker)))this.markBrowserReady(event.at);
      }
      this.state.apiStage=event;
      this.trackPrecision(event);
      this.trackPhase3(event);
      this.trackLive(event);
      const labels:Record<string,string>={RUN_STARTED:'API run started',EXPIRED_HOLD_REUSABLE:'Expired verified hold released for a new test',FINISHED_ATTEMPT_REUSABLE:'Finished attempt archived for a new test',PREPARING_BROWSER:'Preparing isolated Chrome',BROWSER_READY:'API browser ready',
        WAITING_FOR_BLOCK_AUDIT:'Waiting for 7:30 block audit',PRIMARY_PROOFLESS_PLAN_READY:'Proofless court plan resolved',PRIMARY_PROOFLESS_DISPATCHING:'Dispatching proofless checkout',PRIMARY_PROOFLESS_OUTCOME:'Proofless checkout outcome recorded',WAITING_FOR_RELEASE:'Waiting for release',SECURITY_PREWARM_STARTED:'Preparing checkout security before release',SECURITY_PREWARM_READY:'Checkout security ready for release',RELEASE_TRIGGERED:'Release reached',FETCHING_AVAILABILITY:'Fetching live API availability',
        WORKER_OUTCOME:'Checkout outcome recorded',CANDIDATE_READY:'API candidate ready',DRY_RUN_COMPLETE:'API dry run complete',FRESH_VERIFICATION_AND_PROOFS:'Fresh verification and slot proofs',
        PENDING_HOLD:'Pending reservation captured',OFFICIAL_QRPH_HANDOFF:'Official QRPH checkout open',FAILED:'API run needs attention',
        PRE_RELEASE_AUDIT_READ:'Pre-release read',PRE_RELEASE_AUDIT_RESULT:'Pre-release audit recorded',PROOFLESS_TARGET_EVIDENCE:'Target evidence recorded',
        NETWORK_CLOCK_REFRESHED:'Network clock refreshed',NETWORK_CLOCK_REFRESH_FAILED:'Network clock refresh failed',QR_HANDOFF_NEEDS_ATTENTION:'HOLD VERIFIED · QR handoff needs attention',
        PRECISION_RACE_CONFIGURED:'Precision race configured',PRECISION_TARGET:'Precision target authorized',PRECISION_EVIDENCE_READ:'Precision evidence read',
        PRECISION_TARGET_EVIDENCE:'Precision target evidence',PRECISION_ATTEMPT_STATE:'Precision attempt updated',PRECISION_DRY_COMPLETE:'Precision targets checked',
        PRECISION_FROZEN:'Precision targets frozen',PRECISION_ARMED:'Precision attempts armed for release',PRECISION_DISPATCHING:'Dispatching Precision attempts',NETWORK_CLOCK_CONSENSUS:'Release clock consensus',NETWORK_CLOCK_CONSENSUS_REJECTED:'Release clock round not trusted',NETWORK_CLOCK_CONSENSUS_FAILED:'Release clock round failed',PRECISION_LOCK_DISPATCHING_FAILED:'Dispatch record update failed',SECURITY_PREWARM_FAILED:'Checkout security failed for one worker',
        SECURITY_PREWARM_RETRY:'Retrying checkout security for one worker',PRECISION_OUTCOME:'Precision race settled',CUSTOMER_IDENTITY_INVALID:'Customer identity invalid',
        RELEASE_OFFSET_SCHEDULED:'Release offset scheduled'};
      labels.HUMAN_VERIFICATION_REQUIRED='Human verification required in Chrome';
      labels.HUMAN_VERIFICATION_COMPLETE='Human verification complete';
      this.state.headline=labels[event.stage]??event.stage.replaceAll('_',' ');
      const worker=event.workerId?`Checkout ${event.workerId} · `:'';
      const target=event.date&&event.court&&event.startTime&&event.durationHours?`Court${event.courtB?'s':''} ${event.court}${event.courtB?` + ${event.courtB}`:''} · ${event.date} · ${event.startTime}–${String(Number(event.startTime.slice(0,2))+event.durationHours).padStart(2,'0')}:00 · `:'';
      this.state.detail=event.stage==='RUN_STARTED'?`Timing log: .local/api-booking/run-progress/${event.runId}.ndjson`:
        event.stage==='CANDIDATE_READY'?`Court${event.courtB?'s':''} ${event.court}${event.courtB?` + ${event.courtB}`:''} · ${event.date} · ${event.startTime} · ${event.durationHours} hour(s) · PHP ${event.price}`:
        event.stage==='PENDING_HOLD'||event.stage==='OFFICIAL_QRPH_HANDOFF'?`${worker}${target}Booking ${event.bookingNo} · ID ${event.bookingId} · Hold until ${event.holdExpiresAt} · PHP ${event.price}. Payment is manual.`:
        event.stage==='SECURITY_PREWARM_STARTED'||event.stage==='SECURITY_PREWARM_READY'?'The verified browser remains ready. Waiting for the exact release time.':
        event.stage==='HUMAN_VERIFICATION_REQUIRED'?`Use the Chrome window titled THIRSTY BOT ${event.workerId??'A'} - VERIFY HERE. This API run is waiting for you to finish the Cloudflare check.`:
        event.stage==='FAILED'?event.code??'API_FIRST_RUN_FAILED':`Progress recorded`;
      const precisionHeadline=precisionOutcomeHeadline(event.stage==='PRECISION_OUTCOME'?event.outcome:event.stage==='FAILED'?event.code:undefined);
      if(precisionHeadline)this.state.headline=precisionHeadline;
      if(event.stage==='PRECISION_OUTCOME')this.state.detail=`${event.verifiedCount??0} verified hold(s) · ${event.unknownCount??0} unresolved · ${event.rejectedCount??0} rejected · ${event.unsentCount??0} not dispatched${event.qrAttention?' · a verified hold needs its QR page opened manually':''}. Payment is manual.`;
      if(['PRECISION_TARGET_EVIDENCE','PROOFLESS_TARGET_EVIDENCE'].includes(event.stage))this.state.detail=`${event.workerId?`Worker ${event.workerId} · `:''}Court ${event.court} · ${event.startTime}${event.endTime?`–${event.endTime}`:''}${event.checkpoint?` · ${event.checkpoint}`:''} · ${TARGET_EVIDENCE_LABEL[event.evidence as TargetEvidence]??event.evidence}${event.eligible===false?' · NOT ELIGIBLE':''}`;
      if(event.stage==='PRECISION_ATTEMPT_STATE')this.state.detail=`Worker ${event.workerId} · Court ${event.court} · ${event.startTime}–${event.endTime} · ${PRECISION_STATE_LABEL[event.attemptState??'']??event.attemptState}${event.duplicateOf?` · duplicates Worker ${event.duplicateOf}`:event.code?` · ${event.code}`:''}`;
      if(event.stage==='CUSTOMER_IDENTITY_INVALID')this.state.detail=identityIssueText(event,this.state.booking?.setup.RELEASE_STRATEGY==='precision');
      if(event.stage==='NETWORK_CLOCK_REFRESHED')this.state.detail=`${event.checkpoint} · offset ${event.offsetMs} ms · round trip ${event.roundTripMs} ms · change ${event.deltaMs} ms`+(event.sampleCount!==undefined?` · ${event.sampleCount} samples · spread ${event.spreadMs} ms · ±${event.uncertaintyMs} ms`:'');
      if(event.stage==='NETWORK_CLOCK_CONSENSUS')this.state.detail=`${event.checkpoint} · offset ${event.offsetMs} ms · ${event.sampleCount} samples · fastest round trip ${event.roundTripMs} ms · spread ${event.spreadMs} ms · ±${event.uncertaintyMs} ms · change ${event.deltaMs} ms`+(event.code==='CLOCK_JUMP_REJECTED'?' · large earlier jump not adopted':'');
      if(event.stage==='RELEASE_OFFSET_SCHEDULED'&&event.releaseOffsetMs!==undefined)this.state.detail=`${event.workerId?`Worker ${event.workerId} · `:''}Trigger ${formatReleaseOffset(event.releaseOffsetMs)}: checkout may be sent up to ${-event.releaseOffsetMs} ms before the official release time`;
      if(event.stage==='PRECISION_ARMED')this.state.detail=`${event.frozenCount} attempt(s) armed: requests, journals and one-shot permits are ready before release${event.unsentCount?` · ${event.unsentCount} could not be armed`:''}`;
      const timing=`${event.elapsedMs} ms total · +${event.sincePreviousMs??0} ms since prior stage`;
      this.state.detail+=` · ${timing}`;
      if(['PENDING_HOLD','OFFICIAL_QRPH_HANDOFF'].includes(event.stage)&&event.date&&event.court&&event.startTime&&event.durationHours&&event.price!==undefined){
        this.rememberQrHandoff({...(event.wing?{wing:event.wing}:{}),checkout:event.workerId,status:event.stage==='OFFICIAL_QRPH_HANDOFF'?'qr-ready':'hold-created',courts:[event.court,...(event.courtB?[event.courtB]:[])],date:event.date,startTime:event.startTime,
          endTime:`${String(Number(event.startTime.slice(0,2))+event.durationHours).padStart(2,'0')}:00`,amount:event.price,verifiedAt:event.at??new Date().toISOString(),
          ...(event.holdExpiresAt?{holdExpiresAt:event.holdExpiresAt}:{}),...(event.bookingId?{bookingId:event.bookingId}:{}),...(event.bookingNo?{bookingNo:event.bookingNo}:{})});
      }
      this.log(`${labels[event.stage]??event.stage.replaceAll('_',' ')} · ${this.state.detail}`,event.stage==='FAILED',event.at);
      this.publish();return;
    }
    if(event.type==='preparationResult'){this.preparationResult=event.result;this.publish();return;}
    if(event.type==='preparationProgress'){
      const labels={starting:'Starting required browser(s)...','previous-session':'Checking previous session...','holds':'Checking payment holds...','onda':'Preparing Onda...','calendar':'Verifying calendar...','grids':'Verifying grids...','availability':'Checking booking availability...','final':'Final readiness check...'};
      this.state.headline='PREPARING';this.state.detail=labels[event.step];this.log(`Preparation: ${this.state.detail}`);return;
    }
    if(event.type==='preparationBlocked'){
      this.state.headline=event.hold==='Active'?'PAYMENT HOLD ACTIVE':'ONDA NEEDS ATTENTION';
      const remaining=event.countdownSeconds===null?'remaining time unknown':`${Math.floor(event.countdownSeconds/60)}:${String(event.countdownSeconds%60).padStart(2,'0')} remaining`;
      this.state.detail=`Browser ${event.browser} · ${remaining}\nWait for expiry, then press Reset & Prepare again.`;this.log(`Preparation blocked: ${this.state.detail}`,true);return;
    }
    if(event.type==='courtBrowser'){this.state.courtBrowser=event;this.publish();return;}
    if(event.type==='blockAudit'){
      this.state.blockAudit=event;
      const count=(status:typeof event.cells[number]['status'])=>event.cells.filter(cell=>cell.status===status).length;
      this.state.headline='BLOCK AUDIT COMPLETE';
      this.state.detail=`${event.date} · Open ${count('OPEN')} · Blocked ${count('BLOCKED')} · Unreleased ${count('UNRELEASED')} · Unknown ${count('UNKNOWN')}. No hold or booking was created.`;
      this.log(this.state.detail);this.publish();return;
    }
    if(event.type==='bookingResult'){this.state.bookingResult=event;this.state.headline=event.status;this.state.detail=event.description+'\n'+event.outcomes.map((v,i)=>`Checkout ${i+1}: ${v}`).join('\n')+(event.outcomes.includes('FAILED')?'\nCheck both Onda windows manually; a failed checkout may still have an active hold.':'');this.log(`Booking result: ${event.status} · ${this.state.detail}`,event.status.includes('FAILED'));return;}
    if(event.type==='error'&&this.state.bookingResult&&['PARTIAL SUCCESS','BOOKING FAILED'].includes(this.state.bookingResult.status)){this.state.ready=false;this.log(event.code,true);return;}
    if(event.type==='dualWorker'){this.state.dualWorkers={...this.state.dualWorkers,[event.workerId]:event};this.log(`Browser ${event.workerId}: ${event.state}`);return;}
    if(event.type==='dualResult'){this.state.dualResult=event;this.state.headline=event.status.replaceAll('_',' ');this.state.detail=['DUAL_DRY_PASS','DUAL_SELECTION_PASS'].includes(event.status)?'No Proceed clicks. Both browsers clean.':'Automation stopped. Inspect BOTH browsers manually. Locks retained; payment stays manual.';this.log(`Dual result: ${event.status}`);return;}
    if(event.type==='error'&&this.state.dualActive&&['DUAL_PARTIAL_SUCCESS','DUAL_FAILED'].includes(this.state.dualResult?.status??'')){this.state.ready=false;this.log(event.code,true);return;}
    if(this.state.dualActive&&['handoff','selection','releasePerformance'].includes(event.type))return;

    if (event.type === 'releasePerformance') { this.state.releasePerformance = event.summary; this.log('Release performance measurements received'); }
    if (event.type === 'selection') { this.state.selection=event; this.state.headline='SLOTS SELECTED'; this.state.detail=['full','fullPractice'].includes(this.state.operation)?'Continuing to Review Booking. Selection is not yet a reservation.':'AUTOMATION STOPPED BEFORE PROCEED. USER CONTROL RESTORED. Selection is not a reservation; the lock remains active.'; this.log(`Slots selected · ${this.state.detail}`); }
    if(event.type==='handoff'){this.state.handoff=event;const worker=event.workerId??'A',last=event.hours.at(-1)!;const summary:QrHandoffSummary={checkout:worker,status:'qr-ready',courts:[event.court],date:event.date,startTime:event.hours[0]!,endTime:`${String(Number(last.slice(0,2))+1).padStart(2,'0')}:00`,amount:event.amount,verifiedAt:event.verifiedAt};this.rememberQrHandoff(summary);this.state.headline='PAYMENT HOLD ACTIVE';this.state.detail='FULL BOOKING COMPLETE TO PAYMENT HANDOFF. AUTOMATION STOPPED. Complete payment manually in Chrome. AUTOMATION LOCK RETAINED.';this.log(`Payment handoff verified · Browser ${worker} · Court ${event.court} · ${event.date} · ${summary.startTime}–${summary.endTime} · PHP ${event.amount}. Payment remains manual.`);}
    if (event.type === 'inspection') { this.state.inspection = event; this.log('Onda URL and venue verified. Inspection results received.'); }
    if (event.type === 'plan') { this.state.plan = event; this.log('Booking plan received'); }
    if (event.type === 'error') {
      this.state.ready = false;
      if(event.code==='PAYMENT_HOLD_MAY_BE_ACTIVE'&&this.state.headline==='PAYMENT HOLD ACTIVE'){this.log(event.code,true);return;}
      if (event.code !== 'USER_ABORT') { this.state.headline = event.code==='HANDOFF_STATUS_UNKNOWN'?'HANDOFF STATUS UNKNOWN':/REVIEW_/.test(event.code)?'REVIEW VALIDATION FAILED':/PLAYER_|PHONE_/.test(event.code)?'PLAYER FORM FAILED':/PAYMENT_/.test(event.code)?'PAYMENT SUMMARY FAILED':/TERMS_|FINAL_BUTTON_/.test(event.code)?'TERMS / FINAL ACTION FAILED':/SELECTION_|CLEANUP_|NO_AVAILABLE/.test(event.code)?'SELECTION FAILED':'Needs attention'; this.state.detail = event.code==='HANDOFF_STATUS_UNKNOWN'?'DO NOT START ANOTHER BOOKING. CHECK CHROME MANUALLY. Lock retained; final action is never retried.':errors[event.code] ?? event.code; }
      if(preparationHeadlines[event.code])this.state.headline=preparationHeadlines[event.code]!;
      this.log(errors[event.code] ?? event.code, true);
    }
    if (event.type === 'telemetry') {
      const labels: Record<string, string> = { chromeConnected: 'Dedicated Chrome and Onda tab verified', preflightStarted: 'Preflight started', preflightCompleted: 'Preflight passed',
        armed: 'ARMED — final preflight passed', releaseTriggerFired: 'Release trigger fired', reloadStarted: 'Reload started', reloadCommitted: 'Reload committed', targetGridReady: 'Target grid verified', gridSnapshotCompleted: 'Availability snapshot completed', automationStopped: 'Command completed' };
      this.log(`${event.workerId?`Browser ${event.workerId} · `:''}${labels[event.event]??event.event}`,false,event.wall);
      if(['full','fullPractice'].includes(this.state.operation)){
        const stages:Record<string,string>={armed:'Full Booking armed',reviewValidated:'BOOKING REVIEWED',playerFillCompleted:'PLAYER INFORMATION VERIFIED',paymentSummaryValidated:'READY TO CREATE PAYMENT HOLD',finalOndaActionStarted:'Creating payment hold',finalOndaButtonClicked:'Checking QR handoff — read only'};
        if(stages[event.event])this.state.headline=stages[event.event]!;
        this.publish();
      }
      if (this.state.operation === 'observe') {
        if (event.event === 'preflightCompleted') { this.state.headline = 'Observation scheduled'; this.state.detail = 'Initial preflight passed. The existing engine will perform final preflight before release.'; }
        if (event.event === 'armed') { this.state.headline = 'Release observation armed'; this.state.detail = 'Final preflight passed. Waiting for the configured release.'; }
        if (event.event === 'releaseTriggerFired') { this.state.headline = 'Observing release'; this.state.detail = 'Read-only refresh and date navigation are running.'; }
        this.publish();
      }
    }
  };
  private async run(command: Command, generation: number) {
    if (generation !== this.generation) throw new Error('CANCELLED');
    const descriptor=typeof command==='string'?command:command.kind==='testBooking'?`testBooking · ${command.input.method}`:command.kind==='apiRun'?`apiRun · ${command.mode}`:command.kind;
    if(this.state.runTiming&&!this.state.runTiming.endedAt&&!this.state.runTiming.label.startsWith('release ·'))this.state.runTiming.label=typeof command==='object'&&command.kind==='testBooking'?`${(command.input.method??'browser').toUpperCase()} TEST`:typeof command==='object'&&command.kind==='apiRun'?`API ${command.mode.toUpperCase()}`:descriptor;
    this.log(`Process started: ${descriptor}`);
    const runnerBefore=this.runnerRunId;
    if(typeof command==='object'&&command.kind==='apiRun'&&command.mode==='live'&&command.releaseMs!==undefined)
      this.state.activeApiRelease={releaseMs:command.releaseMs,targetDate:command.date,phase:'PREPARING'};
    const active = this.deps.runner(command, this.event, (line, error) => this.log(line, error),async plan=>{if(generation!==this.generation)return false;const answer=await this.deps.confirmBooking?.(plan,typeof command==='object'&&command.kind==='testBooking'?command.input.maximum:0)??false;return generation===this.generation&&answer;});
    this.active = active;
    try {
      const code = await active.done;
      if (generation !== this.generation) throw new Error('CANCELLED');
      if (code !== 0) throw new Error('COMMAND_FAILED');
      this.log(`Process completed: ${descriptor} · exit code ${code}`);
    } finally {
      if (this.active === active) this.active = undefined;
      if(typeof command==='object'&&command.kind==='apiRun'&&command.mode==='live')this.state.activeApiRelease=null;
      // The runner process has exited: every POST it made has settled, so the forensic report can be built.
      if(typeof command==='object'&&command.kind==='apiRun'&&(command.mode==='live'||command.mode==='live-now')&&this.runnerRunId&&this.runnerRunId!==runnerBefore)
        this.scheduleForensics(this.runnerRunId,command.date,command.releaseMs);
    }
  }
  private async operation(kind: Dashboard['operation'], work: (generation: number) => Promise<void>) {
    if (this.state.operation !== 'idle') throw new Error('OPERATION_ALREADY_RUNNING');
    if (this.availabilityProcess) throw new Error('AVAILABILITY_CHECK_RUNNING');
    const generation = ++this.generation;
    if (['observe', 'dry', 'selection', 'full'].includes(kind)) this.state.releasePerformance = null;
    this.state.dualActive=false; this.state.operation = kind; this.state.ready = false; this.state.plan = null; this.clearApiStage(); this.state.termsAuthorized=false;
    let outcome='complete';
    try {this.beginRun(kind);await work(generation); }
    catch (error) {
      outcome='failed';
      if (generation === this.generation) {
        const code = error instanceof Error ? error.message : 'OPERATION_FAILED';
        const hadSpecificFailure = this.state.apiStage?.stage==='FAILED'||Object.values(preparationHeadlines).includes(this.state.headline)||['PARTIAL SUCCESS','BOOKING FAILED'].includes(this.state.bookingResult?.status??'')||this.state.dualResult?.status==='DUAL_PARTIAL_SUCCESS'||this.state.dualResult?.status==='DUAL_FAILED'||this.state.headline === 'Needs attention'||this.state.headline.includes('FAILED')||this.state.headline==='HANDOFF STATUS UNKNOWN';
        if(code==='HANDOFF_STATUS_UNKNOWN')this.state.headline='HANDOFF STATUS UNKNOWN';
        else if(code==='BOOKING_SETTINGS_INVALID')this.state.headline='BOOKING SETTINGS NEED ATTENTION';
        else if(!hadSpecificFailure)this.state.headline = 'Needs attention';
        if(code==='HANDOFF_STATUS_UNKNOWN')this.state.detail='DO NOT START ANOTHER BOOKING. CHECK CHROME MANUALLY. Lock retained; final action is never retried.';
        else if(code==='BOOKING_SETTINGS_INVALID')this.state.detail ||= 'Check the highlighted booking fields and press Reset & Prepare again.';
        else if(code==='PAYMENT_HOLD_MAY_BE_ACTIVE'&&this.state.headline==='PAYMENT HOLD ACTIVE'){}
        else if (code !== 'COMMAND_FAILED'&&!['ONDA NEEDS ATTENTION','AUTOMATION STILL RUNNING'].includes(this.state.headline)) this.state.detail = errors[code] ?? code;
        else if (!hadSpecificFailure) this.state.detail = 'The command failed. See the sanitized process output in Activity.';
        if(preparationHeadlines[code])this.state.headline=preparationHeadlines[code]!;
        this.log(code, true);
      }
    } finally {
      if (generation === this.generation) { this.finishRun(outcome);this.state.operation = 'idle'; this.state.termsAuthorized=false;this.state.activeApiRelease=null; await this.refresh(); this.publish(); }
    }
  }
  private async noLock() { this.state.lock = await this.deps.lock(); if (this.state.lock) throw new Error('AUTOMATION_LOCK_EXISTS'); }
  private availabilityProcess:RunningCommand|undefined;
  /**
   * One-click read-only availability for both wings in a dedicated observer browser. It needs no prepared worker,
   * performs no booking POST and, unlike booking operations, never clears preparation or Terms. It is refused while a
   * release is armed or any automation runs, so it can never compete with dispatch.
   */
  async browseCourts(value:unknown){
    const date=z.iso.date().parse(value);
    if(this.availabilityProcess)throw Error('AVAILABILITY_CHECK_RUNNING');
    if(this.state.scheduledRelease||this.state.activeApiRelease||this.state.operation!=='idle')throw Error('AVAILABILITY_CHECK_REFUSED_ACTIVE_RUN');
    const startedAt=new Date().toISOString();
    this.state.availabilityCheck={status:'RUNNING',date,startedAt};this.state.courtBrowser=null;this.publish();
    this.log(`Availability check started for ${date} · dedicated read-only observer`);
    const active=this.deps.runner({kind:'courtBrowse',date},this.event,(line,error)=>this.log(line,error));
    this.availabilityProcess=active;
    try{
      const code=await active.done;
      const evidence=this.state.courtBrowser as Extract<UiEvent,{type:'courtBrowser'}>|null|undefined;
      if(code!==0||!evidence||evidence.date!==date)throw Error('AVAILABILITY_CHECK_FAILED');
      const failed=(evidence.wings??[]).filter(w=>w.status==='ERROR');
      this.state.availabilityCheck={status:failed.length===2?'FAILED':'DONE',date,startedAt,finishedAt:new Date().toISOString(),...(failed.length?{code:failed.map(w=>`${w.wing}:${w.code??'ERROR'}`).join(' ')}:{})};
      this.log(`Availability check finished for ${date}${failed.length?` · ${failed.length} wing read failed`:''}`);
    }catch(error){
      this.state.availabilityCheck={status:'FAILED',date,startedAt,finishedAt:new Date().toISOString(),code:error instanceof Error?error.message:'AVAILABILITY_CHECK_FAILED'};
      this.log('AVAILABILITY_CHECK_FAILED',true);throw error;
    }finally{this.availabilityProcess=undefined;this.publish();}
  }
  apiPreview(value:unknown) { const date=z.iso.date().parse(value); return this.operation('apiPreview', async gen => {
    await this.noLock();
    const fingerprint=this.apiTestFingerprint,preferences=this.apiTestPreferences;
    if(this.state.workflow!=='test'||!this.state.apiFirstReady||!fingerprint||!preferences||date!==preferences.date)throw Error('RESET_REQUIRED');
    this.state.headline='RETRIEVING API AVAILABILITY';
    this.state.detail='The current Test Now plan is being checked without creating a hold or booking.';
    this.publish();
    await this.run({kind:'apiRun',mode:'dry',date,fingerprint,checkoutMethod:this.apiTestCheckoutMethod,preferences},gen);
    if(gen!==this.generation)return;
    this.state.headline='API AVAILABILITY CHECK COMPLETE';
    this.state.detail='A currently available candidate was found using the saved booking preferences. No hold or booking was created. Review the candidate in Activity.';
  }); }
  checkReleaseBlocks(value:unknown){const date=z.iso.date().parse(value);return this.operation('blockAudit',async gen=>{
    this.state.blockAudit=null;this.state.headline='CHECKING UNRELEASED BLOCKS';
    this.state.detail=`Reading all 112 court/hour cells for ${date}. This is read-only and cannot create a hold.`;this.publish();
    await this.run({kind:'blockAudit',date},gen);
    if(gen!==this.generation)return;
    const audit=this.state.blockAudit as Extract<UiEvent,{type:'blockAudit'}>|null|undefined;
    if(!audit||audit.date!==date)throw Error('BLOCK_AUDIT_RESULT_MISSING');
  });}
  startChrome() { return this.operation('chrome', async gen => {
    // The launcher only starts or reuses the dedicated browser; it does not
    // attach a booking worker. Allow it while a retained lock is under review
    // so the operator can make Chrome available for read-only verification.
    if (this.active) throw new Error('OPERATION_ALREADY_RUNNING');
    this.log(this.state.lock ? 'Starting / reusing dedicated Chrome for lock review' : 'Starting / reusing dedicated Chrome'); await this.run(this.state.booking?.setup.BOOKING_TYPE==='extended'?'chromeDual':'chrome', gen);
    this.state.cdp = await this.deps.cdp(); if (!this.state.cdp) throw new Error('CDP_PROFILE_OR_BIND_UNVERIFIED');
    if (gen !== this.generation) return;
    this.state.headline = 'Chrome is reachable'; this.state.detail = 'Run Prepare to verify the booking page and session.';
  }); }
  inspectOnda() { return this.operation('inspect', async gen => {
    if(this.state.booking?.setup.BOOKING_TYPE==='extended')this.state.dualWorkers={};
    await this.noLock(); this.state.inspection = null; this.log('Inspecting Onda — read only'); await this.run(this.state.booking?.setup.BOOKING_TYPE==='extended'?'dualReadiness':'inspect', gen);
    this.state.headline = 'Inspection complete'; this.state.detail = 'Review the observed status below. Prepare before arming.';
  }); }
  async setWorkflow(value:unknown){if(this.state.scheduledRelease)await this.cancelScheduledRelease('SCHEDULE CANCELLED - WORKFLOW CHANGED');if(this.state.operation!=='idle')throw Error('OPERATION_ALREADY_RUNNING');this.state.workflow=z.enum(['test','release']).parse(value);this.clearPreparation();this.state.headline='RESET REQUIRED';this.state.detail='Configure your booking, then Reset & Prepare.';this.publish();}
  private resetting=false;
  async resetPrepare(value:unknown){
    if(this.resetting)throw Error('OPERATION_ALREADY_RUNNING');
    this.resetting=true;this.clearPreparation();this.preparationResult=undefined;this.pendingPreparation=undefined;this.state.identityIssues=[];
    try{
      const input=PreparationSchema.parse(value);
      if(input.workflow==='test')assertWingNormalRequest({...input.request,method:input.method,mode:'prepare'});
      this.state.qrHandoffs=[];this.state.handoff=null;
      if(this.state.operation!=='idle'){
        const active=this.active;
        if(!active)throw Error('AUTOMATION_STILL_RUNNING');
        const generation=this.generation;
        if(!await this.deps.confirmStopPrepare?.())return;
        if(generation!==this.generation||this.active&&this.active!==active)throw Error('STOP_NOT_CONFIRMED');
        ++this.generation;this.state.operation='stopping';this.state.ready=false;this.state.termsAuthorized=false;this.publish();
        try{
          await active.stop();
          await Promise.race([active.done,new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(Error('STOP_NOT_CONFIRMED')),3500);timer.unref();})]);
        }catch{this.state.headline='STOP NOT CONFIRMED';this.state.detail='Stop the existing automation before preparing.';this.publish();throw Error('STOP_NOT_CONFIRMED');}
        this.active=undefined;this.log('Previous run stopped for Reset & Prepare');this.finishRun('replaced');this.state.operation='idle';
      }
      await this.operation('prepare',async gen=>{
        let release:BookingView|undefined;
        if(input.workflow==='test'&&['api-first','proofless'].includes(input.method)){
          const players=this.requirePlayers(normalWorkerIds(input.request.strategy,input.request.courtCount,input.request.workers));this.state.playerStatus=players;
          await this.reconcileLockForApiPrepare(gen,input);
          const fingerprint=expectedPreparationFingerprint(input);
          this.state.workflow='test';this.state.headline='PREPARING API BROWSER';this.publish();
          const preferences:ApiRunPreferences={...(input.request.wing?{wing:input.request.wing}:{}),strategy:input.request.strategy,date:input.request.date,start:input.request.start,duration:input.request.duration,courtCount:input.request.courtCount,
            maximum:input.maximum,priority:input.request.priority,fallbackStarts:input.request.fallbackStarts,...(input.request.exact?{exact:input.request.exact}:{}),...(input.request.workers?{workers:input.request.workers}:{})};
          await this.run({kind:'apiRun',mode:'prepare',date:input.request.date,fingerprint,checkoutMethod:input.method==='proofless'?'proofless':'proof-based',preferences},gen);
          if(input.method==='proofless')await this.run({kind:'apiRun',mode:'dry',date:input.request.date,fingerprint,checkoutMethod:'proofless',preferences},gen);
          this.apiTestFingerprint=fingerprint;this.apiTestStrategy=input.request.strategy;this.apiTestCheckoutMethod=input.method==='proofless'?'proofless':'proof-based';this.apiTestPreferences=preferences;this.state.apiFirstReady=true;this.state.ready=true;
          this.state.headline='API READY TO TEST';
          const count=normalWorkerIds(input.request.strategy,input.request.courtCount,input.request.workers).length;
          this.state.detail=`${count} dedicated API browser${count===1?' is':'s are'} open and remain${count===1?'s':''} visible. Authorize Terms, then Run Test to QR.`;
          return;
        }
        if(input.workflow==='release'){
          const existing=this.deps.booking(),candidate=this.releaseSetup(input.setup??existing.setup);
          const removed=candidate.reconciliation.removed.length?candidate.reconciliation.removed:existing.fallbackReconciliation.removed;
          const saved=this.deps.saveBooking(candidate.setup);release=this.deps.booking();if(saved.fingerprint!==release.fingerprint)throw Error('BOOKING_PLAN_CHANGED');
          this.state.bookingAdjustment=removed.length?{valid:release.setup.FALLBACK_TIMES,removed}:null;
           if(release.setup.BOOKING_TYPE!==input.strategy)throw Error('BOOKING_PLAN_CHANGED');this.state.booking=release;
           if(['api-first','proofless'].includes(release.setup.BOOKING_METHOD)){
              this.state.playerStatus=this.requirePlayers(planWorkerIds(release.setup));
             await this.reconcileLockForApiPrepare(gen,input);
             this.state.workflow='release';this.state.headline='PREPARING API BROWSER';this.publish();
             await this.run({kind:'apiRun',mode:'prepare',date:release.targetDate,fingerprint:release.fingerprint,checkoutMethod:release.setup.BOOKING_METHOD==='proofless'?'proofless':'proof-based'},gen);
             if(release.setup.BOOKING_METHOD==='proofless')await this.run({kind:'apiRun',mode:'dry',date:release.targetDate,fingerprint:release.fingerprint,checkoutMethod:'proofless'},gen);
             this.state.apiFirstReady=true;this.state.ready=true;this.state.headline='API BROWSER READY';
              const count=planWorkerIds(release.setup).length;
             this.state.detail=`${count} API browser${count===1?' is':'s are'} ready. Authorize Terms, then arm the next release.`+(this.state.identityIssues?.length?`\n${this.state.identityIssues.join('\n')}`:'');
             return;
           }
        }
        const strategy=input.workflow==='test'?input.request.strategy:release!.setup.BOOKING_TYPE;
        const courtCount=input.workflow==='test'?input.request.courtCount:release!.setup.COURT_COUNT;
        const players=this.requirePlayers(requiredWorkerIds(strategy,courtCount));this.state.playerStatus=players;
        const fingerprint=expectedPreparationFingerprint(input,release?.fingerprint);
        this.pendingPreparation={input,fingerprint,release,players};
        this.state.workflow=input.workflow;this.state.inspection=null;this.state.handoff=null;this.state.bookingResult=undefined;
        this.state.headline='PREPARING';this.publish();
        const commandInput:PreparationInput=input.workflow==='release'?{workflow:'release',strategy}:
          input.method==='browser'?{workflow:'test',request:input.request,maximum:input.maximum}:input;
        await this.run({kind:'resetPrepare',input:commandInput},gen);await this.noLock();
        const result=this.preparationResult;if(!result||result.fingerprint!==fingerprint||result.workflow!==input.workflow||result.strategy!==strategy)throw Error('PREPARATION_RESULT_MISMATCH');
        const health=await this.health(),required=requiredWorkerIds(strategy,courtCount);if(required.some(id=>!health[id]))throw Error('RESET_REQUIRED');
        this.state.preparedContext=makePreparedContext(input,result,players,release);this.state.ready=true;this.state.preparedAt=Date.parse(this.state.preparedContext.preparedAt);
        this.state.headline=input.workflow==='release'?'READY TO ARM':'READY TO TEST';
        this.state.detail=input.workflow==='release'?`${strategy==='extended'?'Extended':'Standard'} · ${this.state.preparedContext.courtCount} court(s)\nBrowsers: ${required.length} ready\nPlayers: ${required.length} configured\nSelected slots: 0\nPayment holds: none\nAuthorize Terms, then Arm Next Release.`:`${strategy==='extended'?'Extended':'Standard'} · ${this.state.preparedContext.courtCount} court(s)\nDate: ${this.state.preparedContext.date}\nBrowsers: ${required.length} ready\nPlayers: ${required.length} configured\nCurrent booking solution: available\nSelected slots: 0\nPayment holds: none\nAuthorize Terms, then Run Test to QR.`;
      });
    }catch(error){
      if(this.state.operation!=='stopping'&&!['PAYMENT HOLD ACTIVE','TARGET NOT AVAILABLE','EXTENDED PLAYER REQUIRED',"TODAY'S RELEASE HAS PASSED",'AUTOMATION STILL RUNNING','ONDA NEEDS ATTENTION'].includes(this.state.headline)){this.state.headline='RESET REQUIRED';this.state.detail='Check the booking fields, then Reset & Prepare.';this.publish();}
      throw error;
    }finally{this.pendingPreparation=undefined;this.resetting=false;}
  }
  testBooking(value:unknown){const input=TestBookingSchema.parse(value),authorized=this.state.termsAuthorized;this.state.termsAuthorized=false;return this.operation('fullPractice',async gen=>{
    this.requirePlayers(normalWorkerIds(input.request.strategy,input.request.courtCount,input.request.workers));
    const preparation={workflow:'test' as const,method:input.method,request:input.request,maximum:input.maximum};
    if(['api-first','proofless'].includes(input.method)){
      const fingerprint=expectedPreparationFingerprint(preparation);
      if(!this.state.apiFirstReady||this.apiTestFingerprint!==fingerprint)throw Error('RESET_REQUIRED');
      if(!authorized)throw Error('TERMS_AUTHORIZATION_REQUIRED');
      if(!await this.deps.confirmApiTest?.({method:input.method==='proofless'?'proofless':'api-first',...(input.request.wing?{wing:input.request.wing}:{}),strategy:input.request.strategy,date:input.request.date,start:input.request.start,duration:input.request.duration,courtCount:input.request.courtCount,
        maximum:input.maximum,priority:input.request.priority,...(input.request.workers?{workers:input.request.workers}:{})}))return;
      await this.noLock();this.state.handoff=null;this.state.bookingResult=undefined;
      this.state.headline='Checking API availability';this.state.detail='The dedicated API browser remains visible while availability and proofs are checked.';
      await this.run({kind:'apiRun',mode:'live-now',date:input.request.date,fingerprint,checkoutMethod:input.method==='proofless'?'proofless':'proof-based',
        preferences:{...(input.request.wing?{wing:input.request.wing}:{}),strategy:input.request.strategy,date:input.request.date,start:input.request.start,duration:input.request.duration,courtCount:input.request.courtCount,
          maximum:input.maximum,priority:input.request.priority,fallbackStarts:input.request.fallbackStarts,...(input.request.exact?{exact:input.request.exact}:{}),...(input.request.workers?{workers:input.request.workers}:{})}},gen);
      return;
    }
    await this.requirePrepared('test',expectedPreparationFingerprint(preparation),input.request.strategy);
    if(!authorized)throw Error('TERMS_AUTHORIZATION_REQUIRED');
    this.markBrowserReady();
    this.state.handoff=null;this.state.bookingResult=undefined;
    this.state.headline='Checking availability';this.state.detail='Resolving your courts and time ranges before confirmation.';
    await this.run({kind:'testBooking',input},gen);
  });}
  prepare() { return this.resetPrepare({workflow:'release',strategy:this.deps.booking().setup.BOOKING_TYPE}); }
  prepareDual() { return this.operation('prepare', async gen => {
    this.state.booking=this.deps.booking();
    if(this.state.booking.setup.BOOKING_TYPE!=='standard'||this.state.booking.setup.COURT_COUNT!==2)throw Error('LEGACY_DIAGNOSTIC_CONFIG_REQUIRED');
    this.state.dualWorkers={};this.state.dualResult=null;this.state.dualValidation=undefined;
    await this.noLock();this.log('Preparing dual run — starting both dedicated browsers and verifying both clean schedules');
    await this.run('chromeDual',gen);
    await this.run('dualPrepare',gen);await this.noLock();
    if(gen!==this.generation)return;
    this.state.cdp=await this.deps.cdp();
    this.state.dualValidation=this.deps.dualEvidence?await this.deps.dualEvidence():undefined;
    this.state.ready=false;this.state.headline='Dual browsers prepared';
    this.state.detail='Browser A and Browser B are verified, visible, clean and ready for the selected dual practice or release action. Nothing has been selected or armed.';
    this.log('DUAL READY — both browsers verified; nothing selected or armed.');
  }); }
  armObservation() { return this.operation('confirming', async gen => {
    await this.noLock();
    if (!this.deps.clock().canArmToday) throw new Error('TOO_LATE_FOR_PREFLIGHT');
    const confirmed = await this.deps.confirm();
    if (gen !== this.generation) return;
    if (!confirmed) { this.state.headline = 'Arming cancelled'; this.state.detail = 'No observation process was launched.'; this.log('Arming cancelled'); return; }
    await this.noLock();
    this.state.operation = 'observe'; this.state.inspection=null; this.state.headline = 'Starting observation'; this.state.detail = 'Waiting for the existing engine to verify preflight.'; this.publish();
    this.log('Observation authorized for this run'); await this.run('observe', gen);
    this.state.headline = 'Observation complete'; this.state.detail = 'No court slots were selected. Review activity and local telemetry.';
  }); }
  saveBooking(input: unknown) { return this.operation('saving', async () => {
    if((input as {DURATION_HOURS?:number})?.DURATION_HOURS!>6)throw Error('EXTENDED_DURATION_LIMIT');
    const candidate=this.releaseSetup(input);
    this.state.booking=this.deps.saveBooking(candidate.setup);this.state.bookingAdjustment=candidate.reconciliation.removed.length?candidate.reconciliation:null;
    this.state.headline='Booking plan saved'; this.state.detail='Review the compiled plan, then Prepare Booking. Terms authorization is off.';
  }); }
  armSelection() { return this.armBooking('selection'); }
  dryRace() { return this.armBooking('dry'); }
  async setMode(mode:unknown){
    if(this.state.operation!=='idle')throw new Error('OPERATION_ALREADY_RUNNING');
    if(mode!=='selection'&&mode!=='full')throw new Error('MODE_NOT_ALLOWED');
    if(mode==='full'&&!fullBookingReady(this.state.capabilities))throw new Error('LIVE_RACE_BLOCKED');
    this.state.mode=mode;this.state.termsAuthorized=false;this.publish();
  }
  async authorizeTerms(value:unknown){
    if(typeof value!=='boolean')throw new Error('INVALID_TERMS_AUTHORIZATION');
    if(this.state.operation!=='idle')throw new Error('OPERATION_ALREADY_RUNNING');
    const apiReady=this.state.apiFirstReady&&(
      this.state.workflow==='test'?!!this.apiTestFingerprint:['api-first','proofless'].includes(this.state.booking?.setup.BOOKING_METHOD??''));
    if(value&&((!apiReady&&!fullBookingReady(this.state.capabilities))||this.state.lock||!this.state.ready||(!apiReady&&(!this.state.preparedContext||this.state.preparedContext.workflow!==this.state.workflow))))throw new Error('TERMS_AUTHORIZATION_NOT_ALLOWED');
    this.state.termsAuthorized=value;this.publish();
  }
  async armFullBooking(){
    const authorized=this.state.termsAuthorized;this.state.termsAuthorized=false;
    try{if(['api-first','proofless'].includes(this.deps.booking().setup.BOOKING_METHOD))await this.armApiRelease(authorized);
      else await this.armScheduledRelease(authorized);}catch(error){if(this.state.scheduledRelease){this.clearScheduled();this.clearPreparation();this.state.operation='idle';}const code=error instanceof Error?error.message:'SCHEDULE_FAILED';this.state.headline='Needs attention';this.state.detail=errors[code]??code;this.log(code,true);}
  }
  private async armApiRelease(authorized:boolean){
    if(process.env.THIRSTY_API_INSTALLATION!=='1'&&process.env.THIRSTY_API_TEST_INSTALLATION!=='1')throw Error('API_INSTALLATION_REQUIRED');
    if(this.state.operation!=='idle'||!this.state.apiFirstReady||!this.state.ready)throw Error('RESET_REQUIRED');
    if(!authorized)throw Error('TERMS_AUTHORIZATION_REQUIRED');
    await this.noLock();
    const plan=this.deps.booking();
    const liveShotgun=!!plan.setup.STRATEGY_V2?.shotgun?.enabled;
    if(liveShotgun&&plan.setup.PRECISION_PHASE3?.candidates.some(candidate=>candidate.wing==='BUKO'))throw Error('BUKO_SCHEDULED_LIVE_BLOCKED');
    if(plan.setup.STRATEGY_V2?.shotgun?.exactSchedule.some(shot=>shot.configuredOffsetMs>0)||plan.setup.PRECISION_PHASE3?.wave1.some(assignment=>(assignment.fanOutOffsetsMs??[assignment.releaseOffsetMs??0]).some(offset=>offset>0)))
      throw Error('SHOTGUN_PLAN_INCOMPATIBLE_POSITIVE_OFFSET');
    // Arming refreshes the Google offset itself; the runner refreshes it again at T-10 min.
    try{await this.deps.syncClock?.();}catch{/* judged below by freshness */}
    const clock=this.deps.clock();
    this.requirePlayers(planWorkerIds(plan.setup));
    if(!clock.networkSynced)throw Error('NETWORK_CLOCK_SYNC_REQUIRED');
    if(plan.setup.RELEASE_STRATEGY==='precision'&&clock.releaseMs-(Date.now()+clock.clockOffsetMs)<3*60_000)throw Error('PRECISION_TOO_LATE_TO_ARM');
    if(plan.setup.STRATEGY_V2?.shotgun?.enabled && plan.setup.PRECISION_PHASE3){
      const topology=exactShotgunTopology(plan.setup.PRECISION_PHASE3,plan.setup.STRATEGY_V2.shotgun.exactSchedule);
      assertShotgunSchedule(topology,plan.setup.STRATEGY_V2.shotgun.exactSchedule);
      const probes=await this.deps.browserReadiness?.();
      this.workerProbes=probes??{};
      assertShotgunTabs(topology,probes??{});
      const machine=this.deps.machineHealth?.();
      if(!machine || machine.eventLoopP95Ms>=SHOTGUN_MAX_TRIGGER_LATENESS_MS || machine.memoryUsedPct>=92)throw Error('SHOTGUN_MACHINE_NOT_READY');
      assertShotgunPrewarm(this.forecastPrewarm(plan),topology.shots.length);
      const timing=readShotgunTiming('.local/shotgun-timing/latest.json',topology,this.state.build?.dirty?'dirty':this.state.build?.gitSha??'unknown',shotgunBrowserVersion(topology,probes??{}));
      if(timing && timing.status!=='READY')throw Error('SHOTGUN_TIMING_NOT_READY');
    }
    if(plan.setup.PRECISION_PHASE3){this.state.prewarmFeasibility=this.forecastPrewarm(plan);if(!this.state.prewarmFeasibility)throw Error('PREWARM_FEASIBILITY_UNAVAILABLE');
      if(this.state.prewarmFeasibility.projectedOmitted)throw Error('PREWARM_PLAN_NOT_FEASIBLE');}
    if(clock.releaseMs<=Date.now()+clock.clockOffsetMs)throw Error('RELEASE_MISSED');
    const confirmed=await this.deps.confirm('full',plan);if(!confirmed)return;
    // LIVE_PILOT capability: the owner attests, for this exact plan and run, that the provider authorizes this multi-attempt
    // Shotgun. Without an attestation dependency (tests, headless use) live Shotgun fails closed.
    if(liveShotgun){
      const attested=await this.deps.confirmShotgunLive?.(plan)??false;
      if(!attested){this.state.headline='Live Shotgun not armed';this.state.detail='The owner attestation was declined. Nothing was armed; edit, save and offline testing remain available.';this.log('SHOTGUN_LIVE_ATTESTATION_DECLINED');return;}
      this.deps.recordShotgunAttestation?.({fingerprint:plan.fingerprint,targetDate:plan.targetDate,releaseMs:clock.releaseMs,attempts:plan.setup.STRATEGY_V2!.shotgun!.exactSchedule.length});
      this.log(`Live Shotgun pilot attested for plan ${plan.fingerprint.slice(0,12)} · ${plan.setup.STRATEGY_V2!.shotgun!.exactSchedule.length} attempts`);
    }
    if(this.deps.booking().fingerprint!==plan.fingerprint||this.deps.clock().releaseMs!==clock.releaseMs)
      throw Error('SCHEDULE_CONTEXT_MISMATCH');
    const proofless=plan.setup.BOOKING_METHOD==='proofless';
    const command={kind:'apiRun',mode:'live',date:plan.targetDate,fingerprint:plan.fingerprint,checkoutMethod:proofless?'proofless':'proof-based',clockOffsetMs:clock.clockOffsetMs,releaseMs:clock.releaseMs,...(liveShotgun?{shotgunAttestation:plan.fingerprint}:{})} as const;
    // Preregistration uses the runner's own date/release and completes before anything starts; a failure arms nothing.
    const preregistered=this.preregister(command.date,command.releaseMs,command.clockOffsetMs);
    if(this.deps.startSleepProtection){this.sleepBlockerId=this.deps.startSleepProtection();this.state.sleepProtection=true;}
    this.beginSlotWatch(plan.targetDate,clock.releaseMs,'release');
    try{await this.operation('full',async gen=>{
      this.log(preregistered);
      this.state.headline=proofless?'PROOFLESS DIRECT ARMED':'API FIRST ARMED';this.state.detail=proofless?'The saved plan will be block-audited at 7:30 and dispatched prooflessly at the network-clock release boundary.':'The isolated browser will wait for release and acquire fresh availability proofs.';this.publish();
      await this.run(command,gen);
    });}finally{this.stopSleepProtection();this.publish();}
  }
  /**
   * Wave 1 arbitration preregistration for exactly the release about to be armed. Returns the Activity line to
   * journal with the run; throws the manifest code (nothing started) when it cannot be created or verified.
   */
  private preregister(targetDate:string,releaseMs:number,clockOffsetMs:number):string{
    let result:EnsureManifestResult|{status:'BLOCKED';code:'ARBITRATION_MANIFEST_UNAVAILABLE';reason:string;path:null};
    try{result=this.deps.ensureArbitrationManifest?.({targetDate,releaseMs,clockOffsetMs})
      ??{status:'BLOCKED',code:'ARBITRATION_MANIFEST_UNAVAILABLE',reason:'no manifest service in this build',path:null};}
    catch(error){result={status:'BLOCKED',code:'ARBITRATION_MANIFEST_STORAGE_FAILED',reason:error instanceof Error?error.message:'unknown error',path:null};}
    const release=`target ${targetDate} · release ${Number.isFinite(releaseMs)?new Date(releaseMs).toISOString():'invalid'}`;
    if(result.status==='BLOCKED'){
      const details=result.code==='ARBITRATION_MANIFEST_MISMATCH'||result.code==='ARBITRATION_MANIFEST_MALFORMED'?` Details: ${result.reason}.`:'';
      this.state.arbitrationManifest={status:'blocked',targetDate,releaseMs,code:result.code,reason:`${errors[result.code]??result.code}${details}`};
      this.log(`ARBITRATION_MANIFEST_BLOCKED · ${release} · ${result.code} · ${result.reason}${result.path?` · existing file kept: ${result.path}`:''}`,true);
      this.publish();throw Error(result.code);
    }
    this.state.arbitrationManifest={status:'ready',targetDate,releaseMs,verified:result.status==='VERIFIED',createdAt:result.manifest.createdAt};
    return `ARBITRATION_MANIFEST_${result.status} · ${release} · preregistered ${result.manifest.createdAt}`;
  }
  private async armScheduledRelease(authorized:boolean){
    if(this.state.scheduledRelease){await this.cancelScheduledRelease();return;}
    if(this.state.operation!=='idle')throw Error('OPERATION_ALREADY_RUNNING');
    if(!fullBookingReady(this.state.capabilities))throw Error('LIVE_RACE_BLOCKED');
    await this.noLock();const plan=this.deps.booking();
    if(['api-first','proofless'].includes(plan.setup.BOOKING_METHOD))throw Error('API_FIRST_LIVE_CHECKOUT_BLOCKED');
    if(!plan.playerConfigured)throw Error('PLAYER_INFO_MISSING');if(plan.setup.BOOKING_TYPE==='extended'&&!plan.extendedPlayerConfigured)throw Error('EXTENDED_PLAYER_INFO_MISSING');
    await this.requirePrepared('release',plan.fingerprint,plan.setup.BOOKING_TYPE);if(!authorized)throw Error('TERMS_AUTHORIZATION_REQUIRED');
    const clock=this.deps.clock(),prepared=this.state.preparedContext!;
    if(!clock.networkSynced)throw Error('NETWORK_CLOCK_SYNC_REQUIRED');
    const context=scheduledReleaseContext(prepared,plan,clock);
    const confirmed=await this.deps.confirm('full',plan);if(!confirmed){this.state.headline='Arming cancelled';this.state.detail='No release was scheduled.';this.publish();return;}
    await this.noLock();const fresh=this.deps.clock();if(this.deps.booking().fingerprint!==context.configFingerprint||fresh.releaseMs!==context.releaseMs||fresh.targetDate!==context.targetDate)throw Error('SCHEDULE_CONTEXT_MISMATCH');
    const generation=++this.generation;this.state.termsAuthorized=false;this.state.scheduledRelease=context;this.state.scheduleStatus='WAITING';this.state.operation='scheduled';
    if(this.deps.startSleepProtection){this.sleepBlockerId=this.deps.startSleepProtection();this.state.sleepProtection=true;}
    const wakeAt=context.releaseMs-fresh.wakeSecondsBefore*1000,delay=Math.max(0,wakeAt-(Date.now()+fresh.clockOffsetMs));
    this.scheduledTimer=setTimeout(()=>{void this.executeScheduled(context,generation);},delay);
    this.beginSlotWatch(context.targetDate,context.releaseMs,'release');
    this.state.headline='ARMED FOR NEXT RELEASE';this.state.detail=`Exact release and booking target frozen. The browser reconnect starts ${fresh.wakeSecondsBefore} seconds before release. Keep the PC powered on; do not hibernate or close the lid if Windows sleeps on lid close.`;this.publish();
  }
  private async executeScheduled(context:ScheduledReleaseContext,generation:number){
    this.scheduledTimer=undefined;
    let outcome='complete';
    try{
      if(generation!==this.generation||this.state.scheduledRelease?.generation!==context.generation)return;
      this.beginRun(`release · ${context.strategy}`);
      if(Date.now()+this.deps.clock().clockOffsetMs>=context.releaseMs)throw Error('RELEASE_MISSED');
      const plan=this.deps.booking(),clock=this.deps.clock();
      if(plan.fingerprint!==context.configFingerprint||clock.releaseMs!==context.releaseMs||clock.targetDate!==context.targetDate)throw Error('SCHEDULE_CONTEXT_MISMATCH');
      this.state.scheduleStatus='WAKE / RECONNECT';this.state.headline='WAKE / RECONNECT';this.publish();
      await this.run(context.strategy==='extended'?'chromeDual':'chrome',generation);
      this.preparationResult=undefined;
      await this.run({kind:'resetPrepare',input:{workflow:'release',strategy:context.strategy}},generation);
      const result=this.preparationResult as PreparationResult|undefined;
      if(!result||result.fingerprint!==context.preparedFingerprint||result.releaseMs!==context.releaseMs||result.releaseTargetDate!==context.targetDate)throw Error('PREPARED_FINGERPRINT_MISMATCH');
      if(Date.now()+this.deps.clock().clockOffsetMs>=context.releaseMs)throw Error('RELEASE_MISSED');
      this.markBrowserReady();
      this.state.scheduleStatus='FINAL PREFLIGHT';this.state.operation='full';this.state.headline='FINAL PREFLIGHT';this.publish();
      await this.run({kind:'full',context,authorizeTerms:true},generation);
      if(!this.state.handoff&&!this.state.bookingResult)throw Error('HANDOFF_STATUS_UNKNOWN');
    }catch(error){
      outcome='failed';
      if(generation!==this.generation)return;
      const code=error instanceof Error?error.message:'SCHEDULE_FAILED';
      this.state.headline=code==='RELEASE_MISSED'?'RELEASE MISSED':code==='SCHEDULE_CONTEXT_MISMATCH'||code==='PREPARED_FINGERPRINT_MISMATCH'?'SCHEDULE CANCELLED - SETTINGS CHANGED':'Needs attention';
      this.state.detail=code==='RELEASE_MISSED'?'The exact armed timestamp passed. No late booking was attempted and the run was not moved to another day.':errors[code]??code;this.log(code,true);
    }finally{
      if(generation===this.generation){this.finishRun(outcome);this.clearScheduled();this.clearPreparation();this.state.operation='idle';await this.refresh();this.publish();}
    }
  }
  private armBooking(kind:'selection'|'dry') { return this.operation('confirming', async gen => {
    await this.noLock(); if (!this.deps.clock().canArmToday) throw new Error('TOO_LATE_FOR_PREFLIGHT');
    if (kind==='selection' && !this.state.capabilities.selectionReady) throw new Error('SELECTION_NOT_READY');
    const plan=this.deps.booking();if(['api-first','proofless'].includes(plan.setup.BOOKING_METHOD))throw Error('API_FIRST_LIVE_CHECKOUT_BLOCKED');if(!plan.playerConfigured)throw Error('PLAYER_INFO_MISSING');if(plan.setup.BOOKING_TYPE==='extended'&&!plan.extendedPlayerConfigured)throw Error('EXTENDED_PLAYER_INFO_MISSING');this.state.booking=plan; this.state.selection=null;
    this.state.bookingResult=undefined;
    const confirmed=await this.deps.confirm(kind,plan);
    if(gen!==this.generation)return;
    if(!confirmed){this.state.headline='Arming cancelled';this.state.detail='No booking process was launched.';return;}
    await this.noLock();
    if(this.deps.booking().fingerprint!==plan.fingerprint)throw new Error('BOOKING_PLAN_CHANGED');
    if(!this.deps.clock().canArmToday)throw new Error('TOO_LATE_FOR_PREFLIGHT');
    this.markBrowserReady();
    this.state.operation=kind;this.state.inspection=null;this.state.handoff=null;this.state.headline=kind==='selection'?'Selection scheduled':'Dry Race scheduled';
    this.state.detail=kind==='selection'?'At release the engine may select slots. It will stop before Proceed.':'Release, date, grid and preference checks only. No slots will be selected.';this.publish();
    await this.run({kind,planHash:plan.fingerprint},gen);
    if(this.state.dualActive){if(!this.state.dualResult)throw Error('DUAL_RESULT_MISSING');return;}
    if(kind==='dry'){this.state.headline='Dry Race complete';this.state.detail='No slots selected. Review availability and preference events.';}
    else if(kind==='selection'&&!this.state.selection&&!this.state.bookingResult)throw new Error('SELECTION_RESULT_MISSING');
  }); }
  reviewLock(){return this.operation('reviewing',async()=>{
    if(!this.deps.reviewLock)throw Error('LOCK_BROWSER_STATE_UNKNOWN');
    this.state.lockReview=await this.deps.reviewLock(!!this.active);
    this.state.headline=this.state.lockReview.canClear?'VERIFIED STALE LOCK':'AUTOMATION LOCK ACTIVE';
    this.state.detail=errors[this.state.lockReview.reason]??'PID is dead, schedule is clean, selected slots: 0. Safe clearing is available after confirmation.';
  });}
  clearLock(){return this.operation('clearing',async gen=>{
    if(!this.deps.reviewLock||!this.deps.clearLock||!this.deps.confirmClear)throw Error('LOCK_BROWSER_STATE_UNKNOWN');
    const review=await this.deps.reviewLock(!!this.active);this.state.lockReview=review;this.publish();
    if(!review.canClear)throw Error(review.reason);
    if(!await this.deps.confirmClear(review)||gen!==this.generation)return;
    await this.deps.clearLock(review.fingerprint,()=>!!this.active||gen!==this.generation);
    this.state.lockReview=null;this.state.handoff=null;this.state.qrHandoffs=[];this.state.selection=null;
    this.state.headline='Verified stale lock cleared';this.state.detail='Prepare again before booking.';
  });}
  resetPractice(){return this.operation('resetting',async gen=>{
    if(!this.deps.resetPractice||!this.deps.confirmReset)throw Error('PRACTICE_RESET_UNAVAILABLE');
    if(!await this.deps.confirmReset()||gen!==this.generation){this.state.headline='Practice reset cancelled';this.state.detail='No browser or lock state was changed.';return;}
    await this.deps.resetPractice();
    this.state.lock=await this.deps.lock();this.state.cdp=await this.deps.cdp();this.state.lockReview=null;this.state.handoff=null;this.state.qrHandoffs=[];this.state.selection=null;this.state.inspection=null;this.state.ready=false;
    this.state.headline='Practice session reset';this.state.detail='Dedicated Chrome was restarted and the local practice lock was cleared. Set the exact target and run Full Flow Practice again.';
  });}
  /**
   * Closes every Chrome window the bot started (profiles under .local) and never the operator's own Chrome.
   * Blocked while anything runs or a release is armed, because that would break a booking in progress.
   */
  closeBotBrowsers(){return this.operation('closingBrowsers',async gen=>{
    if(!this.deps.closeBotBrowsers)throw Error('CLOSE_BROWSERS_UNAVAILABLE');
    const open=this.deps.countBotBrowsers?await this.deps.countBotBrowsers():Object.values(this.state.browserHealth??{}).filter(Boolean).length;
    if(open===0){this.state.headline='NO BOT BROWSERS OPEN';this.state.detail='No Chrome window started by the bot is running. Nothing was closed.';return;}
    const qrPages=(this.state.qrHandoffs??[]).filter(hold=>!hold.holdExpiresAt||Date.parse(hold.holdExpiresAt)>Date.now()).length;
    if(!this.deps.confirmCloseBrowsers||!await this.deps.confirmCloseBrowsers({open,qrPages,lock:this.state.lock})||gen!==this.generation){
      this.state.headline='Close browsers cancelled';this.state.detail='No browser was closed.';return;
    }
    const result=await this.deps.closeBotBrowsers();
    this.clearPreparation();
    const plural=result.closed===1?'':'s';
    this.log(`Closed ${result.closed} bot Chrome browser${plural}${result.forced?` (${result.forced} force-closed after not responding)`:''}. Your own Chrome windows were not touched.`);
    this.state.headline='BOT BROWSERS CLOSED';
    this.state.detail=`${result.closed} Chrome browser${plural} started by the bot ${result.closed===1?'was':'were'} closed. Your own Chrome windows were not touched. Press Reset & Prepare to reopen the browsers a run needs.`;
  });}
  runFullPractice(input:unknown){return this.operation('confirming',async gen=>{
    if(!input||typeof input!=='object'||!('authorizeTerms' in input)||input.authorizeTerms!==true)throw Error('TERMS_AUTHORIZATION_REQUIRED');
    const parsed=FullPracticeSchema.parse(input);
    if(!fullBookingReady(this.state.capabilities))throw Error('LIVE_RACE_BLOCKED');
    await this.noLock();if(!await this.deps.cdp())throw Error('CDP_PROFILE_OR_BIND_UNVERIFIED');
    try{if(!this.deps.booking().playerConfigured)throw Error();}catch{throw Error('PLAYER_INFO_MISSING');}
    if(!this.deps.confirmPractice||!await this.deps.confirmPractice(parsed)||gen!==this.generation)return;
    await this.noLock();
    this.markBrowserReady();
    this.state.operation='fullPractice';this.state.handoff=null;this.state.qrHandoffs=[];this.state.selection=null;this.state.inspection=null;
    this.state.headline='Full Flow Practice running';this.state.detail='Exact target, immediate start. Automation stops at QR Checkout.';this.publish();
    await this.run({kind:'fullPractice',input:parsed},gen);
    if(!this.state.handoff)throw Error('QR_HANDOFF_FAILED');
    this.state.headline='FULL FLOW PRACTICE COMPLETE';this.state.detail='PAYMENT HOLD ACTIVE. AUTOMATION STOPPED. DO NOT PAY UNLESS YOU ACTUALLY WANT THIS PRACTICE BOOKING. Lock retained.';
  });}
  runDualPractice(input:unknown){return this.operation('practice',async gen=>{
    const command=z.discriminatedUnion('kind',[
      z.object({kind:z.literal('dualDry'),date:z.iso.date()}).strict(),
      z.object({kind:z.enum(['dualPractice','dualFullPractice']),input:DualPracticeSchema}).strict(),
    ]).parse(input);
    if(this.deps.booking().setup.BOOKING_TYPE!=='standard'||this.deps.booking().setup.COURT_COUNT!==2)throw Error('LEGACY_DIAGNOSTIC_CONFIG_REQUIRED');
    if(command.kind==='dualFullPractice')requireDualFullAuthorization(command.input);
    await this.noLock();
    if(command.kind==='dualFullPractice'&&(!this.deps.confirmDualPractice||!await this.deps.confirmDualPractice(command)||gen!==this.generation))return;
    await this.noLock();this.markBrowserReady();this.state.dualActive=true;this.state.dualResult=null;this.state.dualWorkers={};
    this.state.headline=command.kind==='dualFullPractice'?'TWO REAL TEMPORARY HOLDS AUTHORIZED':'Dual practice running';this.publish();
    await this.run(command,gen);
    if(!this.state.dualResult)throw Error('DUAL_RESULT_MISSING');
  });}
  runPractice(input:unknown) { return this.operation('practice', async gen => {
    const parsed=PracticeSchema.parse(input); await this.noLock();this.state.selection=null;this.state.inspection=null;
    this.state.headline='Safe practice running';this.state.detail='Select → verify → deselect → verify clean. Never Proceed.';
    this.markBrowserReady();
    await this.run({kind:'practice',input:parsed},gen);
    this.state.headline='Practice complete';this.state.detail='Selection verified and cleared. Proceed was never clicked.';
  }); }
  async abortAutomation() {
    this.state.termsAuthorized=false;
    if(this.state.scheduledRelease){await this.cancelScheduledRelease('SCHEDULE CANCELLED');return;}
    if(this.availabilityProcess){await this.availabilityProcess.stop().catch(()=>undefined);this.log('Availability check stopped');}
    if (this.state.operation === 'idle') { this.log('No UI-launched automation is running. External CLI processes are not controlled by this panel.'); return; }
    this.stopReleaseSlotWatchBeforeRelease('release aborted');
    ++this.generation; this.state.ready = false; this.state.operation = 'stopping'; this.publish();
    try {
      await this.active?.stop(); this.active = undefined;this.state.activeApiRelease=null;
      this.state.operation = 'idle'; this.state.headline = 'Automation aborted'; this.state.detail = 'USER CONTROL RESTORED. Chrome remains open. Check the retained lock manually before another run.';
      this.log('AUTOMATION ABORTED — USER CONTROL RESTORED');this.finishRun('aborted'); await this.refresh();
    } catch { this.state.headline = 'Stop not confirmed'; this.state.detail = 'The automation process has not exited. Retry Emergency Stop; check Task Manager.'; this.log('STOP_NOT_CONFIRMED', true); }
    this.publish();
  }
}
