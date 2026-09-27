import { describeBookingPlan } from '../src/booking-plan.js';
import { loadConfig,loadPlayerProfiles } from '../src/config.js';
import {reviewLock,clearVerifiedLock,browserProbe} from './locks.js';
import { app, BrowserWindow, ipcMain, session, powerSaveBlocker } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Controller } from './controller.js';
import { createRunner } from './processes.js';
import { ActivityJournal } from './activity-journal.js';
import { readLock, readHandoff, readRetainedHold, readPreviousHolds, readLatestQrHandoffs, probeCdp, probeBrowserHealth, readClock } from './status.js';
import { readBooking, saveBooking, describePlan } from './booking.js';
import { resetPracticeSession } from './practice-reset.js';
import {requiredWorkerIds,WORKER_IDS} from '../src/workers.js';
import {focusDedicatedBrowser} from '../src/browser-window.js';
import type {ConfirmRequest} from './types.js';
import {networkNowMs,readNetworkClock,synchronizeNetworkClock} from '../src/network-clock.js';
import {closeBotBrowsers,countBotBrowsers} from './browser-cleanup.js';
import {SlotWatch,readSlotWatchHistory} from '../src/slot-watch.js';
import {buildReleaseForensics,forensicInputsFor,forensicsDigest,readReleaseForensicsHistory} from '../src/release-forensics.js';
import {clearReleaseIntelligence,intelligenceDigest,readReleaseIntelligence,rebuildReleaseIntelligence} from '../src/release-intelligence.js';
import {adviseFromHistory} from '../src/release-advisor.js';
import {replayAll} from '../src/strategy-replay.js';
import {readNetworkReadinessHistory,runNetworkReadiness,saveNetworkReadiness} from '../src/network-readiness.js';
import {connectionWarmth} from '../src/checkout-path-research.js';
import {ensureExperimentManifest} from '../src/arbitration/experiment-manifest.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(root);
app.setName('Thirsty Pickle Bot');
app.setAppUserModelId('com.thirstypickle.bot');
app.setPath('userData', resolve(root, '.local/control-panel'));
const node = process.env.THIRSTY_NODE_EXEC;
if (!node) throw new Error('Launch the panel with npm run ui.');
const index = resolve(root, 'dist/ui/renderer/index.html');
const indexUrl = pathToFileURL(index).href;
let window: BrowserWindow;
let exiting = false;
// In-app confirmation modal: replaces native dialog.showMessageBox with a renderer-drawn
// dialog matching the app theme. Main still decides *when* to ask and blocks on the answer;
// the renderer only presents the question and reports back the operator's choice.
const pendingConfirms = new Map<string, (confirmed: boolean) => void>();
function confirmModal(request: Omit<ConfirmRequest, 'id'>): Promise<boolean> {
  const id = randomUUID();
  return new Promise<boolean>(settle => {
    pendingConfirms.set(id, settle);
    window.webContents.send('thirsty:confirmRequest', { id, ...request } satisfies ConfirmRequest);
  });
}
const controller = new Controller({
  confirmStopPrepare:async()=>confirmModal({tone:'question',title:'Reset & Prepare',message:'An automation is currently running.',detail:'Stop it and prepare a new session?',confirmLabel:'Stop and prepare'}),
  confirmBooking:async(plan,maximum)=>confirmModal({tone:'question',title:`${plan.strategy.toUpperCase()} TEST TO QR`,message:'Create temporary payment holds?',detail:describeBookingPlan(plan,maximum)+'\nIf availability changes before Proceed, the planner may retry other courts or valid splits within this requested time range and court count. Exact courts, when specified, are never substituted.\nTerms authorized for this test. Payment will NOT be automated.',confirmLabel:'Run Test to QR'}),
  confirmApiTest:async input=>{const workers=requiredWorkerIds(input.strategy,input.courtCount),count=workers.length,proofless=input.method==='proofless';return confirmModal({tone:'warning',title:proofless?'PROOFLESS DIRECT TEST TO QR':'API-FIRST TEST TO QR',message:`Create ${count} temporary API checkout hold${count===1?'':'s'}?`,detail:`Type: ${input.strategy.toUpperCase()}\nCourts requested: ${input.courtCount}\nCourts per checkout: up to 2\nDate: ${input.date}\nStart: ${input.start}\nDuration: ${input.duration} hour(s)\nNo price ceiling; the exact response amount is validated.\nCourt priority: ${input.priority.join(' -> ')}\nPlayers/Browsers: ${workers.join(' + ')} configured\nTerms authorization: YES\n\n${proofless?'PROOFLESS TEST: You must manually confirm these exact courts and hours are currently open. No availability proof is requested and no automatic availability substitution will occur.\n\n':''}${count} dedicated API Chrome window${count===1?'':'s'} remain visible throughout the run. If Cloudflare requests human verification, use the matching THIRSTY BOT window. Payment will NOT be automated.`,confirmLabel:proofless?'I Confirm Open · Run Proofless Test':'Run API Test to QR'});},
  runner: createRunner(root, node), activityJournal:new ActivityJournal(root), lock: () => readLock(root), retainedHold:()=>readRetainedHold(root), recentQrHandoffs:expiresAt=>readLatestQrHandoffs(root,expiresAt), previousHolds:()=>readPreviousHolds(root), cdp: probeCdp, clock: readClock,syncClock:async()=>{await synchronizeNetworkClock();},
  reviewLock:owned=>reviewLock(root,owned,browserProbe(root,node),undefined,browserProbe(root,node,'B')),
  clearLock:(fingerprint,owned)=>clearVerifiedLock(root,fingerprint,owned,browserProbe(root,node),undefined,browserProbe(root,node,'B')),
  resetPractice:()=>resetPracticeSession(root,()=>reviewLock(root,false,browserProbe(root,node)),browserProbe(root,node),probeCdp),
  confirmReset:async()=>confirmModal({tone:'question',title:'Reset practice session?',message:'RESET PRACTICE SESSION?',detail:'This closes and reopens only the dedicated Thirsty Bot Chrome, then clears local practice state. Review Booking and Payment Summary page state may be discarded. It will not cancel an Onda payment hold; a detected QR hold, selected slot, or active worker blocks the reset.',confirmLabel:'Reset Practice'}),
  confirmClear:async()=>confirmModal({tone:'question',title:'Clear verified stale lock?',message:'CLEAR VERIFIED STALE LOCK?',detail:'PID is no longer running.\nOnda schedule page is clean.\nSelected slots: 0.\nNo checkout hold detected.\nSafety checks will run again before removal.',confirmLabel:'Clear Lock'}),
  confirmPractice:async input=>confirmModal({tone:'question',title:'Run Full Flow Practice to QR?',message:'RUN FULL FLOW PRACTICE TO QR?',detail:`Date: ${input.target.date}\nCourt: ${input.target.court}\nStart: ${input.target.start}\nDuration: ${input.target.duration} hours\nNo price ceiling\nPlayer information: Configured\nTerms authorization: YES\n\nThis continues until Onda displays the QR payment page. Payment itself will NOT be performed.`,confirmLabel:'Run Practice'}),
  dualEvidence:async()=>{const {readDualEvidence,dualValidationFingerprint}=await import('../src/dual-runtime.js');const e=await readDualEvidence(dualValidationFingerprint(loadConfig()));return {selection:!!(e.readiness&&e.dry&&e.selection),full:!!(e.readiness&&e.dry&&e.selection&&e.full)};},
  confirmDualPractice:async command=>confirmModal({tone:'warning',title:'Create TWO real temporary holds?',message:'THIS TEST CAN CREATE TWO REAL TEMPORARY RESERVATION HOLDS.',detail:command.kind==='dualDry'?'':`Date: ${command.input.target.date}\nCourts: ${command.input.target.court} + ${command.input.courtB}\nStart: ${command.input.target.start}\nDuration: ${command.input.target.duration} hours\nNo price ceiling\nTerms authorized: YES\nNoncompetitive target: confirmed\nPAYMENT WILL NOT BE AUTOMATED.`,confirmLabel:'Create two test holds'}),
  booking:readBooking, saveBooking, handoff:()=>readHandoff(root),browserHealth:async()=>{const h=await probeBrowserHealth();return {A:!!h.A,B:!!h.B,C:!!h.C,D:!!h.D,E:!!h.E,F:!!h.F,G:!!h.G,H:!!h.H};},playerStatus:loadPlayerProfiles,
  startSleepProtection:()=>powerSaveBlocker.start('prevent-app-suspension'),stopSleepProtection:id=>{if(powerSaveBlocker.isStarted(id))powerSaveBlocker.stop(id);},
  countBotBrowsers:()=>countBotBrowsers(root),closeBotBrowsers:()=>closeBotBrowsers(root),
  confirmCloseBrowsers:async({open,qrPages,lock})=>confirmModal({tone:qrPages||lock?'warning':'question',title:'Close all bot browsers?',
    message:`Close ${open} Chrome browser${open===1?'':'s'} started by the bot?`,
    detail:`Only Chrome windows using the bot's own profiles are closed. Your normal Chrome is not touched.${qrPages?`\n\n${qrPages} QR payment page${qrPages===1?' is':'s are'} still open. Closing does NOT cancel ${qrPages===1?'that hold':'those holds'} on Onda, but you would lose the open QR page${qrPages===1?'':'s'}. Pay first if you want ${qrPages===1?'it':'them'}.`:''}${lock?'\n\nA retained automation lock stays recorded; Reset & Prepare will inspect it before the next run.':''}\n\nThe browsers reopen with Reset & Prepare.`,
    confirmLabel:`Close ${open} browser${open===1?'':'s'}`}),
  startSlotWatch:(input,onUpdate,onObservation)=>{const clockPath=resolve(root,'.local/network-clock.json');
    const watch=new SlotWatch({...input,directory:resolve(root,'.local/slot-watch'),now:()=>networkNowMs(clockPath),clockOffset:()=>readNetworkClock(clockPath)?.offsetMs??input.clockOffsetMs,onUpdate,onObservation});
    return {id:watch.id,done:watch.done,stop:reason=>watch.stop(reason)};},
  slotWatchHistory:()=>readSlotWatchHistory(resolve(root,'.local/slot-watch')),
  // Same .local as the runner's evidence, so arbitration:analyze finds it; runs before the runner is spawned.
  ensureArbitrationManifest:({targetDate,releaseMs,clockOffsetMs})=>ensureExperimentManifest({localRoot:resolve(root,'.local'),
    release:{targetDate,releaseMs},createdBy:'DESKTOP_ARM',clockOffsetMs}),
  buildReleaseForensics:({runId,status})=>{const inputs=forensicInputsFor(root,runId);return inputs?forensicsDigest(buildReleaseForensics({...inputs,status})):undefined;},
  releaseForensicsHistory:()=>readReleaseForensicsHistory(resolve(root,'.local/release-forensics')),
  // Phase 4: derived, read-only analysis in this process. The release runner never imports these modules.
  rebuildReleaseIntelligence:()=>rebuildReleaseIntelligence(root),
  clearReleaseIntelligence:()=>clearReleaseIntelligence(root),
  intelligenceDigest:()=>{const loaded=readReleaseIntelligence(root);return {digest:intelligenceDigest(loaded),warmth:loaded?connectionWarmth(loaded.records):null};},
  confirmClearIntelligence:async()=>confirmModal({tone:'question',title:'Clear derived intelligence?',message:'Delete the derived release intelligence files?',
    detail:'Only .local/release-intelligence is removed. Slot Watch logs, booking journals, locks, run logs, verified hold records, release forensics and browser profiles are not touched. You can rebuild it at any time.',confirmLabel:'Clear derived intelligence'}),
  runNetworkReadiness:async()=>{const result=await runNetworkReadiness({history:readNetworkReadinessHistory(root)});saveNetworkReadiness(root,result);return result;},
  networkReadinessHistory:()=>readNetworkReadinessHistory(root),
  replayPlan:plan=>replayAll(root,plan,readReleaseIntelligence(root)?.records??[]),
  adviseFromHistory:input=>adviseFromHistory(input,readReleaseIntelligence(root)?.records??[]),
  confirm: async (kind='observe',plan) => confirmModal({tone:'question', title: kind==='full'?'Arm Full Booking to QR?':kind==='selection'?'Arm booking selection?':kind==='dry'?'Arm Dry Race?':'Arm release observation?',
    message: kind==='full'?'ARM FULL BOOKING?':kind==='selection'?'ARM BOOKING SELECTION?':kind==='dry'?'ARM DRY RACE?':'Arm release observation?',
    detail: (plan ? describePlan(plan)+'\n\n' : '') + (kind==='full'?'Terms authorization: YES, for this booking only.\nFinal automation boundary: QR Checkout.\nThe bot will continue through Onda until the QR payment page is reached, then stop. Payment itself remains manual.':kind==='selection'?'At release this automation MAY SELECT available court slots.\nSelection Only stops before Proceed. Selection is not a reservation.':'This waits for release and performs read-only refresh/date navigation. No court slots will be selected.'),
    confirmLabel: kind==='full'?'Arm Full Booking':kind==='selection'?'Arm Selection':kind==='dry'?'Arm Dry Race':'Arm observation' }),
  publish: status => { if (window && !window.isDestroyed()) window.webContents.send('thirsty:status', status); },
});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  // Do not top-level await readiness: Electron waits for its ESM entry evaluation.
  void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({ width: 1060, height: 800, minWidth: 560, minHeight: 600, title: 'Thirsty Pickle Bot · Onda Booking Control', backgroundColor: '#07140f', icon:resolve(root,'assets/brand/thirsty-pickle-bot.png'),
    autoHideMenuBar: true, show: false,
    webPreferences: { preload: resolve(root, 'dist/ui/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false } });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  const actions = {
    reviewLock:()=>controller.reviewLock(),clearLock:()=>controller.clearLock(),resetPractice:()=>controller.resetPractice(),
    startChrome: () => controller.startChrome(), inspectOnda: () => controller.inspectOnda(), prepare: () => controller.prepare(), prepareDual:()=>controller.prepareDual(),
    armObservation: () => controller.armObservation(), abortAutomation: () => controller.abortAutomation(), getStatus: () => structuredClone(controller.state),
    armSelection: () => controller.armSelection(), dryRace: () => controller.dryRace(),
    armFullBooking:()=>controller.armFullBooking(),cancelScheduledRelease:()=>controller.cancelScheduledRelease(),invalidatePreparation:()=>controller.invalidatePreparation(),syncClock:()=>controller.syncClock(),
    closeBotBrowsers:()=>controller.closeBotBrowsers(),watchNextRelease:()=>controller.watchNextRelease(),stopSlotWatch:()=>controller.stopSlotWatch(),
    rebuildIntelligence:()=>controller.rebuildIntelligence(),clearIntelligence:()=>controller.clearIntelligence(),runNetworkCheck:()=>controller.runNetworkCheck(),
  };
  for (const [name, action] of Object.entries(actions)) ipcMain.handle(`thirsty:${name}`, (event, ...args: unknown[]) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== indexUrl || args.length) throw new Error('IPC_NOT_ALLOWED');
    return action();
  });
  for (const [name,action] of Object.entries({checkReleaseBlocks:(input:unknown)=>controller.checkReleaseBlocks(input),apiPreview:(input:unknown)=>controller.apiPreview(input),resetPrepare:(input:unknown)=>controller.resetPrepare(input),testBooking:(input:unknown)=>controller.testBooking(input),setWorkflow:(input:unknown)=>controller.setWorkflow(input),runDualPractice:(input:unknown)=>controller.runDualPractice(input),runFullPractice:(input:unknown)=>controller.runFullPractice(input),saveBooking:(input:unknown)=>controller.saveBooking(input),runPractice:(input:unknown)=>controller.runPractice(input),setMode:(input:unknown)=>controller.setMode(input),authorizeTerms:(input:unknown)=>controller.authorizeTerms(input),replayPlan:(input:unknown)=>controller.replayPlan(input),adviseFromHistory:(input:unknown)=>controller.adviseFromHistory(input)})) ipcMain.handle(`thirsty:${name}`,(event,...args:unknown[])=>{
    if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==indexUrl||args.length!==1)throw new Error('IPC_NOT_ALLOWED');
    return action(args[0]);
  });
  ipcMain.handle('thirsty:focusBrowser',async(event,...args:unknown[])=>{
    if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==indexUrl||args.length!==1)throw Error('IPC_NOT_ALLOWED');
    const request=args[0] as {workerId?:unknown;bookingId?:unknown};
    if(!request||typeof request!=='object'||!WORKER_IDS.includes(request.workerId as never)||!(request.bookingId===undefined||typeof request.bookingId==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(request.bookingId)))throw Error('IPC_NOT_ALLOWED');
    return focusDedicatedBrowser({workerId:request.workerId as import('../src/workers.js').WorkerId,...(typeof request.bookingId==='string'?{bookingId:request.bookingId}:{})});
  });
  ipcMain.handle('thirsty:confirmResponse',(event,...args:unknown[])=>{
    if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==indexUrl||args.length!==1)throw Error('IPC_NOT_ALLOWED');
    const response=args[0] as {id?:unknown;confirmed?:unknown};
    if(!response||typeof response!=='object'||typeof response.id!=='string'||typeof response.confirmed!=='boolean')throw Error('IPC_NOT_ALLOWED');
    const settle=pendingConfirms.get(response.id);
    if(!settle)return;
    pendingConfirms.delete(response.id);
    settle(response.confirmed);
  });
  window.once('ready-to-show', () => window.show());
  const poll = setInterval(() => { void controller.refresh(); }, 2000);
  app.on('before-quit', event => {
    if (exiting) return;
    event.preventDefault();
    void controller.abortAutomation().then(async () => {
      if (controller.state.operation === 'stopping') return;
      // Writes the slot watch summary and report before the process ends.
      await controller.stopSlotWatch('app closed');
      exiting = true; clearInterval(poll); app.quit();
    });
  });
  // Stop before destroying the window; the user must see if stop cannot be confirmed.
  window.on('close', event => { if (!exiting) { event.preventDefault(); app.quit(); } });
  window.on('closed', () => { for (const settle of pendingConfirms.values()) settle(false); pendingConfirms.clear(); });
  window.webContents.on('render-process-gone', () => { void controller.abortAutomation(); });
  await window.loadFile(index);
  await controller.refresh();
  });
}
