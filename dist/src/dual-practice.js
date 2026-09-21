import { z } from 'zod';
import { PracticeSchema } from './practice.js';
import { expandHours } from './config.js';
export const DualPracticeSchema = z.object({
    target: PracticeSchema, courtB: z.coerce.number().int().min(1).max(7),
    maximum: z.number().optional(), noncompetitive: z.literal(true),
    authorizeTerms: z.boolean().default(false), armed: z.boolean().default(false),
}).strict().refine(p => p.target.court !== p.courtB, 'Distinct courts required');
export function practicePair(input) {
    const p = DualPracticeSchema.parse(input), hours = expandHours(p.target.start, p.target.duration);
    return { date: p.target.date, start: p.target.start, hours, a: { court: p.target.court, hours: [...hours] }, b: { court: p.courtB, hours: [...hours] } };
}
export function requireDualFullAuthorization(input) {
    if (!input.armed)
        throw Error('ARMED_FLAG_REQUIRED');
    if (!input.authorizeTerms)
        throw Error('TERMS_AUTHORIZATION_REQUIRED');
    if (!input.noncompetitive)
        throw Error('NONCOMPETITIVE_TARGET_REQUIRED');
}
//# sourceMappingURL=dual-practice.js.map