import { describe, expect, it } from 'vitest';
import { availabilityFixture } from '../availability-fixture.js';
import { parseAvailability } from '../../src/api-booking/availability-parser.js';
import { planBooking } from '../../src/api-booking/booking-planner.js';
import { officialCheckoutUrl, validateOfficialCheckoutState } from '../../src/api-booking/checkout-restoration.js';

const date = '2026-09-18';
const now = new Date('2026-09-18T00:00:00.000Z');
const snapshot = parseAvailability(availabilityFixture(date), { startDate: date, endDate: date, capturedAt: now.toISOString(), fixtureKind: 'synthetic', label: 'offline', now, maximumAgeMs: 1000 });
const plan = planBooking(snapshot, { mode: 'standard', targetDate: date, durationHours: 2, preferredStartTimes: ['12:00'], fallbackStartTimes: [], courtPriority: [3], fallbackCourts: [], courtCount: 1, maximumTotalPrice: 1200, currency: 'PHP' });
const expected = { bookingIds: ['booking-0', 'booking-1'], plan, totalAmount: plan.totalPrice, holdExpiresAt: '2026-09-18T00:05:00.000Z' };
const state = { canResumeCheckout: true, bookingId: 'booking-0', bookingIds: expected.bookingIds, targetDate: date, courtIds: [plan.courts[0]!.court], startTime: plan.startTime, endTime: plan.endTime, totalAmount: plan.totalPrice, holdExpiresAt: expected.holdExpiresAt, paymentScreenAccessible: true };

describe('official checkout restoration boundary', () => {
  it('builds only the official booking URL and validates matching resumable state', () => {
    expect(officialCheckoutUrl('booking-0')).toBe('https://app.onda.fit/book/thirsty-pickle?bookingId=booking-0&bookingUi=court-v2');
    expect(validateOfficialCheckoutState(state, expected, now)).toMatchObject({ bookingId: 'booking-0', targetDate: date, totalAmount: 1200, paymentScreenAccessible: true });
  });

  it.each([
    ['cannot resume', { canResumeCheckout: false }, 'CHECKOUT_CANNOT_RESUME'],
    ['wrong booking', { bookingId: 'other' }, 'CHECKOUT_STATE_MISMATCH'],
    ['wrong amount', { totalAmount: 1 }, 'CHECKOUT_STATE_MISMATCH'],
    ['payment unavailable', { paymentScreenAccessible: false }, 'CHECKOUT_STATE_MISMATCH'],
    ['expired hold', { holdExpiresAt: '2026-09-17T00:05:00.000Z' }, 'CHECKOUT_STATE_MISMATCH'],
  ])('rejects %s', (_label, change, expectedCode) => {
    expect(() => validateOfficialCheckoutState({ ...state, ...change }, expected, now)).toThrowError(expectedCode);
  });
});
