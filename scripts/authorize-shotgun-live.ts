/** Explicit authoring only. This command never prepares a browser or submits a booking. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { ShotgunLiveRequestSchema, liveLabRequests } from '../src/shotgun-live-rehearsal.js';
import { assertLiveRehearsalAuthorization, assertSingleShotLabQualification, rehearsalRequestFingerprint, REHEARSAL_MODULES } from '../src/shotgun-live-authorization.js';
import { assertCanonicalRecoveryRuntime } from '../src/api-booking/recovery-runtime.js';

async function main(){
  const [action,directoryArg,requestFile,directiveFile,attestation,...extra]=process.argv.slice(2);
  if(action!=='--authorize'||!directoryArg||!requestFile||!directiveFile||attestation!=='--attest-owner-scope'||
    extra.length!==0&&(extra.length!==2||extra[0]!=='--single-shot-run'||!/^[A-Za-z0-9_-]{1,100}$/.test(extra[1]!)))
    throw Error('REHEARSAL_EXPLICIT_ATTESTATION_REQUIRED');
  const root=resolve('.'),directory=resolve(directoryArg),child=relative(resolve('.local/shotgun-rehearsal'),directory);
  if(!child||child.startsWith('..')||isAbsolute(child))throw Error('REHEARSAL_DIRECTORY_REFUSED');
  await assertCanonicalRecoveryRuntime(root);
  const request=ShotgunLiveRequestSchema.parse(JSON.parse(await readFile(resolve(requestFile),'utf8')));
  const directive=await readFile(resolve(directiveFile));
  if(!directive.length)throw Error('REHEARSAL_OWNER_DIRECTIVE_MISSING');
  const hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
  const build=JSON.parse(await readFile('dist/build-info.json','utf8'));
  const engineHashes=Object.fromEntries(await Promise.all(REHEARSAL_MODULES.map(async name=>[name,hash(await readFile(resolve('dist/src',name)))])));
  const singleShotQualification=extra[1]?{run:extra[1],resultSha256:hash(await readFile(resolve('.local/shotgun-rehearsal',extra[1],'result.json')))}:undefined;
  const now=Date.now();
  const auth=assertLiveRehearsalAuthorization({schema:'shotgun-live-authorization/v2',request,
    approvedBy:'OWNER_CONVERSATION',approvedAt:new Date(now).toISOString(),expiresAt:new Date(now+15*60_000).toISOString(),
    ownerDirectiveSha256:hash(directive),requestFingerprint:rehearsalRequestFingerprint(request),installedSha:build.gitSha,engineHashes,
    singleShotQualification,attestation:'EXACT_TARGET_ONE_POST_NO_PAYMENT_NO_CANCELLATION_NO_RETRY'},now);
  if(singleShotQualification)assertSingleShotLabQualification(auth,await readFile(resolve('.local/shotgun-rehearsal',singleShotQualification.run,'result.json')));
  await mkdir(directory,{recursive:true,mode:0o700});
  await writeFile(join(directory,'authorization.json'),JSON.stringify(auth,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({authorization:join(directory,'authorization.json'),request,expiresAt:auth.expiresAt,
    installedSha:auth.installedSha,requestFingerprint:auth.requestFingerprint,
    availability:'EXECUTION_REQUIRES_FRESH_OBSERVATION',execution:'NOT_STARTED',checkoutBudget:liveLabRequests(request).length,payment:false}));
}
main().catch(error=>{console.error(error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'REHEARSAL_AUTHORIZATION_REFUSED');process.exitCode=1;});
