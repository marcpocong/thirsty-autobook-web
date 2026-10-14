import { afterAll,beforeAll,expect,it } from 'vitest';
import { chromium,type Browser } from 'playwright';
import { openSlotWatchBrowser } from '../src/slot-watch-browser.js';
import { availabilityFixture } from './availability-fixture.js';
import { VENUE } from '../src/config.js';
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true});});afterAll(async()=>{await browser.close();});
it('uses isolated guest context, refuses POST and preserves read metadata',async()=>{
 const context=await browser.newContext();let posts=0,reads=0;
 await context.route('**/*',async route=>{
  if(route.request().method()!=='GET'){posts++;await route.abort();return;}
  if(route.request().url().includes('date-availability')){reads++;await route.fulfill({json:availabilityFixture('2026-10-14'),headers:{'x-vercel-cache':'MISS','age':'0','x-matched-path':'/api/public/facilities/[id]/date-availability'}});}
  else await route.fulfill({contentType:'text/html',body:`<h1 data-testid="public-booking-hero-title">${VENUE}</h1>`});
 });
 const observer=await openSlotWatchBrowser('unused-offline',async()=>context);
 const result=await observer.read('2026-10-14',new AbortController().signal);
 expect(result.snapshot.slots).toHaveLength(112);expect(result.cache).toMatchObject({status:'MISS',ageS:0});expect(reads).toBe(1);
 expect(await context.pages()[0]!.evaluate(()=>fetch('/api/bookings/public-checkout',{method:'POST'}).then(()=>true,()=>false))).toBe(false);expect(posts).toBe(0);
 await context.pages()[0]!.close();await expect(observer.read('2026-10-14',new AbortController().signal)).rejects.toThrow('OBSERVER_BROWSER_UNAVAILABLE');await observer.close();
});
it('closes a wrong-venue observer without reading availability',async()=>{
 const context=await browser.newContext();await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<h1 data-testid="public-booking-hero-title">Wrong venue</h1>'}));
 await expect(openSlotWatchBrowser('unused-offline',async()=>context)).rejects.toThrow('OBSERVER_VENUE_UNVERIFIED');expect(context.pages()).toHaveLength(0);
});
