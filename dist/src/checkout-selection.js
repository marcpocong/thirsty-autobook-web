import { expandHours } from './config.js';
import { validateSnapshot } from './grid.js';
import { selectionAmount } from './selection.js';
export async function selectCheckoutBundle(port, date, grid, chunk, maximum, safety, dispatched, t) {
    t?.mark('selectionInitialGridValidationStarted');
    const courts = chunk.courts;
    const read = (g) => { const cells = validateSnapshot(g, date); if (cells.some(c => c.state === 'UNKNOWN'))
        throw Error('SELECTION_STATE_UNKNOWN'); return cells; };
    try {
        if (!courts || courts.length !== chunk.requiredCourtCount || new Set(courts).size !== courts.length || courts.some(c => !Number.isInteger(c) || c < 1 || c > 7) || chunk.duration > 3 || JSON.stringify(expandHours(chunk.start, chunk.duration)) !== JSON.stringify(chunk.hours))
            throw Error('INVALID_CHECKOUT_BUNDLE');
        if (read(grid).some(c => c.state === 'SELECTED'))
            throw Error('PREEXISTING_SELECTION');
    }
    catch (error) {
        t?.recordSelectionFailure('INITIAL_GRID_VALIDATION', error);
        throw error;
    }
    t?.mark('selectionInitialGridValidationCompleted');
    t?.mark('fullGuardStarted');
    try {
        await port.guard();
        safety.check();
    }
    catch (error) {
        t?.recordSelectionFailure('FULL_BROWSER_GUARD', error);
        throw error;
    }
    t?.mark('fullGuardCompleted');
    t?.mark('selectionPreparationStarted');
    try {
        await safety.stage('SELECTION');
        safety.check();
    }
    catch (error) {
        t?.recordSelectionFailure('SELECTION_PREPARATION', error);
        throw error;
    }
    t?.mark('selectionPreparationCompleted');
    t?.mark('selectionAttemptStarted', 1);
    let slot = 0;
    for (const court of courts)
        for (const hour of chunk.hours) {
            if (slot === 0)
                t?.mark('firstClickGuardStarted');
            try {
                await (port.lightGuard?.() ?? Promise.resolve());
                safety.check();
            }
            catch (error) {
                if (slot === 0)
                    t?.recordSelectionFailure('FIRST_CLICK_GUARD', error);
                throw error;
            }
            t?.mark('lightGuardCompleted');
            if (slot === 0) {
                t?.mark('firstClickGuardCompleted');
                t?.mark('firstSlotClickDispatchStarted');
            }
            dispatched.add(`${date}/${court}/${hour}`);
            t?.mark(`slot${++slot}ClickStarted`);
            try {
                await port.click(date, court, hour, 'OPEN');
                t?.mark(`slot${slot}StateConfirmed`);
            }
            catch {
                safety.check();
                t?.mark('selectionFullGridRead');
                const authoritative = read(await port.read()).filter(c => c.state === 'SELECTED');
                if (authoritative.some(c => !dispatched.has(`${date}/${c.court}/${c.hour}`)))
                    throw Error('UNOWNED_SELECTION');
                throw Error('SELECTION_CONFLICT');
            }
        }
    await port.guard();
    t?.mark('fullGuardCompleted');
    safety.check();
    t?.mark('selectionFinalVerificationStarted');
    t?.mark('selectionFinalGridRead');
    t?.mark('selectionFullGridRead');
    const selected = read(await port.read()).filter(c => c.state === 'SELECTED');
    if (selected.some(c => !dispatched.has(`${date}/${c.court}/${c.hour}`)))
        throw Error('UNOWNED_SELECTION');
    if (selected.length !== courts.length * chunk.duration)
        throw Error('SELECTION_CONFLICT');
    t?.mark('selectionSummaryRead');
    const summary = await port.summary();
    safety.check();
    t?.mark('selectionSummaryVerified');
    const amount = selectionAmount(summary, selected.length, maximum * courts.length, courts.length);
    if (!summary.actionable)
        throw Error('SELECTION_CONFLICT');
    safety.lock();
    await safety.stage('SELECTION_VERIFIED');
    t?.mark('selectionFinalVerificationCompleted');
    t?.mark('selectionVerified');
    t?.mark('proceedActionable');
    return { date, court: courts[0], hours: chunk.hours, groups: courts.map(court => ({ court, hours: [...chunk.hours] })), amount, totalAmount: amount, proceedReady: true, attempts: 1 };
}
//# sourceMappingURL=checkout-selection.js.map