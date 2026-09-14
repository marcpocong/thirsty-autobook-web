import { z } from 'zod';
import { DateTime, IANAZone } from 'luxon';
import { parse as parseEnv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const ONDA_URL = 'https://app.onda.fit/book/thirsty-pickle';
export const VENUE = 'Thirsty Pickle | SM Seaside';
const hour = z.string().regex(/^(0[89]|1[0-9]|2[0-3]):00$/);
const courts = z.array(z.number().int().min(1).max(7));
export const ConfigSchema = z.object({
  BOOKING_TYPE: z.enum(['standard','extended']).default('standard'),
  COURT_COUNT: z.union([z.literal(1), z.literal(2)]).default(1),
  ONDA_URL: z.literal(ONDA_URL).default(ONDA_URL),
  TIMEZONE: z.string().refine(v => IANAZone.isValidZone(v), 'Invalid timezone').default('Asia/Manila'),
  RELEASE_TIME: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/).default('08:00:00'),
  BOOKING_HORIZON_DAYS: z.coerce.number().int().min(0).max(30).default(2),
  START_TIME: hour,
  DURATION_HOURS: z.coerce.number().int().min(1).max(6),
  PREFERRED_COURTS: courts.min(1), FALLBACK_COURTS: courts.default([]),
  FALLBACK_TIMES: z.array(hour).default([]),
  MAX_PRICE: z.coerce.number().finite().positive(),
  MAX_SELECTION_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  PAYMENT_HANDOFF_VERIFY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
  PAYMENT_SUMMARY_READY_TIMEOUT_MS: z.coerce.number().int().min(3000).max(120000).default(60000),
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
  CRITICAL_STEP_TIMEOUT_MS: z.coerce.number().int().min(3000).max(60000).default(15000),
}).superRefine((c, ctx) => {
  if(c.BOOKING_TYPE==='standard'?c.DURATION_HOURS>3:c.DURATION_HOURS<4)ctx.addIssue({code:'custom',message:'Standard supports 1-3h; Extended supports 4-6h',path:['DURATION_HOURS']});
  const allCourts = [...c.PREFERRED_COURTS, ...c.FALLBACK_COURTS];
  const times = [c.START_TIME, ...c.FALLBACK_TIMES];
  if (new Set(allCourts).size !== allCourts.length) ctx.addIssue({ code: 'custom', message: 'Duplicate court preference', path: ['PREFERRED_COURTS'] });
  if (new Set(times).size !== times.length) ctx.addIssue({ code: 'custom', message: 'Duplicate time preference', path: ['FALLBACK_TIMES'] });
  if (times.some(t => Number(t.slice(0, 2)) + c.DURATION_HOURS > 24)) ctx.addIssue({ code: 'custom', message: 'Booking crosses midnight', path: ['DURATION_HOURS'] });
});
export type Config = z.infer<typeof ConfigSchema>;
export const ObservationSchema = z.object({
  ONDA_URL: ConfigSchema.shape.ONDA_URL, TIMEZONE: ConfigSchema.shape.TIMEZONE,
  RELEASE_TIME: ConfigSchema.shape.RELEASE_TIME, BOOKING_HORIZON_DAYS: ConfigSchema.shape.BOOKING_HORIZON_DAYS,
  RELEASE_LEAD_MS: ConfigSchema.shape.RELEASE_LEAD_MS, MAX_RELEASE_RELOADS: ConfigSchema.shape.MAX_RELEASE_RELOADS,
  RELEASE_PREOPEN_CALENDAR: ConfigSchema.shape.RELEASE_PREOPEN_CALENDAR,
  AVAILABILITY_DISCOVERY_MODE: ConfigSchema.shape.AVAILABILITY_DISCOVERY_MODE,
  RELEASE_RETRY_DELAY_MS: ConfigSchema.shape.RELEASE_RETRY_DELAY_MS, PREFLIGHT_SECONDS_BEFORE: ConfigSchema.shape.PREFLIGHT_SECONDS_BEFORE,
  CRITICAL_STEP_TIMEOUT_MS: ConfigSchema.shape.CRITICAL_STEP_TIMEOUT_MS,
});
export type ReleaseSettings = z.infer<typeof ObservationSchema>;
function environment() {
  return { ...process.env, ...(existsSync('.env.local') ? parseEnv(readFileSync('.env.local')) : {}) };
}
export function loadObservationConfig(): ReleaseSettings {
  const parsed = ObservationSchema.safeParse(environment());
  if (!parsed.success) throw new Error(`CONFIG_INVALID: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return parsed.data;
}
export function loadConfig(): Config {
  const env = environment();
  const raw: Record<string, unknown> = { START_TIME:'08:00', DURATION_HOURS:2, PREFERRED_COURTS:[7,6,5,4,3,2,1], FALLBACK_COURTS:[], FALLBACK_TIMES:[], MAX_PRICE:1200 };
  for (const key of Object.keys(ConfigSchema.shape)) if (env[key] !== undefined) raw[key] = env[key];
  for (const key of ['PREFERRED_COURTS', 'FALLBACK_COURTS', 'FALLBACK_TIMES']) {
    if (typeof raw[key] === 'string') raw[key] = (raw[key] as string).split(',').map(s => s.trim()).filter(Boolean).map(s => key === 'FALLBACK_TIMES' ? s : Number(s));
  }
  if (raw.COURT_COUNT === '1' || raw.COURT_COUNT === '2') raw.COURT_COUNT = Number(raw.COURT_COUNT);
  if (existsSync('config.local.json')) Object.assign(raw, BookingSetupSchema.parse(JSON.parse(readFileSync('config.local.json', 'utf8'))));
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`CONFIG_INVALID: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return parsed.data;
}
// Narrow, PII-free local settings; renderer cannot change URLs, release timing or player data.
export const BookingSetupSchema = z.object({
  BOOKING_TYPE: ConfigSchema.shape.BOOKING_TYPE,
  COURT_COUNT: ConfigSchema.shape.COURT_COUNT,
  START_TIME: hour, DURATION_HOURS: z.number().int().min(1).max(6),
  PREFERRED_COURTS: courts.length(7), FALLBACK_COURTS: z.array(z.never()).default([]),
  FALLBACK_TIMES: z.array(hour).max(15), MAX_PRICE: z.number().finite().positive(),
  MAX_SELECTION_ATTEMPTS: z.number().int().min(1).max(5).default(3),
}).strict().superRefine((c, ctx) => {
  if(c.BOOKING_TYPE==='standard'?c.DURATION_HOURS>3:c.DURATION_HOURS<4)ctx.addIssue({code:'custom',message:'Standard supports 1-3h; Extended supports 4-6h'});
  if (new Set(c.PREFERRED_COURTS).size !== 7) ctx.addIssue({ code: 'custom', message: 'Each court must appear once' });
  const times = [c.START_TIME, ...c.FALLBACK_TIMES];
  if (new Set(times).size !== times.length || times.some(t => Number(t.slice(0, 2)) + c.DURATION_HOURS > 24)) ctx.addIssue({ code: 'custom', message: 'Duplicate or out-of-schedule time' });
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
export function calculateTarget(c: Pick<Config, 'TIMEZONE' | 'RELEASE_TIME' | 'BOOKING_HORIZON_DAYS' | 'START_TIME' | 'DURATION_HOURS' | 'PREFERRED_COURTS' | 'FALLBACK_COURTS' | 'FALLBACK_TIMES'>, now: DateTime = DateTime.now()) {
  return { ...releaseCalendar(c, now), preferences: compilePreferences(c) };
}
export function planFingerprint(c: Config) {
  return createHash('sha256').update(JSON.stringify({ strategy:c.BOOKING_TYPE, courtCount:c.COURT_COUNT, schedule: ObservationSchema.parse(c), target: calculateTarget(c), maximum:c.MAX_PRICE, attempts:c.MAX_SELECTION_ATTEMPTS })).digest('hex');
}
export function releaseCalendar(c: Pick<Config, 'TIMEZONE' | 'RELEASE_TIME' | 'BOOKING_HORIZON_DAYS'>, now: DateTime = DateTime.now()) {
  const local = now.setZone(c.TIMEZONE);
  const release = DateTime.fromISO(`${local.toISODate()}T${c.RELEASE_TIME}`, { zone: c.TIMEZONE });
  if (!release.isValid) throw new Error('INVALID_RELEASE_DATE');
  // Never silently switch to tomorrow after missing today's release.
  return { targetDate: local.startOf('day').plus({ days: c.BOOKING_HORIZON_DAYS }).toISODate()!, releaseMs: release.toMillis(), releaseISO: release.toISO()! };
}
