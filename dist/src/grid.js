import { DateTime } from 'luxon';
export const selectors = {
    row: '[data-schedule-grid-row-date][data-schedule-grid-row-time]',
    cell: '[data-testid="court-schedule-slot-cell"]',
    grid: '[data-testid="booking-grid-body"]',
    heading: '[data-testid="booking-selected-date-label"]',
};
export function parseCell(raw) {
    const match = /^Court ([1-7]): Mango Wing (\d{1,2}) (AM|PM) to (\d{1,2}) (AM|PM) (available|unavailable|selected)$/.exec(raw.label);
    let state = 'UNKNOWN';
    if (match) {
        const start = Number(match[2]) % 12 + (match[3] === 'PM' ? 12 : 0);
        const end = Number(match[4]) % 12 + (match[5] === 'PM' ? 12 : 0);
        if (`${String(start).padStart(2, '0')}:00` === raw.hour && (start + 1) % 24 === end && Number(match[2]) >= 1 && Number(match[2]) <= 12 && Number(match[4]) >= 1 && Number(match[4]) <= 12) {
            if (raw.state === 'available' && match[6] === 'available' && !raw.disabled)
                state = 'OPEN';
            if (raw.state === 'unavailable' && match[6] === 'unavailable' && raw.disabled)
                state = 'TAKEN';
            if (raw.state === 'selected' && match[6] === 'selected' && !raw.disabled)
                state = 'SELECTED';
        }
    }
    return { court: match ? Number(match[1]) : 0, hour: raw.hour, date: raw.date, label: raw.label, state };
}
// Single browser round trip and one traversal of rendered rows/cells.
export async function snapshot(page) {
    return page.evaluate(s => {
        const grids = document.querySelectorAll(s.grid);
        const headings = document.querySelectorAll(s.heading);
        if (grids.length !== 1 || headings.length !== 1)
            throw new Error('AMBIGUOUS_GRID');
        const grid = grids[0];
        const rows = [...grid.querySelectorAll(s.row)];
        return {
            heading: headings[0].textContent?.trim() ?? '',
            busy: !!document.querySelector('[aria-busy="true"]'),
            rows: rows.map(r => ({ date: r.getAttribute('data-schedule-grid-row-date') ?? '', hour: r.getAttribute('data-schedule-grid-row-time') ?? '' })),
            cells: rows.flatMap(r => [...r.querySelectorAll(s.cell)].map(e => ({
                date: r.getAttribute('data-schedule-grid-row-date') ?? '', hour: r.getAttribute('data-schedule-grid-row-time') ?? '',
                label: e.getAttribute('aria-label') ?? '', state: e.querySelector('[data-slot-state]')?.getAttribute('data-slot-state') ?? null,
                disabled: e.disabled || e.getAttribute('aria-disabled') === 'true',
            }))),
        };
    }, selectors);
}
export function validateSnapshot(s, targetDate) {
    const date = DateTime.fromISO(targetDate, { zone: 'Asia/Manila' });
    if (!date.isValid || date.toISODate() !== targetDate)
        throw new Error('INVALID_TARGET_DATE');
    if (s.busy || s.heading !== date.setLocale('en').toFormat('ccc, LLLL d') || s.rows.length !== 16 || new Set(s.rows.map(r => r.hour)).size !== 16 || s.rows.some(r => r.date !== targetDate))
        throw new Error('STALE_OR_INCOMPLETE_GRID');
    const cells = s.cells.map(parseCell);
    if (cells.length !== 112 || new Set(cells.map(c => `${c.court}/${c.hour}`)).size !== 112 || cells.some(c => c.date !== targetDate || c.court < 1))
        throw new Error('GRID_STRUCTURE_CHANGED');
    for (let h = 8; h < 24; h++)
        for (let court = 1; court <= 7; court++)
            if (!cells.some(c => c.court === court && c.hour === `${h.toString().padStart(2, '0')}:00`))
                throw new Error('GRID_STRUCTURE_CHANGED');
    return cells;
}
export function resolvePreference(cells, preferences) {
    const map = new Map(cells.map(c => [`${c.court}/${c.hour}`, c.state]));
    return preferences.find(p => p.hours.every(h => map.get(`${p.court}/${h}`) === 'OPEN'));
}
export async function waitForGrid(page, targetDate, safety, timeout = 15000, label = DateTime.fromISO(targetDate).setLocale('en').toFormat('ccc, LLLL d')) {
    safety.check();
    await page.waitForFunction(({ s, targetDate, label }) => {
        const grids = document.querySelectorAll(s.grid);
        const rows = [...(grids[0]?.querySelectorAll(s.row) ?? [])];
        return grids.length === 1 && document.querySelector(s.heading)?.textContent?.trim() === label && !document.querySelector('[aria-busy="true"]') && rows.length === 16 && rows.every(r => r.getAttribute('data-schedule-grid-row-date') === targetDate && r.querySelectorAll(s.cell).length === 7);
    }, { s: selectors, targetDate, label }, { timeout, polling: 'raf' });
    safety.check();
}
export async function navigateDate(page, date, safety) {
    safety.check();
    const target = DateTime.fromISO(date);
    if (!target.isValid || target.toISODate() !== date)
        throw new Error('INVALID_TARGET_DATE');
    const picker = page.getByRole('button', { name: 'Select booking date', exact: true });
    if (await picker.getAttribute('aria-expanded') !== 'true') {
        safety.check();
        await picker.click();
    }
    const day = page.locator(`button[data-day="${target.toFormat('M/d/yyyy')}"]`);
    if (await day.count() !== 1 || !await day.isEnabled())
        throw new Error('TARGET_DATE_UNAVAILABLE');
    safety.check();
    await day.click();
    await waitForGrid(page, date, safety);
    // Observed: selecting an already displayed day can leave the calendar expanded.
    if (await picker.getAttribute('aria-expanded') === 'true') {
        safety.check();
        await picker.click();
    }
    safety.check();
}
//# sourceMappingURL=grid.js.map