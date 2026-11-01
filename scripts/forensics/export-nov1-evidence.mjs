/** Offline, allowlisted November 1 incident export. Never imports a browser or booking engine.
 * Usage: node scripts/forensics/export-nov1-evidence.mjs <installation-root> <output.json>
 * Original files are read and hashed, never modified. Output must not already exist.
 */
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
if(process.argv.length!==4)throw Error('EXPECTED_INSTALLATION_ROOT_AND_NEW_OUTPUT');
const root=resolve(process.argv[2]),output=resolve(process.argv[3]);
const runId='63a216a2-cc04-42bc-b982-df174537634d',releaseMs=1793491200000;
const manifest=[];
const hash=b=>createHash('sha256').update(b).digest('hex');
async function read(path){const bytes=await readFile(join(root,path));manifest.push({path:path.replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes)});return bytes.toString('utf8');}
const json=async path=>JSON.parse(await read(path));
const ndjson=async path=>(await read(path)).trim().split(/\r?\n/).map(JSON.parse);
const pick=(row,keys)=>Object.fromEntries(keys.filter(key=>row?.[key]!==undefined).map(key=>[key,row[key]]));
const numeric=row=>Object.fromEntries(Object.entries(row??{}).filter(([,v])=>v===null||typeof v==='number'||typeof v==='boolean'));
const timing=row=>Object.fromEntries(Object.entries(row??{}).filter(([key])=>/Ms$/.test(key)).map(([key,v])=>[key,v&&typeof v==='object'?numeric(v):v]));
const freeze=await json(`.local/api-booking/precision-races/${runId}-phase3-freeze.json`);
const progress=await ndjson(`.local/api-booking/run-progress/${runId}.ndjson`);
const critical=await ndjson(`.local/release-forensics/${runId}/critical-path.ndjson`);
const summary=await json(`.local/release-forensics/${runId}/summary.json`);
const providerTrace=await ndjson(`.local/release-forensics/${runId}/provider-trace.ndjson`);
const fields=['stage','at','eventAt','timingKind','elapsedMs','sincePreviousMs','workerId','attemptId','candidateId','wave','court','startTime','endTime','amount',
 'fanOutIndex','fanOutCount','shotIndex','shotCount','configuredOffsetMs','releaseOffsetMs','state','code','status','statusCode','dispatchState',
 'durationMs','networkDurationMs','responseBytes','prewarmLeadMs','workerCount','sampleCount','offsetMs','roundTripMs','spreadMs','uncertaintyMs',
 'checkpoint','deltaMs','quality','plannedLeadMs','actualLeadMs','lateByMs','firstTriggerOffsetMs','predictedReadyOffsetMs','actualReadyOffsetMs',
 'predictionErrorMs','queueDelayMs','prepDurationMs','securitySource','preparedContextAgeMs','failureCategory','failedHelper','challengeFrame',
 'configured','prepared','started','settled','pending','unsent','unknown','rejected','verified','attempts','exitCode'];
const traceFields=['schedulerFiredMs','workerInvokedMs','transportEnteredMs','prePostMs','rendererArmSentMs','rendererArmedMs','evaluateEnteredMs',
 'fetchInvokedMs','browserRequestStartMs','requestObservedMs','responseHeadersMs','responseCompleteMs','responseObservedMs'];
