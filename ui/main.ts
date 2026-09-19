import { describeBookingPlan } from '../src/booking-plan.js';
import { loadConfig,loadPlayerReadiness } from '../src/config.js';
import {reviewLock,clearVerifiedLock,browserProbe} from './locks.js';
import { app, BrowserWindow, ipcMain, dialog, session, powerSaveBlocker } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Controller } from './controller.js';
import { createRunner } from './processes.js';
import { readLock, readHandoff, probeCdp, probeBrowserHealth, readClock } from './status.js';
import { readBooking, saveBooking, describePlan } from './booking.js';
import { resetPracticeSession } from './practice-reset.js';

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
const controller = new Controller({
  confirmStopPrepare:async()=>(await dialog.showMessageBox(window,{type:'question',title:'Reset & Prepare',message:'An automation is currently running.',detail:'Stop it and prepare a new session?',buttons:['Cancel','Stop and prepare'],defaultId:0,cancelId:0})).response===1,
  confirmBooking:async(plan,maximum)=>(await dialog.showMessageBox(window,{type:'question',title:`${plan.strategy.toUpperCase()} TEST TO QR`,message:'Create temporary payment holds?',detail:describeBookingPlan(plan,maximum)+'\nIf availability changes before Proceed, the planner may retry other courts or valid splits within this requested time range and court count. Exact courts, when specified, are never substituted.\nTerms authorized for this test. Payment will NOT be automated.',buttons:['Cancel','Run Test to QR'],defaultId:0,cancelId:0})).response===1,
  confirmApiTest:async input=>(await dialog.showMessageBox(window,{type:'warning',title:'API-FIRST TEST TO QR',message:`Create ${input.strategy==='extended'?'two':'one'} temporary API reservation hold${input.strategy==='extended'?'s':''}?`,detail:`Type: ${input.strategy.toUpperCase()}\nDate: ${input.date}\nStart: ${input.start}\nDuration: ${input.duration} hour(s)\nMaximum per checkout: PHP ${input.maximum}\nCourt priority: ${input.priority.join(' -> ')}\nPlayers: ${input.strategy==='extended'?'Primary + Extended':'Primary'} configured\nTerms authorization: YES\n\n${input.strategy==='extended'?'Two dedicated API Chrome windows':'The dedicated API Chrome window'} remain${input.strategy==='extended'?'':'s'} visible throughout the run. If Cloudflare requests human verification, use the tab titled THIRSTY BOT A or B - VERIFY HERE. Payment will NOT be automated.`,buttons:['Cancel','Run API Test to QR'],defaultId:0,cancelId:0,noLink:true})).response===1,
  runner: createRunner(root, node), lock: () => readLock(root), cdp: probeCdp, clock: readClock,
  reviewLock:owned=>reviewLock(root,owned,browserProbe(root,node),undefined,browserProbe(root,node,'B')),
  clearLock:(fingerprint,owned)=>clearVerifiedLock(root,fingerprint,owned,browserProbe(root,node),undefined,browserProbe(root,node,'B')),
  resetPractice:()=>resetPracticeSession(root,()=>reviewLock(root,false,browserProbe(root,node)),browserProbe(root,node),probeCdp),
  confirmReset:async()=> (await dialog.showMessageBox(window,{type:'question',title:'Reset practice session?',message:'RESET PRACTICE SESSION?',detail:'This closes and reopens only the dedicated Thirsty Bot Chrome, then clears local practice state. Review Booking and Payment Summary page state may be discarded. It will not cancel an Onda payment hold; a detected QR hold, selected slot, or active worker blocks the reset.',buttons:['Cancel','Reset Practice'],defaultId:0,cancelId:0})).response===1,
  confirmClear:async()=> (await dialog.showMessageBox(window,{type:'question',title:'Clear verified stale lock?',message:'CLEAR VERIFIED STALE LOCK?',detail:'PID is no longer running.\nOnda schedule page is clean.\nSelected slots: 0.\nNo checkout hold detected.\nSafety checks will run again before removal.',buttons:['Cancel','Clear Lock'],defaultId:0,cancelId:0})).response===1,
  confirmPractice:async input=>(await dialog.showMessageBox(window,{type:'question',title:'Run Full Flow Practice to QR?',message:'RUN FULL FLOW PRACTICE TO QR?',detail:`Date: ${input.target.date}\nCourt: ${input.target.court}\nStart: ${input.target.start}\nDuration: ${input.target.duration} hours\nMaximum: PHP ${input.maximum}\nPlayer information: Configured\nTerms authorization: YES\n\nThis continues until Onda displays the QR payment page. Payment itself will NOT be performed.`,buttons:['Cancel','Run Practice'],defaultId:0,cancelId:0})).response===1,
  dualEvidence:async()=>{const {readDualEvidence,dualValidationFingerprint}=await import('../src/dual-runtime.js');const e=await readDualEvidence(dualValidationFingerprint(loadConfig()));return {selection:!!(e.readiness&&e.dry&&e.selection),full:!!(e.readiness&&e.dry&&e.selection&&e.full)};},
  confirmDualPractice:async command=>(await dialog.showMessageBox(window,{type:'warning',title:'Create TWO real temporary holds?',message:'THIS TEST CAN CREATE TWO REAL TEMPORARY RESERVATION HOLDS.',detail:command.kind==='dualDry'?'':`Date: ${command.input.target.date}\nCourts: ${command.input.target.court} + ${command.input.courtB}\nStart: ${command.input.target.start}\nDuration: ${command.input.target.duration} hours\nMaximum per court: PHP ${command.input.maximum}\nTerms authorized: YES\nNoncompetitive target: confirmed\nPAYMENT WILL NOT BE AUTOMATED.`,buttons:['Cancel','Create two test holds'],defaultId:0,cancelId:0})).response===1,
  booking:readBooking, saveBooking, handoff:()=>readHandoff(root),browserHealth:probeBrowserHealth,playerStatus:loadPlayerReadiness,
  startSleepProtection:()=>powerSaveBlocker.start('prevent-app-suspension'),stopSleepProtection:id=>{if(powerSaveBlocker.isStarted(id))powerSaveBlocker.stop(id);},
  confirm: async (kind='observe',plan) => (await dialog.showMessageBox(window, { type: 'question', title: kind==='full'?'Arm Full Booking to QR?':kind==='selection'?'Arm booking selection?':kind==='dry'?'Arm Dry Race?':'Arm release observation?',
    message: kind==='full'?'ARM FULL BOOKING?':kind==='selection'?'ARM BOOKING SELECTION?':kind==='dry'?'ARM DRY RACE?':'Arm release observation?',
    detail: (plan ? describePlan(plan)+'\n\n' : '') + (kind==='full'?'Terms authorization: YES, for this booking only.\nFinal automation boundary: QR Checkout.\nThe bot will continue through Onda until the QR payment page is reached, then stop. Payment itself remains manual.':kind==='selection'?'At release this automation MAY SELECT available court slots.\nSelection Only stops before Proceed. Selection is not a reservation.':'This waits for release and performs read-only refresh/date navigation. No court slots will be selected.'),
    buttons: ['Cancel', kind==='full'?'Arm Full Booking':kind==='selection'?'Arm Selection':kind==='dry'?'Arm Dry Race':'Arm observation'], defaultId: 0, cancelId: 0, noLink: true })).response === 1,
  publish: status => { if (window && !window.isDestroyed()) window.webContents.send('thirsty:status', status); },
});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  // Do not top-level await readiness: Electron waits for its ESM entry evaluation.
  void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({ width: 1010, height: 800, minWidth: 820, minHeight: 690, title: 'Thirsty Pickle Bot · Onda Booking Control', backgroundColor: '#07140f', icon:resolve(root,'assets/brand/thirsty-pickle-bot.png'),
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
    armFullBooking:()=>controller.armFullBooking(),cancelScheduledRelease:()=>controller.cancelScheduledRelease(),invalidatePreparation:()=>controller.invalidatePreparation(),
  };
  for (const [name, action] of Object.entries(actions)) ipcMain.handle(`thirsty:${name}`, (event, ...args: unknown[]) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== indexUrl || args.length) throw new Error('IPC_NOT_ALLOWED');
    return action();
  });
  for (const [name,action] of Object.entries({apiPreview:(input:unknown)=>controller.apiPreview(input),resetPrepare:(input:unknown)=>controller.resetPrepare(input),testBooking:(input:unknown)=>controller.testBooking(input),setWorkflow:(input:unknown)=>controller.setWorkflow(input),runDualPractice:(input:unknown)=>controller.runDualPractice(input),runFullPractice:(input:unknown)=>controller.runFullPractice(input),saveBooking:(input:unknown)=>controller.saveBooking(input),runPractice:(input:unknown)=>controller.runPractice(input),setMode:(input:unknown)=>controller.setMode(input),authorizeTerms:(input:unknown)=>controller.authorizeTerms(input)})) ipcMain.handle(`thirsty:${name}`,(event,...args:unknown[])=>{
    if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==indexUrl||args.length!==1)throw new Error('IPC_NOT_ALLOWED');
    return action(args[0]);
  });
  window.once('ready-to-show', () => window.show());
  const poll = setInterval(() => { void controller.refresh(); }, 2000);
  app.on('before-quit', event => {
    if (exiting) return;
    event.preventDefault();
    void controller.abortAutomation().then(() => {
      if (controller.state.operation === 'stopping') return;
      exiting = true; clearInterval(poll); app.quit();
    });
  });
  // Stop before destroying the window; the user must see if stop cannot be confirmed.
  window.on('close', event => { if (!exiting) { event.preventDefault(); app.quit(); } });
  window.webContents.on('render-process-gone', () => { void controller.abortAutomation(); });
  await window.loadFile(index);
  await controller.refresh();
  });
}
