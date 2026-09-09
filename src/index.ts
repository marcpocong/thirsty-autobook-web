import { writeFileSync } from 'node:fs';
import { mkdir as mkdirAsync, open as openAsync, unlink as unlinkAsync } from 'node:fs/promises';
import { Safety, requireArmed } from './safety.js';
import { Telemetry } from './telemetry.js';
import { loadConfig, loadObservationConfig } from './config.js';
import { attach } from './browser.js';
import { inspect } from './inspector.js';
import { practice, PracticeSchema } from './practice.js';
import { observeRelease } from './release.js';

const safety = new Safety();
const telemetry = new Telemetry();
telemetry.mark('processStarted');
let exitCode = 0;
let ownsLock = false;
const lockPath = '.local/automation.lock';
// Exiting the Playwright-owning process cancels its outstanding local action tasks.
// Never close Chrome/context/page; an already-dispatched click cannot be undone.
const stopNow = (code: string) => {
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
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true); process.stdin.resume();
  process.stdin.on('data', chunk => { if (/[qQ\u0003]/.test(chunk.toString())) safety.stop('USER_ABORT'); });
}
try {
  const [mode, ...args] = process.argv.slice(2);
  if (!mode || !['inspect', 'practice', 'release:observe', 'race:dry', 'race'].includes(mode)) throw new Error('MODE_REQUIRED');
  const allowed = new Set(mode === 'practice' ? ['--date', '--court', '--start', '--duration'] : ['--armed', '--authorize-terms']);
  for (const arg of args.filter(a => a.startsWith('--'))) if (!allowed.has(arg)) throw new Error('UNKNOWN_ARGUMENT');
  requireArmed(mode, args.includes('--armed'));
  if (mode === 'race') throw new Error('LIVE_RACE_BLOCKED: Review Booking, player form and Payment Summary DOM have not been verified. No browser interaction performed.');
  const config = mode === 'release:observe' ? loadObservationConfig() : mode === 'race:dry' ? loadConfig() : undefined;
  const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
  const practiceInput = mode === 'practice' ? PracticeSchema.parse({ date: value('--date'), court: value('--court'), start: value('--start'), duration: value('--duration') }) : undefined;
  await mkdirAsync('.local', { recursive: true }); await mkdirAsync('DiagnosticsLocal', { recursive: true });
  const lock = await openAsync(lockPath, 'wx').catch(() => { throw new Error('AUTOMATION_LOCK_EXISTS: verify no bot is running and selections are clean before removing .local/automation.lock'); });
  ownsLock = true; await lock.writeFile(JSON.stringify({ pid: process.pid, runID: telemetry.runID })); await lock.close();
  const { page } = await attach(safety); telemetry.mark('chromeConnected'); telemetry.mark('ondaTabResolved');
  if (mode === 'inspect') await inspect(page);
  else if (practiceInput) await practice(page, practiceInput, safety, telemetry);
  else if (config) await observeRelease(page, config, safety, telemetry, mode === 'race:dry');
  telemetry.mark('automationStopped');
} catch (error) {
  exitCode = 1; telemetry.mark('failed');
  // Zod input exceptions may contain values: print only issue paths.
  const e = error as { name?: string; issues?: { path: unknown[] }[]; message?: string };
  console.error(e.name === 'ZodError' ? `INVALID_PRACTICE_ARGUMENTS: ${e.issues?.map(i => i.path.join('.')).join(', ')}` : e.message?.startsWith('CONFIG_INVALID') || /^[A-Z_]+(?::|$)/.test(e.message ?? '') ? e.message : 'OPERATION_FAILED — no automatic recovery. Check the browser manually.');
} finally {
  await telemetry.flush();
  // Keep lock after failures as selection state can be uncertain.
  if (ownsLock && exitCode === 0) await unlinkAsync(lockPath);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
}
process.exit(exitCode);
