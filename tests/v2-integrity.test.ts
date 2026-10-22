import { describe,expect,it } from 'vitest';
import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AvailabilityReadPolicy } from '../src/api-booking/availability-read-policy.js';
import { LiveAvailabilityError } from '../src/api-booking/live-availability-provider.js';
import { readPreReleaseEvidence } from '../src/api-booking/pre-release-evidence.js';
import { SlotWatch } from '../src/slot-watch.js';
import { compileObjective,defaultObjective,withStrategy } from '../src/booking-objective.js';
import { readPossibleHolds } from '../src/api-booking/possible-hold.js';
import { buildReleaseForensics } from '../src/release-forensics.js';
import { buildReleaseLabSummary } from '../src/release-lab-analysis.js';

describe('V2 availability and settlement integrity',()=>{
  it('retries transient failures only after bounded backoff, recovers on success, and respects refusal',()=>{
    let now=0;const p=new AvailabilityReadPolicy(()=>now);
    p.beforeRead();p.failure(new LiveAvailabilityError('AVAILABILITY_HTTP_FAILED',503,true));
    expect(()=>p.beforeRead()).toThrow('AVAILABILITY_BACKOFF');now=1000;p.beforeRead();p.success();p.beforeRead();
    p.failure(new LiveAvailabilityError('AVAILABILITY_HTTP_FAILED',403,true));now+=100_000;
    expect(()=>p.beforeRead()).toThrow('AVAILABILITY_PROVIDER_REFUSED');
    try{p.beforeRead();}catch(error){expect(error).toMatchObject({requestSent:false});}
  });
  it('honors Retry-After and exhausts the finite retry budget',()=>{
    let now=0;const p=new AvailabilityReadPolicy(()=>now);
    p.failure(new LiveAvailabilityError('AVAILABILITY_RATE_LIMITED',429,true,120_000));now=30_000;
    expect(()=>p.beforeRead()).toThrow('AVAILABILITY_BACKOFF');now=120_000;p.beforeRead();
    p.failure(new LiveAvailabilityError('AVAILABILITY_READ_TIMEOUT'));now+=2000;p.beforeRead();
    p.failure(new LiveAvailabilityError('AVAILABILITY_TRANSPORT_FAILED'));
    expect(()=>p.beforeRead()).toThrow('AVAILABILITY_RETRY_BUDGET_EXHAUSTED');
  });
  it.each([401,403,429])('does not repeat a pre-release HTTP %s refusal',async(status)=>{
    let reads=0,sleeps=0;
    const result=await readPreReleaseEvidence({date:'2026-10-24',releaseMs:10,now:()=>0,sleep:async()=>{sleeps++;},
      readAvailability:async()=>{reads++;throw new LiveAvailabilityError('AVAILABILITY_HTTP_FAILED',status,true);},readBookings:async()=>({blocks:[],failedCourts:[]})});
    expect(result.availabilityAttempts).toBe(1);expect(reads).toBe(1);expect(sleeps).toBe(0);expect(result.snapshot).toBeUndefined();
  });
  it('counts a sent HTTP failure once and locally blocked reads as NOT SENT',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'v2-watch-'));
    try{
      const policy=new AvailabilityReadPolicy();let sent=0;
      const watch=new SlotWatch({date:'2026-10-24',releaseMs:Date.now()+10,directory,schedule:{availability:[0,15,30],bookings:[]},
        readAvailability:async()=>{policy.beforeRead();sent++;const error=new LiveAvailabilityError('AVAILABILITY_HTTP_FAILED',403,true);policy.failure(error);throw error;}});
      const summary=await watch.done;
      expect(sent).toBe(1);expect(summary.availability).toMatchObject({launched:1,failed:1,notLaunched:2,answered:0});
      const log=await readFile(summary.logPath,'utf8');expect(log).toContain('AVAILABILITY_PROVIDER_REFUSED');expect(log).toContain('"httpStatus":403');
    }finally{await rm(directory,{recursive:true,force:true});}
  });
  function objective(){const o=withStrategy(defaultObjective(Date.parse('2026-10-21T01:00:00Z'),'NEXT_RELEASE'),'SHOTGUN');
    o.wings.BUKO.enabled=false;o.wings.MANGO={...o.wings.MANGO,bookingDate:'2026-10-24',minimum:2,ideal:2,durationHours:3,startTimes:['19:00'],courts:[{court:7,priority:1},{court:6,priority:2},{court:5,priority:3}]};
    o.shotgun={...o.shotgun,budget:4,timingMode:'BALANCED'};return o;}
  it('uses a permitted alternative for known Court 6 conflict without rewriting the objective',()=>{
    const o=objective(),before=JSON.stringify(o),ctx={nowMs:Date.parse('2026-10-21T01:00:00Z'),unavailableWorkers:new Set(['C','D','E','F','G'])};
    expect(compileObjective(o,ctx).cohorts[0]!.immediate.map(t=>t.court)).toEqual([7,6]);
    const c=compileObjective(o,{...ctx,blockedCells:new Set(['MANGO:6:20:00'])});
    expect(c.cohorts[0]!.immediate.map(t=>t.court)).toEqual([7,5]);expect(JSON.stringify(o)).toBe(before);
    expect(c.warnings.join(' ')).toContain('fresh availability reports a conflict');
  });
  it('keeps mandatory conflicts blocked instead of substituting them',()=>{
    const o=objective();o.wings.MANGO.courts[1]!.mandatory=true;
    const c=compileObjective(o,{nowMs:Date.parse('2026-10-21T01:00:00Z'),blockedCells:new Set(['MANGO:6:19:00'])});
    expect(c.problems.join(' ')).toContain('mandatory Court 6');
  });
  it('restores possible-hold evidence after restart and never calls an elapsed deadline authoritative expiry',async()=>{
    const root=await mkdtemp(join(tmpdir(),'v2-possible-')),key='a'.repeat(64),dir=join(root,'.local/api-booking/api-first-journals',key);
    try{
      await mkdir(dir,{recursive:true});const file=join(dir,`${key}.json`);
      const record={key,state:'unknown',attempt:{targetDate:'2026-10-24',courtIds:[7],hourlyBoundaries:[{startTime:'19:00',endTime:'22:00'}]},
        observedResponse:{success:true,bookingIds:['synthetic-booking'],bookingNumbers:['SYNTHETIC-NUMBER'],holdExpiresAt:['2026-10-22T00:10:02Z'],transactionAmount:2100},failureCode:'CHECKOUT_RESPONSE_INVALID'};
      await writeFile(file,JSON.stringify(record));const before=await readFile(file,'utf8');
      expect(await readPossibleHolds(root)).toMatchObject([{date:'2026-10-24',amount:2100,code:'CHECKOUT_RESPONSE_INVALID'}]);
      expect(await readFile(file,'utf8')).toBe(before);
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('joins Phase 3 settlement, literal -210 offset and hashed critical worker identity',async()=>{
    const root=await mkdtemp(join(tmpdir(),'v2-forensics-')),runId='synthetic-run',out=join(root,'.local/release-forensics',runId),race=join(root,'.local/api-booking/precision-races');
    try{
      await mkdir(out,{recursive:true});await mkdir(race,{recursive:true});
      const progress=join(root,'progress.ndjson'),candidate={id:'candidate',court:6,start:'19:00',end:'22:00',durationHours:3,expectedAmount:2100,permissions:{rescue:false}};
      await writeFile(progress,[{runId,mode:'live',targetDate:'2026-10-24',stage:'RUN_CONFIGURATION',releaseMs:1000},
        {stage:'DIAGNOSTIC_ATTEMPT_ARMED',workerId:'B',court:6,startTime:'19:00',durationHours:3},
        {stage:'PHASE3_SETTLED',workerId:'B',state:'REJECTED',code:'ONDA_HTTP_STATUS_INVALID'}].map(r=>JSON.stringify(r)).join('\n'));
      await writeFile(join(race,`${runId}-phase3-freeze.json`),JSON.stringify({authorization:{date:'2026-10-24',releaseMs:1000,candidates:[candidate],wave1:[{workerId:'B',candidateId:'candidate',releaseOffsetMs:-210}]}}));
      await writeFile(join(out,'critical-path.ndjson'),JSON.stringify({schema:'critical-path/v1',workerId:'hashed-transport',meta:{workerId:'B'},browserRequestStartMs:163,requestObservedMs:164,workerInvokedMs:-209}));
      const forensic=buildReleaseForensics({runProgressPath:progress,outputDirectory:out,status:'final'});
      expect(forensic.targets[0]!.finalState).toBe('REJECTED');
      const lab=buildReleaseLabSummary({root,runId,forensics:forensic,availability:[],bookings:[]});
      expect(lab!.attempts[0]).toMatchObject({configuredReleaseOffsetMs:-210,result:'REJECTED',browserRequestStartOffsetMs:163});
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
