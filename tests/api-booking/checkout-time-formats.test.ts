import { describe, expect, it } from 'vitest';
import { canonicalCheckoutTime, validatePublicCheckoutResponse } from '../../src/api-booking/public-checkout.js';
import { prooflessReleasePlan, prooflessRequest } from '../../src/api-booking/proofless-checkout.js';

// Synthetic identities only; mirrors the hourly/continuous response structures, not private captures.
function fixture(hours = 3, courts = 1, hourly = true, start = '19:00', format = 'minutes') {
  const date = '2026-10-31', now = new Date('2026-10-29T00:00:02Z');
  const plan = prooflessReleasePlan({ mode: 'standard', targetDate: date, durationHours: hours,
    preferredStartTimes: [start], fallbackStartTimes: [], courtPriority: [7, 6], fallbackCourts: [],
    courtCount: courts as 1 | 2, maximumTotalPrice: Infinity, currency: 'PHP' });
  const request = prooflessRequest(plan, { clientId: 'offline-client', customerId: 'offline-customer',
    customerFirstName: 'Offline', customerLastName: 'Synthetic', customerEmail: 'offline@example.invalid', customerPhone: '0000000000' });
  const time = (value: string, index: number) => format === 'seconds' || format === 'mixed' && index % 2 ? `${value}:00` : value;
  const bookings = request.items.map((item, i) => ({ id: `synthetic-booking-${i}`, booking_no: `synthetic-number-${i}`,
    customer_id: 'synthetic-customer', space_id: item.spaceId, facility_id: item.facilityId, date,
    start_time: time(item.startTime, i), end_time: time(item.endTime, i + 1), duration: 60, rate: item.rate,
    guest_count: 1, booking_status: 'pending', payment_status: 'pending',
    booking_session_id: hourly ? `synthetic-session-${i}` : item.sessionRef, hold_expires_at: '2026-10-29T00:10:00Z' }));
  const bookingSessions = [...new Set(bookings.map(b => b.booking_session_id))].map((id, i) => {
    const indices = bookings.flatMap((b, index) => b.booking_session_id === id ? [index] : []);
    const first = request.items[indices[0]!]!, last = request.items[indices.at(-1)!]!;
    return { bookingSessionId: id, requestSessionRef: first.sessionRef, facilityId: first.facilityId, spaceId: first.spaceId,
      date, startTime: time(first.startTime, i + 1), endTime: time(last.endTime, i), durationHours: indices.length,
      bookingIds: indices.map(index => bookings[index]!.id) };
  });
  const raw = { success: true, bookings, bookingSessions, trustedTotalAmount: plan.totalPrice,
    transaction: { id: 'synthetic-transaction', status: 'pending', reference: bookings[0]!.booking_no, amount: plan.totalPrice } };
  return { raw, validate: () => validatePublicCheckoutResponse(raw, request as any, plan, now, plan.totalPrice) };
}

describe('strict checkout response time compatibility', () => {
  for (const hours of [1, 2, 3]) for (const courts of [1, 2]) for (const hourly of [true, false])
    it.each(['minutes', 'seconds', 'mixed'])(`accepts %s: ${hours}h / ${courts} courts / hourly=${hourly}`, format => {
      const f = fixture(hours, courts, hourly, '19:00', format), original = structuredClone(f.raw);
      expect(f.validate().bookingIds).toHaveLength(hours * courts);
      expect(f.raw).toEqual(original);
    });
  it.each(['minutes', 'seconds', 'mixed'])('retains midnight wire 00:00 for %s', format => {
    for (const hourly of [true, false]) {
      const f = fixture(3, 1, hourly, '21:00', format);
      expect(f.validate().bookingIds).toHaveLength(3);
      f.raw.bookings[2]!.end_time = '24:00';
      expect(f.validate).toThrow('CHECKOUT_BOOKING_INVALID');
    }
  });
  it.each(['24:00', '24:00:00', '25:00', '19:60', '19:00:60', '19', '19:0', '9:00', '19-00',
    ' 19:00', '19:00 ', '19:00:00Z', '19:00:00.0', '19:00\n', '', null, 1900])('rejects malformed %j at both layers', value => {
    expect(canonicalCheckoutTime(value)).toBeNull();
    const a = fixture(); (a.raw.bookingSessions[0] as any).startTime = value;
    expect(a.validate).toThrow('CHECKOUT_SESSION_INVALID');
    const b = fixture(); (b.raw.bookings[0] as any).start_time = value;
    expect(b.validate).toThrow('CHECKOUT_BOOKING_INVALID');
  });
  it.each(['18:00', '19:01', '19:00:01', '00:00'])('rejects non-equivalent supported time %s', time => {
    const f = fixture(); f.raw.bookingSessions[0]!.startTime = time;
    expect(f.validate).toThrow('CHECKOUT_SESSION_INVALID');
    const b = fixture(); b.raw.bookings[0]!.start_time = time;
    expect(b.validate).toThrow('CHECKOUT_BOOKING_INVALID');
  });
  it.each([
    ['court', (r: any): unknown => r.bookings[0].space_id = 'wrong'],
    ['facility', (r: any): unknown => r.bookings[0].facility_id = 'wrong'],
    ['date', (r: any): unknown => r.bookings[0].date = '2026-11-01'],
    ['session facility', (r: any): unknown => r.bookingSessions[0].facilityId = 'wrong'],
    ['session court/wing', (r: any): unknown => r.bookingSessions[0].spaceId = 'wrong-wing-space'],
    ['session membership', (r: any): unknown => r.bookingSessions[0].bookingIds = ['wrong']],
    ['session identity', (r: any): unknown => r.bookings[0].booking_session_id = 'wrong'],
    ['duplicate sessions', (r: any): unknown => r.bookingSessions[1].bookingSessionId = r.bookingSessions[0].bookingSessionId],
    ['duplicate bookings', (r: any): unknown => r.bookings[1].id = r.bookings[0].id],
    ['rate', (r: any): unknown => r.bookings[0].rate = 1],
    ['amount', (r: any): unknown => r.transaction.amount = 1],
    ['trusted total', (r: any): unknown => r.trustedTotalAmount = 1],
    ['reference', (r: any): unknown => r.transaction.reference = 'wrong'],
    ['expiry', (r: any): unknown => r.bookings[0].hold_expires_at = '2026-10-29T00:00:01Z'],
    ['invalid expiry', (r: any): unknown => r.bookings[0].hold_expires_at = 'unknown'],
    ['inconsistent expiry', (r: any): unknown => r.bookings[0].hold_expires_at = '2026-10-29T00:11:00Z'],
    ['booking status', (r: any): unknown => r.bookings[0].booking_status = 'confirmed'],
    ['payment status', (r: any): unknown => r.bookings[0].payment_status = 'paid'],
    ['transaction status', (r: any): unknown => r.transaction.status = 'paid'],
    ['customer', (r: any): unknown => r.bookings[1].customer_id = 'another-customer'],
    ['count', (r: any): unknown => r.bookings.pop()],
  ] as const)('HTTP success still rejects incorrect %s', (_name, mutate) => {
    const f = fixture(); mutate(f.raw); expect(f.validate).toThrow();
  });
});
