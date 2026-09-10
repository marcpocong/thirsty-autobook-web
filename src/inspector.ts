import type { Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { snapshot, validateSnapshot, parseCell } from './grid.js';
import { DateTime } from 'luxon';
import { emitUiEvent } from './ui-events.js';
// Deliberately omit arbitrary text, values, links, style, script and account containers.
export async function inspect(page: Page) {
  const structure = await page.evaluate(() => {
    const safeText = /^(Thirsty Pickle \| SM Seaside|Court Schedule|All Courts|Proceed|Review Booking|Player Information|Full Name|Phone Number|Email Address|Payment Summary|Terms and Conditions|Confirm & Proceed to Payment|Court [1-7]: Mango Wing|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Za-z]+ \d{1,2}|Court [1-7]: Mango Wing \d{1,2} (?:AM|PM) to \d{1,2} (?:AM|PM) (?:available|unavailable|selected)|Previous day|Next day|Select booking date)$/;
    return [...document.querySelectorAll('button,input,label,[data-testid],[data-schedule-grid-row-date]')].map(e => ({
      tag: e.tagName.toLowerCase(),
      // IDs/classes may contain identifiers: redact anything outside simple CSS tokens.
      id: /^[a-zA-Z][a-zA-Z0-9_-]{0,80}$/.test(e.id) ? e.id : undefined,
      role: e.getAttribute('role'),
      name: safeText.test(e.getAttribute('aria-label') ?? '') ? e.getAttribute('aria-label') : undefined,
      text: safeText.test(e.textContent?.trim() ?? '') ? e.textContent?.trim() : undefined,
      testid: /^[a-z-]{1,80}$/.test(e.getAttribute('data-testid') ?? '') ? e.getAttribute('data-testid') : undefined,
      disabled: e.hasAttribute('disabled'),
      ariaDisabled: e.getAttribute('aria-disabled'), ariaSelected: e.getAttribute('aria-selected'),
      ariaExpanded: e.getAttribute('aria-expanded'),
      rowDate: /^\d{4}-\d{2}-\d{2}$/.test(e.getAttribute('data-schedule-grid-row-date') ?? '') ? e.getAttribute('data-schedule-grid-row-date') : undefined,
      rowTime: /^\d{2}:\d{2}$/.test(e.getAttribute('data-schedule-grid-row-time') ?? '') ? e.getAttribute('data-schedule-grid-row-time') : undefined,
    }));
  });
  await mkdir('DiagnosticsLocal', { recursive: true });
  const file = `DiagnosticsLocal/inspection-${Date.now()}.json`;
  await writeFile(file, JSON.stringify({ observedAt: new Date().toISOString(), page: 'Thirsty Pickle booking', structure }, null, 2));
  // Availability details are public court/time labels; omit raw titles and body text.
  const s = await snapshot(page);
  console.log(JSON.stringify({ file, date: s.rows[0]?.date, rowCount: s.rows.length, cellCount: s.cells.length, busy: s.busy }, null, 2));
  if (process.env.THIRSTY_UI_EVENTS === '1') {
    let gridToday = false;
    try { validateSnapshot(s, DateTime.now().setZone('Asia/Manila').toISODate()!); gridToday = true; } catch { /* Report uncertainty; inspect remains read-only. */ }
    const cells = s.cells.map(parseCell);
    const dates = [...new Set(s.rows.map(row => row.date))];
    emitUiEvent({ type: 'inspection', date: dates.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(dates[0]!) ? dates[0]! : null,
      gridToday, selected: !s.busy && cells.length === 112 && cells.every(cell => cell.state !== 'UNKNOWN') ? cells.filter(cell => cell.state === 'SELECTED').length : null,
      allCourts: (await page.getByTestId('booking-court-filter-label').innerText()).trim() === 'All Courts',
      visible: await page.evaluate(() => document.visibilityState === 'visible'), verifiedAt: new Date().toISOString() });
  }
}
