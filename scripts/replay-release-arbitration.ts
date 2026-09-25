/**
 * Deterministic release replay through the local contention simulator (src/arbitration/contention-sim.ts,
 * src/arbitration/release-replay.ts). Offline and CPU-only: it reads the committed arbitration evidence and
 * contacts nothing.
 *
 * For every observed release day, every provider model variant and every crowd-load variant, it simulates
 * `--seeds` releases, scores each against that day's signatures, and writes which model families reproduce
 * all signatures somewhere in the explored grid (COMPATIBLE, still only a hypothesis) and which reproduce a
 * signature nowhere (contradicted within the explored ranges, and only there).
 *
 * Output is byte-for-byte reproducible for the same inputs (no timestamps, seeded PRNG).
 *
 * Then, because the grid is coarse, a seeded random search over wider ranges on the Sept 25 day (`--search`
 * configurations per family, 3 seeds each; 0 disables it).
 *
 * Usage: npx tsx scripts/replay-release-arbitration.ts [--evidence <arbitration-evidence.json>] [--out <file>] [--seeds 5] [--search 400]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { crowdVariants, evaluateCell, familyVerdicts, modelVariants, observedReleases, randomSearch, scoreOutcomes, type CellResult } from '../src/arbitration/release-replay.js';
import type { ModelFamily } from '../src/arbitration/contention-sim.js';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index]!.replace(/^--/, ''), process.argv[index + 1] ?? '');
const root = resolve(import.meta.dirname, '..');
const evidencePath = resolve(root, args.get('evidence') ?? 'diagnostics-archive/2026-09-25/arbitration/arbitration-evidence.json');
const outPath = resolve(root, args.get('out') ?? 'diagnostics-archive/2026-09-25/arbitration/replay-arbitration.json');
const seedCount = Number(args.get('seeds') ?? 5);
if (!(seedCount >= 1 && seedCount <= 100)) throw Error('REPLAY_ARGS_INVALID');
const seeds = Array.from({ length: seedCount }, (_, index) => 1_000 + index);

const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
const days = observedReleases(evidence);
const models = modelVariants(), crowds = crowdVariants();
const report: Record<string, unknown> = {
  schema: 'release-replay/v1',
  purpose: 'Compatibility of provider arbitration models with observed release signatures. A HYPOTHESIS tool: a compatible model is not proven; '
    + 'a model that never reproduces a signature is contradicted only within the explored parameter ranges.',
  grid: { modelVariants: models.map(variant => variant.key), crowdVariants: crowds.map(variant => variant.key), seeds },
  days: [] as unknown[],
};
const cellsByDay = new Map<string, CellResult[]>();
for (const day of days) {
  const cells: CellResult[] = [];
  for (const model of models) for (const crowd of crowds) cells.push(evaluateCell(day, model, crowd, seeds));
  cellsByDay.set(day.label, cells);
  // Sanity: the observed outcomes themselves must satisfy the day's signatures.
  const self = scoreOutcomes(day.signatures, day.checkouts.map(value => ({ edgeMs: value.edgeMs, responseMs: value.responseMs, status: value.status })), day.reads);
  const verdicts = familyVerdicts(day.label, cells);
  (report.days as unknown[]).push({ label: day.label, provenance: day.provenance, signatures: day.signatures, observedSelfScore: self,
    families: verdicts.map(verdict => ({ family: verdict.family, verdict: verdict.verdict, cells: verdict.cells, cellsWithAnyFullMatch: verdict.cellsWithAnyFullMatch,
      maxSignatureRates: verdict.maxSignatureRates, best: verdict.best })),
    topCells: [...cells].sort((a, b) => b.fullMatchRate - a.fullMatchRate || b.meanScore - a.meanScore).slice(0, 12) });
  process.stdout.write(`${day.label}: observed self-score ${self.score}/${self.applicable}\n`);
  for (const verdict of verdicts) process.stdout.write(`  ${verdict.family.padEnd(26)} ${verdict.verdict.padEnd(28)} full-match cells ${String(verdict.cellsWithAnyFullMatch).padStart(3)}/${verdict.cells}`
    + `  best ${verdict.best.fullMatchRate.toFixed(2)} (${verdict.best.model} | ${verdict.best.crowd})\n`);
}
// Joint: provider variants that reproduce EVERY day (each with its own crowd load, which is unknown and may differ by day).
report.joint = models.map(model => {
  const perDay = days.map(day => {
    const cells = cellsByDay.get(day.label)!.filter(cell => cell.model === model.key);
    const best = [...cells].sort((a, b) => b.fullMatchRate - a.fullMatchRate || b.meanScore - a.meanScore)[0]!;
    return { day: day.label, bestFullMatchRate: best.fullMatchRate, crowd: best.crowd };
  });
  return { model: model.key, reproducesEveryDay: perDay.every(value => value.bestFullMatchRate > 0), perDay };
}).sort((a, b) => Number(b.reproducesEveryDay) - Number(a.reproducesEveryDay) || a.model.localeCompare(b.model));
// Random search on the richest day (Sept 25: six signatures), because the grid above is coarse.
const searchSamples = Number(args.get('search') ?? 400);
const families: ModelFamily[] = ['A_EDGE_FIFO', 'B_INSTANCE_ADMISSION', 'C_PESSIMISTIC_COURT_LOCK', 'D_OPTIMISTIC', 'E_RETRY_BACKOFF', 'F_FACILITY_DATE_SERIAL',
  'G_LANES', 'H_PER_IP', 'P_PROCESSOR_SHARING'];
if (searchSamples > 0) {
  const day = days[0]!;
  report.search = { day: day.label, samplesPerFamily: searchSamples, seeds: seeds.slice(0, 3),
    ranges: 'log-uniform: crowd checkouts 20–400, arrival mean 0.1–8 s, pre-release share 0–0.6, reads 5–60/s, pre-lock work 0.2–1.5 s, in-lock work 0.15–1.5 s (C: 0.3–5 s, D: 0.15–5 s); family knobs as in src/arbitration/release-replay.ts; half of the draws add a replica/cache read path (share 0–0.8) that the fixed grid does not have',
    families: families.map((family, index) => {
      const result = randomSearch(day, family, searchSamples, seeds.slice(0, 3), 7_000 + index);
      process.stdout.write(`search ${day.label} ${family.padEnd(26)} full-match configs ${String(result.cellsWithAnyFullMatch).padStart(3)}/${result.samples}  best mean score ${result.best.meanScore}`
        + `  max rates ${JSON.stringify(result.maxSignatureRates)}\n`);
      return result;
    }) };
}
await writeFile(outPath, `${JSON.stringify(report, null, 1)}\n`);
process.stdout.write(`joint (every day): ${(report.joint as Array<{ model: string; reproducesEveryDay: boolean }>).filter(value => value.reproducesEveryDay).map(value => value.model).join(', ') || 'none'}\n`);
process.stdout.write(`${outPath}\n`);
