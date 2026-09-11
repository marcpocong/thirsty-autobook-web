import type { Page } from 'playwright';
import { compilePreferences, type Config } from './config.js';
import { assertDiagnosticSchedule } from './diagnostic-schedule.js';
import { navigateDate, snapshot, validateSnapshot, resolvePreference, type Cell } from './grid.js';
import { assertAvailabilityDate, compareAvailability, hybridPreferences, type AvailabilitySnapshot } from './onda-availability.js';
import { browserAvailabilityRequest } from './availability-discovery.js';
import type { Safety } from './safety.js';
import type { Telemetry } from './telemetry.js';

export function dryCandidate(date: string, cells: Cell[], api: AvailabilitySnapshot | undefined, config: Config) {
  const ranked = hybridPreferences(api, date, cells, compilePreferences(config), config.MAX_PRICE);
  const chosen = resolvePreference(cells, ranked.preferences);
  const validApi = api?.targetDate === date ? api : undefined;
  const comparison = validApi && compareAvailability(validApi, cells);
  const agreement = !!validApi && validApi.knownCourts === 7 && validApi.unknownSpaces === 0 &&
    comparison!.domOpenApiClosed === 0 && comparison!.domClosedApiOpen === 0;
  const parts = chosen?.hours.map(hour => validApi?.slots.find(s => s.court === chosen.court && s.startTime === hour));
  const estimatedApiPrice = parts?.every(s => s?.price !== undefined && s.currency === 'PHP')
    ? parts.reduce((sum, s) => sum + s!.price!, 0) : null;
  return { date, discoveryMode: 'HYBRID', candidateSource: ranked.source,
    configuredPrimaryStart: config.START_TIME, configuredDuration: config.DURATION_HOURS,
    chosen: chosen ?? null, estimatedApiPrice, uiCandidateAvailability: chosen ? 'verified' : 'unavailable',
    apiUiAgreement: agreement, pass: agreement && !!chosen && ranked.source === 'API+UI', slotClicks: 0, proceedClicks: 0 };
}
export async function dryCurrentAvailability(page: Page, date: string, config: Config, safety: Safety, t: Telemetry) {
  assertAvailabilityDate(date);
  await assertDiagnosticSchedule(page, safety);
  await navigateDate(page, date, safety);
  const grid = await snapshot(page), cells = validateSnapshot(grid, date);
  if (cells.some(c => c.state === 'SELECTED' || c.state === 'UNKNOWN')) throw Error('DIAGNOSTIC_SCHEDULE_NOT_CLEAN');
  // One bounded request; this diagnostic waits for measurement, production never waits for API.
  const api = await browserAvailabilityRequest(page, date, safety, t)();
  safety.check();
  await assertDiagnosticSchedule(page, safety);
  if (JSON.stringify(await snapshot(page)) !== JSON.stringify(grid)) throw Error('AVAILABILITY_COMPARE_UI_CHANGED');
  return { ...dryCandidate(date, cells, api, config),
    requestDurationMs: t.events.find(e => e.event === 'availabilityResponseReceived')?.value ?? null };
}
