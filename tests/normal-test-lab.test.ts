import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defaultObjective, type BookingObjective } from '../src/booking-objective.js';
import type { runNormalLab, NormalLabScenario } from '../src/normal-test-lab.js';

const root = resolve('.');
type Result = Awaited<ReturnType<typeof runNormalLab>>;
function availableNow(mangoIdeal: number, bukoIdeal: number, exact = false): BookingObjective {
  const o = defaultObjective(Date.now(), 'AVAILABLE_NOW');
  return { ...o, targetMode: exact ? 'EXACT' : 'FLEXIBLE', wings: {
    MANGO: { ...o.wings.MANGO, enabled: mangoIdeal > 0, minimum: 1, ideal: Math.max(1, mangoIdeal), courts: [7, 6, 5, 4].map((court, i) => ({ court, priority: i + 1, mandatory: exact && i < mangoIdeal })), startTimes: ['19:00'], durationHours: 2 },
    BUKO: { ...o.wings.BUKO, enabled: bukoIdeal > 0, minimum: 1, ideal: Math.max(1, bukoIdeal), courts: [4, 3, 2].map((court, i) => ({ court, priority: i + 1, mandatory: exact && i < bukoIdeal })), startTimes: ['19:00'], durationHours: 2 } } };
}
async function run(scenario: NormalLabScenario, objective: BookingObjective): Promise<Result> {
  const base = join(root, '.local/booking-test-lab/tests'); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'normal-'));
  const file = join(directory, 'input.json'); await writeFile(file, JSON.stringify({ kind: 'normal', request: { objective, scenario } }));
  await new Promise<void>((done, fail) => {
    const worker = spawn(process.execPath, ['--report-on-fatalerror', `--report-directory=${directory}`, '--import', 'tsx', join(root, 'src/booking-test-lab-child.ts'), file, directory], { cwd: root, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
    let error: string | undefined, stderr = ''; worker.stderr?.on('data', chunk => { stderr += String(chunk); });
    worker.on('message', (m: unknown) => { error = (m as { error?: string }).error ?? error; }); worker.on('error', fail);
    worker.on('close', (code,signal) => {writeFileSync(join(directory,'child-exit.json'),JSON.stringify({code,signal,at:new Date().toISOString()}));writeFileSync(join(directory,'child-stderr-private.log'),stderr);code === 0 ? done() : fail(Error(error || stderr.slice(-2000) || `EXIT ${code}`));});
  });
  return JSON.parse(await readFile(join(directory, 'result.json'), 'utf8')) as Result;
}

describe('Booking Test Lab · Normal fresh-proof strategy (offline, real planner/journal/validator)', () => {
  it('books a two-court Mango checkout and a separate Buko checkout to verified simulated holds', async () => {
    const r = await run('NORMAL_SUCCESS', availableNow(2, 1));
    expect(r.environment).toBe('OFFLINE_SIMULATION');
    expect(r.steps.map(s => [s.wing, s.worker, s.courts.length, s.state])).toEqual([['MANGO', 'A', 2, 'HOLD_VERIFIED'], ['BUKO', 'B', 1, 'HOLD_VERIFIED']]);
    expect(r.objectiveOutcome.status).toBe('IDEAL'); expect(r.objectiveOutcome.paymentConfirmed).toBe(0);
  }, 60000);
  it('stops every later checkout after payment-in-progress, throttling or an unknown result', async () => {
    const payment = await run('PAYMENT_IN_PROGRESS', availableNow(1, 2));
    expect(payment.steps.map(s => s.state)).toEqual(['HOLD_VERIFIED', 'REJECTED', 'SUPPRESSED']);
    expect(payment.steps[1]!.code).toBe('PAYMENT_IN_PROGRESS_STOP'); expect(payment.objectiveOutcome.status).toBe('PARTIAL');
    const throttle = await run('THROTTLE', availableNow(1, 1));
    expect(throttle.steps.map(s => s.state)).toEqual(['REJECTED', 'SUPPRESSED']); expect(throttle.objectiveOutcome.status).toBe('NONE');
    const unknown = await run('UNKNOWN', availableNow(1, 1));
    expect(unknown.objectiveOutcome.status).toBe('UNKNOWN'); expect(unknown.objectiveOutcome.needsReview).toBe(true);
    const wrong = await run('WRONG_WING', availableNow(1, 0));
    expect(wrong.steps[0]!.state).toBe('UNKNOWN');
  }, 90000);
  it('refuses stale or missing availability and preserves duplicate protection', async () => {
    expect((await run('STALE_AVAILABILITY', availableNow(1, 0))).steps[0]!.code).toBe('AVAILABILITY_SNAPSHOT_STALE');
    expect((await run('MISSING_AVAILABILITY', availableNow(1, 0))).steps[0]!.state).toBe('NOT_DISPATCHED');
    const exact = await run('DUPLICATE_TARGET', availableNow(0, 1, true));
    expect(exact.steps[0]!.code).toBe('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
    const flexible = await run('DUPLICATE_TARGET', availableNow(1, 0));
    expect(flexible.steps[0]!.state).toBe('HOLD_VERIFIED'); expect(flexible.steps[0]!.courts).not.toEqual([7]);
  }, 90000);
  it('reports partial completion when only some checkouts succeed', async () => {
    const r = await run('PARTIAL_COMPLETION', availableNow(1, 2));
    expect(r.steps.map(s => s.state)).toEqual(['HOLD_VERIFIED', 'REJECTED', 'REJECTED']);
    expect(r.objectiveOutcome.status).toBe('PARTIAL');
  }, 60000);
});
