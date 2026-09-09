import { z } from 'zod';
import { DateTime, IANAZone } from 'luxon';
import { config as dotenv } from 'dotenv';

export const ONDA_URL = 'https://app.onda.fit/book/thirsty-pickle';
export const VENUE = 'Thirsty Pickle | SM Seaside';
const hour = z.string().regex(/^(0[0-9]|1[0-9]|2[0-3]):00$/);
const courts = z.array(z.number().int().min(1).max(7));
export const ConfigSchema = z.object({
  ONDA_URL: z.literal(ONDA_URL).default(ONDA_URL),
  TIMEZONE: z.string().refine(v => IANAZone.isValidZone(v), 'Invalid timezone').default('Asia/Manila'),
  RELEASE_TIME: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/).default('08:00:00'),
  BOOKING_HORIZON_DAYS: z.coerce.number().int().min(0).max(30).default(2),
  START_TIME: hour,
  DURATION_HOURS: z.coerce.number().int().min(1).max(16),
  PREFERRED_COURTS: courts.min(1), FALLBACK_COURTS: courts.default([]),
  FALLBACK_TIMES: z.array(hour).default([]),
  MAX_PRICE: z.coerce.number().finite().positive(),
  PLAYER_FULL_NAME: z.string().trim().min(2),
  PLAYER_PHONE: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{6,19}$/),
  PLAYER_EMAIL: z.email(),
  CDP_URL: z.string().refine(v => { try { const u = new URL(v); return u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.port === '9222' && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password; } catch { return false; } }, 'Use http://127.0.0.1:9222').default('http://127.0.0.1:9222'),
  // Early release is intentionally unavailable until measurements justify it.
  RELEASE_LEAD_MS: z.coerce.number().int().min(0).max(0).default(0),
  MAX_RELEASE_RELOADS: z.coerce.number().int().min(1).max(2).default(2),
  RELEASE_RETRY_DELAY_MS: z.coerce.number().int().min(500).max(10000).default(1000),
  PREFLIGHT_SECONDS_BEFORE: z.coerce.number().int().min(10).max(120).default(15),
  CRITICAL_STEP_TIMEOUT_MS: z.coerce.number().int().min(3000).max(60000).default(15000),
}).superRefine((c, ctx) => {
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
  RELEASE_RETRY_DELAY_MS: ConfigSchema.shape.RELEASE_RETRY_DELAY_MS, PREFLIGHT_SECONDS_BEFORE: ConfigSchema.shape.PREFLIGHT_SECONDS_BEFORE,
  CRITICAL_STEP_TIMEOUT_MS: ConfigSchema.shape.CRITICAL_STEP_TIMEOUT_MS,
});
export type ReleaseSettings = z.infer<typeof ObservationSchema>;
export function loadObservationConfig(): ReleaseSettings {
  dotenv({ path: '.env.local', quiet: true });
  const parsed = ObservationSchema.safeParse(process.env);
  if (!parsed.success) throw new Error(`CONFIG_INVALID: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return parsed.data;
}
export function loadConfig(): Config {
  dotenv({ path: '.env.local', quiet: true });
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(ConfigSchema.shape)) if (process.env[key] !== undefined) raw[key] = process.env[key];
  for (const key of ['PREFERRED_COURTS', 'FALLBACK_COURTS', 'FALLBACK_TIMES']) {
    if (typeof raw[key] === 'string') raw[key] = (raw[key] as string).split(',').map(s => s.trim()).filter(Boolean).map(s => key === 'FALLBACK_TIMES' ? s : Number(s));
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`CONFIG_INVALID: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return parsed.data;
}
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
export function releaseCalendar(c: Pick<Config, 'TIMEZONE' | 'RELEASE_TIME' | 'BOOKING_HORIZON_DAYS'>, now: DateTime = DateTime.now()) {
  const local = now.setZone(c.TIMEZONE);
  const release = DateTime.fromISO(`${local.toISODate()}T${c.RELEASE_TIME}`, { zone: c.TIMEZONE });
  if (!release.isValid) throw new Error('INVALID_RELEASE_DATE');
  // Never silently switch to tomorrow after missing today's release.
  return { targetDate: local.startOf('day').plus({ days: c.BOOKING_HORIZON_DAYS }).toISODate()!, releaseMs: release.toMillis(), releaseISO: release.toISO()! };
}
