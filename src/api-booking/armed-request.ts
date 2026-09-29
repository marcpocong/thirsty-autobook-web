import { DurableSubmissionJournal } from './durable-submission-journal.js';
import { SubmissionDispatchError } from './submission-errors.js';
import type { ProoflessCheckoutRequest } from './proofless-checkout.js';
import type { TwoHourCheckoutRequest } from './two-hour-reservation.js';
import type { BookingPlan } from './types.js';
import { assertWireCheckoutBody } from './wire-payload-check.js';
import { internalWireEnd } from '../time-range.js';

/**
 * Armed checkout requests: the journal key and the exact JSON body are computed once, before release,
 * for a deeply frozen request object. Because the object can never change afterwards, the cached values
 * stay exact and the release instant needs no hashing or serialization. Unarmed requests are unaffected.
 *
 * Kept dependency-light (no config, no Playwright) so checkout builders can arm requests without an
 * import cycle through the browser transport.
 */
export class ArmedRequestError extends SubmissionDispatchError {
  constructor(code: string) { super(code, false); this.name = 'ArmedRequestError'; }
}

const armedRequests = new WeakMap<object, { key: string; body: string }>();
function deeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
}

/** The permit/journal key of a request: first item's start, last item's end in internal form ("00:00" end → "24:00"). */
export function checkoutRequestKey(request: TwoHourCheckoutRequest | ProoflessCheckoutRequest): string {
  const [first] = request.items;
  const last = request.items.at(-1);
  if (!first || !last || request.items.length > 6) throw new ArmedRequestError('CHECKOUT_ITEMS_INVALID');
  // The wire format ends the 23:00 hour at "00:00"; plan and journal keys keep "24:00", so the permit still matches.
  return DurableSubmissionJournal.key(request.facilityId, first.spaceId, first.date, first.startTime, internalWireEnd(last.endTime));
}

/**
 * Freezes the exact wire body of a deep-frozen request. With `check`, the serialized body is validated
 * (wire-payload-check.ts) against its plan and journal key BEFORE it is registered, so the body the hot
 * path sends is the very string that passed the self-check; an invalid body is never registered.
 */
export function armCheckoutRequest(request: ProoflessCheckoutRequest, check?: { plan: BookingPlan; key: string }): { key: string; body: string } {
  if (!deeplyFrozen(request)) throw new ArmedRequestError('ARMED_REQUEST_NOT_FROZEN');
  if (request.items.some(item => item.availabilityProof !== null)) throw new ArmedRequestError('DIRECT_PROOFLESS_SHAPE_INVALID');
  const armed = { key: checkoutRequestKey(request), body: JSON.stringify(request) };
  if (check) {
    assertWireCheckoutBody(armed.body, check.plan, check.key);
    if (armed.key !== check.key) throw new ArmedRequestError('ARMED_REQUEST_KEY_MISMATCH');
  }
  armedRequests.set(request, armed);
  return armed;
}

/** The armed key and body registered for this exact request object, if any. */
export const armedRequestFor = (request: object) => armedRequests.get(request);
