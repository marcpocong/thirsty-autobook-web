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
export type DualPracticeCommand = { kind:'dualDry'; date:string } | { kind:'dualPractice'|'dualFullPractice'; input:DualPracticeInput };
export interface ApiRunPreferences {strategy:'standard'|'extended';date:string;start:string;duration:number;courtCount:1|2;maximum:number;priority:number[];fallbackStarts:string[];exact?:number[][]}
export type Command = {kind:'resetPrepare';input:PreparationInput} | {kind:'testBooking';input:TestBookingInput} | {kind:'apiRun';mode:'prepare'|'dry'|'live'|'live-now';date:string;fingerprint:string;releaseMs?:number;preferences?:ApiRunPreferences} | {kind:'apiPreview';date:string} | DualPracticeCommand | 'chromeDual' | 'dualReadiness' | 'dualPrepare' | {kind:'fullPractice';input:FullPracticeInput} | 'chrome' | 'inspect' | 'observe' | { kind:'selection' | 'dry'; planHash:string } | {kind:'full';context:ScheduledReleaseContext;authorizeTerms:true} | { kind:'practice'; input:PracticeInput };
export type Inspection = Extract<UiEvent, { type: 'inspection' }>;
export interface Activity { at: string; text: string; level: 'info' | 'error' }
export interface Dashboard {
  bookingResult?:Extract<UiEvent,{type:'bookingResult'}>;
  workflow?:'test'|'release';
  preparedAt?:number;
  preparedContext?:PreparedContext|null;
  browserHealth?:{A:boolean;B:boolean};
  playerStatus?:{primary:boolean;extended:boolean};
  dualWorkers?:Partial<Record<'A'|'B',Extract<UiEvent,{type:'dualWorker'}>>>;
  dualResult?:Extract<UiEvent,{type:'dualResult'}>|null;
  dualValidation?:{selection:boolean;full:boolean};
  dualActive?:boolean;
  releasePerformance?: Extract<UiEvent, { type: 'releasePerformance' }>['summary'] | null;
  lockReview?:LockReview|null;
  operation: 'idle' | 'scheduled' | 'chrome' | 'inspect' | 'prepare' | 'confirming' | 'observe' | 'selection' | 'full' | 'dry' | 'practice' | 'stopping' | 'saving' | 'reviewing' | 'clearing' | 'resetting' | 'fullPractice' | 'apiPreview';
  headline: string; detail: string; ready: boolean; cdp: boolean; lock: boolean;
  inspection: Inspection | null; clock: ReturnType<typeof clockStatus> | null;
  plan: Extract<UiEvent, { type: 'plan' }> | null; logs: Activity[]; liveRace: boolean;
  booking: BookingView | null; termsAuthorized: boolean; apiFirstReady?: boolean;
  apiStage?:Extract<UiEvent,{type:'apiStage'}>|null;
  bookingAdjustment?:FallbackReconciliation|null;
  scheduledRelease?:ScheduledReleaseContext|null;
  sleepProtection?:boolean;
  scheduleStatus?:'WAITING'|'WAKE / RECONNECT'|'FINAL PREFLIGHT'|'RUNNING'|'MISSED'|null;
  capabilities: { selectionReady:boolean; checkoutReady:boolean; paymentBoundaryReady:boolean };
  selection: Extract<UiEvent, {type:'selection'}> | null;
  mode:'selection'|'full'; handoff:Extract<UiEvent,{type:'handoff'}>|null;
}
export interface Bridge {
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
}
