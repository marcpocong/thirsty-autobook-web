import type { Page } from 'playwright';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { expandHours } from './config.js';
import { assertPage } from './browser.js';
import { navigateDate, snapshot, validateSnapshot, resolvePreference, selectors } from './grid.js';
import { Safety } from './safety.js';
import { Telemetry } from './telemetry.js';
export const PracticeSchema = z.object({
  date: z.string().refine(s => DateTime.fromISO(s).isValid && DateTime.fromISO(s).toISODate() === s),
  court: z.coerce.number().int().min(1).max(7),
  start: z.string().regex(/^(0[89]|1[0-9]|2[0-3]):00$/),
  duration: z.coerce.number().int().min(1).max(16),
});
export async function practice(page: Page, input: z.infer<typeof PracticeSchema>, safety: Safety, t: Telemetry) {
  const preference = { court: input.court, hours: expandHours(input.start, input.duration) };
  await assertPage(page, safety);
  if ((await snapshot(page)).cells.some(c => c.state === 'selected')) throw new Error('PREEXISTING_SELECTION');
  await navigateDate(page, input.date, safety);
  let cells = validateSnapshot(await snapshot(page), input.date);
  if (!resolvePreference(cells, [preference])) throw new Error('PRACTICE_SLOTS_UNAVAILABLE');
  const locators = preference.hours.map(h => page.locator(`${selectors.row}[data-schedule-grid-row-date="${input.date}"][data-schedule-grid-row-time="${h}"] ${selectors.cell}[aria-label^="Court ${input.court}: Mango Wing "]`));
  for (const [i, locator] of locators.entries()) {
    await assertPage(page, safety);
    cells = validateSnapshot(await snapshot(page), input.date);
    if (cells.find(c => c.court === input.court && c.hour === preference.hours[i])?.state !== 'OPEN') throw new Error('SLOT_CHANGED_MANUAL_CLEANUP_REQUIRED');
    safety.check(); t.mark(`slot${i + 1}ClickStarted`); await locator.click(); t.mark(`slot${i + 1}Clicked`);
  }
  cells = validateSnapshot(await snapshot(page), input.date);
  const selected = cells.filter(c => c.state === 'SELECTED');
  if (selected.length !== preference.hours.length || selected.some(c => c.court !== input.court || !preference.hours.includes(c.hour))) throw new Error('SELECTION_MISMATCH_MANUAL_CLEANUP_REQUIRED');
  t.mark('practiceSelectionVerified');
  for (const locator of locators) {
    await assertPage(page, safety); safety.check();
    await locator.click();
  }
  cells = validateSnapshot(await snapshot(page), input.date);
  if (cells.some(c => c.state === 'SELECTED') || !resolvePreference(cells, [preference])) throw new Error('CLEAN_STATE_UNVERIFIED');
  t.mark('practiceCleanStateVerified');
  console.log('PRACTICE PASSED: selected, verified, deselected, clean. Proceed never clicked.');
}
