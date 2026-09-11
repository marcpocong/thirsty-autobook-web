export interface TimingEvent { event: string; monoMs: number; value?: number }
export function releasePerformance(events: readonly TimingEvent[]) {
  const triggerIndex = events.findIndex(e => e.event === 'releaseTriggerFired');
  if (triggerIndex < 0) return null;
  const run = events.slice(triggerIndex), trigger = run[0]!;
  const first = (name: string, source = run) => source.find(e => e.event === name);
  const delta = (a: TimingEvent | undefined, b: TimingEvent | undefined) => a && b && b.monoMs >= a.monoMs
    ? Math.round((b.monoMs - a.monoMs) * 1000) / 1000 : null;
  const enabled = first('targetDateEnabled'), clicked = first('targetDateClicked');
  const grid = first('targetGridReady'), snapshot = first('gridSnapshotCompleted');
  const preference = first('preferenceResolved'), selected = first('selectionVerified');
  const reloads = run.flatMap((event, index) => {
    if (event.event !== 'reloadStarted') return [];
    const next = run.findIndex((e, i) => i > index && e.event === 'reloadStarted');
    const attempt = run.slice(index, next < 0 ? undefined : next);
    const commit = first('reloadCommitted', attempt), venue = first('releaseVenueVerified', attempt), picker = first('releasePickerEnabled', attempt);
    return [{ triggerToCommitMs: delta(trigger, commit), commitToVenueMs: delta(commit, venue),
      venueToPickerMs: delta(venue, picker), pickerToTargetMs: delta(picker, first('targetDateEnabled', attempt)) }];
  });
  return {
    triggerErrorMs: Number.isFinite(trigger.value) ? trigger.value! : null,
    branch: first('targetEnabledWithoutReload') ? 'NO-REFRESH' as const : reloads.length ? 'RELOAD FALLBACK' as const : 'NOT MEASURED' as const,
    triggerToTargetEnabledMs: delta(trigger, enabled), targetEnabledToClickMs: delta(enabled, clicked),
    targetClickToGridMs: delta(clicked, grid), gridToSnapshotMs: delta(grid, snapshot),
    snapshotToPreferenceMs: delta(snapshot, preference), preferenceToSelectionMs: delta(preference, selected),
    triggerToSelectionMs: delta(trigger, selected), reloads,
  };
}
export type ReleasePerformance = NonNullable<ReturnType<typeof releasePerformance>>;
