/** Bounded security-only experiment. Uses installed transport/helpers, no booking permit or dispatcher. */
import {chromium,type Route} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
async function main(){
  const [worker,mode]=process.argv.slice(2);
  if(process.argv.length!==4||!['A','B','C'].includes(worker??'')||!['normal','minimized','unattended'].includes(mode??''))throw Error('SECURITY_PROBE_SCOPE_REQUIRED');
  process.env.THIRSTY_API_INSTALLATION='1';
  const installed=(name:string)=>import(pathToFileURL(resolve('dist/src',name)).href);
  const {browserIdentity,verifyDedicatedChromeAsync}=await installed('browser.js'),{inspectLockPage}=await installed('lock-browser.js');
  const {OndaBrowserSessionTransport}=await installed('api-booking/browser-session-transport.js'),{calendarFreeSecurityContext}=await installed('api-booking/calendar-free-security-context.js');
  const identity=browserIdentity(worker);await verifyDedicatedChromeAsync(identity);
  const browser=await chromium.connectOverCDP(identity.cdpUrl),started=performance.now(),stages:unknown[]=[],events:unknown[]=[];
  let blockedPosts=0,observedPosts=0,outcome='FAILED',code:string|undefined,window:any,session:any,page:any;
  const timed=async<T>(stage:string,action:()=>Promise<T>):Promise<T>=>{const start=performance.now();try{const value=await action();stages.push({stage,state:'PASS',durationMs:performance.now()-start});return value;}catch(e){stages.push({stage,state:'FAILED',durationMs:performance.now()-start});throw e;}};
  const block=async(route:Route)=>{blockedPosts++;await route.abort();};
  try{
    const pages=browser.contexts()[0]!.pages().filter(p=>p.url()==='https://app.onda.fit/book/thirsty-pickle');if(pages.length!==1)throw Error('SECURITY_PROBE_AMBIGUOUS_PAGE');page=pages[0]!;
    // Install route barriers before navigation; no run context or submission permit is created.
    await browser.contexts()[0]!.route('**/api/bookings/public-checkout**',block);await browser.contexts()[0]!.route('**/api/public/bookings**',block);
    browser.contexts()[0]!.on('request',r=>{if(r.method()==='POST'&&/\/api\/(?:bookings\/public-checkout|public\/bookings)(?:\?|$)/.test(new URL(r.url()).pathname))observedPosts++;});
    const review=await timed<any>('CLEAN_PAGE',()=>inspectLockPage(page,{scheduleHydrationTimeoutMs:3000}));if(!review.clean&&review.hold!=='Expired')throw Error('SECURITY_PROBE_PROTECTED_PAGE');
    session=await browser.contexts()[0]!.newCDPSession(page);window=await session.send('Browser.getWindowForTarget');
    if(mode!=='unattended'){await session.send('Browser.setWindowBounds',{windowId:window.windowId,bounds:{windowState:mode==='minimized'?'minimized':'normal'}});if(mode==='normal')await page.bringToFront();}
    await timed('NAVIGATION',()=>page.reload({waitUntil:'domcontentloaded',timeout:30_000}));
    await timed('VENUE_READY',()=>page.getByTestId('public-booking-hero-title').waitFor({state:'visible',timeout:30_000}));
    const visibility=await page.evaluate(()=>({visibility:document.visibilityState,focused:document.hasFocus()}));stages.push({stage:'PAGE_STATE',...visibility});
    const transport=new OndaBrowserSessionTransport(page,()=>calendarFreeSecurityContext(page,(event:unknown)=>events.push(event))(),undefined,
      {onHumanVerificationRequired:async()=>{events.push({event:'HUMAN_VERIFICATION_REQUIRED'});await session.send('Browser.setWindowBounds',{windowId:window.windowId,bounds:{windowState:'normal'}});await page.bringToFront();}},
      (event:Record<string,unknown>)=>events.push(Object.fromEntries(['event','durationMs','securitySource','failureCategory','challengeFrame','failedHelper'].filter(k=>event[k]!==undefined).map(k=>[k,event[k]]))));
    await timed('GENUINE_SECURITY',()=>transport.checkSecurityReadiness());outcome='SECURITY_READY';
  }catch(e){code=e instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'SECURITY_PROBE_FAILED';process.exitCode=1;}
  finally{
    if(session&&window&&mode!=='unattended')await session.send('Browser.setWindowBounds',{windowId:window.windowId,bounds:{windowState:window.bounds.windowState}}).catch(()=>undefined);
    await browser.contexts()[0]!.unroute('**/api/bookings/public-checkout**',block);await browser.contexts()[0]!.unroute('**/api/public/bookings**',block);
    const at=new Date().toISOString(),record={at,worker,mode,outcome,code,durationMs:performance.now()-started,stages,events,blockedPosts,observedPosts,bookingPermitCreated:false,bookingSubmitted:false};
    await mkdir('DiagnosticsLocal/shotgun-reliability-v2-1-nov2/security',{recursive:true});
    await writeFile(`DiagnosticsLocal/shotgun-reliability-v2-1-nov2/security/${at.replace(/[:.]/g,'-')}-${worker}-${mode}.json`,JSON.stringify(record,null,2),{flag:'wx',mode:0o600});
    await browser.close();console.log(JSON.stringify({worker,mode,outcome,code,durationMs:record.durationMs,blockedPosts,observedPosts}));
    if(blockedPosts||observedPosts)throw Error('SECURITY_PROBE_UNEXPECTED_BOOKING_REQUEST');
  }
}
main().catch(e=>{console.error(e instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'SECURITY_PROBE_FAILED');process.exitCode=1;});
