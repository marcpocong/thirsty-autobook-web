import { z } from 'zod';
import {PreparationResultSchema} from './booking-plan.js';
const measurement = z.number().finite().nullable();
export const ReleasePerformanceSchema = z.object({
  triggerErrorMs: measurement, branch: z.enum(['NO-REFRESH', 'RELOAD FALLBACK', 'NOT MEASURED']),
  triggerToTargetEnabledMs: measurement, targetEnabledToClickMs: measurement, targetClickToGridMs: measurement,
  gridToSnapshotMs: measurement, snapshotToPreferenceMs: measurement, preferenceToSelectionMs: measurement,
  triggerToSelectionMs: measurement,
  reloads: z.array(z.object({ triggerToCommitMs: measurement, commitToVenueMs: measurement, venueToPickerMs: measurement, pickerToTargetMs: measurement }).strict()).max(2),
}).strict();

// Opt-in stdout protocol. Ordinary CLI output and buffered telemetry remain intact.
export const UiEventSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('preparationResult'),result:PreparationResultSchema}).strict(),
  z.object({type:z.literal('preparationProgress'),step:z.enum(['starting','previous-session','holds','onda','calendar','grids','availability','final'])}).strict(),
  z.object({type:z.literal('preparationBlocked'),browser:z.enum(['A','B']),hold:z.enum(['Active','Expired','Not detected','Unknown']),countdownSeconds:z.number().int().nonnegative().nullable()}).strict(),
  z.object({type:z.literal('bookingResult'),status:z.enum(['AVAILABLE','CANCELLED','SELECTION_VERIFIED','PAYMENT HOLD ACTIVE','PARTIAL SUCCESS','BOOKING FAILED']),description:z.string().max(2000),outcomes:z.array(z.enum(['PAYMENT HOLD ACTIVE','FAILED'])).max(2)}).strict(),
  z.object({ type:z.literal('dualWorker'), workerId:z.enum(['A','B']), state:z.enum(['ready','clean','selection','checkout','hold','unknown']), verifiedAt:z.iso.datetime(), court:z.number().int().min(1).max(7).optional(), date:z.iso.date().optional(), hours:z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)).max(16).optional(), amount:z.number().positive().optional() }).strict(),
  z.object({ type:z.literal('dualResult'), status:z.enum(['DUAL_DRY_PASS','DUAL_SELECTION_PASS','DUAL_SELECTION_VERIFIED','DUAL_HOLD_VERIFIED','DUAL_PARTIAL_SUCCESS','DUAL_FAILED']), date:z.iso.date(), start:z.string().regex(/^(0[89]|1\d|2[0-3]):00$/), hours:z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)).min(1).max(16), courtA:z.number().int().min(1).max(7), courtB:z.number().int().min(1).max(7), candidateSource:z.enum(['UI_ONLY','API+UI']) }).strict(),
  z.object({ type: z.literal('releasePerformance'), summary: ReleasePerformanceSchema }).strict(),
  z.object({type:z.literal('handoff'),date:z.iso.date(),court:z.number().int().min(1).max(7),hours:z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)).min(1).max(16),amount:z.number().finite().positive(),currency:z.literal('PHP'),status:z.literal('Pending'),countdown:z.string().regex(/^\d{1,2}:[0-5]\d$/),verifiedAt:z.iso.datetime()}).strict(),
  z.object({ type: z.literal('selection'), date: z.iso.date(), court: z.number().int().min(1).max(7), hours: z.array(z.string().regex(/^(0[89]|1\d|2[0-3]):00$/)).min(1).max(16), amount: z.number().finite().positive(), proceedReady: z.literal(true), attempts: z.number().int().min(1).max(5) }).strict(),
  z.object({ type: z.literal('telemetry'), event: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/), wall: z.iso.datetime(), value: z.number().finite().optional() }).strict(),
  z.object({ type: z.literal('inspection'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), gridToday: z.boolean(), selected: z.number().int().nonnegative().nullable(), allCourts: z.boolean(), visible: z.boolean(), verifiedAt: z.iso.datetime() }).strict(),
  z.object({ type: z.literal('plan'), targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), releaseMs: z.number().finite(), timezone: z.string().max(80) }).strict(),
  z.object({ type: z.literal('error'), code: z.string().regex(/^[A-Z_]{1,80}$/) }).strict(),
]);
export type UiEvent = z.infer<typeof UiEventSchema>;
export function emitUiEvent(event: UiEvent) {
  if (process.env.THIRSTY_UI_EVENTS === '1') process.stdout.write(`THIRSTY_EVENT ${JSON.stringify(event)}\n`);
}
