import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {chromium,type Browser,type Page} from 'playwright';
import {readFile} from 'node:fs/promises';
import {ONDA_URL,VENUE} from '../src/config.js';
import {ondaCheckoutAdapter,nationalPhone,reviewSummary} from '../src/onda-checkout.js';
import {checkout,validateSummary} from '../src/checkout.js';
import {Safety} from '../src/safety.js';
import {Telemetry} from '../src/telemetry.js';
let browser:Browser,page:Page;
const expected={venue:VENUE,date:'2026-09-11',court:7,start:'10:00',end:'12:00',duration:2,amount:1200,currency:'PHP'};
const player={fullName:'Fixture Player',phone:'09123456789',email:'fixture@example.invalid'};
beforeAll(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});});
beforeEach(async()=>{await page?.close();const context=await browser.newContext({serviceWorkers:'block'});const html=await readFile('fixtures/checkout.html','utf8');await context.route('**/*',r=>r.request().isNavigationRequest()?r.fulfill({contentType:'text/html',body:html}):r.abort());page=await context.newPage();await page.goto(ONDA_URL);});
afterAll(async()=>{await browser.close();});
it.each(['09123456789','9123456789','+639123456789','639123456789','912 345 6789'])('normalizes a supported PH mobile representation',value=>{expect(nationalPhone(value)).toBe('9123456789');});
it.each(['12345','+14155551212','091234567890','912abc3456789'])('refuses ambiguous/unsupported phone formats',value=>expect(()=>nationalPhone(value)).toThrow());
it('uses observed DOM selectors and stops at Payment Summary without terms authorization',async()=>{
  const safety=new Safety(),t=new Telemetry();const adapter=ondaCheckoutAdapter(page,safety,expected);
  expect(await checkout(adapter,safety,t,expected,player,1200,false)).toBe('TERMS_NOT_AUTHORIZED');
  expect(await page.getByRole('textbox',{name:'Phone Number',exact:true}).inputValue()).toBe('912 345 6789');
  const actions=await page.evaluate(()=>(window as unknown as {actions:string[]}).actions);expect(actions).toEqual(['Full Name','Phone Number','Email Address','proceed']);
  const serialized=JSON.stringify(t.events);for(const value of Object.values(player))expect(serialized).not.toContain(value);
});
it('checks all review material against expected selection',async()=>{
  await page.getByTestId('booking-review-reservation-date').locator('..').getByText('Court 7: Mango Wing',{exact:true}).evaluate(e=>e.textContent='Court 6: Mango Wing');
  const actual=await ondaCheckoutAdapter(page,new Safety(),expected).review();expect(()=>validateSummary(actual,expected,1200,'REVIEW')).toThrow('MISMATCH');
});
it('checks the native Onda Terms checkbox inside Payment Summary before final handoff',async()=>{
  const safety=new Safety(),t=new Telemetry(),adapter=ondaCheckoutAdapter(page,safety,expected);
  expect(await checkout(adapter,safety,t,expected,player,1200,true)).toBe('PAYMENT_BOUNDARY_REACHED');
  expect(await page.getByTestId('booking-review-terms-panel').locator('input[type="checkbox"]').isChecked()).toBe(true);
  expect(t.events.map(e=>e.event)).toContain('termsChecked');
});
it('checks a custom role checkbox when Onda renders Terms without a native input',async()=>{
  await page.setContent('<div data-testid="booking-review-terms-panel"><div role="checkbox" aria-checked="false" tabindex="0">I agree to the Terms and Conditions, Privacy Policy, and Liability Waiver</div></div>');
  await page.locator('[role="checkbox"]').evaluate(e=>e.addEventListener('click',()=>e.setAttribute('aria-checked','true')));
  const safety=new Safety();safety.lock();const adapter=ondaCheckoutAdapter(page,safety,expected);
  expect(await adapter.acceptTerms()).toBe(true);
  expect(await page.getByTestId('booking-review-terms-panel').getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
});
it('waits for the Onda Terms control to hydrate after Payment Summary appears',async()=>{
  await page.setContent('<div data-testid="booking-review-terms-panel"></div><script>setTimeout(()=>{const i=document.createElement("input");i.type="checkbox";document.querySelector("[data-testid=booking-review-terms-panel]").append(i)},120)</script>');
  const safety=new Safety();safety.lock();const adapter=ondaCheckoutAdapter(page,safety,expected);
  expect(await adapter.acceptTerms()).toBe(true);
  expect(await page.getByTestId('booking-review-terms-panel').locator('input[type="checkbox"]').isChecked()).toBe(true);
});
it('waits for a transient duplicate Terms panel to settle on one visible control',async()=>{
  await page.setContent('<div data-testid="booking-review-terms-panel"><input type="checkbox"></div><div data-testid="booking-review-terms-panel"><input type="checkbox"></div><script>setTimeout(()=>document.querySelectorAll("[data-testid=booking-review-terms-panel]")[0].hidden=true,120)</script>');
  const safety=new Safety();safety.lock();const adapter=ondaCheckoutAdapter(page,safety,expected);
  expect(await adapter.acceptTerms()).toBe(true);
  expect(await page.locator('[data-testid="booking-review-terms-panel"]:visible input[type="checkbox"]').count()).toBe(1);
});
it('reacquires Terms after Onda rerenders the panel on change',async()=>{
  await page.setContent('<div data-testid="booking-review-terms-panel"><input type="checkbox"></div><script>document.querySelector("input").addEventListener("change",()=>{const p=document.querySelector("[data-testid=booking-review-terms-panel]");p.innerHTML="<input type=checkbox checked><input type=checkbox>";setTimeout(()=>p.querySelectorAll("input")[1].remove(),120)})</script>');
  const safety=new Safety();safety.lock();const adapter=ondaCheckoutAdapter(page,safety,expected);
  expect(await adapter.acceptTerms()).toBe(true);
  expect(await page.locator('[data-testid="booking-review-terms-panel"]:visible input[type="checkbox"]').count()).toBe(1);
  expect(await page.locator('[data-testid="booking-review-terms-panel"]:visible input[type="checkbox"]').isChecked()).toBe(true);
});
it('rechecks Terms immediately before final handoff after a Payment Summary rerender',async()=>{
  const safety=new Safety(),t=new Telemetry(),adapter=ondaCheckoutAdapter(page,safety,expected),accept=adapter.acceptTerms;
  adapter.acceptTerms=async()=>{const result=await accept();await page.getByTestId('booking-review-terms-panel').locator('input[type="checkbox"]').evaluate(e=>(e as HTMLInputElement).checked=false);return result;};
  expect(await checkout(adapter,safety,t,expected,player,1200,true)).toBe('PAYMENT_BOUNDARY_REACHED');
  expect(await page.getByTestId('booking-review-terms-panel').locator('input[type="checkbox"]').isChecked()).toBe(true);
});
it('refuses altered payment amount before accepting terms',async()=>{
  await page.locator('#total').evaluate(e=>e.textContent='₱1,201.00');const safety=new Safety();await expect(checkout(ondaCheckoutAdapter(page,safety,expected),safety,new Telemetry(),expected,player,1500,true)).rejects.toThrow('PAYMENT_PRICE_MISMATCH');expect(await page.getByRole('checkbox').isChecked()).toBe(false);
});
it('revalidates background date/court/time at Payment Summary',async()=>{
  const safety=new Safety(),adapter=ondaCheckoutAdapter(page,safety,expected),proceed=adapter.playerProceed;
  adapter.playerProceed=async()=>{await proceed();await page.getByText('11:00 AM - 12:00 PM',{exact:true}).evaluate(e=>e.textContent='12:00 PM - 1:00 PM');};await expect(checkout(adapter,safety,new Telemetry(),expected,player,1200,true)).rejects.toThrow('REVIEW_HOURS_MISMATCH');expect(await page.getByRole('checkbox').isChecked()).toBe(false);
});
it('refuses changed phone-prefix markup before filling anything',async()=>{await page.getByText('+63',{exact:true}).evaluate(e=>e.textContent='+1');await expect(ondaCheckoutAdapter(page,new Safety(),expected).fillPlayer(player)).rejects.toThrow('PREFIX_UNVERIFIED');expect(await page.getByRole('textbox',{name:'Full Name',exact:true}).inputValue()).toBe('');});
it.each(['review','fillPlayer'] as const)('abort during %s stops subsequent checkout actions',async(stage)=>{
  const safety=new Safety(),adapter=ondaCheckoutAdapter(page,safety,expected);
  if(stage==='review'){const original=adapter.review;adapter.review=async()=>{const result=await original();safety.stop('USER_ABORT');return result;};}
  else{const original=adapter.fillPlayer;adapter.fillPlayer=async p=>{const result=await original(p);safety.stop('USER_ABORT');return result;};}
  await expect(checkout(adapter,safety,new Telemetry(),expected,player,1200,true)).rejects.toThrow('USER_ABORT');expect(await page.evaluate(()=>(window as unknown as {actions:string[]}).actions)).not.toContain('proceed');
});
it('guards direct final dispatch and permanently stops at the synthetic payment boundary',async()=>{
  const safety=new Safety(),adapter=ondaCheckoutAdapter(page,safety,expected);await expect(adapter.finalOndaAction()).rejects.toThrow('PAYMENT_GATE_CLOSED');
  expect(await checkout(adapter,safety,new Telemetry(),expected,player,1200,true)).toBe('PAYMENT_BOUNDARY_REACHED');
  const actions=await page.evaluate(()=>(window as unknown as {actions:string[]}).actions);expect(actions.at(-1)).toBe('final');await expect(adapter.review()).rejects.toThrow('PAYMENT_BOUNDARY_REACHED');
});
