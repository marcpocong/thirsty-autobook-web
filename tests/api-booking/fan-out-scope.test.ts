import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 2026-09-29: with fan-out saved on, a Proofless Test run keyed its transport as "A:0" but looked up
// "A", so it stopped with API_CHECKOUT_WORKER_MISSING before dispatch. Transport keys are now unified:
// a worker's first tab is always keyed by the worker ID and child i>0 by "W:i", for Fixed and Smart alike.
describe('fan-out scope in the desktop runner', () => {
  const source = readFileSync('src/api-booking/desktop-runner.ts', 'utf8');
  it('derives Fixed fan-out from the Precision run, not from the saved flag alone', () => {
    expect(source).toContain('const precisionFanOut=!!precisionTargets&&config.PRECISION_FAN_OUT;');
    expect(source.match(/config\.PRECISION_FAN_OUT/g)).toHaveLength(2);
  });
  it('opens one tab per child (Fixed four, Smart per target) and keys tab 0 by the worker ID', () => {
    expect(source).toContain('prepareWorker(worker,precisionFanOut?PRECISION_FAN_OUT_ATTEMPTS:smartTabs.get(worker)??1)');
    expect(source).toContain('const transportKeyOf=(workerId:WorkerId,fanOutIndex:number)=>fanOutIndex===0?workerId:`${workerId}:${fanOutIndex}`;');
    expect(source).toContain('const transportKey=transportKeyOf(workerId,pageIndex);');
    // No path builds a "W:0" key any more.
    expect(source).not.toMatch(/`\$\{[a-zA-Z.]+\}:0`/);
  });
});
