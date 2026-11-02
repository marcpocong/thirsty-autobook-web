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
/** Live capacity is deliberately small: one POST per independent court and configured browser. */
export const ShotgunLiveLabSchema = z.object({kind:z.literal('SHOTGUN_LIVE_LAB'),
  requests:z.array(ShotgunRehearsalSchema).min(1).max(3),attempts:z.number().int().min(1).max(3),payment:z.literal(false),
}).strict().superRefine((lab,ctx)=>{
  if(lab.attempts!==lab.requests.length)ctx.addIssue({code:'custom',message:'LAB_EXACT_BUDGET_REQUIRED'});
  if(new Set(lab.requests.map(r=>r.worker)).size!==lab.requests.length||new Set(lab.requests.map(r=>r.court)).size!==lab.requests.length||
    new Set(lab.requests.map(r=>r.date)).size!==1)ctx.addIssue({code:'custom',message:'LAB_INDEPENDENT_TARGETS_REQUIRED'});
});
export const ShotgunLiveRequestSchema=z.union([ShotgunRehearsalSchema,ShotgunLiveLabSchema]);
export const liveLabRequests=(input:unknown):ShotgunRehearsal[]=>{
  const r=ShotgunLiveRequestSchema.parse(input);return r.kind==='SHOTGUN_LIVE_LAB'?r.requests:[r];
};
export const productionRehearsalEngine = { freezePrecisionRace, armPrecisionRace, dispatchArmedPrecisionRace, disarmUnfired };

/** Injecting an installed engine binds the rehearsal to those exact runtime modules. */
export async function runShotgunLiveRehearsal(input: unknown, plan: BookingPlan, deps: {
  engine?: typeof productionRehearsalEngine; arm: ArmDeps; dispatch: ArmedDispatchDeps;
  security: Pick<RehearsalSecurityTransport,'preparedContextAgeMs'>;
}) {
  ShotgunRehearsalSchema.parse(input);
  return runShotgunLiveLab(input,[plan],{...deps,securityFor:()=>deps.security});
}

function assertPlan(r:ShotgunRehearsal,plan:BookingPlan){
  const court = plan.courts[0];
  if (plan.mode !== 'standard' || plan.targetDate !== r.date || plan.startTime !== r.start ||
      plan.durationHours !== r.duration || plan.courts.length !== 1 || court?.court !== r.court ||
      plan.chunks.length !== 1 || plan.chunks[0]?.courts.length !== 1 ||
      (plan.wing ?? 'MANGO') !== 'MANGO' || plan.currency !== 'PHP' ||
      !Number.isFinite(plan.totalPrice) || plan.totalPrice <= 0 || plan.totalPrice > r.maximum ||
      court.slots.length!==r.duration || !court.slots.every(s => s.isAvailable && s.price > 0))
    throw Error('SHOTGUN_REHEARSAL_PLAN_REFUSED');
}

/** Both single-shot rehearsal and independent-target Lab use this one production engine. */
export async function runShotgunLiveLab(input:unknown,plans:BookingPlan[],deps:{
  engine?:typeof productionRehearsalEngine;arm:ArmDeps;dispatch:ArmedDispatchDeps;
  securityFor:(worker:ShotgunRehearsal['worker'])=>Pick<RehearsalSecurityTransport,'preparedContextAgeMs'>;
}){
  const requests=liveLabRequests(input);
  if(plans.length!==requests.length||deps.arm.releaseMs-deps.arm.now()<5000||deps.arm.releaseMs-deps.arm.now()>90_000)
    throw Error('SHOTGUN_REHEARSAL_PLAN_REFUSED');
  requests.forEach((r,i)=>{assertPlan(r,plans[i]!);assertRehearsalSecurityReady(deps.securityFor(r.worker));});
  const engine = deps.engine ?? productionRehearsalEngine;
  const race = engine.freezePrecisionRace(requests[0]!.date, deps.arm.releaseMs, requests.map((r,i)=>{
    const plan=plans[i]!,court=plan.courts[0]!;return {
    target: { court: r.court, start: r.start, durationHours: r.duration, workerId: r.worker,
      end: plan.endTime, assumedAmount: plan.totalPrice,
      targetKey: DurableSubmissionJournal.key(FACILITY_ID, court.spaceId, r.date, r.start, plan.endTime) },
    plan, dispatchTimingPolicy: 'SHOTGUN_STRICT' as const,
  };}),requests.length>1?{objective:{scope:'PER_WING',wings:{MANGO:requests.length}}}:undefined);
  requests.forEach(r=>assertRehearsalSecurityReady(deps.securityFor(r.worker)));
  const armed = await engine.armPrecisionRace(race, deps.arm);
  try {
    if (armed.attempts.length !== requests.length || armed.unarmed.length) throw Error('SHOTGUN_REHEARSAL_ARM_REFUSED');
    return await engine.dispatchArmedPrecisionRace(armed, deps.dispatch);
  } finally {
    await engine.disarmUnfired(armed, 'REHEARSAL_NOT_DISPATCHED', deps.arm.now);
  }
}
