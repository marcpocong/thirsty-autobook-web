import type { Dashboard } from '../types.js';
import { byId, el, empty, table } from './dom.js';

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
  renderReopenAccuracy(state);
}
