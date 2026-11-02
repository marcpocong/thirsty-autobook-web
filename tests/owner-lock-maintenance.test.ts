import {mkdtemp,mkdir,readFile,writeFile,rm,utimes,access} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {afterEach,describe,expect,it} from 'vitest';
// @ts-expect-error plain ESM helper
import {prepareOwnerMaintenance,claimOwnerMaintenance,assertOwnerInstallSafety,archiveOwnerGlobalLock} from '../scripts/owner-lock-maintenance.mjs';
// @ts-expect-error plain ESM helper
import {protectedStateManifest} from '../scripts/app-installation.mjs';
import {assertLiveLabJournalEligibility} from '../src/shotgun-live-lab-safety.js';
const roots:string[]=[],now=Date.now(),sourceSha='a'.repeat(40),key='1'.repeat(64);
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function put(root:string,path:string,value:unknown){const p=join(root,path);await mkdir(join(p,'..'),{recursive:true});await writeFile(p,typeof value==='string'?value:JSON.stringify(value));await utimes(p,new Date(now-3600_000),new Date(now-3600_000));}
async function fixture(){const root=await mkdtemp(join(tmpdir(),'owner-maintenance-'));roots.push(root);return root;}
const base={purpose:'INSTALL',sourceSha,ownerDirective:'Owner authorizes audited local maintenance, preserve UNKNOWN',attested:true,processes:[],now};
const attempt={stage:'dispatching',releaseMs:now-7200_000,dispatchDeadlineMs:now-7100_000,targetDate:'2026-11-04',courtIds:[7],hourlyBoundaries:[{startTime:'19:00',endTime:'20:00'}]};
async function legacy(root:string){const path=`.local/api-booking/api-first-journals/${key}/${key}.json`;
  await put(root,path,{state:'verified',attempt});await put(root,`.local/api-booking/api-first-journals/${key}/fan-out/race/child/${key}.json`,{state:'verified',attempt,observedResponse:{holdExpiresAt:[new Date(now-3600_000).toISOString()]}});return path;}
