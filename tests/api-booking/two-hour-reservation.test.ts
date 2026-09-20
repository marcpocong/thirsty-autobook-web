import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { availabilityFixture } from '../availability-fixture.js';
import { parseAvailability } from '../../src/api-booking/availability-parser.js';
import { planBooking } from '../../src/api-booking/booking-planner.js';
import { DurableSubmissionJournal } from '../../src/api-booking/durable-submission-journal.js';
import { selectedStandardHours, selectedTwoHours, standardPlanJournalKeys, TwoHourReservationAdapter, type SlotCheckRequest } from '../../src/api-booking/two-hour-reservation.js';

const date = '2026-09-18';
const now = new Date('2026-09-18T00:00:00.000Z');
const snapshot = parseAvailability(availabilityFixture(date), { startDate: date, endDate: date,
  capturedAt: now.toISOString(), fixtureKind: 'synthetic', label: 'offline', now, maximumAgeMs: 1_000 });
const plan = planBooking(snapshot, { mode: 'standard', targetDate: date, durationHours: 2,
  preferredStartTimes: ['08:00'], fallbackStartTimes: [], courtPriority: [3], fallbackCourts: [], courtCount: 1,
  maximumTotalPrice: 1_200, currency: 'PHP' });
const hours = selectedTwoHours(plan);
const customer = { clientId: 'synthetic-client', customerId: 'synthetic-customer', customerFirstName: 'Synthetic', customerLastName: 'Guest',
  customerEmail: 'example@test.invalid', customerPhone: '0000000000' };
const proof = (index: number) => ({ success: true, availabilityProof: `synthetic-proof-${index}` });
const holdUntil = '2026-09-18T00:05:00.000Z';
const reply = () => ({ success: true, bookings: hours.map((hour, index) => ({
  id: `synthetic-booking-${index}`, booking_no: `synthetic-number-${index}`, customer_id: customer.customerId,
  space_id: hour.spaceId, date: hour.date, start_time: `${hour.startTime}:00`, end_time: `${hour.endTime}:00`,
  duration: 60, rate: 600, guest_count: 1, booking_status: 'pending', payment_status: 'pending',
  booking_session_id: 'synthetic-session', hold_expires_at: holdUntil })),
  bookingSessions: [{ date, startTime: '08:00:00', endTime: '10:00:00', spaceId: hours[0].spaceId,
    bookingIds: ['synthetic-booking-0', 'synthetic-booking-1'], facilityId: '5f8786bd-dc61-4509-b893-74cda8f783f7',
    durationHours: 2, bookingSessionId: 'synthetic-session', requestSessionRef: 'session_1' }],
  transaction: { id: 'synthetic-transaction', reference: 'synthetic-number-0', amount: 1200, status: 'pending' },
  trustedTotalAmount: 1200 });
