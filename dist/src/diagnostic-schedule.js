import { assertPage } from './browser.js';
import { inspectLockPage } from './lock-browser.js';
// Reuse the lock review's fail-closed schedule/selection/payment sentinels.
export async function assertDiagnosticSchedule(page, safety) {
    const browser = page.context().browser();
    const ondaPages = browser?.contexts().flatMap(context => context.pages()).filter(candidate => {
        try {
            const host = new URL(candidate.url()).hostname;
            return host === 'onda.fit' || host.endsWith('.onda.fit');
        }
        catch {
            return false;
        }
    });
    if (!ondaPages || ondaPages.length !== 1 || ondaPages[0] !== page)
        throw Error('ONDA_TAB_AMBIGUOUS_OR_MISSING');
    await assertPage(page, safety);
    const state = await inspectLockPage(page);
    if (!state.clean || state.page !== 'Schedule' || state.selected !== 0 || state.hold !== 'Not detected') {
        throw Error('DIAGNOSTIC_SCHEDULE_NOT_CLEAN');
    }
    if (!await page.evaluate(() => document.visibilityState === 'visible'))
        throw Error('TAB_NOT_VISIBLE');
    safety.check();
}
//# sourceMappingURL=diagnostic-schedule.js.map