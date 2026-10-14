/** Canonical installation detection, read-only lifecycle gate and recoverable file transaction. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile, realpath, open, lstat } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { distContentId } from './build-support.mjs';

export const managedFiles = Object.freeze(['dist','src','ui','scripts','node_modules','package.json','package-lock.json','assets/brand','Thirsty Pickle Bot.exe','BUILD-INFO.txt','.local/runtime/node.exe','.local/thirsty-pickle-bot.ico']);
export const hashFile = async path => createHash('sha256').update(await readFile(path)).digest('hex');
export async function treeDigest(root) {
  const hash=createHash('sha256');
  async function visit(path) {
    for(const e of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const p=join(path,e.name);if(e.isSymbolicLink())throw Error('UPDATE_SYMLINK_REFUSED');
      if(e.isDirectory())await visit(p);else hash.update(relative(root,p)).update('\0').update(await readFile(p)).update('\0');
    }
  }
  if(existsSync(root))await visit(root);return hash.digest('hex');
}
export async function detectInstallation(source) {
  const parent=await realpath(dirname(resolve(source)));
  // Never discover a target by creating one. A historical nested installation is ambiguous.
  if(existsSync(join(parent,'Thirsty Pickle Bot','Thirsty Pickle Bot.exe')))throw Error('APP_INSTALLATION_AMBIGUOUS');
  for(const file of ['Thirsty Pickle Bot.exe','BUILD-INFO.txt','config.local.json','.local/private','dist/build-info.json','scripts/run-thirsty-pickle-bot.mjs','.local/runtime/node.exe','node_modules/electron/dist/electron.exe'])
    if(!existsSync(join(parent,file)))throw Error('APP_INSTALLATION_UNRECOGNIZED');
  for(const name of ['.local','.local/build','.local/private',...managedFiles]) {
    const p=join(parent,name);if(existsSync(p)&&(await lstat(p)).isSymbolicLink())throw Error('APP_INSTALLATION_LINK_REFUSED');
  }
  const text=await readFile(join(parent,'BUILD-INFO.txt'),'utf8');
  const info=JSON.parse(await readFile(join(parent,'dist/build-info.json'),'utf8'));
  const launcher=await hashFile(join(parent,'Thirsty Pickle Bot.exe'));
  if(!text.startsWith('Thirsty Pickle Bot self-contained installation')||!text.includes(`Source Commit: ${info.gitSha}`)||!text.includes(`Build ID: ${info.buildId}`)||!text.toLowerCase().includes(`launcher sha256: ${launcher}`))throw Error('APP_INSTALLATION_PROVENANCE_INVALID');
  if(await distContentId(join(parent,'dist'))!==info.contentId)throw Error('APP_INSTALLATION_RUNTIME_INCONSISTENT');
  JSON.parse(await readFile(join(parent,'config.local.json'),'utf8'));
  return {root:parent,info,launcher};
}
export function windowsProcesses() {
  if(process.platform!=='win32')throw Error('WINDOWS_UPDATE_REQUIRED');
  return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -match '^(node|electron|chrome|Thirsty Pickle Bot|tsx|node_repl)\.exe$' } | Select-Object ProcessId,ExecutablePath,CommandLine,@{n='CreatedMs';e={if($_.CreationDate){([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}else{$null}}}) | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024}));
}
/** Booking lifecycle evidence. Never managed, moved, parsed-and-rewritten or reclassified by an update. */
export const lifecycleStores=Object.freeze(['.local/api-booking','.local/dual','.local/retained-holds']);
export const protectedLifecycleFiles=Object.freeze(['.local/automation.lock']);
/**
 * Installation safety only: an UNKNOWN record may coexist with a code replacement once no write has touched it
 * for this long. Age is never evidence about the provider outcome; the record stays UNKNOWN and keeps blocking its target.
 */
export const HISTORICAL_QUIET_MS=24*60*60*1000;
const slash=path=>path.split('\\').join('/');
/**
 * Read-only installation preflight. Separates historical UNKNOWN submissions (preserved, target still blocked by the
 * journal) from active lifecycle blockers (anything a code replacement could interrupt). Unrecognized state fails closed.
 */
