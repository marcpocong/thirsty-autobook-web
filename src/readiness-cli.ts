import { loadConfig, loadObservationConfig } from './config.js';
import { verifyDedicatedChrome, attach } from './browser.js';
import { Safety } from './safety.js';
import { readScheduleReadiness } from './readiness.js';
import { clockStatus, readLock } from '../ui/status.js';

const result: Record<string, unknown> = { cdp: 'BLOCKED', dedicatedProfile: 'NOT VERIFIED', exactTab: 'NOT VERIFIED',
  venue: 'NOT VERIFIED', schedule: 'NOT CLEAN', allCourts: 'NO', selectedSlots: 'UNKNOWN', paymentHold: 'UNKNOWN',
  automationLock: await readLock(process.cwd()) ? 'ACTIVE' : 'CLEAR', playerConfiguration: 'MISSING', bookingPlan: 'INVALID' };
try {
  const config = loadObservationConfig(), next = clockStatus(config);
  Object.assign(result, { preopen: config.RELEASE_PREOPEN_CALENDAR ? 'ON' : 'OFF',
    availabilityMode: config.AVAILABILITY_DISCOVERY_MODE.toUpperCase(), releaseLeadMs: config.RELEASE_LEAD_MS,
    targetDate: next.targetDate, releaseTime: `${config.RELEASE_TIME} ${config.TIMEZONE}` });
  try { loadConfig(); result.playerConfiguration = 'CONFIGURED'; result.bookingPlan = 'VALID'; } catch {}
  verifyDedicatedChrome(); result.dedicatedProfile = 'VERIFIED';
  const { page } = await attach(new Safety()); result.cdp = 'READY';
  Object.assign(result, await readScheduleReadiness(page));
} catch (error) {
  const message = (error as Error).message;
  result.blocker = /^[A-Z_]{1,80}$/.test(message) ? message : 'READINESS_UNVERIFIED';
}
console.log(JSON.stringify(result, null, 2));
// Disconnect by process exit, never close the user's browser or acquire an automation lock.
process.exit(0);
