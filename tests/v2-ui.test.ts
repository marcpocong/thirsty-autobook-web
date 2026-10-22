import { it,expect } from 'vitest';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { openRenderer } from './renderer-harness.js';

for(const width of [1440,390])it(`shows a truthful possible hold and provider refusal at ${width}px`,async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    await mkdir('.local/v2-ui',{recursive:true});
    const page=await openRenderer(browser,{possibleHolds:[{key:'synthetic',date:'2026-10-24',courts:[7],startTime:'19:00',endTime:'22:00',amount:2100,
      holdExpiresAt:new Date(Date.now()+300_000).toISOString(),bookingIds:['synthetic-booking'],bookingNumbers:['SYNTHETIC-ONLY'],code:'CHECKOUT_SESSION_INVALID'}]},'setup',{width,height:1000});
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await expect.poll(()=>page.locator('#possible-hold-alert').isVisible()).toBe(true);
    expect(await page.locator('#possible-hold-alert').innerText()).toContain('POSSIBLE HOLD DETECTED');
    expect(await page.locator('#possible-hold-alert').innerText()).toContain('not verified or paid');
    const date=await page.locator('#availability-date').inputValue();
    await page.evaluate(date=>{const w=window as any;w.fixtureState.courtBrowser={type:'courtBrowser',date,capturedAt:new Date().toISOString(),cells:[],
      wings:[{wing:'MANGO',status:'ERROR',code:'AVAILABILITY_HTTP_FAILED',httpStatus:403,requestSent:true,cells:0},
        {wing:'BUKO',status:'ERROR',code:'AVAILABILITY_HTTP_FAILED',httpStatus:403,requestSent:false,cells:0}]};w.fixturePublish(w.fixtureState);},date);
    await expect.poll(()=>page.locator('#court-browser-grid').innerText()).toContain('HTTP 403');
    expect(await page.locator('#court-browser-grid').innerText()).toContain('NOT SENT');
    expect(await page.locator('#court-browser-status').innerText()).not.toContain('Verified');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({path:`.local/v2-ui/${width}-possible-hold.png`,fullPage:true});expect(errors).toEqual([]);
    await page.close();
  }finally{await browser.close();}
},30_000);
