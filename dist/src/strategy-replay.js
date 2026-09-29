import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { adaptiveMaxAgeMs, authorizePrecision, candidatePriceFromObservation, candidatesConflict, classifyActionableObservation, isActionableEvidenceFitness, precisionCandidateId, PrecisionSession } from './api-booking/precision-phase3.js';
import { readObserverLog } from './release-forensics.js';
import { decodeMatrix, targetEvidence } from './slot-evidence.js';
export const REPLAY_DEFAULT_SETTLE_MS = 20_000;
const text = (candidate) => ({ court: candidate.court, startTime: candidate.start, endTime: candidate.end });
const ref = (value) => ({ seq: value.seq, requestOffsetMs: value.requestOffsetMs, responseOffsetMs: value.responseOffsetMs });
export function replayRelease(plan, log, record, options = {}) {
    const releaseMs = log.releaseMs, date = log.date, securityRefreshMs = options.securityRefreshMs ?? 2_500;
    // Replay only: the plan's rate evidence is re-dated to the replayed date; grid prices drive every adaptive send.
    const candidates = plan.candidates.map(candidate => ({ ...candidate, rateEvidence: { ...candidate.rateEvidence, date } }));
    const authorization = authorizePrecision({ date, releaseMs, candidates,
        wave1: plan.wave1.map(value => ({ workerId: value.workerId, candidateId: precisionCandidateId(date, candidates[value.candidateIndex]) })),
        standby: plan.standby, budgets: plan.budgets, concurrentWave2: plan.concurrentWave2, rescueEnabled: plan.rescueEnabled,
        authorizedAt: new Date(releaseMs - 120_000).toISOString() });
    const byId = new Map(authorization.candidates.map(value => [value.id, value]));
    const session = new PrecisionSession(authorization);
    const observedSettle = record.attempts.map(attempt => attempt.responseOffsetMs).filter((value) => value !== null && value > 0);
    const settleAt = options.immediateSettledAtMs ?? (observedSettle.length ? Math.max(...observedSettle) : REPLAY_DEFAULT_SETTLE_MS);
    const assumptions = [
        'Every immediate attempt is treated as sent at 08:00 and still waiting until it is answered.',
        `Immediate attempts are treated as ${options.immediateResult === 'UNKNOWN' ? 'UNKNOWN' : 'rejected'} at +${(settleAt / 1000).toFixed(1)} s (${options.immediateSettledAtMs !== undefined ? 'chosen for this replay' : observedSettle.length ? 'when this release\'s real provider responses arrived' : 'default; no provider response was recorded'}).`,
        'Each replayed backup or reopened-slot send is treated as rejected at once, so later opportunities stay visible. This is not a prediction of Onda\'s answer.',
        `Freshness window uses the production rule with ${(securityRefreshMs / 1000).toFixed(1)} s security preparation.`,
    ];
    for (const assignment of authorization.wave1)
        session.record({ id: `replay-wave1-${assignment.workerId}`, candidateId: assignment.candidateId, workerId: assignment.workerId, wave: 'WAVE_1', state: 'IN_FLIGHT' });
    const fitness = {};
    const result = { releaseKey: record.key, targetDate: date, releaseAt: new Date(releaseMs).toISOString(), origin: record.origin,
        quality: record.quality.label, assumptions, immediate: [], fitness, backup: null, rescue: [], conflicts: [], forensicOpenings: [] };
    const answered = log.availability.filter(value => value.outcome !== 'aborted' && Number.isFinite(value.responseOffsetMs) && value.responseOffsetMs >= 0)
        .sort((a, b) => a.responseOffsetMs - b.responseOffsetMs || a.seq - b.seq);
    const events = [...answered.map(observation => ({ at: observation.responseOffsetMs, kind: 'observation', observation })), { at: settleAt, kind: 'settle' }]
        .sort((a, b) => a.at - b.at || (a.kind === 'settle' ? 1 : -1));
    let newestSeq = 0, settled = false, sequence = 0;
    const openSeen = new Set();
    const dispatch = (wave, at, maxAge) => {
        const nowMs = releaseMs + at, latest = session.latest;
        const choices = session.select(wave, nowMs, maxAge);
        if (!choices.length)
            return;
        if (wave === 'WAVE_2' && !result.backup)
            result.backup = { atResponseOffsetMs: at, seq: latest.observation.seq,
                selections: choices.map(choice => ({ ...text(choice.candidate), workerId: choice.workerId, prices: choice.prices, amount: choice.prices.reduce((a, b) => a + b, 0) })) };
        for (const choice of choices) {
            if (wave === 'RESCUE')
                result.rescue.push({ ...text(choice.candidate), atResponseOffsetMs: at, seq: latest.observation.seq, workerId: choice.workerId, amount: choice.prices.reduce((a, b) => a + b, 0) });
            session.record({ id: `replay-${wave}-${++sequence}`, candidateId: choice.candidate.id, workerId: choice.workerId, wave, state: 'REJECTED', evidenceSeq: choice.evidenceSeq,
                ...(choice.reopenEpoch !== undefined ? { reopenEpoch: choice.reopenEpoch } : {}) });
        }
    };
    for (const event of events) {
        if (event.kind === 'settle') {
            settled = true;
            for (const attempt of session.attempts)
                if (attempt.wave === 'WAVE_1' && attempt.state === 'IN_FLIGHT')
                    attempt.state = options.immediateResult ?? 'REJECTED';
        }
        else {
            const observation = event.observation;
            newestSeq = Math.max(newestSeq, observation.seq);
            const maxAge = adaptiveMaxAgeMs(Math.max(0, observation.responseOffsetMs - observation.requestOffsetMs), securityRefreshMs);
            const evidence = classifyActionableObservation(observation, newestSeq, releaseMs, releaseMs + event.at, maxAge);
            fitness[evidence.fitness] = (fitness[evidence.fitness] ?? 0) + 1;
            session.observe(evidence);
            // Forensic view: backup/reopen-eligible candidates seen fully open after release. The first sighting is kept for
            // non-actionable and for actionable evidence separately, so a later fresh sighting is not hidden by an earlier cached one.
            if (observation.outcome === 'ok' && observation.targetDatePresent && observation.requestOffsetMs >= 0) {
                const cells = decodeMatrix(observation.matrix);
                for (const candidate of authorization.candidates) {
                    const seen = `${candidate.id}/${isActionableEvidenceFitness(evidence.fitness)}`;
                    if (openSeen.has(seen) || !(candidate.permissions.wave2 || candidate.permissions.rescue))
                        continue;
                    const open = Array.from({ length: candidate.durationHours }, (_, offset) => `${candidate.court}/${String(Number(candidate.start.slice(0, 2)) + offset).padStart(2, '0')}:00`)
                        .every(key => cells.get(key) === 'O');
                    if (open) {
                        openSeen.add(seen);
                        result.forensicOpenings.push({ ...text(candidate), seq: observation.seq, requestOffsetMs: observation.requestOffsetMs,
                            responseOffsetMs: observation.responseOffsetMs, fitness: evidence.fitness });
                    }
                }
            }
            if (isActionableEvidenceFitness(evidence.fitness)) {
                // Same order as the runner: Rescue on arrival (nothing in flight), then Wave 2 when allowed.
                if (authorization.rescueEnabled && !session.attempts.some(value => value.state === 'IN_FLIGHT'))
                    dispatch('RESCUE', event.at, maxAge);
                // Conflicts: fully open, permitted backups skipped only because an active attempt overlaps them.
                const active = session.attempts.filter(value => value.state === 'IN_FLIGHT' || value.state === 'VERIFIED').map(value => byId.get(value.candidateId));
                for (const candidate of authorization.candidates) {
                    if (!candidate.permissions.wave2 || session.attempts.some(value => value.candidateId === candidate.id) || !candidatePriceFromObservation(candidate, evidence))
                        continue;
                    const blocker = active.find(value => value.id !== candidate.id && candidatesConflict(value, candidate));
                    if (blocker && !result.conflicts.some(value => value.court === candidate.court && value.startTime === candidate.start))
                        result.conflicts.push({ ...text(candidate), seq: observation.seq, blockedBy: text(blocker) });
                }
            }
        }
        const current = session.latest;
        if (current && (authorization.concurrentWave2 || settled)) {
            const latency = Math.max(0, current.observation.responseOffsetMs - current.observation.requestOffsetMs);
            dispatch('WAVE_2', event.at, adaptiveMaxAgeMs(latency, securityRefreshMs));
        }
    }
    result.immediate = authorization.wave1.map(assignment => {
        const candidate = byId.get(assignment.candidateId), evidence = targetEvidence(log.availability, log.bookings, { court: candidate.court, startTime: candidate.start, endTime: candidate.end });
        return { ...text(candidate), workerId: assignment.workerId, firstPublished: evidence.firstPublished?.state ?? 'NOT_OBSERVED',
            firstPublishedRead: evidence.firstPublished ? ref(evidence.firstPublished.observation) : null, firstFullyOpen: evidence.firstFullyOpen,
            firstUnavailable: evidence.firstUnavailable?.observation ?? null, reopen: evidence.reopen ? ref(evidence.reopen.after) : null };
    });
    const censored = [];
    const published = answered.filter(value => value.outcome === 'ok' && value.targetDatePresent);
    if (!published.length)
        censored.push('No published grid after release: nothing about the release can be evaluated.');
    else if (published[0].responseOffsetMs > 10_000)
        censored.push(`The first published grid answered at +${(published[0].responseOffsetMs / 1000).toFixed(1)} s: the first seconds after release were not observed.`);
    const unusable = answered.length - (fitness.ACTIONABLE_FRESH ?? 0) - (fitness.UNRELEASED ?? 0);
    if (unusable > 0)
        censored.push(`${unusable} read${unusable === 1 ? '' : 's'} could not be used for adaptive sends (${Object.entries(fitness).filter(([key]) => key !== 'ACTIONABLE_FRESH' && key !== 'UNRELEASED')
            .map(([key, count]) => `${count} ${key.replace(/^FORENSIC_ONLY_/, '').replaceAll('_', ' ').toLowerCase()}`).join(', ')}).`);
    const actionable = !!result.backup || result.rescue.length > 0;
    const freshOpening = result.forensicOpenings.some(value => isActionableEvidenceFitness(value.fitness));
    const statement = actionable ? 'This release contained an observed authorized opportunity.'
        : freshOpening && options.immediateResult === 'UNKNOWN' ? 'An authorized opening was observed, but nothing may be sent after an UNKNOWN result.'
            : freshOpening ? 'An authorized opening was observed in fresh evidence, but the plan\'s timing or limits did not allow a send.'
                : result.forensicOpenings.length ? 'This release contained an observed authorized opening, but not in evidence the current rules may act on.'
                    : published.length ? 'No backup or reopened-slot opportunity was observed in this release.' : 'Evidence was insufficient to evaluate authorized opportunities.';
    return { ...result, statement, censored };
}
/** Replays one plan against every real release that has a recorded grid. Synthetic data is included only on request. */
export function replayAll(root, plan, records, options = {}) {
    const results = [], skipped = [];
    for (const record of records) {
        if (record.origin === 'OFFLINE_BENCHMARK' || (record.origin === 'SYNTHETIC' && !options.includeSynthetic))
            continue;
        const name = record.sources.slotWatch[0], path = name ? join(root, '.local', 'slot-watch', name) : undefined;
        const log = path && existsSync(path) ? readObserverLog(path) : undefined;
        if (!log) {
            skipped.push({ releaseKey: record.key, reason: record.coarseSamples.length ? 'Only availability counts were recorded; no court/hour grid to replay.' : 'No recorded grid for this release.' });
            continue;
        }
        try {
            results.push(replayRelease(plan, log, record, options));
        }
        catch (error) {
            skipped.push({ releaseKey: record.key, reason: /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : 'REPLAY_FAILED' });
        }
    }
    return { results, skipped };
}
/** Legacy Fixed plans replay as immediate attempts only; replay-only rate placeholders are never shown or sent. */
export function replayPlanFromFixed(targets) {
    const candidates = targets.map((target, index) => ({ court: target.court, start: target.start, durationHours: target.durationHours, priority: index + 1,
        permissions: { wave1: true, wave2: false, rescue: false }, rateEvidence: { source: 'replay placeholder', capturedAt: '2026-01-01T00:00:00.000Z', status: 'OPERATOR_CONFIRMED',
            date: '2026-01-01', perHour: Array.from({ length: target.durationHours }, () => 1), actionable: true } }));
    return { candidates, wave1: candidates.map((_, index) => ({ workerId: ['A', 'B', 'C', 'D', 'E', 'F', 'G'][index], candidateIndex: index })), standby: [],
        budgets: { wave2: 0, rescue: 0, total: candidates.length }, concurrentWave2: false, rescueEnabled: false };
}
//# sourceMappingURL=strategy-replay.js.map