/** Incident-specific, offline, allowlisted November 2 release export.
 * Usage: node scripts/forensics/export-nov2-evidence.mjs <installation-root> <NEW-output.json>
 * No browser/booking imports, network, recovery, journal writes, or request replay.
 */
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join,basename,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
if(process.argv.length!==4)throw Error('EXPECTED_INSTALLATION_ROOT_AND_NEW_OUTPUT');
const root=resolve(process.argv[2]),output=resolve(process.argv[3]);
const runId='47f4b850-2caa-4d63-923e-e20e6efefd80',releaseMs=1793577600000;
const watch='2026-11-04_7e5a2a5f-7caa-4e8c-bdef-d82b6a5e9237',sources=new Map(),privateValues=new Set();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const slash=path=>path.replaceAll('\\','/');
const pick=(row,keys)=>Object.fromEntries(keys.filter(k=>row?.[k]!==undefined).map(k=>[k,row[k]]));
const numeric=row=>Object.fromEntries(Object.entries(row??{}).filter(([,v])=>v===null||typeof v==='number'||typeof v==='boolean'));
async function read(path){const bytes=await readFile(join(root,path));sources.set(slash(path),{path:slash(path),bytes:bytes.length,sha256:hash(bytes)});return bytes.toString('utf8');}
const json=async path=>JSON.parse(await read(path));
const lines=async path=>(await read(path)).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const f=await json(`.local/api-booking/precision-races/${runId}-phase3-freeze.json`);
const progress=await lines(`.local/api-booking/run-progress/${runId}.ndjson`);
const critical=await lines(`.local/release-forensics/${runId}/critical-path.ndjson`);
const provider=await lines(`.local/release-forensics/${runId}/provider-trace.ndjson`);
const original=await json(`.local/release-forensics/${runId}/summary.json`);
await read(`.local/release-forensics/${runId}/report.txt`);
const corrected=await json('DiagnosticsLocal/hold-classification-fix-nov2/reclassified-run/summary.json');
await read('DiagnosticsLocal/hold-classification-fix-nov2/reclassified-run/report.txt');
const manual=await json('DiagnosticsLocal/live-checkout-recovery-nov2-0804/installed-context/results.json');
const manualPreservation=await json('DiagnosticsLocal/live-checkout-recovery-nov2-0804/installed-context/preservation.json');
const observer=await lines(`.local/slot-watch/${watch}.ndjson`);
const watchSummary=await json(`.local/slot-watch/${watch}.summary.json`);
const watchQuality=await json(`.local/slot-watch/${watch}.quality.json`);
const eventFields=['stage','at','eventAt','timingKind','elapsedMs','sincePreviousMs','workerId','attemptId','candidateId','wave','court','startTime','endTime','amount',
 'fanOutIndex','fanOutCount','shotIndex','shotCount','configuredOffsetMs','releaseOffsetMs','releaseLatenessMs','state','code','statusCode','dispatchState',
 'durationMs','networkDurationMs','responseBytes','prewarmLeadMs','workerCount','sampleCount','offsetMs','roundTripMs','spreadMs','uncertaintyMs',
 'checkpoint','deltaMs','plannedLeadMs','actualLeadMs','lateByMs','predictedReadyOffsetMs','actualReadyOffsetMs','predictionErrorMs','queueDelayMs','prepDurationMs',
 'attemptCount','sentCount','settledCount','pendingCount','unsentCount','unknownCount','rejectedCount','verifiedCount','authorizedCount','preparedCount','outcome',
 'verifiedHoldCount','qrHandoffCount','partialHolds','aborted','retryCount','finalCode','coreElapsedMs','exitCode','bookingMethod','scope','mango','buko','releaseMs'];
const clockPoint=r=>r===null||r===undefined?r:numeric(r);
const timingFields=['schedulerFiredMs','workerInvokedMs','transportEnteredMs','prePostMs','rendererArmSentMs','rendererArmedMs','evaluateEnteredMs',
 'fetchInvokedMs','browserRequestStartMs','requestObservedMs','responseHeadersMs','responseCompleteMs','responseObservedMs'];
