import { access,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DateTime } from 'luxon';
import { loadObservationConfig, releaseCalendar, type ReleaseSettings } from '../src/config.js';
import {UiEventSchema} from '../src/ui-events.js';
import type {Dashboard} from './types.js';

export async function readLock(root: string): Promise<boolean> {
  try { await access(resolve(root, '.local/automation.lock')); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; return true; }
}
export async function readHandoff(root:string):Promise<Dashboard['handoff']>{
  try {const lock=JSON.parse(await readFile(resolve(root,'.local/automation.lock'),'utf8'));const event=UiEventSchema.safeParse(lock.handoff);return event.success&&event.data.type==='handoff'?event.data:null;}catch{return null;}
}
export async function probeCdp(): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(1200), redirect: 'error' });
    const data = await response.json() as { Browser?: string };
    return response.ok && typeof data.Browser === 'string' && data.Browser.startsWith('Chrome/');
  } catch { return false; }
}
export function clockStatus(config: ReleaseSettings, now: DateTime = DateTime.now()) {
  const today = releaseCalendar(config, now);
  // Informational next-release display only; the CLI still refuses late starts today.
  const next = today.releaseMs <= now.toMillis() ? releaseCalendar(config, now.setZone(config.TIMEZONE).plus({ days: 1 })) : today;
  return { manilaTime: now.setZone('Asia/Manila').toFormat('HH:mm:ss'), manilaDate: now.setZone('Asia/Manila').toFormat('ccc, LLL d, yyyy'),
    releaseMs: next.releaseMs, targetDate: next.targetDate, releaseTime: config.RELEASE_TIME, timezone: config.TIMEZONE,
    canArmToday: now.toMillis() < today.releaseMs - config.PREFLIGHT_SECONDS_BEFORE * 1000,
    remainingMs: Math.max(0, next.releaseMs - now.toMillis()), horizon: config.BOOKING_HORIZON_DAYS, maxReloads: config.MAX_RELEASE_RELOADS, leadMs: config.RELEASE_LEAD_MS };
}
export function readClock() { return clockStatus(loadObservationConfig()); }
