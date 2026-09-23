import { z } from 'zod';
import { expandHours } from './config.js';
import { validateSnapshot } from './grid.js';
const CourtCountSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]);
export const PlanRequestSchema = z.object({ strategy: z.enum(['standard', 'extended']), date: z.iso.date(), start: z.string().regex(/^(0[89]|1\d|2[0-3]):00$/), duration: z.number().int().min(1).max(6, 'Extended two-browser booking currently supports up to 6 consecutive hours.'), courtCount: CourtCountSchema, priority: z.array(z.number().int().min(1).max(7)).min(1), fallbackStarts: z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)).default([]), exact: z.array(z.array(z.number().int().min(1).max(7))).optional() }).strict().superRefine((r, c) => {
    if (r.strategy === 'standard' ? r.duration > 3 : r.duration < 4)
        c.addIssue({ code: 'custom', message: 'Standard supports 1–3 hours; Extended supports 4–6 hours.' });
    if (new Set(r.priority).size !== r.priority.length)
        c.addIssue({ code: 'custom', message: 'Duplicate court priority' });
    for (const start of [r.start, ...r.fallbackStarts]) {
        try {
            expandHours(start, r.duration);
        }
        catch {
            c.addIssue({ code: 'custom', message: 'Booking crosses midnight or has invalid hours' });
        }
    }
    if (r.exact && (r.exact.length !== (r.strategy === 'standard' ? 1 : 2) || r.exact.some(cs => cs.length !== r.courtCount || new Set(cs).size !== cs.length)))
        c.addIssue({ code: 'custom', message: 'Exact courts must match each checkout court count' });
});
export function splitPatterns(duration) {
    if (!Number.isInteger(duration) || duration < 1 || duration > 6)
        throw Error('INVALID_BOOKING_DURATION');
    return duration <= 3 ? [[duration]] : duration === 4 ? [[3, 1], [2, 2], [1, 3]] : duration === 5 ? [[3, 2], [2, 3]] : [[3, 3]];
}
export function candidatePlans(input) {
    const r = PlanRequestSchema.parse(input);
    return [r.start, ...r.fallbackStarts].flatMap(start => splitPatterns(r.duration).map(split => {
        let offset = Number(start.slice(0, 2));
        const chunks = split.map((duration, i) => { const start = `${String(offset).padStart(2, '0')}:00`; offset += duration; return { browser: i === 0 ? 'A' : 'B', start, duration, hours: expandHours(start, duration), requiredCourtCount: r.courtCount }; });
        return { strategy: r.strategy, date: r.date, requestedStart: start, requestedDuration: r.duration, courtCount: r.courtCount, chunks };
    }));
}
export const bookingPlanKey = (p) => JSON.stringify(p.chunks.map(c => [c.start, c.hours, c.courts]));
export function resolveBookingPlan(input, grids, excluded = new Set()) {
    const r = PlanRequestSchema.parse(input);
    if (grids.length !== (r.strategy === 'standard' ? 1 : 2))
        throw Error('BROWSER_COUNT_MISMATCH');
    const cells = grids.map(g => { const cs = validateSnapshot(g, r.date); if (cs.some(c => c.state === 'UNKNOWN'))
        throw Error('SELECTION_STATE_UNKNOWN'); if (cs.some(c => c.state === 'SELECTED'))
        throw Error('PREEXISTING_SELECTION'); return cs; });
    const plans = candidatePlans(r);
    // Honor the preferred start first, then favor continuous courts across all splits.
    for (const start of [r.start, ...r.fallbackStarts])
        for (const requireContinuity of [true, false])
            for (const plan of plans.filter(p => p.requestedStart === start)) {
                const options = plan.chunks.map((chunk, i) => {
                    const available = (r.exact?.[i] ?? r.priority).filter(court => chunk.hours.every(hour => cells[i].some(c => c.court === court && c.hour === hour && c.state === 'OPEN')));
                    if (r.exact)
                        return available.length === r.courtCount ? [available] : [];
                    const combinations = (values, count) => count === 0 ? [[]] : values.flatMap((value, index) => combinations(values.slice(index + 1), count - 1).map(rest => [value, ...rest]));
                    return combinations(available, r.courtCount);
                });
                // A follows configured priority. B retains as many of A's courts as possible.
                // This intentionally preserves the user's 7+6 / 7+5 example over 7+4 / 7+4.
                for (const a of options[0]) {
                    const bs = plan.chunks.length === 1 ? [[]] : [...options[1]].sort((x, y) => y.filter(c => a.includes(c)).length - x.filter(c => a.includes(c)).length);
                    for (const b of bs) {
                        if (requireContinuity && plan.chunks.length > 1 && !r.exact && !b.every(c => a.includes(c)))
                            continue;
                        const resolved = { ...plan, chunks: plan.chunks.map((c, i) => ({ ...c, courts: i === 0 ? a : b })) };
                        if (!excluded.has(bookingPlanKey(resolved)))
                            return resolved;
                    }
                }
            }
}
export function describeBookingPlan(p, _maximum) { return `${p.strategy.toUpperCase()} BOOKING\n${p.date} · ${p.courtCount} court(s) · ${p.requestedDuration} hours\n` + p.chunks.map(c => `Checkout ${c.browser}: ${c.browser === 'A' ? 'Primary player' : 'Extended player'} | ${c.start}–${String(Number(c.start.slice(0, 2)) + c.duration).padStart(2, '0')}:00 · ${c.courts?.map(n => `Court ${n}`).join(' + ') ?? 'Court priority'}`).join('\n') + `\n${p.chunks.length} checkout(s), ${p.chunks.length} temporary payment hold(s). Payment is manual. No price ceiling.`; }
export const BookingPlanSchema = z.object({ strategy: z.enum(['standard', 'extended']), date: z.iso.date(), requestedStart: z.string(), requestedDuration: z.number().int().min(1).max(6), courtCount: CourtCountSchema, chunks: z.array(z.object({ browser: z.enum(['A', 'B']), start: z.string(), duration: z.number().int().min(1).max(3), hours: z.array(z.string()).min(1).max(3), requiredCourtCount: CourtCountSchema, courts: z.array(z.number().int().min(1).max(7)).min(1).max(4) }).strict()).min(1).max(2) }).strict();
export const TestBookingSchema = z.object({ method: z.enum(['browser', 'hybrid', 'api-first', 'proofless']).default('browser'), request: PlanRequestSchema, maximum: z.number().optional(), authorizeTerms: z.literal(true) }).strict().superRefine((value, ctx) => { if (value.request.courtCount > 2 && !['api-first', 'proofless'].includes(value.method))
    ctx.addIssue({ code: 'custom', message: 'Three to seven courts require API-FIRST or PROOFLESS DIRECT.' }); });
