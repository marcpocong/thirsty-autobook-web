/** Owner-authorized local maintenance. Never changes a journal, booking state or submission permit. */
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,writeFile,lstat,rename,unlink,readdir} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {inspectUpdateSafety,protectedStateManifest,windowsProcesses} from './app-installation.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sha=/^[a-f0-9]{64}$/;
// The maintenance process itself cannot have a booking in flight. Every other installed process remains a blocker.
const maintenanceProcesses=()=>windowsProcesses().filter(p=>p.ProcessId!==process.pid);
async function exclusive(path,bytes){const f=await open(path,'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}}
async function elapsedResponseEvidence(root,path,record,now){
  const expires=record.observedResponse?.holdExpiresAt;
  if(Array.isArray(expires)&&expires.length){if(expires.some(x=>!Number.isFinite(Date.parse(x))||Date.parse(x)>now))throw Error('MAINTENANCE_ACTIVE_OR_UNCERTAIN_HOLD');return;}
  // Legacy aggregate parents may lack response metadata. Only bounded, fully elapsed child response evidence qualifies code replacement.
  let children=0,scanned=0;
  async function walk(dir,depth=0){if(depth>5)throw Error('MAINTENANCE_CHILD_SCAN_INCOMPLETE');
    for(const entry of await readdir(dir,{withFileTypes:true})){if(++scanned>3000||entry.isSymbolicLink())throw Error('MAINTENANCE_CHILD_SCAN_INCOMPLETE');const p=join(dir,entry.name);
      if(entry.isDirectory()){await walk(p,depth+1);continue;}
      if(!/^[a-f0-9]{64}\.json$/.test(entry.name))continue;
      const child=JSON.parse(await readFile(p));quiet(child,(await lstat(p)).mtimeMs,now);if(child.state==='rejected')continue;
      const times=child.observedResponse?.holdExpiresAt;
      if(child.state!=='verified'||!Array.isArray(times)||!times.length||times.some(x=>!Number.isFinite(Date.parse(x))||Date.parse(x)>now))throw Error('MAINTENANCE_ACTIVE_OR_UNCERTAIN_HOLD');children++;
    }
  }
  await walk(join(path,'..','fan-out'));if(!children)throw Error('MAINTENANCE_CHILD_EVIDENCE_REQUIRED');
}
async function safePath(root,path){
  if(typeof path!=='string'||isAbsolute(path)||path.includes('\\')||path.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('MAINTENANCE_PATH_REFUSED');
  const target=resolve(root,path);if(relative(root,target).startsWith('..'))throw Error('MAINTENANCE_PATH_REFUSED');
  let cursor=root;for(const part of path.split('/')){cursor=join(cursor,part);if((await lstat(cursor)).isSymbolicLink())throw Error('MAINTENANCE_LINK_REFUSED');}return target;
}
function quiet(record,mtime,now){
  if(!record||typeof record!=='object'||!Number.isFinite(mtime)||now-mtime<15*60_000)throw Error('MAINTENANCE_NOT_QUIET');
  const a=record.attempt??record;
  for(const name of ['releaseMs','dispatchDeadlineMs','triggerMs','shotDeadlineMs'])if(a[name]!==undefined&&(!Number.isSafeInteger(a[name])||a[name]>now))throw Error('MAINTENANCE_DISPATCH_WINDOW_OPEN');
  for(const name of ['releaseAt','dispatchDeadlineAt'])if(a[name]!==undefined&&(!Number.isFinite(Date.parse(a[name]))||Date.parse(a[name])>now))throw Error('MAINTENANCE_DISPATCH_WINDOW_OPEN');
}
function authorValid(auth,root,sourceSha,now){
  if(auth.schema!=='owner-lock-maintenance/v1'||resolve(auth.root)!==resolve(root)||auth.sourceSha!==sourceSha||!sha.test(auth.ownerDirectiveSha256)||
    auth.attestation!=='LOCAL_MAINTENANCE_ONLY_PRESERVE_UNKNOWN_NO_RETRY'||!['INSTALL','ARCHIVE_GLOBAL'].includes(auth.purpose)||
    !Array.isArray(auth.records)||!auth.records.length||!sha.test(auth.lifecycleDigest)||
    !Number.isFinite(now)||!Number.isFinite(Date.parse(auth.approvedAt))||!Number.isFinite(Date.parse(auth.expiresAt))||Date.parse(auth.approvedAt)>now||Date.parse(auth.expiresAt)<=now||Date.parse(auth.expiresAt)<=Date.parse(auth.approvedAt)||Date.parse(auth.expiresAt)-Date.parse(auth.approvedAt)>90*60_000)
    throw Error('MAINTENANCE_AUTHORIZATION_INVALID');
}
/** Every exception is path/code/hash bound. All process, armed, dispatching, malformed and unlisted blockers still refuse. */
export async function prepareOwnerMaintenance(root,{purpose,sourceSha,ownerDirective,attested=false,processes=maintenanceProcesses(),now=Date.now()}={}){
  if(!attested||!ownerDirective?.trim()||!/^[a-f0-9]{40}$/.test(sourceSha)||!['INSTALL','ARCHIVE_GLOBAL'].includes(purpose))throw Error('MAINTENANCE_OWNER_ATTESTATION_REQUIRED');
  const report=await inspectUpdateSafety(root,{processes,now});
  if(report.blockers.some(b=>b.code==='APP_UPDATE_ACTIVE_PROCESS'||b.code==='APP_UPDATE_ACTIVE_DISPATCH'))throw Error('MAINTENANCE_ACTIVE_OPERATION');
  const records=[];
  if(purpose==='INSTALL'){
    for(const blocker of report.blockers){
      if(blocker.code!=='APP_UPDATE_ACTIVE_OR_UNKNOWN_HOLD'||blocker.reason!=='VERIFIED_HOLD')throw Error('MAINTENANCE_BLOCKER_REFUSED');
      const path=await safePath(root,blocker.path),bytes=await readFile(path),record=JSON.parse(bytes);quiet(record,(await lstat(path)).mtimeMs,now);
      if(record.state!=='verified')throw Error('MAINTENANCE_BLOCKER_REFUSED');
      await elapsedResponseEvidence(root,path,record,now);
      records.push({...blocker,sha256:hash(bytes)});
    }
  }else{
    const path=await safePath(root,'.local/automation.lock'),bytes=await readFile(path),record=JSON.parse(bytes);quiet(record,(await lstat(path)).mtimeMs,now);
    if(!Number.isInteger(record.pid)||typeof record.runID!=='string'||!['API_READY','HOLD_VERIFIED','FINAL_ACTION_ARMED','FINAL_ACTION_DISPATCHING'].includes(record.stage))throw Error('MAINTENANCE_LOCK_UNRECOGNIZED');
    // No in-flight process exists; archived FINAL_ACTION records remain uncertain and every journal still blocks its exact interval.
    records.push({path:'.local/automation.lock',sha256:hash(bytes),stage:record.stage,runID:record.runID,pid:record.pid});
  }
  if(!records.length)throw Error('MAINTENANCE_NOT_NEEDED');
  const manifest=await protectedStateManifest(root);
  return {schema:'owner-lock-maintenance/v1',id:randomUUID(),root:resolve(root),purpose,sourceSha,approvedAt:new Date(now).toISOString(),expiresAt:new Date(now+90*60_000).toISOString(),
    ownerDirectiveSha256:hash(ownerDirective),attestation:'LOCAL_MAINTENANCE_ONLY_PRESERVE_UNKNOWN_NO_RETRY',records,lifecycleDigest:manifest.digest,
    effect:purpose==='INSTALL'?'Code replacement only; every original journal remains unchanged and target-protecting':'Global lease archive only; no booking outcome or permit changes'};
}
export async function claimOwnerMaintenance(root,directory,sourceSha,{processes=maintenanceProcesses(),now=Date.now()}={}){
  const auth=JSON.parse(await readFile(join(directory,'authorization.json'),'utf8'));authorValid(auth,root,sourceSha,now);
  const bytes=await readFile(join(directory,'authorization.json'));
  const report=await inspectUpdateSafety(root,{processes,now});
  if(report.blockers.some(b=>b.code==='APP_UPDATE_ACTIVE_PROCESS'||b.code==='APP_UPDATE_ACTIVE_DISPATCH'))throw Error('MAINTENANCE_ACTIVE_OPERATION');
  if((await protectedStateManifest(root)).digest!==auth.lifecycleDigest)throw Error('MAINTENANCE_EVIDENCE_CHANGED');
  for(const record of auth.records)if(hash(await readFile(await safePath(root,record.path)))!==record.sha256)throw Error('MAINTENANCE_EVIDENCE_CHANGED');
  const claim=await open(join(directory,'claimed.json'),'wx',0o600).catch(()=>{throw Error('MAINTENANCE_ALREADY_CONSUMED');});
  try{await claim.writeFile(JSON.stringify({at:new Date(now).toISOString(),authorizationSha256:hash(bytes),pid:process.pid}));await claim.sync();}finally{await claim.close();}
  return auth;
}
export async function assertOwnerInstallSafety(root,auth,{processes=maintenanceProcesses(),now=Date.now()}={}){
  authorValid(auth,root,auth.sourceSha,now);if(auth.purpose!=='INSTALL')throw Error('MAINTENANCE_PURPOSE_MISMATCH');
  if((await protectedStateManifest(root)).digest!==auth.lifecycleDigest)throw Error('MAINTENANCE_EVIDENCE_CHANGED');
  const report=await inspectUpdateSafety(root,{processes,now});
  for(const blocker of report.blockers){const record=auth.records.find(r=>r.path===blocker.path&&r.code===blocker.code&&r.reason===blocker.reason);
    if(!record||blocker.code!=='APP_UPDATE_ACTIVE_OR_UNKNOWN_HOLD'||blocker.reason!=='VERIFIED_HOLD'||hash(await readFile(await safePath(root,record.path)))!==record.sha256)throw Error('MAINTENANCE_NEW_BLOCKER');}
  return {...report,ownerMaintenance:auth.id,waivedBlockers:report.blockers,blockers:[],eligibility:'READY'};
}
/** Atomic replacement keeps the global lock occupied throughout maintenance; original bytes are archived write-once. */
export async function archiveOwnerGlobalLock(root,directory,sourceSha,options={}){
  await mkdir(join(root,'.local/owner-lock-maintenance'),{recursive:true});
  const mutexPath=join(root,'.local/owner-lock-maintenance/maintenance.lock'),mutex=await open(mutexPath,'wx',0o600).catch(()=>{throw Error('MAINTENANCE_IN_PROGRESS');});
  const original=join(root,'.local/automation.lock'),archive=join(directory,'original-global-lock.json');
  try{
    const auth=await claimOwnerMaintenance(root,directory,sourceSha,options);if(auth.purpose!=='ARCHIVE_GLOBAL')throw Error('MAINTENANCE_PURPOSE_MISMATCH');
    // Reserve destination without replacing previous archives; all compliant maintenance operations share the mutex.
    await exclusive(archive,await readFile(original));
    if(hash(await readFile(original))!==auth.records[0].sha256)throw Error('MAINTENANCE_EVIDENCE_CHANGED');
    const temporary=join(root,`.local/owner-maintenance-${auth.id}.tmp`),sentinel=Buffer.from(JSON.stringify({pid:process.pid,runID:auth.id,stage:'OWNER_MAINTENANCE',stageAt:new Date().toISOString()}));
    await exclusive(temporary,sentinel);await rename(temporary,original);
    try{
      if(hash(await readFile(archive))!==auth.records[0].sha256||hash(await readFile(original))!==hash(sentinel))throw Error('MAINTENANCE_ARCHIVE_CHANGED');
      const current=await protectedStateManifest(root);
      // Reconstruct original manifest using the untouched archived lease; every other lifecycle byte must match.
      const entries=[...current.files.filter(f=>f.path!=='.local/automation.lock'),{path:'.local/automation.lock',size:(await lstat(archive)).size,sha256:auth.records[0].sha256}].sort((a,b)=>a.path.localeCompare(b.path));
      const originalEntries=(await readFile(join(directory,'lifecycle-before.json'),'utf8'));
      const baseline=JSON.parse(originalEntries);if(baseline.digest!==auth.lifecycleDigest||JSON.stringify(entries)!==JSON.stringify([...baseline.files].sort((a,b)=>a.path.localeCompare(b.path))))throw Error('MAINTENANCE_JOURNAL_CHANGED');
      await writeFile(join(directory,'completed.json'),JSON.stringify({at:new Date().toISOString(),id:auth.id,originalSha256:auth.records[0].sha256,archived:true,journalsUnchanged:true,unknownTargetsStillProtected:true}),{flag:'wx'});
      if(hash(await readFile(original))!==hash(sentinel))throw Error('MAINTENANCE_LOCK_REPLACED');
      await unlink(original);
      return {id:auth.id,archived:true,journalsUnchanged:true};
    }catch(error){
      if(hash(await readFile(original))!==hash(sentinel))throw Error('MAINTENANCE_ROLLBACK_REQUIRES_REVIEW');
      await exclusive(temporary,await readFile(archive));await rename(temporary,original);
      await exclusive(join(directory,'rolled-back.json'),JSON.stringify({at:new Date().toISOString(),id:auth.id,rolledBack:true,originalGlobalLockRestored:true,authorizationConsumed:true}));
      throw error;
    }
  }finally{await mutex.close();await unlink(mutexPath);}
}
