import { chromium, type BrowserContext } from 'playwright';
import { join } from 'node:path';
import { ONDA_URL, VENUE } from './config.js';
import { OndaBrowserAvailabilityProvider } from './api-booking/browser-availability-provider.js';
import { parseAvailability } from './api-booking/availability-parser.js';
/** Dedicated guest observer profile and Chrome process. No dispatch CDP, customer or security context. */
export async function openSlotWatchBrowser(directory:string,launch?:()=>Promise<BrowserContext>) {
  let context:BrowserContext|undefined;
  try {
    context=launch?await launch():await chromium.launchPersistentContext(join(directory,'observer-chrome-profile'),{channel:'chrome',headless:false,serviceWorkers:'block'});
    await context.route('**/*',route=>route.request().method()==='GET'?route.fallback():route.abort('blockedbyclient'));
    const page=context.pages()[0]??await context.newPage();
    await page.goto(ONDA_URL,{waitUntil:'domcontentloaded',timeout:45_000});
    if((await page.getByTestId('public-booking-hero-title').first().innerText({timeout:15_000})).trim()!==VENUE)throw Error('OBSERVER_VENUE_UNVERIFIED');
    let blocked:string|undefined;
    return {close:()=>context!.close(),read:async(date:string,signal:AbortSignal)=>{
      if(blocked)throw Error(blocked);
      if(signal.aborted||page.isClosed())throw Error('OBSERVER_BROWSER_UNAVAILABLE');
      if(page.url()!==ONDA_URL)throw Error('OBSERVER_VENUE_UNVERIFIED');
      let headers=new Headers();
      const provider=new OndaBrowserAvailabilityProvider(page,{onHeaders:value=>{headers=value;},allowIncompleteRange:true,timeoutMs:15_000});
      const envelope=await provider.getAvailability({startDate:date,endDate:date}).catch(error=>{if(error instanceof Error&&['AVAILABILITY_RATE_LIMITED','AVAILABILITY_HTTP_FAILED'].includes(error.message))blocked=error.message;throw error;});
      if(signal.aborted)throw Error('OBSERVER_READ_ABORTED');
      const snapshot=parseAvailability(envelope.raw,{startDate:date,endDate:date,capturedAt:envelope.capturedAt,fixtureKind:envelope.fixtureKind,label:'ISOLATED CHROME OBSERVER',now:new Date(),maximumAgeMs:15_000,requireCompleteRange:false});
      const status=headers.get('x-vercel-cache')??undefined,age=headers.get('age'),vercelId=headers.get('x-vercel-id')??undefined,dateHeader=headers.get('date')??undefined,matchedPath=headers.get('x-matched-path')??undefined;
      return {snapshot,cache:{status,...(age&&/^\d{1,7}$/.test(age)?{ageS:Number(age)}:{})},provider:{vercelId,date:dateHeader,matchedPath}};
    }};
  }catch(error){await context?.close();throw error;}
}