export async function inspectUpdateSafety(root,{processes=windowsProcesses(),now=Date.now()}={}) {
  const blockers=[],historicalUnknown=[],block=(code,path,reason)=>blockers.push({code,...(path?{path:slash(relative(root,path))}:{}),...(reason?{reason}:{})});
  const canonical=resolve(root).toLowerCase();
  for(const p of processes) {
    const exe=(p.ExecutablePath??'').toLowerCase(),cmd=(p.CommandLine??'').toLowerCase();
    if(exe.startsWith(canonical+'\\')||cmd.includes(canonical)&&/electron|run-thirsty|dist[\\/]ui|tsx|api-booking|shotgun|chrome/.test(cmd))block('APP_UPDATE_ACTIVE_PROCESS',null,`pid ${p.ProcessId??'unknown'}`);
  }
  // An expired validated hold may be preserved in place. Unknown/armed/dispatching states never age into safety.
  function checkLock(v,path) {
    if(!v||typeof v!=='object')return block('APP_UPDATE_STATE_UNRECOGNIZED',path,'LOCK_SHAPE');
    // A process started after the owner last wrote the lock cannot be that owner (Windows PID reuse). Unknown start times fail closed.
    const written=Date.parse(v.stageAt);
    if(processes.some(p=>p.ProcessId===v.pid&&!(Number.isFinite(p.CreatedMs)&&Number.isFinite(written)&&p.CreatedMs>written+1000)))
      return block('APP_UPDATE_ACTIVE_PROCESS',path,`lock owner pid ${v.pid}`);
    if(v.stage==='HOLD_VERIFIED'&&Number.isFinite(Date.parse(v.holdExpiresAt))&&Date.parse(v.holdExpiresAt)<=now)return;
    block('APP_UPDATE_UNRESOLVED_LIFECYCLE',path,String(v.stage??'UNKNOWN_STAGE'));
  }
  async function readJson(path) {try{return JSON.parse(await readFile(path,'utf8'));}catch{block('APP_UPDATE_STATE_UNREADABLE',path);return undefined;}}
  const time=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)?Date.parse(value):NaN;
  /** Every condition is about whether replacing code could interrupt something; none of them says the booking failed. */
  async function classifyUnknown(v,path) {
    const key=v.key,a=v.attempt,created=time(v.createdAt),updated=time(v.updatedAt),mtime=(await lstat(path)).mtimeMs;
    if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||path.slice(-key.length-5)!==`${key}.json`||!a||typeof a!=='object'||!['armed','dispatching'].includes(a.stage)||!Number.isFinite(created)||!Number.isFinite(updated))
      return block('APP_UPDATE_UNRESOLVED_JOURNAL',path,'UNKNOWN_RECORD_UNRECOGNIZED');
    const lastWrite=Math.max(created,updated,mtime);
    if(updated>now+60_000||created>now+60_000)return block('APP_UPDATE_UNRESOLVED_JOURNAL',path,'UNKNOWN_RECORD_FUTURE_DATED');
    if(now-lastWrite<HISTORICAL_QUIET_MS)return block('APP_UPDATE_UNRESOLVED_JOURNAL',path,'UNKNOWN_RECORD_RECENT');
    for(const deadline of [a.releaseMs,a.dispatchDeadlineMs,a.triggerMs,a.shotDeadlineMs])
      if(deadline!==undefined&&(!Number.isSafeInteger(deadline)||deadline>now))return block('APP_UPDATE_UNRESOLVED_JOURNAL',path,'UNKNOWN_RECORD_DISPATCH_WINDOW_OPEN');
    const expiries=v.observedResponse?.holdExpiresAt;
    if(expiries!==undefined&&(!Array.isArray(expiries)||expiries.some(x=>!Number.isFinite(time(x))||time(x)>now)))
      return block('APP_UPDATE_ACTIVE_OR_UNKNOWN_HOLD',path,'UNKNOWN_RECORD_HOLD_MAY_BE_ACTIVE');
    historicalUnknown.push({path:slash(relative(root,path)),key,targetDate:a.targetDate,...(a.wing?{wing:a.wing}:{}),courtIds:a.courtIds,stage:a.stage,
      lastWriteAt:new Date(lastWrite).toISOString(),...(v.diagnostic?.status?{httpStatus:v.diagnostic.status}:{}),...(v.failureCode?{failureCode:v.failureCode}:{}),
      ...(Array.isArray(expiries)&&expiries.length?{recordedHoldExpired:true}:{})});
  }
  if(existsSync(join(root,'.local/automation.lock'))) {const v=await readJson(join(root,'.local/automation.lock'));if(v!==undefined)checkLock(v,join(root,'.local/automation.lock'));}
  async function scan(path) {
    if(!existsSync(path))return;
    for(const e of await readdir(path,{withFileTypes:true})) {
      const p=join(path,e.name);
      if(e.isSymbolicLink()){block('APP_UPDATE_STATE_UNRECOGNIZED',p,'SYMLINK');continue;}
      if(e.isDirectory()) {
        // A remaining per-key recycle lock means an archive move of journal evidence may be in progress.
        if(e.name==='recycle-locks'){for(const lock of await readdir(p))block('APP_UPDATE_UNRESOLVED_LIFECYCLE',join(p,lock),'RECYCLE_IN_PROGRESS');continue;}
        await scan(p);
      }
      else if(e.name.endsWith('.arming'))block('APP_UPDATE_ACTIVE_DISPATCH',p,'ARMING_IN_PROGRESS');
      else if(e.name.endsWith('.lock')){const v=await readJson(p);if(v!==undefined)checkLock(v,p);}
      else if(e.name.endsWith('.json')) {
        const v=await readJson(p);if(v===undefined)continue;
        if(v&&v.attempt&&v.state&&v.attempt.executionMode!=='OFFLINE_INTERCEPTED') {
          if(['armed','dispatching'].includes(v.state))block('APP_UPDATE_ACTIVE_DISPATCH',p,`JOURNAL_${v.state.toUpperCase()}`);
          else if(v.state==='unknown')await classifyUnknown(v,p);
          else if(v.state==='verified') {
            const expiries=v.observedResponse?.holdExpiresAt;
            if(!Array.isArray(expiries)||!expiries.length||expiries.some(x=>!Number.isFinite(Date.parse(x))||Date.parse(x)>now))block('APP_UPDATE_ACTIVE_OR_UNKNOWN_HOLD',p,'VERIFIED_HOLD');
          }else if(v.state!=='rejected')block('APP_UPDATE_STATE_UNRECOGNIZED',p,'JOURNAL_STATE');
        }
        if(v?.lock) { checkLock(v.lock,p);for(const w of v.workers??[])checkLock(w,p); }
      }
    }
  }
  for(const path of lifecycleStores)await scan(join(root,path));
  return {checkedAt:new Date(now).toISOString(),historicalUnknown,blockers,eligibility:blockers.length?'REFUSED':'READY'};
}
/** Throws the first active blocker (all of them are on error.report); otherwise returns the report. */
export async function assertSafeUpdate(root,options) {
  const report=await inspectUpdateSafety(root,options);
  if(report.blockers.length)throw Object.assign(Error(report.blockers[0].code),{report});
  return report;
}
export function describeUpdateSafety(report) {
  const n=report.historicalUnknown.length;
  return [`Historical UNKNOWN journals: ${n}${n?' — preserved; affected booking targets remain blocked.':''}`,
    `Active lifecycle blockers: ${report.blockers.length}${report.blockers.length?' — '+[...new Set(report.blockers.map(b=>b.code))].join(', '):''}`,
    `Installation eligibility: ${report.eligibility}`];
}
/** Relative path, size and SHA-256 of every lifecycle file. Any later difference fails installation validation. */
export async function protectedStateManifest(root) {
  const files=[];
  async function visit(path) {
    if(!existsSync(path))return;
    const s=await lstat(path);if(s.isSymbolicLink())throw Error('APP_UPDATE_STATE_UNRECOGNIZED');
    if(s.isDirectory()){for(const name of (await readdir(path)).sort())await visit(join(path,name));return;}
    files.push({path:slash(relative(root,path)),size:s.size,sha256:await hashFile(path)});
  }
  for(const path of [...lifecycleStores,...protectedLifecycleFiles])await visit(join(root,path));
  return {schema:1,roots:[...lifecycleStores,...protectedLifecycleFiles],count:files.length,digest:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files};
}
export async function assertProtectedStateUnchanged(root,manifest) {
  const current=await protectedStateManifest(root);
  if(current.digest===manifest.digest)return current;
  const before=new Map(manifest.files.map(f=>[f.path,f])),after=new Map(current.files.map(f=>[f.path,f]));
  const changed=[...new Set([...before.keys(),...after.keys()])].filter(p=>before.get(p)?.sha256!==after.get(p)?.sha256||before.get(p)?.size!==after.get(p)?.size).sort();
  throw Object.assign(Error(`APP_UPDATE_PROTECTED_STATE_CHANGED ${changed.slice(0,5).join(', ')}`),{changed});
}
/** Same-volume rename transaction. Backups use numbered entries, never a second user-facing EXE. */
export async function applyUpdate(root,stage,{validate=async()=>{},beforeApply=async()=>{},afterMove=async()=>{}}={}) {
  const home=join(root,'.local/build');await mkdir(home,{recursive:true});
  const mutex=await open(join(home,'update.lock'),'wx').catch(()=>{throw Error('APP_UPDATE_IN_PROGRESS_OR_INTERRUPTED');});
  const rollback=join(home,'rollback'),record=join(home,'update-transaction.json');
  let state={schema:1,status:'PREPARING',entries:[],stage};
  const save=()=>writeFile(record,JSON.stringify(state,null,2)+'\n');
  try {
    if(existsSync(record)) {
      const old=JSON.parse(await readFile(record,'utf8'));if(!['INSTALLED','ROLLED_BACK'].includes(old.status))throw Error('APP_UPDATE_RECOVERY_REQUIRED');
    }
    // Verify staged package and safety before removing any working file.
    await validate(stage);await beforeApply();
    if(resolve(stage)!==join(home,'staging'))throw Error('APP_UPDATE_STAGE_INVALID');
    if(existsSync(rollback))await rm(rollback,{recursive:true});await mkdir(rollback);
    state.status='APPLYING';await save();
    for(const [i,name] of managedFiles.entries()) {
      const live=join(root,name),fresh=join(stage,name),backup=join(rollback,String(i));
      if(!existsSync(fresh))throw Error(`APP_UPDATE_STAGE_MISSING ${name}`);
      const entry={name,backup,hadPrevious:existsSync(live),phase:'PENDING'};state.entries.push(entry);await save();
      await mkdir(dirname(live),{recursive:true});
      if(entry.hadPrevious)await rename(live,backup);
      entry.phase='BACKED_UP';await save();await rename(fresh,live);entry.phase='INSTALLED';await save();await afterMove(name);
    }
    await validate(root);state.status='INSTALLED';await save();
    return {rollback,record};
  } catch(error) {
    if(state.status==='APPLYING') {
      for(const e of [...state.entries].reverse()) {
        const live=join(root,e.name);
        // Backup existence also covers a failure immediately after rename, before phase persistence.
        if(existsSync(e.backup)){if(existsSync(live))await rm(live,{recursive:true,force:true});await rename(e.backup,live);}
        else if(!e.hadPrevious&&e.phase==='INSTALLED')await rm(live,{recursive:true,force:true});
      }
      state.status='ROLLED_BACK';await save();
    }
    throw error;
  } finally {await mutex.close();await rm(join(home,'update.lock'),{force:true});}
}
