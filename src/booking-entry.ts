import { mkdir } from 'node:fs/promises';
import { bookingPlayers, loadConfig, loadTestRuntimeConfig, planFingerprint, releaseCalendar } from './config.js';
import { PreparationResultSchema, PreparationSchema, TestBookingSchema, resolveBookingPlan, type BookingPlan } from './booking-plan.js';
import { resetAndPrepare,PreparationBlockedError } from './booking-prepare.js';
import {expectedPreparationFingerprint} from './prepared-context.js';
import { runBooking } from './booking-runtime.js';
import { Safety } from './safety.js';
import { Telemetry, sanitizedOperationFailureCode } from './telemetry.js';
import { emitUiEvent } from './ui-events.js';
import {requiredWorkerIds} from './workers.js';

const safety=new Safety(),t=new Telemetry();
const stop=()=>{safety.stop('USER_ABORT');process.exit(130);};
process.once('SIGTERM',stop);process.once('SIGINT',stop);
if(process.connected){process.once('disconnect',stop);process.on('message',m=>{if((m as any)?.type==='abort')stop();});}
async function confirm(plan:BookingPlan){
  if(!process.connected)throw Error('TEST_CONFIRMATION_REQUIRED');
  return new Promise<boolean>((resolve,reject)=>{
    const timer=setTimeout(()=>{process.off('message',listener);reject(Error('CONFIRMATION_EXPIRED'));},300000);
    const listener=(m:unknown)=>{const message=m as {type?:string;approved?:boolean};if(message?.type==='bookingConfirmation'&&typeof message.approved==='boolean'){clearTimeout(timer);process.off('message',listener);resolve(message.approved);}};
    process.on('message',listener);process.send!({type:'confirmBooking',plan});
  });
}
let code=0,failureCode:string|undefined,lastStep:string='input';
/** Only engine-generated JS errors carry code-derived messages; anything else (browser, provider, I/O) keeps its class only. */
const ENGINE_ERRORS=new Set(['TypeError','RangeError','ReferenceError','SyntaxError']);
const safeErrorClass=(error:unknown)=>error instanceof Error&&/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(error.name)?error.name:'NonError';
const safeEngineMessage=(error:unknown)=>error instanceof Error&&ENGINE_ERRORS.has(error.name)?error.message.replace(/[^A-Za-z0-9 ._()'-]/g,' ').slice(0,140):'';
try{
  await mkdir('.local',{recursive:true});await mkdir('DiagnosticsLocal',{recursive:true});
  const [mode,raw]=process.argv.slice(2);
  if(mode==='prepare'){
    let decoded:unknown;try{decoded=JSON.parse(raw??'');}catch{throw Error('PREPARATION_INPUT_INVALID');}
    const parsed=PreparationSchema.safeParse(decoded);if(!parsed.success)throw Error('PREPARATION_INPUT_INVALID');
    const input=parsed.data;
    const config=input.workflow==='test'?loadTestRuntimeConfig({...input.request,method:input.method,maximum:input.maximum}):loadConfig();
    const strategy=input.workflow==='test'?input.request.strategy:config.BOOKING_TYPE;
    if(input.workflow!=='test'||!['api-first','proofless'].includes(input.method))bookingPlayers(config,strategy);
    const target=input.workflow==='release'?releaseCalendar(config):undefined;
    if(target&&Date.now()>=target.releaseMs-config.PREFLIGHT_SECONDS_BEFORE*1000)throw Error('TODAYS_RELEASE_PASSED');
    const courtCount=input.workflow==='test'?input.request.courtCount:config.COURT_COUNT;
    const workers=requiredWorkerIds(strategy,courtCount);
    lastStep='starting';
    const prepared=await resetAndPrepare(strategy,safety,{progress:step=>{lastStep=step;emitUiEvent({type:'preparationProgress',step});}},input.workflow==='test'?input.request.date:undefined,workers);
    lastStep='availability';emitUiEvent({type:'preparationProgress',step:'availability'});
    const snapshots=prepared.browsers.map(b=>b.snapshot);
    if(snapshots.some(s=>!s))throw Error('PREPARATION_RESULT_MISSING');
    const solution=input.workflow==='test'?(['api-first','proofless'].includes(input.method)||resolveBookingPlan(input.request,snapshots as NonNullable<typeof snapshots[number]>[])!==undefined):true;
    if(!solution)throw Error('TARGET_NOT_AVAILABLE');
    const fingerprint=expectedPreparationFingerprint(input,input.workflow==='release'?planFingerprint(config):undefined);
    lastStep='final';emitUiEvent({type:'preparationProgress',step:'final'});
    // Evidence is read defensively: a missing grid row becomes a reported invalid field, never a raw TypeError.
    const checked=PreparationResultSchema.safeParse({workflow:input.workflow,strategy,fingerprint,browsers:prepared.browsers.map(b=>({id:b.id,dedicatedProfileVerified:true,ondaVerified:true,preparedDate:b.snapshot?.rows?.[0]?.date,gridVerified:true,selectedCount:0,hold:'Not detected'})),solutionAvailable:solution,...(target?{releaseTargetDate:target.targetDate,releaseMs:target.releaseMs}:{})});
    if(!checked.success){
      const fields=checked.error.issues.map(issue=>issue.path.join('.')).join(', ').slice(0,190);
      emitUiEvent({type:'apiStage',stage:'PREPARATION_RESULT_INVALID',elapsedMs:0,message:`Invalid preparation evidence fields: ${fields}`});
      throw Error('PREPARATION_RESULT_INVALID');
    }
    const result=checked.data;
    emitUiEvent({type:'preparationResult',result});console.log('READY');
  }
  else if(mode==='test'){
    let decoded:unknown;try{decoded=JSON.parse(raw??'');}catch{throw Error('BOOKING_INPUT_INVALID');}
    const parsed=TestBookingSchema.safeParse(decoded);if(!parsed.success)throw Error('BOOKING_INPUT_INVALID');
    const input=parsed.data;
    await runBooking(loadTestRuntimeConfig({...input.request,method:input.method,maximum:input.maximum}),'test',safety,t,{...input,confirm});
  }else throw Error('MODE_REQUIRED');
}catch(e){code=1;if(e instanceof PreparationBlockedError)emitUiEvent({type:'preparationBlocked',browser:e.browserId,hold:e.review.hold,countdownSeconds:e.review.countdownSeconds??null});failureCode=sanitizedOperationFailureCode(e,'BOOKING_OPERATION_FAILED');
  // A generic failure keeps its last step and error class so the next occurrence is diagnosable (no values, URLs or secrets).
  if(failureCode==='BOOKING_OPERATION_FAILED'){const errorClass=safeErrorClass(e),message=safeEngineMessage(e);
    emitUiEvent({type:'apiStage',stage:'PREPARATION_STEP_FAILED',elapsedMs:0,checkpoint:lastStep.toUpperCase().replace(/[^A-Z0-9_+-]/g,'_').slice(0,24),reason:errorClass.replace(/[a-z]/g,c=>c.toUpperCase()).replace(/[^A-Z0-9_]/g,'_').slice(0,79),
      message:`Preparation failed at step ${lastStep} with ${errorClass}${message?`: ${message}`:''}`.slice(0,240)});}
  emitUiEvent({type:'error',code:failureCode});console.error(failureCode);}
finally{await t.flush(failureCode,safety.stopEvidence);}
process.exit(code);