function criticalProjection(c){return {...pick(c,timingFields),dispatchMode:c.dispatchMode,calibration:numeric(c.calibration),segments:numeric(c.segments),
 resourceTiming:c.resourceTiming?{source:c.resourceTiming.source,protocol:c.resourceTiming.protocol,...Object.fromEntries(Object.entries(c.resourceTiming).filter(([k])=>k.endsWith('Ms')).map(([k,v])=>[k,clockPoint(v)]))}:null,
 meta:pick(c.meta,['attemptId','workerId','fanOutIndex','fanOutCount','shotIndex','shotCount','configuredOffsetMs','prewarmReadyMs','httpStatus','finalState','finalCode'])};}
function rememberPrivate(record){
 function walk(v,key=''){if(v&&typeof v==='object'){for(const [k,x] of Object.entries(v))walk(x,k);}
  else if(typeof v==='string'&&v.length>=8&&/^(?:id|booking_no|customer_id|booking_session_id|checkoutToken|bookingSessionId|requestSessionRef|reference|identityBinding)$/.test(key))privateValues.add(v);}
 walk(record);
}
const children=[],parents=[],allBookingIds=[],bindings=new Map();
for(const candidate of f.authorization.candidates){
 const base=`.local/api-booking/api-first-journals/${candidate.logicalKey}`;
 const names=(await readdir(join(root,base),{recursive:true})).filter(n=>/^[a-f0-9]{64}\.json$/.test(basename(n))).sort();
 for(const name of names){
  const path=slash(`${base}/${name}`),j=await json(path),child=slash(name).includes('fan-out/');
  const record={source:path,court:candidate.court,...pick(j,['key','state','createdAt','updatedAt','failureCode']),
   attempt:pick(j.attempt,['attemptId','planFingerprint','targetDate','courtIds','hourlyBoundaries','expectedBookingCount','maximumAmount','stage','releaseMs','dispatchDeadlineMs','dispatchTimingPolicy','triggerMs','shotDeadlineMs'])};
  if(!child){parents.push(record);continue;}
  const c=critical.find(r=>r.workerId===j.attempt.attemptId);
  assert.ok(c?.meta?.attemptId,'missing exact child critical-path identity');
  const events=progress.filter(r=>r.attemptId===c.meta.attemptId);
  const post=events.filter(r=>r.stage==='CHECKOUT_HTTP_POST_INITIATED'),response=events.filter(r=>r.stage==='CHECKOUT_RESPONSE_COMPLETED'),settled=events.filter(r=>r.stage==='PHASE3_SETTLED');
  assert.equal(settled.length,1);assert.ok(post.length<=1&&response.length<=1);
  record.id=c.meta.attemptId;record.worker=c.meta.workerId;record.configuredOffsetMs=c.meta.configuredOffsetMs;
  record.criticalPath=criticalProjection(c);record.post=post[0]?pick(post[0],eventFields):null;record.responseEvent=response[0]?pick(response[0],eventFields):null;
  record.originalSettlement=pick(settled[0],eventFields);record.reviewState=c.meta.httpStatus===200?'UNKNOWN':c.meta.httpStatus===400?'REJECTED':'NOT_DISPATCHED';
  if(c.meta.httpStatus===200){
   const capturePath=slash(join(dirname(path),'checkout-recovery-private.json')),capture=await json(capturePath),raw=capture.response;
   rememberPrivate(capture);allBookingIds.push(...raw.bookings.map(b=>b.id));
   const binding=bindings.get(capture.workerId)??new Set();binding.add(capture.identityBinding);bindings.set(capture.workerId,binding);
   const recoveryId=hash(slash(relative(join(root,'.local/api-booking/api-first-journals'),join(root,dirname(path)))));
   const observed=manual.find(m=>m.id===recoveryId);assert.ok(observed,'missing same-capture manual recovery');
   const states=[];
   const verificationDir=slash(join(dirname(path),'hold-verification'));
   for(const name of (await readdir(join(root,verificationDir))).filter(n=>/^\d+\.json$/.test(n)).sort()){
    const v=await json(`${verificationDir}/${name}`);assert.equal(v.responseHash,hash(await readFile(join(root,capturePath))),'verification/capture hash mismatch');
    states.push({...pick(v,['at','local','provider','qr','code','contradiction','responseHash']),milestones:(v.milestones??[]).map(m=>pick(m,['event','at','clockDomain','durationMs','durationDomain','httpStatus','operation']))});
   }
   record.capture={source:capturePath,sha256:hash(await readFile(join(root,capturePath))),capturedAt:capture.capturedAt,worker:capture.workerId,identityBindingPresent:!!capture.identityBinding,
    responseSuccess:raw.success,bookingCount:raw.bookings.length,uniqueBookingIds:new Set(raw.bookings.map(b=>b.id)).size,sessionCount:raw.bookingSessions.length,
    bookings:raw.bookings.map(b=>pick(b,['date','start_time','end_time','duration','rate','booking_status','payment_status','hold_expires_at'])),
    sessions:raw.bookingSessions.map(s=>({...pick(s,['date','startTime','endTime','durationHours']),bookingCount:s.bookingIds.length})),
    transaction:pick(raw.transaction,['amount','status']),trustedTotalAmount:raw.trustedTotalAmount,
    advertisedExpiry:raw.bookings.map(b=>b.hold_expires_at).sort()[0]};
   record.verificationHistory=states;
   record.manualRecovery={...pick(observed,['at','worker','courts','code','provider','qr','httpStatus','contradiction']),milestones:observed.milestones.map(m=>pick(m,['event','at','clockDomain','durationMs','durationDomain','httpStatus','operation']))};
   const lookup=record.manualRecovery.milestones.find(m=>m.event==='PROVIDER_RESULT');
   record.manualRecovery.secondsBeforeAdvertisedExpiry=Math.round((Date.parse(record.capture.advertisedExpiry)-Date.parse(lookup.at))/10)/100;
   assert.equal(observed.httpStatus,404);assert.equal(observed.provider,'UNKNOWN');assert.ok(record.manualRecovery.secondsBeforeAdvertisedExpiry>170);
   assert.equal(raw.bookings.length,3);assert.equal(raw.bookingSessions.length,3);assert.equal(raw.trustedTotalAmount,2100);
  }
  children.push(record);
 }
}
children.sort((a,b)=>a.configuredOffsetMs-b.configuredOffsetMs);
assert.equal(children.length,8);assert.equal(children.filter(c=>c.post).length,7);assert.equal(children.filter(c=>c.capture).length,5);
assert.equal(children.filter(c=>c.state==='verified').length,5);assert.equal(children.filter(c=>c.state==='rejected').length,3);
assert.equal(allBookingIds.length,15);assert.equal(new Set(allBookingIds).size,15);assert.equal(progress.length,190);
assert.equal(progress.filter(r=>r.stage==='PROVIDER_HOLD_CONFIRMED').length,0);
const observedTypes={};for(const r of observer)observedTypes[r.type]=(observedTypes[r.type]??0)+1;
const traces=provider.filter(r=>r.type==='provider-trace').map(r=>({type:r.type,...pick(r,['attemptId','workerId','method','complete']),
 nodeObserved:numeric(r.nodeObserved),browser:numeric(r.browser),connection:{...numeric(r.connection),protocol:r.connection?.protocol??null},response:pick(r.response,['status','contentType','server','vercelCache','ageS','serverTiming','encodedBytes'])}));
