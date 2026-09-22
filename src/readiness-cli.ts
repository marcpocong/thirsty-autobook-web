import { playerReadiness, loadConfig, loadObservationConfig, type Config } from './config.js';
import { verifyDedicatedChrome, attach, browserIdentity } from './browser.js';
import { Safety } from './safety.js';
import { readScheduleReadiness } from './readiness.js';
import { clockStatus, readLock } from '../ui/status.js';
import { loadLocalCheckoutCustomer } from './api-booking/local-customer.js';
import { requiredWorkerIds, type WorkerId } from './workers.js';
import { SPECIAL_SESSION_MODE, SPECIAL_SESSION_REQUIRED_WORKERS } from './api-booking/special-session.js';

const result: Record<string, unknown> = { cdp: 'BLOCKED', dedicatedProfile: 'NOT VERIFIED', exactTab: 'NOT VERIFIED',
  venue: 'NOT VERIFIED', schedule: 'NOT CLEAN', allCourts: 'NO', selectedSlots: 'UNKNOWN', paymentHold: 'UNKNOWN',
  automationLock: await readLock(process.cwd()) ? 'ACTIVE' : 'CLEAR', playerConfiguration: 'MISSING', bookingPlan: 'INVALID' };
let booking:Config|undefined;
try {
  const config = loadObservationConfig(), next = clockStatus(config);
  Object.assign(result, { preopen: config.RELEASE_PREOPEN_CALENDAR ? 'ON' : 'OFF',
    availabilityMode: config.AVAILABILITY_DISCOVERY_MODE.toUpperCase(), releaseLeadMs: config.RELEASE_LEAD_MS,
    targetDate: next.targetDate, releaseTime: `${config.RELEASE_TIME} ${config.TIMEZONE}` });
  try { booking=loadConfig(); result.bookingMethod=booking.BOOKING_METHOD.toUpperCase();result.courtCount=booking.COURT_COUNT; result.playerConfiguration = playerReadiness(booking).primary?'CONFIGURED':'MISSING'; result.extendedPlayerConfiguration=playerReadiness(booking).extended?'CONFIGURED':'MISSING'; result.bookingPlan = 'VALID';
    const workers:WorkerId[]=booking.SESSION_MODE===SPECIAL_SESSION_MODE
      ?[...SPECIAL_SESSION_REQUIRED_WORKERS]:requiredWorkerIds(booking.BOOKING_TYPE,booking.COURT_COUNT);
    result.requiredWorkers=workers.join(',');
    if(booking.BOOKING_METHOD==='api-first'){
      try{for(const worker of workers)loadLocalCheckoutCustomer(worker);result.apiCustomerBindings='VERIFIED';}
      catch(error){result.apiCustomerBindings='MISSING';const code=(error as Error).message;
        result.customerBindingBlocker=/^[A-Z][A-Z0-9_]{0,79}$/.test(code)?code:'CUSTOMER_BINDING_UNVERIFIED';}
    }
  } catch {result.bookingPlan='INVALID';}
  const workers:WorkerId[]=booking?.SESSION_MODE===SPECIAL_SESSION_MODE
    ?[...SPECIAL_SESSION_REQUIRED_WORKERS]:booking?requiredWorkerIds(booking.BOOKING_TYPE,booking.COURT_COUNT):['A'];
  for(const [index,worker] of workers.entries()){
    const identity=browserIdentity(worker);verifyDedicatedChrome(identity);
    const {page}=await attach(new Safety(),undefined,identity);
    const readiness=await readScheduleReadiness(page);
    result[`browser${worker}`]=readiness;
    if(index===0){result.dedicatedProfile='VERIFIED';result.cdp='READY';Object.assign(result,readiness);}
    if(readiness.schedule!=='CLEAN'||readiness.selectedSlots!==0||readiness.paymentHold!=='NONE')
      throw Error('REQUIRED_BROWSER_NOT_READY');
  }
  result.requiredBrowsers=`READY ${workers.length}/${workers.length}`;
} catch (error) {
  const message = (error as Error).message;
  result.blocker = /^[A-Z_]{1,80}$/.test(message) ? message : 'READINESS_UNVERIFIED';
}
console.log(JSON.stringify(result, null, 2));
// Disconnect by process exit, never close the user's browser or acquire an automation lock.
process.exit(0);
