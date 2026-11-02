/** Bounded live Lab; dispatch always belongs to the installed production Shotgun engine. */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';
import { runShotgunLiveLab, liveLabRequests, prepareRehearsalSecurity, assertRehearsalSecurityReady,
  type ShotgunRehearsal, type productionRehearsalEngine } from '../src/shotgun-live-rehearsal.js';
import { assertLiveRehearsalAuthorization, assertSingleShotLabQualification, REHEARSAL_MODULES } from '../src/shotgun-live-authorization.js';
import { reuseRehearsalSecurity } from '../src/shotgun-rehearsal-readiness.js';
import { queryGoogleClockConsensus } from '../src/network-clock.js';
import { assertCanonicalRecoveryRuntime } from '../src/api-booking/recovery-runtime.js';
import { assertLiveLabJournalEligibility, liveLabPostRefusal, guardLiveLabTransport } from '../src/shotgun-live-lab-safety.js';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const safeCode=(error:unknown)=>error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'SHOTGUN_REHEARSAL_FAILED';
interface WorkerRun {
  request:ShotgunRehearsal;browser:Browser;page:Page;identity:any;customer:any;plan:any;preferences:any;key:string;directory:string;transport:any;
  localResponseValid:boolean;providerConfirmed:boolean;firstHandoff:boolean;recoveredInFreshTab:boolean;
  availabilityObservedMonoMs:number;
}
async function main(){
  if(process.argv.length!==4||process.argv[2]!=='--execute')throw Error('REHEARSAL_EXPLICIT_EXECUTION_REQUIRED');
  const root=resolve('.'),directory=resolve(process.argv[3]!),parent=resolve('.local/shotgun-rehearsal'),child=relative(parent,directory);
  if(!child||child.startsWith('..')||isAbsolute(child)||!existsSync('Thirsty Pickle Bot.exe'))throw Error('REHEARSAL_DIRECTORY_REFUSED');
  const auth=assertLiveRehearsalAuthorization(JSON.parse(await readFile(join(directory,'authorization.json'),'utf8')),Date.now());
  const requests=liveLabRequests(auth.request),build=JSON.parse(await readFile('dist/build-info.json','utf8'));
  const sourceSha=execFileSync('git',['-C',resolve('Source'),'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const sourceDirty=!!execFileSync('git',['-C',resolve('Source'),'status','--porcelain'],{encoding:'utf8'}).trim();
  if(build.gitSha!==auth.installedSha)throw Error('REHEARSAL_ENGINE_CHANGED');
  for(const name of REHEARSAL_MODULES)if(sha(await readFile(resolve('dist/src',name)))!==auth.engineHashes[name])throw Error('REHEARSAL_ENGINE_CHANGED');
  await assertCanonicalRecoveryRuntime(root);
  if(auth.singleShotQualification){
    const bytes=await readFile(join(parent,auth.singleShotQualification.run,'result.json'));
    assertSingleShotLabQualification(auth,bytes);
  }
  if(existsSync('.local/automation.lock'))throw Error('AUTOMATION_LOCK_EXISTS');
  const journalRoot=resolve('.local/api-booking/api-first-journals');
  await assertLiveLabJournalEligibility(journalRoot,requests);
  process.env.THIRSTY_API_INSTALLATION='1';
  const installed=(name:string)=>import(pathToFileURL(resolve('dist/src',name)).href);
  const browserModule=await installed('browser.js'),recovery=await installed('api-booking/checkout-recovery.js');
  if(recovery.RECOVERY_VERIFICATION_VERSION!==2)throw Error('REHEARSAL_PROVIDER_VERIFICATION_NOT_INSTALLED');
  const precision=await installed('api-booking/precision-race.js'),armedModule=await installed('api-booking/armed-dispatch.js');
  if(armedModule.SHOTGUN_LIVE_LAB_ENGINE_VERSION!==2)throw Error('LAB_PROVISIONAL_STOP_FIX_NOT_INSTALLED');
  const transportModule=await installed('api-booking/browser-session-transport.js'),security=await installed('api-booking/calendar-free-security-context.js');
  const journalModule=await installed('api-booking/durable-submission-journal.js'),planner=await installed('api-booking/booking-planner.js');
  const parser=await installed('api-booking/availability-parser.js'),availability=await installed('api-booking/browser-availability-provider.js');
  const customerModule=await installed('api-booking/local-customer.js'),lockModule=await installed('api-booking/api-automation-lock.js');
  const clockModule=await installed('release-clock.js'),review=await installed('lock-browser.js'),windowModule=await installed('browser-window.js');
  const errors=await installed('api-booking/submission-errors.js'),confirmationErrors=await installed('api-booking/hold-confirmation-errors.js');
  const connections:Browser[]=[],runs:WorkerRun[]=[],events:unknown[]=[],observations:any[]=[];
  let lock:any,outcome:any,armingStarted=false,triggerMs:number|undefined,failureCode:string|undefined;
  let observeNow=Date.now,observeClock='HOST_WALL';
  const abort=new AbortController(),stop=()=>abort.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const readPlan=async(run:WorkerRun)=>{
    const r=run.request,query={startDate:r.date,endDate:r.date};
    const envelope=await new availability.OndaBrowserAvailabilityProvider(run.page,{wing:'MANGO'}).getAvailability(query);
    const snapshot=parser.parseAvailability(envelope.raw,{...query,wing:'MANGO',capturedAt:envelope.capturedAt,
      fixtureKind:'live',label:envelope.label,now:new Date(),maximumAgeMs:15_000});
    const plan=planner.planBooking(snapshot,run.preferences);run.availabilityObservedMonoMs=performance.now();return plan;
  };
  const workers=()=>runs.map(r=>({request:r.request,amount:r.plan?.totalPrice??null,key:r.key,
    localResponseValid:r.localResponseValid,providerConfirmed:r.providerConfirmed,firstHandoff:r.firstHandoff,recoveredInFreshTab:r.recoveredInFreshTab}));
  const report=()=>({at:new Date().toISOString(),kind:auth.request.kind,request:auth.request,sourceSha,sourceDirty,installedSha:auth.installedSha,
    interaction:'LIVE_PROVIDER',triggerKind:'REHEARSAL_ANCHOR',triggerMs,authorizedAttempts:requests.length,
    actualBookingPosts:observations.filter(e=>e.event==='CHECKOUT_HTTP_POST_INITIATED').length,
    results:outcome?.results.map((x:any)=>({state:x.state,code:x.code??null,worker:x.attempt.target.workerId,strict:x.attempt.dispatchTimingPolicy==='SHOTGUN_STRICT'}))??[],
    workers:workers(),failureCode,events,observations,engineHashes:auth.engineHashes,requestFingerprint:auth.requestFingerprint,
    lockRetained:existsSync('.local/automation.lock'),paymentAutomated:false,releaseQualification:'UNVERIFIED'});
  try{
    for(const r of requests){
      if(abort.signal.aborted)throw Error('USER_ABORT');
      const identity=browserModule.browserIdentity(r.worker);await browserModule.verifyDedicatedChromeAsync(identity);
      const browser=await chromium.connectOverCDP(identity.cdpUrl,{timeout:10_000});connections.push(browser);
      const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url().startsWith('https://app.onda.fit/'));
      for(const page of pages){const state=await review.inspectLockPage(page,{scheduleHydrationTimeoutMs:3000});
        if(!state.clean&&state.hold!=='Expired')throw Error('REHEARSAL_BROWSER_NOT_CLEAN');}
      const schedules=pages.filter(p=>p.url()==='https://app.onda.fit/book/thirsty-pickle');
      if(schedules.length!==1)throw Error('ONDA_TAB_AMBIGUOUS_OR_MISSING');
      const page=schedules[0]!,customer=customerModule.loadLocalCheckoutCustomer(r.worker);
      if(runs.some(other=>other.customer.customerId===customer.customerId||other.identity.expectedProfile===identity.expectedProfile))
        throw Error('LAB_INDEPENDENT_CUSTOMERS_REQUIRED');
      const run:WorkerRun={request:r,browser,page,identity,customer,plan:undefined,key:'',directory:'',transport:undefined,
        preferences:{wing:'MANGO',mode:'standard',targetDate:r.date,durationHours:r.duration,preferredStartTimes:[r.start],fallbackStartTimes:[],
          courtPriority:[r.court],fallbackCourts:[],courtCount:1,exactCourts:[[r.court]],maximumTotalPrice:r.maximum,currency:'PHP'},
        localResponseValid:false,providerConfirmed:false,firstHandoff:false,recoveredInFreshTab:false,availabilityObservedMonoMs:NaN};
      runs.push(run);
      await page.reload({waitUntil:'domcontentloaded',timeout:30_000});
      await page.getByTestId('public-booking-hero-title').waitFor({state:'visible',timeout:30_000});
      run.plan=await readPlan(run);
      run.key=journalModule.DurableSubmissionJournal.key('5f8786bd-dc61-4509-b893-74cda8f783f7',run.plan.courts[0].spaceId,r.date,r.start,run.plan.endTime);
      run.directory=join(journalRoot,run.key);
      if(existsSync(join(run.directory,run.key+'.json')))throw Error('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
    }
    assertLiveRehearsalAuthorization(auth,Date.now());
    await writeFile(join(directory,'execution-claimed.json'),JSON.stringify({at:new Date().toISOString(),request:auth.request,
      requestFingerprint:auth.requestFingerprint,ownerDirectiveSha256:auth.ownerDirectiveSha256,engineHashes:auth.engineHashes,
      purpose:'REHEARSAL_NOT_OFFICIAL_08AM_RELEASE',checkoutBudget:requests.length}),{flag:'wx',mode:0o600});
    lock=await lockModule.ApiAutomationLock.acquire('standard',requests.map(r=>r.worker));
    await assertLiveLabJournalEligibility(journalRoot,requests);
    process.env.ONDA_CALENDAR_FREE_CHECKOUT='APPROVED_ONE_SHOT';
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT='SUPERVISED_ONE_SHOT';
    for(const run of runs){const worker=run.request.worker,show=()=>windowModule.showWorkerPage(run.page,worker);
      run.transport=new transportModule.OndaBrowserSessionTransport(run.page,()=>security.calendarFreeSecurityContext(run.page)(),
        async(response:any)=>recovery.saveCheckoutRecovery(run.directory,response,run.plan,worker,new Date(observeNow()),
          {customer:run.customer,profile:run.identity.expectedProfile,clockDomain:'TRUSTED_NETWORK'}),
        {onHumanVerificationRequired:async()=>{events.push({kind:'human-verification-required',worker});await show();},
          onHumanVerificationCompleted:async()=>{events.push({kind:'human-verification-completed',worker});}},
        (event:any)=>{const details=Object.fromEntries(['securitySource','durationMs','failureCategory','statusCode','preparedContextAgeMs']
          .filter(key=>event[key]!==undefined).map(key=>[key,event[key]]));
          observations.push({event:event.event,worker,at:observeNow(),clockDomain:observeClock,...details});});
    }
    const prepared=await Promise.allSettled(runs.map(run=>prepareRehearsalSecurity(run.transport,
      ()=>windowModule.showWorkerPage(run.page,run.request.worker),state=>events.push({kind:'readiness',worker:run.request.worker,state}))));
    const failed=prepared.find((r):r is PromiseRejectedResult=>r.status==='rejected');if(failed)throw failed.reason;
    for(const run of runs){const fresh=await readPlan(run);
      if(JSON.stringify(fresh.chunks)!==JSON.stringify(run.plan.chunks)||fresh.totalPrice!==run.plan.totalPrice)
        throw Error('REHEARSAL_PLAN_CHANGED_DURING_PREPARATION');}
    const consensus=await queryGoogleClockConsensus();
    if(consensus.quality!=='GOOD'||consensus.uncertaintyMs>50)throw Error('REHEARSAL_CLOCK_NOT_VERIFIED');
    const clock=clockModule.TrustedReleaseClock.fromOffset(consensus.offsetMs,{method:consensus.method,sampleCount:consensus.sampleCount,
      uncertaintyMs:consensus.uncertaintyMs,quality:consensus.quality});
    observeNow=()=>clock.nowMs();observeClock='NETWORK_MONOTONIC_ANCHOR';
    assertLiveRehearsalAuthorization(auth,clock.nowMs());
    runs.forEach(r=>assertRehearsalSecurityReady(r.transport));
    triggerMs=Math.ceil(clock.nowMs()+8000);
    await writeFile(join(directory,'prepared-plan.json'),JSON.stringify({request:auth.request,workers:workers(),triggerMs,
      triggerKind:'REHEARSAL_ANCHOR',clockEvidence:clock.evidence},null,2),{flag:'wx',mode:0o600});
    const runOf=(worker:string)=>runs.find(r=>r.request.worker===worker)!;
    armingStarted=true;
    outcome=await runShotgunLiveLab(auth.request,runs.map(r=>r.plan),{
      securityFor:worker=>runOf(worker).transport,
      engine:{freezePrecisionRace:precision.freezePrecisionRace,armPrecisionRace:armedModule.armPrecisionRace,
        dispatchArmedPrecisionRace:armedModule.dispatchArmedPrecisionRace,disarmUnfired:armedModule.disarmUnfired} as typeof productionRehearsalEngine,
      arm:{lock,releaseMs:triggerMs,journalRoot,now:()=>clock.nowMs(),customerFor:worker=>runOf(worker).customer},
      dispatch:{clock,prewarmLeadMs:5000,isAborted:()=>abort.signal.aborted,
        prewarm:async a=>reuseRehearsalSecurity(runOf(a.target.workerId).transport),
        transportFor:worker=>guardLiveLabTransport(runOf(worker).transport,()=>{
          const refusal=liveLabPostRefusal({nowMs:clock.nowMs(),expiresMs:Date.parse(auth.expiresAt),
            aborted:abort.signal.aborted,availabilityAgeMs:performance.now()-runOf(worker).availabilityObservedMonoMs});
          if(refusal)throw new errors.SubmissionDispatchError(refusal,false);
        }),
        afterFire:async()=>lock.dispatching(),onEvent:e=>events.push(e),
        onVerifiedHold:async(attempt,verified)=>{const run=runOf(attempt.target.workerId);run.localResponseValid=true;
          const onMilestone=(state:any)=>events.push({kind:'recovery',worker:run.request.worker,provider:state.provider,qr:state.qr,code:state.code,
            milestones:state.milestones});
          try{await recovery.openCheckoutRecovery(run.page,run.directory,()=>new Date(clock.nowMs()),{clockDomain:'TRUSTED_NETWORK',onMilestone});
            run.providerConfirmed=true;run.firstHandoff=true;await lock.held(verified.holdExpiresAt);
          }catch(error){if(error instanceof confirmationErrors.VerifiedHoldQrError)run.providerConfirmed=true;throw error;}
          const fresh=await run.page.context().newPage();
          await fresh.goto('https://app.onda.fit/book/thirsty-pickle',{waitUntil:'domcontentloaded',timeout:30_000});
          await recovery.openCheckoutRecovery(fresh,run.directory,()=>new Date(clock.nowMs()),{clockDomain:'TRUSTED_NETWORK',onMilestone});run.recoveredInFreshTab=true;
          return {state:'QR_READY'};
        }},
    });
    await writeFile(join(directory,'result.json'),JSON.stringify(report(),null,2),{flag:'wx',mode:0o600});
    console.log(JSON.stringify({results:report().results,workers:workers(),actualBookingPosts:report().actualBookingPosts,paymentAutomated:false}));
    if(!runs.every(r=>r.recoveredInFreshTab))process.exitCode=1;
  }catch(error){failureCode=safeCode(error);throw error;}
  finally{
    try{
      if(lock&&!runs.some(r=>r.localResponseValid)&&(!armingStarted||outcome&&outcome.results.every((x:any)=>['NOT_DISPATCHED','REJECTED','WINDOW_MISSED','PREWARM_FAILED'].includes(x.state))))
        await lock.release();
      await writeFile(join(directory,'exit-evidence.json'),JSON.stringify(report(),null,2),{flag:'wx',mode:0o600});
    }finally{
      await Promise.allSettled(connections.map(browser=>browser.close()));
      process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
    }
  }
}
main().catch(error=>{console.error(safeCode(error));process.exitCode=1;});
