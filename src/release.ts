import type { Page } from 'playwright';
import { DateTime } from 'luxon';
import { setTimeout as delay } from 'node:timers/promises';
import { type Config, type ReleaseSettings, releaseCalendar, compilePreferences, VENUE } from './config.js';
import { assertPage } from './browser.js';
import { snapshot, validateSnapshot, resolvePreference } from './grid.js';
import { releaseNavigationTarget, waitForBookingShellForRelease, navigateReleasedTargetDate, preopenReleaseCalendar, observePreopenedTarget, clickReleasedTargetDate } from './release-navigation.js';
import { Safety, waitUntil } from './safety.js';
import { Telemetry } from './telemetry.js';
import { emitUiEvent } from './ui-events.js';

export async function boundedRelease<T>(maximum: number, retryDelay: number, signal: AbortSignal, attempt: (n: number) => Promise<T | undefined>): Promise<T> {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 2) throw new Error('INVALID_RELOAD_LIMIT');
  for (let n = 1; n <= maximum; n++) {
    signal.throwIfAborted();
    const result = await attempt(n);
    if (result !== undefined) return result;
    if (n < maximum) await delay(retryDelay, undefined, { signal });
  }
  throw new Error('RELEASE_HORIZON_UNAVAILABLE');
}
export async function observeRelease(page: Page, c: Config | ReleaseSettings, safety: Safety, t: Telemetry, dry: boolean, selecting = false) {
  const target = releaseCalendar(c);
  const navigationTarget = releaseNavigationTarget(target.targetDate);
  const preferences = 'START_TIME' in c ? compilePreferences(c) : undefined;
  if (dry && !preferences) throw new Error('DRY_CONFIG_REQUIRED');
  if (Date.now() >= target.releaseMs - c.PREFLIGHT_SECONDS_BEFORE * 1000) throw new Error('TOO_LATE_FOR_PREFLIGHT');
  emitUiEvent({ type: 'plan', targetDate: target.targetDate, releaseMs: target.releaseMs, timezone: c.TIMEZONE });
  page.setDefaultTimeout(c.CRITICAL_STEP_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(c.CRITICAL_STEP_TIMEOUT_MS);
  const preflight = async () => {
    t.mark('preflightStarted');
    await assertPage(page, safety);
    const s = await snapshot(page);
    const current = DateTime.now().setZone(c.TIMEZONE).toISODate()!;
    const cells = validateSnapshot(s, current);
    if (cells.some(cell => cell.state === 'SELECTED')) throw new Error('PREEXISTING_SELECTION');
    if (await page.getByTestId('booking-court-filter-label').innerText() !== 'All Courts') throw new Error('COURT_FILTER_NOT_ALL');
    if (await page.evaluate(() => document.visibilityState) !== 'visible') throw new Error('TAB_NOT_VISIBLE');
    t.mark('preflightCompleted');
  };
  await preflight();
  console.log(JSON.stringify({ mode: selecting ? 'SELECTION ONLY — STOPS BEFORE PROCEED' : dry ? 'DRY RACE — NO SELECTION' : 'RELEASE OBSERVATION — NO BOOKING', venue: VENUE, targetDate: target.targetDate, preferences, maximumPrice: 'MAX_PRICE' in c ? c.MAX_PRICE : undefined, playerInfoLoaded: 'PLAYER_FULL_NAME' in c, localTime: new Date().toString(), manilaTime: DateTime.now().setZone('Asia/Manila').toISO(), release: target.releaseISO, releaseLeadMs: c.RELEASE_LEAD_MS, maxReloads: c.MAX_RELEASE_RELOADS, secondsRemaining: (target.releaseMs - Date.now()) / 1000, abort: 'Q or Ctrl+C' }, null, 2));
  await waitUntil(target.releaseMs - c.PREFLIGHT_SECONDS_BEFORE * 1000, safety.signal);
  await preflight();
  if (c.RELEASE_PREOPEN_CALENDAR) await preopenReleaseCalendar(page, navigationTarget, safety, t, c.CRITICAL_STEP_TIMEOUT_MS, c.BOOKING_HORIZON_DAYS > 0);
  if (Date.now() >= target.releaseMs) throw new Error('PREFLIGHT_MISSED_RELEASE');
  t.mark('armed'); t.mark('releaseScheduled', target.releaseMs);
  console.log('ARMED — waiting for release.');
  await waitUntil(target.releaseMs, safety.signal);
  t.mark('releaseTriggerFired', Date.now() - target.releaseMs);
  let readyWithoutReload = false;
  if (c.RELEASE_PREOPEN_CALENDAR) {
    t.mark('preopenedTargetObservationStarted');
    if (await observePreopenedTarget(page, navigationTarget, safety)) {
      t.mark('targetEnabledWithoutReload');
      await clickReleasedTargetDate(page, navigationTarget, safety, t, c.CRITICAL_STEP_TIMEOUT_MS);
      readyWithoutReload = true;
    } else t.mark('targetStillDisabledAtRelease');
  }
  if (!readyWithoutReload) await boundedRelease(c.MAX_RELEASE_RELOADS, c.RELEASE_RETRY_DELAY_MS, safety.signal, async () => {
    safety.check(); t.mark('reloadStarted');
    await page.reload({ waitUntil: 'commit' }); t.mark('reloadCommitted');
    await waitForBookingShellForRelease(page, safety, c.CRITICAL_STEP_TIMEOUT_MS, t);
    const result = await navigateReleasedTargetDate(page, navigationTarget, safety, t, c.CRITICAL_STEP_TIMEOUT_MS);
    if (result === 'TARGET_DATE_NOT_RELEASED') return undefined;
    return true;
  });
  safety.check(); t.mark('gridSnapshotStarted');
  const grid = await snapshot(page);
  const cells = validateSnapshot(grid, target.targetDate);
  t.mark('gridSnapshotCompleted');
  const chosen = preferences && !selecting ? resolvePreference(cells, preferences) : undefined;
  if (preferences && !selecting) t.mark('preferenceResolved');
  if (!selecting) console.log(JSON.stringify({ targetDate: target.targetDate, chosen: chosen ?? null, stoppedBeforeAnySelection: true }, null, 2));
  return { target, grid, preferences: preferences ?? [] };
}
