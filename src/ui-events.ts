import { z } from 'zod';
import { PRECISION_MAX_FAN_OUT } from './workers.js';
import {PreparationResultSchema} from './booking-plan.js';
import {WORKER_IDS} from './workers.js';
const WorkerIdSchema=z.enum(WORKER_IDS);
const measurement=z.number().finite().nullable();
const reload=z.object({triggerToCommitMs:measurement,commitToVenueMs:measurement,venueToPickerMs:measurement,pickerToTargetMs:measurement}).strict();
const counters=z.object({selectionFullGridReads:z.number().int().nonnegative(),preProceedGridReads:z.number().int().nonnegative(),fullGuards:z.number().int().nonnegative(),lightGuards:z.number().int().nonnegative(),slotClicks:z.number().int().nonnegative(),selectionSummaryReads:z.number().int().nonnegative(),reviewParses:z.number().int().nonnegative(),paymentSummaryParses:z.number().int().nonnegative(),termsControlAcquisitions:z.number().int().nonnegative()}).strict();
const workerPerformance=z.object({branch:z.enum(['NO-REFRESH','RELOAD FALLBACK','NOT MEASURED']),triggerErrorMs:measurement,
  triggerToTargetEnabledMs:measurement,targetEnabledToClickMs:measurement,targetClickToGridReadyMs:measurement,gridReadyToSnapshotCompletedMs:measurement,snapshotToPreferenceResolvedMs:measurement,
  preferenceToFirstSlotClickMs:measurement,firstSlotClickToLastStateConfirmedMs:measurement,lastSlotConfirmedToSelectionVerificationMs:measurement,selectionVerificationToBookingProceedMs:measurement,
  proceedToReviewDetectedMs:measurement,reviewDetectedToValidatedMs:measurement,reviewValidatedToPlayerFormDetectedMs:measurement,playerFormDetectedToFillCompletedMs:measurement,fillCompletedToPlayerProceedMs:measurement,
  playerProceedToPaymentSummaryDetectedMs:measurement,paymentSummaryDetectedToValidatedMs:measurement,paymentValidatedToTermsControlMs:measurement,termsControlToTermsCheckedMs:measurement,termsCheckedToFinalButtonActionableMs:measurement,
  finalActionStartedToClickedMs:measurement,finalClickToCheckoutPageMs:measurement,checkoutPageToHoldStatusMs:measurement,holdStatusToQrHandoffMs:measurement,
  triggerToSelectionVerifiedMs:measurement,triggerToBookingProceedMs:measurement,triggerToFinalClickMs:measurement,triggerToQrHandoffMs:measurement,counters,reloads:z.array(reload).max(2)}).strict();
export const ReleasePerformanceSchema=z.object({workers:z.object({A:workerPerformance.nullable(),B:workerPerformance.nullable()}).strict(),overall:z.object({triggerToBothSelectionsVerifiedMs:measurement,triggerToBothFinalClicksMs:measurement,triggerToBothQrHandoffsMs:measurement}).strict()}).strict();

