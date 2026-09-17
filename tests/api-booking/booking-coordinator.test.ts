import { describe, expect, it } from 'vitest';
import { availabilityFixture } from '../availability-fixture.js';
import { ApiBookingCoordinator } from '../../src/api-booking/booking-coordinator.js';
import { MockAvailabilityProvider } from '../../src/api-booking/mock/mock-availability-provider.js';
import { MockCheckoutHandoff } from '../../src/api-booking/mock/mock-checkout-handoff.js';
import { MockReservationProvider, type MockReservationScenario } from '../../src/api-booking/mock/mock-reservation-provider.js';
import type { BookingPreferences } from '../../src/api-booking/types.js';
import type { ReservationProvider } from '../../src/api-booking/reservation-provider.js';
import { MemoryIntentStore, logicalBookingId } from '../../src/api-booking/intent-store.js';

const now = new Date('2026-09-18T00:00:01Z');
const preferences: BookingPreferences = {
  mode: 'standard', targetDate: '2026-09-18', durationHours: 2,
  preferredStartTimes: ['08:00'], fallbackStartTimes: ['10:00'],
  courtPriority: [7, 6, 5], fallbackCourts: [4, 3, 2, 1], courtCount: 1,
  maximumTotalPrice: 1_200, currency: 'PHP',
};

function setup(scenario: MockReservationScenario, overrides: Partial<BookingPreferences> = {}, holdDurationMs = 600_000) {
  const reservation = new MockReservationProvider(scenario, now, holdDurationMs);
  const coordinator = new ApiBookingCoordinator(
    new MockAvailabilityProvider({
      raw: availabilityFixture('2026-09-18'), capturedAt: '2026-09-18T00:00:00Z',
      fixtureKind: 'synthetic', label: 'SYNTHETIC ALL-OPEN FIXTURE',
    }),
    reservation,
    new MockCheckoutHandoff(),
  );
  const run = (runId = 'run-1') => coordinator.coordinate({
    runId, preferences: { ...preferences, ...overrides }, now, maximumSnapshotAgeMs: 5_000,
  });
  return { reservation, coordinator, run };
}

