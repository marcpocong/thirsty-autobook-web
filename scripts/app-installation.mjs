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
  return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -match '^(node|electron|chrome|Thirsty Pickle Bot|tsx|node_repl)\.exe$' } | Select-Object ProcessId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024}));
}
export async function assertSafeUpdate(root,{processes=windowsProcesses(),now=Date.now()}={}) {
  const canonical=resolve(root).toLowerCase();
  for(const p of processes) {
    const exe=(p.ExecutablePath??'').toLowerCase(),cmd=(p.CommandLine??'').toLowerCase();
    if(exe.startsWith(canonical+'\\')||cmd.includes(canonical)&&/electron|run-thirsty|dist[\\/]ui|tsx|api-booking|shotgun|chrome/.test(cmd))throw Error('APP_UPDATE_ACTIVE_PROCESS');
  }
  // An expired validated hold may be preserved in place. Unknown/armed/dispatching states never age into safety.
  function checkLock(v) {
    if(processes.some(p=>p.ProcessId===v.pid))throw Error('APP_UPDATE_ACTIVE_PROCESS');
    if(v.stage==='HOLD_VERIFIED'&&Number.isFinite(Date.parse(v.holdExpiresAt))&&Date.parse(v.holdExpiresAt)<=now)return;
    throw Error('APP_UPDATE_UNRESOLVED_LIFECYCLE');
  }
  if(existsSync(join(root,'.local/automation.lock')))checkLock(JSON.parse(await readFile(join(root,'.local/automation.lock'),'utf8')));
  async function scan(path) {
    if(!existsSync(path))return;
    for(const e of await readdir(path,{withFileTypes:true})) {
      if(e.isSymbolicLink())throw Error('APP_UPDATE_STATE_UNRECOGNIZED');
      const p=join(path,e.name);
      if(e.isDirectory())await scan(p);
      else if(e.name.endsWith('.lock'))checkLock(JSON.parse(await readFile(p,'utf8')));
      else if(e.name.endsWith('.json')) {
        let v;try{v=JSON.parse(await readFile(p,'utf8'));}catch{throw Error('APP_UPDATE_STATE_UNREADABLE');}
        if(v.attempt&&v.state&&v.attempt.executionMode!=='OFFLINE_INTERCEPTED') {
          if(['unknown','armed','dispatching'].includes(v.state))throw Error('APP_UPDATE_UNRESOLVED_JOURNAL');
          if(v.state==='verified') {
            const expiries=v.observedResponse?.holdExpiresAt;
            if(!Array.isArray(expiries)||!expiries.length||expiries.some(x=>!Number.isFinite(Date.parse(x))||Date.parse(x)>now))throw Error('APP_UPDATE_ACTIVE_OR_UNKNOWN_HOLD');
          }else if(v.state!=='rejected')throw Error('APP_UPDATE_STATE_UNRECOGNIZED');
        }
        if(v.lock) { checkLock(v.lock);for(const w of v.workers??[])checkLock(w); }
      }
    }
  }
  for(const path of ['.local/api-booking','.local/dual','.local/retained-holds'])await scan(join(root,path));
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
