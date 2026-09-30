import type { Dashboard } from '../types.js';
import { byId, el, empty, table } from './dom.js';
import { calibrateLiveAnchor, liveTimingSamples } from '../../src/live-anchor-calibration.js';
import {calibrateTimingDeskew} from '../../src/timing-deskew.js';

/** HISTORY & INSIGHTS analysis panels. Evidence only; none of this predicts or decides a booking. */
const ms = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)} ms`;

export function renderFanOutBenchmark(state: Dashboard): void {
  const host = byId('fanout-benchmark'), digest = state.fanOut;
  if (!digest || (!digest.latest && !digest.history.length)) {
    host.replaceChildren(empty('No capacity profile for this machine yet. Run: npx tsx scripts/benchmark-fanout-capacity.ts --workers 7 --widths 1,2,3,4 --runs 40 --save-profile'));
    return;
  }
  const parts: HTMLElement[] = [];
  const latest = digest.latest;
  if (latest) {
    parts.push(el('p', 'tool-verdict', `Machine recommendation: ${latest.recommendedWidth} attempt${latest.recommendedWidth === 1 ? '' : 's'} per target (local dispatch only)`));
    parts.push(el('p', 'small', `Measured ${latest.createdAt.slice(0, 16).replace('T', ' ')} UTC with the ${latest.dispatcher} dispatcher${latest.stale ? ' · STALE' : ''}.`));
    const reasons = el('ul', 'strategy-children'); reasons.append(...latest.reasons.map(reason => el('li', '', reason)), ...latest.notes.map(note => el('li', 'warn-text', note)));
    parts.push(reasons);
    parts.push(table(['Width', 'Attempts', 'Trigger→Chrome p50', 'p95', 'p99', 'max', 'Spread p95', 'Per child p95'],
      latest.widths.map(width => [`${width.width} per target`, String(width.attempts), ms(width.chromeP50), ms(width.chromeP95), ms(width.chromeP99), ms(width.chromeMax),
        ms(width.spreadP95), width.perChildP95.map(value => ms(value)).join(' · ')])));
  } else parts.push(el('p', 'small warn-text', 'No profile is compatible with this machine and the production dispatcher; the history below is for reference only.'));
  if (digest.history.length) {
    const details = el('details', 'tool-details'); details.append(el('summary', '', `Benchmark history (${digest.history.length})`));
    details.append(table(['Measured', 'Dispatcher', 'Recommended', 'Compatible', '7×1 p95', '7×4 p95'], digest.history.map(entry => [entry.createdAt.slice(0, 16).replace('T', ' '),
      entry.dispatcher, `${entry.recommendedWidth} per target`, entry.compatible ? entry.stale ? 'yes (stale)' : 'yes' : 'no',
      ms(entry.widths.find(width => width.width === 1)?.chromeP95), ms(entry.widths.find(width => width.width === 4)?.chromeP95)])));
    parts.push(details);
  }
  host.replaceChildren(...parts);
}

export function renderOffsetCalibration(state: Dashboard): void {
  const host = byId('offset-calibration'), runs = (state.telemetry ?? []).filter(run => run.children.some(child => child.errorMs !== null));
  if (!runs.length) { host.replaceChildren(empty('No recorded release with per-child configured offsets and Chrome request times yet.')); return; }
  const parts: HTMLElement[] = [];
  for (const run of runs.slice(0, 4)) {
    const summary = run.summary;
    const width = Math.max(...run.children.map(child => child.fanOutCount)), benchmark = state.fanOut?.latest?.widths.find(value => value.width === width);
    const staleCalibration = summary.configuredToChrome.n >= 5 && summary.configuredToChrome.p95 !== null && benchmark?.chromeP95 !== null && benchmark?.chromeP95 !== undefined
      && summary.configuredToChrome.p95 > Math.max(benchmark.chromeP95 * 2, benchmark.chromeP95 + 10);
    parts.push(el('h3', '', `${run.date ?? 'Release'} · run ${run.runId.slice(0, 8)}`));
    parts.push(el('p', 'small', `Configured → Chrome request: p50 ${ms(summary.configuredToChrome.p50)}, p95 ${ms(summary.configuredToChrome.p95)}, max ${ms(summary.configuredToChrome.max)} · `
      + `spread ${ms(summary.spreadMs)}${summary.compression !== null ? ` · offsets preserved ${Math.round(summary.compression * 100)}%` : ''}`
      + `${summary.prewarmHeadroomMs.min !== null ? ` · prewarm headroom min ${(summary.prewarmHeadroomMs.min / 1000).toFixed(1)} s` : ''}`
      + `${summary.adaptiveSelectionToPost.n ? ` · Wave 2/Rescue selection→POST p50 ${ms(summary.adaptiveSelectionToPost.p50)}` : ''}`));
    parts.push(table(['Child', 'Configured', 'Chrome request start', 'Error', 'Outcome'], run.children.map(child =>
      [child.label, ms(child.configuredOffsetMs), ms(child.chromeStartMs), ms(child.errorMs), (child.finalState ?? '—').replaceAll('_', ' ').toLowerCase()])));
    if (summary.perChildIndex.length > 1) parts.push(el('p', 'small', `Per fan-out position (p95 error): ${summary.perChildIndex.map(value => `#${value.fanOutIndex} ${ms(value.error.p95)}`).join(' · ')}`));
    if (staleCalibration) parts.push(el('p', 'small warn-text', 'Timing calibration may be stale. Re-run the fan-out benchmark. Recorded Chrome-start lag strongly exceeds the compatible machine profile; offsets were not changed.'));
  }
  host.replaceChildren(...parts);
}

export function renderLiveAnchorCalibration(state: Dashboard): void {
  const host = byId('live-anchor-calibration'), samples = liveTimingSamples(state.telemetry ?? []);
  const machine = state.fanOut?.latest?.profile.machine;
  const machineKey = machine ? JSON.stringify({ cpuModel: machine.cpuModel, logicalCores: machine.logicalCores, totalMemGb: machine.totalMemGb,
    platform: machine.platform, osRelease: machine.osRelease }) : null;
  const rows = [1, 2, 3, 4].map(width => calibrateLiveAnchor(samples, { dispatchMode: 'node', fanOutWidth: width, machineKey, runtimeKey: machine?.chromeVersion ?? null }));
  if (!rows.some(row => row.sampleCount||row.staleSampleCount)) { host.replaceChildren(empty('No valid real-release samples with configured offset, trusted-clock Chrome start, and confirmed dispatch.')); return; }
  const parts: HTMLElement[] = [table(['Topology', 'Fresh samples', 'Fresh releases', 'Old excluded', 'Median release lag', 'p95 releases', 'Range', 'Evidence', 'Freshness'], rows.map(row => [
    `Node · width ${row.fanOutWidth}`, String(row.sampleCount), String(row.releaseCount), String(row.staleSampleCount),ms(row.medianLagMs), ms(row.p95LagMs),
    row.minLagMs === null ? '—' : `${ms(row.minLagMs)}…${ms(row.maxLagMs)}`, row.evidenceStrength, row.latestSampleAt ? `${row.latestSampleAt.slice(0, 10)}${row.stale ? ' · STALE' : ''}` : '—']))];
  const width=state.booking?.setup.PRECISION_PHASE3?.wave1[0]?.fanOutOffsetsMs?.length??1,anchor=rows.find(row=>row.fanOutWidth===width)!;
  const deskew=calibrateTimingDeskew(samples,anchor,{dispatchMode:'node',fanOutWidth:width,machineKey,runtimeKey:machine?.chromeVersion??null});
  const corrections=deskew.corrections.filter(value=>value.correctionMs!==0||value.matchingReleases>0);
  if(corrections.length){const details=el('details','tool-details');details.append(el('summary','',`Worker / index local de-skew (${corrections.length})`),
    table(['Worker/index','Worker correction','Index correction','Final correction','Releases','Evidence'],corrections.map(value=>[`${value.workerId}${value.fanOutIndex}`,ms(value.workerCorrectionMs),ms(value.fanOutIndexCorrectionMs),ms(value.correctionMs),String(value.matchingReleases),value.evidenceStrength])));parts.push(details);}
  const medians=rows.flatMap(row=>row.releaseMedians.map(value=>[`width ${row.fanOutWidth} · ${value.recordedAt.slice(0,10)}`,String(value.sampleCount),ms(value.medianLagMs)]));
  if(medians.length){const details=el('details','tool-details');details.append(el('summary','',`Release-level votes (${medians.length})`),table(['Release','Children','Median lag'],medians));parts.push(details);}
  const byRun = new Map<string, typeof samples>(); for (const sample of samples.filter(value => value.origin === 'REAL_RELEASE')) {
    const list = byRun.get(sample.runId) ?? []; list.push(sample); byRun.set(sample.runId, list);
  }
  if (byRun.size) { const details = el('details', 'tool-details'); details.append(el('summary', '', `Run-by-run (${byRun.size})`), table(['Release', 'Width', 'Samples', 'Median lag'],
    [...byRun.entries()].map(([runId, values]) => { const width = values[0]?.fanOutCount ?? 1, summary = calibrateLiveAnchor(values, { dispatchMode: values[0]?.dispatchMode ?? 'node', fanOutWidth: width });
      return [values[0]?.recordedAt.slice(0, 10) ?? runId.slice(0, 8), String(width), String(values.length), ms(summary.medianLagMs)]; }))); parts.push(details); }
  parts.push(el('p', 'small', 'Only REAL_RELEASE rows calibrate the anchor. Synthetic/offline data, HTTP response duration/order, outcomes, and undocumented provider timestamp candidates are excluded.'));
  host.replaceChildren(...parts);
}

export function renderReopenAccuracy(state: Dashboard): void {
  const host = byId('reopen-accuracy');
  const watches = (state.slotWatchHistory ?? []).filter(watch => watch.quality?.expiryPredictions);
  const runErrors = (state.telemetry ?? []).filter(run => run.summary.reopenPredictionErrorMs.n);
  if (!watches.length && !runErrors.length) { host.replaceChildren(empty('No scored predictions yet. They appear after a watched release in which a slot turned unavailable and later reopened.')); return; }
  const parts: HTMLElement[] = [];
  if (watches.length) parts.push(table(['Release date', 'Predicted', 'Reopened in window', 'Outside', 'Not reopened', 'Median |error|'], watches.slice(0, 8).map(watch => {
    const value = watch.quality!.expiryPredictions!;
    return [watch.date, String(value.predicted), String(value.reopenedInWindow), String(value.reopenedOutside), String(value.notReopened),
      value.medianAbsErrorMs === null ? '—' : `${(value.medianAbsErrorMs / 1000).toFixed(1)} s`];
  })));
  if (runErrors.length) parts.push(el('p', 'small', `Rescue selections with a prediction: ${runErrors.map(run => `${run.date ?? run.runId.slice(0, 8)} median error ${ms(run.summary.reopenPredictionErrorMs.p50)}`).join(' · ')}`));
  host.replaceChildren(...parts);
}

export function renderInsights(state: Dashboard): void {
  renderFanOutBenchmark(state);
  renderOffsetCalibration(state);
  renderLiveAnchorCalibration(state);
  renderReopenAccuracy(state);
}
