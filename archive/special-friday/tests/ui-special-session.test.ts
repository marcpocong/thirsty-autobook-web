import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Controller } from '../ui/controller.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema, ObservationSchema } from '../src/config.js';
import { clockStatus } from '../ui/status.js';
import { SPECIAL_SESSION_REQUIRED_WORKERS } from '../src/api-booking/special-session.js';
import type { Runner } from '../ui/processes.js';
import type { WorkerId } from '../src/workers.js';

const specialPlayers = Object.fromEntries(SPECIAL_SESSION_REQUIRED_WORKERS.flatMap((worker, index) => {
  const suffix = worker === 'A' ? '' : `_${worker}`;
  return [[`PLAYER${suffix}_FULL_NAME`, `Fixture Player ${index + 1}`],
    [`PLAYER${suffix}_PHONE`, `091${String(10000000 + index).padStart(8, '0')}`],
    [`PLAYER${suffix}_EMAIL`, `fixture${index + 1}@example.invalid`]];
}));

function specialView() {
  return bookingView(ConfigSchema.parse({ ...defaultSetup, ...specialPlayers,
    SESSION_MODE: 'special-friday', BOOKING_METHOD: 'api-first', BOOKING_TYPE: 'extended',
    COURT_COUNT: 4, START_TIME: '17:00', DURATION_HOURS: 5, PREFERRED_COURTS: [6, 7, 1, 2, 3, 4, 5], FALLBACK_TIMES: [] }));
}
const healthOf = (unhealthy?: WorkerId) => Object.fromEntries(SPECIAL_SESSION_REQUIRED_WORKERS.map(worker =>
  [worker, worker !== unhealthy])) as Record<WorkerId, boolean>;
const noopRunner: Runner = () => ({ pid: 1, done: Promise.resolve(0), stop: async () => undefined });

describe('Special Friday UI: eight-worker readiness and QR summary', () => {
  it('reports the full eight-browser requirement and stays ready only while every one of A-H is healthy', async () => {
    const view = specialView();
    let health: Record<WorkerId, boolean> = healthOf();
    const controller = new Controller({ runner: noopRunner, lock: async () => false, cdp: async () => true,
      browserHealth: async () => health,
      clock: () => clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-25T08:00:00+08:00')),
      confirm: async () => true, publish: () => undefined, booking: () => view, saveBooking: () => view });
    await controller.resetPrepare({ workflow: 'release', strategy: 'extended' });
    expect(controller.state.detail).toContain('8 API browsers are ready');
    expect(controller.state.ready).toBe(true);
    await controller.refresh();
    expect(controller.state.ready).toBe(true);
    // Drop only H (the eighth worker) and the run must stop being ready.
    health = healthOf('H');
    await controller.refresh();
    expect(controller.state.ready).toBe(false);
    expect(controller.state.browserHealth?.H).toBe(false);
    expect(Object.keys(controller.state.browserHealth ?? {}).sort()).toEqual([...SPECIAL_SESSION_REQUIRED_WORKERS].sort());
  });

  it('shows a partial-success QR summary: successful checkouts stay visible even when another worker fails', async () => {
    const previous = process.env.THIRSTY_API_TEST_INSTALLATION;
    process.env.THIRSTY_API_TEST_INSTALLATION = '1';
    try {
      const view = specialView();
      const releaseMs = Date.now() + 3600000;
      const successfulWorkers = ['A', 'C', 'E', 'G'] as const;
      const runner: Runner = (command, event) => {
        if (typeof command === 'object' && command.kind === 'apiRun' && command.mode === 'live') {
          for (const [index, workerId] of successfulWorkers.entries()) {
            const shared = { elapsedMs: 1000 + index, workerId, date: '2026-09-25', court: 6 + index, startTime: '17:00',
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
        clock: () => ({ ...clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-25T07:00:00+08:00')), releaseMs, targetDate: view.targetDate }),
        confirm: async () => true, publish: () => undefined, booking: () => view, saveBooking: () => view });
      await controller.resetPrepare({ workflow: 'release', strategy: 'extended' });
      await controller.authorizeTerms(true);
      await controller.armFullBooking();
      const handoffWorkers = controller.state.qrHandoffs?.map(h => h.checkout).sort();
      expect(handoffWorkers, controller.state.detail).toEqual([...successfulWorkers].sort());
      expect(controller.state.qrHandoffs?.every(h => h.status === 'qr-ready')).toBe(true);
      // The failed worker (B) does not remove or corrupt the four independent successes.
      expect(controller.state.qrHandoffs).toHaveLength(4);
    } finally {
      if (previous === undefined) delete process.env.THIRSTY_API_TEST_INSTALLATION;
      else process.env.THIRSTY_API_TEST_INSTALLATION = previous;
    }
  });
});