const children=[],parents=[];
for(const candidate of freeze.authorization.candidates){
 const base=`.local/api-booking/api-first-journals/${candidate.logicalKey}`;
 const files=(await readdir(join(root,base),{recursive:true})).filter(f=>/^[a-f0-9]{64}\.json$/.test(basename(f))).sort();
 for(const file of files){
  const path=`${base}/${file}`,j=await json(path),child=file.includes('fan-out');
  const record={path:path.replaceAll('\\','/'),court:candidate.court,...pick(j,['key','state','createdAt','updatedAt','failureCode']),
   attempt:pick(j.attempt,['attemptId','planFingerprint','targetDate','courtIds','hourlyBoundaries','expectedBookingCount','maximumAmount','stage','releaseMs','dispatchDeadlineMs','dispatchTimingPolicy','triggerMs','shotDeadlineMs'])};
  if(child){
   const offset=j.attempt.triggerMs-releaseMs;
   const c=critical.find(row=>row.meta?.configuredOffsetMs===offset&&row.meta?.parentGoalId===candidate.id);
   if(!c)throw Error('MISSING_CHILD_CRITICAL_ROW');
   const binding=progress.find(row=>row.stage==='PHASE3_SETTLED'&&row.workerId===c.meta.workerId&&row.fanOutIndex===c.meta.fanOutIndex);
   if(!binding)throw Error('MISSING_CHILD_DIAGNOSTIC_ID');
   record.diagnosticAttemptId=binding.attemptId;
   record.worker=c.meta.workerId;record.configuredOffsetMs=offset;
   record.criticalPath={...pick(c,traceFields),meta:pick(c.meta,['fanOutIndex','fanOutCount','shotIndex','shotCount','prewarmReadyMs','httpStatus','finalState','finalCode']),
    calibration:numeric(c.calibration),segments:numeric(c.segments),resourceTiming:{...timing(c.resourceTiming),source:c.resourceTiming?.source??null,protocol:c.resourceTiming?.protocol??null}};
   const o=j.observedResponse;
   if(o)record.observedResponse={...pick(o,['success','validationCode','trustedTotalAmount','transactionAmount']),structure:pick(o.structure,['bookingCount','sessionCount','missingSessionLinks','shapeFingerprint']),
    bookingIdCount:o.bookingIds?.length??0,uniqueBookingIds:new Set(o.bookingIds??[]).size,sessionIdCount:o.bookingSessionIds?.length??0,holdExpiresAt:o.holdExpiresAt};
   const recoveryFile=`${base}/${file.replace(/[^\\/]+$/,'checkout-recovery-private.json')}`;
   if(j.state==='unknown'){
    const recovery=await json(recoveryFile),r=recovery.response;
    record.savedResponse={capturedAt:recovery.capturedAt,worker:recovery.workerId,
     bookings:r.bookings.map(b=>pick(b,['date','start_time','end_time','duration','rate','booking_status','payment_status','hold_expires_at'])),
     sessions:r.bookingSessions.map(s=>({...pick(s,['startTime','endTime','durationHours']),bookingCount:s.bookingIds.length})),
     transaction:pick(r.transaction,['amount','status']),trustedTotalAmount:r.trustedTotalAmount};
   }
   children.push(record);
  }else parents.push(record);
 }
}
children.sort((a,b)=>a.configuredOffsetMs-b.configuredOffsetMs);
if(children.length!==8||children.filter(c=>c.state==='unknown').length!==7||children.filter(c=>c.state==='rejected').length!==1)throw Error('UNEXPECTED_CHILD_ACCOUNTING');
const recovery=await json('DiagnosticsLocal/recovery-nov1/provider-status.json');
const replay=await json('DiagnosticsLocal/installed-repair-nov1/installed-offline-replay.json');
const observerPath=summary.sources.slotWatchLog??summary.sources.slotWatch;
// The known original watch path is scoped to this incident, not selected by latest-file heuristics.
const observer=await ndjson('.local/slot-watch/2026-11-03_311dea90-dbb3-4284-9520-be292e2673a3.ndjson');
const observerTypes={},notLaunchedReasons={};for(const row of observer){observerTypes[row.type]=(observerTypes[row.type]??0)+1;if(row.type==='not-launched'){const key=`${row.kind}:${row.reason}`;notLaunchedReasons[key]=(notLaunchedReasons[key]??0)+1;}}
const hotfixes=[];for(const path of ['DiagnosticsLocal/security-helper-nov1/hotfix-manifest.json','DiagnosticsLocal/installed-repair-nov1/hotfix-manifest.json','DiagnosticsLocal/shotgun-court6-rehearsal/summary-hotfix-manifest.json']){
 const m=await json(path);hotfixes.push({manifest:path,at:m.at,baseBuild:m.baseBuild,changes:m.changes?.map(c=>({path:c.path??c.file,...pick(c,['before','after'])}))??null});
}
const stageCounts={};for(const row of progress)stageCounts[row.stage]=(stageCounts[row.stage]??0)+1;
const later={};for(const [name,path] of Object.entries({
 normalQr:'DiagnosticsLocal/nov3-extended-live-test/read-only-qr-review.json',
 court6:'.local/shotgun-rehearsal/2026-11-01-court6-browser-b/result.json',
 court7:'.local/shotgun-rehearsal/2026-11-01T07-29-38-183Z-court7-b/result.json',
 court7Recovery:'.local/shotgun-rehearsal/2026-11-01T07-29-38-183Z-court7-b/fresh-tab-recovery.json',
 securityFailure:'DiagnosticsLocal/security-readiness-repair-nov1/security-failure-before-refresh.json',
 securityReady:'DiagnosticsLocal/security-readiness-repair-nov1/repaired-security-check.json'})){
 const r=await json(path);
 // Later diagnostics remain separately curated in prose; publish hashes and safe primitive result fields only.
 later[name]={path,...pick(r,['at','kind','firstHandoff','recoveredInFreshTab','paymentAutomated','freshTabRecovery','exactOrderSummaryValidated','qrImageVisibleAndLoaded','journalUnchanged','amount','court','date','start','end','holdExpiresAt']),
  results:Array.isArray(r.results)?r.results.map(x=>pick(x,['state','code','worker','strict'])):undefined};
}
const data={schema:'nov1-release-forensics/v1',runId,releaseMs,releaseUtc:'2026-11-01T00:00:00.000Z',releaseManila:'2026-11-01T08:00:00+08:00',targetDate:'2026-11-03',
 warning:'Historical evidence projection. UNKNOWN records are not rewritten. No active booking or future readiness is asserted. Private identifiers/tokens/contact/proofs omitted.',
 authorization:{...pick(freeze.authorization,['date','releaseMs','budgets','rescueEnabled','concurrentWave2','authorizedAt','fingerprint']),
  candidates:freeze.authorization.candidates.map(c=>pick(c,['id','logicalKey','court','start','end','durationHours','expectedAmount','priority','permissions'])),
  wave1:freeze.authorization.wave1,shotgun:freeze.shotgun,frozenAt:freeze.frozenAt},clock:summary.clock,stageCounts,
 events:progress.map(r=>pick(r,fields)),parents,children,
 observer:{source:observerPath??'.local/slot-watch/2026-11-03_311dea90-dbb3-4284-9520-be292e2673a3.ndjson',types:observerTypes,notLaunchedReasons,
  legacySummary:pick(summary.observer,['reads','bookingReads','publication','firstPublishedCounts','openToUnavailable','reopened']),
  warning:'Legacy reads.launched includes locally refused attempts; original observer records prove zero availability network launches. Public booking queries are supplemental.'},
 providerTrace:providerTrace.filter(r=>r.type!=='header').map(r=>({...pick(r,['type','workerId','attemptId','wave','method','path','status','contentType','server','responseReceivedMs','responseCompletedMs','complete']),
  nodeObserved:numeric(r.nodeObserved),browser:numeric(r.browser),response:numeric(r.response)})),
 recoveryStatus:recovery,replay:pick(replay,['at','mode','results']),hotfixes,later,
 sourceManifest:manifest.sort((a,b)=>a.path.localeCompare(b.path))};
// No blind copy of original raw bodies, cookie stores, URLs with credentials or private records.
const text=JSON.stringify(data,null,2)+'\n';
if(/checkoutToken|customer_email|customer_phone|cookie|Bearer\s+[A-Za-z0-9]/i.test(text))throw Error('PRIVATE_FIELD_IN_EXPORT');
await writeFile(output,text,{flag:'wx'});
console.log(JSON.stringify({output,children:children.length,sourceFiles:manifest.length,bytes:Buffer.byteLength(text)}));
