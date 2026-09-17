import {FullPracticeSchema,selectExactPractice} from './full-practice.js';
import { writeFileSync } from 'node:fs';
import { mkdir as mkdirAsync, open as openAsync, unlink as unlinkAsync,writeFile as writeFileAsync } from 'node:fs/promises';
import { Safety, requireArmed } from './safety.js';
import { Telemetry, sanitizedOperationFailureCode } from './telemetry.js';
import { loadConfig, loadObservationConfig, planFingerprint, expandHours, type Config, type ReleaseSettings } from './config.js';
import { attach } from './browser.js';
import { inspect } from './inspector.js';
import { practice, PracticeSchema } from './practice.js';
import { observeRelease } from './release.js';
import { emitUiEvent } from './ui-events.js';
import { requireCapability } from './capabilities.js';
import { selectionPort, selectResolvedPreference } from './selection.js';
import { fullBookingToQr } from './booking-checkout.js';
import {navigateDate,snapshot} from './grid.js';
import { checkPreopenStability } from './preopen-check.js';
import { assertReloadProfileTime, profileReload, formatReloadProfile } from './reload-profile.js';
import { dryCurrentAvailability } from './availability-dry.js';
import { compareCurrentAvailability } from './availability-compare.js';
import { assertAvailabilityDate } from './onda-availability.js';
import {ScheduledReleaseContextSchema} from './scheduled-release.js';

