export const OFFICIAL_CHECKOUT_HANDOFF_ENABLED = false;
export class CheckoutRestorationError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = 'CheckoutRestorationError';
    }
}
export function officialCheckoutUrl(bookingId) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(bookingId))
        throw new CheckoutRestorationError('CHECKOUT_BOOKING_ID_INVALID');
    const url = new URL('https://app.onda.fit/book/thirsty-pickle');
    url.searchParams.set('bookingId', bookingId);
    url.searchParams.set('bookingUi', 'court-v2');
    return url.toString();
}
/** Validates state reported by the official site; it does not navigate or create payment requests. */
export function validateOfficialCheckoutState(raw, expected, now) {
    const value = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
    const plan = expected.plan, first = plan.courts[0], last = plan.courts.at(-1);
    const fail = (code) => { throw new CheckoutRestorationError(code); };
    if (!value)
        fail('CHECKOUT_STATE_INVALID');
    const safeValue = value;
    const bookingIds = Array.isArray(safeValue.bookingIds) ? safeValue.bookingIds : [];
    const courtIds = Array.isArray(safeValue.courtIds) ? safeValue.courtIds : [];
    const bookingId = typeof safeValue.bookingId === 'string' ? safeValue.bookingId : '';
    const holdExpiresAt = typeof safeValue.holdExpiresAt === 'string' ? safeValue.holdExpiresAt : '';
    const totalAmount = typeof safeValue.totalAmount === 'number' ? safeValue.totalAmount : Number.NaN;
    if (safeValue.canResumeCheckout !== true || !expected.bookingIds.includes(bookingId) || bookingIds.length !== expected.bookingIds.length ||
        new Set(bookingIds).size !== expected.bookingIds.length || expected.bookingIds.some(id => !bookingIds.includes(id)) ||
        safeValue.targetDate !== plan.targetDate || courtIds.length !== plan.courts.length ||
        courtIds.some(court => typeof court !== 'number' || !plan.courts.some(item => item.court === court)) ||
        safeValue.startTime !== plan.startTime || safeValue.endTime !== plan.endTime || safeValue.paymentScreenAccessible !== true ||
        !Number.isFinite(totalAmount) || Math.round(totalAmount * 100) !== Math.round(expected.totalAmount * 100) ||
        holdExpiresAt !== expected.holdExpiresAt || !Number.isFinite(Date.parse(holdExpiresAt)) ||
        !(now instanceof Date) || !Number.isFinite(now.getTime()) || Date.parse(holdExpiresAt) <= now.getTime() || !first || !last)
        fail(safeValue.canResumeCheckout !== true ? 'CHECKOUT_CANNOT_RESUME' : 'CHECKOUT_STATE_MISMATCH');
    return { canResumeCheckout: true, bookingId, bookingIds: bookingIds, targetDate: safeValue.targetDate,
        courtIds: courtIds, startTime: safeValue.startTime, endTime: safeValue.endTime,
        totalAmount, holdExpiresAt, paymentScreenAccessible: true };
}
//# sourceMappingURL=checkout-restoration.js.map