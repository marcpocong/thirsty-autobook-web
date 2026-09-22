import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requiredWorkerIds } from './workers.js';
export const ScheduledReleaseContextSchema = z.object({
    releaseMs: z.number().int().positive(), releaseISO: z.iso.datetime({ offset: true }), targetDate: z.iso.date(), timezone: z.string().min(1).max(80), bookingHorizon: z.number().int().min(0).max(30),
    workflow: z.literal('release'), strategy: z.enum(['standard', 'extended']), courtCount: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]),
    configFingerprint: z.string().regex(/^[a-f0-9]{64}$/), preparedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    requiredBrowsers: z.array(z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])).min(1).max(8), armedAt: z.iso.datetime(), termsAuthorizedAt: z.iso.datetime(), generation: z.string().uuid(),
}).strict().readonly().superRefine((c, ctx) => {
    if (JSON.stringify(c.requiredBrowsers) !== JSON.stringify(requiredWorkerIds(c.strategy, c.courtCount)))
        ctx.addIssue({ code: 'custom', message: 'Required browser mismatch' });
    if (c.configFingerprint !== c.preparedFingerprint)
        ctx.addIssue({ code: 'custom', message: 'Prepared fingerprint mismatch' });
});
export function scheduledReleaseContext(prepared, booking, clock, now = Date.now()) {
    if (prepared.workflow !== 'release' || prepared.releaseMs !== clock.releaseMs || prepared.releaseTargetDate !== clock.targetDate || prepared.configFingerprint !== booking.fingerprint)
        throw Error('PREPARED_FINGERPRINT_MISMATCH');
    if (now >= clock.releaseMs)
        throw Error('RELEASE_MISSED');
    const at = new Date(now).toISOString();
    return ScheduledReleaseContextSchema.parse({ releaseMs: clock.releaseMs, releaseISO: new Date(clock.releaseMs).toISOString(), targetDate: clock.targetDate, timezone: clock.timezone, bookingHorizon: clock.horizon, workflow: 'release', strategy: booking.setup.BOOKING_TYPE, courtCount: booking.setup.COURT_COUNT, configFingerprint: booking.fingerprint, preparedFingerprint: prepared.configFingerprint, requiredBrowsers: prepared.requiredBrowsers, armedAt: at, termsAuthorizedAt: at, generation: randomUUID() });
}
//# sourceMappingURL=scheduled-release.js.map