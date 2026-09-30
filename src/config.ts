import { z } from 'zod';
import { DateTime, IANAZone } from 'luxon';
import { parse as parseEnv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { reconcileBookingSetupFallbacks, reconcileFallbackTimes, type FallbackReconciliation } from './booking-setup.js';
import { PRECISION_FAN_OUT_ATTEMPTS, PRECISION_MAX_ATTEMPTS, PRECISION_MAX_FAN_OUT, PRECISION_MAX_SENDS, WORKER_IDS, type CourtCount, type WorkerId } from './workers.js';
import {networkNowMs} from './network-clock.js';
import { PRECISION_MAX_CANDIDATES } from './api-booking/precision-phase3.js';
import { isReleaseOffsetMs } from './release-offset.js';

export const ONDA_URL = 'https://app.onda.fit/book/thirsty-pickle';
export const VENUE = 'Thirsty Pickle | SM Seaside';
const hour = z.string().regex(/^(0[89]|1[0-9]|2[0-3]):00$/);
const courts = z.array(z.number().int().min(1).max(7));
/** Release Offset of one Precision attempt; absent means 0 ms (normal). */
const offsetValue = z.number().int().refine(isReleaseOffsetMs, 'Release offset must be from -2000 ms through 0 ms.');
const attemptOffset = offsetValue.optional();
/** One exact Precision target: one court, one start, 1-3 hours. Workers A-G follow row order. */
export const PrecisionTargetSchema = z.object({ court: z.number().int().min(1).max(7), start: hour, durationHours: z.number().int().min(1).max(3),
  releaseOffsetMs: attemptOffset, fanOutReleaseOffsetsMs:z.array(offsetValue).length(PRECISION_FAN_OUT_ATTEMPTS).optional() }).strict();
const precisionFanOut = z.boolean().default(false);
const releaseStrategy = z.enum(['general','precision']).default('general');
// Saved plan only (never read from the environment); see release-offset.ts.
const releaseOffset = z.number().int().refine(isReleaseOffsetMs, 'Release offset must be from -2000 ms through 0 ms.').default(0);
const precisionTargets = z.array(PrecisionTargetSchema).max(PRECISION_MAX_ATTEMPTS).default([]);
const precisionWorker=z.enum(['A','B','C','D','E','F','G']);
const rateEvidence=z.object({source:z.string().min(1).max(100),capturedAt:z.iso.datetime(),status:z.enum(['TARGET_DATE_PUBLISHED','VENUE_SCHEDULE','OPERATOR_CONFIRMED','REFERENCE']),
  date:z.iso.date(),perHour:z.array(z.number().positive()).min(1).max(3),actionable:z.boolean()}).strict();
export const PrecisionPhase3Schema=z.object({
  candidates:z.array(z.object({court:z.number().int().min(1).max(7),start:hour,durationHours:z.number().int().min(1).max(3),
    priority:z.number().int().min(1),permissions:z.object({wave1:z.boolean(),wave2:z.boolean(),rescue:z.boolean()}).strict(),rateEvidence,
    // Planning-time public evidence; the override marker keeps a deliberately force-included conflicting slot at freeze.
    publicEvidence:z.object({evidence:z.enum(['NO_KNOWN_PUBLIC_CONFLICT','KNOWN_PUBLIC_BOOKING_CONFLICT','UNKNOWN_PUBLIC_QUERY_FAILED','PUBLISHED_OPEN','PUBLISHED_UNAVAILABLE']),
      override:z.literal('OPERATOR_OVERRIDE_PUBLIC_CONFLICT').optional()}).strict().optional()}).strict()).min(1).max(PRECISION_MAX_CANDIDATES),
  // fanOutOffsetsMs: 2-4 independently tracked children of this immediate target, one Release Offset each (index order).
  wave1:z.array(z.object({workerId:precisionWorker,candidateIndex:z.number().int().min(0).max(PRECISION_MAX_CANDIDATES-1),releaseOffsetMs:attemptOffset,
    fanOutOffsetsMs:z.array(offsetValue).min(2).max(PRECISION_MAX_FAN_OUT).optional()}).strict()).min(1).max(7),
  standby:z.array(precisionWorker).max(7),budgets:z.object({wave2:z.number().int().min(0).max(7),rescue:z.number().int().min(0).max(7),total:z.number().int().min(1).max(PRECISION_MAX_SENDS)}).strict(),
  concurrentWave2:z.boolean(),rescueEnabled:z.boolean(),
}).strict();
/**
 * Strategy Engine V2 metadata: the operator's goal, preset and fan-out/timing choices, so the Strategy view can reopen and
 * regenerate the plan. It never decides what is sent: PRECISION_PHASE3 (compiled from it) is the only authorization, and
 * this object is not part of the plan fingerprint.
 */
export const StrategyV2Schema=z.object({version:z.literal(1),preset:z.enum(['BALANCED','RELEASE_FOCUSED','RESCUE_FOCUSED','CUSTOM']),
  goal:z.object({primeFrom:hour,primeUntil:z.string().regex(/^(09|1\d|2[0-3]):00$|^24:00$/),durations:z.array(z.number().int().min(1).max(3)).min(1).max(3),
    courts:z.array(z.number().int().min(1).max(7)).min(1).max(7),preferredStart:hour.optional()}).strict(),
  fanOut:z.object({width:z.number().int().min(1).max(PRECISION_MAX_FAN_OUT),source:z.enum(['MACHINE_RECOMMENDED','OPERATOR_OVERRIDE','NO_PROFILE']),
    acceptedSource:z.enum(['MACHINE_RECOMMENDED','OPERATOR_OVERRIDE','NO_PROFILE']).optional(),
    recommendedWidth:z.number().int().min(1).max(PRECISION_MAX_FAN_OUT).nullable(),timing:z.enum(['TIGHT','BALANCED','WIDE','CUSTOM']),
    basedOnTiming:z.enum(['TIGHT','BALANCED','WIDE']).optional(),profileCreatedAt:z.string().max(40).nullable()}).strict(),
  timingCalibration:z.object({spacingSource:z.enum(['MACHINE_PROFILE','FALLBACK']),anchorSource:z.enum(['LIVE_CALIBRATION','RELEASE_CENTERED_FALLBACK','OPERATOR_OVERRIDE']),
    groupShiftMs:z.number().int().min(-2000).max(0),matchingReleases:z.number().int().min(0),matchingSamples:z.number().int().min(0),
    evidenceStrength:z.enum(['NONE','LIMITED','USABLE','STRONG']),generatedAt:z.iso.datetime().optional(),
    deskew:z.object({capMs:z.number().int().min(0).max(50),source:z.enum(['LIVE_CALIBRATION','INSUFFICIENT_EVIDENCE']),
      corrections:z.array(z.object({workerId:precisionWorker,fanOutIndex:z.number().int().min(0).max(PRECISION_MAX_FAN_OUT-1),correctionMs:z.number().int().min(-50).max(50),
        matchingReleases:z.number().int().min(0),evidenceStrength:z.enum(['NONE','LIMITED','USABLE','STRONG'])}).strict()).max(28)}).strict().optional()}).strict().optional(),
  // Reset baseline only. It never authorizes execution; the sibling PRECISION_PHASE3 remains the sole current authority.
  acceptedPhase3:PrecisionPhase3Schema.optional(),
  lineage:z.object({immediate:z.array(z.string().regex(/^I\d+$/).nullable()).max(7),backups:z.array(z.string().regex(/^B\d+$/).nullable()).max(21)}).strict().optional(),
  intelligenceMode:z.enum(['AUTO','PREFERENCE_ONLY']).optional(),
  provenance:z.object({source:z.enum(['SMART_SUGGESTED','EXISTING_SMART_PLAN','OPERATOR_BUILT']),operatorModifications:z.number().int().min(0)}).strict().optional()}).strict();
export const ReleaseLabSetupSchema=z.object({version:z.literal(1),kind:z.literal('DURATION_OFFSET_V1'),label:z.literal('Duration × Offset')}).strict();
function checkReleaseOffset(c:{RELEASE_OFFSET_MS:number;BOOKING_METHOD:string;RELEASE_STRATEGY:string},ctx:z.RefinementCtx){
  if(c.RELEASE_OFFSET_MS!==0&&c.BOOKING_METHOD!=='proofless')ctx.addIssue({code:'custom',message:'Release Offset applies to Proofless Direct only.',path:['RELEASE_OFFSET_MS']});
  // Precision chooses the offset on each attempt instead.
  if(c.RELEASE_OFFSET_MS!==0&&c.RELEASE_STRATEGY==='precision')ctx.addIssue({code:'custom',message:'Precision Release sets the offset on each attempt.',path:['RELEASE_OFFSET_MS']});
}
function checkPrecision(c:{RELEASE_STRATEGY:'general'|'precision';BOOKING_METHOD:string;BOOKING_TYPE:string;PRECISION_TARGETS:z.infer<typeof PrecisionTargetSchema>[];PRECISION_FAN_OUT:boolean;PRECISION_PHASE3?:z.infer<typeof PrecisionPhase3Schema>;RELEASE_LAB?:z.infer<typeof ReleaseLabSetupSchema>;STRATEGY_V2?:z.infer<typeof StrategyV2Schema>},ctx:z.RefinementCtx){
  if(c.STRATEGY_V2&&(c.RELEASE_STRATEGY!=='precision'||!c.PRECISION_PHASE3))ctx.addIssue({code:'custom',message:'Strategy V2 settings require a Smart Precision plan.',path:['STRATEGY_V2']});
  if(c.RELEASE_LAB&&(c.RELEASE_STRATEGY!=='precision'||!c.PRECISION_PHASE3))ctx.addIssue({code:'custom',message:'Release Lab requires a Smart Precision plan.',path:['RELEASE_LAB']});
  if(c.PRECISION_FAN_OUT&&(c.RELEASE_STRATEGY!=='precision'||!!c.PRECISION_PHASE3))ctx.addIssue({code:'custom',message:'Fan-out is available only for Fixed Precision Release.',path:['PRECISION_FAN_OUT']});
  if(c.RELEASE_STRATEGY!=='precision')return;
  if(c.BOOKING_METHOD!=='proofless')ctx.addIssue({code:'custom',message:'Precision Release uses Proofless Direct only.',path:['BOOKING_METHOD']});
  if(c.BOOKING_TYPE!=='standard')ctx.addIssue({code:'custom',message:'Precision Release supports Standard 1-3 hour targets only.',path:['BOOKING_TYPE']});
  if(c.PRECISION_PHASE3){
    const p=c.PRECISION_PHASE3,workers=[...p.wave1.map(value=>value.workerId),...p.standby];
    if(new Set(workers).size!==workers.length)ctx.addIssue({code:'custom',message:'Precision workers must be unique across Wave 1 and standby.',path:['PRECISION_PHASE3']});
    if(p.wave1.some(value=>!p.candidates[value.candidateIndex]?.permissions.wave1))ctx.addIssue({code:'custom',message:'Wave 1 assignment must name a Wave 1 eligible candidate.',path:['PRECISION_PHASE3']});
    if(p.wave1.some(value=>p.candidates[value.candidateIndex]?.rateEvidence.status==='REFERENCE'||
      !p.candidates[value.candidateIndex]?.rateEvidence.actionable))ctx.addIssue({code:'custom',message:'Wave 1 requires actionable, explicitly confirmed rate evidence.',path:['PRECISION_PHASE3']});
    if(p.wave1.some(value=>value.fanOutOffsetsMs&&value.releaseOffsetMs!==undefined))ctx.addIssue({code:'custom',message:'A fan-out target sets one offset per child, not a single Release Offset.',path:['PRECISION_PHASE3']});
    // Every fan-out child is a send and counts against the total budget.
    const wave1Sends=p.wave1.reduce((sum,value)=>sum+(value.fanOutOffsetsMs?.length??1),0);
    if(p.budgets.wave2>p.standby.length||p.budgets.total<wave1Sends||p.budgets.total>wave1Sends+p.budgets.wave2+p.budgets.rescue||
      (p.budgets.rescue>0&&!p.rescueEnabled))ctx.addIssue({code:'custom',message:'Precision dispatch budgets are inconsistent.',path:['PRECISION_PHASE3']});
    for(const candidate of p.candidates)if(Number(candidate.start.slice(0,2))+candidate.durationHours>24||candidate.rateEvidence.perHour.length!==candidate.durationHours)
      ctx.addIssue({code:'custom',message:'Candidate duration or hourly rate is invalid.',path:['PRECISION_PHASE3']});
    for(const [index,candidate] of p.candidates.entries())for(const other of p.candidates.slice(index+1))
      if(candidate.court===other.court&&candidate.start===other.start&&candidate.durationHours===other.durationHours)
        ctx.addIssue({code:'custom',message:'Exact duplicate Precision candidate.',path:['PRECISION_PHASE3']});
    for(const [index,assignment] of p.wave1.entries())for(const other of p.wave1.slice(index+1)){
      const a=p.candidates[assignment.candidateIndex],b=p.candidates[other.candidateIndex];
      if(assignment.candidateIndex===other.candidateIndex||a&&b&&a.court===b.court&&
        Number(a.start.slice(0,2))<Number(b.start.slice(0,2))+b.durationHours&&
        Number(b.start.slice(0,2))<Number(a.start.slice(0,2))+a.durationHours)
        ctx.addIssue({code:'custom',message:'Wave 1 assignments conflict on the same court and time.',path:['PRECISION_PHASE3']});
    }
    return;
  }
  const t=c.PRECISION_TARGETS;
  if(t.length<1||t.length>PRECISION_MAX_ATTEMPTS)ctx.addIssue({code:'custom',message:`Configure 1 to ${PRECISION_MAX_ATTEMPTS} Precision attempts.`,path:['PRECISION_TARGETS']});
  if(c.PRECISION_FAN_OUT&&t.some(value=>value.fanOutReleaseOffsetsMs?.length!==PRECISION_FAN_OUT_ATTEMPTS))ctx.addIssue({code:'custom',message:`Fan-out requires exactly ${PRECISION_FAN_OUT_ATTEMPTS} offsets per worker.`,path:['PRECISION_TARGETS']});
  if(!c.PRECISION_FAN_OUT&&t.some(value=>value.fanOutReleaseOffsetsMs!==undefined))ctx.addIssue({code:'custom',message:'Fan-out offsets require Fixed Precision fan-out.',path:['PRECISION_TARGETS']});
  const end=(x:{start:string;durationHours:number})=>Number(x.start.slice(0,2))+x.durationHours;
  if(t.some(x=>end(x)>24))ctx.addIssue({code:'custom',message:'A Precision attempt would end after midnight.',path:['PRECISION_TARGETS']});
  for(const [i,a] of t.entries())for(const b of t.slice(i+1))if(a.court===b.court&&Number(a.start.slice(0,2))<end(b)&&Number(b.start.slice(0,2))<end(a))
    ctx.addIssue({code:'custom',message:'Two Precision attempts overlap on the same court.',path:['PRECISION_TARGETS']});
}
export const ConfigSchema = z.object({
  BOOKING_METHOD: z.enum(['browser','hybrid','api-first','proofless']).default('browser'),
  BOOKING_TYPE: z.enum(['standard','extended']).default('standard'),
  RELEASE_STRATEGY: releaseStrategy,
  PRECISION_TARGETS: precisionTargets,
  PRECISION_FAN_OUT: precisionFanOut,
  PRECISION_PHASE3: PrecisionPhase3Schema.optional(),
  RELEASE_LAB: ReleaseLabSetupSchema.optional(),
  STRATEGY_V2: StrategyV2Schema.optional(),
  RELEASE_OFFSET_MS: releaseOffset,
  COURT_COUNT: z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4),z.literal(5),z.literal(6),z.literal(7)]).default(1),
  ONDA_URL: z.literal(ONDA_URL).default(ONDA_URL),
  TIMEZONE: z.string().refine(v => IANAZone.isValidZone(v), 'Invalid timezone').default('Asia/Manila'),
  RELEASE_TIME: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/).default('08:00:00'),
  BOOKING_HORIZON_DAYS: z.coerce.number().int().min(0).max(30).default(2),
  START_TIME: hour,
  DURATION_HOURS: z.coerce.number().int().min(1).max(6),
  PREFERRED_COURTS: courts.min(1), FALLBACK_COURTS: courts.default([]),
  FALLBACK_TIMES: z.array(hour).default([]),
  // Legacy runtime argument only. Availability and checkout never cap price.
  MAX_PRICE: z.number().default(Infinity),
  MAX_SELECTION_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  PAYMENT_HANDOFF_VERIFY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
  PAYMENT_SUMMARY_READY_TIMEOUT_MS: z.coerce.number().int().min(3000).max(120000).default(60000),
  PLAYER_B_FULL_NAME: z.string().optional(),
  PLAYER_B_PHONE: z.string().optional(),
  PLAYER_B_EMAIL: z.string().optional(),
  PLAYER_C_FULL_NAME: z.string().optional(),
  PLAYER_C_PHONE: z.string().optional(),
  PLAYER_C_EMAIL: z.string().optional(),
  PLAYER_D_FULL_NAME: z.string().optional(),
  PLAYER_D_PHONE: z.string().optional(),
  PLAYER_D_EMAIL: z.string().optional(),
  PLAYER_E_FULL_NAME: z.string().optional(), PLAYER_E_PHONE: z.string().optional(), PLAYER_E_EMAIL: z.string().optional(),
  PLAYER_F_FULL_NAME: z.string().optional(), PLAYER_F_PHONE: z.string().optional(), PLAYER_F_EMAIL: z.string().optional(),
  PLAYER_G_FULL_NAME: z.string().optional(), PLAYER_G_PHONE: z.string().optional(), PLAYER_G_EMAIL: z.string().optional(),
  PLAYER_H_FULL_NAME: z.string().optional(), PLAYER_H_PHONE: z.string().optional(), PLAYER_H_EMAIL: z.string().optional(),
  PLAYER_FULL_NAME: z.string().trim().min(2),
  PLAYER_PHONE: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{6,19}$/),
  PLAYER_EMAIL: z.email(),
  CDP_URL: z.string().refine(v => { try { const u = new URL(v); return u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.port === '9222' && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password; } catch { return false; } }, 'Use http://127.0.0.1:9222').default('http://127.0.0.1:9222'),
  // Early release is intentionally unavailable until measurements justify it.
  RELEASE_LEAD_MS: z.coerce.number().int().min(0).max(0).default(0),
  // Enable only after confirming the live calendar remains open through release.
  RELEASE_PREOPEN_CALENDAR: z.preprocess(v => v === 'true' ? true : v === 'false' ? false : v, z.boolean()).default(false),
  AVAILABILITY_DISCOVERY_MODE: z.enum(['ui', 'hybrid']).default('ui'),
  MAX_RELEASE_RELOADS: z.coerce.number().int().min(1).max(2).default(2),
  RELEASE_RETRY_DELAY_MS: z.coerce.number().int().min(500).max(10000).default(1000),
  PREFLIGHT_SECONDS_BEFORE: z.coerce.number().int().min(10).max(120).default(15),
  // Lightweight desktop scheduler wake-up. This is deliberately separate from
  // release lead (which remains zero) and gives the bounded 60s Chrome startup
  // path time to reconnect before the existing final preflight.
  SCHEDULE_WAKE_SECONDS_BEFORE: z.coerce.number().int().min(30).max(300).default(90),
  CRITICAL_STEP_TIMEOUT_MS: z.coerce.number().int().min(3000).max(60000).default(15000),
}).superRefine((c, ctx) => {
  if(c.BOOKING_TYPE==='standard'?c.DURATION_HOURS>3:c.DURATION_HOURS<4)ctx.addIssue({code:'custom',message:'Standard supports 1-3h; Extended supports 4-6h',path:['DURATION_HOURS']});
  if(c.COURT_COUNT>2&&!['api-first','proofless'].includes(c.BOOKING_METHOD))ctx.addIssue({code:'custom',message:'Three to seven courts require API-FIRST or PROOFLESS DIRECT.',path:['COURT_COUNT']});
  const allCourts = [...c.PREFERRED_COURTS, ...c.FALLBACK_COURTS];
  const times = [c.START_TIME, ...c.FALLBACK_TIMES];
  if (new Set(allCourts).size !== allCourts.length) ctx.addIssue({ code: 'custom', message: 'Duplicate court preference', path: ['PREFERRED_COURTS'] });
  if (new Set(times).size !== times.length) ctx.addIssue({ code: 'custom', message: 'Duplicate time preference', path: ['FALLBACK_TIMES'] });
  if (times.some(t => Number(t.slice(0, 2)) + c.DURATION_HOURS > 24)) ctx.addIssue({ code: 'custom', message: 'Booking crosses midnight', path: ['DURATION_HOURS'] });
  checkPrecision(c, ctx);
  checkReleaseOffset(c, ctx);
});
export type Config = z.infer<typeof ConfigSchema>;
export const ObservationSchema = z.object({
  ONDA_URL: ConfigSchema.shape.ONDA_URL, TIMEZONE: ConfigSchema.shape.TIMEZONE,
  RELEASE_TIME: ConfigSchema.shape.RELEASE_TIME, BOOKING_HORIZON_DAYS: ConfigSchema.shape.BOOKING_HORIZON_DAYS,
  RELEASE_LEAD_MS: ConfigSchema.shape.RELEASE_LEAD_MS, MAX_RELEASE_RELOADS: ConfigSchema.shape.MAX_RELEASE_RELOADS,
  RELEASE_PREOPEN_CALENDAR: ConfigSchema.shape.RELEASE_PREOPEN_CALENDAR,
  AVAILABILITY_DISCOVERY_MODE: ConfigSchema.shape.AVAILABILITY_DISCOVERY_MODE,
  RELEASE_RETRY_DELAY_MS: ConfigSchema.shape.RELEASE_RETRY_DELAY_MS, PREFLIGHT_SECONDS_BEFORE: ConfigSchema.shape.PREFLIGHT_SECONDS_BEFORE,
  SCHEDULE_WAKE_SECONDS_BEFORE: ConfigSchema.shape.SCHEDULE_WAKE_SECONDS_BEFORE,
  CRITICAL_STEP_TIMEOUT_MS: ConfigSchema.shape.CRITICAL_STEP_TIMEOUT_MS,
});
export type ReleaseSettings = z.infer<typeof ObservationSchema>;
function environment() {
  const privatePath=process.env.THIRSTY_API_INSTALLATION==='1'||process.env.THIRSTY_API_TEST_INSTALLATION==='1'?'.local/private/.env.local':'.env.local';
  const extraPlayersPath=process.env.THIRSTY_API_INSTALLATION==='1'||process.env.THIRSTY_API_TEST_INSTALLATION==='1'
    ? '.local/private/players-e-h.env' : '../.local/private/players-e-h.env';
  return { ...process.env, ...(existsSync(privatePath) ? parseEnv(readFileSync(privatePath)) : {}),
    ...(existsSync(extraPlayersPath)?parseEnv(readFileSync(extraPlayersPath)):{}) };
}
export function loadObservationConfig(): ReleaseSettings {
  const parsed = ObservationSchema.safeParse(environment());
  if (!parsed.success) throw new Error(`CONFIG_INVALID: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return parsed.data;
}
type TestRuntimeSetup={method?:'browser'|'hybrid'|'api-first'|'proofless';strategy:'standard'|'extended';courtCount:CourtCount;start:string;duration:number;priority:number[];fallbackStarts:string[];maximum?:number};
function parseConfig(includeSaved:boolean,test?:TestRuntimeSetup):{config:Config;fallbackReconciliation:FallbackReconciliation} {
  const env = environment();
  let fallbackReconciliation:FallbackReconciliation={valid:[],removed:[]};
  const raw: Record<string, unknown> = { START_TIME:'08:00', DURATION_HOURS:2, PREFERRED_COURTS:[7,6,5,4,3,2,1], FALLBACK_COURTS:[], FALLBACK_TIMES:[] };
  for (const key of Object.keys(ConfigSchema.shape)) if (key!=='MAX_PRICE'&&key!=='RELEASE_OFFSET_MS'&&key!=='PRECISION_FAN_OUT'&&env[key] !== undefined) raw[key] = env[key];
  for (const key of ['PREFERRED_COURTS', 'FALLBACK_COURTS', 'FALLBACK_TIMES']) {
    if (typeof raw[key] === 'string') raw[key] = (raw[key] as string).split(',').map(s => s.trim()).filter(Boolean).map(s => key === 'FALLBACK_TIMES' ? s : Number(s));
  }
  if (['1','2','3','4','5','6','7'].includes(String(raw.COURT_COUNT))) raw.COURT_COUNT = Number(raw.COURT_COUNT);
  if (includeSaved&&existsSync('config.local.json')) {
    const repaired=reconcileBookingSetupFallbacks(JSON.parse(readFileSync('config.local.json', 'utf8')));
    fallbackReconciliation=repaired.reconciliation;
    Object.assign(raw, BookingSetupSchema.parse(repaired.setup));
  }
  if(test)Object.assign(raw,{...(test.method?{BOOKING_METHOD:test.method}:{}),BOOKING_TYPE:test.strategy,COURT_COUNT:test.courtCount,START_TIME:test.start,DURATION_HOURS:test.duration,PREFERRED_COURTS:test.priority,FALLBACK_COURTS:[],FALLBACK_TIMES:test.fallbackStarts});
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`CONFIG_INVALID: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return {config:parsed.data,fallbackReconciliation};
}
export function loadConfig():Config{return parseConfig(true).config;}
export function loadConfigWithReconciliation(){return parseConfig(true);}
// Test Now uses environment/player/runtime settings without parsing or applying
// the saved Release draft in config.local.json.
export function loadTestRuntimeConfig(test:TestRuntimeSetup):Config{return parseConfig(false,test).config;}
// Narrow, PII-free local settings; renderer cannot change URLs, release time or player data.
// It can choose any whole-millisecond release offset in the guarded range (release-offset.ts).
export const BookingSetupSchema = z.object({
  BOOKING_METHOD: ConfigSchema.shape.BOOKING_METHOD,
  BOOKING_TYPE: ConfigSchema.shape.BOOKING_TYPE,
  RELEASE_STRATEGY: releaseStrategy,
  PRECISION_TARGETS: precisionTargets,
  PRECISION_FAN_OUT: precisionFanOut,
  PRECISION_PHASE3: PrecisionPhase3Schema.optional(),
  RELEASE_LAB: ReleaseLabSetupSchema.optional(),
  STRATEGY_V2: StrategyV2Schema.optional(),
  RELEASE_OFFSET_MS: releaseOffset,
  COURT_COUNT: ConfigSchema.shape.COURT_COUNT,
  START_TIME: hour, DURATION_HOURS: z.number().int().min(1).max(6),
  PREFERRED_COURTS: courts.length(7), FALLBACK_COURTS: z.array(z.never()).default([]),
  FALLBACK_TIMES: z.array(hour).max(15),
  MAX_SELECTION_ATTEMPTS: z.number().int().min(1).max(5).default(3),
}).strict().superRefine((c, ctx) => {
  if(c.BOOKING_TYPE==='standard'?c.DURATION_HOURS>3:c.DURATION_HOURS<4)ctx.addIssue({code:'custom',message:c.BOOKING_TYPE==='standard'?'Standard bookings must be 1–3 hours.':'Extended bookings must be 4–6 hours.',path:['DURATION_HOURS']});
  if(c.COURT_COUNT>2&&!['api-first','proofless'].includes(c.BOOKING_METHOD))ctx.addIssue({code:'custom',message:'Three to seven courts require API-FIRST or PROOFLESS DIRECT.',path:['COURT_COUNT']});
  if (new Set(c.PREFERRED_COURTS).size !== 7) ctx.addIssue({ code: 'custom', message: 'Court priority is invalid.', path:['PREFERRED_COURTS'] });
  if(Number(c.START_TIME.slice(0,2))+c.DURATION_HOURS>24)ctx.addIssue({code:'custom',message:'The main booking would end after midnight.',path:['START_TIME']});
  checkPrecision(c,ctx);
  checkReleaseOffset(c,ctx);
  const fallback=reconcileFallbackTimes(c.START_TIME,c.DURATION_HOURS,c.FALLBACK_TIMES).removed[0];
  if(fallback)ctx.addIssue({code:'custom',message:fallback.reason==='DUPLICATES_PRIMARY_START'?'A fallback duplicates the main start.':fallback.reason==='DUPLICATE_FALLBACK'?'A fallback start appears more than once.':fallback.reason==='CROSSES_MIDNIGHT'?`Fallback ${fallback.time} is not valid for a ${c.DURATION_HOURS}-hour booking.`:'A fallback start has an invalid time format.',path:['FALLBACK_TIMES']});
});
export type BookingSetup = z.infer<typeof BookingSetupSchema>;
export interface Preference { court: number; hours: string[] }
export function expandHours(start: string, duration: number): string[] {
  if (!/^(0\d|1\d|2[0-3]):00$/.test(start) || !Number.isInteger(duration) || duration < 1 || Number(start.slice(0, 2)) + duration > 24) throw new Error('INVALID_HOURS');
  return Array.from({ length: duration }, (_, i) => `${String(Number(start.slice(0, 2)) + i).padStart(2, '0')}:00`);
}
export function compilePreferences(c: Pick<Config, 'START_TIME' | 'DURATION_HOURS' | 'PREFERRED_COURTS' | 'FALLBACK_COURTS' | 'FALLBACK_TIMES'>): Preference[] {
  return [c.START_TIME, ...c.FALLBACK_TIMES].flatMap(t => [...c.PREFERRED_COURTS, ...c.FALLBACK_COURTS].map(court => ({ court, hours: expandHours(t, c.DURATION_HOURS) })));
}
export function calculateTarget(c: Pick<Config, 'TIMEZONE' | 'RELEASE_TIME' | 'BOOKING_HORIZON_DAYS' | 'START_TIME' | 'DURATION_HOURS' | 'PREFERRED_COURTS' | 'FALLBACK_COURTS' | 'FALLBACK_TIMES'>, now: DateTime = DateTime.fromMillis(networkNowMs())) {
  return { ...releaseCalendar(c, now), preferences: compilePreferences(c) };
}
export function planFingerprint(c: Config) {
  return createHash('sha256').update(JSON.stringify({
    method:c.BOOKING_METHOD, strategy:c.BOOKING_TYPE, courtCount:c.COURT_COUNT,
    schedule: ObservationSchema.parse(c), target: calculateTarget(c), attempts:c.MAX_SELECTION_ATTEMPTS,
    // Present only for Precision, so a General plan keeps exactly its previous fingerprint.
    ...(c.RELEASE_STRATEGY==='precision'?{releaseStrategy:'precision',precisionTargets:c.PRECISION_TARGETS,precisionFanOut:c.PRECISION_FAN_OUT,precisionPhase3:c.PRECISION_PHASE3,
      ...(c.RELEASE_LAB?{releaseLab:c.RELEASE_LAB}:{})}:{}),
    // Likewise present only when non-zero; a changed offset after arming is a changed plan.
    ...(c.RELEASE_OFFSET_MS?{releaseOffsetMs:c.RELEASE_OFFSET_MS}:{}) })).digest('hex');
}
export function releaseCalendar(c: Pick<Config, 'TIMEZONE' | 'RELEASE_TIME' | 'BOOKING_HORIZON_DAYS'>, now: DateTime = DateTime.fromMillis(networkNowMs())) {
  const local = now.setZone(c.TIMEZONE);
  const today = DateTime.fromISO(`${local.toISODate()}T${c.RELEASE_TIME}`, { zone: c.TIMEZONE });
  const release = today.toMillis() > now.toMillis() ? today : today.plus({days:1});
  if (!release.isValid) throw new Error('INVALID_RELEASE_DATE');
  return { targetDate: release.startOf('day').plus({ days: c.BOOKING_HORIZON_DAYS }).toISODate()!, releaseMs: release.toMillis(), releaseISO: release.toISO()! };
}

/** The release instant that publishes `targetDate` (release day = target − horizon, at RELEASE_TIME). */
export function releaseMsForTargetDate(c: Pick<Config, 'TIMEZONE' | 'RELEASE_TIME' | 'BOOKING_HORIZON_DAYS'>, targetDate: string): number {
  const target = DateTime.fromISO(targetDate, { zone: c.TIMEZONE });
  if (!target.isValid || target.toISODate() !== targetDate) throw Error('INVALID_TARGET_DATE');
  const release = releaseCalendarOn(c, target.minus({ days: c.BOOKING_HORIZON_DAYS }).toISODate()!);
  if (release.targetDate !== targetDate) throw Error('INVALID_TARGET_DATE');
  return release.releaseMs;
}

/** Exact calendar release used only when a caller has already chosen the day. */
export function releaseCalendarOn(c: Pick<Config, 'TIMEZONE' | 'RELEASE_TIME' | 'BOOKING_HORIZON_DAYS'>, releaseDate:string) {
  const release=DateTime.fromISO(`${releaseDate}T${c.RELEASE_TIME}`,{zone:c.TIMEZONE});
  if(!release.isValid||release.toISODate()!==releaseDate)throw Error('INVALID_RELEASE_DATE');
  return {targetDate:release.startOf('day').plus({days:c.BOOKING_HORIZON_DAYS}).toISODate()!,releaseMs:release.toMillis(),releaseISO:release.toISO()!};
}

// Profile values are exposed only to the local desktop UI for operator review.
const PlayerSchema=z.object({fullName:z.string().trim().min(2),phone:z.string().trim().regex(/^(?:0|\+?63)?9\d{9}$/),email:z.email()});
type PlayerFields=Pick<Config,'PLAYER_FULL_NAME'|'PLAYER_PHONE'|'PLAYER_EMAIL'|'PLAYER_B_FULL_NAME'|'PLAYER_B_PHONE'|'PLAYER_B_EMAIL'|'PLAYER_C_FULL_NAME'|'PLAYER_C_PHONE'|'PLAYER_C_EMAIL'|'PLAYER_D_FULL_NAME'|'PLAYER_D_PHONE'|'PLAYER_D_EMAIL'|'PLAYER_E_FULL_NAME'|'PLAYER_E_PHONE'|'PLAYER_E_EMAIL'|'PLAYER_F_FULL_NAME'|'PLAYER_F_PHONE'|'PLAYER_F_EMAIL'|'PLAYER_G_FULL_NAME'|'PLAYER_G_PHONE'|'PLAYER_G_EMAIL'|'PLAYER_H_FULL_NAME'|'PLAYER_H_PHONE'|'PLAYER_H_EMAIL'>;
export function primaryPlayer(c:PlayerFields){
  const parsed=PlayerSchema.safeParse({fullName:c.PLAYER_FULL_NAME,phone:c.PLAYER_PHONE.replace(/[ ()-]/g,''),email:c.PLAYER_EMAIL});
  if(!parsed.success)throw Error('PLAYER_INFO_MISSING');return parsed.data;
}
export function extendedPlayer(c:PlayerFields){
  const parsed=PlayerSchema.safeParse({fullName:c.PLAYER_B_FULL_NAME,phone:c.PLAYER_B_PHONE?.replace(/[ ()-]/g,''),email:c.PLAYER_B_EMAIL});
  if(!parsed.success)throw Error('EXTENDED_PLAYER_INFO_MISSING');
  const a=primaryPlayer(c),b=parsed.data;
  const phone=(p:string)=>p.replace(/^(?:0|\+?63)/,'');
  if(b.email.toLowerCase()===a.email.toLowerCase()||phone(b.phone)===phone(a.phone))throw Error('EXTENDED_PLAYER_INFO_MISSING');
  return b;
}
const workerFields=(env:NodeJS.ProcessEnv):PlayerFields=>({
  PLAYER_FULL_NAME:String(env.PLAYER_FULL_NAME??''),PLAYER_PHONE:String(env.PLAYER_PHONE??''),PLAYER_EMAIL:String(env.PLAYER_EMAIL??''),
  PLAYER_B_FULL_NAME:env.PLAYER_B_FULL_NAME,PLAYER_B_PHONE:env.PLAYER_B_PHONE,PLAYER_B_EMAIL:env.PLAYER_B_EMAIL,
  PLAYER_C_FULL_NAME:env.PLAYER_C_FULL_NAME,PLAYER_C_PHONE:env.PLAYER_C_PHONE,PLAYER_C_EMAIL:env.PLAYER_C_EMAIL,
  PLAYER_D_FULL_NAME:env.PLAYER_D_FULL_NAME,PLAYER_D_PHONE:env.PLAYER_D_PHONE,PLAYER_D_EMAIL:env.PLAYER_D_EMAIL,
  PLAYER_E_FULL_NAME:env.PLAYER_E_FULL_NAME,PLAYER_E_PHONE:env.PLAYER_E_PHONE,PLAYER_E_EMAIL:env.PLAYER_E_EMAIL,
  PLAYER_F_FULL_NAME:env.PLAYER_F_FULL_NAME,PLAYER_F_PHONE:env.PLAYER_F_PHONE,PLAYER_F_EMAIL:env.PLAYER_F_EMAIL,
  PLAYER_G_FULL_NAME:env.PLAYER_G_FULL_NAME,PLAYER_G_PHONE:env.PLAYER_G_PHONE,PLAYER_G_EMAIL:env.PLAYER_G_EMAIL,
  PLAYER_H_FULL_NAME:env.PLAYER_H_FULL_NAME,PLAYER_H_PHONE:env.PLAYER_H_PHONE,PLAYER_H_EMAIL:env.PLAYER_H_EMAIL,
});
export function playerForWorker(c:PlayerFields,worker:WorkerId){
  if(worker==='A')return primaryPlayer(c);
  if(worker==='B')return extendedPlayer(c);
  const suffix=worker;
  const parsed=PlayerSchema.safeParse({fullName:c[`PLAYER_${suffix}_FULL_NAME`],phone:c[`PLAYER_${suffix}_PHONE`]?.replace(/[ ()-]/g,''),email:c[`PLAYER_${suffix}_EMAIL`]});
  if(!parsed.success)throw Error(`PLAYER_${worker}_INFO_MISSING`);
  const candidate=parsed.data,prior=WORKER_IDS.slice(0,WORKER_IDS.indexOf(worker)).map(id=>playerForWorker(c,id));
  const phone=(p:string)=>p.replace(/^(?:0|\+?63)/,'');
  if(prior.some(player=>player.email.toLowerCase()===candidate.email.toLowerCase()||phone(player.phone)===phone(candidate.phone)))throw Error(`PLAYER_${worker}_INFO_MISSING`);
  return candidate;
}
export function playerReadiness(c:PlayerFields){
  const ready={primary:false,extended:false,third:false,fourth:false,fifth:false,sixth:false,seventh:false,eighth:false};
  for(const [worker,key] of [['A','primary'],['B','extended'],['C','third'],['D','fourth'],['E','fifth'],['F','sixth'],['G','seventh'],['H','eighth']] as const)try{playerForWorker(c,worker);ready[key]=true;}catch{}
  return ready;
}
export function loadPlayerReadiness(){
  const env=environment();
  return playerReadiness(workerFields(env));
}
export function loadPlayerProfiles(){
  const env=environment();
  const fields=workerFields(env),profiles:Partial<Record<WorkerId,ReturnType<typeof primaryPlayer>>>={};
  for(const worker of WORKER_IDS)try{profiles[worker]=playerForWorker(fields,worker);}catch{}
  return {primary:!!profiles.A,extended:!!profiles.B,third:!!profiles.C,fourth:!!profiles.D,
    fifth:!!profiles.E,sixth:!!profiles.F,seventh:!!profiles.G,eighth:!!profiles.H,
    primaryDetails:profiles.A,extendedDetails:profiles.B,thirdDetails:profiles.C,fourthDetails:profiles.D,
    fifthDetails:profiles.E,sixthDetails:profiles.F,seventhDetails:profiles.G,eighthDetails:profiles.H};
}
export function bookingPlayers(c:Config,strategy:'standard'|'extended'){
  return strategy==='extended'?{A:primaryPlayer(c),B:extendedPlayer(c)}:{A:primaryPlayer(c),B:undefined};
}
