import {describe,expect,it} from 'vitest';
import {allocateShotgun,logicalTargetId,planShotgun,shotgunOffsets,shotgunStopReason,shotgunTimingBucket,shotgunWorkerGroups,type ShotgunSettings} from '../src/shotgun.js';
import {compileSmartPlan,confirmSmartRates,emptySmartDraft,type SmartDraft} from '../src/precision-simple.js';
import {authorizePrecision,precisionCandidateId,wave1SendCount} from '../src/api-booking/precision-phase3.js';
import {UiEventSchema} from '../src/ui-events.js';
import {reduceLiveRun} from '../ui/live-run.js';
import {bookingView,defaultSetup,describePrecisionPlan} from '../ui/booking.js';
import {ConfigSchema} from '../src/config.js';

const targetDate='2026-10-03';
const targets=[
  {logicalTargetId:'c6',priority:1},{logicalTargetId:'c7',priority:2},{logicalTargetId:'c1',priority:3},{logicalTargetId:'c2',priority:4},
];
const settings=(patch:Partial<ShotgunSettings>={}):ShotgunSettings=>({enabled:true,budget:20,allocationMode:'EQUAL',selectedTargetIds:['c6','c7'],
  windowStartMs:-1500,windowEndMs:250,timingMode:'AUTO',capacityOverride:true,...patch});

