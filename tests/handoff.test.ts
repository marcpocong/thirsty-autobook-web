import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
import {chromium,type Browser,type Page} from 'playwright';
import {Safety} from '../src/safety.js';
import {Telemetry} from '../src/telemetry.js';
import {createPassiveHandoffReader,observePaymentHandoff,validateHandoff,type HandoffEvidence} from '../src/payment-handoff.js';
import {verifiedHandoffProof,fullBookingReady} from '../src/capabilities.js';
import {checkout} from '../src/checkout.js';
import {ondaCheckoutAdapter} from '../src/onda-checkout.js';
import {readFile} from 'node:fs/promises';
const evidence:HandoffEvidence={checkout:true,hold:true,pending:true,orderSummary:true,qrph:true,qrPresent:true,countdown:'09:57',amount:600,currency:'PHP'};
async function sealed(){const safety=new Safety();await safety.finalAction(async()=>{});return safety;}
let browser:Browser,page:Page;
beforeAll(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});});
beforeEach(async()=>{await page?.close();const c=await browser.newContext({serviceWorkers:'block'});await c.route('**/*',r=>r.request().isNavigationRequest()?r.fulfill({contentType:'text/html',body:'<html></html>'}):r.abort());page=await c.newPage();await page.goto('https://app.onda.fit/checkout/fixture');});
afterAll(async()=>{await browser.close();});
it.each(['checkout','hold','pending','orderSummary','qrph','qrPresent'] as const)('requires independent %s evidence',key=>{expect(validateHandoff({...evidence,[key]:false},600)).toBeUndefined();});
it.each(['00:00','10:01','99:00'])('rejects inactive/implausible countdown %s',countdown=>{expect(()=>validateHandoff({...evidence,countdown},600)).toThrow('HOLD_INACTIVE');});
it('rejects mismatching Checkout total',()=>{expect(()=>validateHandoff(evidence,1200)).toThrow('AMOUNT_MISMATCH');});
it('permits passive reads only after sealing and exposes no interaction methods or QR payload',async()=>{
  await page.setContent('<h1>Checkout</h1><div><p>Slot reserved for</p><p>09:57</p></div><span>Pending</span><div><div><h3>Order summary</h3></div><div><span>Total</span><span>₱600.00</span></div></div><div data-testid="checkout-payment-method-option">QRPH</div><div data-testid="checkout-payment-amount-panel"><span data-testid="checkout-payment-amount-value">₱600.00</span><canvas width="256" height="256"></canvas></div><button>Save QR Code</button><button>Check payment status</button>');
  const safety=new Safety(),reader=createPassiveHandoffReader(page,safety);
  expect(Object.keys(reader)).toEqual(['read']);expect(Object.isFrozen(reader)).toBe(true);await expect(reader.read()).rejects.toThrow('GATE_NOT_SEALED');
  await safety.finalAction(async()=>{});const r=await reader.read();expect(r).toEqual(evidence);
  expect(Object.keys(r)).not.toEqual(expect.arrayContaining(['src','payload','image','url']));
  const click=vi.spyOn(page,'click');const result=await observePaymentHandoff(reader,600,1000,safety,new Telemetry());expect(result.status).toBe('Pending');expect(click).not.toHaveBeenCalled();
});
it('stops passive reads immediately when proof arrives',async()=>{const safety=await sealed(),read=vi.fn(async()=>evidence);await observePaymentHandoff({read},600,1000,safety,new Telemetry());expect(read).toHaveBeenCalledOnce();});
it('bounds a missing handoff without actions or endless payment polling',async()=>{const safety=await sealed(),read=vi.fn(async()=>({...evidence,qrPresent:false}));await expect(observePaymentHandoff({read},600,20,safety,new Telemetry())).rejects.toThrow('STATUS_UNKNOWN');expect(read.mock.calls.length).toBeLessThanOrEqual(2);});
it('bounds even a stalled browser read',async()=>{const safety=await sealed();await expect(observePaymentHandoff({read:()=>new Promise(()=>{})},600,20,safety,new Telemetry())).rejects.toThrow('STATUS_UNKNOWN');});
it('abort after seal performs no further browser reads or active interaction',async()=>{const safety=await sealed(),read=vi.fn(async()=>evidence);safety.stop('USER_ABORT');await expect(observePaymentHandoff({read},600,1000,safety,new Telemetry())).rejects.toThrow('USER_ABORT');expect(read).not.toHaveBeenCalled();expect(()=>safety.check()).toThrow('USER_ABORT');});
it('an ambiguous final dispatch is permanently sealed and never retried',async()=>{const safety=new Safety(),dispatch=vi.fn(async()=>{safety.consumeFinalDispatch();throw Error('transport failed');});await expect(safety.finalAction(dispatch)).rejects.toThrow('transport');await expect(safety.finalAction(dispatch)).rejects.toThrow('PAYMENT_BOUNDARY');expect(dispatch).toHaveBeenCalledOnce();expect(()=>safety.consumeFinalDispatch()).toThrow('ALREADY_DISPATCHED');});
it('consumes the final dispatch permit exactly once inside the sealed gate',async()=>{const safety=new Safety();await safety.finalAction(async()=>{expect(()=>safety.check()).toThrow('PAYMENT_BOUNDARY');safety.consumeFinalDispatch();expect(()=>safety.consumeFinalDispatch()).toThrow('ALREADY_DISPATCHED');});});
it('cannot enable full booking without explicit live evidence and every capability',()=>{
  expect(verifiedHandoffProof(null)).toBe(false);expect(verifiedHandoffProof({source:'synthetic'} as never)).toBe(false);
  expect(fullBookingReady({selectionReady:true,checkoutReady:true,paymentBoundaryReady:false})).toBe(false);
  expect(fullBookingReady({selectionReady:true,checkoutReady:true,paymentBoundaryReady:true})).toBe(true);
});
it('checks both final button labels, Terms state, and exact total before one final dispatch',async()=>{
  await page.goto('https://app.onda.fit/book/thirsty-pickle');await page.setContent(await readFile('fixtures/checkout.html','utf8'));
  const safety=new Safety(),expected={venue:'Thirsty Pickle | SM Seaside',date:'2026-09-11',court:7,start:'10:00',end:'12:00',duration:2,amount:1200,currency:'PHP'},adapter=ondaCheckoutAdapter(page,safety,expected);
  const player={fullName:'Fixture Player',phone:'09123456789',email:'fixture@example.invalid'};
  expect(await page.getByRole('button',{name:'Continue to Payment',exact:true,includeHidden:true}).innerText()).toBe('Confirm & Proceed to Payment');
  await checkout(adapter,safety,new Telemetry(),expected,player,1200,true);
  await expect(adapter.finalOndaAction()).rejects.toThrow('ALREADY_DISPATCHED');
  expect((await page.evaluate(()=>(window as unknown as {actions:string[]}).actions)).filter(a=>a==='final')).toHaveLength(1);
});
it('rechecks total after terms and blocks the final action if changed',async()=>{
  await page.goto('https://app.onda.fit/book/thirsty-pickle');await page.setContent(await readFile('fixtures/checkout.html','utf8'));
  const safety=new Safety(),expected={venue:'Thirsty Pickle | SM Seaside',date:'2026-09-11',court:7,start:'10:00',end:'12:00',duration:2,amount:1200,currency:'PHP'},adapter=ondaCheckoutAdapter(page,safety,expected),accept=adapter.acceptTerms;
  adapter.acceptTerms=async()=>{const result=await accept();await page.locator('#total').evaluate(e=>e.textContent='₱1,201.00');return result;};
  await expect(checkout(adapter,safety,new Telemetry(),expected,{fullName:'Fixture Player',phone:'09123456789',email:'fixture@example.invalid'},1500,true)).rejects.toThrow('PAYMENT_PRICE_MISMATCH');expect(safety.boundary).toBe(false);
});
