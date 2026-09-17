import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { emitUiEvent } from './ui-events.js';
import type { RateLimitEvidence } from './rate-limit.js';
import { releasePerformance } from './release-performance.js';
import { availabilityPerformance } from './availability-performance.js';
// Closed numeric metadata schema: never accept DOM, URLs, config, error text or PII.
export type WorkerId = 'A' | 'B';
export interface TelemetryEvent { event: string; wall: string; monoMs: number; value?: number; workerId?: WorkerId; evidence?: RateLimitEvidence }
export type PassiveEndpoint = 'AVAILABILITY'|'CHECKOUT_PREPARATION'|'RESERVATION_SUBMISSION';
export type PassivePhase = 'DISPATCHED'|'HEADERS'|'COMPLETED'|'FAILED';
export interface PassiveNetworkEvent {requestId:number;endpoint:PassiveEndpoint;phase:PassivePhase;wall:string;monoMs:number;workerId?:WorkerId;status?:number;failure?:'CANCELED_OR_NAVIGATED'|'NETWORK_FAILURE'|'UNKNOWN'}
export const selectionFailureStages = ['INITIAL_GRID_VALIDATION','FULL_BROWSER_GUARD','SELECTION_PREPARATION','FIRST_CLICK_GUARD','FIRST_SLOT_CLICK','SELECTION_COORDINATION'] as const;
export type SelectionFailureStage = typeof selectionFailureStages[number];
export const selectionFailureCodes = [
  'INVALID_CHECKOUT_BUNDLE','INVALID_TARGET_DATE','STALE_OR_INCOMPLETE_GRID','GRID_STRUCTURE_CHANGED','SELECTION_STATE_UNKNOWN','PREEXISTING_SELECTION',
  'USER_ABORT','CHROME_DISCONNECTED','PAYMENT_BOUNDARY_REACHED','RATE_LIMITED','ACCESS_BLOCKED','UNEXPECTED_REDIRECT','WRONG_URL','SECURITY_CHALLENGE',
  'WRONG_VENUE','GRID_UNVERIFIED','TAB_NOT_VISIBLE','TAB_REACTIVATION_FAILED','TAB_VISIBILITY_UNREADABLE','SECURITY_SENTINEL_INSTALL_FAILED','LOCK_REPLACED','BOOKING_LOCKED','SELECTION_CONFLICT','UNOWNED_SELECTION','CLEANUP_STATE_CHANGED',
  'CLEANUP_NOT_VERIFIED','SELECTION_SUMMARY_MISMATCH','SELECTION_AMOUNT_UNKNOWN','SELECTION_PRICE_MISMATCH','SELECTION_ATTEMPTS_EXHAUSTED',
  'NO_AVAILABLE_PREFERENCE','INVALID_SELECTION_LIMIT','INVALID_PREFERENCE','UNCLASSIFIED_SELECTION_FAILURE',
] as const;
export type SelectionFailureCode = typeof selectionFailureCodes[number];
export interface SelectionFailureDiagnostic {stage:SelectionFailureStage;code:SelectionFailureCode;workerId?:WorkerId}
export const releaseFailureStages = ['RELOAD_NAVIGATION','WAIT_FOR_VENUE_ATTACHED','WAIT_FOR_VENUE_VISIBLE','VERIFY_VENUE','WAIT_FOR_DATE_PICKER_ATTACHED','VERIFY_DATE_PICKER','WAIT_FOR_DATE_PICKER_VISIBLE','WAIT_FOR_DATE_PICKER_ENABLED','VERIFY_RELEASE_SHELL','RELEASE_WORKER'] as const;
export type ReleaseFailureStage = typeof releaseFailureStages[number];
export const releaseFailureCodes = ['RELEASE_PAGE_LOAD_TIMEOUT','RELEASE_VENUE_ELEMENT_MISSING','RELEASE_VENUE_NOT_VISIBLE','WRONG_VENUE','RELEASE_DATE_PICKER_MISSING','RELEASE_DATE_PICKER_NOT_VISIBLE','RELEASE_DATE_PICKER_NOT_READY','RELEASE_HTTP_STATUS','SECURITY_CHALLENGE','RATE_LIMITED','ACCESS_BLOCKED','UNEXPECTED_REDIRECT','WRONG_URL','CHROME_DISCONNECTED','USER_ABORT','RELEASE_NAVIGATION_FAILED','RELEASE_SHELL_UNCLASSIFIED'] as const;
export type ReleaseFailureCode = typeof releaseFailureCodes[number];
export const releaseFailureClassifications = ['PAGE_LOADING_TIMEOUT','MISSING_VENUE_ELEMENT','VENUE_NOT_VISIBLE','WRONG_VENUE','MISSING_DATE_PICKER','DATE_PICKER_NOT_VISIBLE','DATE_PICKER_NOT_READY','HTTP_ERROR_STATUS','SECURITY_CHALLENGE','RATE_LIMITED','ACCESS_BLOCKED','UNEXPECTED_NAVIGATION','BROWSER_DISCONNECTED','ABORTED','NAVIGATION_FAILED','UNCLASSIFIED'] as const;
export type ReleaseFailureClassification = typeof releaseFailureClassifications[number];
export interface ReleaseFailureDiagnostic {stage:ReleaseFailureStage;code:ReleaseFailureCode;classification:ReleaseFailureClassification;workerId?:WorkerId;httpStatus?:number}
export type NavigationOutcome = 'HTTP_RESPONSE'|'NO_RESPONSE'|'TIMEOUT'|'FAILED';
export interface NavigationDiagnostic {stage:'RELOAD_COMMIT';outcome:NavigationOutcome;workerId?:WorkerId;httpStatus?:number}
interface TelemetryShared {runID:string;events:TelemetryEvent[];selectionFailures:SelectionFailureDiagnostic[];releaseFailures:ReleaseFailureDiagnostic[];navigations:NavigationDiagnostic[];passiveNetwork:PassiveNetworkEvent[];releaseContext?:{targetDate:string;bookingMethod:'browser'|'hybrid'}}
const allowedSelectionFailures=new Set<string>(selectionFailureCodes);
const allowedReleaseFailures=new Set<string>(releaseFailureCodes),allowedReleaseClassifications=new Set<string>(releaseFailureClassifications);
const safeStatus=(status:unknown)=>typeof status==='number'&&Number.isInteger(status)&&status>=100&&status<=599?status:undefined;
export function sanitizedSelectionFailureCode(error:unknown):SelectionFailureCode{
  const code=error instanceof Error?error.message:'';
  return (allowedSelectionFailures.has(code)?code:'UNCLASSIFIED_SELECTION_FAILURE') as SelectionFailureCode;
}
export function sanitizedOperationFailureCode(error:unknown,fallback='OPERATION_FAILED'){
  let current:unknown=error;
  for(let depth=0;depth<4&&current instanceof Error;depth++){
    if(/^[A-Z_]{1,80}$/.test(current.message))return current.message;
    if(current.name==='TimeoutError')return 'PLAYWRIGHT_TIMEOUT';
    current=current.cause;
  }
  return fallback;
}
export class Telemetry {
  readonly runID: string;
  readonly events: TelemetryEvent[];
  private readonly shared:TelemetryShared;
  private readonly workerId?: WorkerId;
  constructor(shared?:TelemetryShared,workerId?:WorkerId){
    this.shared=shared??{runID:randomUUID(),events:[],selectionFailures:[],releaseFailures:[],navigations:[],passiveNetwork:[]};this.runID=this.shared.runID;this.events=this.shared.events;this.workerId=workerId;
  }
  worker(workerId:WorkerId){return new Telemetry(this.shared,workerId);}
  recordSelectionFailure(stage:SelectionFailureStage,error:unknown){
    const diagnostic={stage,code:sanitizedSelectionFailureCode(error),...(this.workerId?{workerId:this.workerId}:{})};
    if(!this.shared.selectionFailures.some(existing=>existing.stage===diagnostic.stage&&existing.code===diagnostic.code&&existing.workerId===diagnostic.workerId))this.shared.selectionFailures.push(diagnostic);
  }
  recordReleaseFailure(stage:ReleaseFailureStage,code:string,classification:string,httpStatus?:number){
    const diagnostic:ReleaseFailureDiagnostic={stage,
      code:(allowedReleaseFailures.has(code)?code:'RELEASE_SHELL_UNCLASSIFIED') as ReleaseFailureCode,
      classification:(allowedReleaseClassifications.has(classification)?classification:'UNCLASSIFIED') as ReleaseFailureClassification,
      ...(this.workerId?{workerId:this.workerId}:{}),...(safeStatus(httpStatus)!==undefined?{httpStatus:safeStatus(httpStatus)}:{})};
    if(!this.shared.releaseFailures.some(existing=>JSON.stringify(existing)===JSON.stringify(diagnostic)))this.shared.releaseFailures.push(diagnostic);
  }
  hasReleaseFailure(){return this.shared.releaseFailures.some(f=>f.workerId===this.workerId);}
  recordReleaseContext(targetDate:string,bookingMethod:'browser'|'hybrid'){
    try{if(/^\d{4}-\d{2}-\d{2}$/.test(targetDate))this.shared.releaseContext={targetDate,bookingMethod};}catch{/* passive */}
  }
  recordNavigation(outcome:NavigationOutcome,httpStatus?:number){
    const diagnostic:NavigationDiagnostic={stage:'RELOAD_COMMIT',outcome,...(this.workerId?{workerId:this.workerId}:{}),...(safeStatus(httpStatus)!==undefined?{httpStatus:safeStatus(httpStatus)}:{})};
    this.shared.navigations.push(diagnostic);
  }
  recordPassiveNetwork(requestId:number,endpoint:PassiveEndpoint,phase:PassivePhase,status?:number,failure?:PassiveNetworkEvent['failure']){
    try{
      if(this.shared.passiveNetwork.length>=128||!Number.isInteger(requestId)||requestId<1)return;
      this.shared.passiveNetwork.push({requestId,endpoint,phase,wall:new Date().toISOString(),monoMs:performance.now(),...(this.workerId?{workerId:this.workerId}:{}),...(safeStatus(status)!==undefined?{status:safeStatus(status)}:{}),...(phase==='FAILED'&&failure?{failure}:{})});
    }catch{/* Diagnostics must never interrupt booking. */}
  }
  rateLimit(event: 'ondaRateLimited' | 'thirdPartyRateLimited' | 'ondaRetryAfterUnrestricted', evidence: RateLimitEvidence) {
    // Explicit field allowlist, never spread response/request objects into diagnostics.
    const { reason, timestamp, monoMs, hostname, status, resourceType, navigation, retryAfterPresent, sameOndaSite } = evidence;
    this.mark(event);
    this.events.at(-1)!.evidence = { reason, timestamp, monoMs, hostname, status, resourceType, navigation, retryAfterPresent, sameOndaSite };
  }
  mark(event: string, value?: number) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(event)) throw new Error('INVALID_EVENT_NAME');
    this.events.push({ event, wall: new Date().toISOString(), monoMs: performance.now(), ...(typeof value === 'number' && Number.isFinite(value) ? { value } : {}), ...(this.workerId?{workerId:this.workerId}:{}) });
    if (process.env.THIRSTY_UI_EVENTS === '1') {
      const latest = this.events.at(-1)!;
      emitUiEvent({ type: 'telemetry', event, wall: latest.wall, ...(latest.value !== undefined ? { value: latest.value } : {}), ...(latest.workerId?{workerId:latest.workerId}:{}) });
    }
  }
  document(failure?: string, stopEvidence?: RateLimitEvidence) {
    return { runID: this.runID, events: this.events, releasePerformance: releasePerformance(this.events),
      availabilityPerformance: availabilityPerformance(this.events),...(this.shared.releaseContext?{releaseContext:this.shared.releaseContext}:{}),...(this.shared.selectionFailures.length?{selectionFailures:this.shared.selectionFailures}:{}),
      ...(this.shared.releaseFailures.length?{releaseFailures:this.shared.releaseFailures}:{}),...(this.shared.navigations.length?{navigations:this.shared.navigations}:{}),
      ...(this.shared.passiveNetwork.length?{passiveNetwork:this.shared.passiveNetwork}:{}),
      ...(failure ? { failure } : {}), ...(stopEvidence ? { stopEvidence } : {}) };
  }
  publishPerformance() {
    const summary = releasePerformance(this.events);
    if (summary) emitUiEvent({ type: 'releasePerformance', summary });
  }
  async flush(failure?: string, stopEvidence?: RateLimitEvidence) {
    await mkdir('DiagnosticsLocal', { recursive: true });
    await writeFile(`DiagnosticsLocal/${this.runID}.json`, JSON.stringify(this.document(failure, stopEvidence), null, 2));
    this.publishPerformance();
  }
}
