import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rmdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
const unspentPermits = new WeakSet();
export function consumeSubmissionPermit(permit, expectedKey) {
    if (!permit || permit.key !== expectedKey || !unspentPermits.delete(permit))
        throw Error('SUBMISSION_PERMIT_INVALID_OR_USED');
}
/** Write-once, cross-process duplicate guard. Records are never automatically cleared. */
export class DurableSubmissionJournal {
    directory;
    constructor(directory) {
        this.directory = directory;
    }
    path(key) {
        if (!/^[a-f0-9]{64}$/.test(key))
            throw Error('SUBMISSION_KEY_INVALID');
        return join(resolve(this.directory), `${key}.json`);
    }
    static key(facilityId, spaceId, date, startTime, endTime) {
        return createHash('sha256').update(JSON.stringify([facilityId, spaceId, date, startTime, endTime])).digest('hex');
    }
    async begin(key, now = new Date(), attempt) {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const path = this.path(key);
        const safeAttempt = attempt ?? { attemptId: key, planFingerprint: key, targetDate: 'unknown', courtIds: [], hourlyBoundaries: [],
            expectedBookingCount: 1, maximumAmount: 0, stage: 'dispatching' };
        if (!/^[a-f0-9]{64}$/.test(safeAttempt.attemptId) || !/^[a-f0-9]{64}$/.test(safeAttempt.planFingerprint) ||
            !/^\d{4}-\d{2}-\d{2}$|^unknown$/.test(safeAttempt.targetDate) || !Array.isArray(safeAttempt.courtIds) ||
            safeAttempt.courtIds.some(court => !Number.isInteger(court) || court < 1 || court > 7) ||
            !Number.isInteger(safeAttempt.expectedBookingCount) || safeAttempt.expectedBookingCount < 1 ||
            !Number.isFinite(safeAttempt.maximumAmount) || safeAttempt.maximumAmount < 0 || safeAttempt.stage !== 'dispatching')
            throw Error('SUBMISSION_ATTEMPT_INVALID');
        let handle;
        try {
            handle = await open(path, 'wx', 0o600);
        }
        catch (error) {
            if (error.code === 'EEXIST')
                throw Error('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
            throw error;
        }
        try {
            const time = now.toISOString();
            await handle.writeFile(JSON.stringify({ key, state: 'dispatching', createdAt: time, updatedAt: time, attempt: safeAttempt }));
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
    async claimSupervisedOneShot(key, now = new Date()) {
        const intent = await this.read(key);
        if (intent.state !== 'dispatching')
            throw Error('SUBMISSION_STATE_INVALID');
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        let handle;
        try {
            handle = await open(join(resolve(this.directory), 'supervised-one-shot.json'), 'wx', 0o600);
        }
        catch (error) {
            if (error.code === 'EEXIST')
                throw Error('SUPERVISED_ONE_SHOT_ALREADY_USED');
            throw error;
        }
        try {
            await handle.writeFile(JSON.stringify({ claimedAt: now.toISOString() }));
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        const permit = Object.freeze({ key });
        unspentPermits.add(permit);
        return permit;
    }
    async mark(key, state, now = new Date(), diagnostic, observedResponse, failureCode) {
        const path = this.path(key);
        const prior = JSON.parse(await readFile(path, 'utf8'));
        if (prior.key !== key || prior.state !== 'dispatching')
            throw Error('SUBMISSION_STATE_INVALID');
        if (diagnostic && (!Number.isInteger(diagnostic.status) || diagnostic.status < 100 || diagnostic.status > 599 ||
            !['http-rejection', 'invalid-response'].includes(diagnostic.category) ||
            !['json', 'html', 'text', 'empty', 'other'].includes(diagnostic.contentKind) ||
            !['cloudflare', 'application', 'unknown'].includes(diagnostic.responseSource) ||
            !['verification', 'availability', 'customer', 'rate-limit', 'access', 'other', 'none'].includes(diagnostic.errorHint) ||
            (diagnostic.applicationCode !== undefined && !/^[A-Z][A-Z0-9_]{0,63}$/.test(diagnostic.applicationCode)) ||
            (diagnostic.cloudflareRay !== undefined && !/^[a-f0-9]{8,32}(?:-[A-Za-z0-9]{2,8})?$/.test(diagnostic.cloudflareRay))))
            throw Error('SUBMISSION_DIAGNOSTIC_INVALID');
        const safeId = (value) => /^[A-Za-z0-9_-]{1,200}$/.test(value);
        if (observedResponse && (typeof observedResponse.success !== 'boolean' ||
            ![observedResponse.bookingIds, observedResponse.bookingNumbers, observedResponse.bookingSessionIds]
                .every(values => Array.isArray(values) && values.length <= 12 &&
                values.every(value => typeof value === 'string' && safeId(value))) ||
            !Array.isArray(observedResponse.holdExpiresAt) || observedResponse.holdExpiresAt.length > 12 ||
            observedResponse.holdExpiresAt.some(value => typeof value !== 'string' || value.length > 40 ||
                !Number.isFinite(Date.parse(value))) ||
            (observedResponse.transactionId !== undefined && !safeId(observedResponse.transactionId)) ||
            (observedResponse.transactionAmount !== undefined && !Number.isFinite(observedResponse.transactionAmount)) ||
            (observedResponse.trustedTotalAmount !== undefined && !Number.isFinite(observedResponse.trustedTotalAmount)) ||
            !/^[A-Z][A-Z0-9_]{0,63}$/.test(observedResponse.validationCode)))
            throw Error('SUBMISSION_OBSERVATION_INVALID');
        if (failureCode !== undefined && !/^[A-Z][A-Z0-9_]{0,79}$/.test(failureCode))
            throw Error('SUBMISSION_FAILURE_CODE_INVALID');
        const handle = await open(path, 'r+');
        try {
            await handle.truncate(0);
            await handle.writeFile(JSON.stringify({ ...prior, state, updatedAt: now.toISOString(),
                ...(diagnostic ? { diagnostic } : {}), ...(observedResponse ? { observedResponse } : {}),
                ...(failureCode ? { failureCode } : {}) }));
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
    async read(key) {
        return JSON.parse(await readFile(this.path(key), 'utf8'));
    }
    /** Preserve a verified, elapsed hold before permitting a new attempt for the same block. */
    async recycleExpiredVerified(key, now = new Date()) {
        if (!/^[a-f0-9]{64}$/.test(key))
            throw Error('SUBMISSION_KEY_INVALID');
        const parent = dirname(resolve(this.directory));
        const lockRoot = join(parent, 'recycle-locks'), lock = join(lockRoot, key);
        await mkdir(lockRoot, { recursive: true, mode: 0o700 });
        try {
            await mkdir(lock);
        }
        catch (error) {
            if (error.code === 'EEXIST')
                return 'blocked';
            throw error;
        }
        try {
            let record;
            try {
                record = await this.read(key);
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return 'unused';
                throw error;
            }
            const expiries = record.observedResponse?.holdExpiresAt;
            if (record.key !== key || record.attempt?.attemptId !== key || record.state !== 'verified' ||
                !expiries?.length || expiries.length !== record.attempt.expectedBookingCount ||
                !Number.isFinite(now.getTime()) || expiries.some(value => !Number.isFinite(Date.parse(value)) || Date.parse(value) > now.getTime()))
                return 'blocked';
            const archiveRoot = join(parent, 'expired-holds');
            await mkdir(archiveRoot, { recursive: true, mode: 0o700 });
            await rename(resolve(this.directory), join(archiveRoot, `${key}-${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`));
            return 'reused';
        }
        finally {
            await rmdir(lock);
        }
    }
}
//# sourceMappingURL=durable-submission-journal.js.map