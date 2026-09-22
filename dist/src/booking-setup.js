const hourPattern = /^(0[89]|1[0-9]|2[0-3]):00$/;
export function reconcileFallbackTimes(primaryStart, duration, fallbackTimes) {
    const valid = [];
    const removed = [];
    const seen = new Set();
    for (const time of fallbackTimes) {
        let reason;
        if (!hourPattern.test(time))
            reason = 'INVALID_FORMAT';
        else if (time === primaryStart)
            reason = 'DUPLICATES_PRIMARY_START';
        else if (seen.has(time))
            reason = 'DUPLICATE_FALLBACK';
        else {
            seen.add(time);
            if (!Number.isInteger(duration) || Number(time.slice(0, 2)) + duration > 24)
                reason = 'CROSSES_MIDNIGHT';
        }
        if (reason)
            removed.push({ time, reason });
        else
            valid.push(time);
    }
    return { valid, removed };
}
export function reconcileBookingSetupFallbacks(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return { setup: input, reconciliation: { valid: [], removed: [] } };
    const setup = input;
    if (typeof setup.START_TIME !== 'string' || typeof setup.DURATION_HOURS !== 'number' || !Array.isArray(setup.FALLBACK_TIMES)) {
        return { setup: input, reconciliation: { valid: [], removed: [] } };
    }
    const times = setup.FALLBACK_TIMES;
    if (!times.every((time) => typeof time === 'string'))
        return { setup: input, reconciliation: { valid: [], removed: [] } };
    const reconciliation = reconcileFallbackTimes(setup.START_TIME, setup.DURATION_HOURS, times);
    const { MAX_PRICE: _legacyPriceLimit, ...withoutPriceLimit } = setup;
    return { setup: { ...withoutPriceLimit, FALLBACK_TIMES: reconciliation.valid }, reconciliation };
}
export function bookingSetupProblem(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return 'The booking settings could not be read.';
    const setup = input;
    if (setup.SESSION_MODE !== undefined && setup.SESSION_MODE !== 'normal' && setup.SESSION_MODE !== 'special-friday')
        return 'Choose a valid session type.';
    if (setup.SESSION_MODE === 'special-friday' && (setup.BOOKING_METHOD !== 'api-first' || setup.BOOKING_TYPE !== 'extended' || setup.COURT_COUNT !== 4 ||
        setup.START_TIME !== '17:00' || setup.DURATION_HOURS !== 5 || setup.FALLBACK_TIMES?.length))
        return 'Special Friday session settings must remain fixed.';
    if (setup.BOOKING_METHOD !== 'browser' && setup.BOOKING_METHOD !== 'hybrid' && setup.BOOKING_METHOD !== 'api-first')
        return 'Choose a valid booking method.';
    if (setup.BOOKING_TYPE !== 'standard' && setup.BOOKING_TYPE !== 'extended')
        return 'Choose a valid booking type.';
    if (![1, 2, 3, 4, 5, 6, 7].includes(setup.COURT_COUNT))
        return 'Choose between one and seven courts.';
    if ((setup.COURT_COUNT ?? 0) > 2 && setup.BOOKING_METHOD !== 'api-first')
        return 'Three to seven courts require API-FIRST.';
    if (typeof setup.START_TIME !== 'string' || !hourPattern.test(setup.START_TIME))
        return 'Choose a valid main start time.';
    if (typeof setup.DURATION_HOURS !== 'number' || !Number.isInteger(setup.DURATION_HOURS) || setup.DURATION_HOURS < 1 || setup.DURATION_HOURS > 6)
        return 'Enter a booking duration from 1 to 6 hours.';
    if (setup.BOOKING_TYPE === 'standard' && setup.DURATION_HOURS > 3)
        return 'Standard bookings must be 1–3 hours.';
    if (setup.BOOKING_TYPE === 'extended' && setup.DURATION_HOURS < 4)
        return 'Extended bookings must be 4–6 hours.';
    if (Number(setup.START_TIME.slice(0, 2)) + setup.DURATION_HOURS > 24)
        return 'The main booking would end after midnight.';
    if (!Array.isArray(setup.PREFERRED_COURTS) || setup.PREFERRED_COURTS.length !== 7 || new Set(setup.PREFERRED_COURTS).size !== 7 || setup.PREFERRED_COURTS.some(court => !Number.isInteger(court) || court < 1 || court > 7))
        return 'Court priority is invalid.';
    if (typeof setup.MAX_SELECTION_ATTEMPTS !== 'number' || !Number.isInteger(setup.MAX_SELECTION_ATTEMPTS) || setup.MAX_SELECTION_ATTEMPTS < 1 || setup.MAX_SELECTION_ATTEMPTS > 5)
        return 'Attempt count must be from 1 to 5.';
    if (!Array.isArray(setup.FALLBACK_TIMES) || !setup.FALLBACK_TIMES.every((time) => typeof time === 'string'))
        return 'Fallback starts are invalid.';
    const reconciliation = reconcileFallbackTimes(setup.START_TIME, setup.DURATION_HOURS, setup.FALLBACK_TIMES);
    const first = reconciliation.removed[0];
    if (!first)
        return undefined;
    if (first.reason === 'DUPLICATES_PRIMARY_START')
        return `Fallback ${friendlyTime(first.time)} duplicates the main start.`;
    if (first.reason === 'DUPLICATE_FALLBACK')
        return `Fallback ${friendlyTime(first.time)} appears more than once.`;
    if (first.reason === 'CROSSES_MIDNIGHT')
        return `Fallback ${friendlyTime(first.time)} is not valid for a ${setup.DURATION_HOURS}-hour booking.`;
    return 'A fallback start has an invalid time format.';
}
export function friendlyTime(time) {
    if (!hourPattern.test(time))
        return time;
    const hour = Number(time.slice(0, 2));
    return `${hour % 12 || 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
}
//# sourceMappingURL=booking-setup.js.map