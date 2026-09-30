import {describe,expect,it} from 'vitest';
import {applyLiveAnchor,calibrateLiveAnchor,liveTimingSamples,type LiveTimingSample} from '../src/live-anchor-calibration.js';
import {fanOutTimingPlan} from '../src/fanout-timing.js';
import {applyTimingDeskew,calibrateTimingDeskew,TIMING_DESKEW_CAP_MS} from '../src/timing-deskew.js';
import {RELEASE_OFFSET_MIN_MS} from '../src/release-offset.js';

const now=Date.parse('2026-09-30T00:00:00Z');
const identity={dispatchMode:'node',fanOutWidth:2};
/** `local` is invocation -> Chrome; `queue` is the wait behind earlier children in the central dispatcher. */
const sample=(runId:string,workerId:string,fanOutIndex:number,local:number,extra:Partial<LiveTimingSample>&{queue?:number}={}):LiveTimingSample=>{
  const {queue=0,...rest}=extra,configured=fanOutIndex?0:-10;
  return {runId,releaseMs:now,configuredOffsetMs:configured,observedChromeStartMs:configured+queue+local,triggerToChromeLagMs:queue+local,invokeToChromeLagMs:local,
    workerId,fanOutIndex,fanOutCount:2,dispatchMode:'node',origin:'REAL_RELEASE',trustedClockValid:true,dispatched:true,recordedAt:'2026-09-29T00:00:00Z',...rest};
};
const releases=(runs:string[],row:(run:string)=>LiveTimingSample[])=>runs.flatMap(row);
const calibrate=(samples:LiveTimingSample[],id:Parameters<typeof calibrateTimingDeskew>[2]=identity)=>
  calibrateTimingDeskew(samples,calibrateLiveAnchor(samples,id,{now}),id,now);
const correctionOf=(calibration:ReturnType<typeof calibrate>,workerId:string,fanOutIndex:number)=>calibration.corrections.find(value=>value.workerId===workerId&&value.fanOutIndex===fanOutIndex);
/** Worker B is 8 ms slower after invocation in every release. */
const slowB=(run:string,extra:Partial<LiveTimingSample>={})=>[sample(run,'A',0,4,extra),sample(run,'A',1,4,extra),sample(run,'B',0,12,extra),sample(run,'B',1,12,extra),
  sample(run,'C',0,4,extra),sample(run,'C',1,4,extra)];

