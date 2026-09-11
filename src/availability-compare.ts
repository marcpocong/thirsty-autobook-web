import type { Page } from 'playwright';
import { assertDiagnosticSchedule } from './diagnostic-schedule.js';
import { navigateDate, snapshot, validateSnapshot } from './grid.js';
import { assertAvailabilityDate, compareAvailability } from './onda-availability.js';
import { browserAvailabilityRequest } from './availability-discovery.js';
import type { Safety } from './safety.js';
import type { Telemetry } from './telemetry.js';

export async function compareCurrentAvailability(page: Page, targetDate: string, safety: Safety, t: Telemetry) {
  assertAvailabilityDate(targetDate);
  await assertDiagnosticSchedule(page, safety);
  await navigateDate(page, targetDate, safety);
  const grid = await snapshot(page), cells = validateSnapshot(grid, targetDate);
  if (cells.some(c => c.state === 'SELECTED' || c.state === 'UNKNOWN')) throw Error('DIAGNOSTIC_SCHEDULE_NOT_CLEAN');
  const api = await browserAvailabilityRequest(page, targetDate, safety, t)();
  safety.check();
  await assertDiagnosticSchedule(page, safety);
  // A human changing the date or cells while the diagnostic waited invalidates comparison.
  if (JSON.stringify(await snapshot(page)) !== JSON.stringify(grid)) throw Error('AVAILABILITY_COMPARE_UI_CHANGED');
  if (!api) throw Error('AVAILABILITY_COMPARE_UNAVAILABLE');
  const comparison = compareAvailability(api, cells);
  t.mark('availabilityApiUiAgreed', comparison.agreed);
  t.mark('availabilityApiUiDisagreed', comparison.domOpenApiClosed + comparison.domClosedApiOpen);
  return { targetDate, requestDurationMs: t.events.find(e => e.event === 'availabilityResponseReceived')?.value ?? null,
    knownCourts: api.knownCourts, hourSlotsParsed: api.slots.length,
    availableCount: api.slots.filter(s => s.available && api.released).length,
    ...comparison, unknownSpaces: api.unknownSpaces };
}
