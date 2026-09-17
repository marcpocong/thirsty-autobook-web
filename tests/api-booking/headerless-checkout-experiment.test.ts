import { describe, expect, it } from 'vitest';
import { availabilityFixture } from '../availability-fixture.js';
import { parseAvailability } from '../../src/api-booking/availability-parser.js';
import { planBooking } from '../../src/api-booking/booking-planner.js';
import { buildStandardPublicCheckoutRequest } from '../../src/api-booking/public-checkout.js';
import { buildHeaderlessCheckoutExperiment } from '../../src/api-booking/headerless-checkout-experiment.js';
import type { FreshSlotProof } from '../../src/api-booking/slot-proofs.js';

const date = '2026-09-18', now = new Date('2026-09-18T00:00:00.000Z');
const snapshot = parseAvailability(availabilityFixture(date), {
  startDate: date, endDate: date, capturedAt: now.toISOString(), fixtureKind: 'synthetic',
  label: 'offline', now, maximumAgeMs: 1_000,
});
const plan = planBooking(snapshot, { mode: 'standard', targetDate: date, durationHours: 2,
  preferredStartTimes: ['12:00'], fallbackStartTimes: [], courtPriority: [3], fallbackCourts: [],
  courtCount: 1, maximumTotalPrice: 1_200, currency: 'PHP' });
const customer = { clientId: 'synthetic-client', customerId: 'synthetic-customer',
  customerFirstName: 'Synthetic', customerLastName: 'Guest',
  customerEmail: 'example@test.invalid', customerPhone: '0000000000' };
const facilityId = 'synthetic-facility';
const proofs: FreshSlotProof[] = plan.courts[0]!.slots.map(slot => ({
  spaceId: slot.spaceId, date: slot.date, startTime: slot.startTime, endTime: slot.endTime,
  availabilityProof: `synthetic-proof-${slot.startTime}`, requestedAt: now.toISOString(), receivedAt: now.toISOString(),
}));

describe('headerless checkout experiment, offline only', () => {
  it('keeps the observed checkout body and base fetch settings; omits exactly two security headers', () => {
    const proposal = buildHeaderlessCheckoutExperiment(plan, customer, facilityId, proofs, 1_200);
    const observedHeaders = { ...proposal.headers,
      'X-Turnstile-Token': 'synthetic-current-token',
      'X-Onda-Public-Fingerprint': 'synthetic-current-fingerprint' };
    const { 'X-Turnstile-Token': _token, 'X-Onda-Public-Fingerprint': _fingerprint, ...withoutTwo } = observedHeaders;
    expect(proposal).toEqual({ mode: 'OFFLINE_HEADERLESS_CONSTRUCTION', dispatchAllowed: false,
      url: 'https://app.onda.fit/api/bookings/public-checkout', method: 'POST', credentials: 'same-origin',
      redirect: 'error', cache: 'no-store', headers: withoutTwo,
      body: buildStandardPublicCheckoutRequest(plan, customer, facilityId, proofs) });
    expect(proposal.body.items.map(item => [item.startTime, item.endTime, item.chargedAmount,
      item.sessionRef, item.availabilityProof])).toEqual([
      ['12:00', '13:00', 600, 'session_1', 'synthetic-proof-12:00'],
      ['13:00', '14:00', 600, 'session_1', 'synthetic-proof-13:00'],
    ]);
    expect('send' in proposal || 'fetch' in proposal || 'publicCheckout' in proposal).toBe(false);
  });

  it('retains plan, customer, proof, and maximum amount validation', () => {
    expect(() => buildHeaderlessCheckoutExperiment(plan, customer, facilityId, proofs, 1_199))
      .toThrow('CHECKOUT_MAXIMUM_PRICE_EXCEEDED');
    expect(() => buildHeaderlessCheckoutExperiment(plan, { ...customer, customerFirstName: '' }, facilityId, proofs, 1_200))
      .toThrow('CHECKOUT_CUSTOMER_INVALID');
    expect(() => buildHeaderlessCheckoutExperiment(plan, customer, facilityId,
      [{ ...proofs[0]!, startTime: '13:00' }, proofs[1]!], 1_200))
      .toThrow('AVAILABILITY_PROOF_SLOT_MISMATCH');
  });
});