export const PreparationSchema = z.discriminatedUnion('workflow', [
    z.object({ workflow: z.literal('test'), method: z.enum(['browser', 'hybrid', 'api-first', 'proofless']).default('browser'), request: PlanRequestSchema, maximum: z.number().optional() }).strict(),
    z.object({ workflow: z.literal('release'), strategy: z.enum(['standard', 'extended']), setup: z.unknown().optional() }).strict(),
]);
export const PreparedBrowserSchema = z.object({
    id: z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']), dedicatedProfileVerified: z.literal(true), ondaVerified: z.literal(true),
    preparedDate: z.iso.date(), gridVerified: z.literal(true), selectedCount: z.literal(0),
    hold: z.literal('Not detected'),
}).strict();
export const PreparationResultSchema = z.object({
    workflow: z.enum(['test', 'release']), strategy: z.enum(['standard', 'extended']),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/), browsers: z.array(PreparedBrowserSchema).min(1).max(8),
    solutionAvailable: z.boolean(), releaseTargetDate: z.iso.date().optional(), releaseMs: z.number().finite().optional(),
}).strict().superRefine((r, c) => {
    const ids = r.browsers.map(b => b.id);
    if (new Set(ids).size !== ids.length || ids.some((id, index) => id !== ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'][index]))
        c.addIssue({ code: 'custom', message: 'Required browser evidence mismatch' });
    if (r.workflow === 'test' && !r.solutionAvailable)
        c.addIssue({ code: 'custom', message: 'Test preparation requires a solution' });
    if (r.workflow === 'release' && (!r.releaseTargetDate || r.releaseMs === undefined))
        c.addIssue({ code: 'custom', message: 'Release preparation requires timing evidence' });
}).readonly();
//# sourceMappingURL=booking-plan.js.map