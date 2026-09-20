import { describe, expect, it } from 'vitest';
import { availabilityFixture } from '../availability-fixture.js';
import { parseAvailability } from '../../src/api-booking/availability-parser.js';
import { planBooking } from '../../src/api-booking/booking-planner.js';
import { buildStandardPublicCheckoutRequest, PublicCheckoutValidationError, validatePublicCheckoutResponse } from '../../src/api-booking/public-checkout.js';
import type { FreshSlotProof } from '../../src/api-booking/slot-proofs.js';

const date = '2026-09-18';
const now = new Date('2026-09-18T00:00:00.000Z');
const snapshot = parseAvailability(availabilityFixture(date), { startDate: date, endDate: date, capturedAt: now.toISOString(), fixtureKind: 'synthetic', label: 'offline', now, maximumAgeMs: 1_000 });
const plan = planBooking(snapshot, { mode: 'standard', targetDate: date, durationHours: 2, preferredStartTimes: ['12:00'], fallbackStartTimes: [], courtPriority: [3], fallbackCourts: [], courtCount: 1, maximumTotalPrice: 1_200, currency: 'PHP' });
const customer = { clientId: 'client', customerId: 'customer', customerFirstName: 'Synthetic', customerLastName: 'Guest', customerEmail: 'example@test.invalid', customerPhone: '0000000000' };
const court = plan.courts[0]!;
const proofs: FreshSlotProof[] = court.slots.map(slot => ({ spaceId: slot.spaceId, date: slot.date, startTime: slot.startTime, endTime: slot.endTime, availabilityProof: `proof-${slot.startTime}`, requestedAt: now.toISOString(), receivedAt: now.toISOString() }));
const request = buildStandardPublicCheckoutRequest(plan, customer, 'facility', proofs);

function reply() {
  const ids = request.items.map((_item, index) => `booking-${index}`);
  return { success: true, bookings: request.items.map((item, index) => ({ id: ids[index], booking_no: `number-${index}`, customer_id: customer.customerId, space_id: item.spaceId, facility_id: item.facilityId, date: item.date, start_time: `${item.startTime}:00`, end_time: `${item.endTime}:00`, duration: 60, rate: item.rate, guest_count: 1, booking_status: 'pending', payment_status: 'pending', booking_session_id: 'session', hold_expires_at: '2026-09-18T00:05:00.000Z' })), bookingSessions: [{ requestSessionRef: 'session_1', bookingSessionId: 'session', facilityId: 'facility', spaceId: request.items[0]!.spaceId, date, startTime: '12:00:00', endTime: '14:00:00', durationHours: 2, bookingIds: ids }], transaction: { id: 'transaction', reference: 'number-0', amount: 1200, status: 'pending' }, trustedTotalAmount: 1200 };
}

