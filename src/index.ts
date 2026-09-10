import { writeFileSync } from 'node:fs';
import { mkdir as mkdirAsync, open as openAsync, unlink as unlinkAsync,writeFile as writeFileAsync } from 'node:fs/promises';
import { Safety, requireArmed } from './safety.js';
import { Telemetry } from './telemetry.js';
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

const safety = new Safety();
const telemetry = new Telemetry();
telemetry.mark('processStarted');
let exitCode = 0;
let ownsLock = false;
let retainSelection = false;
const lockPath = '.local/automation.lock';
// Exiting the Playwright-owning process cancels its outstanding local action tasks.
// Never close Chrome/context/page; an already-dispatched click cannot be undone.
const stopNow = (code: string) => {
  emitUiEvent({ type: 'error', code: /^[A-Z_]{1,80}$/.test(code) ? code : 'OPERATION_FAILED' });
  telemetry.mark(code === 'USER_ABORT' ? 'aborted' : 'failed');
  try { writeFileSync(`DiagnosticsLocal/${telemetry.runID}.json`, JSON.stringify({ runID: telemetry.runID, events: telemetry.events })); } catch {}
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
  if (!mode || !['inspect', 'practice', 'release:observe', 'race:dry', 'race', 'selection:armed','handoff:test'].includes(mode)) throw new Error('MODE_REQUIRED');
  const allowed = new Set(mode === 'practice' ? ['--date', '--court', '--start', '--duration'] : mode==='handoff:test'?['--date','--court','--start','--duration','--armed','--authorize-terms','--noncompetitive']:['--armed', '--authorize-terms', '--plan-hash']);
  for (const arg of args.filter(a => a.startsWith('--'))) if (!allowed.has(arg)) throw new Error('UNKNOWN_ARGUMENT');
  requireArmed(mode, args.includes('--armed'));
  requireCapability(mode);
  if(['race','handoff:test'].includes(mode)&&!args.includes('--authorize-terms'))throw new Error('TERMS_AUTHORIZATION_REQUIRED');
  if(mode==='handoff:test'&&!args.includes('--noncompetitive'))throw new Error('NONCOMPETITIVE_TARGET_REQUIRED');
  const config: Config | ReleaseSettings | undefined = mode === 'release:observe' ? loadObservationConfig() : ['race:dry','selection:armed','race','handoff:test'].includes(mode) ? loadConfig() : undefined;
  const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
  if (args.includes('--plan-hash') && (!config || !('MAX_PRICE' in config) || planFingerprint(config as Config) !== value('--plan-hash'))) throw new Error('BOOKING_PLAN_CHANGED');
  const practiceInput = mode === 'practice' ? PracticeSchema.parse({ date: value('--date'), court: value('--court'), start: value('--start'), duration: value('--duration') }) : undefined;
  const handoffInput=mode==='handoff:test'?PracticeSchema.parse({date:value('--date'),court:value('--court'),start:value('--start'),duration:value('--duration')}):undefined;
  await mkdirAsync('.local', { recursive: true }); await mkdirAsync('DiagnosticsLocal', { recursive: true });
  const lock = await openAsync(lockPath, 'wx').catch(() => { throw new Error('AUTOMATION_LOCK_EXISTS: verify no bot is running and selections are clean before removing .local/automation.lock'); });
  ownsLock = true; await lock.writeFile(JSON.stringify({ pid: process.pid, runID: telemetry.runID })); await lock.close();
  const { page } = await attach(safety); telemetry.mark('chromeConnected'); telemetry.mark('ondaTabResolved');
  if (mode === 'inspect') await inspect(page);
  else if (practiceInput) await practice(page, practiceInput, safety, telemetry);
  else if(handoffInput&&config){
    const booking=config as Config;
    if((await snapshot(page)).cells.some(c=>c.state==='selected'))throw new Error('PREEXISTING_SELECTION');
    await navigateDate(page,handoffInput.date,safety);
    telemetry.mark('gridSnapshotStarted');const grid=await snapshot(page);telemetry.mark('gridSnapshotCompleted');
    const result=await selectResolvedPreference(selectionPort(page,safety),handoffInput.date,grid,[{court:handoffInput.court,hours:expandHours(handoffInput.start,handoffInput.duration)}],booking.MAX_PRICE,1,safety,telemetry);
    retainSelection=true;emitUiEvent({type:'selection',...result});
    const hold=await fullBookingToQr(page,result,{fullName:booking.PLAYER_FULL_NAME,phone:booking.PLAYER_PHONE,email:booking.PLAYER_EMAIL},booking.MAX_PRICE,true,booking.PAYMENT_HANDOFF_VERIFY_TIMEOUT_MS,safety,telemetry,booking.PAYMENT_SUMMARY_READY_TIMEOUT_MS);
    await writeFileAsync(lockPath,JSON.stringify({pid:process.pid,runID:telemetry.runID,handoff:{type:'handoff',date:result.date,court:result.court,hours:result.hours,...hold}}));
    console.log('PAYMENT HOLD ACTIVE — AUTOMATION STOPPED. Complete payment manually in Chrome. AUTOMATION LOCK RETAINED.');
  }
  else if (config) {
    const selecting = mode === 'selection:armed' || mode === 'race';
    const released = await observeRelease(page, config, safety, telemetry, mode === 'race:dry', selecting);
    if (selecting && 'MAX_PRICE' in config) {
      const booking = config as Config;
      const result = await selectResolvedPreference(selectionPort(page, safety), released.target.targetDate, released.grid, released.preferences, booking.MAX_PRICE, booking.MAX_SELECTION_ATTEMPTS, safety, telemetry);
      retainSelection = true;
      emitUiEvent({ type: 'selection', ...result });
      if(mode==='race'){
        const hold=await fullBookingToQr(page,result,{fullName:booking.PLAYER_FULL_NAME,phone:booking.PLAYER_PHONE,email:booking.PLAYER_EMAIL},booking.MAX_PRICE,true,booking.PAYMENT_HANDOFF_VERIFY_TIMEOUT_MS,safety,telemetry,booking.PAYMENT_SUMMARY_READY_TIMEOUT_MS);
        await writeFileAsync(lockPath,JSON.stringify({pid:process.pid,runID:telemetry.runID,handoff:{type:'handoff',date:result.date,court:result.court,hours:result.hours,...hold}}));
      }
      else console.log('SLOTS SELECTED — AUTOMATION STOPPED BEFORE PROCEED. USER CONTROL RESTORED. Lock retained; inspect Chrome before clearing manually.');
    }
  }
  telemetry.mark('automationStopped');
} catch (error) {
  exitCode = 1; telemetry.mark('failed');
  // Zod input exceptions may contain values: print only issue paths.
  const e = error as { name?: string; issues?: { path: unknown[] }[]; message?: string };
  emitUiEvent({ type: 'error', code: /^[A-Z_]{1,80}(?=:|$)/.exec(e.message ?? '')?.[0] ?? 'OPERATION_FAILED' });
  console.error(e.name === 'ZodError' ? `INVALID_PRACTICE_ARGUMENTS: ${e.issues?.map(i => i.path.join('.')).join(', ')}` : e.message?.startsWith('CONFIG_INVALID') || /^[A-Z_]+(?::|$)/.test(e.message ?? '') ? e.message : 'OPERATION_FAILED — no automatic recovery. Check the browser manually.');
} finally {
  await telemetry.flush();
  // Keep lock after failures as selection state can be uncertain.
  if (ownsLock && exitCode === 0 && !retainSelection) await unlinkAsync(lockPath);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
}
process.exit(exitCode);
