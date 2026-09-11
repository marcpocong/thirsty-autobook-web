import { it, expect } from 'vitest';
import { releasePerformance, type TimingEvent } from '../src/release-performance.js';
import { Telemetry } from '../src/telemetry.js';
import { UiEventSchema } from '../src/ui-events.js';
const e = (event: string, monoMs: number, value?: number): TimingEvent => ({ event, monoMs, value });
it('computes no-refresh phases using monotonic values and retains trigger wall-clock error separately', () => {
  const summary = releasePerformance([e('releaseTriggerFired',100,4),e('targetEnabledWithoutReload',101),e('targetDateEnabled',102),e('targetDateClicked',112),e('targetGridReady',150),e('gridSnapshotCompleted',160),e('preferenceResolved',165),e('selectionVerified',200)]);
  expect(summary).toEqual({ branch:'NO-REFRESH',triggerErrorMs:4,triggerToTargetEnabledMs:2,targetEnabledToClickMs:10,targetClickToGridMs:38,gridToSnapshotMs:10,snapshotToPreferenceMs:5,preferenceToSelectionMs:35,triggerToSelectionMs:100,reloads:[] });
  expect(UiEventSchema.safeParse({type:'releasePerformance',summary}).success).toBe(true);
});
it('keeps separate reload attempts and missing measurements null on failure', () => {
  const summary = releasePerformance([e('releaseTriggerFired',100),e('reloadStarted',101),e('reloadCommitted',130),e('releaseVenueVerified',150),e('releasePickerEnabled',170),e('reloadStarted',1100),e('reloadCommitted',1200),e('failed',1300)])!;
  expect(summary.reloads).toEqual([{triggerToCommitMs:30,commitToVenueMs:20,venueToPickerMs:20,pickerToTargetMs:null},{triggerToCommitMs:1100,commitToVenueMs:null,venueToPickerMs:null,pickerToTargetMs:null}]);
  expect(summary.triggerErrorMs).toBeNull(); expect(summary.triggerToSelectionMs).toBeNull();
  expect(releasePerformance([e('armed',10)])).toBeNull();
});
it('immediate failure document preserves rate-limit source and available release timings', () => {
  const t = new Telemetry(); t.mark('releaseTriggerFired',4);t.mark('reloadStarted');t.mark('reloadCommitted');
  const evidence = {reason:'RATE_LIMITED' as const,timestamp:new Date().toISOString(),monoMs:performance.now(),hostname:'app.onda.fit',status:429,resourceType:'fetch',navigation:false,retryAfterPresent:false,sameOndaSite:true};
  const saved = t.document('RATE_LIMITED', evidence);
  expect(saved.failure).toBe('RATE_LIMITED');expect(saved.stopEvidence).toEqual(evidence);
  expect(saved.releasePerformance?.branch).toBe('RELOAD FALLBACK');
  expect(saved.releasePerformance?.triggerToTargetEnabledMs).toBeNull();
});
