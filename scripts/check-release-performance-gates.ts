/**
 * Checks an offline release benchmark summary (scripts/benchmark-precision-release.ts) against the regression
 * gates of src/arbitration/benchmark-gates.ts. Safety gates always apply; latency gates apply only with a
 * --baseline summary from the same machine and configuration. Exits 1 when any gate fails.
 *
 * Usage: npx tsx scripts/check-release-performance-gates.ts --summary <summary.json> [--baseline <summary.json>] [--renderer on]
 */
import { readFile } from 'node:fs/promises';
import { evaluateLatency, evaluateSafety } from '../src/arbitration/benchmark-gates.js';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index]!.replace(/^--/, ''), process.argv[index + 1] ?? '');
if (!args.get('summary')) throw Error('GATES_SUMMARY_REQUIRED');
const summary = JSON.parse(await readFile(args.get('summary')!, 'utf8'));
const requireRenderer = args.get('renderer') === 'on' || String(summary.label ?? '').includes('-renderer');
const results = [...evaluateSafety(summary, { requireRenderer }),
  ...(args.get('baseline') ? evaluateLatency(summary, JSON.parse(await readFile(args.get('baseline')!, 'utf8'))) : [])];
for (const result of results) process.stdout.write(`${result.pass ? 'PASS' : 'FAIL'}  ${result.configuration.padEnd(4)} ${result.kind.padEnd(7)} ${result.gate}`
  + `  value=${result.value ?? 'n/a'}${result.limit !== null ? ` limit=${result.limit}` : ''}\n`);
const failed = results.filter(result => !result.pass).length;
process.stdout.write(`${failed ? `${failed} gate(s) FAILED` : 'all gates passed'} (${results.length} checked${args.get('baseline') ? '' : '; latency gates need --baseline'})\n`);
process.exitCode = failed ? 1 : 0;
