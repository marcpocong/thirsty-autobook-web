import { createHash } from 'node:crypto';
import { COURT_TO_SPACE_ID } from './availability-parser.js';
import { DurableSubmissionJournal } from './durable-submission-journal.js';
import { THIRSTY_PICKLE_FACILITY_ID } from './live-availability-provider.js';
import { MATRIX_HOURS } from './court-hour-matrix.js';
import { decodeMatrix } from '../slot-evidence.js';
import { PRECISION_WORKER_IDS } from '../workers.js';
import { precisionTargetPlan } from './precision-race.js';
/** Operator authorization is deliberately wider than the seven-worker dispatch fleet. */
export const PRECISION_MAX_CANDIDATES = 21;
const endOf = (start, duration) => `${String(Number(start.slice(0, 2)) + duration).padStart(2, '0')}:00`;
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`));
const isWorker = (id) => PRECISION_WORKER_IDS.includes(id);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const precisionCandidateId = (date, value) => hash([date, value.court, value.start, endOf(value.start, value.durationHours)]);
export function candidatesConflict(a, b) {
    return a.court === b.court && a.start < b.end && b.start < a.end;
}
export function authorizePrecision(input) {
    if (!validDate(input.date) || !Number.isSafeInteger(input.releaseMs) || input.releaseMs <= 0 ||
        !Number.isFinite(Date.parse(input.authorizedAt)))
        throw Error('PRECISION_AUTHORIZATION_INVALID');
    if (input.candidates.length < 1 || input.candidates.length > PRECISION_MAX_CANDIDATES)
        throw Error('PRECISION_CANDIDATE_COUNT_INVALID');
    const candidates = input.candidates.map((value) => {
        const hour = Number(value.start?.slice(0, 2));
        if (!Number.isInteger(value.court) || !COURT_TO_SPACE_ID[value.court] ||
            !/^(0[89]|1\d|2[0-3]):00$/.test(value.start) || !Number.isInteger(value.durationHours) ||
            value.durationHours < 1 || value.durationHours > 3 || hour + value.durationHours > 24 ||
            !Number.isSafeInteger(value.priority) || value.priority < 1 ||
            !value.permissions || !Object.values(value.permissions).some(Boolean) ||
            !validDate(value.rateEvidence?.date) || !Number.isFinite(Date.parse(value.rateEvidence.capturedAt)) ||
            value.rateEvidence.date !== input.date ||
            !/^[A-Za-z0-9 _./:-]{1,100}$/.test(value.rateEvidence.source) ||
            value.rateEvidence.perHour.length !== value.durationHours ||
            value.rateEvidence.perHour.some(price => !Number.isFinite(price) || price <= 0))
            throw Error('PRECISION_CANDIDATE_INVALID');
        const end = endOf(value.start, value.durationHours);
        const logicalKey = DurableSubmissionJournal.key(THIRSTY_PICKLE_FACILITY_ID, COURT_TO_SPACE_ID[value.court], input.date, value.start, end);
        return { ...value, permissions: { ...value.permissions }, rateEvidence: { ...value.rateEvidence, perHour: [...value.rateEvidence.perHour] },
            id: precisionCandidateId(input.date, value), logicalKey, end,
            expectedAmount: value.rateEvidence.perHour.reduce((sum, price) => sum + price, 0) };
    });
    if (new Set(candidates.map(value => value.id)).size !== candidates.length)
        throw Error('PRECISION_CANDIDATE_DUPLICATE');
    const byId = new Map(candidates.map(value => [value.id, value]));
    const usedWorkers = new Set(), usedCandidates = new Set();
    for (const assignment of input.wave1) {
        const candidate = byId.get(assignment.candidateId);
        if (!isWorker(assignment.workerId) || usedWorkers.has(assignment.workerId) || !candidate?.permissions.wave1 ||
            usedCandidates.has(candidate.id) || !candidate.rateEvidence.actionable || candidate.rateEvidence.status === 'REFERENCE')
            throw Error('PRECISION_WAVE1_ASSIGNMENT_INVALID');
        usedWorkers.add(assignment.workerId);
        usedCandidates.add(candidate.id);
    }
    if (!input.wave1.length || input.wave1.length > PRECISION_WORKER_IDS.length ||
        input.wave1.some((assignment, index) => input.wave1.slice(index + 1).some(other => candidatesConflict(byId.get(assignment.candidateId), byId.get(other.candidateId)))))
        throw Error('PRECISION_WAVE1_CONFLICT');
    if (new Set(input.standby).size !== input.standby.length ||
        input.standby.some(worker => !isWorker(worker) || usedWorkers.has(worker)))
        throw Error('PRECISION_STANDBY_INVALID');
    const { wave2, rescue, total } = input.budgets;
    if (![wave2, rescue, total].every(value => Number.isSafeInteger(value) && value >= 0) ||
        wave2 > input.standby.length || rescue > PRECISION_WORKER_IDS.length || total < input.wave1.length ||
        total > PRECISION_MAX_CANDIDATES + rescue || total > input.wave1.length + wave2 + rescue ||
        (wave2 > 0 && !input.standby.length) || (rescue > 0 && !input.rescueEnabled))
        throw Error('PRECISION_BUDGET_INVALID');
    const selected = input.wave1.map(value => byId.get(value.candidateId));
    const commonStart = selected.every(value => value.start === selected[0].start && value.end === selected[0].end);
    const warning = selected.length > 1 && commonStart
        ? `All ${selected.length} Wave 1 attempts share ${selected[0].start}–${selected[0].end}. A time-wide unavailable block would affect every attempt.`
        : null;
    const frozen = { ...input, candidates, wave1: input.wave1.map(value => ({ ...value })), standby: [...input.standby], budgets: { ...input.budgets }, warning };
    return Object.freeze({ ...frozen,
        candidates: Object.freeze(candidates.map(value => Object.freeze({ ...value,
            permissions: Object.freeze(value.permissions), rateEvidence: Object.freeze({ ...value.rateEvidence,
                perHour: Object.freeze([...value.rateEvidence.perHour]) }) }))),
        wave1: Object.freeze(frozen.wave1.map(value => Object.freeze(value))),
        standby: Object.freeze([...frozen.standby]), budgets: Object.freeze({ ...frozen.budgets }),
        fingerprint: hash(frozen) });
}
/** MISS is the only currently documented cache status accepted for action. HIT, STALE,
 * absent metadata, and AGE alone cannot bound the represented state. */
export function classifyActionableObservation(observation, newestAnsweredSeq, releaseMs, evaluatedMs, maxAgeMs) {
    const ageMs = evaluatedMs - (releaseMs + observation.requestOffsetMs);
    let fitness;
    if (observation.outcome !== 'ok')
        fitness = 'FAILED';
    else if (!observation.targetDatePresent || observation.requestOffsetMs < 0)
        fitness = 'UNRELEASED';
    else if (observation.seq < newestAnsweredSeq)
        fitness = 'FORENSIC_ONLY_OUTDATED_REQUEST';
    else if (decodeMatrix(observation.matrix).size !== 112 || !observation.prices ||
        observation.prices.length !== 7 || observation.prices.some(row => row.length !== MATRIX_HOURS.length))
        fitness = 'FORENSIC_ONLY_INCOMPLETE';
    else if (observation.cache?.status !== 'MISS' || (observation.cache.ageS ?? 0) > 0)
        fitness = 'FORENSIC_ONLY_CACHE_AGE_UNKNOWN';
    else if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs)
        fitness = 'FORENSIC_ONLY_STALE';
    else
        fitness = 'ACTIONABLE_FRESH';
    return { observation, fitness, ageMs };
}
/** Freshness window for adaptive evidence: max(6 s, 2 × read latency + security refresh + 1 s), capped at 15 s.
 * Shared by the release runner and the offline replay so both apply the same rule. */
export function adaptiveMaxAgeMs(readLatencyMs, securityRefreshMs) {
    return Math.min(15_000, Math.max(6_000, 2 * readLatencyMs + securityRefreshMs + 1000));
}
export function candidatePriceFromObservation(candidate, evidence) {
    if (evidence.fitness !== 'ACTIONABLE_FRESH')
        return null;
    const cells = decodeMatrix(evidence.observation.matrix), hours = Number(candidate.start.slice(0, 2));
    const prices = [];
    for (let offset = 0; offset < candidate.durationHours; offset++) {
        const hour = `${String(hours + offset).padStart(2, '0')}:00`;
        if (cells.get(`${candidate.court}/${hour}`) !== 'O')
            return null;
        const price = evidence.observation.prices?.[candidate.court - 1]?.[MATRIX_HOURS.indexOf(hour)];
        if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0)
            return null;
        prices.push(price);
    }
    return prices;
}
/** Replaces every request rate from one documented evidence set; no assumed-rate slot survives. */
export function pricedPrecisionPlan(candidate, date, prices) {
    if (prices.length !== candidate.durationHours || prices.some(value => !Number.isFinite(value) || value <= 0))
        throw Error('PRECISION_RATE_EVIDENCE_INVALID');
    const target = { court: candidate.court, start: candidate.start, durationHours: candidate.durationHours,
        end: candidate.end, workerId: 'A', targetKey: candidate.logicalKey, assumedAmount: prices.reduce((a, b) => a + b, 0) };
    const base = precisionTargetPlan(target, date), source = base.courts[0];
    const slots = source.slots.map((slot, index) => ({ ...slot, price: prices[index],
        isNightRate: Number(slot.startTime.slice(0, 2)) >= 16 }));
    const price = prices.reduce((a, b) => a + b, 0), court = { ...source, slots, price };
    return { ...base, courts: [court], chunks: [{ ...base.chunks[0], courts: [court], totalPrice: price }], totalPrice: price };
}
export class PrecisionSession {
    authorization;
    attempts = [];
    latest;
    wave2Selected = false;
    unavailableAt = new Map();
    rangeWasUnavailable = new Map();
    rescuedEpochs = new Set();
    constructor(authorization) {
        this.authorization = authorization;
    }
    get status() {
        const verified = this.attempts.filter(value => value.state === 'VERIFIED').length;
        if (this.attempts.some(value => value.state === 'UNKNOWN'))
            return 'MANUAL_RECONCILIATION_REQUIRED';
        if (verified > 1)
            return 'OBJECTIVE_ACHIEVED_EXTRA_HOLD';
        if (verified)
            return 'OBJECTIVE_ACHIEVED';
        if (this.attempts.some(value => value.state === 'IN_FLIGHT'))
            return 'MANUAL_RECONCILIATION_REQUIRED';
        return this.attempts.length ? 'ALL_REJECTED_WAITING_FOR_REOPEN' : 'NOTHING_DISPATCHED';
    }
    observe(evidence) {
        if (this.latest && evidence.observation.seq <= this.latest.observation.seq)
            return;
        this.latest = evidence;
        if (evidence.fitness !== 'ACTIONABLE_FRESH')
            return;
        for (const candidate of this.authorization.candidates) {
            const cells = decodeMatrix(evidence.observation.matrix);
            const hours = Number(candidate.start.slice(0, 2));
            const codes = Array.from({ length: candidate.durationHours }, (_, offset) => cells.get(`${candidate.court}/${String(hours + offset).padStart(2, '0')}:00`));
            if (codes.some(value => value !== 'O' && value !== 'X'))
                continue;
            const unavailable = codes.some(value => value === 'X');
            if (unavailable && !this.rangeWasUnavailable.get(candidate.id))
                this.unavailableAt.set(candidate.id, { seq: evidence.observation.seq, responseOffsetMs: evidence.observation.responseOffsetMs });
            this.rangeWasUnavailable.set(candidate.id, unavailable);
        }
    }
    /** Pure selection; caller must durably reserve and recheck before each dispatch. */
    select(wave, nowMs, maxAgeMs) {
        if (wave === 'WAVE_2' && this.wave2Selected || wave === 'RESCUE' && !this.authorization.rescueEnabled)
            return [];
        if (this.attempts.some(value => value.state === 'UNKNOWN' || value.state === 'VERIFIED'))
            return [];
        if (wave === 'WAVE_2' && !this.authorization.concurrentWave2 && this.attempts.some(value => value.state === 'IN_FLIGHT'))
            return [];
        if (wave === 'RESCUE' && this.attempts.some(value => value.state === 'IN_FLIGHT'))
            return [];
        if (wave === 'RESCUE' && !this.attempts.some(value => value.state === 'REJECTED'))
            return [];
        const evidence = this.latest;
        if (!evidence || classifyActionableObservation(evidence.observation, evidence.observation.seq, this.authorization.releaseMs, nowMs, maxAgeMs).fitness !== 'ACTIONABLE_FRESH')
            return [];
        const budget = Math.min(this.authorization.budgets.total - this.attempts.length, this.authorization.budgets[wave === 'WAVE_2' ? 'wave2' : 'rescue'] - this.attempts.filter(value => value.wave === wave).length);
        if (budget <= 0)
            return [];
        const byId = new Map(this.authorization.candidates.map(value => [value.id, value]));
        const active = this.attempts.filter(value => value.state === 'IN_FLIGHT' || value.state === 'VERIFIED').map(value => byId.get(value.candidateId));
        const workers = (wave === 'WAVE_2' ? this.authorization.standby :
            [...this.authorization.standby, ...this.authorization.wave1.map(value => value.workerId)])
            .filter(worker => wave === 'WAVE_2'
            ? !this.attempts.some(value => value.workerId === worker)
            : !this.attempts.some(value => value.workerId === worker && value.state === 'IN_FLIGHT'));
        const selected = [];
        for (const candidate of [...this.authorization.candidates].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))) {
            if (selected.length >= budget || selected.length >= workers.length)
                break;
            if (!(wave === 'WAVE_2' ? candidate.permissions.wave2 : candidate.permissions.rescue))
                continue;
            if (wave === 'WAVE_2' && this.attempts.some(value => value.candidateId === candidate.id))
                continue;
            const unavailable = this.unavailableAt.get(candidate.id);
            if (wave === 'RESCUE' && (!unavailable || unavailable.seq >= evidence.observation.seq ||
                unavailable.responseOffsetMs > evidence.observation.requestOffsetMs ||
                this.rescuedEpochs.has(`${candidate.id}/${unavailable.seq}`)))
                continue;
            if ([...active, ...selected.map(value => value.candidate)].some(value => candidatesConflict(value, candidate)))
                continue;
            const prices = candidatePriceFromObservation(candidate, evidence);
            if (!prices)
                continue;
            selected.push({ candidate, workerId: workers[selected.length], prices, evidenceSeq: evidence.observation.seq,
                ...(wave === 'RESCUE' ? { reopenEpoch: unavailable.seq } : {}) });
        }
        // A fresh grid with no eligible target must not spend the one adaptive wave.
        if (wave === 'WAVE_2' && selected.length)
            this.wave2Selected = true;
        return selected;
    }
    record(attempt) {
        if (this.attempts.some(value => value.id === attempt.id))
            throw Error('PRECISION_ATTEMPT_DUPLICATE');
        this.attempts.push(attempt);
        if (attempt.wave === 'RESCUE' && attempt.reopenEpoch !== undefined)
            this.rescuedEpochs.add(`${attempt.candidateId}/${attempt.reopenEpoch}`);
    }
}
//# sourceMappingURL=precision-phase3.js.map