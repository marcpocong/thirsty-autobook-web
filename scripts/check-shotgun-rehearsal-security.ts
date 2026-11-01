/** Genuine preparation only: no reservation permit, armer or dispatcher is imported. */
import { chromium } from 'playwright';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareRehearsalSecurity,reuseRehearsalSecurity } from '../src/shotgun-rehearsal-readiness.js';

async function main(){
  const worker=process.argv[2];
  if(!worker||!['A','B','C','D','E','F','G'].includes(worker)||process.argv.length!==3)throw Error('SECURITY_CHECK_WORKER_REQUIRED');
  process.env.THIRSTY_API_INSTALLATION='1';
  const installed=async(name:string)=>import(pathToFileURL(resolve('dist/src',name)).href);
  const {browserIdentity,verifyDedicatedChromeAsync}=await installed('browser.js');
  const {OndaBrowserSessionTransport}=await installed('api-booking/browser-session-transport.js');
  const {calendarFreeSecurityContext}=await installed('api-booking/calendar-free-security-context.js');
  const {showWorkerPage}=await installed('browser-window.js');
  const {inspectLockPage}=await installed('lock-browser.js');
  const identity=browserIdentity(worker);await verifyDedicatedChromeAsync(identity);
  const browser=await chromium.connectOverCDP(identity.cdpUrl),events:unknown[]=[],states:string[]=[];
  const start=Date.now();let result:Record<string,unknown>={status:'FAILED'},blocked=0;
  try{
    const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url()==='https://app.onda.fit/book/thirsty-pickle');
    if(pages.length!==1)throw Error('ONDA_TAB_AMBIGUOUS_OR_MISSING');
    const page=pages[0]!;
    const review=await inspectLockPage(page,{scheduleHydrationTimeoutMs:3000});
    if(!review.clean||review.selected!==0||review.hold!=='Not detected')throw Error('SECURITY_CHECK_PAGE_NOT_CLEAN');
    await page.reload({waitUntil:'domcontentloaded',timeout:30_000});
    await page.getByTestId('public-booking-hero-title').waitFor({state:'visible',timeout:30_000});
    const block=async(route:import('playwright').Route)=>{blocked++;await route.abort();};
    await page.route('**/api/bookings/public-checkout**',block);await page.route('**/api/public/bookings**',block);
    try{
      const transport=new OndaBrowserSessionTransport(page,()=>calendarFreeSecurityContext(page)(),undefined,
        {onHumanVerificationRequired:async()=>{states.push('HUMAN_VERIFICATION_REQUIRED');await showWorkerPage(page,worker);}},
        (event:Record<string,unknown>)=>{
          const safe=Object.fromEntries(['event','securitySource','durationMs','failureCategory','challengeFrame','failedHelper'].filter(k=>event[k]!==undefined).map(k=>[k,event[k]]));
          events.push({...safe,elapsedMs:Date.now()-start});
        });
      // Preparation cannot submit: no permit exists, and both booking routes are aborted.
      process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT='SUPERVISED_ONE_SHOT';
      await prepareRehearsalSecurity(transport,()=>showWorkerPage(page,worker),state=>states.push(state));
      await reuseRehearsalSecurity(transport);
      result={status:'SECURITY_READY',durationMs:Date.now()-start,preparedContextAgeMs:transport.preparedContextAgeMs(),reusedPreparedContext:true};
    }catch(error){result={status:'SECURITY_FAILED',code:error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'SECURITY_CHECK_FAILED'};process.exitCode=1;}
    finally{await page.unroute('**/api/bookings/public-checkout**',block);await page.unroute('**/api/public/bookings**',block);}
  }finally{
    await mkdir('DiagnosticsLocal/security-readiness-repair-nov1',{recursive:true});
    const at=new Date().toISOString(),record=JSON.stringify({at,worker,freshVenuePage:true,bookingSubmitted:false,blockedCheckoutRequests:blocked,result,states,events},null,2);
    await writeFile(`DiagnosticsLocal/security-readiness-repair-nov1/${at.replace(/[:.]/g,'-')}-${worker}.json`,record,{flag:'wx'});
    await writeFile('DiagnosticsLocal/security-readiness-repair-nov1/repaired-security-check.json',record);
    await browser.close();
  }
  console.log(JSON.stringify({worker,...result,blockedCheckoutRequests:blocked,bookingSubmitted:false}));
}
main().catch(error=>{console.error(error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'SECURITY_CHECK_FAILED');process.exitCode=1;});
