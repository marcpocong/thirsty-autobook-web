import type { Page } from 'playwright';
import { DateTime } from 'luxon';
import { ONDA_URL, VENUE } from './config.js';
import { selectors, waitForGrid, snapshot, validateSnapshot } from './grid.js';
import { Safety, securityReason } from './safety.js';
import type { Telemetry } from './telemetry.js';

// Construct before the release wait; the normal practice navigator is unchanged.
export function releaseNavigationTarget(date: string) {
  const target = DateTime.fromISO(date);
  if (!target.isValid || target.toISODate() !== date) throw Error('INVALID_TARGET_DATE');
  return { date, daySelector: `button[data-day="${target.toFormat('M/d/yyyy')}"]`,
    heading: target.setLocale('en').toFormat('ccc, LLLL d') };
}
type ReleaseTarget = ReturnType<typeof releaseNavigationTarget>;
async function guardReleaseShell(page: Page, safety: Safety) {
  safety.check();
  if (page.url() !== ONDA_URL) throw Error('WRONG_URL');
  const reason = securityReason(await page.locator('body').innerText());
  if (reason) safety.stop(reason);
  safety.check();
}
export async function waitForBookingShellForRelease(page: Page, safety: Safety, timeout: number, t?: Pick<Telemetry, 'mark'>) {
  safety.check();
  if (page.url() !== ONDA_URL) throw Error('WRONG_URL');
  t?.mark('releaseUrlVerified');
  const venue = page.getByTestId('public-booking-hero-title');
  await venue.waitFor({ state: 'attached', timeout }); t?.mark('releaseVenueAttached');
  await venue.waitFor({ state: 'visible', timeout });
  t?.mark('releaseVenueVisible');
  if ((await venue.innerText()).trim() !== VENUE) throw Error('WRONG_VENUE');
  t?.mark('releaseVenueVerified');
  const picker = page.getByRole('button', { name: 'Select booking date', exact: true, includeHidden: true });
  await picker.waitFor({ state: 'attached', timeout }); t?.mark('releasePickerAttached');
  if (await picker.count() !== 1) throw Error('AMBIGUOUS_DATE_PICKER');
  await picker.waitFor({ state: 'visible', timeout }); t?.mark('releasePickerVisible');
  // Wait only for enabled semantics, never stability or hit-target actionability.
  const handle = await picker.elementHandle();
  if (!handle) throw Error('DATE_PICKER_DETACHED');
  try {
    await page.waitForFunction(e => e.isConnected && !e.matches(':disabled') &&
      !e.closest('[aria-disabled="true"]'), handle, { timeout, polling: 'raf' });
  } finally { await handle.dispose(); }
  if (await picker.count() !== 1 || !await picker.isVisible() || !await picker.isEnabled()) throw Error('DATE_PICKER_NOT_READY');
  t?.mark('releasePickerEnabled');
  await guardReleaseShell(page, safety);
  t?.mark('releaseShellReady');
}

export async function preopenReleaseCalendar(page: Page, target: ReleaseTarget, safety: Safety, t: Telemetry, timeout: number, expectDisabled: boolean) {
  t.mark('preopenPreparationStarted');
  await guardReleaseShell(page, safety);
  const before = await snapshot(page);
  const picker = page.getByRole('button', { name: 'Select booking date', exact: true });
  if (await picker.getAttribute('aria-expanded') !== 'true') { safety.check(); await picker.click({ timeout }); }
  const day = page.locator(target.daySelector);
  await day.waitFor({ state: 'visible', timeout });
  if (await day.count() !== 1) throw Error('TARGET_DATE_STRUCTURE_CHANGED');
  t.mark('preopenTargetDetected');
  const enabled = await day.isEnabled();
  if (expectDisabled && enabled) throw Error('TARGET_DATE_ALREADY_RELEASED');
  await guardReleaseShell(page, safety);
  if (JSON.stringify(await snapshot(page)) !== JSON.stringify(before)) throw Error('PREOPEN_BOOKING_STATE_CHANGED');
  if (await picker.getAttribute('aria-expanded') !== 'true') throw Error('PREOPEN_CALENDAR_CLOSED');
  t.mark(enabled ? 'preopenTargetEnabled' : 'preopenTargetDisabled');
  t.mark('releaseCalendarPreopened');
  t.mark('preopenCalendarLeftOpen');
}

// Exactly one DOM evaluation: no locator waits, polling, requests or recovery clicks.
export async function observePreopenedTarget(page: Page, target: ReleaseTarget, safety: Safety) {
  safety.check();
  if (page.url() !== ONDA_URL) throw Error('WRONG_URL');
  const result = await page.evaluate(selector => {
    const days = document.querySelectorAll<HTMLButtonElement>(selector);
    const day = days[0];
    return { enabled: days.length === 1 && !!day &&
      day.checkVisibility() && !day.matches(':disabled') && !day.closest('[aria-disabled="true"]') };
  }, target.daySelector);
  safety.check();
  return result.enabled;
}

export async function clickReleasedTargetDate(page: Page, target: ReleaseTarget, safety: Safety, t: Telemetry, timeout: number) {
  const picker = page.getByRole('button', { name: 'Select booking date', exact: true });
  const day = page.locator(target.daySelector);
  safety.check(); t.mark('targetDateEnabled'); t.mark('targetDateClickStarted');
  await day.click({ timeout });
  safety.check(); t.mark('targetDateClicked');
  await page.waitForFunction(({ selector, heading }) => {
    const labels = document.querySelectorAll(selector);
    return labels.length === 1 && labels[0]!.textContent?.trim() === heading;
  }, { selector: selectors.heading, heading: target.heading }, { timeout, polling: 'raf' });
  safety.check(); t.mark('targetHeadingDetected');
  await waitForGrid(page, target.date, safety, timeout, target.heading);
  validateSnapshot(await snapshot(page), target.date);
  safety.check(); t.mark('targetGridReady');
  if (await picker.getAttribute('aria-expanded') === 'true') {
    safety.check(); await picker.click({ timeout });
  }
  safety.check(); return 'TARGET_GRID_READY' as const;
}
export async function navigateReleasedTargetDate(page: Page, target: ReleaseTarget, safety: Safety, t: Telemetry, timeout: number) {
  await guardReleaseShell(page, safety);
  const picker = page.getByRole('button', { name: 'Select booking date', exact: true });
  if (await picker.getAttribute('aria-expanded') !== 'true') {
    safety.check(); await picker.click({ timeout });
  }
  safety.check(); t.mark('targetPickerOpened');
  const day = page.locator(target.daySelector);
  // Allow calendar hydration; a missing/ambiguous day is a structure error,
  // whereas a present, disabled day is the only normal release retry signal.
  try { await day.waitFor({ state: 'visible', timeout }); }
  catch { safety.check(); await guardReleaseShell(page, safety); throw Error('TARGET_DATE_STRUCTURE_CHANGED'); }
  await guardReleaseShell(page, safety);
  t.mark('targetDateDetected');
  if (!await day.isEnabled()) {
    safety.check(); t.mark('targetDateNotReleased'); return 'TARGET_DATE_NOT_RELEASED' as const;
  }
  return clickReleasedTargetDate(page, target, safety, t, timeout);
}