describe('local worker/index timing de-skew',()=>{
  it('is zero with fewer than two matching releases',()=>{
    const calibration=calibrate(slowB('r1'));
    expect(calibration.corrections.every(value=>value.correctionMs===0&&value.evidenceStrength==='LIMITED')).toBe(true);
  });

  it('moves a worker with consistently slower local dispatch earlier by the measured difference',()=>{
    const calibration=calibrate(releases(['r1','r2','r3'],run=>slowB(run)));
    expect(correctionOf(calibration,'B',0)).toMatchObject({workerCorrectionMs:-8,fanOutIndexCorrectionMs:0,correctionMs:-8,matchingReleases:3,evidenceStrength:'USABLE'});
    expect(correctionOf(calibration,'A',1)!.correctionMs).toBe(0);
  });

  it('does not learn central-dispatcher queue position, which retiming cannot remove',()=>{
    // Offline 7x2 shape: A..G trigger->Chrome rises with queue position while invocation->Chrome is flat.
    const samples=releases(['r1','r2','r3','r4'],run=>'ABCDEFG'.split('').flatMap((worker,position)=>[0,1].map(index=>sample(run,worker,index,5,{queue:position*0.5}))));
    expect(calibrate(samples).corrections.every(value=>value.correctionMs===0)).toBe(true);
  });

  it('ignores rows that do not record worker invocation',()=>{
    const samples=releases(['r1','r2','r3'],run=>slowB(run,{invokeToChromeLagMs:null}));
    const calibration=calibrate(samples);
    expect(calibration.corrections).toEqual([]);
  });

  it('bounds worker and index corrections and their sum',()=>{
    const samples=releases(['r1','r2','r3','r4'],run=>[sample(run,'A',0,4),sample(run,'A',1,40),sample(run,'B',0,4),sample(run,'B',1,40),
      sample(run,'C',0,4),sample(run,'C',1,4),sample(run,'D',0,90),sample(run,'D',1,90)]);
    const calibration=calibrate(samples);
    for(const value of calibration.corrections){
      expect(Math.abs(value.workerCorrectionMs)).toBeLessThanOrEqual(TIMING_DESKEW_CAP_MS);
      expect(Math.abs(value.fanOutIndexCorrectionMs)).toBeLessThanOrEqual(TIMING_DESKEW_CAP_MS);
      expect(Math.abs(value.correctionMs)).toBeLessThanOrEqual(TIMING_DESKEW_CAP_MS);
    }
    expect(correctionOf(calibration,'D',1)!.correctionMs).toBe(-TIMING_DESKEW_CAP_MS);
  });

  it('gives each release one vote for a worker',()=>{
    // One wide release where B looks fast cannot outvote two normal releases where B is 6 ms slower.
    const wide=Array.from({length:40},()=>[sample('wide','A',0,4),sample('wide','B',0,4)]).flat();
    const normal=releases(['n1','n2'],run=>[sample(run,'A',0,4),sample(run,'A',1,4),sample(run,'B',0,10),sample(run,'B',1,10),sample(run,'C',0,4),sample(run,'C',1,4)]);
    expect(correctionOf(calibrate([...wide,...normal]),'B',0)!.workerCorrectionMs).toBe(-6);
  });

  it('uses only fresh evidence; stale-only data yields no correction',()=>{
    const stale=releases(['old1','old2','old3'],run=>slowB(run,{recordedAt:'2026-06-01T00:00:00Z'}));
    expect(calibrate(stale).corrections).toEqual([]);
    // One recent release cannot resurrect the stale ones into a usable correction.
    const calibration=calibrate([...stale,...slowB('recent')]);
    expect(calibration.corrections.every(value=>value.correctionMs===0&&value.matchingReleases===1)).toBe(true);
  });

  it.each([
    ['synthetic rows',{origin:'SYNTHETIC' as const}],
    ['offline benchmark rows',{origin:'OFFLINE_BENCHMARK' as const}],
    ['invalid trusted clocks',{trustedClockValid:false}],
    ['NOT_DISPATCHED rows',{dispatched:false}],
    ['another dispatch mode',{dispatchMode:'renderer'}],
    ['width-1 evidence for width 2',{fanOutCount:1}],
  ])('excludes %s',(_label,extra)=>{
    expect(calibrate(releases(['r1','r2','r3'],run=>slowB(run,extra))).corrections).toEqual([]);
  });

  it('excludes a different machine or runtime only when both sides identify one',()=>{
    const samples=releases(['r1','r2','r3'],run=>slowB(run,{machineKey:'machine-1',runtimeKey:'Chrome/154'}));
    expect(calibrate(samples,{...identity,machineKey:'machine-2'}).corrections).toEqual([]);
    expect(calibrate(samples,{...identity,runtimeKey:'Chrome/155'}).corrections).toEqual([]);
    expect(correctionOf(calibrate(samples,{...identity,machineKey:'machine-1',runtimeKey:null}),'B',0)!.correctionMs).toBe(-8);
  });

  it('composes base + anchor + de-skew into the final literal and keeps it legal',()=>{
    const samples=releases(['r1','r2','r3'],run=>slowB(run));
    const anchor=calibrateLiveAnchor(samples,identity,{now}),calibration=calibrateTimingDeskew(samples,anchor,identity,now);
    const base=applyLiveAnchor(fanOutTimingPlan('TIGHT',2,null),anchor,-4),applied=applyTimingDeskew(base,calibration,'B');
    expect(applied.children.map(child=>[child.baseConfiguredOffsetMs,child.correctionMs,child.finalConfiguredOffsetMs])).toEqual(
      base.children.map(child=>[child.configuredOffsetMs,-8,child.configuredOffsetMs-8]));
    const edge={...base,children:[{...base.children[0]!,configuredOffsetMs:RELEASE_OFFSET_MIN_MS+3}]};
    const clamped=applyTimingDeskew(edge,calibration,'B').children[0]!;
    expect(clamped).toMatchObject({finalConfiguredOffsetMs:RELEASE_OFFSET_MIN_MS,correctionMs:-3});
  });

  it('never moves a worker with no evidence',()=>{
    const calibration=calibrate(releases(['r1','r2'],run=>slowB(run)));
    const plan=applyTimingDeskew(fanOutTimingPlan('TIGHT',2,null),calibration,'G');
    expect(plan.children.every(child=>child.correctionMs===0&&child.evidenceStrength==='NONE')).toBe(true);
  });

  it('derives invocation -> Chrome lag from telemetry and drops impossible values',()=>{
    const child=(workerInvokedMs:number|null)=>({workerId:'A',fanOutIndex:0,fanOutCount:1,configuredOffsetMs:-10,chromeStartMs:-3,errorMs:7,responseMs:null,finalState:'REJECTED',
      dispatchMode:'node',trustedClockValid:true,dispatched:true,workerInvokedMs});
    const rows=liveTimingSamples([{runId:'r',generatedAt:'2026-09-29T00:00:00Z',releaseMs:now,origin:'REAL_RELEASE',children:[child(-8.5),child(null),child(5)]}]);
    expect(rows.map(row=>row.invokeToChromeLagMs)).toEqual([5.5,null,null]);
  });
});
