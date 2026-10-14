import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Controller } from '../ui/controller.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema, ObservationSchema } from '../src/config.js';
import { clockStatus } from '../ui/status.js';
import type { Runner } from '../ui/processes.js';
import type { Command } from '../ui/types.js';
import { preregistered } from './arbitration-manifest-stub.js';

const plan = () => bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'api-first', PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' }));
const clock = () => clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-10-14T21:00:00+08:00'));
function controller(runner: Runner) {
  const view = plan();
  return new Controller({ ensureArbitrationManifest: preregistered, runner, lock: async () => false, cdp: async () => true, clock, confirm: async () => true,
    booking: () => view, saveBooking: () => view, publish: () => undefined, browserHealth: async () => ({ A: true }) });
}
const cells = (date: string) => ({ type: 'courtBrowser' as const, date, capturedAt: new Date().toISOString(), observer: 'window' as const,
  cells: [{ wing: 'MANGO' as const, court: 7, start: '19:00', state: 'OPEN' as const, available: true, price: 700 }],
  wings: [{ wing: 'MANGO' as const, status: 'OK' as const, capturedAt: new Date().toISOString(), cells: 112 }, { wing: 'BUKO' as const, status: 'ERROR' as const, code: 'AVAILABILITY_HTTP_FAILED', cells: 0 }] });

describe('one-click availability in the controller', () => {
  it('runs without a prepared worker and leaves preparation and Terms untouched', async () => {
    const commands: Command[] = [];
    const runner: Runner = (command, onEvent) => { commands.push(command); onEvent(cells('2026-10-16')); return { pid: 1, done: Promise.resolve(0), stop: async () => undefined }; };
    const c = controller(runner);
    c.state.ready = true; c.state.termsAuthorized = true; c.state.workflow = 'test';
    await c.browseCourts('2026-10-16');
    expect(commands).toEqual([{ kind: 'courtBrowse', date: '2026-10-16' }]);
    expect(c.state.ready).toBe(true); expect(c.state.termsAuthorized).toBe(true); expect(c.state.operation).toBe('idle');
    expect(c.state.availabilityCheck).toMatchObject({ status: 'DONE', date: '2026-10-16', code: 'BUKO:AVAILABILITY_HTTP_FAILED' });
    expect(c.state.courtBrowser?.cells[0]?.state).toBe('OPEN');
  });
  it('is refused while a release is armed or automation runs, and never overlaps another check', async () => {
    let finish!: (code: number) => void;
    const runner: Runner = () => ({ pid: 1, done: new Promise<number>(resolve => { finish = resolve; }), stop: async () => finish(1) });
    const c = controller(runner);
    c.state.activeApiRelease = { releaseMs: Date.now() + 60_000, targetDate: '2026-10-17', phase: 'WAITING' };
    await expect(c.browseCourts('2026-10-16')).rejects.toThrow('AVAILABILITY_CHECK_REFUSED_ACTIVE_RUN');
    c.state.activeApiRelease = null; c.state.operation = 'full';
    await expect(c.browseCourts('2026-10-16')).rejects.toThrow('AVAILABILITY_CHECK_REFUSED_ACTIVE_RUN');
    c.state.operation = 'idle';
    const first = c.browseCourts('2026-10-16');
    await expect(c.browseCourts('2026-10-16')).rejects.toThrow('AVAILABILITY_CHECK_RUNNING');
    finish(1);
    await expect(first).rejects.toThrow('AVAILABILITY_CHECK_FAILED');
    expect(c.state.availabilityCheck?.status).toBe('FAILED');
  });
});
