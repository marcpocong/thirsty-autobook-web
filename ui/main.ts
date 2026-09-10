import { app, BrowserWindow, ipcMain, dialog, session } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Controller } from './controller.js';
import { createRunner } from './processes.js';
import { readLock, readHandoff, probeCdp, readClock } from './status.js';
import { readBooking, saveBooking, describePlan } from './booking.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(root);
app.setPath('userData', resolve(root, '.local/control-panel'));
const node = process.env.THIRSTY_NODE_EXEC;
if (!node) throw new Error('Launch the panel with npm run ui.');
const index = resolve(root, 'dist/ui/renderer/index.html');
const indexUrl = pathToFileURL(index).href;
let window: BrowserWindow;
let exiting = false;
const controller = new Controller({ runner: createRunner(root, node), lock: () => readLock(root), cdp: probeCdp, clock: readClock,
  booking:readBooking, saveBooking, handoff:()=>readHandoff(root),
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
  window = new BrowserWindow({ width: 1010, height: 800, minWidth: 820, minHeight: 690, title: 'Thirsty Bot · Onda Booking Control', backgroundColor: '#101419',
    autoHideMenuBar: true, show: false,
    webPreferences: { preload: resolve(root, 'dist/ui/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false } });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  const actions = {
    startChrome: () => controller.startChrome(), inspectOnda: () => controller.inspectOnda(), prepare: () => controller.prepare(),
    armObservation: () => controller.armObservation(), abortAutomation: () => controller.abortAutomation(), getStatus: () => structuredClone(controller.state),
    armSelection: () => controller.armSelection(), dryRace: () => controller.dryRace(),
    armFullBooking:()=>controller.armFullBooking(),
  };
  for (const [name, action] of Object.entries(actions)) ipcMain.handle(`thirsty:${name}`, (event, ...args: unknown[]) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== indexUrl || args.length) throw new Error('IPC_NOT_ALLOWED');
    return action();
  });
  for (const [name,action] of Object.entries({saveBooking:(input:unknown)=>controller.saveBooking(input),runPractice:(input:unknown)=>controller.runPractice(input),setMode:(input:unknown)=>controller.setMode(input),authorizeTerms:(input:unknown)=>controller.authorizeTerms(input)})) ipcMain.handle(`thirsty:${name}`,(event,...args:unknown[])=>{
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
