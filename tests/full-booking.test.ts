import {selectExactPractice} from '../src/full-practice.js';
import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import {chromium,type Browser,type Page} from 'playwright';
import {readFile} from 'node:fs/promises';
import {snapshot} from '../src/grid.js';
import {Safety} from '../src/safety.js';
import {Telemetry} from '../src/telemetry.js';
import {selectionPort,selectResolvedPreference} from '../src/selection.js';
import {fullBookingToQr} from '../src/booking-checkout.js';
import {selectCheckoutBundle} from '../src/checkout-selection.js';
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
it('two courts traverse ONE complete normal checkout and ONE QR hold with durable stages',async()=>{
  await page.evaluate(()=>{
    document.querySelector('[data-testid="booking-selection-summary-count"]')!.textContent='2 Courts • 4 Slots';
    document.querySelector('[data-testid="booking-selection-summary-amount"]')!.textContent='₱2,400';
    const proceed=document.querySelector<HTMLButtonElement>('[data-testid="booking-selection-summary-proceed-button"]')!,original=proceed.onclick!;
    proceed.onclick=function(event){
      original.call(this,event);
      const card=document.querySelector('[data-testid="booking-review-reservation-date"]')!.parentElement!;
      const other=card.cloneNode(true) as Element;other.innerHTML=other.innerHTML.replace('Court 7:','Court 6:');card.after(other);
      [...document.querySelectorAll('h3')].find(e=>e.textContent?.startsWith('Your Reservations'))!.textContent='Your Reservations (4)';
      document.querySelector('[data-testid="booking-review-payment-summary-sheet"] span')!.textContent='Court rental (4 \u00d7 \u20b1600.00)';
      document.querySelector('#total')!.textContent='₱2,400.00';
      const final=document.querySelector<HTMLButtonElement>('[aria-label="Continue to Payment"]')!,dispatch=final.onclick!;
      final.onclick=function(event){dispatch.call(this,event);for(const span of document.querySelectorAll('span,div'))if(span.textContent?.trim()==='₱1,200.00'&&span.children.length===0)span.textContent='₱2,400.00';};
    };
  });
  const s=new Safety(),t=new Telemetry(),stages:string[]=[];s.persistStage=async stage=>{stages.push(stage);};
  const selected=await selectCheckoutBundle(selectionPort(page,s),'2026-09-11',await snapshot(page),{browser:'A',start:'10:00',duration:2,hours:['10:00','11:00'],requiredCourtCount:2,courts:[7,6]},1200,s,new Set());
  const hold=await fullBookingToQr(page,selected,player,2400,true,1000,s,t);
  expect(hold.amount).toBe(2400);expect(stages).toEqual(['SELECTION','SELECTION_VERIFIED','REVIEW','PAYMENT_SUMMARY','FINAL_ACTION_DISPATCHING','HOLD_VERIFIED']);
  const actions=await page.evaluate(()=>(window as unknown as {actions:string[]}).actions);
  expect(actions.filter(a=>a==='bookingProceed')).toHaveLength(1);expect(actions.filter(a=>a==='final')).toHaveLength(1);expect(actions).not.toContain('FORBIDDEN_PAYMENT_CONTROL');
});
it('runs the actual selection→both Proceeds→terms→one final click→passive QR proof, with no payment interaction',async()=>{
  const s=new Safety(),t=new Telemetry();const selected=await selectResolvedPreference(selectionPort(page,s),'2026-09-11',await snapshot(page),[{court:7,hours:['10:00','11:00']}],1200,3,s,t);
  const result=await fullBookingToQr(page,selected,player,1200,true,1000,s,t);
  expect(result).toMatchObject({status:'Pending',countdown:'09:57',amount:1200});expect(s.locked).toBe(true);expect(s.boundary).toBe(true);
  expect(await page.evaluate(()=>(window as unknown as {actions:string[]}).actions)).toEqual(['bookingProceed','Full Name','Phone Number','Email Address','playerProceed','terms','final']);
  expect(t.events.at(-1)?.event).toBe('automationStopped');expect(t.events.filter(e=>e.event==='qrHandoffVerified')).toHaveLength(1);
  expect(t.events.filter(e=>e.event==='preProceedGridRead')).toHaveLength(1);
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

async function practiceCalendar(){
 await page.evaluate(()=>{
  const filter=document.createElement('span');filter.dataset.testid='booking-court-filter-label';filter.textContent='All Courts';document.body.append(filter);
  const picker=document.createElement('button');picker.setAttribute('aria-label','Select booking date');picker.setAttribute('aria-expanded','false');picker.onclick=()=>picker.setAttribute('aria-expanded',picker.getAttribute('aria-expanded')==='true'?'false':'true');document.body.append(picker);
  const day=document.createElement('button');day.dataset.day='9/11/2026';day.textContent='September 11';day.onclick=()=>picker.setAttribute('aria-expanded','false');document.body.append(day);
 });
}
it('exact practice reuses both production Proceeds, Review/player validation, Terms, final action and passive QR stop',async()=>{
 await practiceCalendar();const s=new Safety(),t=new Telemetry();
 const selected=await selectExactPractice(page,{target:{date:'2026-09-11',court:7,start:'10:00',duration:2},maximum:1200,authorizeTerms:true},s,t);
 expect(selected).toMatchObject({court:7,hours:['10:00','11:00'],attempts:1});
 const hold=await fullBookingToQr(page,selected,player,1200,true,1000,s,t);
 expect(hold).toMatchObject({status:'Pending',amount:1200});expect(s.locked&&s.boundary).toBe(true);
 expect(await page.evaluate(()=>(window as unknown as {actions:string[]}).actions)).toEqual(['bookingProceed','Full Name','Phone Number','Email Address','playerProceed','terms','final']);
 expect(t.events.some(e=>['armed','releaseTriggerFired','fallbackResolved'].includes(e.event))).toBe(false);
});
it('unavailable exact practice court stops without falling back to open courts',async()=>{
 await practiceCalendar();await expect(selectExactPractice(page,{target:{date:'2026-09-11',court:3,start:'10:00',duration:2},maximum:1200,authorizeTerms:true},new Safety(),new Telemetry())).rejects.toThrow('PRACTICE_TARGET_UNAVAILABLE');
 expect((await snapshot(page)).cells.some(c=>c.state==='selected')).toBe(false);
});
it('practice refuses a disabled normal calendar date',async()=>{
 await practiceCalendar();await page.locator('[data-day]').evaluate(e=>(e as HTMLButtonElement).disabled=true);
 await expect(selectExactPractice(page,{target:{date:'2026-09-11',court:7,start:'10:00',duration:2},maximum:1200,authorizeTerms:true},new Safety(),new Telemetry())).rejects.toThrow('PRACTICE_DATE_UNAVAILABLE');
});
