import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PreparationSchema, PreparedBrowserSchema } from './booking-plan.js';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function testPreparationFingerprint(input) {
    return digest(PreparationSchema.parse(input));
}
export function expectedPreparationFingerprint(input, releaseFingerprint) {
    return input.workflow === 'test' ? testPreparationFingerprint(input) : releaseFingerprint ?? (() => { throw Error('BOOKING_PLAN_CHANGED'); })();
}
export const PreparedContextSchema = z.object({
    workflow: z.enum(['test', 'release']), strategy: z.enum(['standard', 'extended']), courtCount: z.union([z.literal(1), z.literal(2)]),
    date: z.iso.date().optional(), start: z.string(), duration: z.number().int().min(1).max(6),
    courtPriority: z.array(z.number().int().min(1).max(7)), fallbackStarts: z.array(z.string()), exactCourts: z.array(z.array(z.number().int().min(1).max(7))).optional(),
    requiredBrowsers: z.array(z.enum(['A', 'B'])).min(1).max(2), releaseTargetDate: z.iso.date().optional(), releaseMs: z.number().finite().optional(),
    primaryPlayerConfigured: z.boolean(), extendedPlayerConfigured: z.boolean(), configFingerprint: z.string().regex(/^[a-f0-9]{64}$/), preparedAt: z.iso.datetime(),
    browsers: z.array(PreparedBrowserSchema).min(1).max(2), solutionAvailable: z.boolean(),
}).strict().readonly();
export function makePreparedContext(input, result, players, release) {
    if (result.workflow !== input.workflow)
        throw Error('PREPARATION_RESULT_MISMATCH');
    if (input.workflow === 'test')
        return PreparedContextSchema.parse({ workflow: 'test', strategy: input.request.strategy, courtCount: input.request.courtCount, date: input.request.date, start: input.request.start, duration: input.request.duration, courtPriority: input.request.priority, fallbackStarts: input.request.fallbackStarts, exactCourts: input.request.exact, requiredBrowsers: input.request.strategy === 'extended' ? ['A', 'B'] : ['A'], primaryPlayerConfigured: players.primary, extendedPlayerConfigured: players.extended, configFingerprint: result.fingerprint, preparedAt: new Date().toISOString(), browsers: result.browsers, solutionAvailable: result.solutionAvailable });
    if (!release)
        throw Error('BOOKING_PLAN_CHANGED');
    const s = release.setup;
    return PreparedContextSchema.parse({ workflow: 'release', strategy: s.BOOKING_TYPE, courtCount: s.COURT_COUNT, start: s.START_TIME, duration: s.DURATION_HOURS, courtPriority: s.PREFERRED_COURTS, fallbackStarts: s.FALLBACK_TIMES, requiredBrowsers: s.BOOKING_TYPE === 'extended' ? ['A', 'B'] : ['A'], releaseTargetDate: result.releaseTargetDate, releaseMs: result.releaseMs, primaryPlayerConfigured: players.primary, extendedPlayerConfigured: players.extended, configFingerprint: result.fingerprint, preparedAt: new Date().toISOString(), browsers: result.browsers, solutionAvailable: result.solutionAvailable });
}
//# sourceMappingURL=prepared-context.js.map