const directories: string[] = [];
afterEach(async () => { delete process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT;
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function setup(response: unknown = reply()) {
  const path = await mkdtemp(join(tmpdir(), 'onda-two-hour-'));
  directories.push(path);
  const checkSlot = vi.fn(async (request: SlotCheckRequest) => proof(request.startTime === '08:00' ? 0 : 1));
  const publicCheckout = vi.fn(async (_items: unknown) => response);
  const adapter = new TwoHourReservationAdapter({ checkSlot, publicCheckout }, new DurableSubmissionJournal(path), () => now);
  return { adapter, checkSlot, publicCheckout, path };
}

describe('offline two-hour adapter', () => {
  it('captures a one-hour booking through the same one-shot journal', async () => {
    const onePlan = planBooking(snapshot, { mode: 'standard', targetDate: date, durationHours: 1,
      preferredStartTimes: ['08:00'], fallbackStartTimes: [], courtPriority: [3], fallbackCourts: [], courtCount: 1,
      maximumTotalPrice: 600, currency: 'PHP' });
    const oneReply = reply();
    oneReply.bookings = oneReply.bookings.slice(0, 1);
    oneReply.bookingSessions[0]!.endTime = '09:00:00';
    oneReply.bookingSessions[0]!.durationHours = 1;
    oneReply.bookingSessions[0]!.bookingIds = ['synthetic-booking-0'];
    oneReply.transaction.amount = 600;
    oneReply.trustedTotalAmount = 600;
    const { adapter, checkSlot, publicCheckout, path } = await setup(oneReply);
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    await expect(adapter.submit(onePlan, customer, { supervisedOneShot: true })).resolves.toMatchObject({
      bookingIds: ['synthetic-booking-0'], transactionId: 'synthetic-transaction' });
    expect(checkSlot).toHaveBeenCalledOnce();
    expect(publicCheckout).toHaveBeenCalledOnce();
    const key = DurableSubmissionJournal.key('5f8786bd-dc61-4509-b893-74cda8f783f7',
      hours[0].spaceId, date, '08:00', '09:00');
    expect((await new DurableSubmissionJournal(path).read(key)).observedResponse).toMatchObject({
      bookingIds: ['synthetic-booking-0'], validationCode: 'CHECKOUT_RESPONSE_VERIFIED' });
  });

  it('implements a three-hour standard checkout with three distinct proofs', async () => {
    const threePlan = planBooking(snapshot, { mode: 'standard', targetDate: date, durationHours: 3,
      preferredStartTimes: ['08:00'], fallbackStartTimes: [], courtPriority: [3], fallbackCourts: [], courtCount: 1,
      maximumTotalPrice: 1_800, currency: 'PHP' });
    const threeHours = selectedStandardHours(threePlan);
    const response = { success: true, bookings: threeHours.map((hour, index) => ({
      id: `three-booking-${index}`, booking_no: `three-number-${index}`, customer_id: customer.customerId,
      space_id: hour.spaceId, date: hour.date, start_time: `${hour.startTime}:00`, end_time: `${hour.endTime}:00`,
      duration: 60, rate: 600, guest_count: 1, booking_status: 'pending', payment_status: 'pending',
      booking_session_id: 'three-session', hold_expires_at: holdUntil })),
      bookingSessions: [{ date, startTime: '08:00:00', endTime: '11:00:00', spaceId: threeHours[0]!.spaceId,
        bookingIds: threeHours.map((_, index) => `three-booking-${index}`), facilityId: '5f8786bd-dc61-4509-b893-74cda8f783f7',
        durationHours: 3, bookingSessionId: 'three-session', requestSessionRef: 'session_1' }],
      transaction: { id: 'three-transaction', reference: 'three-number-0', amount: 1800, status: 'pending' },
      trustedTotalAmount: 1800 };
    const { adapter, checkSlot, publicCheckout } = await setup(response);
    checkSlot.mockImplementation(async request => proof(Number(request.startTime.slice(0, 2)) - 8));
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    await expect(adapter.submit(threePlan, customer, { supervisedOneShot: true })).resolves.toMatchObject({
      bookingIds: ['three-booking-0', 'three-booking-1', 'three-booking-2'], transactionId: 'three-transaction' });
    expect(checkSlot).toHaveBeenCalledTimes(3);
    expect((publicCheckout.mock.calls[0]![0] as { items: unknown[] }).items).toHaveLength(3);
  });

  it('submits two courts as two sessions and writes a durable journal for each court', async () => {
    const twoCourtPlan = planBooking(snapshot, { mode: 'standard', targetDate: date, durationHours: 2,
      preferredStartTimes: ['08:00'], fallbackStartTimes: [], courtPriority: [3, 2], fallbackCourts: [], courtCount: 2,
      maximumTotalPrice: 1_200, currency: 'PHP' });
    const twoHours = selectedStandardHours(twoCourtPlan);
    const refs = twoHours.map((_hour, index) => index < 2 ? 'session_1' : 'session_2');
    const ids = twoHours.map((_hour, index) => `dual-booking-${index}`);
    const response = { success: true, bookings: twoHours.map((hour, index) => ({ id: ids[index],
      booking_no: `dual-number-${index}`, customer_id: customer.customerId, space_id: hour.spaceId, date: hour.date,
      start_time: `${hour.startTime}:00`, end_time: `${hour.endTime}:00`, duration: 60, rate: 600, guest_count: 1,
      booking_status: 'pending', payment_status: 'pending', booking_session_id: `dual-${refs[index]}`,
      hold_expires_at: holdUntil })), bookingSessions: ['session_1', 'session_2'].map(ref => {
        const indexes = refs.map((value, index) => value === ref ? index : -1).filter(index => index >= 0);
        return { date, startTime: '08:00:00', endTime: '10:00:00', spaceId: twoHours[indexes[0]!]!.spaceId,
          bookingIds: indexes.map(index => ids[index]!), facilityId: '5f8786bd-dc61-4509-b893-74cda8f783f7',
          durationHours: 2, bookingSessionId: `dual-${ref}`, requestSessionRef: ref };
      }), transaction: { id: 'dual-transaction', reference: 'dual-number-0', amount: 2400, status: 'pending' },
      trustedTotalAmount: 2400 };
    const paths = [await mkdtemp(join(tmpdir(), 'onda-dual-court-a-')), await mkdtemp(join(tmpdir(), 'onda-dual-court-b-'))];
    directories.push(...paths);
    const journals = paths.map(path => new DurableSubmissionJournal(path));
    const checkSlot = vi.fn(async (request: SlotCheckRequest) => ({ success: true,
      availabilityProof: `proof-${request.spaceId}-${request.startTime}` }));
    const publicCheckout = vi.fn(async (_request: unknown) => response);
    const adapter = new TwoHourReservationAdapter({ checkSlot, publicCheckout }, journals[0]!, () => now, 15_000, [journals[1]!]);
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    await expect(adapter.submit(twoCourtPlan, customer, { supervisedOneShot: true })).resolves.toMatchObject({
      bookingIds: ids, transactionId: 'dual-transaction' });
    expect(checkSlot).toHaveBeenCalledTimes(4);
    expect((publicCheckout.mock.calls[0]![0] as { items: Array<{ sessionRef: string }> }).items.map(item => item.sessionRef))
      .toEqual(refs);
    const keys = standardPlanJournalKeys(twoCourtPlan, '5f8786bd-dc61-4509-b893-74cda8f783f7');
    expect((await journals[0]!.read(keys[0]!)).state).toBe('verified');
    expect((await journals[1]!.read(keys[1]!)).state).toBe('verified');
  });
  it('requires an explicit supervised gate and obtains distinct exact-hour proofs before one submission', async () => {
    const { adapter, checkSlot, publicCheckout, path } = await setup();
    await expect(adapter.submit(plan, customer, { supervisedOneShot: true })).rejects.toThrow('LIVE_SUBMISSION_DISABLED');
    expect(checkSlot).not.toHaveBeenCalled();
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    await expect(adapter.submit(plan, customer, { supervisedOneShot: true })).resolves.toMatchObject({ bookingIds: ['synthetic-booking-0', 'synthetic-booking-1'] });
    expect(checkSlot.mock.calls.map(([request]) => request)).toEqual(hours.map(hour => ({ ...hour,
      clientId: customer.clientId, facilityId: '5f8786bd-dc61-4509-b893-74cda8f783f7' })));
    expect(publicCheckout).toHaveBeenCalledOnce();
    const key = DurableSubmissionJournal.key('5f8786bd-dc61-4509-b893-74cda8f783f7',
      hours[0].spaceId, date, hours[0].startTime, hours[1].endTime);
    expect((await new DurableSubmissionJournal(path).read(key)).observedResponse).toMatchObject({
      bookingIds: ['synthetic-booking-0', 'synthetic-booking-1'], validationCode: 'CHECKOUT_RESPONSE_VERIFIED' });
    expect(publicCheckout.mock.calls[0]![0]).toMatchObject({ bookingType: 'online', customerId: customer.customerId,
      items: hours.map((hour, index) => ({ ...hour, availabilityProof: `synthetic-proof-${index}`,
        sessionRef: 'session_1', duration: 60, rate: 600, chargedAmount: 600 })) });
    await expect(adapter.submit(plan, customer, { supervisedOneShot: true })).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
    expect(publicCheckout).toHaveBeenCalledOnce();
  });

  it('rejects a mismatched proof without dispatch', async () => {
    const { adapter, checkSlot, publicCheckout } = await setup();
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    checkSlot.mockImplementationOnce(async () => ({ success: false, availabilityProof: 'synthetic-proof-0' }));
    await expect(adapter.submit(plan, customer, { supervisedOneShot: true })).rejects.toThrow('AVAILABILITY_PROOF_INVALID');
    expect(publicCheckout).not.toHaveBeenCalled();
  });

  it('blocks replay after an uncertain response and rejects three-hour plans', async () => {
    const malformed = reply();
    malformed.transaction.status = 'paid';
    const { adapter, publicCheckout, path } = await setup(malformed);
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    await expect(adapter.submit(plan, customer, { supervisedOneShot: true })).rejects.toThrow('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
    const key = DurableSubmissionJournal.key('5f8786bd-dc61-4509-b893-74cda8f783f7',
      hours[0].spaceId, date, hours[0].startTime, hours[1].endTime);
    expect((await new DurableSubmissionJournal(path).read(key)).observedResponse).toMatchObject({
      success: true, bookingIds: ['synthetic-booking-0', 'synthetic-booking-1'],
      bookingNumbers: ['synthetic-number-0', 'synthetic-number-1'],
      validationCode: 'CHECKOUT_RESPONSE_INVALID' });
    await expect(adapter.submit(plan, customer, { supervisedOneShot: true })).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
    expect(publicCheckout).toHaveBeenCalledOnce();
    const three = planBooking(snapshot, { mode: 'standard', targetDate: date, durationHours: 3,
      preferredStartTimes: ['08:00'], fallbackStartTimes: [], courtPriority: [3], fallbackCourts: [], courtCount: 1,
      maximumTotalPrice: 1_800, currency: 'PHP' });
    expect(() => selectedTwoHours(three)).toThrow('TWO_HOUR_PLAN_REQUIRED');
  });

  it('rejects reused proofs and never sends checkout', async () => {
    const { adapter, checkSlot, publicCheckout } = await setup();
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    checkSlot.mockImplementation(async () => proof(0));
    await expect(adapter.submit(plan, customer, { supervisedOneShot: true })).rejects.toThrow('AVAILABILITY_PROOF_DUPLICATE');
    expect(publicCheckout).not.toHaveBeenCalled();
  });

  it('requires a shared pending session with a future common expiry', async () => {
    const mismatched = reply();
    mismatched.bookings[1]!.hold_expires_at = '2026-09-18T00:06:00.000Z';
    const { adapter } = await setup(mismatched);
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    await expect(adapter.submit(plan, customer, { supervisedOneShot: true })).rejects.toThrow('SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
  });
});
