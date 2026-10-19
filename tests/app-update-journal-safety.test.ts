import { mkdtemp,mkdir,writeFile,readFile,readdir,rm,utimes,chmod } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe,it,expect,afterEach,vi } from 'vitest';
import { DateTime } from 'luxon';
// @ts-expect-error plain ESM build helper
import { distContentId } from '../scripts/build-support.mjs';
// @ts-expect-error plain ESM installation helper
import { detectInstallation,inspectUpdateSafety,assertSafeUpdate,describeUpdateSafety,protectedStateManifest,assertProtectedStateUnchanged,applyUpdate,managedFiles,hashFile,HISTORICAL_QUIET_MS } from '../scripts/app-installation.mjs';
import { DurableSubmissionJournal,type SanitizedSubmissionAttempt } from '../src/api-booking/durable-submission-journal.js';
import { Controller } from '../ui/controller.js';
import { clockStatus,readLock,readRetainedHold,readPreviousHolds } from '../ui/status.js';
import { bookingView,defaultSetup } from '../ui/booking.js';
import { ConfigSchema,ObservationSchema } from '../src/config.js';
import { readBuildInfo } from '../src/build-info.js';
import type { Runner } from '../ui/processes.js';

const fixtures:string[]=[];
afterEach(async()=>{for(const p of fixtures.splice(0)){await chmod(p,0o777).catch(()=>undefined);await rm(p,{recursive:true,force:true});}});
const DAY=24*60*60*1000,NOW=Date.parse('2026-10-14T12:00:00.000Z'),OLD=new Date(NOW-20*DAY);
async function fixture(){const root=await mkdtemp(join(tmpdir(),'pickle-journal-'));fixtures.push(root);return root;}
async function put(root:string,path:string,value:string){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),value);}
const hex=(n:number)=>n.toString(16).padStart(64,'0');
const journalDir=(root:string,key:string)=>join(root,'.local/api-booking/api-first-journals',key);
function attempt(key:string,stage:'armed'|'dispatching',at:Date):SanitizedSubmissionAttempt{
  return {attemptId:key,planFingerprint:key,targetDate:'2026-10-01',courtIds:[7],hourlyBoundaries:[{startTime:'21:00',endTime:'22:00'}],expectedBookingCount:1,maximumAmount:600,stage,
    ...(stage==='armed'?{releaseMs:at.getTime()+120000,dispatchDeadlineMs:at.getTime()+121000}:{})};
}
/** A real write-once journal record that ended UNKNOWN (e.g. HTTP 400 that never proved rejection), last written at `at`. */
async function unknownRecord(root:string,n:number,{stage='armed',at=OLD,holdExpiresAt}:{stage?:'armed'|'dispatching';at?:Date;holdExpiresAt?:string}={}){
  const key=hex(n),journal=new DurableSubmissionJournal(journalDir(root,key));
  if(stage==='armed')await journal.arm(key,at,attempt(key,stage,at));else await journal.begin(key,at,attempt(key,stage,at));
  await journal.mark(key,'unknown',at,{status:400,category:'http-rejection',contentKind:'json',responseSource:'application',errorHint:'other'},
    holdExpiresAt?{success:true,bookingIds:['b1'],bookingNumbers:['n1'],bookingSessionIds:['s1'],holdExpiresAt:[holdExpiresAt],validationCode:'CHECKOUT_BOOKING_INVALID'}:undefined,'ONDA_HTTP_STATUS_INVALID');
  await put(journalDir(root,key),'supervised-one-shot.json',JSON.stringify({claimedAt:at.toISOString(),mode:'armed'}));
  for(const f of [`${key}.json`,'supervised-one-shot.json'])await utimes(join(journalDir(root,key),f),at,at);
  return {key,journal,path:join(journalDir(root,key),`${key}.json`)};
}
async function recognized(){const root=await fixture();await mkdir(join(root,'Source'));await mkdir(join(root,'.local/private'),{recursive:true});
  const info={gitSha:'a'.repeat(40),buildId:'aaaaaaa-old',contentId:''};
  for(const file of ['Thirsty Pickle Bot.exe','.local/runtime/node.exe','scripts/run-thirsty-pickle-bot.mjs','node_modules/electron/dist/electron.exe'])await put(root,file,'old');
  await put(root,'dist/ui/main.js','old');info.contentId=await distContentId(join(root,'dist'));await put(root,'dist/build-info.json',JSON.stringify(info));
  await put(root,'config.local.json','{ "BOOKING_METHOD": "proofless", "MAX_PRICE": 0 }\r\n');
  await put(root,'BUILD-INFO.txt',`Thirsty Pickle Bot self-contained installation\nSource Commit: ${info.gitSha}\nBuild ID: ${info.buildId}\nLauncher SHA256: ${await hashFile(join(root,'Thirsty Pickle Bot.exe'))}`);return root;}
