import assert from 'node:assert/strict';
import { authorizePrecision, classifyActionableObservation, precisionCandidateId, PrecisionSession,
  type CandidateInput, type PrecisionAuthorizationInput } from '../src/api-booking/precision-phase3.js';
import type { AvailabilityObservation } from '../src/slot-evidence.js';
import { ProviderTraceSet } from '../src/api-booking/checkout-provider-trace.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { buildReleaseForensics } from '../src/release-forensics.js';

/** Deterministic, offline state simulator. No browser, network, profile, journal or checkout is opened. */
const releaseMs=Date.parse('2026-09-24T00:00:00Z'),date='2026-09-26';
const candidate=(court:number,start:string,priority:number):CandidateInput=>({court,start,durationHours:3,priority,
  permissions:{wave1:true,wave2:true,rescue:true},rateEvidence:{source:'operator confirmed',capturedAt:'2026-09-23T12:00:00Z',
    status:'OPERATOR_CONFIRMED',date,perHour:[600,700,700],actionable:true}});
const draft=(candidates:CandidateInput[],concurrentWave2=true):PrecisionAuthorizationInput=>({date,releaseMs,candidates,
  wave1:[{workerId:'A',candidateId:precisionCandidateId(date,candidates[0]!)}],standby:['B','C'],
  budgets:{wave2:2,rescue:2,total:4},concurrentWave2,rescueEnabled:true,authorizedAt:'2026-09-23T12:00:00Z'});
const grid=(seq:number,states:Record<string,string>={},status='MISS',requestOffsetMs=1000,responseOffsetMs=requestOffsetMs+500,price=900):AvailabilityObservation=>{
  const rows=Array.from({length:7},(_,court)=>Array.from({length:16},(_,index)=>states[`${court+1}/${index+8}`]??'O'));
  return {seq,scheduledOffsetMs:requestOffsetMs,requestOffsetMs,responseOffsetMs,outcome:'ok',targetDatePresent:true,
    matrix:rows.map((row,index)=>`${index+1}:${row.join('')}`).join(','),prices:rows.map(()=>Array(16).fill(price)),cache:{status}};
};
const observe=(session:PrecisionSession,value:AvailabilityObservation,at=releaseMs+value.responseOffsetMs+1,maxAge=10000)=>{
  const evidence=classifyActionableObservation(value,value.seq,releaseMs,at,maxAge);session.observe(evidence);return evidence;
};
const firstAttempt=(session:PrecisionSession,state:'IN_FLIGHT'|'REJECTED'|'UNKNOWN'|'VERIFIED'='IN_FLIGHT')=>
  session.record({id:'wave1',candidateId:session.authorization.candidates[0]!.id,workerId:'A',wave:'WAVE_1',state});
const check=(name:string,run:()=>void)=>{run();process.stdout.write(`PASS ${name}\n`);};

check('A fresh open standby selects one Wave 2 candidate at current price',()=>{
  const session=new PrecisionSession(authorizePrecision(draft([candidate(1,'15:00',1),candidate(2,'16:00',2)])));
  firstAttempt(session);observe(session,grid(1,{'1/15':'X'}));
  const choices=session.select('WAVE_2',releaseMs+1600,10000);
  assert.equal(choices.length,1);assert.equal(choices[0]!.candidate.court,2);assert.deepEqual(choices[0]!.prices,[900,900,900]);
  assert.deepEqual(session.select('WAVE_2',releaseMs+1600,10000),[]);
});
check('B verified hold stops Wave 2',()=>{const s=new PrecisionSession(authorizePrecision(draft([candidate(1,'15:00',1),candidate(2,'16:00',2)])));
  firstAttempt(s,'VERIFIED');observe(s,grid(1));assert.deepEqual(s.select('WAVE_2',releaseMs+1600,10000),[]);});
check('C pending Wave 1 needs explicit concurrent authorization',()=>{const candidates=[candidate(1,'15:00',1),candidate(2,'16:00',2)];
  const denied=new PrecisionSession(authorizePrecision(draft(candidates,false)));firstAttempt(denied);observe(denied,grid(1));
  assert.deepEqual(denied.select('WAVE_2',releaseMs+1600,10000),[]);
  const allowed=new PrecisionSession(authorizePrecision(draft(candidates,true)));firstAttempt(allowed);observe(allowed,grid(1));
  assert.equal(allowed.select('WAVE_2',releaseMs+1600,10000).length,1);});
