import { lifecycleWriter, atomicJson } from './checkout-lifecycle.js';
import { mkdir, open, writeFile, unlink, readFile, rename, realpath } from 'node:fs/promises';
import { attach, browserA, browserB } from './browser.js';
import { assertDiagnosticSchedule } from './diagnostic-schedule.js';
import { readScheduleReadiness } from './readiness.js';
import { releaseCalendar, planFingerprint, type Config } from './config.js';
import { navigateDate, snapshot, type Snapshot } from './grid.js';
import { selectionPort, type SelectionResult } from './selection.js';
import { fullBookingToQr } from './booking-checkout.js';
import { observeRelease } from './release.js';
import { Safety } from './safety.js';
import { Telemetry } from './telemetry.js';
import { coordinateDual, dualArmGate, type DualWorker, type DualCandidate, type DualResult } from './dual-coordinator.js';
import { emitUiEvent } from './ui-events.js';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { abortDualWorkers } from './dual-coordinator.js';

export type DualMode = 'readiness' | 'dry' | 'practice' | 'selection' | 'full' | 'race:dry' | 'race:selection' | 'race';
export const dualEvidencePath = '.local/dual/evidence.json';
export function dualValidationFingerprint(c: Config) {
  return createHash('sha256').update(JSON.stringify({ count:c.COURT_COUNT, start:c.START_TIME, duration:c.DURATION_HOURS, courts:[...c.PREFERRED_COURTS,...c.FALLBACK_COURTS], times:c.FALLBACK_TIMES, maximum:c.MAX_PRICE, attempts:c.MAX_SELECTION_ATTEMPTS })).digest('hex');
}
export async function readDualEvidence(fingerprint: string) {
  try { const e = JSON.parse(await readFile(dualEvidencePath, 'utf8')); return e.fingerprint === fingerprint ? e : {}; } catch { return {}; }
}
async function recordEvidence(fingerprint: string, kind: 'readiness' | 'dry' | 'selection' | 'full') {
  const prior = await readDualEvidence(fingerprint);
  await writeFile(dualEvidencePath + '.tmp', JSON.stringify({ ...prior, fingerprint, [kind]:new Date().toISOString() }));
  await rename(dualEvidencePath + '.tmp', dualEvidencePath);
}
export async function requireDualEvidence(fingerprint: string, full: boolean) {
  const e = await readDualEvidence(fingerprint);
  if (!e.readiness || !e.dry || !e.selection) throw Error('DUAL_SELECTION_NOT_READY');
  if (full && !e.full) throw Error('DUAL_FULL_FLOW_NOT_VERIFIED');
}
export async function runDual(config: Config, mode: DualMode, safety: Safety, t: Telemetry,
  options: { date?:string; exact?:DualCandidate; authorizeTerms?:boolean; maximum?:number; registerAbort?:(abort:()=>void)=>void } = {}) {
  if (mode !== 'readiness' && (config.BOOKING_TYPE !== 'standard' || config.COURT_COUNT !== 2)) throw Error('DUAL_CONFIG_REQUIRED');
  if (['full','practice'].includes(mode) && !options.exact) throw Error('EXACT_DUAL_TARGET_REQUIRED');
  if (options.maximum !== undefined && (!Number.isFinite(options.maximum) || options.maximum <= 0)) throw Error('INVALID_SELECTION_LIMIT');
  if (['full','race'].includes(mode) && !options.authorizeTerms) throw Error('TERMS_AUTHORIZATION_REQUIRED');
  const fingerprint = planFingerprint(config), validationFingerprint = dualValidationFingerprint(config), target = releaseCalendar(config);
  if (mode === 'race' || mode === 'race:selection') await requireDualEvidence(validationFingerprint, mode === 'race');
  if (options.maximum !== undefined) config = { ...config, MAX_PRICE:options.maximum };
  const date = mode.startsWith('race') ? target.targetDate : options.exact?.date ?? options.date;
  if (mode !== 'readiness' && !date) throw Error('EXPLICIT_DATE_REQUIRED');
  await mkdir('.local/dual', { recursive:true });
  const lock = await open('.local/automation.lock', 'wx').catch(() => { throw Error('AUTOMATION_LOCK_EXISTS'); });
  const workerRecords = ['A','B'].map(id => ({ id, pid:process.pid, runID:t.runID, state:'unknown' }));
  await lock.writeFile(JSON.stringify({ mode:'dual', pid:process.pid, runID:t.runID, workers:workerRecords })); await lock.close();
  let cleanExit = false;
  const workerSafeties = [new Safety(), new Safety()];
  const workerTelemetry = [new Telemetry(), new Telemetry()];
  const abort = () => {
    abortDualWorkers(workerSafeties);
    for(const log of [t,...workerTelemetry])try{writeFileSync(`DiagnosticsLocal/${log.runID}.json`,JSON.stringify(log.document('USER_ABORT')));}catch{}
  };
  options.registerAbort?.(abort);
  safety.signal.addEventListener('abort', abort, { once:true });
  t.mark('dualRunStarted'); t.mark('dualPreflightStarted');
  try {
    for (const r of workerRecords) {
      const state = await open(`.local/dual/worker-${r.id.toLowerCase()}.lock`, 'wx').catch(() => { throw Error('DUAL_WORKER_STATE_EXISTS'); });
      await state.writeFile(JSON.stringify(r)); await state.close();
      workerSafeties[r.id==='A'?0:1]!.persistStage=lifecycleWriter(`.local/dual/worker-${r.id.toLowerCase()}.lock`,{pid:process.pid,runID:t.runID});
    }
    const attached = await Promise.allSettled([browserA, browserB].map(async (identity, i) => {
      const w = await attach(workerSafeties[i]!, workerTelemetry[i], identity);
      await assertDiagnosticSchedule(w.page, workerSafeties[i]!);
      const readiness = await readScheduleReadiness(w.page);
      emitUiEvent({ type:'dualWorker', workerId:identity.workerId, state:'ready', verifiedAt:new Date().toISOString() });
      console.log(`Browser ${identity.workerId}: clean visible schedule, zero selections, no hold`);
      return { ...w, readiness };
    }));
    if (attached.some(w => w.status === 'rejected')) {
      attached.forEach((w,i) => { if (w.status === 'rejected') console.error(`Browser ${i === 0 ? 'A' : 'B'}: ${/^[A-Z_]{1,80}$/.test(w.reason?.message ?? '') ? w.reason.message : 'NOT_READY'}`); });
      throw Error('DUAL_BROWSER_NOT_READY');
    }
    const connections = attached.map(w => { if (w.status !== 'fulfilled') throw Error('DUAL_BROWSER_NOT_READY'); return w.value; });
    // Also reject junction/symlink aliases of the same physical profile directory.
    const profiles=await Promise.all([browserA,browserB].map(identity=>realpath(identity.expectedProfile)));
    if(profiles[0]!.toLowerCase()===profiles[1]!.toLowerCase())throw Error('DUAL_PROFILE_NOT_ISOLATED');
    const workers = connections.map((connection, i): DualWorker => ({
      id:i === 0 ? 'A' : 'B', safety:workerSafeties[i]!, telemetry:workerTelemetry[i]!,
      port:selectionPort(connection.page, workerSafeties[i]!),
      checkout: async selected => { await fullBookingToQr(connection.page, selected,
        { fullName:config.PLAYER_FULL_NAME, phone:config.PLAYER_PHONE, email:config.PLAYER_EMAIL }, config.MAX_PRICE,
        true, config.PAYMENT_HANDOFF_VERIFY_TIMEOUT_MS, workerSafeties[i]!, workerTelemetry[i]!, config.PAYMENT_SUMMARY_READY_TIMEOUT_MS); },
      state: async (state, selected?:SelectionResult) => {
        const path=`.local/dual/worker-${i === 0 ? 'a' : 'b'}.lock`;
        const prior=JSON.parse(await readFile(path,'utf8'));
        await atomicJson(path,{...prior,state,...(selected?{selection:selected}:{})});
        emitUiEvent({ type:'dualWorker', workerId:i === 0 ? 'A' : 'B', state, verifiedAt:new Date().toISOString(), ...(selected ? { court:selected.court, date:selected.date, hours:selected.hours, amount:selected.amount } : {}) });
      },
    })) as [DualWorker, DualWorker];
    await Promise.all(workers.map(w => w.state('clean')));
    await recordEvidence(validationFingerprint, 'readiness');
    if (mode === 'readiness') { cleanExit = true; console.log('DUAL READINESS PASS — no browser clicks'); return; }
    let grids: [Snapshot, Snapshot];
    if (mode.startsWith('race')) {
      const gate = dualArmGate(target, safety, t);
      let triggered = false;
      const released = await Promise.all(connections.map(async (connection, i) => {
        try {
          if (planFingerprint(config) !== fingerprint) throw Error('DUAL_PLAN_MISMATCH');
          const r = await observeRelease(connection.page, config, workerSafeties[i]!, workerTelemetry[i]!, mode === 'race:dry', true,
            { target, beforeArmed:() => gate(i === 0 ? 'A' : 'B'), onRelease:() => { if(!triggered){triggered=true;t.mark('dualReleaseTriggered',Date.now()-target.releaseMs);} } });
          t.mark(`worker${i === 0 ? 'A' : 'B'}GridReady`); workers[i]!.discovery = r.discovery;
          return r;
        } catch (error) { abort(); safety.stop('DUAL_PREFLIGHT_FAILED'); throw error; }
      }));
      grids = released.map(r => r.grid) as [Snapshot, Snapshot];
    } else {
      const observed = await Promise.allSettled(connections.map(async (connection, i) => {
        await navigateDate(connection.page, date!, workerSafeties[i]!);
        const grid = await snapshot(connection.page); t.mark(`worker${i === 0 ? 'A' : 'B'}GridReady`); return grid;
      }));
      grids = observed.map(r=>{if(r.status==='rejected')throw r.reason;return r.value;}) as [Snapshot,Snapshot];
    }
    t.mark('bothGridsReady');
    let result: DualResult;
    try { result = await coordinateDual(workers, date!, grids, config, mode === 'race' ? 'full' : mode === 'race:dry' ? 'dry' : mode === 'race:selection' ? 'selection' : mode, t, options.exact); }
    finally { for (const w of workers) if (w.discovery && 'finish' in w.discovery) (w.discovery as { finish():void }).finish(); }
    console.log(JSON.stringify(result, null, 2));
    console.log(result.status.replaceAll('_', ' '));
    emitUiEvent({ type:'dualResult', status:result.status, date:result.pair.date, start:result.pair.start, hours:result.pair.hours, courtA:result.pair.a.court, courtB:result.pair.b.court, candidateSource:result.candidateSource });
    if (result.status === 'DUAL_DRY_PASS') { cleanExit = true; await recordEvidence(validationFingerprint, 'dry'); console.log('Slot clicks: 0. Proceed clicks: 0.'); }
    if (result.status === 'DUAL_SELECTION_PASS') { cleanExit = true; await recordEvidence(validationFingerprint, 'selection'); console.log('Both selections verified and cleaned. Remaining selected slots: A=0 B=0. Proceed clicks: 0.'); }
    if (result.status === 'DUAL_HOLD_VERIFIED' && mode === 'full') await recordEvidence(validationFingerprint, 'full');
    if (!cleanExit) console.log('Automation stopped. Inspect BOTH browsers manually. Locks retained. Payment stays manual.');
    if (result.status === 'DUAL_FAILED' || result.status === 'DUAL_PARTIAL_SUCCESS') throw Error(result.status);
    return result;
  } finally {
    safety.signal.removeEventListener('abort', abort);
    options.registerAbort?.(()=>{});
    await Promise.all(workerTelemetry.map(w => w.flush()));
    await writeFile(`DiagnosticsLocal/dual-${t.runID}.json`, JSON.stringify({ coordinator:t.document(), workers:workerTelemetry.map(w => w.document()), metrics:dualMetrics(t, workerTelemetry, mode.startsWith('race') ? target.releaseMs : undefined) }, null, 2));
    if (cleanExit) {
      for (const id of ['a','b']) await unlink(`.local/dual/worker-${id}.lock`);
      await unlink('.local/automation.lock');
    }
  }
}
export function dualMetrics(t: Telemetry, workers: Telemetry[], releaseMs?:number) {
  const wall = (log:Telemetry, event:string) => { const e = log.events.find(e => e.event === event); return e ? Date.parse(e.wall) : undefined; };
  const delta = (a:number|undefined, b:number|undefined) => a === undefined || b === undefined ? null : b-a;
  const bothGrid = wall(t,'bothGridsReady'), pair = wall(t,'dualPairResolved'), selections = wall(t,'dualSelectionVerified');
  const holds = workers.map(w => wall(w,'paymentHoldVerified') ?? wall(t,`worker${workers.indexOf(w) === 0 ? 'A' : 'B'}HoldVerified`));
  const proceeds = workers.map(w => wall(w,'bookingProceedClicked'));
  return { releaseToWorkerGrids:workers.map((_,i) => delta(releaseMs,wall(t,`worker${i === 0 ? 'A' : 'B'}GridReady`))), releaseToBothGrids:delta(releaseMs,bothGrid),
    bothGridsToPair:delta(bothGrid,pair), pairToFirstClicks:workers.map(w => delta(pair,wall(w,'slot1ClickStarted'))), releaseToBothSelections:delta(releaseMs,selections),
    selectionsToBothProceed:proceeds.every(v => v !== undefined) ? delta(selections,Math.max(...proceeds as number[])) : null,
    selectionToHold:workers.map((w,i) => delta(wall(w,'selectionVerified'),holds[i])),
    releaseToFirstHold:delta(releaseMs,holds.filter(v => v !== undefined).length ? Math.min(...holds.filter(v => v !== undefined)) : undefined),
    releaseToSecondHold:holds.every(v => v !== undefined) ? delta(releaseMs,Math.max(...holds as number[])) : null,
    releaseToBothHolds:holds.every(v => v !== undefined) ? delta(releaseMs,Math.max(...holds as number[])) : null };
}
