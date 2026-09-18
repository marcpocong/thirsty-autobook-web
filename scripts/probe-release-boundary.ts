import { chromium, type Page } from 'playwright';
import { DateTime } from 'luxon';
import { mkdir, writeFile } from 'node:fs/promises';
import { ONDA_URL, VENUE } from '../src/config.js';
import { releaseAvailabilityRequest } from '../src/availability-discovery.js';
import { Safety } from '../src/safety.js';
import { Telemetry } from '../src/telemetry.js';
import type { AvailabilitySlot } from '../src/onda-availability.js';

// Isolated and read-only: picker/date navigation only, never a slot or checkout click.
const [date, releaseText] = process.argv.slice(2);
const releaseMs = Number(releaseText);
const selfTest = process.argv.includes('--self-test');
const observationWindowMs = selfTest ? 3000 : 20_000;
if (!date || DateTime.fromISO(date).toISODate() !== date || !Number.isFinite(releaseMs)) throw Error('PROBE_ARGUMENTS_INVALID');
const output = `DiagnosticsLocal/release-boundary-${date}-${releaseMs}.json`;
const waitUntil = async (epoch: number) => {
  while (Date.now() < epoch) await new Promise(resolve => setTimeout(resolve, Math.min(epoch - Date.now(), 30_000)));
};
const elapsed = () => Date.now() - releaseMs;
const selector = `button[data-day="${DateTime.fromISO(date).toFormat('M/d/yyyy')}"]`;
const report: Record<string, unknown> = { targetDate: date, releaseMs, browser: 'isolated-headless',
  apiSamples: [] as Record<string, unknown>[], appAvailability: [] as Record<string, unknown>[], paths: {} };
