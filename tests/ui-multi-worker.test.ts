import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Controller } from '../ui/controller.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema, ObservationSchema } from '../src/config.js';
import { clockStatus } from '../ui/status.js';
import { requiredWorkerIds, type WorkerId } from '../src/workers.js';
import type { Runner } from '../ui/processes.js';

// Seven courts over an Extended split need every browser/player A-H.
const workers = requiredWorkerIds('extended', 7);
const players = Object.fromEntries(workers.flatMap((worker, index) => {
  const suffix = worker === 'A' ? '' : `_${worker}`;
  return [[`PLAYER${suffix}_FULL_NAME`, `Fixture Player ${index + 1}`],
    [`PLAYER${suffix}_PHONE`, `091${String(10000000 + index).padStart(8, '0')}`],
    [`PLAYER${suffix}_EMAIL`, `fixture${index + 1}@example.invalid`]];
}));

function view() {
  return bookingView(ConfigSchema.parse({ ...defaultSetup, ...players, BOOKING_METHOD: 'api-first', BOOKING_TYPE: 'extended',
    COURT_COUNT: 7, START_TIME: '17:00', DURATION_HOURS: 5, PREFERRED_COURTS: [6, 7, 1, 2, 3, 4, 5], FALLBACK_TIMES: [] }));
}
const healthOf = (unhealthy?: WorkerId) => Object.fromEntries(workers.map(worker => [worker, worker !== unhealthy])) as Record<WorkerId, boolean>;
const noopRunner: Runner = () => ({ pid: 1, done: Promise.resolve(0), stop: async () => undefined });

describe('Multi-worker API release: eight-browser readiness and QR summary', () => {
  it('requires all eight browsers A-H and stays ready only while every one is healthy', async () => {
    expect(workers).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    const plan = view();
    let health: Record<WorkerId, boolean> = healthOf();
    const controller = new Controller({ runner: noopRunner, lock: async () => false, cdp: async () => true,
      browserHealth: async () => health,
      clock: () => clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-25T07:00:00+08:00')),
      confirm: async () => true, publish: () => undefined, booking: () => plan, saveBooking: () => plan });
    await controller.resetPrepare({ workflow: 'release', strategy: 'extended' });
    expect(controller.state.detail).toContain('8 API browsers are ready');
    expect(controller.state.ready).toBe(true);
    await controller.refresh();
    expect(controller.state.ready).toBe(true);
    health = healthOf('H');
    await controller.refresh();
    expect(controller.state.ready).toBe(false);
    expect(controller.state.browserHealth?.H).toBe(false);
  });

  it('keeps successful checkouts visible when another worker fails', async () => {
    const previous = process.env.THIRSTY_API_TEST_INSTALLATION;
    process.env.THIRSTY_API_TEST_INSTALLATION = '1';
    try {
      const plan = view();
      const releaseMs = Date.now() + 3600000;
      const successfulWorkers = ['A', 'C', 'E', 'G'] as const;
      const runner: Runner = (command, event) => {
        if (typeof command === 'object' && command.kind === 'apiRun' && command.mode === 'live') {
          for (const [index, workerId] of successfulWorkers.entries()) {
            const shared = { elapsedMs: 1000 + index, workerId, date: '2026-09-27', court: 1 + index, startTime: '17:00',
              durationHours: 3, price: 1800, bookingId: `booking-${workerId}`, bookingNo: `BK-${workerId}`,
              holdExpiresAt: '2026-09-25T00:10:00.000Z' } as const;
            event({ type: 'apiStage', stage: 'PENDING_HOLD', at: '2026-09-25T00:00:01.000Z', ...shared });
            event({ type: 'apiStage', stage: 'OFFICIAL_QRPH_HANDOFF', at: '2026-09-25T00:00:02.000Z', ...shared });
          }
          event({ type: 'apiStage', stage: 'FAILED', elapsedMs: 3000, code: 'OFFICIAL_CHECKOUT_STATE_MISMATCH', workerId: 'B' });
        }
        return { pid: 1, done: Promise.resolve(0), stop: async () => undefined };
      };
      const controller = new Controller({ runner, lock: async () => false, cdp: async () => true,
        browserHealth: async () => healthOf(),
        clock: () => ({ ...clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-25T07:00:00+08:00')), releaseMs, targetDate: plan.targetDate }),
        confirm: async () => true, publish: () => undefined, booking: () => plan, saveBooking: () => plan });
      await controller.resetPrepare({ workflow: 'release', strategy: 'extended' });
      await controller.authorizeTerms(true);
      await controller.armFullBooking();
      expect(controller.state.qrHandoffs?.map(h => h.checkout).sort(), controller.state.detail).toEqual([...successfulWorkers].sort());
      expect(controller.state.qrHandoffs?.every(h => h.status === 'qr-ready')).toBe(true);
      expect(controller.state.qrHandoffs).toHaveLength(4);
    } finally {
      if (previous === undefined) delete process.env.THIRSTY_API_TEST_INSTALLATION;
      else process.env.THIRSTY_API_TEST_INSTALLATION = previous;
    }
  });
});
