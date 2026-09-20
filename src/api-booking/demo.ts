import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ApiBookingCoordinator } from './booking-coordinator.js';
import { MockAvailabilityProvider } from './mock/mock-availability-provider.js';
import { MockCheckoutHandoff } from './mock/mock-checkout-handoff.js';
import { MockReservationProvider } from './mock/mock-reservation-provider.js';

const fixturePath = fileURLToPath(new URL('./fixtures/onda-availability-snapshot-2026-09-17.json', import.meta.url));
const raw = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
const now = new Date('2026-09-17T12:00:00.000Z');
const coordinator = new ApiBookingCoordinator(
  new MockAvailabilityProvider({ raw, capturedAt: '2026-09-17T11:59:00.000Z', fixtureKind: 'captured-historical', label: 'SANITIZED HISTORICAL SNAPSHOT - NOT CURRENT AVAILABILITY' }),
  new MockReservationProvider('verified', now),
  new MockCheckoutHandoff(),
);
const result = await coordinator.coordinate({
  runId: 'offline-demo', now, maximumSnapshotAgeMs: 120_000,
  preferences: {
    mode: 'standard', targetDate: '2026-09-18', durationHours: 2,
    preferredStartTimes: ['08:00'], fallbackStartTimes: ['12:00'],
    courtPriority: [3, 6, 7], fallbackCourts: [1, 4, 5, 2], courtCount: 1,
    maximumTotalPrice: 1_400, currency: 'PHP',
  },
});
console.log(JSON.stringify({ warning: 'OFFLINE SYNTHETIC MOCK ONLY - NO LIVE REQUEST OR RESERVATION', result }, null, 2));
