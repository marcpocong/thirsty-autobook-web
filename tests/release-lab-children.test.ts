import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildReleaseLabSummary, releaseLabReport } from '../src/release-lab-analysis.js';
import { buildReleaseForensics } from '../src/release-forensics.js';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(fanout=true) {
  const root=mkdtempSync(join(tmpdir(),'release-lab-child-'));roots.push(root);
  const write=(path:string,value:unknown)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),typeof value==='string'?value:JSON.stringify(value));};
  const offsets=fanout?[[-2000,-1143,-286],[-1714,-857,0],[-1429,-571]]:[[0],[0],[0]],workers=['A','B','C'];
  const candidates=workers.map((worker,index)=>({id:`candidate-${worker}`,logicalKey:`logical-${worker}`,court:7-index,start:'19:00',end:'22:00',durationHours:3,expectedAmount:2100,permissions:{rescue:false}}));
  write('.local/api-booking/precision-races/run-phase3-freeze.json',{wave1Freeze:'freeze',authorization:{date:'2026-10-31',releaseMs:0,candidates,
    wave1:workers.map((workerId,i)=>({workerId,candidateId:candidates[i]!.id,...(fanout?{fanOutOffsetsMs:offsets[i]}:{releaseOffsetMs:0})}))}});
  let index=0;const paths:any[]=[],events:any[]=[{stage:'RUN_STARTED',runId:'run',targetDate:'2026-10-31'},
    {stage:'RUN_CONFIGURATION',releaseMs:0},{stage:'PHASE3_AUTHORIZATION',candidateCount:3},
    ...candidates.map((c,i)=>({stage:'PRECISION_TARGET',workerId:workers[i],court:c.court,startTime:c.start,endTime:c.end}))];
  const provider:any[]=[];
  for(const [i,workerId] of workers.entries())for(const [fanOutIndex,offset] of offsets[i]!.entries()){
    const n=++index,attemptId=`child-${n}`,unsent=fanout&&n===6,childKey=`key-${n}`;
    const identity={workerId,candidateId:candidates[i]!.id,attemptId,fanOutIndex,fanOutCount:offsets[i]!.length};
    events.push({...identity,stage:'PHASE3_FAN_OUT_CHILD',releaseOffsetMs:offset});
    if(!unsent){events.push({...identity,stage:'PHASE3_WAVE1_STARTED',wave:'WAVE_1'},{...identity,stage:'CHECKOUT_HTTP_POST_INITIATED',releaseLatenessMs:offset+200},
      {...identity,stage:'CHECKOUT_RESPONSE_COMPLETED',statusCode:n===1?409:200,networkDurationMs:n*100});
      provider.push({type:'response-fallback',attemptId,workerId,status:n===1?409:200,vercelId:null});}
    events.push({...identity,stage:'PHASE3_SETTLED',state:unsent?'NOT_DISPATCHED':n===1?'REJECTED':'UNKNOWN',code:unsent?'SHOTGUN_TARGET_OUTCOME_UNKNOWN':'RECORDED'});
    paths.push({schema:'critical-path/v1',workerId:childKey,schedulerFiredMs:offset+.01,workerInvokedMs:unsent?null:offset+1,
      fetchInvokedMs:unsent?null:{ms:offset+3,lowMs:offset+2,highMs:offset+4},browserRequestStartMs:unsent?null:offset+200,
      requestObservedMs:unsent?null:offset+201,responseCompleteMs:unsent?null:{ms:n*10,lowMs:n*10-1,highMs:n*10+1},
      responseObservedMs:unsent?null:1000+n,calibration:{uncertaintyMs:1},
      meta:{workerId,parentGoalId:candidates[i]!.id,fanOutIndex,finalState:unsent?'NOT_DISPATCHED':n===1?'REJECTED':'UNKNOWN'}});
    write(`.local/api-booking/api-first-journals/logical-${workerId}/fan-out/freeze/${childKey}/logical-${workerId}.json`,{state:unsent||n===1?'rejected':'unknown'});
  }
  // A slow older sibling answers last. The latest-sent target view must still show child 3's response.
  if(fanout)events.push({workerId:'A',candidateId:candidates[0]!.id,attemptId:'child-1',stage:'CHECKOUT_RESPONSE_COMPLETED',statusCode:409,networkDurationMs:100});
  const progress='.local/api-booking/run-progress/run.ndjson',critical='.local/release-forensics/run/critical-path.ndjson';
  write(progress,events.map(e=>JSON.stringify(e)).join('\n'));write(critical,paths.map(e=>JSON.stringify(e)).join('\n'));
  write('.local/release-forensics/run/provider-trace.ndjson',provider.map(e=>JSON.stringify(e)).join('\n'));
  const forensics=buildReleaseForensics({runProgressPath:join(root,progress),criticalPathPath:join(root,critical),outputDirectory:join(root,'derived'),status:'final'});
  const build=()=>buildReleaseLabSummary({root,runId:'run',forensics,availability:[],bookings:[]})!;
  return {build,paths,write,critical,forensics};
}
describe('Release Lab child identity joins',()=>{
  it('reconstructs all eight exact offsets with seven sends and an unsent child, never mixing worker siblings',()=>{
    const f=fixture(),s=f.build();expect(s.attempts).toHaveLength(8);
    expect(s.attempts.map(a=>a.configuredReleaseOffsetMs)).toEqual([-2000,-1143,-286,-1714,-857,0,-1429,-571]);
    expect(s.attempts.filter(a=>a.sent)).toHaveLength(7);
    const b=s.attempts[5]!;expect(b).toMatchObject({attemptId:'child-6',result:'NOT_DISPATCHED',httpStatus:null,fetchInvokedMs:null,networkDurationMs:null,sent:false,journalState:'rejected'});
    expect(s.attempts[1]).toMatchObject({attemptId:'child-2',httpStatus:200,networkDurationMs:200,responseCompleteMs:{ms:20},responseObservedMs:1002});
    expect(s.byDuration[0]).toMatchObject({attemptCount:8,sentCount:7,unsentCount:1,unknownOutcomes:6,rejections:1});
    expect(f.forensics.phase3!.attempts).toHaveLength(8);
    expect(f.forensics.targets[0]).toMatchObject({attemptId:'child-3',finalState:'UNKNOWN',response:{statusCode:200,networkDurationMs:300,completedOffsetMs:30}});
    const report=releaseLabReport(s);expect(report).toContain('8 authorized children, 7 observed sent, 1 proven unsent, 3 logical workers');
    expect(report).toContain('SHOTGUN_TARGET_OUTCOME_UNKNOWN');expect(report).not.toMatch(/\$\{|\{\{\w+\}\}/);
  });
  it('leaves missing or ambiguous child telemetry unavailable',()=>{
    const f=fixture();f.paths.splice(1,1);f.paths.push({...f.paths[0]});f.write(f.critical,f.paths.map(p=>JSON.stringify(p)).join('\n'));
    const s=f.build();expect(s.attempts[0]!.fetchInvokedMs).toBeNull();expect(s.attempts[1]!.browserRequestStartOffsetMs).toBeNull();
    expect(s.attempts[1]!.networkDurationMs).toBe(200);
  });
  it('retains one-child non-fan-out runs',()=>{const s=fixture(false).build();expect(s.attempts).toHaveLength(3);
    expect(s.byOffset[0]).toMatchObject({key:0,attemptCount:3,sentCount:3});});
  it('never treats an unrecognized state containing VERIFIED as a verified hold',()=>{
    const f=fixture();f.paths[0].meta.finalState='UNVERIFIED';f.write(f.critical,f.paths.map(p=>JSON.stringify(p)).join('\n'));
    expect(f.build().attempts[0]).toMatchObject({result:'UNKNOWN',verifiedHold:false});
  });
});
