import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 2026-09-29: with fan-out saved on, a Proofless Test run keyed its transport as "A:0" but looked up
// "A", so it stopped with API_CHECKOUT_WORKER_MISSING before dispatch.
describe('Fixed Precision fan-out scope in the desktop runner', () => {
  const source = readFileSync('src/api-booking/desktop-runner.ts', 'utf8');
  it('derives fan-out from the Precision run, not from the saved flag alone', () => {
    expect(source).toContain('const precisionFanOut=!!precisionTargets&&config.PRECISION_FAN_OUT;');
    expect(source.match(/config\.PRECISION_FAN_OUT/g)).toHaveLength(2);
  });
  it('uses it for the worker tab count and the per-tab transport keys', () => {
    expect(source).toContain('prepareWorker(worker,precisionFanOut?PRECISION_FAN_OUT_ATTEMPTS:1)');
    expect(source).toContain('const transportKey=precisionFanOut?`${workerId}:${pageIndex}`:workerId;');
  });
});
