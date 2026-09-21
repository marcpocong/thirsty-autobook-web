import { DateTime } from 'luxon';
import { setTimeout as delay } from 'node:timers/promises';
import { releaseCalendarOn } from './config.js';
import { snapshot, validateSnapshot } from './grid.js';
import { releaseNavigationTarget } from './release-navigation.js';
import { assertDiagnosticSchedule } from './diagnostic-schedule.js';
export function tomorrowRelease(c, now = DateTime.now()) {
    return releaseCalendarOn(c, now.setZone(c.TIMEZONE).plus({ days: 1 }).toISODate());
}
// Diagnostic only: the sole permitted interactions are opening/closing the picker.
export async function checkPreopenStability(page, c, safety, t, pause = (ms, signal) => delay(ms, undefined, { signal }), now = DateTime.now()) {
    const target = tomorrowRelease(c, now), dayTarget = releaseNavigationTarget(target.targetDate);
    const today = releaseCalendarOn(c, now.setZone(c.TIMEZONE).toISODate());
    if (now.toMillis() < today.releaseMs || Date.now() + 65000 >= target.releaseMs)
        throw Error('PREOPEN_CHECK_OUTSIDE_SAFE_WINDOW');
    let navigated = false;
    const onNavigation = () => { navigated = true; };
    page.on('framenavigated', onNavigation);
    const picker = page.getByRole('button', { name: 'Select booking date', exact: true });
    const day = page.locator(dayTarget.daySelector);
    const readClean = async () => {
        safety.check();
        if (navigated)
            throw Error('PREOPEN_CHECK_NAVIGATED');
        await assertDiagnosticSchedule(page, safety);
        if ((await page.getByTestId('booking-court-filter-label').innerText()).trim() !== 'All Courts')
            throw Error('COURT_FILTER_NOT_ALL');
        if (!await page.evaluate(() => document.visibilityState === 'visible'))
            throw Error('TAB_NOT_VISIBLE');
        const grid = await snapshot(page);
        const cells = validateSnapshot(grid, grid.rows[0]?.date ?? '');
        if (cells.some(cell => cell.state === 'UNKNOWN'))
            throw Error('GRID_STATE_UNKNOWN');
        if (cells.some(cell => cell.state === 'SELECTED'))
            throw Error('PREEXISTING_SELECTION');
        safety.check();
        if (navigated)
            throw Error('PREOPEN_CHECK_NAVIGATED');
        return grid;
    };
    try {
        t.mark('preopenStabilityStarted');
        const original = await readClean();
        if (await picker.count() !== 1 || await picker.getAttribute('aria-expanded') === 'true')
            throw Error('PREOPEN_CHECK_PICKER_NOT_CLOSED');
        safety.check();
        await picker.click({ timeout: c.CRITICAL_STEP_TIMEOUT_MS });
        await day.waitFor({ state: 'visible', timeout: c.CRITICAL_STEP_TIMEOUT_MS });
        const verifyOpen = async () => {
            if (await picker.getAttribute('aria-expanded') !== 'true')
                throw Error('PREOPEN_CHECK_CALENDAR_CLOSED');
            if (await day.count() !== 1 || !await day.isVisible())
                throw Error('PREOPEN_CHECK_TARGET_CHANGED');
            if (await day.isEnabled())
                throw Error('PREOPEN_CHECK_TARGET_ENABLED');
            if (JSON.stringify(await readClean()) !== JSON.stringify(original))
                throw Error('PREOPEN_CHECK_BOOKING_CHANGED');
        };
        await verifyOpen();
        const started = performance.now();
        t.mark('preopenStabilitySample', 0);
        for (const elapsed of [15000, 30000, 45000, 60000]) {
            await pause(Math.max(0, started + elapsed - performance.now()), safety.signal);
            await verifyOpen();
            t.mark('preopenStabilitySample', elapsed);
        }
        const durationMs = performance.now() - started;
        safety.check();
        await picker.click({ timeout: c.CRITICAL_STEP_TIMEOUT_MS });
        if (await picker.getAttribute('aria-expanded') !== 'false' || await day.isVisible())
            throw Error('PREOPEN_CHECK_CLOSE_FAILED');
        if (JSON.stringify(await readClean()) !== JSON.stringify(original))
            throw Error('PREOPEN_CHECK_BOOKING_CHANGED');
        t.mark('preopenStabilityPassed', durationMs);
        return { observedAt: new Date().toISOString(), targetDate: target.targetDate, releaseISO: target.releaseISO,
            durationMs, preopenUiStability: 'VERIFIED', autoEnableAtRelease: 'UNVERIFIED', calendarRemainedOpen: true,
            targetRemainedRepresented: true, bookingStateUnchanged: true, selectedSlots: 0, navigated: false };
    }
    finally {
        // On failure leave the browser untouched for review; never attempt recovery clicks.
        page.off('framenavigated', onNavigation);
    }
}
//# sourceMappingURL=preopen-check.js.map