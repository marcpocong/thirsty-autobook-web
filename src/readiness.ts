import type { Page } from 'playwright';
import { assertDiagnosticSchedule } from './diagnostic-schedule.js';
import { inspectLockPage } from './lock-browser.js';
import { Safety } from './safety.js';
import { ONDA_URL, VENUE } from './config.js';

export async function readScheduleReadiness(page: Page) {
  const state = await inspectLockPage(page);
  let clean = false;
  try { await assertDiagnosticSchedule(page, new Safety()); clean = true; } catch {}
  return { exactTab: page.url() === ONDA_URL ? 'VERIFIED' : 'NOT VERIFIED',
    venue: (await page.getByTestId('public-booking-hero-title').textContent())?.trim() === VENUE ? 'VERIFIED' : 'NOT VERIFIED',
    schedule: clean ? 'CLEAN' : 'NOT CLEAN',
    allCourts: (await page.getByTestId('booking-court-filter-label').textContent())?.trim() === 'All Courts' ? 'YES' : 'NO',
    selectedSlots: state.selected ?? 'UNKNOWN', paymentHold: state.hold === 'Not detected' ? 'NONE' : state.hold === 'Active' ? 'ACTIVE' : 'UNKNOWN' };
}
