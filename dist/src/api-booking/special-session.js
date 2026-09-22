import { createHash } from 'node:crypto';
export const SPECIAL_SESSION_MODE = 'special-friday';
export const SPECIAL_SESSION_LABEL = 'Special Friday session';
export const SPECIAL_SESSION_WORKERS = ['A', 'B', 'C', 'D'];
export const SPECIAL_SESSION_REQUIRED_WORKERS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const SPECIAL_SESSION_COURT_PRIORITY = [6, 7, 5, 4, 3, 2, 1];
// Four independent checkout holds are required because Onda's verified flow
// permits at most three consecutive hours per checkout.
export const SPECIAL_SESSION_BLOCKS = Object.freeze([
    { workerId: 'A', court: 6, startTime: '17:00', endTime: '20:00', durationHours: 3 },
    { workerId: 'B', court: 6, startTime: '20:00', endTime: '22:00', durationHours: 2 },
    { workerId: 'C', court: 7, startTime: '19:00', endTime: '21:00', durationHours: 2 },
    { workerId: 'D', court: 7, startTime: '21:00', endTime: '23:00', durationHours: 2 },
]);
export function specialSessionDescription(targetDate) {
    return `${SPECIAL_SESSION_LABEL.toUpperCase()}\n${targetDate}\n` +
        'Preferred Court 6: 17:00-22:00 (Browser A 17:00-20:00 + Browser B 20:00-22:00)\n' +
        'Preferred Court 7: 19:00-23:00 (Browser C 19:00-21:00 + Browser D 21:00-23:00)\n' +
        'Fallback: the best two distinct courts with both complete time blocks\n' +
        'Up to 6 independent temporary holds · Players/Browsers A through F\n' +
        'E/F direct third court 17:00-22:00 at release without slot proofs; hidden price assumes PHP 700/hour and is unverified\n' +
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
    return { earlyCourt, lateCourt };
}
export function specialSessionFingerprint() {
    return createHash('sha256').update(JSON.stringify({ blocks: SPECIAL_SESSION_BLOCKS, directWorkers: ['E', 'F'], directCourtPriority: [5, 4, 3, 2, 1], assumedEveningRate: 700 })).digest('hex');
}
//# sourceMappingURL=special-session.js.map