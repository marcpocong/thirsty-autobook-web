import type { BrowserContext, Page } from 'playwright';
import { join } from 'node:path';
import { ONDA_URL, VENUE } from './config.js';
import { OndaBrowserAvailabilityProvider } from './api-booking/browser-availability-provider.js';
import { parseAvailability } from './api-booking/availability-parser.js';
import { launchObserverChrome } from './observer-chrome.js';
import { AvailabilityReadPolicy } from './api-booking/availability-read-policy.js';
import { LiveAvailabilityError } from './api-booking/live-availability-provider.js';
/** Dedicated guest observer profile and Chrome process. No dispatch CDP, customer or security context.
 * Production launches a normal Chrome window on its own profile (headless and automation-launched browsers are
 * refused by the site's availability endpoint); tests inject an isolated context. */
export async function openSlotWatchBrowser(directory:string,launch?:()=>Promise<BrowserContext>) {
  let context:BrowserContext|undefined,closeBrowser:(()=>Promise<void>)|undefined,page:Page;
  try {
    if(launch){
      context=await launch();closeBrowser=()=>context!.close();
      await context.route('**/*',route=>route.request().method()==='GET'?route.fallback():route.abort('blockedbyclient'));
      page=context.pages()[0]??await context.newPage();
      await page.goto(ONDA_URL,{waitUntil:'domcontentloaded',timeout:45_000});
      if((await page.getByTestId('public-booking-hero-title').first().innerText({timeout:15_000})).trim()!==VENUE)throw Error('OBSERVER_VENUE_UNVERIFIED');
    }else{
      const observer=await launchObserverChrome(join(directory,'observer-chrome-profile'));
      context=observer.context;page=observer.page;closeBrowser=observer.close;
    }
    const policy=new AvailabilityReadPolicy();
    return {close:()=>closeBrowser!(),read:async(date:string,signal:AbortSignal)=>{
      policy.beforeRead();
      if(signal.aborted||page.isClosed())throw new LiveAvailabilityError('OBSERVER_BROWSER_UNAVAILABLE',undefined,false);
      if(page.url()!==ONDA_URL)throw Error('OBSERVER_VENUE_UNVERIFIED');
      let headers=new Headers();
      const provider=new OndaBrowserAvailabilityProvider(page,{onHeaders:value=>{headers=value;},allowIncompleteRange:true,timeoutMs:15_000});
      const envelope=await provider.getAvailability({startDate:date,endDate:date}).catch(error=>{policy.failure(error);throw error;});
      policy.success();
      if(signal.aborted)throw Error('OBSERVER_READ_ABORTED');
      const snapshot=parseAvailability(envelope.raw,{startDate:date,endDate:date,capturedAt:envelope.capturedAt,fixtureKind:envelope.fixtureKind,label:'ISOLATED CHROME OBSERVER',now:new Date(),maximumAgeMs:15_000,requireCompleteRange:false});
      const status=headers.get('x-vercel-cache')??undefined,age=headers.get('age'),vercelId=headers.get('x-vercel-id')??undefined,dateHeader=headers.get('date')??undefined,matchedPath=headers.get('x-matched-path')??undefined;
      return {snapshot,cache:{status,...(age&&/^\d{1,7}$/.test(age)?{ageS:Number(age)}:{})},provider:{vercelId,date:dateHeader,matchedPath}};
    }};
  }catch(error){await closeBrowser?.().catch(()=>undefined);throw error;}
}
