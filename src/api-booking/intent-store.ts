import { createHash } from 'node:crypto';
import type { BookingPreferences, PendingHold } from './types.js';

export type IntentState = 'submitting' | 'confirmed-failure' | 'unknown' | 'partial' | 'held' | 'checkout-failed' | 'handoff-ready';
export interface BookingIntent { id: string; state: IntentState; holds: PendingHold[]; runId: string }

// Offline interface and in-memory implementation. This is not cross-process protection.
export class MemoryIntentStore {
  private readonly intents = new Map<string, BookingIntent>();
  get(id: string) { return this.intents.get(id); }
  begin(id: string, runId: string) {
    if (this.intents.has(id)) throw Error('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
    const intent: BookingIntent = { id, state: 'submitting', holds: [], runId };
    this.intents.set(id, intent);
    return intent;
  }
  set(id: string, state: IntentState, holds: PendingHold[] = []) {
    const intent = this.intents.get(id);
    if (!intent) throw Error('BOOKING_INTENT_MISSING');
    intent.state = state;
    intent.holds = structuredClone(holds);
  }
}

export function logicalBookingId(p: BookingPreferences): string {
  const identity = [p.targetDate, p.mode, p.durationHours, p.courtCount,
    [...new Set(p.preferredStartTimes)], [...new Set(p.fallbackStartTimes)],
    p.exactCourts ?? null, [...new Set(p.courtPriority)], [...new Set(p.fallbackCourts)]];
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}
