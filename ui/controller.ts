import type { UiEvent } from '../src/ui-events.js';
import type { Runner, RunningCommand } from './processes.js';
import type { Command, Dashboard } from './types.js';
import type { readClock } from './status.js';
import type { BookingView } from './booking.js';
import { PracticeSchema } from '../src/practice.js';
import { BookingSetupSchema } from '../src/config.js';
import { capabilities } from '../src/capabilities.js';

const errors: Record<string, string> = {
  AUTOMATION_LOCK_EXISTS: 'Automation lock exists. Verify no bot is running and Chrome has no active selection before clearing it manually.',
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
  runner: Runner; lock(): Promise<boolean>; cdp(): Promise<boolean>; clock: typeof readClock;
  confirm(kind?: 'observe'|'selection'|'dry', plan?:BookingView): Promise<boolean>; publish(status: Dashboard): void;
  booking(): BookingView; saveBooking(input:unknown): BookingView;
}
export class Controller {
  readonly state: Dashboard = { operation: 'idle', headline: 'Prepare your session', detail: 'Start dedicated Chrome, then verify the page before arming.', ready: false,
    cdp: false, lock: false, inspection: null, clock: null, plan: null, logs: [], liveRace: false, booking:null, termsAuthorized:false, capabilities, selection:null };
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
      try { this.state.clock = this.deps.clock(); }
      catch { this.state.clock = null; this.state.ready = false; this.state.detail = errors.CONFIG_INVALID!; }
      if (this.state.operation === 'idle') {
        try { const booking=this.deps.booking(); if (this.state.booking?.fingerprint !== booking.fingerprint) { this.state.ready=false; this.state.termsAuthorized=false; } this.state.booking=booking; }
        catch { this.state.booking=null; this.state.ready=false; }
      }
      if (!cdp || (lock && this.state.operation === 'idle') || !this.state.clock?.canArmToday) this.state.ready = false;
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
    if (event.type === 'selection') { this.state.selection=event; this.state.headline='SLOTS SELECTED'; this.state.detail='AUTOMATION STOPPED BEFORE PROCEED. USER CONTROL RESTORED. Selection is not a reservation; the lock remains active.'; this.publish(); }
    if (event.type === 'inspection') { this.state.inspection = event; this.log('Onda URL and venue verified. Inspection results received.'); }
    if (event.type === 'plan') { this.state.plan = event; this.publish(); }
    if (event.type === 'error') {
      this.state.ready = false;
      if (event.code !== 'USER_ABORT') { this.state.headline = 'Needs attention'; this.state.detail = errors[event.code] ?? event.code; }
      this.log(errors[event.code] ?? event.code, true);
    }
    if (event.type === 'telemetry') {
      const labels: Record<string, string> = { chromeConnected: 'Dedicated Chrome and Onda tab verified', preflightStarted: 'Preflight started', preflightCompleted: 'Preflight passed',
        armed: 'ARMED — final preflight passed', releaseTriggerFired: 'Release trigger fired', reloadStarted: 'Reload started', reloadCommitted: 'Reload committed', targetGridReady: 'Target grid verified', gridSnapshotCompleted: 'Availability snapshot completed', automationStopped: 'Command completed' };
      this.log(labels[event.event] ?? event.event);
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
    const active = this.deps.runner(command, this.event, (line, error) => this.log(line, error));
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
    this.state.operation = kind; this.state.ready = false; this.state.plan = null; this.state.termsAuthorized=false; this.publish();
    try { await work(generation); }
    catch (error) {
      if (generation === this.generation) {
        const code = error instanceof Error ? error.message : 'OPERATION_FAILED';
        const hadSpecificFailure = this.state.headline === 'Needs attention';
        this.state.headline = 'Needs attention';
        if (code !== 'COMMAND_FAILED') this.state.detail = errors[code] ?? code;
        else if (!hadSpecificFailure) this.state.detail = 'The command failed. See the sanitized process output in Activity.';
        this.log(code, true);
      }
    } finally {
      if (generation === this.generation) { this.state.operation = 'idle'; this.state.termsAuthorized=false; await this.refresh(); this.publish(); }
    }
  }
  private async noLock() { this.state.lock = await this.deps.lock(); if (this.state.lock) throw new Error('AUTOMATION_LOCK_EXISTS'); }
  startChrome() { return this.operation('chrome', async gen => {
    await this.noLock(); this.log('Starting / reusing dedicated Chrome'); await this.run('chrome', gen);
    this.state.cdp = await this.deps.cdp(); if (!this.state.cdp) throw new Error('CDP_PROFILE_OR_BIND_UNVERIFIED');
    if (gen !== this.generation) return;
    this.state.headline = 'Chrome is reachable'; this.state.detail = 'Run Prepare to verify the booking page and session.';
  }); }
  inspectOnda() { return this.operation('inspect', async gen => {
    await this.noLock(); this.state.inspection = null; this.log('Inspecting Onda — read only'); await this.run('inspect', gen);
    this.state.headline = 'Inspection complete'; this.state.detail = 'Review the observed status below. Prepare before arming.';
  }); }
  prepare() { return this.operation('prepare', async gen => {
    this.state.booking=this.deps.booking(); this.state.selection=null;
    await this.noLock(); this.state.inspection = null; this.log('Preparing session — no observation will be armed');
    await this.run('chrome', gen);
    this.state.cdp = await this.deps.cdp(); if (!this.state.cdp) throw new Error('CDP_PROFILE_OR_BIND_UNVERIFIED');
    await this.run('inspect', gen); await this.noLock();
    if (gen !== this.generation) return;
    const inspection = this.state.inspection as Dashboard['inspection'];
    if (!inspection?.gridToday) throw new Error('STALE_OR_INCOMPLETE_GRID');
    if (!inspection.allCourts) throw new Error('COURT_FILTER_NOT_ALL');
    if (inspection.selected !== 0) throw new Error('PREEXISTING_SELECTION');
    if (!inspection.visible) throw new Error('TAB_NOT_VISIBLE');
    this.state.clock = this.deps.clock(); if (!this.state.clock.canArmToday) throw new Error('TOO_LATE_FOR_PREFLIGHT');
    this.state.ready = true; this.state.headline = `Ready for ${this.state.clock.releaseTime.slice(0, 5)}`;
    this.state.detail = 'Booking plan and local player information validated. Today’s grid, All Courts, zero selected slots and clear lock verified. Nothing is armed.';
    this.log('READY — preparation completed. Nothing armed.');
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
    await this.noLock(); const setup=BookingSetupSchema.parse(input);
    this.state.booking=this.deps.saveBooking(setup); this.state.selection=null;
    this.state.headline='Booking plan saved'; this.state.detail='Review the compiled plan, then Prepare Booking. Terms authorization is off.';
  }); }
  armSelection() { return this.armBooking('selection'); }
  dryRace() { return this.armBooking('dry'); }
  private armBooking(kind:'selection'|'dry') { return this.operation('confirming', async gen => {
    await this.noLock(); if (!this.deps.clock().canArmToday) throw new Error('TOO_LATE_FOR_PREFLIGHT');
    if (kind==='selection' && !this.state.capabilities.selectionReady) throw new Error('SELECTION_NOT_READY');
    const plan=this.deps.booking(); this.state.booking=plan; this.state.selection=null;
    const confirmed=await this.deps.confirm(kind,plan);
    if(gen!==this.generation)return;
    if(!confirmed){this.state.headline='Arming cancelled';this.state.detail='No booking process was launched.';return;}
    await this.noLock();
    if(this.deps.booking().fingerprint!==plan.fingerprint)throw new Error('BOOKING_PLAN_CHANGED');
    if(!this.deps.clock().canArmToday)throw new Error('TOO_LATE_FOR_PREFLIGHT');
    this.state.operation=kind;this.state.inspection=null;this.state.headline=kind==='selection'?'Selection scheduled':'Dry Race scheduled';
    this.state.detail=kind==='selection'?'At release the engine may select slots. It will stop before Proceed.':'Release, date, grid and preference checks only. No slots will be selected.';this.publish();
    await this.run({kind,planHash:plan.fingerprint},gen);
    if(kind==='dry'){this.state.headline='Dry Race complete';this.state.detail='No slots selected. Review availability and preference events.';}
    else if(!this.state.selection)throw new Error('SELECTION_RESULT_MISSING');
  }); }
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
