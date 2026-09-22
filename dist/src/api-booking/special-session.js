import { createHash } from 'node:crypto';
export const SPECIAL_SESSION_MODE = 'special-friday';
export const SPECIAL_SESSION_LABEL = 'Special Friday session';
// Core proof-based lane: Courts for A/B (early block) and C/D (late block).
export const SPECIAL_SESSION_WORKERS = ['A', 'B', 'C', 'D'];
// Adaptive lane: proof-based when early availability appears, proofless (see
// special-direct-checkout.ts) exactly at release otherwise. Never both.
export const SPECIAL_ADAPTIVE_WORKERS = ['E', 'F'];
// Bonus proof-based lane on a fourth distinct court. Always proof-based; never
// falls back to the proofless path. Optional: must not block A-D.
export const SPECIAL_BONUS_WORKERS = ['G', 'H'];
export const SPECIAL_SESSION_REQUIRED_WORKERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
export const SPECIAL_SESSION_COURT_PRIORITY = [6, 7, 5, 4, 3, 2, 1];
// The E/F candidate court is reserved first, before the proof-based lanes are assigned.
export const SPECIAL_ADAPTIVE_COURT_PRIORITY = [5, 4, 3, 2, 1];
export const SPECIAL_BONUS_COURT_PRIORITY = [4, 3, 2, 1, 5, 6, 7];
// Four independent checkout holds are required because Onda's verified flow
// permits at most three consecutive hours per checkout.
export const SPECIAL_SESSION_BLOCKS = Object.freeze([
    { workerId: 'A', court: 6, startTime: '17:00', endTime: '20:00', durationHours: 3 },
    { workerId: 'B', court: 6, startTime: '20:00', endTime: '22:00', durationHours: 2 },
    { workerId: 'C', court: 7, startTime: '19:00', endTime: '21:00', durationHours: 2 },
    { workerId: 'D', court: 7, startTime: '21:00', endTime: '23:00', durationHours: 2 },
]);
// Same asymmetric 3h/2h shape as A/B, on the reserved adaptive (E/F) court.
export const SPECIAL_ADAPTIVE_BLOCKS = Object.freeze([
    { workerId: 'E', court: 5, startTime: '17:00', endTime: '20:00', durationHours: 3 },
    { workerId: 'F', court: 5, startTime: '20:00', endTime: '22:00', durationHours: 2 },
]);
// Same asymmetric 3h/2h shape as A/B, on the fourth distinct bonus court.
export const SPECIAL_BONUS_BLOCKS = Object.freeze([
    { workerId: 'G', court: 4, startTime: '17:00', endTime: '20:00', durationHours: 3 },
    { workerId: 'H', court: 4, startTime: '20:00', endTime: '22:00', durationHours: 2 },
]);
export function specialSessionDescription(targetDate) {
    return `${SPECIAL_SESSION_LABEL.toUpperCase()}\n${targetDate}\n` +
        'Up to 8 independent temporary QR holds across 4 distinct courts · Players/Browsers A through H\n' +
        'A/B preferred Court 6: 17:00-22:00 (A 17:00-20:00 + B 20:00-22:00) · proof-based\n' +
        'C/D preferred Court 7: 19:00-23:00 (C 19:00-21:00 + D 21:00-23:00) · proof-based\n' +
        'E/F preferred Court 5: 17:00-22:00 (E 17:00-20:00 + F 20:00-22:00) · adaptive: proof-based if fresh availability appears before release, otherwise the existing proofless direct attempt exactly at release. Never both.\n' +
        'G/H preferred Court 4: 17:00-22:00 (G 17:00-20:00 + H 20:00-22:00) · proof-based only; skipped entirely when no fourth distinct court has complete availability. Never proofless.\n' +
        'Fallback: the best distinct courts with each complete time block, searched in priority order\n' +
        "E/F's proofless fallback hidden-price assumption is PHP 700/hour and is unverified\n" +
        'A hold is not a completed booking. Unknown outcomes are never retried.\n' +
        'Early backend availability watcher enabled · Payment remains manual.';
}
function expectedHours(block) {
    const start = Number(block.startTime.slice(0, 2));
    return Array.from({ length: block.durationHours }, (_, index) => `${String(start + index).padStart(2, '0')}:00`);
}
function planForBlock(snapshot, block) {
    const date = snapshot.requestedDates[0];
    if (!date || snapshot.requestedDates.length !== 1 || snapshot.returnedDates[date] !== true)
        return;
    const hours = expectedHours(block);
    const slots = hours.map(hour => snapshot.slots.find(slot => slot.court === block.court && slot.date === date && slot.bookingDate === date &&
        slot.startTime === hour && slot.isAvailable && slot.currency === 'PHP'));
    if (slots.some(slot => !slot))
        return;
    const present = slots;
    if (present.at(-1)?.endTime !== block.endTime)
        return;
    const price = present.reduce((sum, slot) => sum + slot.price, 0);
    const court = { court: block.court, spaceId: present[0].spaceId, date,
        startTime: block.startTime, endTime: block.endTime, durationMinutes: block.durationHours * 60,
        price, currency: 'PHP', slots: present };
    const chunk = { startTime: block.startTime, endTime: block.endTime,
        durationHours: block.durationHours, courts: [court], totalPrice: price };
    return { mode: 'standard', targetDate: date, startTime: block.startTime, endTime: block.endTime,
        durationHours: block.durationHours, courts: [court], chunks: [chunk], totalPrice: price, currency: 'PHP' };
}
/** Builds every requested worker's plan on one exact court from a shared block template set. */
function plansForCourtBlocks(snapshot, blocks, court, workers) {
    const plans = new Map();
    for (const template of blocks) {
        if (!workers.includes(template.workerId))
            continue;
        const plan = planForBlock(snapshot, { ...template, court });
        if (!plan)
            return undefined;
        plans.set(template.workerId, plan);
    }
    return plans;
}
/** E/F proof-based plans on their already-reserved adaptive court, using actual observed prices. */
export function specialAdaptivePlans(snapshot, court, workers = SPECIAL_ADAPTIVE_WORKERS) {
    return plansForCourtBlocks(snapshot, SPECIAL_ADAPTIVE_BLOCKS, court, workers);
}
/** G/H proof-based plans on one exact fourth-court candidate. */
export function specialBonusPlansForCourt(snapshot, court, workers = SPECIAL_BONUS_WORKERS) {
    return plansForCourtBlocks(snapshot, SPECIAL_BONUS_BLOCKS, court, workers);
}
/**
 * Searches SPECIAL_BONUS_COURT_PRIORITY for a fourth distinct court with all five
 * required hours available, excluding every court already used by another lane.
 * Returns undefined (a safe skip) when no such court exists; this must never
 * block an otherwise valid A-D plan.
 */
