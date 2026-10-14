import {it,expect} from 'vitest';
import {releasePerformance,type TimingEvent} from '../src/release-performance.js';
import {Telemetry,sanitizedOperationFailureCode} from '../src/telemetry.js';
import {UiEventSchema} from '../src/ui-events.js';
const e=(event:string,monoMs:number,workerId?:'A'|'B',value?:number):TimingEvent=>({event,monoMs,...(workerId?{workerId}:{}),...(value===undefined?{}:{value})});
const flow=(id:'A'|'B',offset=0)=>[
  e('releaseTriggerFired',100,id,4),e('targetEnabledWithoutReload',101,id),e('targetDateEnabled',102,id),e('targetDateClicked',112,id),e('targetGridReady',150,id),e('gridSnapshotCompleted',160,id),e('preferenceResolved',165,id),e('selectionAttemptStarted',166,id),e('slot1ClickStarted',170,id),e('slot1StateConfirmed',180,id),e('selectionFinalVerificationCompleted',190,id),e('selectionVerified',200+offset,id),e('bookingProceedClicked',210+offset,id),e('reviewDetected',220+offset,id),e('reviewValidated',225+offset,id),e('playerFormDetected',230+offset,id),e('playerFillCompleted',240+offset,id),e('playerProceedClicked',245+offset,id),e('paymentSummaryDetected',260+offset,id),e('paymentSummaryValidated',270+offset,id),e('termsControlDetected',275+offset,id),e('termsChecked',280+offset,id),e('finalButtonActionable',285+offset,id),e('finalOndaActionStarted',290+offset,id),e('finalOndaButtonClicked',295+offset,id),e('checkoutPageDetected',300+offset,id),e('holdStatusDetected',305+offset,id),e('qrHandoffVerified',310+offset,id),e('selectionFinalGridRead',185,id),e('selectionFullGridRead',185,id),e('preProceedGridRead',205,id),e('fullGuardCompleted',167,id),e('lightGuardCompleted',168,id),e('selectionSummaryRead',195,id),e('reviewParsed',219,id),e('paymentSummaryParsed',259,id),
];
it('aggregates Standard Browser A through QR handoff and validates the strict UI schema',()=>{
  const summary=releasePerformance(flow('A'))!;expect(summary.workers.B).toBeNull();expect(summary.workers.A).toMatchObject({branch:'NO-REFRESH',triggerToTargetEnabledMs:2,targetEnabledToClickMs:10,targetClickToGridReadyMs:38,gridReadyToSnapshotCompletedMs:10,snapshotToPreferenceResolvedMs:5,triggerToSelectionVerifiedMs:100,triggerToQrHandoffMs:210});
  expect(summary.workers.A!.counters).toMatchObject({selectionFullGridReads:1,preProceedGridReads:1,fullGuards:1,lightGuards:1,slotClicks:1,selectionSummaryReads:1,reviewParses:1,paymentSummaryParses:1,termsControlAcquisitions:1});
  expect(UiEventSchema.safeParse({type:'releasePerformance',summary}).success).toBe(true);
});
it.each([['A',40,10,250],['B',10,40,250]] as const)('Extended overall uses the slower %s worker',(_slower,a,b,expected)=>{
  const summary=releasePerformance([...flow('A',a),...flow('B',b)])!;
  expect(summary.overall).toEqual({triggerToBothSelectionsVerifiedMs:140,triggerToBothFinalClicksMs:235,triggerToBothQrHandoffsMs:expected});
});
it('keeps missing measurements null and Test Now does not invent a release summary',()=>{
  const summary=releasePerformance([e('releaseTriggerFired',100,'A'),e('reloadStarted',101,'A'),e('reloadCommitted',130,'A')])!;
  expect(summary.workers.A!.reloads[0]).toEqual({triggerToCommitMs:30,commitToVenueMs:null,venueToPickerMs:null,pickerToTargetMs:null});
  expect(summary.workers.A!.triggerToSelectionVerifiedMs).toBeNull();expect(releasePerformance([e('selectionAttemptStarted',10,'A')])).toBeNull();
});
it('keeps one run ID, tags worker events, leaves coordinator events unscoped and rejects arbitrary metadata',()=>{
  const t=new Telemetry(),A=t.worker('A'),B=t.worker('B');A.mark('slot1ClickStarted');t.mark('dualSelectionStarted');B.mark('slot1ClickStarted');
  expect(A.runID).toBe(t.runID);expect(B.runID).toBe(t.runID);expect(t.events.map(x=>x.workerId)).toEqual(['A',undefined,'B']);
  expect(UiEventSchema.safeParse({type:'telemetry',event:'slot1ClickStarted',wall:new Date().toISOString(),workerId:'A'}).success).toBe(true);
  expect(UiEventSchema.safeParse({type:'telemetry',event:'slot1ClickStarted',wall:new Date().toISOString(),workerId:'A',metadata:{email:'private@example.com'}}).success).toBe(false);
  expect(UiEventSchema.safeParse({type:'apiStage',stage:'CANDIDATE_READY',elapsedMs:1,workerId:'A',
    date:'2026-09-22',court:7,startTime:'12:00',durationHours:6,price:3600}).success).toBe(true);
});
it('documents an immediate rate-limit failure without private evidence expansion',()=>{
  const t=new Telemetry(),A=t.worker('A');A.mark('releaseTriggerFired',4);A.mark('reloadStarted');A.mark('reloadCommitted');
  const evidence={reason:'RATE_LIMITED' as const,timestamp:new Date().toISOString(),monoMs:performance.now(),hostname:'app.onda.fit',status:429,resourceType:'fetch',navigation:false,retryAfterPresent:false,sameOndaSite:true};
  const saved=t.document('RATE_LIMITED',evidence);expect(saved.failure).toBe('RATE_LIMITED');expect(saved.releasePerformance?.workers.A?.branch).toBe('RELOAD FALLBACK');
});
it('preserves a safe Playwright category through wrapped causes without serializing exception text',()=>{
  const original=Object.assign(Error('private URL and token'),{name:'TimeoutError'}),wrapped=Error('wrapper',{cause:original});
  expect(sanitizedOperationFailureCode(wrapped)).toBe('PLAYWRIGHT_TIMEOUT');
  const t=new Telemetry();t.worker('A').recordReleaseFailure('WAIT_FOR_VENUE_ATTACHED','not allowlisted','not allowlisted',999);
  // The random runID UUID can contain any digits; scan everything else for leaked text or the duration.
  const {runID:_runID,...document}=t.document(sanitizedOperationFailureCode(wrapped)),text=JSON.stringify(document);
  expect(text).toContain('RELEASE_SHELL_UNCLASSIFIED');expect(text).toContain('UNCLASSIFIED');expect(text).not.toContain('private');expect(text).not.toContain('999');
});
