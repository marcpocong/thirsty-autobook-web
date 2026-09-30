import {describe,expect,it} from 'vitest';
import {applyLiveAnchor,calibrateLiveAnchor,type LiveTimingSample} from '../src/live-anchor-calibration.js';
import {fanOutTimingPlan} from '../src/fanout-timing.js';
import {applyTimingDeskew,calibrateTimingDeskew,TIMING_DESKEW_CAP_MS} from '../src/timing-deskew.js';

const now=Date.parse('2026-09-30T00:00:00Z');
const sample=(runId:string,workerId:string,fanOutIndex:number,lag:number):LiveTimingSample=>({runId,releaseMs:now,configuredOffsetMs:fanOutIndex?-0:-10,observedChromeStartMs:(fanOutIndex?0:-10)+lag,
  triggerToChromeLagMs:lag,workerId,fanOutIndex,fanOutCount:2,dispatchMode:'node',origin:'REAL_RELEASE',trustedClockValid:true,dispatched:true,recordedAt:'2026-09-29T00:00:00Z'});

describe('local worker/index timing de-skew',()=>{
  it('is zero with fewer than two matching releases',()=>{
    const samples=[sample('r1','A',0,5),sample('r1','A',1,7)];
    const anchor=calibrateLiveAnchor(samples,{dispatchMode:'node',fanOutWidth:2},{now});
    expect(calibrateTimingDeskew(samples,anchor,{dispatchMode:'node',fanOutWidth:2},now).corrections.every(value=>value.correctionMs===0)).toBe(true);
  });
  it('moves a consistently slower worker earlier and bounds the final correction',()=>{
    const samples=['r1','r2','r3'].flatMap(run=>[sample(run,'A',0,4),sample(run,'A',1,5),sample(run,'B',0,40),sample(run,'B',1,41)]);
    const anchor=calibrateLiveAnchor(samples,{dispatchMode:'node',fanOutWidth:2},{now});
    const calibration=calibrateTimingDeskew(samples,anchor,{dispatchMode:'node',fanOutWidth:2},now);
    const b=calibration.corrections.find(value=>value.workerId==='B'&&value.fanOutIndex===1)!;
    expect(b.correctionMs).toBe(-TIMING_DESKEW_CAP_MS);
    const base=applyLiveAnchor(fanOutTimingPlan('TIGHT',2,null),anchor,0),applied=applyTimingDeskew(base,calibration,'B');
    expect(applied.children[1]!.finalConfiguredOffsetMs).toBe(-TIMING_DESKEW_CAP_MS);
  });
  it('keeps legal release-offset bounds after composition',()=>{
    const base={...fanOutTimingPlan('TIGHT',1,null),children:[{...fanOutTimingPlan('TIGHT',1,null).children[0]!,configuredOffsetMs:-2000}]};
    const applied=applyTimingDeskew(base,{generatedAt:new Date(now).toISOString(),capMs:12,corrections:[{workerId:'A',fanOutIndex:0,workerCorrectionMs:-12,fanOutIndexCorrectionMs:0,correctionMs:-12,matchingReleases:4,evidenceStrength:'STRONG'}]},'A');
    expect(applied.children[0]!.finalConfiguredOffsetMs).toBe(-2000);
  });
});
