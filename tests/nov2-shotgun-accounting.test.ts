import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { summarizeRun } from '../src/release-telemetry.js';

describe('immutable November 2 transport accounting',()=>{
  it('derives seven POSTs from the original eight scheduler-start records without rewriting original labels',()=>{
    const evidence=JSON.parse(readFileSync(new URL('../docs/incidents/2026-11-02-release/evidence.json',import.meta.url),'utf8'));
    const original=JSON.stringify(evidence);
    const rows=evidence.children.map((child:any)=>({schema:'critical-path/v1',workerId:child.id,...child.criticalPath}));
    const progress=evidence.children.flatMap((child:any)=>[
      {stage:'PHASE3_WAVE1_STARTED',workerId:child.worker,attemptId:child.id},
      ...(child.post?[{stage:'CHECKOUT_HTTP_POST_INITIATED',workerId:child.worker,attemptId:child.id}]:[]),
    ]);
    const run=summarizeRun(evidence.runId,rows,progress);
    expect(run.children).toHaveLength(8);
    expect(run.children.filter(c=>c.dispatched)).toHaveLength(7);
    expect(run.children.find(c=>c.attemptId==='core-B-official-6')).toMatchObject({dispatched:false,finalState:'NOT_DISPATCHED'});
    expect(run.summary.denseCore).toMatchObject({configuredAttempts:8,actuallyDispatched:7});
    expect(run.children.filter(c=>c.httpStatus===200)).toHaveLength(5);
    expect(run.children.filter(c=>c.httpStatus===400)).toHaveLength(2);
    expect(JSON.stringify(evidence)).toBe(original);
  });
  it('does not spread worker-level POST evidence to unobserved fan-out siblings',()=>{
    const rows=[0,1].map(i=>({schema:'critical-path/v1',workerId:`B:${i}`,meta:{workerId:'B',fanOutIndex:i,fanOutCount:2}}));
    expect(summarizeRun('worker-scope',rows,[{stage:'PHASE3_DISPATCH',workerId:'B'}]).children.every(c=>!c.dispatched)).toBe(true);
  });
  it('does not mistake a transport-failure completion timestamp for an observed booking POST',()=>{
    const run=summarizeRun('transport-lost',[{schema:'critical-path/v1',workerId:'B:0',responseObservedMs:5,meta:{finalState:'UNKNOWN'}}],[]);
    expect(run.children[0]).toMatchObject({dispatched:false,finalState:'UNKNOWN'});
  });
});
