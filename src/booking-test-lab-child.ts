import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runShotgunLab, type LabRequest } from './shotgun-test-lab.js';
import { runNormalLab, type NormalLabScenario } from './normal-test-lab.js';
import type { BookingObjective } from './booking-objective.js';
const inputPath = resolve(process.argv[2] ?? '');
const raw = JSON.parse(await readFile(inputPath, 'utf8')) as { kind?: 'browser' | 'normal'; request?: unknown } & Partial<LabRequest>;
// Older inputs were the bare LabRequest.
const kind = raw.kind ?? 'browser', request = (raw.request ?? raw) as LabRequest | { objective: BookingObjective; scenario: NormalLabScenario };
const directory = resolve(process.argv[3] ?? '');
if (!/(?:booking|shotgun)-test-lab/.test(directory) || directory === process.cwd()) throw Error('LAB_ISOLATION_REQUIRED');
await mkdir(directory, { recursive: true });
process.chdir(directory);
process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
let stopped = false;
process.on('message', message => { if (message === 'stop') stopped = true; });
process.on('SIGTERM', () => { stopped = true; });
try {
  const options = { directory, runId: directory.split(/[\\/]/).at(-1)!, isAborted: () => stopped, onPhase: (phase: string) => process.send?.({ phase }) };
  const result = kind === 'normal' ? await runNormalLab(request as { objective: BookingObjective; scenario: NormalLabScenario }, options) : await runShotgunLab(request as LabRequest, options);
  await writeFile(resolve(directory, 'result.json'), JSON.stringify(result, null, 2));
  process.send?.({ result });
} catch (error) { process.stderr.write(`${(error as Error).message}\n`); process.send?.({ error: (error as Error).message }); process.exitCode = 1; }
finally { process.disconnect?.(); }
