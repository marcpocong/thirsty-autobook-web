import { describe, expect, it } from 'vitest';
import { acknowledgementKind, liveOutcome, offsetText, preparationText } from '../ui/renderer/operator-status.js';
import { evaluatePrewarmFeasibility } from '../src/api-booking/prewarm-feasibility.js';
import { compileSmartPlan, confirmSmartRates, emptySmartDraft } from '../src/precision-simple.js';
import { deriveShotgunTopology, EXPERIMENTAL_DENSE_CORE_20, logicalTargetId } from '../src/shotgun.js';
import type { Dashboard, LiveChildView } from '../ui/types.js';

const targetDate='2026-10-10',draft={...emptySmartDraft(),immediate:[{court:7,start:'19:00',durationHours:3}],rates:confirmSmartRates(600,700,'VENUE_SCHEDULE',targetDate,new Date())};
const shotgun={enabled:true,budget:20,allocationMode:'EQUAL' as const,selectedTargetIds:draft.immediate.map(logicalTargetId),windowStartMs:-1000,windowEndMs:0,timingMode:'DENSE_CORE' as const,timingCapacityOverride:true,allowStandbyConsumption:true};
const plan=compileSmartPlan({...draft,shotgun},{targetDate}).phase3!;
const feasible=evaluatePrewarmFeasibility({phase3:plan,prepP95Ms:null,globalConcurrency:4});
describe('operator status projections',()=>{
  it('formats zero without a plus and preserves positive signs',()=>{expect(offsetText(0)).toBe('0 ms');expect(offsetText(-1)).toBe('-1 ms');expect(offsetText(1)).toBe('+1 ms');});
  it('maps only known acknowledgements and retains invalid errors',()=>{
    expect(acknowledgementKind('Requested Dense Core spacing reaches 1 ms; machine meaningful-spacing evidence is 105 ms. Enable the timing capacity override or reduce the budget.')).toBe('timing');
    expect(acknowledgementKind('Shotgun would reduce reserved Wave 2 workers from 3 to 0. Enable standby consumption only if that resource tradeoff is intentional.')).toBe('standby');
    expect(acknowledgementKind('Custom Shotgun offsets must be whole milliseconds from -2000 through 0. Positive offsets are not allowed.')).toBeNull();
  });
  it('states pending, feasible and partial forecasts without live READY claims',()=>{
    expect(preparationText(null,20)).toContain('Checking whether all 20');
    expect(preparationText(feasible,20)).toContain('Forecast: 20/20');
    expect(preparationText({...feasible,projectedReady:18,projectedOmitted:2},20)).toContain('18/20');
    expect(preparationText({...feasible,projectedReady:18,projectedOmitted:2},20)).toContain('cannot be armed');
    expect(preparationText({...feasible,projectedReady:18,projectedAtRisk:2},20)).toContain('AT RISK');
  });
  it('preserves the exact Dense Core 20-shot schedule and 6/6/6/2 groups',()=>{
    expect(plan.wave1.map(group=>group.fanOutOffsetsMs?.length??1)).toEqual([6,6,6,2]);
    const offsets=plan.wave1.flatMap(group=>group.fanOutOffsetsMs??[group.releaseOffsetMs??0]);
    expect(offsets).toEqual([...EXPERIMENTAL_DENSE_CORE_20]);
    const id=logicalTargetId(draft.immediate[0]!),schedule=offsets.map((configuredOffsetMs,shotIndex)=>({logicalTargetId:id,configuredOffsetMs,shotIndex}));
    const topology=deriveShotgunTopology(offsets.map((configuredOffsetMs,index)=>({id:String(index),logicalTargetId:id,configuredOffsetMs})),schedule);
    expect(offsets.map((_,index)=>schedule[topology.get(String(index))!.shotIndex]!.configuredOffsetMs)).toEqual(offsets);
  });
});
function live(states:string[],codes:string[]=[],wave:'WAVE_1'|'RESCUE'='WAVE_1'):Dashboard {
  return {operation:'idle',live:{parents:[{key:'fixture',wave,children:states.map((state,index):LiveChildView=>({attemptId:String(index),label:String(index),fanOutIndex:index,fanOutCount:states.length,state,code:codes[index]}))}],predictions:[],notes:[]}} as unknown as Dashboard;
}
describe('outcome first',()=>{
  it.each([
    [['READY'],'WAITING FOR RELEASE'],[['ARMED','IN_FLIGHT'],'DISPATCHING'],[['IN_FLIGHT'],'WAITING FOR PROVIDER'],
    [['HOLD_VERIFIED'],'HOLD VERIFIED'],[['REJECTED','REJECTED'],'ALL RELEASE ATTEMPTS REJECTED'],
    [['UNKNOWN'],'OUTCOME UNKNOWN'],[['QR_READY'],'HOLD VERIFIED'],
    // Definitively unsent is never reported as unknown (October 18: three SHOTGUN_TRIGGER_MISSED attempts).
    [['NOT_DISPATCHED','NOT_DISPATCHED','NOT_DISPATCHED'],'NOTHING DISPATCHED'],[['REJECTED','NOT_DISPATCHED'],'ALL SENT ATTEMPTS REJECTED'],
    [['FAILED','NOT_DISPATCHED'],'RESULT INCOMPLETE · REVIEW ACTIVITY'],[['WINDOW_MISSED','OMITTED'],'NOTHING DISPATCHED'],
  ])('%j → %s',(states,outcome)=>expect(liveOutcome(live(states as string[]))).toBe(outcome));
  it('shows provider throttling',()=>expect(liveOutcome(live(['REJECTED'],['HTTP_429']))).toBe('PROVIDER THROTTLED'));
  it('shows rescue active and rescue verified',()=>{expect(liveOutcome(live(['IN_FLIGHT'],[],'RESCUE'))).toBe('RESCUE ACTIVE');expect(liveOutcome(live(['HOLD_VERIFIED'],[],'RESCUE'))).toBe('RESCUE HOLD VERIFIED');});
});
