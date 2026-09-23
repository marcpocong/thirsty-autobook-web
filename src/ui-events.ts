import { z } from 'zod';
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
    sessionMode:z.enum(['normal','special-friday']).optional(),bookingMethod:z.enum(['browser','hybrid','api-first','proofless']).optional(),
    prewarmLeadMs:z.number().int().positive().optional(),directPrewarmLeadMs:z.number().int().positive().optional(),
    date:z.iso.date().optional(),court:z.number().int().min(1).max(7).optional(),courtB:z.number().int().min(1).max(7).optional(),startTime:z.string().optional(),
    durationHours:z.number().int().min(1).max(6).optional(),price:z.number().finite().optional(),assumedPrice:z.number().finite().optional(),
    rateSource:z.enum(['FRIDAY_AVAILABILITY','UNVERIFIED_PRIOR_RATE']).optional(),status:z.enum(['fulfilled','rejected']).optional(),
    attempt:z.enum(['initial','retry']).optional(),workerCount:z.number().int().optional(),completedWorkers:z.number().int().optional(),
    failedWorkers:z.number().int().optional(),verifiedHold:z.boolean().optional(),availabilityMs:z.number().int().optional(),
    bookingId:z.string().optional(),bookingNo:z.string().optional(),holdExpiresAt:z.string().optional()}).strict(),
  z.object({type:z.literal('preparationResult'),result:PreparationResultSchema}).strict(),
  z.object({type:z.literal('preparationProgress'),step:z.enum(['starting','previous-session','holds','onda','calendar','grids','availability','final'])}).strict(),
  z.object({type:z.literal('preparationBlocked'),browser:WorkerIdSchema,hold:z.enum(['Active','Expired','Not detected','Unknown']),countdownSeconds:z.number().int().nonnegative().nullable()}).strict(),
  z.object({type:z.literal('blockAudit'),date:z.iso.date(),cells:z.array(z.object({court:z.number().int().min(1).max(7),hour:z.string().regex(/^(0[89]|1\d|2[0-3]):00$/),
    status:z.enum(['OPEN','BLOCKED','UNRELEASED','UNKNOWN']),source:z.enum(['AVAILABILITY','PUBLIC_BOOKING','DATE_UNRELEASED','NO_AUTHORITATIVE_RECORD','PUBLIC_BOOKING_QUERY_FAILED']),price:z.number().finite().optional()}).strict()).length(112)}).strict(),
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