const safety = new Safety();
const telemetry = new Telemetry();
telemetry.mark('processStarted');
let exitCode = 0;
let failureCode: string | undefined;
let ownsLock = false;
let retainSelection = false;
let stopDual: (()=>void) | undefined;
const lockPath = '.local/automation.lock';
const retainedHandoff=(hold:{countdown:string;verifiedAt:string})=>{const [m,s]=hold.countdown.split(':').map(Number);return {stage:'HOLD_VERIFIED',stageAt:new Date().toISOString(),holdVerifiedAt:hold.verifiedAt,holdExpiresAt:new Date(Date.parse(hold.verifiedAt)+(m!*60+s!)*1000).toISOString()};};
// Exiting the Playwright-owning process cancels its outstanding local action tasks.
// Never close Chrome/context/page; an already-dispatched click cannot be undone.
const stopNow = (code: string) => {
  stopDual?.();
  emitUiEvent({ type: 'error', code: /^[A-Z_]{1,80}$/.test(code) ? code : 'OPERATION_FAILED' });
  telemetry.mark(code === 'USER_ABORT' ? 'aborted' : 'failed');
  try { writeFileSync(`DiagnosticsLocal/${telemetry.runID}.json`, JSON.stringify(telemetry.document(code, safety.stopEvidence))); } catch {}
  telemetry.publishPerformance();
  console.error(code === 'USER_ABORT' ? 'AUTOMATION ABORTED — USER CONTROL RESTORED' : code);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  // Keep lock on abrupt termination: fail closed until user checks the browser.
  process.exit(code === 'USER_ABORT' ? 130 : 1);
};
safety.signal.addEventListener('abort', () => stopNow(safety.signal.reason instanceof Error ? safety.signal.reason.message : 'ABORTED'), { once: true });
process.once('SIGINT', () => safety.stop('USER_ABORT'));
process.once('SIGTERM', () => safety.stop('USER_ABORT'));
// UI runs this CLI directly with Node --import tsx (no npm/tsx worker process).
// IPC abort uses exactly the same Safety path as Q/Ctrl+C. Parent loss also stops it.
if (process.env.THIRSTY_UI_EVENTS === '1' && process.env.THIRSTY_UI_PARENT_PID && !process.connected) safety.stop('USER_ABORT');
if (process.env.THIRSTY_UI_EVENTS === '1' && process.connected) {
  process.on('message', message => { if (message && typeof message === 'object' && 'type' in message && message.type === 'abort') safety.stop('USER_ABORT'); });
  process.once('disconnect', () => safety.stop('USER_ABORT'));
}
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true); process.stdin.resume();
  process.stdin.on('data', chunk => { if (/[qQ\u0003]/.test(chunk.toString())) safety.stop('USER_ABORT'); });
}
try {
  const [mode, ...args] = process.argv.slice(2);
  if (!mode || !['inspect', 'practice', 'availability:compare', 'availability:dry', 'release:observe', 'release:preopen-check', 'release:reload-profile', 'race:dry', 'race', 'selection:armed','handoff:test','practice:full'].includes(mode)) throw new Error('MODE_REQUIRED');
  if (mode === 'release:reload-profile') assertReloadProfileTime();
  const allowed = new Set(['availability:compare', 'availability:dry'].includes(mode) ? ['--date'] : mode === 'practice' ? ['--date', '--court', '--start', '--duration'] : ['handoff:test','practice:full'].includes(mode)?['--maximum','--date','--court','--start','--duration','--armed','--authorize-terms','--noncompetitive']:['--armed', '--authorize-terms', '--plan-hash','--scheduled-release']);
  for (const arg of args.filter(a => a.startsWith('--'))) if (!allowed.has(arg)) throw new Error('UNKNOWN_ARGUMENT');
  requireArmed(mode, args.includes('--armed'));
  requireCapability(mode);
  if(['race','handoff:test','practice:full'].includes(mode)&&!args.includes('--authorize-terms'))throw new Error('TERMS_AUTHORIZATION_REQUIRED');
  if(mode==='handoff:test'&&!args.includes('--noncompetitive'))throw new Error('NONCOMPETITIVE_TARGET_REQUIRED');
  const config: Config | ReleaseSettings | undefined = ['release:observe', 'release:preopen-check'].includes(mode) ? loadObservationConfig() : ['availability:dry','race:dry','selection:armed','race','handoff:test','practice:full'].includes(mode) ? loadConfig() : undefined;
  const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
  const scheduledRaw=value('--scheduled-release');
  const scheduled=scheduledRaw?ScheduledReleaseContextSchema.parse(JSON.parse(scheduledRaw)):undefined;
  if(mode==='race'&&!scheduled)throw Error('SCHEDULE_CONTEXT_REQUIRED');
  const compareDate = ['availability:compare', 'availability:dry'].includes(mode) ? value('--date') ?? '' : undefined;
  if (compareDate !== undefined) assertAvailabilityDate(compareDate);
  if (args.includes('--plan-hash') && (!config || !('MAX_PRICE' in config) || planFingerprint(config as Config) !== value('--plan-hash'))) throw new Error('BOOKING_PLAN_CHANGED');
  // Default single mode never imports or initializes the dual coordinator.
  if (config && 'COURT_COUNT' in config && ((config as Config).BOOKING_TYPE === 'extended' || config.COURT_COUNT === 2) && ['race','race:dry','selection:armed'].includes(mode)) {
    const { runBooking } = await import('./booking-runtime.js');
    await runBooking(config as Config, mode === 'race' ? 'race' : mode === 'race:dry' ? 'race:dry' : 'race:selection', safety, telemetry, { authorizeTerms:args.includes('--authorize-terms'),...(scheduled?{scheduledTarget:{releaseMs:scheduled.releaseMs,releaseISO:scheduled.releaseISO,targetDate:scheduled.targetDate},scheduledFingerprint:scheduled.configFingerprint}:{}) });
    await telemetry.flush();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.exit(0);
  }
  if (scheduled) { telemetry.mark('scheduledWorkerWake'); telemetry.mark('workerStart'); }
  const practiceInput = mode === 'practice' ? PracticeSchema.parse({ date: value('--date'), court: value('--court'), start: value('--start'), duration: value('--duration') }) : undefined;
  const fullPractice=mode==='practice:full'?FullPracticeSchema.parse({target:{date:value('--date'),court:value('--court'),start:value('--start'),duration:value('--duration')},maximum:Number(value('--maximum')),authorizeTerms:args.includes('--authorize-terms')}):undefined;
  const handoffInput=mode==='handoff:test'?PracticeSchema.parse({date:value('--date'),court:value('--court'),start:value('--start'),duration:value('--duration')}):undefined;
  await mkdirAsync('.local', { recursive: true }); await mkdirAsync('DiagnosticsLocal', { recursive: true });
  const lock = await openAsync(lockPath, 'wx').catch(() => { throw new Error('AUTOMATION_LOCK_EXISTS: verify no bot is running and selections are clean before removing .local/automation.lock'); });
  ownsLock = true; await lock.writeFile(JSON.stringify({ pid: process.pid, runID: telemetry.runID })); await lock.close();
  const { lifecycleWriter } = await import('./checkout-lifecycle.js');
  safety.persistStage=lifecycleWriter(lockPath,{pid:process.pid,runID:telemetry.runID});
  const { page } = await attach(safety, telemetry); telemetry.mark('chromeConnected'); telemetry.mark('ondaTabResolved');
  if (scheduled) telemetry.mark('browserAttached', 1);
  if (mode === 'inspect') await inspect(page);
  else if (compareDate !== undefined) {
    const result = mode === 'availability:dry'
      ? await dryCurrentAvailability(page, compareDate, config as Config, safety, telemetry)
      : await compareCurrentAvailability(page, compareDate, safety, telemetry);
    await writeFileAsync(`DiagnosticsLocal/${mode.replace(':', '-')}-${telemetry.runID}.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  }
  else if (mode === 'release:reload-profile') {
    const result = await profileReload(page, safety, telemetry);
    await writeFileAsync(`DiagnosticsLocal/reload-profile-${telemetry.runID}.json`, JSON.stringify(result, null, 2));
    console.log(formatReloadProfile(result));
  }
  else if (mode === 'release:preopen-check' && config) {
    const result = await checkPreopenStability(page, config, safety, telemetry);
    await writeFileAsync(`DiagnosticsLocal/preopen-check-${telemetry.runID}.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  }
  else if (practiceInput) await practice(page, practiceInput, safety, telemetry);
  else if(fullPractice&&config){
    const booking=config as Config;
    const result=await selectExactPractice(page,fullPractice,safety,telemetry);
    retainSelection=true;emitUiEvent({type:'selection',...result});
    const hold=await fullBookingToQr(page,result,{fullName:booking.PLAYER_FULL_NAME,phone:booking.PLAYER_PHONE,email:booking.PLAYER_EMAIL},fullPractice.maximum,true,booking.PAYMENT_HANDOFF_VERIFY_TIMEOUT_MS,safety,telemetry,booking.PAYMENT_SUMMARY_READY_TIMEOUT_MS);
    await writeFileAsync(lockPath,JSON.stringify({pid:process.pid,runID:telemetry.runID,...retainedHandoff(hold),handoff:{type:'handoff',date:result.date,court:result.court,hours:result.hours,...hold}}));
  }
  else if(handoffInput&&config){
    const booking=config as Config;
    if((await snapshot(page)).cells.some(c=>c.state==='selected'))throw new Error('PREEXISTING_SELECTION');
    await navigateDate(page,handoffInput.date,safety);
    telemetry.mark('gridSnapshotStarted');const grid=await snapshot(page);telemetry.mark('gridSnapshotCompleted');
    const result=await selectResolvedPreference(selectionPort(page,safety),handoffInput.date,grid,[{court:handoffInput.court,hours:expandHours(handoffInput.start,handoffInput.duration)}],booking.MAX_PRICE,1,safety,telemetry);
    retainSelection=true;emitUiEvent({type:'selection',...result});
    const hold=await fullBookingToQr(page,result,{fullName:booking.PLAYER_FULL_NAME,phone:booking.PLAYER_PHONE,email:booking.PLAYER_EMAIL},booking.MAX_PRICE,true,booking.PAYMENT_HANDOFF_VERIFY_TIMEOUT_MS,safety,telemetry,booking.PAYMENT_SUMMARY_READY_TIMEOUT_MS);
    await writeFileAsync(lockPath,JSON.stringify({pid:process.pid,runID:telemetry.runID,...retainedHandoff(hold),handoff:{type:'handoff',date:result.date,court:result.court,hours:result.hours,...hold}}));
    console.log('PAYMENT HOLD ACTIVE — AUTOMATION STOPPED. Complete payment manually in Chrome. AUTOMATION LOCK RETAINED.');
  }
  else if (config) {
    const selecting = mode === 'selection:armed' || mode === 'race';
    const target=scheduled?{releaseMs:scheduled.releaseMs,releaseISO:scheduled.releaseISO,targetDate:scheduled.targetDate}:undefined;
    if(scheduled&&(!('MAX_PRICE' in config)||scheduled.configFingerprint!==planFingerprint(config as Config)||Date.now()>=scheduled.releaseMs))throw Error(Date.now()>=scheduled.releaseMs?'RELEASE_MISSED':'SCHEDULE_CONTEXT_MISMATCH');
    const released = await observeRelease(page, config, safety, telemetry, mode === 'race:dry', selecting,target?{target,beforeArmed:async()=>{},verifyContext:()=>{if(scheduled!.configFingerprint!==planFingerprint(loadConfig()))throw Error('SCHEDULE_CONTEXT_MISMATCH');}}:undefined);
    if (selecting && 'MAX_PRICE' in config) {
      const booking = config as Config;
      const result = await selectResolvedPreference(selectionPort(page, safety), released.target.targetDate, released.grid, released.preferences, booking.MAX_PRICE, booking.MAX_SELECTION_ATTEMPTS, safety, telemetry, released.discovery)
        .finally(() => released.discovery?.finish());
      retainSelection = true;
      emitUiEvent({ type: 'selection', ...result });
      if(mode==='race'){
        const hold=await fullBookingToQr(page,result,{fullName:booking.PLAYER_FULL_NAME,phone:booking.PLAYER_PHONE,email:booking.PLAYER_EMAIL},booking.MAX_PRICE,true,booking.PAYMENT_HANDOFF_VERIFY_TIMEOUT_MS,safety,telemetry,booking.PAYMENT_SUMMARY_READY_TIMEOUT_MS);
        await writeFileAsync(lockPath,JSON.stringify({pid:process.pid,runID:telemetry.runID,...retainedHandoff(hold),handoff:{type:'handoff',date:result.date,court:result.court,hours:result.hours,...hold}}));
      }
      else console.log('SLOTS SELECTED — AUTOMATION STOPPED BEFORE PROCEED. USER CONTROL RESTORED. Lock retained; inspect Chrome before clearing manually.');
    }
  }
  telemetry.mark('automationStopped');
} catch (error) {
  exitCode = 1; telemetry.mark('failed');
  // Zod input exceptions may contain values: print only issue paths.
  const e = error as { name?: string; issues?: { path: unknown[] }[]; message?: string };
  failureCode = /^[A-Z_]{1,80}(?=:|$)/.exec(e.message ?? '')?.[0] ?? sanitizedOperationFailureCode(error);
  emitUiEvent({ type: 'error', code: failureCode });
  console.error(e.name === 'ZodError' ? `INVALID_PRACTICE_ARGUMENTS: ${e.issues?.map(i => i.path.join('.')).join(', ')}` : e.message?.startsWith('CONFIG_INVALID') || /^[A-Z_]+(?::|$)/.test(e.message ?? '') ? e.message : 'OPERATION_FAILED — no automatic recovery. Check the browser manually.');
} finally {
  await telemetry.flush(failureCode, safety.stopEvidence);
  // Keep lock after failures as selection state can be uncertain.
  if (ownsLock && exitCode === 0 && !retainSelection) await unlinkAsync(lockPath);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
}
process.exit(exitCode);
