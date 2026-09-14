import { PreparationSchema, TestBookingSchema, type BookingPlan } from '../src/booking-plan.js';
import { z } from 'zod';
import { DualPracticeSchema, requireDualFullAuthorization } from '../src/dual-practice.js';
import type { DualPracticeCommand } from './types.js';
import {FullPracticeSchema,type FullPracticeInput} from '../src/full-practice.js';
import type {LockReview} from './locks.js';
import type { UiEvent } from '../src/ui-events.js';
import type { Runner, RunningCommand } from './processes.js';
import type { Command, Dashboard } from './types.js';
import type { readClock } from './status.js';
import type { BookingView } from './booking.js';
import { PracticeSchema } from '../src/practice.js';
import { BookingSetupSchema } from '../src/config.js';
import { capabilities,fullBookingReady } from '../src/capabilities.js';

const preparationHeadlines:Record<string,string>={EXTENDED_PLAYER_INFO_MISSING:'EXTENDED PLAYER CONFIGURATION REQUIRED',PLAYER_INFO_MISSING:'PLAYER CONFIGURATION REQUIRED',TARGET_DATE_UNAVAILABLE:'TARGET NOT AVAILABLE',PAYMENT_HOLD_MAY_BE_ACTIVE:'PAYMENT HOLD MAY BE ACTIVE',LOCK_PID_RUNNING:'AUTOMATION STILL RUNNING'};
const errors: Record<string, string> = {
  EXTENDED_DURATION_LIMIT:'Extended two-browser booking currently supports up to 6 consecutive hours.',
  PAYMENT_HOLD_MAY_BE_ACTIVE:'PAYMENT HOLD MAY BE ACTIVE. Check Onda manually or wait for expiry, then Reset & Prepare.',
  TARGET_NOT_AVAILABLE:'TARGET NOT AVAILABLE. No booking was created.',
  LOCK_PID_RUNNING:'AUTOMATION STILL RUNNING. Stop the external run first, then Reset & Prepare.',
  AUTOMATION_STILL_RUNNING:'AUTOMATION STILL RUNNING. Stop the external run first, then Reset & Prepare.',
  STOP_NOT_CONFIRMED:'STOP NOT CONFIRMED. Reset was not performed.',
  EXTENDED_PLAYER_INFO_MISSING:'EXTENDED PLAYER CONFIGURATION REQUIRED',
  TARGET_DATE_UNAVAILABLE:'TARGET NOT AVAILABLE. Choose a reachable date, then Reset & Prepare.',
  LOCK_SELECTED_SLOTS:'SELECTED SLOTS STILL PRESENT. Inspect and clear them manually, then Review Lock again.',
  LOCK_PAYMENT_HOLD_ACTIVE:'PAYMENT HOLD ACTIVE. Complete payment, cancel manually if appropriate, or wait for expiry; then return to a clean schedule and Review Lock.',
  LOCK_BROWSER_STATE_UNKNOWN:'Browser state is unknown or not a clean schedule. Manual review required.',
  PRACTICE_RESET_HOLD_ACTIVE:'A QR/payment hold is still recorded. Complete, cancel, or let that hold expire in Chrome before resetting practice.',
  PRACTICE_RESET_FAILED:'The dedicated practice browser could not be reset safely. Check Chrome manually and try again.',
  PRACTICE_RESET_UNAVAILABLE:'Practice reset is unavailable in this build.',
  DEDICATED_CHROME_NOT_IDENTIFIED:'The CDP port belongs to an unidentified Chrome process. Close it manually before resetting practice.',
  DEDICATED_CHROME_CLOSE_TIMEOUT:'Dedicated Chrome did not close in time. Check it manually before resetting practice.',
  PRACTICE_TARGET_UNAVAILABLE:'PRACTICE TARGET NOT AVAILABLE. No alternative court or time will be selected.',
  PRACTICE_DATE_UNAVAILABLE:'This date is not available through the normal Onda calendar.',
  TERMS_AUTHORIZATION_REQUIRED:'Authorize accepting Onda Terms for this run first.',
  TERMS_STRUCTURE_CHANGED:'Onda Terms checkbox could not be uniquely identified in Payment Summary. Automation stopped for manual review.',
  TERMS_NOT_ACTIONABLE:'The Onda Terms checkbox is not visible or enabled in Payment Summary. Automation stopped.',
  TERMS_NOT_CHECKED:'Onda Terms were not confirmed in Payment Summary. The payment handoff was not dispatched.',
  PLAYER_INFO_MISSING:'Player information is missing or invalid. Configure local player information first.',
  QR_HANDOFF_FAILED:'QR handoff could not be verified. Inspect Chrome manually; the lock remains active.',
  AUTOMATION_LOCK_EXISTS: 'Automation lock exists. Use Review Lock. Booking actions are blocked; local booking settings can still be edited and saved.',
  CDP_PROFILE_OR_BIND_UNVERIFIED: 'Chrome/CDP unavailable or dedicated profile not verified. Use Start / Attach Chrome.',
  WRONG_CHROME_PROFILE: 'Port 9222 belongs to a different Chrome profile.',
  ONDA_TAB_AMBIGUOUS_OR_MISSING: 'Leave exactly one Thirsty Pickle booking tab open in dedicated Chrome.',
  WRONG_VENUE: 'The expected Thirsty Pickle venue was not verified.',
  TOO_LATE_FOR_PREFLIGHT: 'Too late for today’s preflight. Prepare again before the next release; no observation was scheduled.',
  STALE_OR_INCOMPLETE_GRID: 'Today’s grid is not verified. Select today and All Courts in Chrome, then Prepare again.',
  SECURITY_CHALLENGE: 'Onda requires a human/security check. Automation stopped.',
  RATE_LIMITED: 'Onda reported rate limiting. Automation stopped.',
  PREEXISTING_SELECTION: 'Selected slots are present. Clear them manually in Chrome before preparing.',
  TAB_NOT_VISIBLE: 'Keep the Onda tab visible, active and not minimized.',
  CHROME_DISCONNECTED: 'Chrome disconnected. Automation stopped; prepare a new run manually.',
  CONFIG_INVALID: 'Booking or local player configuration is invalid. Review Booking Setup and the local player fields.',
  COURT_FILTER_NOT_ALL: 'Select All Courts in Chrome, then Prepare again.',
};
export interface Dependencies {
  confirmStopPrepare?:()=>Promise<boolean>;
  confirmBooking?:(plan:BookingPlan,maximum:number)=>Promise<boolean>;
  runner: Runner; lock(): Promise<boolean>; cdp(): Promise<boolean>; clock: typeof readClock;
  confirm(kind?: 'observe'|'selection'|'dry'|'full', plan?:BookingView): Promise<boolean>; publish(status: Dashboard): void;
  booking(): BookingView; saveBooking(input:unknown): BookingView;
  reviewLock?(owned:boolean):Promise<LockReview>;
  clearLock?(fingerprint:string,owned:()=>boolean):Promise<void>;
  confirmClear?(review:LockReview):Promise<boolean>;
  resetPractice?():Promise<void>;
  confirmReset?():Promise<boolean>;
  confirmPractice?(input:FullPracticeInput):Promise<boolean>;
  dualEvidence?():Promise<{selection:boolean;full:boolean}>;
  confirmDualPractice?(input:DualPracticeCommand):Promise<boolean>;
  handoff?():Promise<Dashboard['handoff']>;
}
export class Controller {
  readonly state: Dashboard = { operation: 'idle', headline: 'RESET REQUIRED', workflow:'test', detail: 'Configure your booking, then Reset & Prepare.', ready: false,
    cdp: false, lock: false, inspection: null, clock: null, plan: null, logs: [], liveRace: fullBookingReady(), booking:null, termsAuthorized:false, capabilities, selection:null,mode:fullBookingReady()?'full':'selection',handoff:null };
  private active?: RunningCommand;
  private generation = 0;
  private polling = false;
  constructor(private deps: Dependencies) {}
  private publish() { this.deps.publish(structuredClone(this.state)); }
  private log(text: string, error = false) {
    this.state.logs.push({ at: new Date().toISOString(), text, level: error ? 'error' : 'info' });
    if (this.state.logs.length > 400) this.state.logs.splice(0, this.state.logs.length - 400);
    this.publish();
  }
  async refresh() {
    if (this.polling) return;
    this.polling = true;
    try {
      const wasReady = this.state.ready;
      const [lock, cdp] = await Promise.all([this.deps.lock(), this.deps.cdp()]);
      this.state.lock = lock; this.state.cdp = cdp;
      if(lock&&!this.state.handoff&&this.state.operation==='idle'&&this.deps.handoff){
        this.state.handoff=await this.deps.handoff();
        if(this.state.handoff){this.state.headline='Payment handoff recorded';this.state.detail='Automation stopped. Lock retained. Check the last observed hold and complete payment manually in Chrome.';}
      }
      try { this.state.clock = this.deps.clock(); }
      catch { this.state.clock = null; this.state.ready = false; this.state.detail = errors.CONFIG_INVALID!; }
      if (this.state.operation === 'idle') {
        try { const booking=this.deps.booking(); if (this.state.booking?.fingerprint !== booking.fingerprint || this.state.booking?.playerConfigured!==booking.playerConfigured || this.state.booking?.extendedPlayerConfigured!==booking.extendedPlayerConfigured) { this.state.ready=false; this.state.termsAuthorized=false; } this.state.booking=booking; if(booking.setup.BOOKING_TYPE==='extended'&&this.deps.dualEvidence)this.state.dualValidation=await this.deps.dualEvidence(); }
        catch { this.state.booking=null; this.state.ready=false; }
      }
      if (!cdp || (lock && this.state.operation === 'idle') || (this.state.workflow==='release'&&!this.state.clock?.canArmToday)) this.state.ready = false;
      if(this.state.preparedAt&&Date.now()-this.state.preparedAt>60000)this.state.ready=false;
      const checked = this.state.inspection;
      // Never present an old inspection as current readiness after a long idle period.
      if (checked && Date.now() - Date.parse(checked.verifiedAt) > 60000 && this.state.operation === 'idle') this.state.ready = false;
      if (wasReady && !this.state.ready && this.state.operation === 'idle') {
        this.state.headline = 'Preparation needs rechecking';
        this.state.detail = lock ? errors.AUTOMATION_LOCK_EXISTS! : !cdp ? errors.CDP_PROFILE_OR_BIND_UNVERIFIED! : !this.state.clock?.canArmToday ? errors.TOO_LATE_FOR_PREFLIGHT! : 'The last inspection is over a minute old. Prepare again to verify the current page before arming.';
      }
      this.publish();
    } finally { this.polling = false; }
  }
  private event = (event: UiEvent) => {
    if(event.type==='bookingResult'){this.state.bookingResult=event;this.state.headline=event.status;this.state.detail=event.description+'\n'+event.outcomes.map((v,i)=>`Checkout ${i+1}: ${v}`).join('\n')+(event.outcomes.includes('FAILED')?'\nCheck both Onda windows manually; a failed checkout may still have an active hold.':'');this.publish();return;}
    if(event.type==='error'&&this.state.bookingResult&&['PARTIAL SUCCESS','BOOKING FAILED'].includes(this.state.bookingResult.status)){this.state.ready=false;this.log(event.code,true);return;}
    if(event.type==='dualWorker'){this.state.dualWorkers={...this.state.dualWorkers,[event.workerId]:event};this.publish();return;}
    if(event.type==='dualResult'){this.state.dualResult=event;this.state.headline=event.status.replaceAll('_',' ');this.state.detail=['DUAL_DRY_PASS','DUAL_SELECTION_PASS'].includes(event.status)?'No Proceed clicks. Both browsers clean.':'Automation stopped. Inspect BOTH browsers manually. Locks retained; payment stays manual.';this.publish();return;}
    if(event.type==='error'&&this.state.dualActive&&['DUAL_PARTIAL_SUCCESS','DUAL_FAILED'].includes(this.state.dualResult?.status??'')){this.state.ready=false;this.log(event.code,true);return;}
    if(this.state.dualActive&&['handoff','selection','releasePerformance'].includes(event.type))return;

    if (event.type === 'releasePerformance') { this.state.releasePerformance = event.summary; this.publish(); }
    if (event.type === 'selection') { this.state.selection=event; this.state.headline='SLOTS SELECTED'; this.state.detail=['full','fullPractice'].includes(this.state.operation)?'Continuing to Review Booking. Selection is not yet a reservation.':'AUTOMATION STOPPED BEFORE PROCEED. USER CONTROL RESTORED. Selection is not a reservation; the lock remains active.'; this.publish(); }
    if(event.type==='handoff'){this.state.handoff=event;this.state.headline='PAYMENT HOLD ACTIVE';this.state.detail='FULL BOOKING COMPLETE TO PAYMENT HANDOFF. AUTOMATION STOPPED. Complete payment manually in Chrome. AUTOMATION LOCK RETAINED.';this.publish();}
    if (event.type === 'inspection') { this.state.inspection = event; this.log('Onda URL and venue verified. Inspection results received.'); }
    if (event.type === 'plan') { this.state.plan = event; this.publish(); }
    if (event.type === 'error') {
      this.state.ready = false;
      if (event.code !== 'USER_ABORT') { this.state.headline = event.code==='HANDOFF_STATUS_UNKNOWN'?'HANDOFF STATUS UNKNOWN':/REVIEW_/.test(event.code)?'REVIEW VALIDATION FAILED':/PLAYER_|PHONE_/.test(event.code)?'PLAYER FORM FAILED':/PAYMENT_/.test(event.code)?'PAYMENT SUMMARY FAILED':/TERMS_|FINAL_BUTTON_/.test(event.code)?'TERMS / FINAL ACTION FAILED':/SELECTION_|CLEANUP_|NO_AVAILABLE/.test(event.code)?'SELECTION FAILED':'Needs attention'; this.state.detail = event.code==='HANDOFF_STATUS_UNKNOWN'?'DO NOT START ANOTHER BOOKING. CHECK CHROME MANUALLY. Lock retained; final action is never retried.':errors[event.code] ?? event.code; }
      if(preparationHeadlines[event.code])this.state.headline=preparationHeadlines[event.code]!;
      this.log(errors[event.code] ?? event.code, true);
    }
    if (event.type === 'telemetry') {
      const labels: Record<string, string> = { chromeConnected: 'Dedicated Chrome and Onda tab verified', preflightStarted: 'Preflight started', preflightCompleted: 'Preflight passed',
        armed: 'ARMED — final preflight passed', releaseTriggerFired: 'Release trigger fired', reloadStarted: 'Reload started', reloadCommitted: 'Reload committed', targetGridReady: 'Target grid verified', gridSnapshotCompleted: 'Availability snapshot completed', automationStopped: 'Command completed' };
      this.log(labels[event.event] ?? event.event);
      if(['full','fullPractice'].includes(this.state.operation)){
        const stages:Record<string,string>={armed:'Full Booking armed',reviewValidated:'BOOKING REVIEWED',playerFillCompleted:'PLAYER INFORMATION VERIFIED',paymentSummaryValidated:'READY TO CREATE PAYMENT HOLD',finalOndaActionStarted:'Creating payment hold',finalOndaButtonClicked:'Checking QR handoff — read only'};
        if(stages[event.event])this.state.headline=stages[event.event]!;
        this.publish();
      }
      if (this.state.operation === 'observe') {
        if (event.event === 'preflightCompleted') { this.state.headline = 'Observation scheduled'; this.state.detail = 'Initial preflight passed. The existing engine will perform final preflight before release.'; }
        if (event.event === 'armed') { this.state.headline = 'Release observation armed'; this.state.detail = 'Final preflight passed. Waiting for the configured release.'; }
        if (event.event === 'releaseTriggerFired') { this.state.headline = 'Observing release'; this.state.detail = 'Read-only refresh and date navigation are running.'; }
        this.publish();
      }
    }
  };
  private async run(command: Command, generation: number) {
    if (generation !== this.generation) throw new Error('CANCELLED');
    const active = this.deps.runner(command, this.event, (line, error) => this.log(line, error),async plan=>{if(generation!==this.generation)return false;const answer=await this.deps.confirmBooking?.(plan,typeof command==='object'&&command.kind==='testBooking'?command.input.maximum:0)??false;return generation===this.generation&&answer;});
    this.active = active;
    try {
      const code = await active.done;
      if (generation !== this.generation) throw new Error('CANCELLED');
      if (code !== 0) throw new Error('COMMAND_FAILED');
    } finally { if (this.active === active) this.active = undefined; }
  }
  private async operation(kind: Dashboard['operation'], work: (generation: number) => Promise<void>) {
    if (this.state.operation !== 'idle') throw new Error('OPERATION_ALREADY_RUNNING');
    const generation = ++this.generation;
    if (['observe', 'dry', 'selection', 'full'].includes(kind)) this.state.releasePerformance = null;
    this.state.dualActive=false; this.state.operation = kind; this.state.ready = false; this.state.plan = null; this.state.termsAuthorized=false; this.publish();
    try { await work(generation); }
    catch (error) {
      if (generation === this.generation) {
        const code = error instanceof Error ? error.message : 'OPERATION_FAILED';
        const hadSpecificFailure = Object.values(preparationHeadlines).includes(this.state.headline)||['PARTIAL SUCCESS','BOOKING FAILED'].includes(this.state.bookingResult?.status??'')||this.state.dualResult?.status==='DUAL_PARTIAL_SUCCESS'||this.state.dualResult?.status==='DUAL_FAILED'||this.state.headline === 'Needs attention'||this.state.headline.includes('FAILED')||this.state.headline==='HANDOFF STATUS UNKNOWN';
        if(code==='HANDOFF_STATUS_UNKNOWN')this.state.headline='HANDOFF STATUS UNKNOWN';
        else if(!hadSpecificFailure)this.state.headline = 'Needs attention';
        if(code==='HANDOFF_STATUS_UNKNOWN')this.state.detail='DO NOT START ANOTHER BOOKING. CHECK CHROME MANUALLY. Lock retained; final action is never retried.';
        else if (code !== 'COMMAND_FAILED') this.state.detail = errors[code] ?? code;
        else if (!hadSpecificFailure) this.state.detail = 'The command failed. See the sanitized process output in Activity.';
        if(preparationHeadlines[code])this.state.headline=preparationHeadlines[code]!;
        this.log(code, true);
      }
    } finally {
      if (generation === this.generation) { this.state.operation = 'idle'; this.state.termsAuthorized=false; await this.refresh(); this.publish(); }
    }
  }
  private async noLock() { this.state.lock = await this.deps.lock(); if (this.state.lock) throw new Error('AUTOMATION_LOCK_EXISTS'); }
  startChrome() { return this.operation('chrome', async gen => {
    // The launcher only starts or reuses the dedicated browser; it does not
    // attach a booking worker. Allow it while a retained lock is under review
    // so the operator can make Chrome available for read-only verification.
    if (this.active) throw new Error('OPERATION_ALREADY_RUNNING');
    this.log(this.state.lock ? 'Starting / reusing dedicated Chrome for lock review' : 'Starting / reusing dedicated Chrome'); await this.run(this.state.booking?.setup.BOOKING_TYPE==='extended'?'chromeDual':'chrome', gen);
    this.state.cdp = await this.deps.cdp(); if (!this.state.cdp) throw new Error('CDP_PROFILE_OR_BIND_UNVERIFIED');
    if (gen !== this.generation) return;
    this.state.headline = 'Chrome is reachable'; this.state.detail = 'Run Prepare to verify the booking page and session.';
  }); }
  inspectOnda() { return this.operation('inspect', async gen => {
    if(this.state.booking?.setup.BOOKING_TYPE==='extended')this.state.dualWorkers={};
    await this.noLock(); this.state.inspection = null; this.log('Inspecting Onda — read only'); await this.run(this.state.booking?.setup.BOOKING_TYPE==='extended'?'dualReadiness':'inspect', gen);
    this.state.headline = 'Inspection complete'; this.state.detail = 'Review the observed status below. Prepare before arming.';
  }); }
  async setWorkflow(value:unknown){if(this.state.operation!=='idle')throw Error('OPERATION_ALREADY_RUNNING');this.state.workflow=z.enum(['test','release']).parse(value);this.state.ready=false;this.state.termsAuthorized=false;this.publish();}
  private resetting=false;
  async resetPrepare(value:unknown){
    if(this.resetting)throw Error('OPERATION_ALREADY_RUNNING');
    this.resetting=true;this.state.ready=false;this.state.termsAuthorized=false;this.state.preparedAt=undefined;
    try{
      const input=PreparationSchema.parse(value);
      if(this.state.operation!=='idle'){
        const active=this.active;
        if(!active)throw Error('AUTOMATION_STILL_RUNNING');
        const generation=this.generation;
        if(!await this.deps.confirmStopPrepare?.())return;
        if(generation!==this.generation||this.active&&this.active!==active)throw Error('STOP_NOT_CONFIRMED');
        ++this.generation;this.state.operation='stopping';this.state.ready=false;this.state.termsAuthorized=false;this.publish();
        try{
          await active.stop();
          await Promise.race([active.done,new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(Error('STOP_NOT_CONFIRMED')),3500);timer.unref();})]);
        }catch{this.state.headline='STOP NOT CONFIRMED';this.state.detail='Stop the existing automation before preparing.';this.publish();throw Error('STOP_NOT_CONFIRMED');}
        this.active=undefined;this.state.operation='idle';
      }
      await this.operation('prepare',async gen=>{
        if(input.workflow==='release'&&input.setup!==undefined)this.state.booking=this.deps.saveBooking(BookingSetupSchema.parse(input.setup));
        const booking=this.deps.booking(),strategy=input.workflow==='test'?input.request.strategy:booking.setup.BOOKING_TYPE;
        this.state.booking=booking;if(!booking.playerConfigured)throw Error('PLAYER_INFO_MISSING');
        if(strategy==='extended'&&!booking.extendedPlayerConfigured)throw Error('EXTENDED_PLAYER_INFO_MISSING');
        this.state.workflow=input.workflow;this.state.inspection=null;this.state.handoff=null;this.state.bookingResult=undefined;
        this.state.headline='PREPARING';this.publish();
        await this.run({kind:'resetPrepare',input:input.workflow==='release'?{workflow:'release',strategy}:input},gen);await this.noLock();
        this.state.cdp=await this.deps.cdp();if(!this.state.cdp)throw Error('CDP_PROFILE_OR_BIND_UNVERIFIED');
        this.state.ready=true;this.state.preparedAt=Date.now();
        this.state.headline=input.workflow==='release'?'READY TO ARM':'READY TO TEST';this.state.detail='Prepared. Review your settings and authorize Terms for this run.';
      });
    }catch(error){
      if(this.state.operation!=='stopping'){this.state.headline='RESET REQUIRED';this.state.detail='Check the booking fields, then Reset & Prepare.';this.publish();}
      throw error;
    }finally{this.resetting=false;}
  }
  testBooking(value:unknown){return this.operation('fullPractice',async gen=>{
    const input=TestBookingSchema.parse(value);const booking=this.deps.booking();this.state.booking=booking;if(!booking.playerConfigured)throw Error('PLAYER_INFO_MISSING');if(input.request.strategy==='extended'&&!booking.extendedPlayerConfigured)throw Error('EXTENDED_PLAYER_INFO_MISSING');await this.noLock();
    this.state.handoff=null;this.state.bookingResult=undefined;
    this.state.headline='Checking availability';this.state.detail='Resolving your courts and time ranges before confirmation.';
    await this.run({kind:'testBooking',input},gen);
  });}
  prepare() { return this.resetPrepare({workflow:'release',strategy:this.deps.booking().setup.BOOKING_TYPE}); }
  prepareDual() { return this.operation('prepare', async gen => {
    this.state.booking=this.deps.booking();
    if(this.state.booking.setup.BOOKING_TYPE!=='standard'||this.state.booking.setup.COURT_COUNT!==2)throw Error('LEGACY_DIAGNOSTIC_CONFIG_REQUIRED');
    this.state.dualWorkers={};this.state.dualResult=null;this.state.dualValidation=undefined;
    await this.noLock();this.log('Preparing dual run — starting both dedicated browsers and verifying both clean schedules');
    await this.run('chromeDual',gen);
    await this.run('dualPrepare',gen);await this.noLock();
    if(gen!==this.generation)return;
    this.state.cdp=await this.deps.cdp();
    this.state.dualValidation=this.deps.dualEvidence?await this.deps.dualEvidence():undefined;
    this.state.ready=false;this.state.headline='Dual browsers prepared';
    this.state.detail='Browser A and Browser B are verified, visible, clean and ready for the selected dual practice or release action. Nothing has been selected or armed.';
    this.log('DUAL READY — both browsers verified; nothing selected or armed.');
  }); }
  armObservation() { return this.operation('confirming', async gen => {
    await this.noLock();
    if (!this.deps.clock().canArmToday) throw new Error('TOO_LATE_FOR_PREFLIGHT');
    const confirmed = await this.deps.confirm();
    if (gen !== this.generation) return;
    if (!confirmed) { this.state.headline = 'Arming cancelled'; this.state.detail = 'No observation process was launched.'; this.log('Arming cancelled'); return; }
    await this.noLock();
    this.state.operation = 'observe'; this.state.inspection=null; this.state.headline = 'Starting observation'; this.state.detail = 'Waiting for the existing engine to verify preflight.'; this.publish();
    this.log('Observation authorized for this run'); await this.run('observe', gen);
    this.state.headline = 'Observation complete'; this.state.detail = 'No court slots were selected. Review activity and local telemetry.';
  }); }
  saveBooking(input: unknown) { return this.operation('saving', async () => {
    if((input as {DURATION_HOURS?:number})?.DURATION_HOURS!>6)throw Error('EXTENDED_DURATION_LIMIT');
    const setup=BookingSetupSchema.parse(input);
    this.state.booking=this.deps.saveBooking(setup);
    this.state.headline='Booking plan saved'; this.state.detail='Review the compiled plan, then Prepare Booking. Terms authorization is off.';
  }); }
  armSelection() { return this.armBooking('selection'); }
  dryRace() { return this.armBooking('dry'); }
  async setMode(mode:unknown){
    if(this.state.operation!=='idle')throw new Error('OPERATION_ALREADY_RUNNING');
    if(mode!=='selection'&&mode!=='full')throw new Error('MODE_NOT_ALLOWED');
    if(mode==='full'&&!fullBookingReady(this.state.capabilities))throw new Error('LIVE_RACE_BLOCKED');
    this.state.mode=mode;this.state.ready=false;this.state.termsAuthorized=false;this.publish();
  }
  async authorizeTerms(value:unknown){
    if(typeof value!=='boolean')throw new Error('INVALID_TERMS_AUTHORIZATION');
    if(this.state.operation!=='idle')throw new Error('OPERATION_ALREADY_RUNNING');
    if(value&&(this.state.mode!=='full'||!fullBookingReady(this.state.capabilities)||this.state.lock))throw new Error('TERMS_AUTHORIZATION_NOT_ALLOWED');
    this.state.termsAuthorized=value;this.publish();
  }
  armFullBooking(){
    const authorized=this.state.termsAuthorized;this.state.termsAuthorized=false;
    return this.armBooking('full',authorized);
  }
  private armBooking(kind:'selection'|'dry'|'full',authorized=false) { return this.operation('confirming', async gen => {
    if(kind==='full'&&(!fullBookingReady(this.state.capabilities)||this.state.mode!=='full'))throw new Error('LIVE_RACE_BLOCKED');
    if(kind==='full'&&!authorized)throw new Error('TERMS_AUTHORIZATION_REQUIRED');
    await this.noLock(); if (!this.deps.clock().canArmToday) throw new Error('TOO_LATE_FOR_PREFLIGHT');
    if (kind==='selection' && !this.state.capabilities.selectionReady) throw new Error('SELECTION_NOT_READY');
    const plan=this.deps.booking();if(!plan.playerConfigured)throw Error('PLAYER_INFO_MISSING');if(plan.setup.BOOKING_TYPE==='extended'&&!plan.extendedPlayerConfigured)throw Error('EXTENDED_PLAYER_INFO_MISSING'); this.state.booking=plan; this.state.selection=null;
    this.state.bookingResult=undefined;
    const confirmed=await this.deps.confirm(kind,plan);
    if(gen!==this.generation)return;
    if(!confirmed){this.state.headline='Arming cancelled';this.state.detail='No booking process was launched.';return;}
    await this.noLock();
    if(this.deps.booking().fingerprint!==plan.fingerprint)throw new Error('BOOKING_PLAN_CHANGED');
    if(!this.deps.clock().canArmToday)throw new Error('TOO_LATE_FOR_PREFLIGHT');
    this.state.operation=kind;this.state.inspection=null;this.state.handoff=null;this.state.headline=kind==='full'?'Full Booking scheduled':kind==='selection'?'Selection scheduled':'Dry Race scheduled';
    this.state.detail=kind==='full'?'At release the engine continues through Onda to QR Checkout. Payment remains manual.':kind==='selection'?'At release the engine may select slots. It will stop before Proceed.':'Release, date, grid and preference checks only. No slots will be selected.';this.publish();
    await this.run(kind==='full'?{kind,planHash:plan.fingerprint,authorizeTerms:true}:{kind,planHash:plan.fingerprint},gen);
    if(this.state.dualActive){if(!this.state.dualResult)throw Error('DUAL_RESULT_MISSING');return;}
    if(kind==='dry'){this.state.headline='Dry Race complete';this.state.detail='No slots selected. Review availability and preference events.';}
    else if(kind==='full'&&!this.state.handoff&&!this.state.bookingResult)throw new Error('HANDOFF_STATUS_UNKNOWN');
    else if(kind==='selection'&&!this.state.selection&&!this.state.bookingResult)throw new Error('SELECTION_RESULT_MISSING');
  }); }
  reviewLock(){return this.operation('reviewing',async()=>{
    if(!this.deps.reviewLock)throw Error('LOCK_BROWSER_STATE_UNKNOWN');
    this.state.lockReview=await this.deps.reviewLock(!!this.active);
    this.state.headline=this.state.lockReview.canClear?'VERIFIED STALE LOCK':'AUTOMATION LOCK ACTIVE';
    this.state.detail=errors[this.state.lockReview.reason]??'PID is dead, schedule is clean, selected slots: 0. Safe clearing is available after confirmation.';
  });}
  clearLock(){return this.operation('clearing',async gen=>{
    if(!this.deps.reviewLock||!this.deps.clearLock||!this.deps.confirmClear)throw Error('LOCK_BROWSER_STATE_UNKNOWN');
    const review=await this.deps.reviewLock(!!this.active);this.state.lockReview=review;this.publish();
    if(!review.canClear)throw Error(review.reason);
    if(!await this.deps.confirmClear(review)||gen!==this.generation)return;
    await this.deps.clearLock(review.fingerprint,()=>!!this.active||gen!==this.generation);
    this.state.lockReview=null;this.state.handoff=null;this.state.selection=null;
    this.state.headline='Verified stale lock cleared';this.state.detail='Prepare again before booking.';
  });}
  resetPractice(){return this.operation('resetting',async gen=>{
    if(!this.deps.resetPractice||!this.deps.confirmReset)throw Error('PRACTICE_RESET_UNAVAILABLE');
    if(!await this.deps.confirmReset()||gen!==this.generation){this.state.headline='Practice reset cancelled';this.state.detail='No browser or lock state was changed.';return;}
    await this.deps.resetPractice();
    this.state.lock=await this.deps.lock();this.state.cdp=await this.deps.cdp();this.state.lockReview=null;this.state.handoff=null;this.state.selection=null;this.state.inspection=null;this.state.ready=false;
    this.state.headline='Practice session reset';this.state.detail='Dedicated Chrome was restarted and the local practice lock was cleared. Set the exact target and run Full Flow Practice again.';
  });}
  runFullPractice(input:unknown){return this.operation('confirming',async gen=>{
    if(!input||typeof input!=='object'||!('authorizeTerms' in input)||input.authorizeTerms!==true)throw Error('TERMS_AUTHORIZATION_REQUIRED');
    const parsed=FullPracticeSchema.parse(input);
    if(!fullBookingReady(this.state.capabilities))throw Error('LIVE_RACE_BLOCKED');
    await this.noLock();if(!await this.deps.cdp())throw Error('CDP_PROFILE_OR_BIND_UNVERIFIED');
    try{if(!this.deps.booking().playerConfigured)throw Error();}catch{throw Error('PLAYER_INFO_MISSING');}
    if(!this.deps.confirmPractice||!await this.deps.confirmPractice(parsed)||gen!==this.generation)return;
    await this.noLock();
    this.state.operation='fullPractice';this.state.handoff=null;this.state.selection=null;this.state.inspection=null;
    this.state.headline='Full Flow Practice running';this.state.detail='Exact target, immediate start. Automation stops at QR Checkout.';this.publish();
    await this.run({kind:'fullPractice',input:parsed},gen);
    if(!this.state.handoff)throw Error('QR_HANDOFF_FAILED');
    this.state.headline='FULL FLOW PRACTICE COMPLETE';this.state.detail='PAYMENT HOLD ACTIVE. AUTOMATION STOPPED. DO NOT PAY UNLESS YOU ACTUALLY WANT THIS PRACTICE BOOKING. Lock retained.';
  });}
  runDualPractice(input:unknown){return this.operation('practice',async gen=>{
    const command=z.discriminatedUnion('kind',[
      z.object({kind:z.literal('dualDry'),date:z.iso.date()}).strict(),
      z.object({kind:z.enum(['dualPractice','dualFullPractice']),input:DualPracticeSchema}).strict(),
    ]).parse(input);
    if(this.deps.booking().setup.BOOKING_TYPE!=='standard'||this.deps.booking().setup.COURT_COUNT!==2)throw Error('LEGACY_DIAGNOSTIC_CONFIG_REQUIRED');
    if(command.kind==='dualFullPractice')requireDualFullAuthorization(command.input);
    await this.noLock();
    if(command.kind==='dualFullPractice'&&(!this.deps.confirmDualPractice||!await this.deps.confirmDualPractice(command)||gen!==this.generation))return;
    await this.noLock();this.state.dualActive=true;this.state.dualResult=null;this.state.dualWorkers={};
    this.state.headline=command.kind==='dualFullPractice'?'TWO REAL TEMPORARY HOLDS AUTHORIZED':'Dual practice running';this.publish();
    await this.run(command,gen);
    if(!this.state.dualResult)throw Error('DUAL_RESULT_MISSING');
  });}
  runPractice(input:unknown) { return this.operation('practice', async gen => {
    const parsed=PracticeSchema.parse(input); await this.noLock();this.state.selection=null;this.state.inspection=null;
    this.state.headline='Safe practice running';this.state.detail='Select → verify → deselect → verify clean. Never Proceed.';
    await this.run({kind:'practice',input:parsed},gen);
    this.state.headline='Practice complete';this.state.detail='Selection verified and cleared. Proceed was never clicked.';
  }); }
  async abortAutomation() {
    this.state.termsAuthorized=false;
    if (this.state.operation === 'idle') { this.log('No UI-launched automation is running. External CLI processes are not controlled by this panel.'); return; }
    ++this.generation; this.state.ready = false; this.state.operation = 'stopping'; this.publish();
    try {
      await this.active?.stop(); this.active = undefined;
      this.state.operation = 'idle'; this.state.headline = 'Automation aborted'; this.state.detail = 'USER CONTROL RESTORED. Chrome remains open. Check the retained lock manually before another run.';
      this.log('AUTOMATION ABORTED — USER CONTROL RESTORED'); await this.refresh();
    } catch { this.state.headline = 'Stop not confirmed'; this.state.detail = 'The automation process has not exited. Retry Emergency Stop; check Task Manager.'; this.log('STOP_NOT_CONFIRMED', true); }
    this.publish();
  }
}
