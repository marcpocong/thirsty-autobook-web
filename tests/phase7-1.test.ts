import {it,expect,vi,beforeAll,afterAll} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {readFile} from 'node:fs/promises';
import {ConfigSchema,bookingPlayers,playerReadiness,planFingerprint,ObservationSchema} from '../src/config.js';
import {bookingView,defaultSetup} from '../ui/booking.js';
import {PreparationSchema} from '../src/booking-plan.js';
import {prepareSchedule} from '../src/booking-prepare.js';
import {verifyRentalQuantity,reviewBundleSummary,ondaCheckoutAdapter} from '../src/onda-checkout.js';
import {Safety} from '../src/safety.js';
import {checkout} from '../src/checkout.js';
import {Telemetry} from '../src/telemetry.js';
import {Controller} from '../ui/controller.js';
import {clockStatus} from '../ui/status.js';
import {DateTime} from 'luxon';
import type {Command} from '../ui/types.js';
import {expectedPreparationFingerprint} from '../src/prepared-context.js';
const config=(extra:Record<string,unknown>={})=>ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Synthetic Primary',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'primary@example.invalid',...extra});
const b={PLAYER_B_FULL_NAME:'Synthetic Extended',PLAYER_B_PHONE:'09987654321',PLAYER_B_EMAIL:'extended@example.invalid'};
it.each([1,2] as const)('routes Standard %i courts to primary only and Extended to distinct local profiles',COURT_COUNT=>{
  const c=config({...b,COURT_COUNT});
  expect(bookingPlayers(c,'standard')).toEqual({A:{fullName:c.PLAYER_FULL_NAME,phone:c.PLAYER_PHONE,email:c.PLAYER_EMAIL},B:undefined});
  expect(bookingPlayers(c,'extended').B).toEqual({fullName:b.PLAYER_B_FULL_NAME,phone:b.PLAYER_B_PHONE,email:b.PLAYER_B_EMAIL});
  expect(planFingerprint(c)).toBe(planFingerprint(config({COURT_COUNT})));
  const view=JSON.stringify(bookingView(c));for(const value of [...Object.values(b),c.PLAYER_FULL_NAME,c.PLAYER_EMAIL,c.PLAYER_PHONE])expect(view).not.toContain(value);
});
it.each([{}, {PLAYER_B_FULL_NAME:'Synthetic Extended'}, {...b,PLAYER_B_EMAIL:'invalid'}, {...b,PLAYER_B_PHONE:'1234567'}, {...b,PLAYER_B_EMAIL:'primary@example.invalid'}])('missing, partial, invalid or duplicate B never falls back',extra=>{
  const c=config(extra);expect(()=>bookingPlayers(c,'standard')).not.toThrow();expect(()=>bookingPlayers(c,'extended')).toThrow('EXTENDED_PLAYER_INFO_MISSING');expect(playerReadiness(c).extended).toBe(false);
});
it.each([[1,1],[1,3],[2,1],[2,2],[2,3]])('validates %i courts times %i hours independently of current hourly price', (count,duration)=>{
  const quantity=count*duration;
  expect(()=>verifyRentalQuantity([`Court rental (${quantity} × ₱725.50)`],quantity)).not.toThrow();
  expect(()=>verifyRentalQuantity([`Court rental (${quantity+1} × ₱725.50)`],quantity)).toThrow('PAYMENT_QUANTITY_MISMATCH');
  expect(()=>verifyRentalQuantity([`Court rental (${quantity} × ₱725.50)`,'Court rental (1 × ₱725.50)'],quantity)).toThrow();
  const times=Array.from({length:duration},(_,i)=>`${i===0?12:i}:00 PM - ${i+1}:00 PM`);
  const cards=[6,7].slice(0,count).map(court=>({venue:'Thirsty Pickle | SM Seaside',fullDate:'Tuesday, September 15, 2026',shortDate:'Tue, Sep 15',court:`Court ${court}: Mango Wing`,times}));
  expect(reviewBundleSummary({count:`Your Reservations (${quantity})`,cards},quantity*725.5).courts).toEqual([6,7].slice(0,count));
  expect(()=>reviewBundleSummary({count:`Your Reservations (${quantity+1})`,cards},100)).toThrow();
});
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});});
afterAll(async()=>{await browser.close();});
it('prepares the exact calendar date with strict grid and zero reservation/checkout actions',async()=>{
  const page=await browser.newPage();const html=(await readFile('fixtures/schedule.html','utf8')).replace('</html>',`<span data-testid="booking-court-filter-label">All Courts</span><button aria-label="Select booking date" aria-expanded="false" onclick="this.setAttribute('aria-expanded',this.getAttribute('aria-expanded')==='true'?'false':'true')">Date</button><button data-day="9/11/2026" onclick="render('2026-09-11');document.querySelector('h3').textContent='Fri, September 11'">11</button></html>`);
  await page.route('**/*',r=>r.fulfill({body:html,contentType:'text/html'}));
  await page.addInitScript(()=>{(window as any).reservationClicks=0;document.addEventListener('click',e=>{const el=e.target as Element;if(el.closest('[data-testid="court-schedule-slot-cell"], [data-testid="booking-selection-summary-proceed-button"],input[type="checkbox"]'))(window as any).reservationClicks++;});});
  await prepareSchedule(page,new Safety(),'2026-09-11');
  expect(await page.locator('[data-testid="booking-selected-date-label"]').innerText()).toBe('Fri, September 11');
  expect(await page.evaluate(()=>(window as any).reservationClicks)).toBe(0);
  await expect(prepareSchedule(page,new Safety(),'2030-01-01')).rejects.toThrow('TARGET_DATE_UNAVAILABLE');await page.close();
});
it.each(['mismatch','extra'])('payment rental %s fails before Terms or final dispatch in the actual adapter',async mode=>{
  const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({body:'',contentType:'text/html'}));await page.goto('https://app.onda.fit/book/thirsty-pickle');
  await page.setContent(await readFile('fixtures/checkout.html','utf8'));
  await page.evaluate(mode=>{const rental=document.querySelector('[data-testid="booking-review-payment-summary-sheet"] span')!;if(mode==='extra')rental.after(rental.cloneNode(true));else rental.textContent='Court rental (3 × ₱600.00)';},mode);
  const s=new Safety(),t=new Telemetry(),expected={venue:'Thirsty Pickle | SM Seaside',date:'2026-09-11',court:7,start:'10:00',end:'12:00',duration:2,amount:1200,currency:'PHP'};
  await expect(checkout(ondaCheckoutAdapter(page,s,expected),s,t,expected,bookingPlayers(config(),'standard').A,1200,true)).rejects.toThrow(mode==='extra'?'PAYMENT_RENTAL_STRUCTURE_CHANGED':'PAYMENT_QUANTITY_MISMATCH');
  expect(s.boundary).toBe(false);expect(await page.locator('input[type="checkbox"]').isChecked()).toBe(false);expect(t.events.some(e=>e.event==='finalOndaActionStarted')).toBe(false);await page.close();
});
function harness(extra:Record<string,unknown>={},stopFails=false){
  const calls:Command[]=[],view=bookingView(config(extra));let finish!:(n:number)=>void;
  const stop=vi.fn(async()=>{if(stopFails)throw Error('STOP_NOT_CONFIRMED');finish(130);});
  const confirmStopPrepare=vi.fn(async()=>true);
  const c=new Controller({booking:()=>view,saveBooking:()=>view,lock:async()=>false,cdp:async()=>true,clock:()=>clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-10T07:00:00+08:00')),publish:()=>{},confirm:async()=>true,confirmStopPrepare,runner:(command,event)=>{calls.push(command);if(typeof command==='object'&&command.kind==='resetPrepare'){const input=command.input,strategy=input.workflow==='test'?input.request.strategy:view.setup.BOOKING_TYPE;event({type:'preparationResult',result:{workflow:input.workflow,strategy,fingerprint:expectedPreparationFingerprint(input,input.workflow==='release'?view.fingerprint:undefined),browsers:(strategy==='extended'?['A','B'] as const:['A'] as const).map(id=>({id,dedicatedProfileVerified:true,ondaVerified:true,preparedDate:input.workflow==='test'?input.request.date:'2026-09-10',gridVerified:true,selectedCount:0,hold:'Not detected' as const})),solutionAvailable:true,...(input.workflow==='release'?{releaseTargetDate:view.targetDate,releaseMs:view.releaseMs}:{})}});}return {pid:123,stop,done:command==='observe'?new Promise<number>(r=>{finish=r;}):Promise.resolve(0)};}});
  return {c,calls,stop,confirmStopPrepare};
}
const request={strategy:'extended' as const,date:'2026-09-15',start:'20:00',duration:4,courtCount:2 as const,priority:[7,6,5],fallbackStarts:[]};
it.each(['test','release'] as const)('missing B prevents %s readiness before a worker launches',async workflow=>{
  const h=harness({BOOKING_TYPE:'extended',DURATION_HOURS:4});
  await h.c.resetPrepare(workflow==='test'?{workflow,request,maximum:1800}:{workflow,strategy:'extended'});
  expect(h.calls).toEqual([]);expect(h.c.state.ready).toBe(false);expect(h.c.state.detail).toContain('EXTENDED PLAYER CONFIGURATION REQUIRED');
});
it('invalid Test request is rejected; exact request passes without saving release settings',async()=>{
  const h=harness(b),input={workflow:'test',request,maximum:1800};
  expect(PreparationSchema.safeParse({...input,request:{...request,duration:7}}).success).toBe(false);
  await h.c.resetPrepare(input);expect(h.calls).toEqual([{kind:'resetPrepare',input}]);expect(h.c.state.ready).toBe(true);expect(h.c.state.booking?.setup.BOOKING_TYPE).toBe('standard');
});
it.each([false,true])('active UI run uses safe stop, then inspects only after confirmed exit (failure=%s)',async fails=>{
  const h=harness(b,fails),run=h.c.armObservation();await vi.waitFor(()=>expect(h.calls).toEqual(['observe']));
  const reset=h.c.resetPrepare({workflow:'test',request,maximum:1800});
  if(fails){await expect(reset).rejects.toThrow('STOP_NOT_CONFIRMED');expect(h.calls).toEqual(['observe']);}
  else{await reset;await run;expect(h.calls[1]).toMatchObject({kind:'resetPrepare'});expect(h.c.state.ready).toBe(true);}
  expect(h.confirmStopPrepare).toHaveBeenCalledOnce();expect(h.stop).toHaveBeenCalledOnce();
});
