import { resolve } from 'node:path';
import { currentMachineIdentity, fanOutDigest } from '../src/fanout-capacity.js';
import { fanOutTimingPlan } from '../src/fanout-timing.js';
import { applyLiveAnchor, calibrateLiveAnchor, liveTimingSamples } from '../src/live-anchor-calibration.js';
import { readReleaseTelemetry } from '../src/release-telemetry.js';

const option = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const root = resolve(option('--root') ?? process.cwd());
const runs = readReleaseTelemetry(root, 64).sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
const all = liveTimingSamples(runs);
const digest = fanOutDigest([root, resolve(root, 'Source')], { machine: currentMachineIdentity(), gitSha: 'replay', dispatcher: 'central' });
const profile = digest.latest?.profile ?? null;

const replay = runs.flatMap(run => {
  const actual = all.filter(sample => sample.runId === run.runId);
  const widths = [...new Set(actual.map(sample => sample.fanOutCount))].sort((a, b) => a - b);
  const before = all.filter(sample => Date.parse(sample.recordedAt) < Date.parse(run.generatedAt));
  return widths.map(width => {
    const matching = actual.filter(sample => sample.fanOutCount === width), calibration = calibrateLiveAnchor(before, { dispatchMode: 'node', fanOutWidth: width }, { now: Date.parse(run.generatedAt) });
    const base = fanOutTimingPlan('BALANCED', width, profile), suggested = applyLiveAnchor(base, calibration);
    const actualStarts = matching.map(sample => sample.observedChromeStartMs), predicted = suggested.children.flatMap(child => child.predictedChromeStartMs ?? []);
    return { runId: run.runId, releaseDate: run.date, topology: { dispatchMode: 'node', fanOutWidth: width },
      actual: { configuredOffsetsMs: matching.map(sample => sample.configuredOffsetMs), observedChromeStartsMs: actualStarts,
        observedLagMs: matching.map(sample => sample.triggerToChromeLagMs) },
      smartV22: { spacingMs: base.spacingMs, groupShiftMs: suggested.groupShiftMs, anchorSource: suggested.anchorSource,
        evidenceStrength: calibration.evidenceStrength, matchingPriorReleases: calibration.releaseCount,
        configuredOffsetsMs: suggested.children.map(child => child.configuredOffsetMs), predictedChromeStartRangeMs: predicted.length ? [Math.min(...predicted), Math.max(...predicted)] : null },
      measurableComparison: { actualChromeStartRangeMs: actualStarts.length ? [Math.min(...actualStarts), Math.max(...actualStarts)] : null },
      caveat: 'Counterfactual local timing only. It does not show provider arrival order and does not claim this would have won.' };
  });
});

console.log(JSON.stringify({ schema: 'smart-timing-v2.2-replay/v1', root, capacityProfileCreatedAt: profile?.createdAt ?? null,
  note: 'Uses only earlier matching REAL_RELEASE samples for each run; response duration/order and provider outcomes are excluded.', replay }, null, 2));