describe('offline API booking coordinator', () => {
  it('blocks the same logical booking under another run ID and retains the hold', async () => {
    const { run, coordinator, reservation } = setup('verified');
    await run('first');
    await expect(run('second')).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
    expect(reservation.submissions).toHaveLength(1);
    expect(coordinator.intents.get(logicalBookingId(preferences))?.state).toBe('handoff-ready');
  });

  it('can share an offline intent store across coordinator instances', async () => {
    const intents = new MemoryIntentStore();
    const availability = new MockAvailabilityProvider({ raw: availabilityFixture('2026-09-18'),
      capturedAt: '2026-09-18T00:00:00Z', fixtureKind: 'synthetic', label: 'shared store' });
    const reservation = new MockReservationProvider('verified', now);
    const first = new ApiBookingCoordinator(availability, reservation, new MockCheckoutHandoff(), intents);
    const second = new ApiBookingCoordinator(availability, reservation, new MockCheckoutHandoff(), intents);
    const options = { runId: 'one', preferences, now, maximumSnapshotAgeMs: 5_000 };
    await first.coordinate(options);
    await expect(second.coordinate({ ...options, runId: 'two' })).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
    expect(reservation.submissions).toHaveLength(1);
  });

  it('retains confirmed holds when checkout preparation throws', async () => {
    const availability = new MockAvailabilityProvider({ raw: availabilityFixture('2026-09-18'),
      capturedAt: '2026-09-18T00:00:00Z', fixtureKind: 'synthetic', label: 'checkout failure' });
    const reservation = new MockReservationProvider('verified', now);
    const coordinator = new ApiBookingCoordinator(availability, reservation,
      { kind: 'mock-checkout-handoff', async prepare() { throw Error('checkout unavailable'); } });
    const options = { runId: 'one', preferences, now, maximumSnapshotAgeMs: 5_000 };
    const result = await coordinator.coordinate(options);
    expect(result).toMatchObject({ kind: 'stopped', reason: 'checkout-preparation-failed', reconciliationRequired: true });
    if (result.kind !== 'stopped') throw Error('EXPECTED_STOP');
    expect(result.holds).toHaveLength(1);
    expect(coordinator.intents.get(logicalBookingId(preferences))?.state).toBe('checkout-failed');
    await expect(coordinator.coordinate({ ...options, runId: 'two' })).rejects.toThrow('AUTHORITATIVE_RECONCILIATION_REQUIRED');
  });

  it('rechecks snapshot age before submission with an advancing clock', async () => {
    const availability = new MockAvailabilityProvider({ raw: availabilityFixture('2026-09-18'),
      capturedAt: '2026-09-18T00:00:00Z', fixtureKind: 'synthetic', label: 'time changes' });
    const reservation = new MockReservationProvider('verified', now);
    const coordinator = new ApiBookingCoordinator(availability, reservation, new MockCheckoutHandoff());
    let reads = 0;
    await expect(coordinator.coordinate({ runId: 'time', preferences, maximumSnapshotAgeMs: 5_000,
      clock: () => new Date(Date.parse('2026-09-18T00:00:00Z') + (++reads === 1 ? 1_000 : 6_000)) }))
      .rejects.toThrow('AVAILABILITY_SNAPSHOT_STALE');
    expect(reservation.submissions).toHaveLength(0);
  });

  it('rejects a hold with the right court but wrong date', async () => {
    const availability = new MockAvailabilityProvider({ raw: availabilityFixture('2026-09-18'),
      capturedAt: '2026-09-18T00:00:00Z', fixtureKind: 'synthetic', label: 'wrong hold' });
    const good = new MockReservationProvider('verified', now);
    const reservation: ReservationProvider = { kind: 'mock-reservation-provider', async submit(submission) {
      const result = await good.submit(submission);
      if (result.kind !== 'verified-pending-hold') throw Error('EXPECTED_HOLD');
      result.holds[0]!.date = '2026-09-19';
      return result;
    } };
    const coordinator = new ApiBookingCoordinator(availability, reservation, new MockCheckoutHandoff());
    await expect(coordinator.coordinate({ runId: 'wrong', preferences, now, maximumSnapshotAgeMs: 5_000 }))
      .resolves.toMatchObject({ kind: 'stopped', reason: 'unknown-outcome', reconciliationRequired: true });
  });

  it('rejects incomplete checkout sessions and keeps the known hold', async () => {
    const availability = new MockAvailabilityProvider({ raw: availabilityFixture('2026-09-18'),
      capturedAt: '2026-09-18T00:00:00Z', fixtureKind: 'synthetic', label: 'bad session' });
    const coordinator = new ApiBookingCoordinator(availability, new MockReservationProvider('verified', now),
      { kind: 'mock-checkout-handoff', async prepare() {
        return { kind: 'mock-checkout-ready', synthetic: true, paymentAutomated: false, sessions: [] };
      } });
    const result = await coordinator.coordinate({ runId: 'bad-session', preferences, now, maximumSnapshotAgeMs: 5_000 });
    expect(result).toMatchObject({ kind: 'stopped', reason: 'checkout-preparation-failed', reconciliationRequired: true });
    if (result.kind !== 'stopped') throw Error('EXPECTED_STOP');
    expect(result.holds).toHaveLength(1);
  });
  it('stops at a verified synthetic pending hold and mock manual-payment handoff', async () => {
    const { run } = setup('verified');
    const result = await run();
    expect(result.kind).toBe('manual-payment-required');
    expect(result.synthetic).toBe(true);
    expect(result.timings.label).toBe('MOCK timing');
    if (result.kind !== 'manual-payment-required') throw Error('EXPECTED_HANDOFF');
    expect(result.holds[0]).toMatchObject({ synthetic: true, status: 'pending', paymentStatus: 'pending' });
    expect(result.handoff).toMatchObject({ synthetic: true, paymentAutomated: false });
    expect(result.handoff.sessions[0]!.expiresAt).toBe(result.holds[0]!.holdExpiresAt);
  });

  it.each([
    ['conflict', 'conflict'],
    ['validation-failure', 'validation-failure'],
    ['expired', 'expired-hold'],
  ] as const)('stops safely for mock %s', async (scenario, reason) => {
    const result = await setup(scenario).run();
    expect(result).toMatchObject({ kind: 'stopped', synthetic: true, reason, reconciliationRequired: scenario === 'expired' });
  });

  it('prevents duplicate submissions within one run', async () => {
    const { run, reservation } = setup('verified');
    await run('same-run');
    await expect(run('same-run')).rejects.toThrow('DUPLICATE_RESERVATION_SUBMISSION_BLOCKED');
    expect(reservation.submissions).toHaveLength(1);
  });

  it('blocks concurrent duplicate calls before either can submit twice', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reservation: ReservationProvider = {
      kind: 'mock-reservation-provider',
      async submit(submission) {
        await gate;
        return new MockReservationProvider('verified', now).submit(submission);
      },
    };
    const coordinator = new ApiBookingCoordinator(
      new MockAvailabilityProvider({ raw: availabilityFixture('2026-09-18'), capturedAt: '2026-09-18T00:00:00Z', fixtureKind: 'synthetic', label: 'SYNTHETIC CONCURRENCY FIXTURE' }),
      reservation,
      new MockCheckoutHandoff(),
    );
    const options = { runId: 'concurrent-run', preferences, now, maximumSnapshotAgeMs: 5_000 };
    const first = coordinator.coordinate(options);
    await expect(coordinator.coordinate(options)).rejects.toThrow('DUPLICATE_RESERVATION_SUBMISSION_BLOCKED');
    release();
    await expect(first).resolves.toMatchObject({ kind: 'manual-payment-required' });
  });

  it('turns a thrown submission into an unknown outcome and requires reconciliation', async () => {
    const reservation: ReservationProvider = { kind: 'mock-reservation-provider', async submit() { throw Error('private transport detail'); } };
    const coordinator = new ApiBookingCoordinator(
      new MockAvailabilityProvider({ raw: availabilityFixture('2026-09-18'), capturedAt: '2026-09-18T00:00:00Z', fixtureKind: 'synthetic', label: 'SYNTHETIC THROW FIXTURE' }),
      reservation,
      new MockCheckoutHandoff(),
    );
    const options = { runId: 'throw-run', preferences, now, maximumSnapshotAgeMs: 5_000 };
    await expect(coordinator.coordinate(options)).resolves.toMatchObject({ kind: 'stopped', reason: 'unknown-outcome', reconciliationRequired: true });
    await expect(coordinator.coordinate({ ...options, runId: 'later-run' })).rejects.toThrow('AUTHORITATIVE_RECONCILIATION_REQUIRED');
  });

  it('blocks every later submission after an unknown outcome pending reconciliation', async () => {
    const { run, reservation } = setup('unknown');
    const result = await run('uncertain-run');
    expect(result).toMatchObject({ kind: 'stopped', reason: 'unknown-outcome', reconciliationRequired: true });
    await expect(run('different-run')).rejects.toThrow('AUTHORITATIVE_RECONCILIATION_REQUIRED');
    expect(reservation.submissions).toHaveLength(1);
  });

  it('models non-atomic partial two-court success and requires reconciliation', async () => {
    const { run, reservation } = setup('partial', { courtCount: 2, maximumTotalPrice: 2_400 });
    const result = await run('partial-run');
    expect(result).toMatchObject({ kind: 'stopped', reason: 'partial-success', reconciliationRequired: true });
    if (result.kind !== 'stopped' || result.reservation.kind !== 'partial-success') throw Error('EXPECTED_PARTIAL');
    expect(result.reservation.holds).toHaveLength(1);
    expect(result.reservation.failedCourts).toHaveLength(1);
    await expect(run('fallback-run')).rejects.toThrow('AUTHORITATIVE_RECONCILIATION_REQUIRED');
    expect(reservation.submissions).toHaveLength(1);
  });

  it('uses the provider hold timestamp rather than assuming ten minutes', async () => {
    const { run } = setup('verified', {}, 90_000);
    const result = await run();
    if (result.kind !== 'manual-payment-required') throw Error('EXPECTED_HANDOFF');
    expect(Date.parse(result.holds[0]!.holdExpiresAt) - now.getTime()).toBe(90_000);
  });

  it('refuses malformed authoritative hold evidence before checkout handoff', async () => {
    const reservation: ReservationProvider = {
      kind: 'mock-reservation-provider',
      async submit(submission) {
        const court = submission.plan.courts[0]!;
        return { kind: 'verified-pending-hold', synthetic: true, holds: [{
          synthetic: true, holdId: 'synthetic-malformed', intentId: submission.intentId, facilityId: 'offline-fixture-facility',
          chunkIndex: 0, court: court.court, spaceId: court.spaceId, date: court.date, startTime: court.startTime,
          endTime: court.endTime, durationMinutes: court.durationMinutes, currency: court.currency, amount: court.price,
          status: 'pending', paymentStatus: 'pending', holdExpiresAt: 'not-a-time',
        }] };
      },
    };
    const coordinator = new ApiBookingCoordinator(
      new MockAvailabilityProvider({ raw: availabilityFixture('2026-09-18'), capturedAt: '2026-09-18T00:00:00Z', fixtureKind: 'synthetic', label: 'SYNTHETIC HOLD VALIDATION FIXTURE' }),
      reservation,
      new MockCheckoutHandoff(),
    );
    await expect(coordinator.coordinate({ runId: 'malformed-hold', preferences, now, maximumSnapshotAgeMs: 5_000 }))
      .resolves.toMatchObject({ kind: 'stopped', reason: 'unknown-outcome', reconciliationRequired: true });
    await expect(coordinator.coordinate({ runId: 'later-run', preferences, now, maximumSnapshotAgeMs: 5_000 }))
      .rejects.toThrow('AUTHORITATIVE_RECONCILIATION_REQUIRED');
  });

  it('never submits when planning fails', async () => {
    const { run, reservation } = setup('verified', { maximumTotalPrice: 1 });
    await expect(run()).rejects.toThrow('BOOKING_MAXIMUM_PRICE_EXCEEDED');
    expect(reservation.submissions).toHaveLength(0);
  });
});