describe('Shotgun allocation and timing',()=>{
  it('allocates 20 / 2 equally as 10 / 10',()=>expect(allocateShotgun(settings(),targets)).toEqual({counts:{c6:10,c7:10},problems:[]}));
  it('uses deterministic explainable priority weights (3:2 for two targets)',()=>
    expect(allocateShotgun(settings({allocationMode:'PRIORITY_WEIGHTED'}),targets).counts).toEqual({c6:12,c7:8}));
  it('preserves exact Custom counts and refuses invalid or over-budget input without rewriting it',()=>{
    expect(allocateShotgun(settings({allocationMode:'CUSTOM',customCounts:{c6:12,c7:8}}),targets)).toEqual({counts:{c6:12,c7:8},problems:[]});
    expect(allocateShotgun(settings({allocationMode:'CUSTOM',customCounts:{c6:13,c7:8}}),targets).problems.join(' ')).toMatch(/above the budget/);
    expect(allocateShotgun(settings({allocationMode:'CUSTOM',customCounts:{c6:-1,c7:8}}),targets).problems.join(' ')).toMatch(/non-negative whole number/);
  });
  it('generates a monotonic inclusive signed release-relative schedule',()=>{
    const values=shotgunOffsets(20,-1500,250);expect(values).toHaveLength(20);expect(values[0]).toBe(-1500);expect(values.at(-1)).toBe(250);
    expect(values.every((value,index)=>index===0||value>=values[index-1]!)).toBe(true);
  });
  it('uses one globally spaced schedule across targets instead of coincident per-target bursts',()=>{
    const plan=planShotgun(settings({allocationMode:'PRIORITY_WEIGHTED',windowStartMs:-2000,windowEndMs:0}),targets,{meaningfulSpacingMs:105});
    expect(plan.shots).toHaveLength(20);expect(plan.shots[0]?.configuredOffsetMs).toBe(-2000);expect(plan.shots.at(-1)?.configuredOffsetMs).toBe(0);
    expect(new Set(plan.shots.map(value=>value.configuredOffsetMs)).size).toBe(20);
    expect(plan.shots.filter(value=>value.logicalTargetId==='c6')).toHaveLength(12);
    expect(plan.shots.filter(value=>value.logicalTargetId==='c7')).toHaveLength(8);
  });
  it('makes timing modes concrete multiples of measured spacing when the configured window can hold them',()=>{
    const offsets=(timingMode:ShotgunSettings['timingMode'])=>planShotgun(settings({budget:5,selectedTargetIds:['c6'],windowStartMs:-2000,windowEndMs:0,timingMode}),targets,{meaningfulSpacingMs:100}).shots.map(value=>value.configuredOffsetMs);
    expect(offsets('AUTO')).toEqual([-2000,-1500,-1000,-500,0]);
    expect(offsets('TIGHT')).toEqual([-400,-300,-200,-100,0]);
    expect(offsets('BALANCED')).toEqual([-800,-600,-400,-200,0]);
    expect(offsets('WIDE')).toEqual([-1600,-1200,-800,-400,0]);
  });
  it('applies one group anchor to the deterministic relative schedule and refuses out-of-range final triggers',()=>{
    const anchored=planShotgun(settings({budget:3,selectedTargetIds:['c6'],windowStartMs:-300,windowEndMs:-100}),targets,{meaningfulSpacingMs:100,groupAnchorMs:50});
    expect(anchored.groupAnchorMs).toBe(50);expect(anchored.shots.map(value=>value.configuredOffsetMs)).toEqual([-250,-150,-50]);
    expect(planShotgun(settings({budget:2,selectedTargetIds:['c6'],windowStartMs:1900,windowEndMs:2000}),targets,{meaningfulSpacingMs:100,groupAnchorMs:50}).problems.join(' ')).toMatch(/outside -2000 through \+2000/);
  });
  it('warns and blocks when requested spacing is tighter than measured capacity unless explicitly overridden',()=>{
    const blocked=planShotgun(settings({budget:30,windowStartMs:-1750,windowEndMs:250,capacityOverride:false}),targets,{meaningfulSpacingMs:95});
    expect(blocked.recommendedMaximum).toBe(22);expect(blocked.capacityWarning).toMatch(/Requested 30/);expect(blocked.problems.join(' ')).toMatch(/explicit capacity override/);
    expect(planShotgun(settings({budget:30,windowStartMs:-1750,windowEndMs:250,capacityOverride:true}),targets,{meaningfulSpacingMs:95}).problems).toEqual([]);
  });
  it('splits a logical target into authoritative six-child worker groups',()=>expect(shotgunWorkerGroups(shotgunOffsets(12,-1500,250)).map(value=>value.length)).toEqual([6,6]));
  it('derives forensic timing buckets and deterministic stop reasons',()=>{
    expect([-700,-300,-50,0,200,300].map(shotgunTimingBucket)).toEqual(['< -500 ms','-500 to -100 ms','-100 to 0 ms','0 to +100 ms','+100 to +250 ms','> +250 ms']);
    expect(shotgunStopReason({state:'QR_READY'})).toBe('SHOTGUN_TARGET_ALREADY_ACHIEVED');
    expect(shotgunStopReason({state:'UNKNOWN'})).toBe('SHOTGUN_TARGET_OUTCOME_UNKNOWN');
    expect(shotgunStopReason({state:'REJECTED'})).toBeNull();
    expect(shotgunStopReason({state:'REJECTED',httpStatus:429})).toBe('SHOTGUN_PROVIDER_THROTTLE_STOP');
  });
});

