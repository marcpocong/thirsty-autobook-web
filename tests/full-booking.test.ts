import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import {chromium,type Browser,type Page} from 'playwright';
import {readFile} from 'node:fs/promises';
import {snapshot} from '../src/grid.js';
import {Safety} from '../src/safety.js';
import {Telemetry} from '../src/telemetry.js';
import {selectionPort,selectResolvedPreference} from '../src/selection.js';
import {fullBookingToQr} from '../src/booking-checkout.js';
let browser:Browser,page:Page;
beforeAll(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});});
beforeEach(async()=>{
  await page?.close();const c=await browser.newContext({serviceWorkers:'block'});await c.route('**/*',r=>r.request().isNavigationRequest()?r.fulfill({body:'<html></html>',contentType:'text/html'}):r.abort());page=await c.newPage();await page.goto('https://app.onda.fit/book/thirsty-pickle');await page.setContent(await readFile('fixtures/schedule.html','utf8'));
  const review=(await readFile('fixtures/checkout.html','utf8')).replace(/<script>[\s\S]*?<\/script>/,'');const qr=await readFile('fixtures/qr-checkout.html','utf8');
  await page.evaluate(({review,qr})=>{
    const state=window as unknown as {render:(date:string)=>void;actions:string[]};state.actions=[];state.render('2026-09-11');document.querySelector('[data-testid="booking-selected-date-label"]')!.textContent='Fri, September 11';
    const summary=document.createElement('div');summary.dataset.testid='booking-selection-summary-sheet';summary.innerHTML='<span data-testid="booking-selection-summary-count">1 Court • 2 Slots</span><span data-testid="booking-selection-summary-amount">₱1,200</span><button data-testid="booking-selection-summary-proceed-button">Proceed</button>';document.body.append(summary);
    summary.querySelector('button')!.onclick=()=>{
      state.actions.push('bookingProceed');document.body.innerHTML=review;
      for(const label of ['Full Name','Phone Number','Email Address'])document.querySelector(`[aria-label="${label}"]`)!.addEventListener('input',()=>state.actions.push(label));
      document.querySelector<HTMLInputElement>('[type="tel"]')!.oninput=e=>{const field=e.target as HTMLInputElement;field.value=field.value.replace(/\D/g,'').replace(/^(\d{3})(\d{3})(\d{4})$/,'$1 $2 $3');};
      document.querySelector<HTMLButtonElement>('#proceed')!.onclick=()=>{state.actions.push('playerProceed');document.querySelector<HTMLElement>('[data-testid="booking-review-payment-summary-sheet"]')!.hidden=false;};
      document.querySelector<HTMLInputElement>('[type="checkbox"]')!.onchange=e=>{state.actions.push('terms');document.querySelector<HTMLButtonElement>('[aria-label="Continue to Payment"]')!.disabled=!(e.target as HTMLInputElement).checked;};
      document.querySelector<HTMLButtonElement>('[aria-label="Continue to Payment"]')!.onclick=()=>{
        state.actions.push('final');document.body.innerHTML=qr;
        for(const control of document.querySelectorAll('button,[role="button"]'))control.addEventListener('click',()=>state.actions.push('FORBIDDEN_PAYMENT_CONTROL'));
      };
    };
  },{review,qr});
});
afterAll(async()=>{await browser.close();});
const player={fullName:'Fixture Player',phone:'09123456789',email:'fixture@example.invalid'};
it('runs the actual selection→both Proceeds→terms→one final click→passive QR proof, with no payment interaction',async()=>{
  const s=new Safety(),t=new Telemetry();const selected=await selectResolvedPreference(selectionPort(page,s),'2026-09-11',await snapshot(page),[{court:7,hours:['10:00','11:00']}],1200,3,s,t);
  const result=await fullBookingToQr(page,selected,player,1200,true,1000,s,t);
  expect(result).toMatchObject({status:'Pending',countdown:'09:57',amount:1200});expect(s.locked).toBe(true);expect(s.boundary).toBe(true);
  expect(await page.evaluate(()=>(window as unknown as {actions:string[]}).actions)).toEqual(['bookingProceed','Full Name','Phone Number','Email Address','playerProceed','terms','final']);
  expect(t.events.at(-1)?.event).toBe('automationStopped');expect(t.events.filter(e=>e.event==='qrHandoffVerified')).toHaveLength(1);
  const events=JSON.stringify(t.events);for(const value of Object.values(player))expect(events).not.toContain(value);
});
it('Full Booking without terms authorization never clicks the first Proceed',async()=>{
  const s=new Safety(),t=new Telemetry();const selected=await selectResolvedPreference(selectionPort(page,s),'2026-09-11',await snapshot(page),[{court:7,hours:['10:00','11:00']}],1200,3,s,t);
  await expect(fullBookingToQr(page,selected,player,1200,false,1000,s,t)).rejects.toThrow('TERMS_AUTHORIZATION_REQUIRED');expect(await page.evaluate(()=>(window as unknown as {actions:string[]}).actions)).toEqual([]);
});
it('Emergency Stop before checkout prevents every subsequent action',async()=>{
  const s=new Safety(),t=new Telemetry();const selected=await selectResolvedPreference(selectionPort(page,s),'2026-09-11',await snapshot(page),[{court:7,hours:['10:00','11:00']}],1200,3,s,t);s.stop('USER_ABORT');
  await expect(fullBookingToQr(page,selected,player,1200,true,1000,s,t)).rejects.toThrow('USER_ABORT');expect(await page.evaluate(()=>(window as unknown as {actions:string[]}).actions)).toEqual([]);
});