const fallbacks=provider.filter(r=>r.type==='response-fallback').map(r=>{
 const fields=r.evidence?.body?.fields;
 if(fields)assert.equal(fields.error,'This booking date is not available yet.');
 return {...pick(r,['attemptId','workerId','status','contentType','server','responseReceivedMs','responseCompletedMs']),
  error:fields?{success:fields.success,message:fields.error,bodyBytes:r.evidence.body.byteLength,shapeFingerprint:r.evidence.body.shapeFingerprint}:null};
});
const fixes=[];
for(const [name,base] of [['first','DiagnosticsLocal/hold-classification-fix-nov2'],['final','DiagnosticsLocal/hold-classification-fix-nov2/corrective-update']]){
 const v=await json(`${base}/installation-verification.json`);await read(`${base}/ci.log`);await read(`${base}/local-broad.log`);await read(`${base}/local-isolated.log`);await read(`${base}/local-isolated.json`);
 await read(`${base}/typecheck.log`);await read(`${base}/source-dist-verification.log`);await read(`${base}/installed-dist-verification.log`);await read(`${base}/installation.log`);
 const a=await json(`${base}/authorization.json`);const completed=await json(`${base}/completed.json`);
 fixes.push({name,...pick(v,['at','gitSha','buildId','contentId','canonical','managedIntegrity','managedPaths','protectedFilesUnchanged','configUnchanged','privateUnchanged','validation','ci','maintenanceWaivers','providerOutcomesUnchanged']),
  maintenance:{authorizedAt:a.at,expiresAt:a.expiresAt,sourceSha:a.sourceSha,exactParentExceptions:a.parents.map(p=>({path:p.path,sha256:p.sha256,court:p.court,worker:p.worker,captureCount:p.captures.length,childJournalCount:p.journals.length})),exceptionConsumed:completed.exceptionConsumed}});
}
const final=await json('DiagnosticsLocal/hold-classification-fix-nov2/final-verification.json');
const native=await json('DiagnosticsLocal/hold-classification-fix-nov2/native-ui-verification.json');
const installedOffline=await json('DiagnosticsLocal/hold-classification-fix-nov2/installed-offline-verification.json');
const preserve=await json('DiagnosticsLocal/hold-classification-fix-nov2/preservation-before.json');
const previous=await json('DiagnosticsLocal/ui-overhaul-nov2/corrective-update/installation-verification.json');
const nativeInitialFailure=await read('DiagnosticsLocal/hold-classification-fix-nov2/local-isolated-initial-failure.log');
await read('DiagnosticsLocal/hold-classification-fix-nov2/native-case-rerun.log');
await read('DiagnosticsLocal/hold-classification-fix-nov2/first-installed/runtime-log-verification.json');
await read('DiagnosticsLocal/auth-recovery-fix-nov2/REPORT.md');
const lock=await json('.local/automation.lock');
const stageCounts={};for(const r of progress)stageCounts[r.stage]=(stageCounts[r.stage]??0)+1;
const data={schema:'nov2-release-forensics/v1',runId,releaseMs,releaseUtc:'2026-11-02T00:00:00.000Z',releaseManila:'2026-11-02T08:00:00+08:00',targetDate:'2026-11-04',
 scope:'Historical incident evidence and subsequent fixes. Original journal states retained; reviewer outcomes are separate. No provider request or booking replay.',
 accounting:{authorized:8,prepared:7,checkoutPosts:7,http200:5,http400:2,provenUnsent:1,apparentGroups:5,apparentHourlyBookings:15,distinctCapturedBookingIds:15,independentlyConfirmedHolds:0,qrHandoffs:0,
  originalOutcome:original.outcome,reviewOutcome:corrected.outcome,rawJournalStates:{verified:5,rejected:3},reviewStates:{UNKNOWN:5,REJECTED:2,NOT_DISPATCHED:1}},
 authorization:{...pick(f.authorization,['date','releaseMs','budgets','rescueEnabled','concurrentWave2','authorizedAt','fingerprint']),frozenAt:f.frozenAt,wave1Freeze:f.wave1Freeze,
  quota:pick(progress.find(r=>r.stage==='PHASE3_OBJECTIVE_QUOTA'),['scope','mango','buko']),
  candidates:f.authorization.candidates.map(c=>({...pick(c,['id','logicalKey','court','start','end','durationHours','expectedAmount','priority','permissions']),rateEvidence:pick(c.rateEvidence,['source','capturedAt','status','date','perHour','actionable'])})),
  wave1:f.authorization.wave1,shotgun:pick(f.shotgun,['enabled','budget','allocationMode','counts','windowStartMs','windowEndMs','timingMode','timingCapacityOverride','allowStandbyConsumption','exactSchedule'])},
 clock:original.clock,criticalHeader:{...pick(critical[0],['schema','type','releaseMs','wallToTrustedMs','runId','targetDate','mode','generatedAt','runtimeKey'])},
 stageCounts,events:progress.map((r,i)=>({line:i+1,...pick(r,eventFields)})),parents,children,
 identityProjection:{workers:[...bindings].map(([worker,values])=>({worker,distinctCapturedBindings:values.size,bindingPresent:!values.has(undefined)})),crossWorkerBindingsDistinct:new Set([...bindings.values()].flatMap(v=>[...v])).size===bindings.size},
 observer:{source:`.local/slot-watch/${watch}.ndjson`,rawLineCount:observer.length,types:observedTypes,...pick(watchSummary,['date','releaseMs','startedAt','endedAt','status','reason','clockOffsetMs','clockSynced','schedule','availability','bookings','publication','firstPublishedCounts','openToUnavailable','unavailableAtFirstPublication','reopened','stillOpen']),
  candidates:watchSummary.candidates.map(c=>pick(c,['court','start','end','workerId','state','evidence','evidenceAgeUpperBoundMs','freshness','reopening'])),
  quality:{latency:watchQuality.quality.latency,openingCycles:watchQuality.quality.openingCycles,cache:watchQuality.quality.cache,cacheRates:watchQuality.quality.cacheRates,contradictions:watchQuality.quality.contradictions,reopenings:watchQuality.quality.reopenings,bookingCoverage:watchQuality.quality.bookingCoverage,expiryPredictions:watchQuality.quality.expiryPredictions},
  timeline:watchSummary.timeline.map(t=>pick(t,['kind','court','hour','from','to','openCount','unavailableCount','unknownCount','before','after','overlapping']))},
 provider:{traces,fallbacks},manualRecoveryPreservation:pick(manualPreservation,['originalJournalAndCaptureFilesUnchanged','results']),
 review:{...pick(corrected,['generatedAt','outcome','recordedOutcome','limitations']),targets:corrected.targets.map(t=>({...pick(t,['workerId','court','startTime','endTime','attemptId','finalState','recordedFinalState','finalCode']),grid:pick(t.grid,['firstPublished','firstFullyOpen','firstUnavailable','firstRecord','reopen','latest'])}))},
 installationAtIncident:pick(previous,['at','gitSha','buildId','contentId','canonical','managedIntegrity']),fixes,
 qualification:{final:{...pick(final,['at','gitSha','buildId','refs','codeIntegrity','backendMatchesQualifiedInstalled4d1834e','dependencyTree','runtimeLog','protectedFilesUnchanged','configUnchanged','privateUnchanged','additionalBookingPosts','payments','cancellations','armingActions'])},native,
  installedOffline:pick(installedOffline,['at','productionModules','results']),initialNativeFailure:{case:'BROWSER_CLOSED',code:'0xC0000409',decimal:3221226505,logContainsCode:nativeInitialFailure.includes('3221226505'),causeProven:false}},
 preservation:{baselineAt:preserve.at,protectedFiles:preserve.protectedState.count,lifecycleDigest:preserve.protectedState.digest,configurationDigest:preserve.config,privateStateDigest:preserve.privateDigest,
  retainedLock:pick(lock,['stage','stageAt','holdExpiresAt','releaseAt','dispatchDeadlineAt'])},
 sourceManifest:[...sources.values()].sort((a,b)=>a.path.localeCompare(b.path))};
const text=JSON.stringify(data,null,2)+'\n';
if(/"(?:checkoutToken|customer_id|customer_email|customer_phone|booking_no|booking_session_id|identityBinding)"\s*:/.test(text)||/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text))throw Error('PRIVATE_FIELD_IN_EXPORT');
for(const value of privateValues)if(text.includes(value))throw Error('PRIVATE_VALUE_IN_EXPORT');
for(const s of sources.values())assert.equal(hash(await readFile(join(root,s.path))),s.sha256,`original changed during export: ${s.path}`);
await writeFile(output,text,{flag:'wx'});
console.log(JSON.stringify({output,children:children.length,sourceFiles:sources.size,privateValuesChecked:privateValues.size,bytes:Buffer.byteLength(text),sha256:hash(text),originalsUnchanged:true}));
