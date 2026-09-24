import { join, resolve } from 'node:path';
import { collectPathSamples, compareCheckoutPaths, connectionWarmth } from '../src/checkout-path-research.js';
import { computeMetrics, deriveReleaseIntelligence, intelligenceReport, rebuildReleaseIntelligence } from '../src/release-intelligence.js';

/**
 * Phase 4 research report from local artifacts (analysis only; no network, checkout or strategy change).
 *
 *   npm run phase4:research -- --root ..                 read-only report
 *   npm run intelligence:rebuild -- --root ..            (re)writes only <root>/.local/release-intelligence
 */
const rootIndex = process.argv.indexOf('--root');
const root = resolve(rootIndex > 1 ? process.argv[rootIndex + 1] ?? '.' : '.');
if (process.argv.includes('--rebuild')) {
  const summary = rebuildReleaseIntelligence(root);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  const derived = deriveReleaseIntelligence(root), metrics = computeMetrics(derived.records);
  process.stdout.write(intelligenceReport(derived.records, { ...derived.index, generatedAt: new Date().toISOString() }));
  process.stdout.write(`\nReal releases: ${metrics.realReleases} · well observed: ${metrics.adequateReleases}\n`);
  const comparison = compareCheckoutPaths(collectPathSamples(join(root, '.local', 'api-booking', 'run-progress')), derived.records);
  process.stdout.write(`\nProofless vs proof-based (complete path):\n${comparison.findings.map(line => `- ${line}`).join('\n')}\n`);
  const warmth = connectionWarmth(derived.records);
  process.stdout.write(`\nConnection warmth: ${warmth.verdict}\n${warmth.reasons.map(line => `- ${line}`).join('\n')}\n`);
}