check('D UNKNOWN is a hard stop',()=>{const s=new PrecisionSession(authorizePrecision(draft([candidate(1,'15:00',1),candidate(2,'16:00',2)])));
  firstAttempt(s,'UNKNOWN');observe(s,grid(1));assert.deepEqual(s.select('WAVE_2',releaseMs+1600,10000),[]);
  assert.deepEqual(s.select('RESCUE',releaseMs+1600,10000),[]);assert.equal(s.status,'MANUAL_RECONCILIATION_REQUIRED');});
check('E strict unavailable then fresh OPEN allows one Rescue epoch',()=>{const s=new PrecisionSession(authorizePrecision(draft([candidate(1,'15:00',1)])));
  firstAttempt(s,'REJECTED');observe(s,grid(1,{'1/15':'X'},'MISS',1000,1500));observe(s,grid(2,{},'MISS',2000,2500));
  const choices=s.select('RESCUE',releaseMs+2600,10000);assert.equal(choices.length,1);assert.equal(choices[0]!.reopenEpoch,1);
  s.record({id:'rescue',candidateId:choices[0]!.candidate.id,workerId:'B',wave:'RESCUE',state:'REJECTED',reopenEpoch:1});
  assert.deepEqual(s.select('RESCUE',releaseMs+2700,10000),[]);});
check('F stale and L cached reopen do not rescue',()=>{for(const status of ['MISS','HIT']){
  const s=new PrecisionSession(authorizePrecision(draft([candidate(1,'15:00',1)])));firstAttempt(s,'REJECTED');
  observe(s,grid(1,{'1/15':'X'}));const open=grid(2,{},status,2000,2500);
  observe(s,open,status==='MISS'?releaseMs+20000:releaseMs+2600,10000);
  assert.deepEqual(s.select('RESCUE',status==='MISS'?releaseMs+20000:releaseMs+2600,10000),[]);}});
check('G partial range and I overlapping in-flight candidate are blocked',()=>{
  const c=[candidate(3,'15:00',1),candidate(3,'17:00',2)];const s=new PrecisionSession(authorizePrecision(draft(c)));firstAttempt(s);
  observe(s,grid(1,{'3/18':'X'}));assert.deepEqual(s.select('WAVE_2',releaseMs+1600,10000),[]);
  const overlap=new PrecisionSession(authorizePrecision(draft(c)));firstAttempt(overlap);observe(overlap,grid(1));
  assert.deepEqual(overlap.select('WAVE_2',releaseMs+1600,10000),[]);
});
check('H released price drift replaces the Wave 1 estimate',()=>{const s=new PrecisionSession(authorizePrecision(draft([candidate(1,'15:00',1),candidate(2,'16:00',2)])));
  firstAttempt(s);observe(s,grid(1,{},'MISS',1000,1500,950));
  assert.equal(s.authorization.candidates[1]!.expectedAmount,2000);
  assert.deepEqual(s.select('WAVE_2',releaseMs+1600,10000)[0]!.prices,[950,950,950]);});
check('J exhausted total budget blocks selection',()=>{const d=draft([candidate(1,'15:00',1),candidate(2,'16:00',2)]);d.budgets={wave2:1,rescue:0,total:1};d.rescueEnabled=false;
  const s=new PrecisionSession(authorizePrecision(d));firstAttempt(s,'REJECTED');observe(s,grid(1));
  assert.deepEqual(s.select('WAVE_2',releaseMs+1600,10000),[]);});
check('K cached OPEN is forensic only; M fresh MISS is actionable',()=>{
  const hit=classifyActionableObservation(grid(1,{},'HIT'),1,releaseMs,releaseMs+1600,10000);
  const miss=classifyActionableObservation(grid(1,{},'MISS'),1,releaseMs,releaseMs+1600,10000);
  assert.equal(hit.fitness,'FORENSIC_ONLY_CACHE_AGE_UNKNOWN');assert.equal(miss.fitness,'ACTIONABLE_FRESH');});
check('N late older response cannot replace newer actionable state',()=>{const s=new PrecisionSession(authorizePrecision(draft([candidate(1,'15:00',1),candidate(2,'16:00',2)])));
  firstAttempt(s);observe(s,grid(2,{'2/16':'X'},'MISS',2000,2500));
  const old=classifyActionableObservation(grid(1,{},'MISS',1000,3000),2,releaseMs,releaseMs+3100,10000);
  assert.equal(old.fitness,'FORENSIC_ONLY_OUTDATED_REQUEST');s.observe(old);assert.equal(s.latest?.observation.seq,2);
  assert.deepEqual(s.select('WAVE_2',releaseMs+3100,10000),[]);});
