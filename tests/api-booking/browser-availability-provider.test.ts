import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { OndaBrowserAvailabilityProvider } from '../../src/api-booking/browser-availability-provider.js';
import { availabilityFixture } from '../availability-fixture.js';
import { BUKO_SPACE_IDS, MANGO_SPACE_IDS } from '../../src/court-registry.js';

const date='2026-10-14';
let browser:Browser, page:Page;
beforeAll(async()=>{browser=await chromium.launch({headless:true});});
beforeEach(async()=>{page=await browser.newPage();await page.route('**/*',r=>r.request().isNavigationRequest()
  ?r.fulfill({contentType:'text/html',body:'<h1>Offline intercepted Onda</h1>'}):r.abort());await page.goto('https://app.onda.fit/book/thirsty-pickle');});
afterEach(async()=>{await page.close();});afterAll(async()=>{await browser.close();});
describe('normal browser-session availability',()=>{
  it('makes one same-origin GET, without security header replay or checkout calls',async()=>{
    const requests:Array<{method:string;path:string;headers:string[]}>=[];
    await page.route('**/date-availability?*',async r=>{requests.push({method:r.request().method(),path:new URL(r.request().url()).pathname,headers:Object.keys(r.request().headers())});await r.fulfill({json:availabilityFixture(date)});});
    expect((await new OndaBrowserAvailabilityProvider(page).getAvailability({startDate:date,endDate:date})).fixtureKind).toBe('live');
    expect(requests).toHaveLength(1);expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.headers.join()).not.toMatch(/turnstile|fingerprint|authorization/);
  });
  it.each([403,429])('does not retry a browser rejection %s',async status=>{
    let requests=0;await page.route('**/date-availability?*',async r=>{requests++;await r.fulfill({status,json:{error:'private diagnostic'}});});
    await expect(new OndaBrowserAvailabilityProvider(page).getAvailability({startDate:date,endDate:date})).rejects.toThrow(status===429?'AVAILABILITY_RATE_LIMITED':'AVAILABILITY_HTTP_FAILED');expect(requests).toBe(1);
  });
  it('refuses the wrong origin before any read',async()=>{
    await page.goto('https://example.invalid/');await expect(new OndaBrowserAvailabilityProvider(page).getAvailability({startDate:date,endDate:date})).rejects.toThrow('AVAILABILITY_BROWSER_SCOPE_INVALID');
  });
  it('validates Buko separately without reinterpreting its court number as Mango',async()=>{
    const raw=availabilityFixture(date);raw.data.slotsBySpace[BUKO_SPACE_IDS[4]]=structuredClone(raw.data.slotsBySpace[MANGO_SPACE_IDS[4]]!);
    await page.route('**/date-availability?*',r=>r.fulfill({json:raw}));
    await expect(new OndaBrowserAvailabilityProvider(page,{wing:'BUKO'}).getAvailability({startDate:date,endDate:date})).resolves.toMatchObject({raw});
  });
  it('does not follow an availability redirect',async()=>{
    await page.route('**/date-availability?*',r=>r.fulfill({status:302,headers:{location:'https://example.invalid/private'}}));
    await expect(new OndaBrowserAvailabilityProvider(page).getAvailability({startDate:date,endDate:date})).rejects.toThrow('AVAILABILITY_TRANSPORT_FAILED');
  });
  it('rejects an oversized body before parsing',async()=>{
    await page.route('**/date-availability?*',r=>r.fulfill({contentType:'application/json',body:' '.repeat(4_000_001)}));
    await expect(new OndaBrowserAvailabilityProvider(page).getAvailability({startDate:date,endDate:date})).rejects.toThrow('AVAILABILITY_RESPONSE_TOO_LARGE');
  });
});
