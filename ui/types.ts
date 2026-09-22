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
export type DualPracticeCommand = { kind:'dualDry'; date:string } | { kind:'dualPractice'|'dualFullPractice'; input:DualPracticeInput };
export interface ConfirmRequest { id:string; tone:'question'|'warning'; title:string; message:string; detail:string; confirmLabel:string; cancelLabel?:string }
export interface ApiRunPreferences {strategy:'standard'|'extended';date:string;start:string;duration:number;courtCount:CourtCount;maximum?:number;priority:number[];fallbackStarts:string[];exact?:number[][]}
export type Command = {kind:'resetPrepare';input:PreparationInput} | {kind:'testBooking';input:TestBookingInput} | {kind:'apiRun';mode:'prepare'|'dry'|'live'|'live-now';date:string;fingerprint:string;releaseMs?:number;preferences?:ApiRunPreferences} | {kind:'apiPreview';date:string} | DualPracticeCommand | 'chromeDual' | 'dualReadiness' | 'dualPrepare' | {kind:'fullPractice';input:FullPracticeInput} | 'chrome' | 'inspect' | 'observe' | { kind:'selection' | 'dry'; planHash:string } | {kind:'full';context:ScheduledReleaseContext;authorizeTerms:true} | { kind:'practice'; input:PracticeInput };
export type Inspection = Extract<UiEvent, { type: 'inspection' }>;
export interface Activity { at: string; text: string; level: 'info' | 'error'; elapsedMs?:number; deltaMs?:number }
export interface RunTiming { runId:string; label:string; startedAt:string; elapsedMs:number; endedAt?:string; logPath?:string; readyAt?:string; readyElapsedMs?:number }
export interface RunHistoryEntry { runId:string; label:string; startedAt:string; endedAt:string; outcome:string; totalElapsedMs:number; readyAt?:string; readyElapsedMs?:number; activities:Activity[]; qrHandoffs?:QrHandoffSummary[] }
export interface QrHandoffSummary { checkout?:WorkerId; status?:'hold-created'|'qr-ready'; courts:number[]; date:string; startTime:string; endTime:string; amount:number; verifiedAt:string; holdExpiresAt?:string; bookingId?:string; bookingNo?:string }
export interface Dashboard {
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
  operation: 'idle' | 'scheduled' | 'chrome' | 'inspect' | 'prepare' | 'confirming' | 'observe' | 'selection' | 'full' | 'dry' | 'practice' | 'stopping' | 'saving' | 'reviewing' | 'clearing' | 'resetting' | 'fullPractice' | 'apiPreview';
  headline: string; detail: string; ready: boolean; cdp: boolean; lock: boolean;
  canPrepareOverHold?:boolean;
  retainedLockStage?:'HOLD_VERIFIED'|'FINAL_ACTION_DISPATCHING'|null;
  previousHolds?:PreviousHold[];
  inspection: Inspection | null; clock: ReturnType<typeof clockStatus> | null;
  plan: Extract<UiEvent, { type: 'plan' }> | null; logs: Activity[]; liveRace: boolean;
  booking: BookingView | null; termsAuthorized: boolean; apiFirstReady?: boolean;
  apiStage?:Extract<UiEvent,{type:'apiStage'}>|null;
  observedPrice?:number|null;
  qrHandoffs?:QrHandoffSummary[];
  runTiming?:RunTiming|null;
  runHistory?:RunHistoryEntry[];
  bookingAdjustment?:FallbackReconciliation|null;
  scheduledRelease?:ScheduledReleaseContext|null;
  sleepProtection?:boolean;
  scheduleStatus?:'WAITING'|'WAKE / RECONNECT'|'FINAL PREFLIGHT'|'RUNNING'|'MISSED'|null;
  capabilities: { selectionReady:boolean; checkoutReady:boolean; paymentBoundaryReady:boolean };
  selection: Extract<UiEvent, {type:'selection'}> | null;
  mode:'selection'|'full'; handoff:Extract<UiEvent,{type:'handoff'}>|null;
}
export interface Bridge {
  focusBrowser(request:{workerId:WorkerId;bookingId?:string}):Promise<BrowserFocusResult>;
  resetPrepare(input:PreparationInput):Promise<void>;
  apiPreview(date:string):Promise<void>;
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
