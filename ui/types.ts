import type { UiEvent } from '../src/ui-events.js';
import type { clockStatus } from './status.js';
export type Command = 'chrome' | 'inspect' | 'observe';
export type Inspection = Extract<UiEvent, { type: 'inspection' }>;
export interface Activity { at: string; text: string; level: 'info' | 'error' }
export interface Dashboard {
  operation: 'idle' | 'chrome' | 'inspect' | 'prepare' | 'confirming' | 'observe' | 'stopping';
  headline: string; detail: string; ready: boolean; cdp: boolean; lock: boolean;
  inspection: Inspection | null; clock: ReturnType<typeof clockStatus> | null;
  plan: Extract<UiEvent, { type: 'plan' }> | null; logs: Activity[]; liveRace: false;
}
export interface Bridge {
  startChrome(): Promise<void>; inspectOnda(): Promise<void>; prepare(): Promise<void>;
  armObservation(): Promise<void>; abortAutomation(): Promise<void>; getStatus(): Promise<Dashboard>;
  onStatus(callback: (status: Dashboard) => void): () => void;
}
