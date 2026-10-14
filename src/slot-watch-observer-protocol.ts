import type { AvailabilityObservation } from './slot-evidence.js';
import type { SlotWatchCandidate, SlotWatchSummary, SlotWatchView } from './slot-watch.js';

export const SLOT_WATCH_OBSERVER_PROTOCOL = 'slot-watch-observer/v1' as const;
export interface ObserverStart { browserObservation?:boolean; protocol:typeof SLOT_WATCH_OBSERVER_PROTOCOL;type:'start';id:string;date:string;releaseMs:number;directory:string;clockPath?:string;clockOffsetMs:number;clockSynced:boolean;candidates:SlotWatchCandidate[] }
export interface ObserverStop { protocol:typeof SLOT_WATCH_OBSERVER_PROTOCOL;type:'stop';id:string;reason:string }
export type ObserverCommand = ObserverStart | ObserverStop;
export type ObserverEvent =
  | {protocol:typeof SLOT_WATCH_OBSERVER_PROTOCOL;type:'started';id:string;seq:number}
  | {protocol:typeof SLOT_WATCH_OBSERVER_PROTOCOL;type:'view';id:string;seq:number;view:SlotWatchView}
  | {protocol:typeof SLOT_WATCH_OBSERVER_PROTOCOL;type:'observation';id:string;seq:number;observation:AvailabilityObservation}
  | {protocol:typeof SLOT_WATCH_OBSERVER_PROTOCOL;type:'complete';id:string;seq:number;summary:SlotWatchSummary}
  | {protocol:typeof SLOT_WATCH_OBSERVER_PROTOCOL;type:'failed';id:string;seq:number;code:string};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function isObserverEvent(value: unknown): value is ObserverEvent {
  if (!record(value) || value.protocol !== SLOT_WATCH_OBSERVER_PROTOCOL || typeof value.id !== 'string' || !Number.isSafeInteger(value.seq)) return false;
  if (!['started','view','observation','complete','failed'].includes(String(value.type))) return false;
  if (value.type === 'view') return record(value.view) && value.view.id !== undefined;
  if (value.type === 'observation') return record(value.observation) && Number.isSafeInteger(value.observation.seq);
  if (value.type === 'complete') return record(value.summary) && value.summary.version === 3;
  if (value.type === 'failed') return typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value.code);
  return true;
}
