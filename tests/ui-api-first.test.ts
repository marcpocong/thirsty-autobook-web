import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Controller } from '../ui/controller.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema, ObservationSchema } from '../src/config.js';
import { clockStatus } from '../ui/status.js';
import type { Runner } from '../ui/processes.js';
import type { Command } from '../ui/types.js';

describe('API-first UI boundary', () => {
  it('prepares the API browser and sends an explicit non-submitting dry run to the real runner', async () => {
    const view = bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'api-first', PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' }));
    const calls: Command[] = [];
    const runner: Runner = command => { calls.push(command); return { pid: 1, done: Promise.resolve(0), stop: async () => undefined }; };
    const controller = new Controller({ runner, lock: async () => false, cdp: async () => true,
      browserHealth: async () => ({ A: true, B: false }),
      clock: () => ({ ...clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-17T07:00:00+08:00')), releaseMs: view.releaseMs, targetDate: view.targetDate }),
      confirm: async () => true, publish: () => undefined, booking: () => view, saveBooking: () => view });
    await controller.resetPrepare({ workflow: 'release', strategy: 'standard', setup: view.setup });
    expect(calls).toEqual([{ kind: 'apiRun', mode: 'prepare', date: view.targetDate, fingerprint: view.fingerprint }]);
    expect(controller.state).toMatchObject({ ready: true, apiFirstReady: true, headline: 'API BROWSER READY' });
    await controller.apiPreview(view.targetDate);
    expect(calls.at(-1)).toEqual({ kind: 'apiRun', mode: 'dry', date: view.targetDate, fingerprint: view.fingerprint });
    expect(controller.state.headline).toBe('API DRY RUN COMPLETE');
  });

  it('keeps Test Now API readiness through refresh and routes one confirmed run directly to QR', async () => {
    const view = bookingView(ConfigSchema.parse({ ...defaultSetup, PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' }));
    const calls: Command[] = [];
    const confirms: unknown[] = [];
    const runner: Runner = command => { calls.push(command); return { pid: 1, done: Promise.resolve(0), stop: async () => undefined }; };
    const controller = new Controller({ runner, lock: async () => false, cdp: async () => true,
      browserHealth: async () => ({ A: true, B: false }), playerStatus: () => ({ primary: true, extended: false }),
      clock: () => clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-19T08:00:00+08:00')),
      confirm: async () => true, confirmApiTest: async input => { confirms.push(input); return true; },
      publish: () => undefined, booking: () => view, saveBooking: () => view });
    const preparation = { workflow: 'test' as const, method: 'api-first' as const, request: { strategy: 'standard' as const,
      date: '2026-09-20', start: '12:00', duration: 1, courtCount: 1 as const,
      priority: [7, 6, 5, 4, 3, 2, 1], fallbackStarts: ['13:00'] }, maximum: 1200 };
    await controller.resetPrepare(preparation);
    expect(calls[0]).toMatchObject({ kind: 'apiRun', mode: 'prepare', date: '2026-09-20', preferences: { start: '12:00', duration: 1 } });
    await controller.refresh();
    expect(controller.state).toMatchObject({ workflow: 'test', ready: true, apiFirstReady: true, headline: 'API READY TO TEST' });
    await controller.authorizeTerms(true);
    await controller.testBooking({ method: preparation.method, request: preparation.request, maximum: preparation.maximum, authorizeTerms: true });
    expect(confirms).toEqual([{ date: '2026-09-20', start: '12:00', duration: 1, maximum: 1200, priority: [7, 6, 5, 4, 3, 2, 1] }]);
    expect(calls.at(-1)).toMatchObject({ kind: 'apiRun', mode: 'live-now', date: '2026-09-20', preferences: { start: '12:00', duration: 1 } });
  });
});