check('Q fast response fallback works without CDP',()=>{const trace=new ProviderTraceSet('offline','release',releaseMs,()=>0);
  trace.captureFallback({workerId:'A',attemptId:'offline',wave:'WAVE_1'},
    {status:409,contentType:'application/json',server:'fixture',cloudflareRay:'',responseReceivedMs:1,responseCompletedMs:2});
  assert.equal(trace.records().length,0);assert.equal(trace.fallbacks()[0]?.status,409);});
check('O/P one synthetic forensic report spans Wave 1, Wave 2 and Rescue',()=>{
  const runId='00000000-0000-4000-8000-000000000003',root=resolve('.local'),progressDir=join(root,'api-booking','run-progress'),
    reportDir=join(root,'release-forensics',runId),watchDir=join(root,'slot-watch');
  for(const dir of [progressDir,reportDir,watchDir])mkdirSync(dir,{recursive:true});
  const candidateId=precisionCandidateId(date,candidate(1,'15:00',1));
  const stages:Record<string,unknown>[]=[{runId,mode:'live',targetDate:date},
    {stage:'RUN_CONFIGURATION',releaseMs},{stage:'PHASE3_AUTHORIZATION',fingerprint:'a'.repeat(64),candidateCount:1,maxWave2:1,maxRescue:1,maxTotal:3},
    {stage:'PHASE3_CANDIDATE',candidateId,court:1,startTime:'15:00',endTime:'18:00'}];
  for(const [index,wave,worker] of [[0,'WAVE_1','A'],[1,'WAVE_2','B'],[2,'RESCUE','C']] as const){
    const attemptId=`synthetic-${wave.toLowerCase()}`,offset=1000+index*1000;
    stages.push({stage:wave==='WAVE_1'?'PHASE3_WAVE1_STARTED':'PHASE3_ATTEMPT_RESERVED',attemptId,candidateId,workerId:worker,wave,
      evidenceSeq:index||undefined},
      {stage:'CHECKOUT_HTTP_POST_INITIATED',attemptId,workerId:worker,releaseLatenessMs:offset,at:new Date(releaseMs+offset).toISOString()},
      {stage:'CHECKOUT_RESPONSE_COMPLETED',attemptId,workerId:worker,statusCode:409,at:new Date(releaseMs+offset+100).toISOString()},
      {stage:'PHASE3_SETTLED',attemptId,candidateId,workerId:worker,wave,state:'REJECTED'});
  }
  stages.push({stage:'PHASE3_OUTCOME',outcome:'ALL_REJECTED_WAITING_FOR_REOPEN'});
  const progressPath=join(progressDir,`${runId}.ndjson`);writeFileSync(progressPath,stages.map(value=>JSON.stringify(value)).join('\n')+'\n');
  const tracePath=join(reportDir,'provider-trace.ndjson');writeFileSync(tracePath,[{type:'header',version:2,runId,traces:[]},
    ...(['WAVE_1','WAVE_2','RESCUE'] as const).map((wave,index)=>({type:'response-fallback',workerId:['A','B','C'][index],
      attemptId:`synthetic-${wave.toLowerCase()}`,candidateId,wave,status:409,contentType:'application/json',server:'fixture',cfRay:null,
      vercelId:null,requestId:null,serverTiming:null,responseReceivedMs:10,responseCompletedMs:11}))]
    .map(value=>JSON.stringify(value)).join('\n')+'\n');
  const watchPath=join(watchDir,`${date}_synthetic-phase3.ndjson`);writeFileSync(watchPath,[
    {type:'header',version:2,id:'synthetic',date,releaseMs,clockOffsetMs:0,schedule:{availability:[1000,2000],maxInFlight:1}},
    {type:'availability',...grid(1,{'1/15':'X'},'MISS',1000,1500)},
    {type:'availability',...grid(2,{},'MISS',2000,2500)}].map(value=>JSON.stringify(value)).join('\n')+'\n');
  const report=buildReleaseForensics({runProgressPath:progressPath,observerLogPath:watchPath,providerTracePath:tracePath,
    outputDirectory:reportDir,status:'final',now:()=>releaseMs+10_000});
  assert.deepEqual(report.phase3?.attempts.map(value=>value.wave),['WAVE_1','WAVE_2','RESCUE']);
  assert.equal(report.phase3?.attempts.every(value=>value.fallback?.status===409),true);
  process.stdout.write(`Synthetic report: ${report.reportPath}\n`);
});
