import { z } from 'zod';
import { isOndaUnreleasedEmptyResponse } from '../onda-unreleased.js';
export const COURT_TO_SPACE_ID = Object.freeze({
    1: 'c8c8fb0a-518e-4838-b006-8f200e477788',
    2: 'df1a98c3-deb2-4721-949a-d5a1e54fdce0',
    3: '0e853a91-33b6-4de2-9237-778007a9313b',
    4: '2166184c-db40-4a04-9a80-656878f7327b',
    5: '1cdcd209-71ce-4a72-a2f6-9252c4d06a01',
    6: '7aa7d361-9e60-433f-85ed-9e8eeaef8f96',
    7: '648d72bb-0789-40c6-9557-66709da121ba',
});
const SPACE_TO_COURT = new Map(Object.entries(COURT_TO_SPACE_ID).map(([court, id]) => [id, Number(court)]));
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const TimeSchema = z.string().regex(/^(0[8-9]|1\d|2[0-3]):00$/);
const SegmentSchema = z.object({
    startMinute: z.number().int().min(0).max(1380),
    endMinute: z.number().int().min(0).max(1380),
    billedMinutes: z.number().int().positive(),
    unitPrice: z.number().finite().nonnegative(),
    amount: z.number().finite().nonnegative(),
}).passthrough();
const PricingSchema = z.object({
    currency: z.string().min(1),
    amount: z.number().finite().nonnegative(),
    serviceDate: DateSchema.optional(),
    durationMinutes: z.number().int().positive().optional(),
    segments: z.array(SegmentSchema).min(1).optional(),
}).passthrough();
const SlotSchema = z.object({
    date: DateSchema,
    bookingDate: DateSchema,
    startTime: TimeSchema,
    endTime: z.string().regex(/^(00|0[9]|1\d|2[0-4]):00$/),
    isAvailable: z.boolean(),
    isNightRate: z.boolean().optional().default(false),
    isNextDay: z.boolean().optional().default(false),
    pricing: PricingSchema,
}).passthrough();
const ResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        dates: z.record(DateSchema, z.boolean()),
        slotsBySpace: z.record(z.string().uuid(), z.array(z.unknown())),
    }).passthrough(),
}).passthrough();
export class AvailabilityValidationError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = 'AvailabilityValidationError';
    }
}
function fail(code) {
    throw new AvailabilityValidationError(code);
}
function dateRange(startDate, endDate) {
    if (!DateSchema.safeParse(startDate).success || !DateSchema.safeParse(endDate).success)
        fail('AVAILABILITY_DATE_INVALID');
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start)
        fail('AVAILABILITY_RANGE_INVALID');
    const dates = [];
    for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 86_400_000)
        dates.push(new Date(cursor).toISOString().slice(0, 10));
    return dates;
}
function expectedEnd(startTime) {
    const hour = Number(startTime.slice(0, 2)) + 1;
    return hour === 24 ? '00:00' : `${String(hour).padStart(2, '0')}:00`;
}
function minor(value) {
    const rounded = Math.round(value * 100);
    if (!Number.isFinite(value) || Math.abs(rounded - value * 100) > 1e-7)
        fail('AVAILABILITY_PRICING_CONFLICT');
    return rounded;
}
export function parseAvailability(raw, options) {
    const parsed = ResponseSchema.safeParse(raw);
    if (!parsed.success)
        fail('AVAILABILITY_RESPONSE_INVALID');
    const requestedDates = dateRange(options.startDate, options.endDate);
    const capturedAt = new Date(options.capturedAt);
    if (!Number.isFinite(capturedAt.getTime()))
        fail('AVAILABILITY_CAPTURE_TIME_INVALID');
    if (!Number.isFinite(options.now.getTime()) || !Number.isFinite(options.maximumAgeMs) || options.maximumAgeMs < 0)
        fail('AVAILABILITY_FRESHNESS_OPTIONS_INVALID');
    const age = options.now.getTime() - capturedAt.getTime();
    if (age < 0 || age > options.maximumAgeMs)
        fail('AVAILABILITY_SNAPSHOT_STALE');
    const returnedDates = parsed.data.data.dates;
    const incompleteDates = requestedDates.filter(date => !Object.hasOwn(returnedDates, date));
    if (options.requireCompleteRange !== false && incompleteDates.length)
        fail('AVAILABILITY_DATE_RANGE_INCOMPLETE');
    if (Object.keys(returnedDates).some(date => !requestedDates.includes(date)))
        fail('AVAILABILITY_UNREQUESTED_DATE');
    const slots = [];
    const seen = new Map();
    for (const [spaceId, rawSlots] of Object.entries(parsed.data.data.slotsBySpace)) {
        const court = SPACE_TO_COURT.get(spaceId);
        if (!court)
            fail('AVAILABILITY_UNKNOWN_COURT');
        for (const rawSlot of rawSlots) {
            const result = SlotSchema.safeParse(rawSlot);
            if (!result.success)
                fail('AVAILABILITY_SLOT_INVALID');
            const slot = result.data;
            if (!requestedDates.includes(slot.date) || slot.bookingDate !== slot.date || !Object.hasOwn(returnedDates, slot.date))
                fail('AVAILABILITY_SLOT_DATE_CONFLICT');
            const normalizedEnd = slot.endTime === '24:00' ? '00:00' : slot.endTime;
            if (normalizedEnd !== expectedEnd(slot.startTime))
                fail('AVAILABILITY_SLOT_BOUNDARY_INVALID');
            if (slot.pricing.serviceDate !== undefined && slot.pricing.serviceDate !== slot.date)
                fail('AVAILABILITY_PRICING_DATE_CONFLICT');
            if (slot.pricing.durationMinutes !== undefined && slot.pricing.durationMinutes !== 60)
                fail('AVAILABILITY_PRICING_DURATION_CONFLICT');
            if (slot.pricing.segments) {
                const amount = slot.pricing.segments.reduce((sum, segment) => sum + minor(segment.amount), 0);
                if (amount !== minor(slot.pricing.amount) || slot.pricing.segments.reduce((sum, segment) => sum + segment.billedMinutes, 0) !== 60)
                    fail('AVAILABILITY_PRICING_CONFLICT');
                const startMinute = Number(slot.startTime.slice(0, 2)) * 60;
                const endMinute = normalizedEnd === '00:00' ? 0 : Number(normalizedEnd.slice(0, 2)) * 60;
                if (slot.pricing.segments[0].startMinute !== startMinute || slot.pricing.segments.at(-1).endMinute !== endMinute)
                    fail('AVAILABILITY_PRICING_CONFLICT');
                for (const [index, segment] of slot.pricing.segments.entries()) {
                    const expectedAmount = segment.unitPrice * segment.billedMinutes / 60;
                    const boundaryMinutes = (segment.endMinute - segment.startMinute + 1440) % 1440;
                    if (minor(segment.amount) !== Math.round(expectedAmount * 100) || boundaryMinutes !== segment.billedMinutes)
                        fail('AVAILABILITY_PRICING_CONFLICT');
                    if (index > 0 && slot.pricing.segments[index - 1].endMinute !== segment.startMinute)
                        fail('AVAILABILITY_PRICING_CONFLICT');
                }
            }
            minor(slot.pricing.amount);
            const normalized = {
                court, spaceId, date: slot.date, bookingDate: slot.bookingDate, startTime: slot.startTime,
                endTime: normalizedEnd, isAvailable: slot.isAvailable, isNightRate: slot.isNightRate,
                isNextDay: slot.isNextDay, currency: slot.pricing.currency, price: slot.pricing.amount,
            };
            const key = `${court}/${slot.date}/${slot.startTime}`;
            const prior = seen.get(key);
            if (prior)
                fail(JSON.stringify(prior) === JSON.stringify(normalized) ? 'AVAILABILITY_SLOT_DUPLICATE' : 'AVAILABILITY_SLOT_CONFLICT');
            if (!returnedDates[slot.date] && slot.isAvailable)
                fail('AVAILABILITY_DATE_FLAG_CONFLICT');
            seen.set(key, normalized);
            slots.push(normalized);
        }
    }
    // Missing slots are unavailable; the captured response does not establish a completeness contract.
    return { capturedAt: options.capturedAt, fixtureKind: options.fixtureKind, label: options.label, requestedDates, returnedDates, incompleteDates, slots,
        emptyUnreleasedResponse: isOndaUnreleasedEmptyResponse(raw) };
}
//# sourceMappingURL=availability-parser.js.map