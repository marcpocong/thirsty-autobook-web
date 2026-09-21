export class SlotProofError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = 'SlotProofError';
    }
}
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const identityFields = ['spaceId', 'date', 'startTime', 'endTime'];
function fail(code) {
    throw new SlotProofError(code);
}
function validateIdentity(raw, expected) {
    for (const field of identityFields) {
        if (Object.hasOwn(raw, field) && raw[field] !== expected[field])
            fail('AVAILABILITY_PROOF_SLOT_MISMATCH');
    }
}
function validateClock(clock) {
    const value = clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
        fail('SLOT_PROOF_CLOCK_INVALID');
    return value;
}
/**
 * Acquire one new proof for every exact hourly item. The response schema observed
 * from Onda is intentionally small; optional identity fields are checked when a
 * server or fixture supplies them, never inferred when absent.
 */
export async function acquireFreshSlotProofs(hours, options) {
    if (!hours.length || !nonempty(options.clientId) || !nonempty(options.facilityId))
        fail('SLOT_PROOF_REQUEST_INVALID');
    const maximumAgeMs = options.maximumAgeMs ?? 15_000;
    const concurrency = options.concurrency ?? 2;
    if (!Number.isInteger(maximumAgeMs) || maximumAgeMs <= 0 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
        fail('SLOT_PROOF_OPTIONS_INVALID');
    const keys = new Set();
    for (const hour of hours) {
        if (!nonempty(hour.spaceId) || !/^\d{4}-\d{2}-\d{2}$/.test(hour.date) ||
            !/^([01]\d|2[0-3]):00$/.test(hour.startTime) || !/^(00|0[1-9]|1\d|2[0-4]):00$/.test(hour.endTime))
            fail('SLOT_PROOF_REQUEST_INVALID');
        const key = JSON.stringify([hour.spaceId, hour.date, hour.startTime, hour.endTime]);
        if (!keys.add(key))
            fail('SLOT_PROOF_DUPLICATE_ITEM');
    }
    const clock = options.clock ?? (() => new Date());
    const results = Array.from({ length: hours.length });
    let next = 0;
    const worker = async () => {
        while (true) {
            const index = next++;
            if (index >= hours.length)
                return;
            const hour = hours[index];
            const requestedAt = validateClock(clock);
            let raw;
            try {
                raw = await options.transport.checkSlot({ ...hour, clientId: options.clientId, facilityId: options.facilityId });
            }
            catch {
                fail('AVAILABILITY_PROOF_REQUEST_FAILED');
            }
            const receivedAt = validateClock(clock);
            const response = object(raw);
            if (response?.success !== true || !nonempty(response.availabilityProof) || /^<.*>$/.test(response.availabilityProof))
                fail(response?.success === false && (response.available === false || response.isAvailable === false) ? 'SLOT_UNAVAILABLE' : 'AVAILABILITY_PROOF_INVALID');
            validateIdentity(response, hour);
            const age = validateClock(clock).getTime() - receivedAt.getTime();
            if (age < 0 || age > maximumAgeMs)
                fail('AVAILABILITY_PROOF_STALE');
            results[index] = { ...hour, availabilityProof: response.availabilityProof,
                requestedAt: requestedAt.toISOString(), receivedAt: receivedAt.toISOString() };
        }
    };
    try {
        await Promise.all(Array.from({ length: Math.min(concurrency, hours.length) }, () => worker()));
    }
    catch (error) {
        if (error instanceof SlotProofError)
            throw error;
        fail('AVAILABILITY_PROOF_REQUEST_FAILED');
    }
    const proofs = results;
    if (proofs.length !== hours.length || proofs.some(proof => !proof))
        fail('AVAILABILITY_PROOF_MISSING');
    if (new Set(proofs.map(proof => proof.availabilityProof)).size !== proofs.length)
        fail('AVAILABILITY_PROOF_DUPLICATE');
    return proofs;
}
//# sourceMappingURL=slot-proofs.js.map