// Opt-in stdout protocol. Ordinary CLI output and buffered telemetry remain intact.
export const UiEventSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('apiStage'),stage:z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),elapsedMs:z.number().int().nonnegative(),
    at:z.iso.datetime().optional(),sincePreviousMs:z.number().int().nonnegative().optional(),runId:z.uuid().optional(),
    code:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),workerId:WorkerIdSchema.optional(),workerElapsedMs:z.number().int().nonnegative().optional(),port:z.number().int().optional(),releaseMs:z.number().int().optional(),
    releaseOffsetMs:z.number().int().min(-2000).max(2000).optional(),triggerMs:z.number().int().optional(),
    bookingMethod:z.enum(['browser','hybrid','api-first','proofless']).optional(),
    prewarmLeadMs:z.number().int().positive().optional(),
    date:z.iso.date().optional(),court:z.number().int().min(1).max(7).optional(),courtB:z.number().int().min(1).max(7).optional(),startTime:z.string().optional(),
    durationHours:z.number().int().min(1).max(6).optional(),price:z.number().finite().optional(),assumedPrice:z.number().finite().optional(),
    status:z.enum(['fulfilled','rejected']).optional(),
    attempt:z.enum(['initial','retry']).optional(),workerCount:z.number().int().optional(),completedWorkers:z.number().int().optional(),
    failedWorkers:z.number().int().optional(),verifiedHold:z.boolean().optional(),availabilityMs:z.number().int().optional(),
    bookingId:z.string().optional(),bookingNo:z.string().optional(),holdExpiresAt:z.string().optional(),
    // Pre-release evidence, clock refresh, dispatch timing and Precision race fields (all scalar, no identities).
    checkpoint:z.string().regex(/^[A-Z0-9_+-]{1,24}$/).optional(),duplicateOf:WorkerIdSchema.optional(),evidence:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),outcome:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),attemptState:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),availabilityState:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),
    endTime:z.string().regex(/^([01]\d|2[0-4]):00$/).optional(),eligible:z.boolean().optional(),qrAttention:z.boolean().optional(),ok:z.boolean().optional(),
    readSource:z.enum(['availability','bookings']).optional(),failedCourts:z.string().regex(/^([1-7](,[1-7]){0,6})?$/).optional(),attemptNo:z.number().int().positive().optional(),
    offsetMs:z.number().finite().optional(),roundTripMs:z.number().finite().optional(),deltaMs:z.number().finite().optional(),
    maxPrePostMs:z.number().finite().optional(),maxFetchInvokedMs:z.number().finite().optional(),
    maxBrowserRequestStartMs:z.number().finite().optional(),maxRequestObservedMs:z.number().finite().optional(),
    sampleCount:z.number().int().nonnegative().optional(),spreadMs:z.number().finite().nonnegative().optional(),uncertaintyMs:z.number().finite().nonnegative().optional(),releaseLatenessMs:z.number().finite().optional(),contextAgeMs:z.number().finite().optional(),
    targetCount:z.number().int().nonnegative().optional(),frozenCount:z.number().int().nonnegative().optional(),verifiedCount:z.number().int().nonnegative().optional(),unknownCount:z.number().int().nonnegative().optional(),rejectedCount:z.number().int().nonnegative().optional(),unsentCount:z.number().int().nonnegative().optional(),
    candidateId:z.string().regex(/^[a-f0-9]{64}$/).optional(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/).optional(),
    attemptId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
    candidateCount:z.number().int().nonnegative().optional(),wave1Count:z.number().int().nonnegative().optional(),standbyCount:z.number().int().nonnegative().optional(),
    priority:z.number().int().positive().optional(),
    maxWave2:z.number().int().nonnegative().optional(),maxRescue:z.number().int().nonnegative().optional(),maxTotal:z.number().int().nonnegative().optional(),
    attemptCount:z.number().int().nonnegative().optional(),seq:z.number().int().positive().optional(),evidenceSeq:z.number().int().positive().optional(),
    selectedEvidenceSeq:z.number().int().positive().optional(),fromSeq:z.number().int().positive().optional(),toSeq:z.number().int().positive().optional(),
    reason:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),priceChanged:z.boolean().optional(),budgetReleased:z.boolean().optional(),
    amount:z.number().finite().optional(),wave:z.enum(['WAVE_1','WAVE_2','RESCUE']).optional(),
    fitness:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),cache:z.string().regex(/^[A-Z_]{2,16}$/).optional(),
    rateStatus:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),source:z.string().max(100).optional(),capturedAt:z.iso.datetime().optional(),
    message:z.string().max(240).optional(),state:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),
    // Fan-out child of a logical target (Fixed or Smart) and the prewarm plan.
    fanOutIndex:z.number().int().min(0).max(PRECISION_MAX_FAN_OUT-1).optional(),fanOutCount:z.number().int().min(1).max(PRECISION_MAX_FAN_OUT).optional(),durationMs:z.number().finite().nonnegative().optional(),
    predictedReadyOffsetMs:z.number().finite().optional(),actualReadyOffsetMs:z.number().finite().optional(),predictionErrorMs:z.number().finite().optional(),
    queueDelayMs:z.number().finite().nonnegative().optional(),prepDurationMs:z.number().finite().nonnegative().optional(),omittedReason:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),
    shotIndex:z.number().int().nonnegative().optional(),shotCount:z.number().int().positive().optional(),timingBucket:z.enum(['< -500 ms','-500 to -100 ms','-100 to 0 ms','0 to +100 ms','+100 to +250 ms','> +250 ms']).optional(),
    // Rescue V2 reopen predictions (release-relative ms) and their observed error.
    predictedStartMs:z.number().finite().optional(),predictedEndMs:z.number().finite().optional(),errorMs:z.number().finite().optional(),
    confidence:z.string().regex(/^[A-Z][A-Z0-9_]{0,40}$/).optional(),contextReused:z.boolean().optional()}).strict(),
  z.object({type:z.literal('preparationResult'),result:PreparationResultSchema}).strict(),
  z.object({type:z.literal('preparationProgress'),step:z.enum(['starting','previous-session','holds','onda','calendar','grids','availability','final'])}).strict(),
  z.object({type:z.literal('preparationBlocked'),browser:WorkerIdSchema,hold:z.enum(['Active','Expired','Not detected','Unknown']),countdownSeconds:z.number().int().nonnegative().nullable()}).strict(),
  z.object({type:z.literal('blockAudit'),date:z.iso.date(),cells:z.array(z.object({court:z.number().int().min(1).max(7),hour:z.string().regex(/^(0[89]|1\d|2[0-3]):00$/),
    status:z.enum(['OPEN','BLOCKED','UNRELEASED','UNKNOWN']),source:z.enum(['AVAILABILITY','PUBLIC_BOOKING','DATE_UNRELEASED','NO_AUTHORITATIVE_RECORD','PUBLIC_BOOKING_QUERY_FAILED','AVAILABILITY_READ_FAILED']),price:z.number().finite().optional()}).strict()).length(112)}).strict(),
  z.object({type:z.literal('bookingResult'),status:z.enum(['AVAILABLE','CANCELLED','SELECTION_VERIFIED','PAYMENT HOLD ACTIVE','PARTIAL SUCCESS','BOOKING FAILED']),description:z.string().max(2000),outcomes:z.array(z.enum(['PAYMENT HOLD ACTIVE','FAILED'])).max(4)}).strict(),
  z.object({ type:z.literal('dualWorker'), workerId:z.enum(['A','B']), state:z.enum(['ready','clean','selection','checkout','hold','unknown']), verifiedAt:z.iso.datetime(), court:z.number().int().min(1).max(7).optional(), date:z.iso.date().optional(), hours:z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)).max(16).optional(), amount:z.number().positive().optional() }).strict(),
  z.object({ type:z.literal('dualResult'), status:z.enum(['DUAL_DRY_PASS','DUAL_SELECTION_PASS','DUAL_SELECTION_VERIFIED','DUAL_HOLD_VERIFIED','DUAL_PARTIAL_SUCCESS','DUAL_FAILED']), date:z.iso.date(), start:z.string().regex(/^(0[89]|1\d|2[0-3]):00$/), hours:z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)).min(1).max(16), courtA:z.number().int().min(1).max(7), courtB:z.number().int().min(1).max(7), candidateSource:z.enum(['UI_ONLY','API+UI']) }).strict(),
  z.object({ type: z.literal('releasePerformance'), summary: ReleasePerformanceSchema }).strict(),
  z.object({type:z.literal('handoff'),workerId:WorkerIdSchema.optional(),date:z.iso.date(),court:z.number().int().min(1).max(7),hours:z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)).min(1).max(16),amount:z.number().finite().positive(),currency:z.literal('PHP'),status:z.literal('Pending'),countdown:z.string().regex(/^\d{1,2}:[0-5]\d$/),verifiedAt:z.iso.datetime()}).strict(),
  z.object({ type: z.literal('selection'), date: z.iso.date(), court: z.number().int().min(1).max(7), hours: z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)).min(1).max(16), amount: z.number().finite().positive(), proceedReady: z.literal(true), attempts: z.number().int().min(1).max(5) }).strict(),
  z.object({ type: z.literal('telemetry'), event: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/), wall: z.iso.datetime(), value: z.number().finite().optional(), workerId:z.enum(['A','B']).optional() }).strict(),
  z.object({ type: z.literal('inspection'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), gridToday: z.boolean(), selected: z.number().int().nonnegative().nullable(), allCourts: z.boolean(), visible: z.boolean(), verifiedAt: z.iso.datetime() }).strict(),
  z.object({ type: z.literal('plan'), targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), releaseMs: z.number().finite(), timezone: z.string().max(80) }).strict(),
  z.object({ type: z.literal('error'), code: z.string().regex(/^[A-Z_]{1,80}$/) }).strict(),
]);
export type UiEvent = z.infer<typeof UiEventSchema>;
export function emitUiEvent(event: UiEvent) {
  if (process.env.THIRSTY_UI_EVENTS === '1') process.stdout.write(`THIRSTY_EVENT ${JSON.stringify(event)}\n`);
}
