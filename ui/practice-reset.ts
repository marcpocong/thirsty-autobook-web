import { readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { UiEventSchema } from '../src/ui-events.js';
import type { BrowserReview } from '../src/lock-browser.js';
import type { LockReview } from './locks.js';
import { pidAlive } from './locks.js';

const execFileAsync = promisify(execFile);

function readHandoff(raw: string): boolean {
  try {
    const event = UiEventSchema.safeParse(JSON.parse(raw).handoff);
    return event.success && event.data.type === 'handoff';
  } catch {
    return false;
  }
}

async function readLock(root: string): Promise<{ raw: string; pid: number | null } | null> {
  try {
    const raw = await readFile(resolve(root, '.local/automation.lock'), 'utf8');
    let pid: number | null = null;
    try {
      const value = JSON.parse(raw);
      if (Number.isSafeInteger(value.pid) && value.pid > 0) pid = value.pid;
    } catch { /* malformed locks are still cleared only through the explicit reset flow */ }
    return { raw, pid };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function browserBlocksReset(browser: BrowserReview): string | null {
  if (browser.hold === 'Active' || browser.page === 'QR Checkout') return 'PRACTICE_RESET_HOLD_ACTIVE';
  if (browser.selected !== null && browser.selected > 0) return 'LOCK_SELECTED_SLOTS';
  return null;
}

async function runPowerShell(root: string, script: string): Promise<void> {
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(root, 'scripts', script)], {
      cwd: root, windowsHide: true, timeout: 30000, maxBuffer: 8192,
    });
  } catch (error) {
    const text = `${(error as { stdout?: string }).stdout ?? ''}\n${(error as { stderr?: string }).stderr ?? ''}`;
    const code = /[A-Z][A-Z0-9_]{2,80}/.exec(text)?.[0];
    throw Error(code && code !== 'ERROR' ? code : 'PRACTICE_RESET_FAILED');
  }
}

/**
 * Reset only the dedicated practice environment. A recorded QR handoff, an
 * active worker, selected slots, or unknown live browser state always blocks
 * the reset so this convenience action cannot hide a real reservation.
 */
export async function resetPracticeSession(
  root: string,
  reviewLock: () => Promise<LockReview>,
  probeBrowser: () => Promise<BrowserReview>,
  cdp: () => Promise<boolean>,
): Promise<void> {
  const before = await readLock(root);
  if (before && readHandoff(before.raw)) throw Error('PRACTICE_RESET_HOLD_ACTIVE');

  if (before) {
    const review = await reviewLock();
    if (review.alive === true || review.owned) throw Error('LOCK_PID_RUNNING');
    if (review.hold === 'Active' || review.page === 'QR Checkout') throw Error('PRACTICE_RESET_HOLD_ACTIVE');
    if (review.selected !== null && review.selected > 0) throw Error('LOCK_SELECTED_SLOTS');
    if (!review.canClear) {
      // Review Booking, Payment Summary, and other pre-handoff page states
      // are local practice state. The explicit reset may discard them.
      if (review.reason !== 'LOCK_BROWSER_STATE_UNKNOWN') throw Error(review.reason);
    }
  } else {
    let browser: BrowserReview | null = null;
    try {
      browser = await probeBrowser();
    } catch {
      // No reachable dedicated Chrome is a valid starting point for reset.
      if (await cdp()) throw Error('LOCK_BROWSER_STATE_UNKNOWN');
    }
    if (browser) {
      const blocked = browserBlocksReset(browser);
      if (blocked && (blocked !== 'LOCK_BROWSER_STATE_UNKNOWN' || await cdp())) throw Error(blocked);
    }
  }

  await runPowerShell(root, 'reset-onda-chrome.ps1');

  if (before) {
    const current = await readLock(root);
    if (!current || createHash('sha256').update(current.raw).digest('hex') !== createHash('sha256').update(before.raw).digest('hex')) throw Error('LOCK_BROWSER_STATE_UNKNOWN');
    if (current.pid !== null && pidAlive(current.pid) !== false) throw Error('LOCK_PID_RUNNING');
    if (readHandoff(current.raw)) throw Error('PRACTICE_RESET_HOLD_ACTIVE');
    await unlink(resolve(root, '.local/automation.lock'));
  }

  await runPowerShell(root, 'start-onda-chrome.ps1');
}