export function specialBonusLanePlans(snapshot, excludedCourts, workers = SPECIAL_BONUS_WORKERS) {
    for (const court of SPECIAL_BONUS_COURT_PRIORITY) {
        if (excludedCourts.includes(court))
            continue;
        const plans = specialBonusPlansForCourt(snapshot, court, workers);
        if (plans)
            return { court, plans };
    }
    return undefined;
}
function plansForAssignment(snapshot, assignment, workers, requireCompleteSession) {
    if (assignment.earlyCourt === assignment.lateCourt)
        return;
    const allPlans = new Map();
    for (const template of SPECIAL_SESSION_BLOCKS) {
        const court = template.workerId === 'A' || template.workerId === 'B'
            ? assignment.earlyCourt : assignment.lateCourt;
        const plan = planForBlock(snapshot, { ...template, court });
        if (!plan) {
            if (requireCompleteSession || workers.includes(template.workerId))
                return;
            continue;
        }
        allPlans.set(template.workerId, plan);
    }
    const plans = new Map();
    for (const workerId of workers) {
        const plan = allPlans.get(workerId);
        if (!plan)
            return;
        plans.set(workerId, plan);
    }
    return plans;
}
export function specialSessionPlans(snapshot, workers = SPECIAL_SESSION_WORKERS, assignedCourts, excludedCourts = []) {
    if (workers.some(workerId => !SPECIAL_SESSION_WORKERS.includes(workerId)))
        throw Error('SPECIAL_SESSION_WORKER_INVALID');
    if (assignedCourts)
        return plansForAssignment(snapshot, assignedCourts, workers, false);
    const earlyPriority = SPECIAL_SESSION_COURT_PRIORITY;
    const latePriority = [7, 6, 5, 4, 3, 2, 1];
    for (const earlyCourt of earlyPriority) {
        for (const lateCourt of latePriority) {
            if (earlyCourt === lateCourt || excludedCourts.includes(earlyCourt) || excludedCourts.includes(lateCourt))
                continue;
            const plans = plansForAssignment(snapshot, { earlyCourt, lateCourt }, workers, true);
            if (plans)
                return plans;
        }
    }
    return;
}
export function specialSessionCourtAssignment(plans) {
    const earlyCourt = plans.get('A')?.courts[0]?.court ?? plans.get('B')?.courts[0]?.court;
    const lateCourt = plans.get('C')?.courts[0]?.court ?? plans.get('D')?.courts[0]?.court;
    if (!earlyCourt || !lateCourt || earlyCourt === lateCourt)
        throw Error('SPECIAL_SESSION_ASSIGNMENT_INVALID');
    const bonusCourt = plans.get('G')?.courts[0]?.court ?? plans.get('H')?.courts[0]?.court;
    return bonusCourt !== undefined && bonusCourt !== earlyCourt && bonusCourt !== lateCourt
        ? { earlyCourt, lateCourt, bonusCourt } : { earlyCourt, lateCourt };
}
export function specialSessionFingerprint() {
    return createHash('sha256').update(JSON.stringify({ blocks: SPECIAL_SESSION_BLOCKS, adaptiveBlocks: SPECIAL_ADAPTIVE_BLOCKS,
        bonusBlocks: SPECIAL_BONUS_BLOCKS, adaptiveWorkers: SPECIAL_ADAPTIVE_WORKERS, bonusWorkers: SPECIAL_BONUS_WORKERS,
        adaptiveCourtPriority: SPECIAL_ADAPTIVE_COURT_PRIORITY, bonusCourtPriority: SPECIAL_BONUS_COURT_PRIORITY,
        assumedEveningRate: 700 })).digest('hex');
}
//# sourceMappingURL=special-session.js.map