/** Recognized installation with 3 historical UNKNOWN records, an expired archived hold, rejected/expired outcomes and a consistent new stage. */
async function installationWithHistory(){
  const root=await recognized(),stage=join(root,'.local/build/staging');
  for(const name of managedFiles)if(!['dist','scripts','node_modules','Thirsty Pickle Bot.exe','BUILD-INFO.txt','.local/runtime/node.exe'].includes(name))await put(root,['src','ui','assets/brand'].includes(name)?name+'/file':name,'previous');
  const records=[await unknownRecord(root,1),await unknownRecord(root,2),await unknownRecord(root,3,{stage:'dispatching',holdExpiresAt:new Date(OLD.getTime()+600000).toISOString()})];
  await put(root,'.local/automation.lock',JSON.stringify({pid:26284,runID:'r',mode:'standard',workers:['B'],stage:'HOLD_VERIFIED',stageAt:OLD.toISOString(),holdExpiresAt:new Date(OLD.getTime()+600000).toISOString()}));
  await put(root,'.local/retained-holds/old.json',JSON.stringify({archivedAt:OLD.toISOString(),lock:{pid:24460,stage:'HOLD_VERIFIED',stageAt:OLD.toISOString(),holdExpiresAt:new Date(OLD.getTime()+600000).toISOString()},workers:[]}));
  await mkdir(join(root,'.local/api-booking/api-first-journals/recycle-locks'),{recursive:true});
  await put(root,'.local/api-booking/run.ndjson','{"event":"historical"}\n');
  // New package: provenance-consistent dist, launcher and BUILD-INFO.
  const info={gitSha:'b'.repeat(40),buildId:'bbbbbbb-new',contentId:''};
  await put(stage,'dist/ui/main.js','new');info.contentId=await distContentId(join(stage,'dist'));await put(stage,'dist/build-info.json',JSON.stringify({schema:'thirsty-build-info/v1',kind:'installation',gitSha:info.gitSha,branch:'main',dirty:false,builtAt:new Date(NOW).toISOString(),packageVersion:'0.1.0',node:'v24.15.0',contentId:info.contentId,buildId:info.buildId}));
  for(const name of managedFiles)if(name!=='dist'&&name!=='BUILD-INFO.txt')await put(stage,['src','ui','scripts','node_modules','assets/brand'].includes(name)?name+'/file':name,'new');
  await put(stage,'scripts/run-thirsty-pickle-bot.mjs','new');await put(stage,'node_modules/electron/dist/electron.exe','new');
  await put(stage,'BUILD-INFO.txt',`Thirsty Pickle Bot self-contained installation\nSource Commit: ${info.gitSha}\nBuild ID: ${info.buildId}\nLauncher SHA256: ${await hashFile(join(stage,'Thirsty Pickle Bot.exe'))}`);
  return {root,stage,records,info};
}
const launchers=async(dir:string):Promise<string[]>=>(await readdir(dir,{recursive:true})).map(String).filter(f=>/(^|[\\/])thirsty pickle bot\.exe$/i.test(f));

