import { resolve } from 'node:path';
import { buildReleaseForensics, forensicInputsFor } from './release-forensics.js';

/**
 * Rebuilds the forensic report for one finished run from its local files. Read-only
 * towards Onda: it never contacts the network.
 * Usage: npm run release:forensics -- --run <runId> [--watch <slot-watch.ndjson>] [--out <dir>] [--root <installation folder>]
 */
const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index]!.replace(/^--/, ''), process.argv[index + 1] ?? '');
const runId = args.get('run');
if (!runId) throw Error('Usage: npm run release:forensics -- --run <runId> [--watch <slot-watch.ndjson>] [--out <dir>] [--root <installation folder>]');
const watch = args.get('watch'), out = args.get('out');
const inputs = forensicInputsFor(resolve(args.get('root') ?? '.'), runId, watch ? resolve(watch) : undefined);
if (!inputs) throw Error('RUN_TRACE_NOT_FOUND');
const summary = buildReleaseForensics({ ...inputs, ...(out ? { outputDirectory: resolve(out) } : {}), status: 'final' });
process.stdout.write(`${summary.reportPath}\n`);