async function author(root:string,auth:any){const dir=join(root,'audit');await mkdir(dir);await writeFile(join(dir,'authorization.json'),JSON.stringify(auth));await writeFile(join(dir,'lifecycle-before.json'),JSON.stringify(await protectedStateManifest(root)));return dir;}
describe('owner-authorized maintenance preserves reservation integrity',()=>{
  it('permits exact historical aggregate code replacement without changing any lifecycle byte',async()=>{
    const root=await fixture();await legacy(root);const before=await protectedStateManifest(root),auth=await prepareOwnerMaintenance(root,base),dir=await author(root,auth);
    expect(auth.records).toHaveLength(1);const claimed=await claimOwnerMaintenance(root,dir,sourceSha,{processes:[],now});
    expect(await assertOwnerInstallSafety(root,claimed,{processes:[],now})).toMatchObject({eligibility:'READY',blockers:[],waivedBlockers:expect.any(Array)});
    expect((await protectedStateManifest(root)).digest).toBe(before.digest);
    await expect(claimOwnerMaintenance(root,dir,sourceSha,{processes:[],now})).rejects.toThrow('ALREADY_CONSUMED');
  });
  it('refuses live processes, live dispatches, active holds, and missing child evidence',async()=>{
    const root=await fixture(),path=await legacy(root);
    await expect(prepareOwnerMaintenance(root,{...base,processes:[{ExecutablePath:root+'\\node.exe'}]})).rejects.toThrow('ACTIVE_OPERATION');
    await put(root,path,{state:'dispatching',attempt});await expect(prepareOwnerMaintenance(root,base)).rejects.toThrow('ACTIVE_OPERATION');
    await put(root,path,{state:'verified',attempt,observedResponse:{holdExpiresAt:[new Date(now+10000).toISOString()]}});
    await expect(prepareOwnerMaintenance(root,base)).rejects.toThrow('ACTIVE_OR_UNCERTAIN_HOLD');
    await put(root,path,{state:'verified',attempt});await rm(join(root,`.local/api-booking/api-first-journals/${key}/fan-out`),{recursive:true});
    await expect(prepareOwnerMaintenance(root,base)).rejects.toThrow();
  });
  it('refuses changed evidence, new blockers, expired authorization and absent attestation',async()=>{
    const root=await fixture(),path=await legacy(root),auth=await prepareOwnerMaintenance(root,base),dir=await author(root,auth);
    await expect(prepareOwnerMaintenance(root,{...base,attested:false})).rejects.toThrow('ATTESTATION');
    await expect(claimOwnerMaintenance(root,dir,sourceSha,{processes:[],now:now+91*60_000})).rejects.toThrow('AUTHORIZATION_INVALID');
    await expect(assertOwnerInstallSafety(root,auth,{processes:[{ExecutablePath:root+'\\node.exe'}],now})).rejects.toThrow('NEW_BLOCKER');
    await put(root,path,{state:'unknown',attempt});await expect(claimOwnerMaintenance(root,dir,sourceSha,{processes:[],now})).rejects.toThrow('EVIDENCE_CHANGED');
  });
  it('archives an abandoned global lease with exact bytes and leaves UNKNOWN journals blocking the same target',async()=>{
    const root=await fixture(),path=`.local/api-booking/api-first-journals/${key}/${key}.json`;
    await put(root,path,{key,state:'unknown',attempt,createdAt:new Date(now-48*3600_000).toISOString(),updatedAt:new Date(now-48*3600_000).toISOString()});
    await put(root,'.local/automation.lock',{pid:123456,runID:'legacy',stage:'FINAL_ACTION_DISPATCHING',stageAt:new Date(now-3600_000).toISOString()});
    const original=await readFile(join(root,'.local/automation.lock')),journal=await readFile(join(root,path));
    const auth=await prepareOwnerMaintenance(root,{...base,purpose:'ARCHIVE_GLOBAL'}),dir=await author(root,auth);
    expect(await archiveOwnerGlobalLock(root,dir,sourceSha,{processes:[],now})).toMatchObject({archived:true,journalsUnchanged:true});
    expect(await readFile(join(dir,'original-global-lock.json'))).toEqual(original);expect(await readFile(join(root,path))).toEqual(journal);
    await expect(access(join(root,'.local/automation.lock'))).rejects.toThrow();
    await expect(assertLiveLabJournalEligibility(join(root,'.local/api-booking/api-first-journals'),[{kind:'SHOTGUN_LIVE_REHEARSAL',date:'2026-11-04',wing:'MANGO',court:7,worker:'A',start:'19:00',duration:1,maximum:600,attempts:1,payment:false}])).rejects.toThrow('OUTSTANDING_TARGET_CONFLICT');
  });
  it('restores the original global lease if preservation verification fails',async()=>{
    const root=await fixture();await put(root,'.local/automation.lock',{pid:123456,runID:'old',stage:'HOLD_VERIFIED',stageAt:new Date(now-3600_000).toISOString(),holdExpiresAt:new Date(now-3600_000).toISOString()});
    const original=await readFile(join(root,'.local/automation.lock')),auth=await prepareOwnerMaintenance(root,{...base,purpose:'ARCHIVE_GLOBAL'}),dir=await author(root,auth);
    await writeFile(join(dir,'lifecycle-before.json'),JSON.stringify({digest:auth.lifecycleDigest,files:[]}));
    await expect(archiveOwnerGlobalLock(root,dir,sourceSha,{processes:[],now})).rejects.toThrow('JOURNAL_CHANGED');
    expect(await readFile(join(root,'.local/automation.lock'))).toEqual(original);
    expect(JSON.parse(await readFile(join(dir,'claimed.json'),'utf8')).authorizationSha256).toHaveLength(64);
  });
});