describe('standard public-checkout builder and validator', () => {
  it('builds the observed null-name shape, customer identity, ordered hourly items, and current proofs', () => {
    expect(request).toMatchObject({ bookingType: 'online', customerFirstName: null, customerLastName: null, facilityId: 'facility', usedCustomerMembershipId: null, userId: null });
    expect(request.items.map(item => [item.spaceId, item.startTime, item.endTime, item.duration, item.sessionRef, item.availabilityProof])).toEqual(court.slots.map((slot, index) => [slot.spaceId, slot.startTime, slot.endTime, 60, 'session_1', `proof-${slot.startTime}`]));
  });

  it('validates a pending response against the exact plan, grouping, amount, and hold', () => {
    expect(validatePublicCheckoutResponse(reply(), request, plan, now, 1_200)).toMatchObject({ bookingIds: ['booking-0', 'booking-1'], sessionId: 'session', trustedTotalAmount: 1_200 });
  });

  it('builds and validates two continuous court sessions in one checkout transaction', () => {
    const twoCourtPlan = planBooking(snapshot, { mode: 'standard', targetDate: date, durationHours: 2,
      preferredStartTimes: ['12:00'], fallbackStartTimes: [], courtPriority: [3, 2], fallbackCourts: [],
      courtCount: 2, maximumTotalPrice: 1_200, currency: 'PHP' });
    const orderedCourts = [...twoCourtPlan.courts].sort((a, b) => a.spaceId.localeCompare(b.spaceId));
    const twoProofs: FreshSlotProof[] = orderedCourts.flatMap(planned => planned.slots.map(slot => ({
      spaceId: slot.spaceId, date: slot.date, startTime: slot.startTime, endTime: slot.endTime,
      availabilityProof: `proof-${slot.spaceId}-${slot.startTime}`, requestedAt: now.toISOString(), receivedAt: now.toISOString() })));
    const twoRequest = buildStandardPublicCheckoutRequest(twoCourtPlan, customer, 'facility', twoProofs);
    const ids = twoRequest.items.map((_item, index) => `two-booking-${index}`);
    const sessions = ['session_1', 'session_2'].map((ref, index) => {
      const sessionItems = twoRequest.items.map((item, itemIndex) => ({ item, itemIndex })).filter(entry => entry.item.sessionRef === ref);
      return { requestSessionRef: ref, bookingSessionId: `two-session-${index + 1}`, facilityId: 'facility',
        spaceId: sessionItems[0]!.item.spaceId, date, startTime: '12:00:00', endTime: '14:00:00', durationHours: 2,
        bookingIds: sessionItems.map(entry => ids[entry.itemIndex]!) };
    });
    const response = { success: true, bookings: twoRequest.items.map((item, index) => ({ id: ids[index],
      booking_no: `two-number-${index}`, customer_id: customer.customerId, space_id: item.spaceId,
      facility_id: item.facilityId, date: item.date, start_time: `${item.startTime}:00`, end_time: `${item.endTime}:00`,
      duration: 60, rate: item.rate, guest_count: 1, booking_status: 'pending', payment_status: 'pending',
      booking_session_id: `two-session-${Number(item.sessionRef.slice(8))}`,
      hold_expires_at: '2026-09-18T00:05:00.000Z' })), bookingSessions: sessions,
      transaction: { id: 'two-transaction', reference: 'two-number-0', amount: 2_400, status: 'pending' },
      trustedTotalAmount: 2_400 };
    expect(twoRequest.items.map(item => item.sessionRef)).toEqual(['session_1', 'session_1', 'session_2', 'session_2']);
    expect(validatePublicCheckoutResponse(response, twoRequest, twoCourtPlan, now, 2_400)).toMatchObject({
      bookingIds: ids, sessionIds: ['two-session-1', 'two-session-2'], trustedTotalAmount: 2_400 });
    response.bookingSessions[1]!.bookingIds = [ids[0]!, ids[3]!];
    expect(() => validatePublicCheckoutResponse(response, twoRequest, twoCourtPlan, now, 2_400)).toThrowError('CHECKOUT_GROUPING_INVALID');
  });

  it('accepts one consistent server-resolved guest id and rejects mixed response customers', () => {
    const resolved = reply();
    for (const booking of resolved.bookings) booking.customer_id = 'server-resolved-customer';
    expect(validatePublicCheckoutResponse(resolved, request, plan, now, 1_200).bookingIds).toEqual(['booking-0', 'booking-1']);
    resolved.bookings[1]!.customer_id = 'different-server-customer';
    expect(() => validatePublicCheckoutResponse(resolved, request, plan, now, 1_200)).toThrowError('CHECKOUT_BOOKING_INVALID');
  });

  it.each([
    ['wrong court', (raw: any) => { raw.bookings[0].space_id = 'other'; }, 'CHECKOUT_BOOKING_INVALID'],
    ['wrong date', (raw: any) => { raw.bookings[0].date = '2026-09-19'; }, 'CHECKOUT_BOOKING_INVALID'],
    ['wrong duration', (raw: any) => { raw.bookings[0].duration = 30; }, 'CHECKOUT_BOOKING_INVALID'],
    ['wrong total', (raw: any) => { raw.trustedTotalAmount = 1; }, 'CHECKOUT_RESPONSE_INVALID'],
    ['expired hold', (raw: any) => { raw.bookings[0].hold_expires_at = '2026-09-17T23:59:00.000Z'; }, 'CHECKOUT_BOOKING_INVALID'],
    ['transaction mismatch', (raw: any) => { raw.transaction.reference = 'other'; }, 'CHECKOUT_GROUPING_INVALID'],
    ['duplicate booking', (raw: any) => { raw.bookings[1].id = raw.bookings[0].id; }, 'CHECKOUT_BOOKING_DUPLICATE'],
    ['malformed response customer', (raw: any) => { raw.bookings[0].customer_id = 'not safe!'; }, 'CHECKOUT_BOOKING_INVALID'],
  ])('rejects %s', (_label, mutate, expected) => {
    const raw = reply(); mutate(raw);
    expect(() => validatePublicCheckoutResponse(raw, request, plan, now, 1_200)).toThrowError(expected);
  });

  it('rejects proof identity, missing customer names, and a price limit violation before dispatch', () => {
    expect(() => buildStandardPublicCheckoutRequest(plan, customer, 'facility', [{ ...proofs[0]!, startTime: '13:00' }, proofs[1]!])).toThrowError('AVAILABILITY_PROOF_SLOT_MISMATCH');
    expect(() => buildStandardPublicCheckoutRequest(plan, { ...customer, customerFirstName: '' }, 'facility', proofs)).toThrowError('CHECKOUT_CUSTOMER_INVALID');
    expect(() => validatePublicCheckoutResponse(reply(), request, plan, now, 1_199)).toThrowError('CHECKOUT_MAXIMUM_PRICE_EXCEEDED');
  });
});
