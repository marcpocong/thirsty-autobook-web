import { DurableSubmissionJournal } from './durable-submission-journal.js';
import type { BookingPlan } from './types.js';
import { internalHourMinutes, internalWireEnd, ondaWireBoundary } from '../time-range.js';

/**
 * Arm/freeze-time self-check of the EXACT checkout body the hot path will send.
 *
 * The 2026-09-29 release lost every attempt to a payload bug (the 23:00 hour sent as ending "24:00",
 * answered 400 "Invalid booking session time"). No earlier check ever serialized a checkout body.
 * This runs on the serialized string itself, before anything is armed, so a malformed request fails
 * at arming and never at release. It is pure, synchronous and allocation-light (well under a
 * millisecond), and is never called between the release trigger and the POST.
 */
export class WirePayloadError extends Error {
  constructor(readonly code: string, readonly detail: string) { super(code); this.name = 'WirePayloadError'; }
}

const WIRE_HOUR = /^([01]\d|2[0-3]):00$/;
const cents = (value: number) => Math.round(value * 100);
const fail = (detail: string): never => { throw new WirePayloadError('WIRE_PAYLOAD_SELF_CHECK_FAILED', detail); };

interface WireItem { sessionRef?: unknown; facilityId?: unknown; spaceId?: unknown; date?: unknown; startTime?: unknown; endTime?: unknown;
  duration?: unknown; rate?: unknown; chargedAmount?: unknown }

/** The permit/journal key the transport derives from a wire body: first item's start, last item's end in internal form. */
export function wireRequestKey(facilityId: string, items: ReadonlyArray<{ spaceId: string; date: string; startTime: string; endTime: string }>): string {
  const first = items[0], last = items.at(-1);
  if (!first || !last) fail('no items');
  return DurableSubmissionJournal.key(facilityId, first!.spaceId, first!.date, first!.startTime, internalWireEnd(last!.endTime));
}

/**
 * Asserts, for one serialized proofless checkout body:
 *  - no internal "24:00" appears anywhere on the wire, and midnight is Onda's "00:00" (only as the end of 23:00);
 *  - every item is one whole hour (duration 60) and the items of each session are contiguous on one court/date;
 *  - the items are exactly the plan's slots (court, date, hours) with valid, positive prices that sum to the plan total;
 *  - the key the transport will derive equals the expected journal/permit key (same logical range);
 *  - the serialization is stable (parse → stringify reproduces the exact bytes).
 */
export function assertWireCheckoutBody(body: string, plan: BookingPlan, expectedKey: string): void {
  if (typeof body !== 'string' || !body.length) fail('empty body');
  if (body.includes('24:00')) fail('internal 24:00 boundary on the wire');
  let parsed: { facilityId?: unknown; items?: unknown };
  try { parsed = JSON.parse(body) as typeof parsed; } catch { return fail('body is not JSON'); }
  if (JSON.stringify(parsed) !== body) fail('serialization is not stable');
  const facilityId = parsed.facilityId;
  if (typeof facilityId !== 'string' || !facilityId) fail('facility missing');
  const items = parsed.items as WireItem[] | undefined;
  if (!Array.isArray(items) || items.length < 1 || items.length > 6) fail('item count invalid');
  const courts = [...plan.courts].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.spaceId.localeCompare(b.spaceId));
  const slots = courts.flatMap((court, courtIndex) => court.slots.map(slot => ({ slot, ref: `session_${courtIndex + 1}` })));
  if (items!.length !== slots.length) fail('items do not match plan slots');
  let total = 0;
  for (const [index, item] of items!.entries()) {
    const expected = slots[index]!;
    const start = item.startTime, end = item.endTime;
    if (typeof start !== 'string' || typeof end !== 'string' || !WIRE_HOUR.test(start) || !WIRE_HOUR.test(end)) fail(`item ${index} time is not a wire hour`);
    if (end === '00:00' && start !== '23:00') fail(`item ${index} ends at 00:00 without starting at 23:00`);
    const startMinutes = internalHourMinutes(start as string), endMinutes = internalHourMinutes(internalWireEnd(end as string));
    if (item.duration !== 60 || endMinutes - startMinutes !== 60) fail(`item ${index} is not one hour`);
    if (item.sessionRef !== expected.ref || item.facilityId !== facilityId || item.spaceId !== expected.slot.spaceId || item.date !== expected.slot.date ||
      start !== expected.slot.startTime || end !== ondaWireBoundary(expected.slot.endTime)) fail(`item ${index} does not match its plan slot`);
    const previous = items![index - 1];
    if (previous && previous.sessionRef === item.sessionRef &&
      (previous.spaceId !== item.spaceId || previous.date !== item.date || internalWireEnd(String(previous.endTime)) !== start)) fail(`item ${index} is not contiguous`);
    if (typeof item.rate !== 'number' || !Number.isFinite(item.rate) || item.rate <= 0 || typeof item.chargedAmount !== 'number' ||
      cents(item.chargedAmount) !== cents(item.rate) || cents(item.rate) !== cents(expected.slot.price)) fail(`item ${index} price invalid`);
    total += item.chargedAmount as number;
  }
  if (cents(total) !== cents(plan.totalPrice)) fail('item prices do not sum to the plan total');
  const perSession = new Map<string, number>();
  for (const item of items!) perSession.set(String(item.sessionRef), (perSession.get(String(item.sessionRef)) ?? 0) + 1);
  if (perSession.size !== courts.length || [...perSession.values()].some(count => count !== plan.durationHours)) fail('session grouping invalid');
  if (wireRequestKey(facilityId as string, items as Array<{ spaceId: string; date: string; startTime: string; endTime: string }>) !== expectedKey)
    fail('wire range does not match the journal/permit key');
}
