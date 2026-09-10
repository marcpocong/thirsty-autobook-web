import type { Page } from 'playwright';
import { DateTime } from 'luxon';
import { ONDA_URL, VENUE } from './config.js';
import { selectors, waitForGrid } from './grid.js';
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
export async function waitForBookingShellForRelease(page: Page, safety: Safety, timeout: number) {
  await guardReleaseShell(page, safety);
  const venue = page.getByTestId('public-booking-hero-title');
  await venue.waitFor({ state: 'visible', timeout });
  if ((await venue.innerText()).trim() !== VENUE) throw Error('WRONG_VENUE');
  // Trial checks visibility, enabled state, stability and hit target without a click.
  // No dependency on today's heading, grid container, rows or availability.
  await page.getByRole('button', { name: 'Select booking date', exact: true }).click({ trial: true, timeout });
  await guardReleaseShell(page, safety);
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
  safety.check(); t.mark('targetDateEnabled'); t.mark('targetDateClickStarted');
  await day.click({ timeout });
  safety.check(); t.mark('targetDateClicked');
  await page.waitForFunction(({ selector, heading }) => {
    const labels = document.querySelectorAll(selector);
    return labels.length === 1 && labels[0]!.textContent?.trim() === heading;
  }, { selector: selectors.heading, heading: target.heading }, { timeout, polling: 'raf' });
  safety.check(); t.mark('targetHeadingDetected');
  await waitForGrid(page, target.date, safety, timeout, target.heading);
  t.mark('targetGridReady');
  if (await picker.getAttribute('aria-expanded') === 'true') {
    safety.check(); await picker.click({ timeout });
  }
  safety.check(); return 'TARGET_GRID_READY' as const;
}
