/** Explicit owner-attested maintenance authoring/execution. Never imports a booking dispatcher. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
// @ts-expect-error plain ESM maintenance helper
import {prepareOwnerMaintenance,archiveOwnerGlobalLock} from './owner-lock-maintenance.mjs';
// @ts-expect-error plain ESM installation helper
import {inspectUpdateSafety,protectedStateManifest} from './app-installation.mjs';
import {assertLiveLabJournalEligibility} from '../src/shotgun-live-lab-safety.js';
import {liveLabRequests} from '../src/shotgun-live-rehearsal.js';
async function main(){
  const [action,kind,directive,request]=process.argv.slice(2),root=resolve('.'),sourceSha=execFileSync('git',['-C',resolve('Source'),'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if(action==='inspect'){console.log(JSON.stringify(await inspectUpdateSafety(root),null,2));return;}
  if(action!=='--attest-owner'||!['INSTALL','ARCHIVE_GLOBAL'].includes(kind??'')||!directive)throw Error('MAINTENANCE_EXPLICIT_ATTESTATION_REQUIRED');
  if(kind==='ARCHIVE_GLOBAL'){
    if(!request)throw Error('MAINTENANCE_EXACT_NEXT_TARGET_REQUIRED');
    await assertLiveLabJournalEligibility(resolve('.local/api-booking/api-first-journals'),liveLabRequests(JSON.parse(await readFile(request,'utf8'))));
  }
  const auth=await prepareOwnerMaintenance(root,{purpose:kind,sourceSha,ownerDirective:await readFile(directive,'utf8'),attested:true});
  const directory=join(root,'.local/owner-lock-maintenance',auth.id);await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'authorization.json'),JSON.stringify(auth,null,2),{flag:'wx',mode:0o600});
  await writeFile(join(directory,'lifecycle-before.json'),JSON.stringify(await protectedStateManifest(root)),{flag:'wx',mode:0o600});
  if(request)await writeFile(join(directory,'next-request.json'),await readFile(request),{flag:'wx',mode:0o600});
  if(kind==='ARCHIVE_GLOBAL')console.log(JSON.stringify(await archiveOwnerGlobalLock(root,directory,sourceSha)));
  console.log(directory);
}
main().catch(e=>{console.error(e instanceof Error?e.message:'MAINTENANCE_FAILED');process.exitCode=1;});