describe('installation safety is separate from booking submission safety',()=>{
  it('reports historical UNKNOWN journals separately and permits a code-only update with zero active blockers',async()=>{
    const {root}=await installationWithHistory();
    const report=await inspectUpdateSafety(root,{processes:[],now:NOW});
    expect(report.blockers).toEqual([]);expect(report.eligibility).toBe('READY');
    expect(report.historicalUnknown.map((h:{key:string})=>h.key).sort()).toEqual([hex(1),hex(2),hex(3)]);
    expect(report.historicalUnknown.find((h:{key:string})=>h.key===hex(3))).toMatchObject({stage:'dispatching',recordedHoldExpired:true,httpStatus:400,failureCode:'ONDA_HTTP_STATUS_INVALID'});
    expect(describeUpdateSafety(report)).toEqual(['Historical UNKNOWN journals: 3 — preserved; affected booking targets remain blocked.','Active lifecycle blockers: 0','Installation eligibility: READY']);
    await expect(assertSafeUpdate(root,{processes:[],now:NOW})).resolves.toMatchObject({eligibility:'READY'});
  });
  it('never treats a recent, future-dated, malformed or still-dispatchable UNKNOWN record as historical',async()=>{
    const root=await recognized();
    await unknownRecord(root,1,{at:new Date(NOW-HISTORICAL_QUIET_MS+60000)});
    await unknownRecord(root,2,{at:new Date(NOW+10*60000)});
    const open=await unknownRecord(root,3);const v=JSON.parse(await readFile(open.path,'utf8'));v.attempt.dispatchDeadlineMs=NOW+DAY;await writeFile(open.path,JSON.stringify(v));await utimes(open.path,OLD,OLD);
    await put(root,'.local/api-booking/api-first-journals/x/record.json',JSON.stringify({attempt:{},state:'unknown'}));
    const report=await inspectUpdateSafety(root,{processes:[],now:NOW});
    expect(report.historicalUnknown).toEqual([]);expect(report.eligibility).toBe('REFUSED');
    expect(report.blockers.map((b:{reason:string})=>b.reason).sort()).toEqual(['UNKNOWN_RECORD_DISPATCH_WINDOW_OPEN','UNKNOWN_RECORD_FUTURE_DATED','UNKNOWN_RECORD_RECENT','UNKNOWN_RECORD_UNRECOGNIZED']);
    await expect(assertSafeUpdate(root,{processes:[],now:NOW})).rejects.toThrow('APP_UPDATE_UNRESOLVED_JOURNAL');
  });
  it('refuses journal-shaped records with missing or malformed state or attempt without modifying them',async()=>{
    const malformed=[{attempt:{}},{attempt:{},state:''},{attempt:{},state:null},{attempt:{},state:'future-state'},
      {state:'unknown'},{attempt:null,state:'unknown'},{attempt:[],state:'rejected'},
      {attempt:{executionMode:'OFFLINE_INTERCEPTED'},state:''}];
    for(const record of malformed){
      const root=await recognized(),path='.local/api-booking/api-first-journals/corrupt.json',bytes=JSON.stringify(record);
      await put(root,path,bytes);
      const report=await inspectUpdateSafety(root,{processes:[],now:NOW});
      expect(report).toMatchObject({eligibility:'REFUSED',historicalUnknown:[],blockers:[{code:'APP_UPDATE_STATE_UNRECOGNIZED',reason:'JOURNAL_SHAPE'}]});
      expect(await readFile(join(root,path),'utf8')).toBe(bytes);
    }
  });
  it('recognizes corrupt reserved journal filenames without treating unrelated metadata as a journal',async()=>{
    const key=hex(19),roots=[`api-first-journals/${key}`,`api-first-journals/${key}/fan-out/${hex(20)}/${hex(21)}`,
      `api-first-journals/rejected-attempts/${key}-archived`,'submission-journal','submission-journal-session-20260919-second'];
    for(const directory of roots)for(const record of [null,[],{}, {key}]){
      const root=await fixture(),path=`.local/api-booking/${directory}/${key}.json`,bytes=JSON.stringify(record);
      await put(root,path,bytes);
      const report=await inspectUpdateSafety(root,{processes:[],now:NOW});
      expect(report).toMatchObject({eligibility:'REFUSED',historicalUnknown:[],blockers:[{code:'APP_UPDATE_STATE_UNRECOGNIZED',reason:'JOURNAL_SHAPE',path}]});
      await expect(assertSafeUpdate(root,{processes:[],now:NOW})).rejects.toThrow('APP_UPDATE_STATE_UNRECOGNIZED');
      expect(await readFile(join(root,path),'utf8')).toBe(bytes);
    }
    const root=await fixture();
    await put(root,'.local/api-booking/api-first-journals/supervised-one-shot.json','null');
    await put(root,`.local/api-booking/precision-races/${key}.json`,'[]');
    await put(root,`.local/dual/${key}.json`,'{}');
    expect(await inspectUpdateSafety(root,{processes:[],now:NOW})).toMatchObject({eligibility:'READY',blockers:[]});
  });
  it('an active dispatch (armed or dispatching record, or an arming in progress) still blocks installation',async()=>{
    for(const variant of ['armed','dispatching','arming']){
      const root=await recognized(),key=hex(9),journal=new DurableSubmissionJournal(journalDir(root,key));
      if(variant==='armed')await journal.arm(key,OLD,attempt(key,'armed',OLD));
      else if(variant==='dispatching')await journal.begin(key,OLD,attempt(key,'dispatching',OLD));
      else await put(journalDir(root,key),'.0f0f.arming','{"partial"');
      await expect(assertSafeUpdate(root,{processes:[],now:NOW})).rejects.toThrow('APP_UPDATE_ACTIVE_DISPATCH');
    }
  });
  it('active or uncertain lifecycle locks still block, including live owners and in-progress recycles',async()=>{
    const cases:[Record<string,unknown>,string][]=[[{stage:'FINAL_ACTION_ARMED',stageAt:OLD.toISOString()},'APP_UPDATE_UNRESOLVED_LIFECYCLE'],[{stage:'FINAL_ACTION_DISPATCHING',stageAt:OLD.toISOString()},'APP_UPDATE_UNRESOLVED_LIFECYCLE'],
      [{stage:'HOLD_VERIFIED',stageAt:OLD.toISOString(),holdExpiresAt:new Date(NOW+60000).toISOString()},'APP_UPDATE_UNRESOLVED_LIFECYCLE'],[{stage:'API_READY',stageAt:OLD.toISOString()},'APP_UPDATE_UNRESOLVED_LIFECYCLE']];
    for(const [lock,code] of cases){const root=await recognized();await put(root,'.local/automation.lock',JSON.stringify({pid:77,...lock}));
      await expect(assertSafeUpdate(root,{processes:[],now:NOW})).rejects.toThrow(code);expect(JSON.parse(await readFile(join(root,'.local/automation.lock'),'utf8'))).toMatchObject(lock);}
    const root=await recognized(),expired={pid:77,stage:'HOLD_VERIFIED',stageAt:OLD.toISOString(),holdExpiresAt:new Date(OLD.getTime()+600000).toISOString()};
    await put(root,'.local/automation.lock',JSON.stringify(expired));
    // Owner alive (started before the lock was written) or start time unknown: fail closed. A PID reused by a later process is not the owner.
    await expect(assertSafeUpdate(root,{processes:[{ProcessId:77,CreatedMs:OLD.getTime()-DAY}],now:NOW})).rejects.toThrow('APP_UPDATE_ACTIVE_PROCESS');
    await expect(assertSafeUpdate(root,{processes:[{ProcessId:77}],now:NOW})).rejects.toThrow('APP_UPDATE_ACTIVE_PROCESS');
    await expect(assertSafeUpdate(root,{processes:[{ProcessId:77,CreatedMs:NOW-60000,ExecutablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'}],now:NOW})).resolves.toMatchObject({eligibility:'READY'});
    await mkdir(join(root,'.local/api-booking/api-first-journals/recycle-locks',hex(4)),{recursive:true});
    await expect(assertSafeUpdate(root,{processes:[],now:NOW})).rejects.toThrow('APP_UPDATE_UNRESOLVED_LIFECYCLE');
    await put(root,'.local/dual/worker-a.lock','not json');
    expect((await inspectUpdateSafety(root,{processes:[],now:NOW})).blockers.map((b:{code:string})=>b.code)).toContain('APP_UPDATE_STATE_UNREADABLE');
  });
  it('an unresolved or still-active provider hold cannot be disturbed',async()=>{
    const root=await recognized(),key=hex(5),journal=new DurableSubmissionJournal(journalDir(root,key));
    await journal.begin(key,new Date(NOW-60000),attempt(key,'dispatching',new Date(NOW-60000)));
    await journal.mark(key,'verified',new Date(NOW-50000),undefined,{success:true,bookingIds:['b'],bookingNumbers:['n'],bookingSessionIds:['s'],holdExpiresAt:[new Date(NOW+540000).toISOString()],validationCode:'OK'});
    await expect(assertSafeUpdate(root,{processes:[],now:NOW})).rejects.toThrow('APP_UPDATE_ACTIVE_OR_UNKNOWN_HOLD');
    const other=await recognized();await unknownRecord(other,6,{holdExpiresAt:'2099-01-01T00:00:00.000Z'});
    await expect(assertSafeUpdate(other,{processes:[],now:NOW})).rejects.toThrow('APP_UPDATE_ACTIVE_OR_UNKNOWN_HOLD');
  });
});

describe('protected journals across a transactional update',()=>{
  it('installs the new runtime with all journals byte-for-byte identical, one EXE and the new SHA/build ID',async()=>{
    const {root,stage,records,info}=await installationWithHistory();
    const before=await protectedStateManifest(root),bytes=await Promise.all(records.map(r=>readFile(r.path)));
    expect(before.count).toBe(9);expect(before.files.every((f:{sha256:string;size:number})=>/^[a-f0-9]{64}$/.test(f.sha256)&&f.size>0)).toBe(true);
    await applyUpdate(root,stage,{validate:async()=>{await assertProtectedStateUnchanged(root,before);},beforeApply:async()=>{await assertSafeUpdate(root,{processes:[],now:NOW});}});
    expect((await assertProtectedStateUnchanged(root,before)).digest).toBe(before.digest);
    for(const [i,r] of records.entries())expect((await readFile(r.path)).equals(bytes[i]!)).toBe(true);
    // One user-facing EXE; rollback entries are numbered, never a second launcher.
    expect(await launchers(root)).toEqual(['Thirsty Pickle Bot.exe']);
    expect((await readdir(join(root,'.local/build/rollback'))).every(name=>/^\d+$/.test(name))).toBe(true);
    const installed=await detectInstallation(join(root,'Source'));
    expect(installed.info).toMatchObject({gitSha:info.gitSha,buildId:info.buildId});expect(readBuildInfo(join(root,'dist/build-info.json'))).toMatchObject({gitSha:info.gitSha,buildId:info.buildId,dirty:false});
  });
  it('fails validation and restores the old runtime when any protected byte changes during the update',async()=>{
    for(const tamper of ['modify','add','remove']){
      const {root,stage,records}=await installationWithHistory(),before=await protectedStateManifest(root);
      await expect(applyUpdate(root,stage,{validate:async()=>{await assertProtectedStateUnchanged(root,before);},afterMove:async(name:string)=>{
        if(name!=='scripts')return;const target=records[0]!.path;
        if(tamper==='modify')await writeFile(target,(await readFile(target,'utf8')).replace('"unknown"','"rejected"'));
        else if(tamper==='add')await put(root,'.local/retained-holds/new.json','{}');else await rm(join(root,'.local/api-booking/run.ndjson'));
      }})).rejects.toThrow('APP_UPDATE_PROTECTED_STATE_CHANGED');
      expect(await readFile(join(root,'Thirsty Pickle Bot.exe'),'utf8')).toBe('old');expect(await readFile(join(root,'dist/ui/main.js'),'utf8')).toBe('old');
      expect(JSON.parse(await readFile(join(root,'.local/build/update-transaction.json'),'utf8')).status).toBe('ROLLED_BACK');
      expect((await detectInstallation(join(root,'Source'))).info.buildId).toBe('aaaaaaa-old');
    }
  });
  it('keeps duplicate prevention operational after the update: UNKNOWN targets can never be re-armed, recycled, re-marked or retried',async()=>{
    const {root,stage,records}=await installationWithHistory();
    await applyUpdate(root,stage);
    for(const {key,journal,path} of records){
      const bytes=await readFile(path);
      await expect(journal.arm(key,new Date(NOW),attempt(key,'armed',new Date(NOW)))).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
      await expect(journal.begin(key,new Date(NOW),attempt(key,'dispatching',new Date(NOW)))).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
      expect(await journal.peekDisposition(key,new Date(NOW+365*DAY))).toBe('blocked');
      expect(await journal.recycleReusable(key,new Date(NOW+365*DAY))).toBe('blocked');
      await expect(journal.claimArmedOneShot(key,new Date(NOW))).rejects.toThrow('SUBMISSION_STATE_INVALID');
      await expect(journal.claimSupervisedOneShot(key,new Date(NOW))).rejects.toThrow('SUBMISSION_STATE_INVALID');
      await expect(journal.mark(key,'rejected',new Date(NOW))).rejects.toThrow('SUBMISSION_STATE_INVALID');
      expect((await readFile(path)).equals(bytes)).toBe(true);expect(JSON.parse(bytes.toString()).state).toBe('unknown');
    }
  });
});

describe('opening the updated application is read-only for historical bookings',()=>{
  it('constructing and refreshing the controller never runs, confirms, arms, clears or rewrites lifecycle state',async()=>{
    const {root}=await installationWithHistory(),before=await protectedStateManifest(root);
    const runSpy=vi.fn(()=>{throw Error('RUNNER_MUST_NOT_START');}),runner=runSpy as unknown as Runner,confirm=vi.fn(async()=>true),action=vi.fn(async()=>{throw Error('ACTION_MUST_NOT_RUN');});
    const plan={...bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'})),releaseMs:Date.now()+3600000};
    const controller=new Controller({runner,confirm,confirmBooking:confirm,confirmApiTest:confirm,confirmClear:confirm,confirmReset:confirm,confirmPractice:confirm,confirmDualPractice:confirm,
      clearLock:action,resetPractice:action,syncClock:action,closeBotBrowsers:action,startSlotWatch:vi.fn(()=>{throw Error('SLOT_WATCH_MUST_NOT_START');}),
      ensureArbitrationManifest:vi.fn(()=>{throw Error('MANIFEST_MUST_NOT_BE_CREATED');}),
      lock:()=>readLock(root),retainedHold:()=>readRetainedHold(root,NOW),previousHolds:()=>readPreviousHolds(root),cdp:async()=>false,
      clock:()=>({...clockStatus(ObservationSchema.parse({}),DateTime.fromMillis(Date.now())),releaseMs:plan.releaseMs,targetDate:plan.targetDate,wakeSecondsBefore:90}),
      booking:()=>plan,saveBooking:()=>plan,publish:()=>{}});
    for(let i=0;i<3;i++)await controller.refresh();
    expect(runSpy).not.toHaveBeenCalled();expect(confirm).not.toHaveBeenCalled();expect(action).not.toHaveBeenCalled();
    expect(controller.state.operation).toBe('idle');expect(controller.state.scheduledRelease).toBeNull();expect(controller.state.lock).toBe(true);
    expect((await assertProtectedStateUnchanged(root,before)).digest).toBe(before.digest);
  });
  it('the Electron startup sequence only refreshes; every booking action requires an explicit renderer IPC request',async()=>{
    const main=await readFile(resolve('ui/main.ts'),'utf8'),start=main.indexOf('void app.whenReady()');
    const startup=main.slice(start),handlers=startup.indexOf('const actions = {'),ipcEnd=startup.indexOf("window.once('ready-to-show'");
    expect(start).toBeGreaterThan(0);expect(handlers).toBeGreaterThan(0);expect(ipcEnd).toBeGreaterThan(handlers);
    // Outside the IPC handler table, the controller is only refreshed or stopped (on quit/renderer loss).
    const outside=startup.slice(0,handlers)+startup.slice(ipcEnd);
    expect([...new Set([...outside.matchAll(/controller\.(\w+)\(/g)].map(m=>m[1]))].sort()).toEqual(['abortAutomation','refresh','stopSlotWatch']);
    expect([...new Set([...outside.matchAll(/lab\.(\w+)\(/g)].map(m=>m[1]))].sort()).toEqual(['stopAndWait']);
    expect(main.slice(0,start)).not.toMatch(/controller\.(?!state)\w+\(/);
    // Every IPC handler rejects requests not sent by the app's own window.
    const ipc=startup.slice(handlers,ipcEnd).split('ipcMain.handle(').slice(1);expect(ipc.length).toBeGreaterThanOrEqual(5);
    for(const handler of ipc)expect(handler).toMatch(/event\.sender ?!== ?window\.webContents[\s\S]*IPC_NOT_ALLOWED/);
  });
});