describe('unified Strategy compiler',()=>{
  const rates=confirmSmartRates(600,700,'VENUE_SCHEDULE',targetDate,new Date('2026-10-03T00:00:00Z'));
  const immediate=[
    {court:6,start:'22:00',durationHours:2,priority:1},{court:7,start:'22:00',durationHours:2,priority:2},
    {court:1,start:'20:00',durationHours:3,priority:3},{court:2,start:'21:00',durationHours:3,priority:4},
  ];
  const draft=(shotgun:ShotgunSettings):SmartDraft=>({...emptySmartDraft(),rates,retryReopened:true,maxReopenedAttempts:3,immediate,
    backups:[{court:3,start:'17:00',durationHours:2},{court:4,start:'17:00',durationHours:2},{court:5,start:'17:00',durationHours:2}],shotgun});
  it('keeps unselected targets in normal Wave 1 and concentrates Shotgun only on stable selected IDs',()=>{
    const selected=immediate.slice(0,2).map(logicalTargetId),compiled=compileSmartPlan(draft(settings({selectedTargetIds:selected})),{targetDate,shotgunCapacity:{meaningfulSpacingMs:95}});
    expect(compiled.problems).toEqual([]);const phase3=compiled.phase3!;
    expect(compiled.shotgun?.counts).toEqual({[selected[0]!]:10,[selected[1]!]:10});
    expect(phase3.wave1.filter(value=>value.candidateIndex===0).map(value=>value.fanOutOffsetsMs?.length??1)).toEqual([6,4]);
    expect(phase3.wave1.filter(value=>value.candidateIndex===1).map(value=>value.fanOutOffsetsMs?.length??1)).toEqual([6,4]);
    expect(phase3.wave1.filter(value=>value.candidateIndex===2)).toHaveLength(1);
    expect(phase3.wave1.filter(value=>value.candidateIndex===3)).toHaveLength(1);
    expect(wave1SendCount({wave1:phase3.wave1} as never)).toBe(22);
    const auth=authorizePrecision({date:targetDate,releaseMs:Date.parse('2026-10-03T00:00:00Z'),candidates:phase3.candidates,
      wave1:phase3.wave1.map(value=>({workerId:value.workerId,candidateId:precisionCandidateId(targetDate,phase3.candidates[value.candidateIndex]!),
        ...(value.fanOutOffsetsMs?{fanOutOffsetsMs:value.fanOutOffsetsMs}:value.releaseOffsetMs!==undefined?{releaseOffsetMs:value.releaseOffsetMs}:{})})),
      standby:phase3.standby,budgets:phase3.budgets,concurrentWave2:phase3.concurrentWave2,rescueEnabled:phase3.rescueEnabled,authorizedAt:'2026-10-03T00:00:00Z'});
    expect(wave1SendCount(auth)).toBe(22);expect(phase3.budgets.rescue).toBe(3);
  });
  it('selection remains attached after row reorder',()=>{
    const id=logicalTargetId(immediate[0]!),first=draft(settings({budget:6,selectedTargetIds:[id]})),reordered={...first,immediate:[first.immediate[2]!,first.immediate[0]!,first.immediate[1]!,first.immediate[3]! ]};
    expect(compileSmartPlan(reordered,{targetDate}).shotgun?.counts).toEqual({[id]:6});
  });
});

describe('six-child schemas and Live grouping',()=>{
  it('accepts child indexes 5 and six-child counts and renders both under the logical target',()=>{
    const candidates=new Map([['a'.repeat(64),{court:6,startTime:'22:00',endTime:'24:00'}]]),base={type:'apiStage' as const,elapsedMs:0,workerId:'A' as const,
      candidateId:'a'.repeat(64),fanOutCount:6};
    const events=[4,5].map(fanOutIndex=>UiEventSchema.parse({...base,stage:'PHASE3_FAN_OUT_CHILD',attemptId:`shot-${fanOutIndex}`,fanOutIndex,releaseOffsetMs:-100+fanOutIndex}) as Extract<import('../src/ui-events.js').UiEvent,{type:'apiStage'}>);
    let view=null;for(const event of events)view=reduceLiveRun(view,event,candidates);
    expect(view?.parents[0]?.children.map(child=>child.fanOutIndex)).toEqual([4,5]);
  });
  it('round-trips six Fixed children through config serialization and renders dynamic review counts',()=>{
    const offsets=[-500,-400,-300,-200,-100,0],setup=ConfigSchema.parse(JSON.parse(JSON.stringify({...defaultSetup,BOOKING_METHOD:'proofless',RELEASE_STRATEGY:'precision',PRECISION_FAN_OUT:true,
      PRECISION_TARGETS:[{court:7,start:'19:00',durationHours:3,fanOutReleaseOffsetsMs:offsets}],PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'})));
    expect(setup.PRECISION_TARGETS[0]?.fanOutReleaseOffsetsMs).toEqual(offsets);
    const review=describePrecisionPlan(bookingView(setup));expect(review).toContain('6 tabs:');expect(review).toContain('fan out to 6 independently tracked attempts');
  });
});
