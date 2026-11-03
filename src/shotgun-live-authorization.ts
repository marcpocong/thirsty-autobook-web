import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ShotgunLiveRequestSchema, liveLabRequests } from './shotgun-live-rehearsal.js';

/** Pin the installed production lifecycle, including independent verification and QR recovery. */
export const REHEARSAL_MODULES = [
  'api-booking/armed-dispatch.js','api-booking/precision-race.js','api-booking/armed-request.js',
  'api-booking/browser-session-transport.js','api-booking/proofless-checkout.js','api-booking/public-checkout.js',
  'api-booking/durable-submission-journal.js','api-booking/submission-errors.js',
  'api-booking/calendar-free-security-context.js','api-booking/calendar-free-security-context-browser.js',
  'api-booking/checkout-recovery.js','api-booking/pending-hold-recovery.js','api-booking/provider-hold-verification.js',
  'api-booking/recovery-claim.js','api-booking/pending-hold-state.js','api-booking/qr-order-summary.js',
  'api-booking/hold-confirmation-errors.js','shotgun.js',
  'browser.js','lock-browser.js','browser-window.js','release-clock.js','court-registry.js',
  'api-booking/booking-planner.js','api-booking/availability-parser.js','api-booking/browser-availability-provider.js',
  'api-booking/browser-availability-fetch.js','api-booking/live-availability-provider.js','api-booking/availability-contract.js','api-booking/phase3-freeze-selection.js',
  'api-booking/local-customer.js','api-booking/api-automation-lock.js',
] as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const rehearsalRequestFingerprint = (request: unknown) => createHash('sha256')
  .update(JSON.stringify(ShotgunLiveRequestSchema.parse(request))).digest('hex');
export const ShotgunLiveAuthorizationSchema = z.object({
  schema: z.literal('shotgun-live-authorization/v2'), request: ShotgunLiveRequestSchema,
  approvedBy: z.literal('OWNER_CONVERSATION'), approvedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  ownerDirectiveSha256: digest, requestFingerprint: digest,
  installedSha: z.string().regex(/^[a-f0-9]{40}$/),
  engineHashes: z.record(z.string(),digest),
  singleShotQualification:z.object({run:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),resultSha256:digest}).strict().optional(),
  attestation: z.literal('EXACT_TARGET_ONE_POST_NO_PAYMENT_NO_CANCELLATION_NO_RETRY'),
}).strict();
export type ShotgunLiveAuthorization = z.infer<typeof ShotgunLiveAuthorizationSchema>;

/** A simulated result, another installed engine, or a navigation-only result never promotes live capacity. */
export function assertSingleShotLabQualification(auth:ShotgunLiveAuthorization,bytes:Uint8Array){
  const proof=auth.singleShotQualification;
  let result:any;try{result=JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{throw Error('LAB_SINGLE_SHOT_QUALIFICATION_INVALID');}
  if(!proof||createHash('sha256').update(bytes).digest('hex')!==proof.resultSha256||result.interaction!=='LIVE_PROVIDER'||
    result.authorizedAttempts!==1||result.actualBookingPosts!==1||result.installedSha!==auth.installedSha||
    result.results?.length!==1||result.results[0].state!=='QR_READY'||result.workers?.length!==1||
    !result.workers[0].providerConfirmed||!result.workers[0].firstHandoff||!result.workers[0].recoveredInFreshTab||
    REHEARSAL_MODULES.some(name=>result.engineHashes?.[name]!==auth.engineHashes[name]))throw Error('LAB_SINGLE_SHOT_QUALIFICATION_INVALID');
}

/** Called before claiming, after security preparation and immediately before the POST. */
export function assertLiveRehearsalAuthorization(input: unknown, nowMs: number): ShotgunLiveAuthorization {
  const auth=ShotgunLiveAuthorizationSchema.parse(input);
  const approved=Date.parse(auth.approvedAt),expires=Date.parse(auth.expiresAt);
  if(!Number.isFinite(nowMs)||approved>nowMs||expires<=nowMs||expires-approved>15*60_000||expires<=approved)
    throw Error('REHEARSAL_AUTHORIZATION_EXPIRED');
  if(auth.requestFingerprint!==rehearsalRequestFingerprint(auth.request))throw Error('REHEARSAL_AUTHORIZATION_TARGET_CHANGED');
  if(REHEARSAL_MODULES.some(name=>!auth.engineHashes[name])||Object.keys(auth.engineHashes).length!==REHEARSAL_MODULES.length)
    throw Error('REHEARSAL_AUTHORIZATION_MODULES_INCOMPLETE');
  if(liveLabRequests(auth.request).length>1&&!auth.singleShotQualification)throw Error('LAB_SINGLE_SHOT_QUALIFICATION_REQUIRED');
  return auth;
}
