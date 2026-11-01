import { z } from 'zod';
import { freezePrecisionRace } from './api-booking/precision-race.js';
import { armPrecisionRace, dispatchArmedPrecisionRace, disarmUnfired, type ArmDeps, type ArmedDispatchDeps } from './api-booking/armed-dispatch.js';
import type { BookingPlan } from './api-booking/types.js';
import { DurableSubmissionJournal } from './api-booking/durable-submission-journal.js';
import { FACILITY_ID } from './court-registry.js';
import { assertRehearsalSecurityReady, type RehearsalSecurityTransport } from './shotgun-rehearsal-readiness.js';
export { prepareRehearsalSecurity, assertRehearsalSecurityReady } from './shotgun-rehearsal-readiness.js';

/** Separate opt-in rehearsal; never changes the production live-now refusal. */
export const ShotgunRehearsalSchema = z.object({
  kind: z.literal('SHOTGUN_LIVE_REHEARSAL'), date: z.iso.date(), wing: z.literal('MANGO'),
  court: z.number().int().min(1).max(7), worker: z.enum(['A','B','C','D','E','F','G']),
  start: z.string().regex(/^(0[89]|1\d|2[0-3]):00$/), duration: z.number().int().min(1).max(3),
  maximum: z.number().positive().max(1800), attempts: z.literal(1), payment: z.literal(false),
}).strict().refine(r => Number(r.start.slice(0, 2)) + r.duration <= 24, 'MIDNIGHT_CROSSING_REFUSED');
export type ShotgunRehearsal = z.infer<typeof ShotgunRehearsalSchema>;
export const productionRehearsalEngine = { freezePrecisionRace, armPrecisionRace, dispatchArmedPrecisionRace, disarmUnfired };

/** Injecting an installed engine binds the rehearsal to those exact runtime modules. */
export async function runShotgunLiveRehearsal(input: unknown, plan: BookingPlan, deps: {
  engine?: typeof productionRehearsalEngine; arm: ArmDeps; dispatch: ArmedDispatchDeps;
  security: Pick<RehearsalSecurityTransport,'preparedContextAgeMs'>;
}) {
  const r = ShotgunRehearsalSchema.parse(input), court = plan.courts[0];
  if (plan.mode !== 'standard' || plan.targetDate !== r.date || plan.startTime !== r.start ||
      plan.durationHours !== r.duration || plan.courts.length !== 1 || court?.court !== r.court ||
      plan.chunks.length !== 1 || plan.chunks[0]?.courts.length !== 1 ||
      (plan.wing ?? 'MANGO') !== 'MANGO' || plan.currency !== 'PHP' ||
      !Number.isFinite(plan.totalPrice) || plan.totalPrice <= 0 || plan.totalPrice > r.maximum ||
      !court.slots.every(s => s.isAvailable && s.price > 0) ||
      deps.arm.releaseMs - deps.arm.now() < 5_000 || deps.arm.releaseMs - deps.arm.now() > 90_000)
    throw Error('SHOTGUN_REHEARSAL_PLAN_REFUSED');
  assertRehearsalSecurityReady(deps.security);
  const engine = deps.engine ?? productionRehearsalEngine;
  const race = engine.freezePrecisionRace(r.date, deps.arm.releaseMs, [{
    target: { court: r.court, start: r.start, durationHours: r.duration, workerId: r.worker,
      end: plan.endTime, assumedAmount: plan.totalPrice,
      targetKey: DurableSubmissionJournal.key(FACILITY_ID, court.spaceId, r.date, r.start, plan.endTime) },
    plan, dispatchTimingPolicy: 'SHOTGUN_STRICT',
  }]);
  assertRehearsalSecurityReady(deps.security);
  const armed = await engine.armPrecisionRace(race, deps.arm);
  try {
    if (armed.attempts.length !== 1 || armed.unarmed.length) throw Error('SHOTGUN_REHEARSAL_ARM_REFUSED');
    return await engine.dispatchArmedPrecisionRace(armed, deps.dispatch);
  } finally {
    await engine.disarmUnfired(armed, 'REHEARSAL_NOT_DISPATCHED', deps.arm.now);
  }
}
