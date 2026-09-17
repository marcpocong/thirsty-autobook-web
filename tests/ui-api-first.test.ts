import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Controller } from '../ui/controller.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema, ObservationSchema } from '../src/config.js';
import { clockStatus } from '../ui/status.js';
import type { Runner } from '../ui/processes.js';
import type { Command } from '../ui/types.js';

describe('API-first UI boundary', () => {
  it('prepares API-first read-only mode without starting Chrome and runs an explicit preview', async () => {
    const view = bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'api-first', PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' }));
    const calls: Command[] = [];
    const runner: Runner = command => { calls.push(command); return { pid: 1, done: Promise.resolve(0), stop: async () => undefined }; };
    const controller = new Controller({ runner, lock: async () => false, cdp: async () => false,
      clock: () => ({ ...clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-17T07:00:00+08:00')), releaseMs: view.releaseMs, targetDate: view.targetDate }),
      confirm: async () => true, publish: () => undefined, booking: () => view, saveBooking: () => view });
    await controller.resetPrepare({ workflow: 'release', strategy: 'standard', setup: view.setup });
    expect(calls).toEqual([]);
    expect(controller.state).toMatchObject({ ready: true, apiFirstReady: true, headline: 'API-FIRST READ-ONLY READY' });
    await controller.apiPreview();
    expect(calls).toEqual([{ kind: 'apiPreview', date: view.targetDate }]);
    expect(controller.state.headline).toBe('API-FIRST CANDIDATE PREVIEW COMPLETE');
    expect(controller.state.detail).toContain('remains disabled');
  });
});