await waitUntil(releaseMs - 90_000);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const noReload = await context.newPage(), reload = await context.newPage();
  const prepare = async (page: Page, label: string) => {
    page.on('response', response => {
      if (response.url().includes('/date-availability?'))
        (report.appAvailability as Record<string, unknown>[]).push({ path: label, offsetMs: elapsed(), status: response.status() });
    });
    const navigation = await page.goto(ONDA_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (navigation?.status() !== 200 || page.url() !== ONDA_URL) throw Error('PROBE_PAGE_UNSAFE');
    const venue = page.getByTestId('public-booking-hero-title');
    await venue.waitFor({ state: 'visible', timeout: 45_000 });
    if ((await venue.innerText()).trim() !== VENUE) throw Error('PROBE_WRONG_VENUE');
    const picker = page.getByRole('button', { name: 'Select booking date', exact: true });
    await picker.waitFor({ state: 'visible', timeout: 45_000 });
    return picker;
  };
  const [pickerA, pickerB] = await Promise.all([prepare(noReload, 'NO_RELOAD'), prepare(reload, 'RELOAD_AT_RELEASE')]);
  await pickerA.click();
  const dayA = noReload.locator(selector), dayB = reload.locator(selector);
  await dayA.waitFor({ state: 'visible', timeout: 10_000 });
  report.readyBeforeReleaseMs = releaseMs - Date.now();
  report.preReleaseEnabled = await dayA.isEnabled();

  const apiCandidate = (async (): Promise<AvailabilitySlot | null> => {
    for (const offset of (selfTest ? [0, 250, 500, 1000] : [0, 250, 500, 1000, 2000, 5000, 10000, 20000])) {
      await waitUntil(releaseMs + offset);
      const t = new Telemetry();
      // The probe schedules each read explicitly to preserve the first-release timestamp.
      const snapshot = await releaseAvailabilityRequest(noReload, date, new Safety(), t, 2500, 4)();
      const available = snapshot?.slots.filter(slot => slot.available && slot.date === date && slot.bookingDate === date) ?? [];
      (report.apiSamples as Record<string, unknown>[]).push({ offsetMs: elapsed(),
        durationMs: t.events.find(event => event.event === 'availabilityResponseReceived')?.value ?? null,
        status: t.events.find(event => event.event === 'availabilityHttpStatus')?.value ?? null,
        parsed: !!snapshot, released: snapshot?.released ?? null, availableHours: available.length,
        diagnosticEvents: t.events.map(event => event.event) });
      if (snapshot?.released && report.firstApiReleasedMs === undefined) report.firstApiReleasedMs = elapsed();
      if (snapshot?.released && available.length) {
        report.firstApiCandidateMs = elapsed();
        const preferred = available.find(slot => slot.price !== undefined && slot.currency === 'PHP') ?? available[0]!;
        report.apiSelected = { court: preferred.court, hour: preferred.startTime };
        return preferred;
      }
      if (t.events.some(event => event.event === 'ondaRateLimited' || event.event === 'availabilitySafetyAbort')) break;
    }
    return null;
  })();

  const targetReady = async (page: Page, chosen: AvailabilitySlot) => {
    await page.waitForFunction(({ date, court, hour }) => {
      if (document.querySelector('[aria-busy="true"]')) return false;
      const rows = [...document.querySelectorAll('[data-schedule-grid-row-date][data-schedule-grid-row-time]')];
      if (!rows.length || rows.some(row => row.getAttribute('data-schedule-grid-row-date') !== date)) return false;
      const row = rows.find(value => value.getAttribute('data-schedule-grid-row-time') === hour);
      const cells = [...(row?.querySelectorAll('[data-testid="court-schedule-slot-cell"]') ?? [])]
        .filter(cell => cell.getAttribute('aria-label')?.startsWith(`Court ${court}:`));
      return cells.length === 1 && cells[0]?.querySelector('[data-slot-state]')?.getAttribute('data-slot-state') === 'available' &&
        !(cells[0] as HTMLButtonElement).disabled;
    }, { date, court: chosen.court, hour: chosen.startTime }, { timeout: 30_000, polling: 'raf' });
    return elapsed();
  };
  const openTarget = async (page: Page, day: ReturnType<Page['locator']>, path: Record<string, unknown>) => {
    const chosen = await apiCandidate;
    if (!chosen) { path.targetFailure = 'NO_API_CANDIDATE'; return; }
    if (!await day.isEnabled()) { path.targetFailure = 'DATE_DISABLED'; return; }
    await day.click();
    path.dateClickedMs = elapsed();
    try { path.targetActionableMs = await targetReady(page, chosen); }
    catch { path.targetFailure = 'TARGET_NOT_ACTIONABLE'; }
  };

  const noReloadPath: Record<string, unknown> = {}, reloadPath: Record<string, unknown> = {};
  (report.paths as Record<string, unknown>).noReload = noReloadPath;
  (report.paths as Record<string, unknown>).reloadAtRelease = reloadPath;
  const noReloadWork = (async () => {
    await waitUntil(releaseMs);
    noReloadPath.enabledAtRelease = await dayA.isEnabled();
    while (Date.now() < releaseMs + observationWindowMs) {
      if (await dayA.isEnabled()) { noReloadPath.firstEnabledMs = elapsed(); break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (noReloadPath.firstEnabledMs === undefined) {
      noReloadPath.stillDisabledAfterWindowMs = elapsed();
      await pickerA.click(); await pickerA.click();
      noReloadPath.enabledAfterReopen = await dayA.isEnabled();
      if (noReloadPath.enabledAfterReopen) noReloadPath.firstEnabledMs = elapsed();
    }
    if (noReloadPath.firstEnabledMs === undefined) {
      noReloadPath.fallbackReloadStartedMs = elapsed();
      const nav = await noReload.reload({ waitUntil: 'commit', timeout: 45_000 });
      noReloadPath.fallbackCommitMs = elapsed(); noReloadPath.fallbackStatus = nav?.status() ?? null;
      await pickerA.waitFor({ state: 'visible', timeout: 45_000 });
      if (await pickerA.getAttribute('aria-expanded') !== 'true') await pickerA.click();
      await dayA.waitFor({ state: 'visible', timeout: 10_000 });
      noReloadPath.enabledAfterReload = await dayA.isEnabled();
      if (noReloadPath.enabledAfterReload) noReloadPath.firstEnabledMs = elapsed();
    }
    await openTarget(noReload, dayA, noReloadPath);
  })();
  const reloadWork = (async () => {
    await waitUntil(releaseMs);
    reloadPath.reloadStartedMs = elapsed();
    const nav = await reload.reload({ waitUntil: 'commit', timeout: 45_000 });
    reloadPath.commitMs = elapsed(); reloadPath.status = nav?.status() ?? null;
    await pickerB.waitFor({ state: 'visible', timeout: 45_000 });
    reloadPath.pickerVisibleMs = elapsed();
    if (await pickerB.getAttribute('aria-expanded') !== 'true') await pickerB.click();
    await dayB.waitFor({ state: 'visible', timeout: 10_000 });
    await reload.waitForFunction(selector => {
      const days = document.querySelectorAll<HTMLButtonElement>(selector);
      return days.length === 1 && !days[0]!.disabled && days[0]!.getAttribute('aria-disabled') !== 'true';
    }, selector, { timeout: selfTest ? 3000 : 45_000, polling: 'raf' });
    reloadPath.firstEnabledMs = elapsed();
    await openTarget(reload, dayB, reloadPath);
  })();
  const settled = await Promise.allSettled([apiCandidate, noReloadWork, reloadWork]);
  report.taskOutcomes = settled.map(value => value.status === 'fulfilled' ? 'COMPLETED' : 'FAILED');
  if (settled.some(value => value.status === 'rejected')) report.failure = 'BOUNDARY_PATH_FAILED';
} catch (error) {
  report.failure = error instanceof Error && /^[A-Z_]{1,80}$/.test(error.message) ? error.message : 'BOUNDARY_PROBE_FAILED';
} finally {
  await browser?.close().catch(() => undefined);
  await mkdir('DiagnosticsLocal', { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
}
