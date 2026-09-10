import type { UiEvent } from '../src/ui-events.js';
import type { clockStatus } from './status.js';
import type { BookingView } from './booking.js';
import type { BookingSetup } from '../src/config.js';
import type { PracticeInput } from '../src/practice.js';
export type Command = 'chrome' | 'inspect' | 'observe' | { kind:'selection' | 'dry'; planHash:string } | { kind:'practice'; input:PracticeInput };
export type Inspection = Extract<UiEvent, { type: 'inspection' }>;
export interface Activity { at: string; text: string; level: 'info' | 'error' }
export interface Dashboard {
  operation: 'idle' | 'chrome' | 'inspect' | 'prepare' | 'confirming' | 'observe' | 'selection' | 'dry' | 'practice' | 'stopping' | 'saving';
  headline: string; detail: string; ready: boolean; cdp: boolean; lock: boolean;
  inspection: Inspection | null; clock: ReturnType<typeof clockStatus> | null;
  plan: Extract<UiEvent, { type: 'plan' }> | null; logs: Activity[]; liveRace: false;
  booking: BookingView | null; termsAuthorized: boolean;
  capabilities: { selectionReady:boolean; checkoutReady:boolean; paymentBoundaryReady:boolean };
  selection: Extract<UiEvent, {type:'selection'}> | null;
}
export interface Bridge {
  startChrome(): Promise<void>; inspectOnda(): Promise<void>; prepare(): Promise<void>;
  armObservation(): Promise<void>; abortAutomation(): Promise<void>; getStatus(): Promise<Dashboard>;
  saveBooking(input: BookingSetup): Promise<void>; armSelection(): Promise<void>; dryRace(): Promise<void>; runPractice(input:PracticeInput): Promise<void>;
  onStatus(callback: (status: Dashboard) => void): () => void;
}
