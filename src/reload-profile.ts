import type { Page } from 'playwright';
import { DateTime } from 'luxon';
import { assertDiagnosticSchedule } from './diagnostic-schedule.js';
import { waitForBookingShellForRelease } from './release-navigation.js';
import type { Safety } from './safety.js';
import type { Telemetry } from './telemetry.js';

export function assertReloadProfileTime(now: DateTime = DateTime.now()) {
  const local = now.setZone('Asia/Manila');
  const seconds = local.hour * 3600 + local.minute * 60 + local.second;
  if (!local.isValid || (seconds >= 7 * 3600 + 55 * 60 && seconds <= 8 * 3600 + 5 * 60)) {
    throw Error('RELOAD_PROFILE_UNSAFE_TIME');
  }
}

export function reloadProfileReport(events: readonly { event: string; monoMs: number }[]) {
  const at = (name: string) => events.find(e => e.event === name)?.monoMs;
  const elapsed = (start: string, end: string) => {
    const a = at(start), b = at(end);
    return a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
  };
  const shell = elapsed('reloadCommitted', 'profileShellReady');
  return {
    reloadStartToCommitMs: elapsed('reloadStarted', 'reloadCommitted'),
    commitToVenueAttachedMs: elapsed('reloadCommitted', 'profileVenueAttached'),
    commitToVenueVisibleMs: elapsed('reloadCommitted', 'profileVenueVisible'),
    commitToPickerAttachedMs: elapsed('reloadCommitted', 'profilePickerAttached'),
    commitToPickerVisibleMs: elapsed('reloadCommitted', 'profilePickerVisible'),
    commitToPickerEnabledMs: elapsed('reloadCommitted', 'profilePickerEnabled'),
    commitToShellReadyMs: shell,
    reloadStartToShellMs: elapsed('reloadStarted', 'profileShellReady'),
    classification: shell === null ? 'NOT MEASURED' : shell < 1500 ? 'FAST' : shell < 4000 ? 'MODERATE' : shell <= 10000 ? 'SLOW' : 'EXTREME',
  };
}

export function formatReloadProfile(report: ReturnType<typeof reloadProfileReport>) {
  return ['RELOAD PROFILE', ...Object.entries(report).map(([key, value]) =>
    `${key}: ${value === null ? 'NOT MEASURED' : typeof value === 'number' ? `${value.toFixed(1)} ms` : value}`)].join('\n');
}

// CLI owns the exclusive automation lock and verifies dedicated local CDP before entry.
// No calendar/slot/Proceed actions, warm-up, retry, or resource interception.
export async function profileReload(page: Page, safety: Safety, t: Telemetry, timeout = 60000) {
  assertReloadProfileTime();
  t.mark('reloadProfileStarted');
  await assertDiagnosticSchedule(page, safety);
  const picker = page.getByRole('button', { name: 'Select booking date', exact: true, includeHidden: true });
  if (await picker.count() !== 1 || await picker.getAttribute('aria-expanded') !== 'false') throw Error('PROFILE_PICKER_NOT_CLOSED');
  assertReloadProfileTime();
  safety.check(); t.mark('reloadStarted');
  await page.reload({ waitUntil: 'commit', timeout });
  t.mark('reloadCommitted');
  await waitForBookingShellForRelease(page, safety, timeout, {
    mark: (event, value) => t.mark(event.replace(/^release/, 'profile'), value),
    recordReleaseFailure: (stage,code,classification,httpStatus) => t.recordReleaseFailure(stage,code,classification,httpStatus),
  });
  // Post-readiness safety verification is deliberately excluded from shell timing.
  await assertDiagnosticSchedule(page, safety);
  t.mark('reloadProfileCompleted');
  return reloadProfileReport(t.events);
}
