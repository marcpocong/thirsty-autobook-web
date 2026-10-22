import { DualWingPlanSchema } from '../src/dual-wing-plan-schema.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { compileDualWingPlan, type DualWingPlan } from '../src/dual-wing-plan.js';
import { validateLabRequest, type LabRequest, type LabResult } from '../src/shotgun-test-lab.js';
import { NORMAL_LAB_SCENARIOS, type NormalLabScenario } from '../src/normal-test-lab.js';
import { compileObjective, parseStoredObjective, type BookingObjective } from '../src/booking-objective.js';
import { nextWingRelease, WING_RELEASE_POLICIES } from '../src/wing-release-policy.js';

export type ObjectiveLabRun = { objective: BookingObjective; scenario: string; countdownSeconds: number; cohortIndex?: number };
/**
 * Universal Booking Test Lab. Each run is one isolated child in a fresh run directory. It receives only the exact
 * compiled Booking Setup objective (or the legacy planning wrapper) and a scenario — never operator configuration,
 * customer profiles, cookies, worker security or production journals. Every checkout is intercepted locally.
 */
export class BookingTestLabService {
  child: ChildProcess | null = null;
  busy = false;
  private stopRequested = false;
  private completion: Promise<void> = Promise.resolve();
  private finished: (() => void) | undefined;
  constructor(private root: string, private node: string, private onPhase?: (phase: string) => void) {}
  preview(value: DualWingPlan) {
    if (JSON.stringify(value).length > 50000) throw Error('LAB_INPUT_TOO_LARGE');
    return compileDualWingPlan(DualWingPlanSchema.parse(value));
  }
  previewObjective(value: unknown) {
    if (JSON.stringify(value ?? null).length > 100000) throw Error('LAB_INPUT_TOO_LARGE');
    const objective = parseStoredObjective(value); if (!objective) throw Error('OBJECTIVE_INVALID');
    return compileObjective(objective, { nowMs: Date.now() });
  }
  defaults() { return { MANGO: nextWingRelease(new Date(), 'MANGO'), BUKO: nextWingRelease(new Date(), 'BUKO'), policies: WING_RELEASE_POLICIES }; }
  async save(value: DualWingPlan) {
    const compiled = this.preview(value); if (!compiled.phase3) throw Error(`LAB_PLAN_INVALID: ${compiled.problems.join(' ')}`);
    await mkdir(join(this.root, '.local/shotgun-test-lab'), { recursive: true });
    await writeFile(join(this.root, '.local/shotgun-test-lab/planning-only.json'), JSON.stringify(value, null, 2));
  }
  async load(): Promise<DualWingPlan | null> { try { const value = JSON.parse(await readFile(join(this.root, '.local/shotgun-test-lab/planning-only.json'), 'utf8')) as DualWingPlan; this.preview(value); return value; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } }
  stop() { this.stopRequested = true; this.child?.send('stop'); }
  async stopAndWait() { this.stop(); await this.completion; }
  /** Validates in the parent before spawning; the child validates again from the same input bytes. */
  async run(input: LabRequest | ObjectiveLabRun): Promise<unknown> {
    if (this.busy) throw Error('LAB_ALREADY_RUNNING');
    let kind: 'browser' | 'normal' = 'browser';
    if ('objective' in input) {
      const objective = parseStoredObjective(input.objective); if (!objective) throw Error('OBJECTIVE_INVALID');
      if (objective.strategy === 'NORMAL') {
        if (!NORMAL_LAB_SCENARIOS.includes(input.scenario as NormalLabScenario)) throw Error('LAB_REQUEST_INVALID');
        const compiled = compileObjective(objective, { nowMs: Date.now() }); if (compiled.problems.length) throw Error(`LAB_PLAN_INVALID: ${compiled.problems.join(' ')}`);
        kind = 'normal';
      } else validateLabRequest(input as LabRequest);
    } else { this.preview(input.plan); validateLabRequest(input); }
    this.busy = true; this.stopRequested = false; this.completion = new Promise(done => { this.finished = done; });
    try {
      const directory = resolve(this.root, '.local/booking-test-lab/runs', randomUUID());
      await mkdir(directory, { recursive: true });
      const file = join(directory, 'input.json'); await writeFile(file, JSON.stringify({ kind, request: input }));
      return await new Promise<unknown>((done, fail) => {
        let result: unknown, error: string | undefined;
        const child = spawn(this.node, ['--report-on-fatalerror',`--report-directory=${directory}`,join(this.root, 'dist/src/booking-test-lab-child.js'), file, directory], { cwd: this.root, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
        let stderr='';child.stderr?.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-16_384);});
        this.child = child; if (this.stopRequested) child.send('stop');
        child.on('message', (value: unknown) => { const message = value as { result?: LabResult; error?: string; phase?: string }; if (message.phase) this.onPhase?.(message.phase); if (message.result) result = message.result; if (message.error) error = message.error; });
        child.on('error', e => { this.child = null; fail(e); });
        child.on('close', (code,signal) => { this.child = null;
          void Promise.all([writeFile(join(directory,'child-exit.json'),JSON.stringify({code,signal,at:new Date().toISOString()})),
            writeFile(join(directory,'child-stderr-private.log'),stderr)]).catch(()=>undefined).finally(()=>{
            if(code===0&&result)done(result);else fail(Error(error??(code!==null&&code>255?`LAB_CHILD_NATIVE_EXIT_${code}`:'LAB_CHILD_FAILED')));
          });});
      });
    } finally { this.busy = false; this.finished?.(); }
  }
}
