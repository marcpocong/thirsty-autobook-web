import { playerReadiness, loadConfig, loadObservationConfig, type Config } from './config.js';
import { verifyDedicatedChrome, attach, browserB } from './browser.js';
import { Safety } from './safety.js';
import { readScheduleReadiness } from './readiness.js';
import { clockStatus, readLock } from '../ui/status.js';

const result: Record<string, unknown> = { cdp: 'BLOCKED', dedicatedProfile: 'NOT VERIFIED', exactTab: 'NOT VERIFIED',
  venue: 'NOT VERIFIED', schedule: 'NOT CLEAN', allCourts: 'NO', selectedSlots: 'UNKNOWN', paymentHold: 'UNKNOWN',
  automationLock: await readLock(process.cwd()) ? 'ACTIVE' : 'CLEAR', playerConfiguration: 'MISSING', bookingPlan: 'INVALID' };
let booking:Config|undefined;
try {
  const config = loadObservationConfig(), next = clockStatus(config);
  Object.assign(result, { preopen: config.RELEASE_PREOPEN_CALENDAR ? 'ON' : 'OFF',
    availabilityMode: config.AVAILABILITY_DISCOVERY_MODE.toUpperCase(), releaseLeadMs: config.RELEASE_LEAD_MS,
    targetDate: next.targetDate, releaseTime: `${config.RELEASE_TIME} ${config.TIMEZONE}` });
  try { booking=loadConfig(); result.courtCount=booking.COURT_COUNT; result.playerConfiguration = playerReadiness(booking).primary?'CONFIGURED':'MISSING'; result.extendedPlayerConfiguration=playerReadiness(booking).extended?'CONFIGURED':'MISSING'; result.bookingPlan = 'VALID'; } catch {}
  verifyDedicatedChrome(); result.dedicatedProfile = 'VERIFIED';
  const { page } = await attach(new Safety()); result.cdp = 'READY';
  Object.assign(result, await readScheduleReadiness(page));
  if(booking?.BOOKING_TYPE==='extended'){
    result.browserB='NOT VERIFIED';
    const second=await attach(new Safety(),undefined,browserB);
    const readiness=await readScheduleReadiness(second.page);result.browserB=readiness;
    if(readiness.schedule!=='CLEAN'||readiness.selectedSlots!==0||readiness.paymentHold!=='NONE')throw Error('DUAL_BROWSER_NOT_READY');
  }
} catch (error) {
  const message = (error as Error).message;
  result.blocker = /^[A-Z_]{1,80}$/.test(message) ? message : 'READINESS_UNVERIFIED';
}
console.log(JSON.stringify(result, null, 2));
// Disconnect by process exit, never close the user's browser or acquire an automation lock.
process.exit(0);
