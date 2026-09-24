import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiAutomationLock } from '../../src/api-booking/api-automation-lock.js';
import { assertResetSafe } from '../../src/booking-prepare.js';
import type { BrowserReview } from '../../src/lock-browser.js';
import { reviewLock } from '../../ui/locks.js';
import { readRetainedHold } from '../../ui/status.js';

let root: string, previous: string;
beforeEach(async () => { previous = process.cwd(); root = await mkdtemp(join(tmpdir(), 'armed-lock-')); process.chdir(root); });
afterEach(async () => { process.chdir(previous); if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw Error('UNSAFE_TEST_PATH'); await rm(root, { recursive: true, force: true }); });
const lockFile = () => readFile('.local/automation.lock', 'utf8').then(text => JSON.parse(text) as Record<string, unknown>);
// A proofless POST never navigates the tab: after a real hold the browser can still look exactly like this.
const cleanSchedule: BrowserReview = { page: 'Schedule', selected: 0, hold: 'Not detected', clean: true };

describe('FINAL_ACTION_ARMED global lock', () => {
  it('is one durable pre-release rewrite with the release instant and dispatch deadline', async () => {
    const lock = await ApiAutomationLock.acquire('standard', ['A', 'B', 'C']);
    const releaseMs = Date.parse('2026-09-25T00:00:00.000Z');
    await lock.armed(releaseMs, releaseMs + 1000, 3);
    expect(await lockFile()).toMatchObject({ stage: 'FINAL_ACTION_ARMED', releaseAt: '2026-09-25T00:00:00.000Z',
      dispatchDeadlineAt: '2026-09-25T00:00:01.000Z', armedCount: 3, workers: ['A', 'B', 'C'] });
    // After the sends: DISPATCHING keeps the armed evidence; a verified hold then supersedes it.
    await lock.dispatching();
    expect(await lockFile()).toMatchObject({ stage: 'FINAL_ACTION_DISPATCHING', releaseAt: '2026-09-25T00:00:00.000Z' });
    await expect(lock.armed(releaseMs, releaseMs - 1, 1)).rejects.toThrow('LOCK_ARM_INVALID');
    await expect(lock.armed(releaseMs, releaseMs + 1000, 0)).rejects.toThrow('LOCK_ARM_INVALID');
  });

  it('Reset & Prepare treats an armed lock at least as strictly as an unresolved final action', () => {
    const releaseMs = Date.parse('2026-09-25T00:00:00.000Z'), deadline = new Date(releaseMs + 1000).toISOString();
    const armed = { stage: 'FINAL_ACTION_ARMED', stageAt: new Date(releaseMs - 120_000).toISOString(), dispatchDeadlineAt: deadline };
    // Crash before release, restart well before the window: never cleared from a clean-looking Schedule.
    expect(() => assertResetSafe(armed, cleanSchedule, releaseMs - 60_000)).toThrow('PAYMENT_HOLD_MAY_BE_ACTIVE');
    // The window counts from the dispatch deadline, not from the (earlier) arm time.
    expect(() => assertResetSafe(armed, cleanSchedule, releaseMs - 120_000 + 700_000)).toThrow('PAYMENT_HOLD_MAY_BE_ACTIVE');
    expect(() => assertResetSafe(armed, cleanSchedule, releaseMs + 1000 + 661_000)).not.toThrow();
    // Without the deadline field it never recovers from Schedule alone.
    expect(() => assertResetSafe({ stage: 'FINAL_ACTION_ARMED', stageAt: armed.stageAt }, cleanSchedule, releaseMs + 86_400_000)).toThrow('PAYMENT_HOLD_MAY_BE_ACTIVE');
    // An active hold always blocks; a conclusively expired one does not.
    expect(() => assertResetSafe(armed, { page: 'QR Checkout', selected: null, hold: 'Active', clean: false }, releaseMs + 10_000_000)).toThrow('PAYMENT_HOLD_MAY_BE_ACTIVE');
    expect(() => assertResetSafe(armed, { page: 'QR Checkout', selected: null, hold: 'Expired', countdownSeconds: 0, clean: false }, releaseMs + 10_000)).not.toThrow();
    // Unchanged: an unresolved dispatch still counts from its own stage time.
    expect(() => assertResetSafe({ stage: 'FINAL_ACTION_DISPATCHING', stageAt: new Date(releaseMs).toISOString() }, cleanSchedule, releaseMs + 661_000)).not.toThrow();
  });

  it('Review Lock never offers to clear an armed lock, and status shows it as an unresolved final action', async () => {
    await mkdir('.local', { recursive: true });
    await writeFile('.local/automation.lock', JSON.stringify({ pid: 999_999, runID: 'fixture', mode: 'standard', workers: ['A'], stage: 'FINAL_ACTION_ARMED',
      releaseAt: '2026-09-25T00:00:00.000Z', dispatchDeadlineAt: '2026-09-25T00:00:01.000Z' }));
    let probed = false;
    const review = await reviewLock(root, false, async () => { probed = true; return cleanSchedule; }, () => false);
    expect(review).toMatchObject({ reason: 'PAYMENT_HOLD_MAY_BE_ACTIVE', canClear: false });
    expect(probed).toBe(false);
    expect(await readRetainedHold(root)).toEqual({ stage: 'FINAL_ACTION_DISPATCHING', expiresAt: null, remainingSeconds: null });
  });
});
