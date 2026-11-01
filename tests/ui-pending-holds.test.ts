import {afterAll,beforeAll,it,expect} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {openRenderer,showRendererView} from './renderer-harness.js';
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});});
afterAll(async()=>{await browser.close();});
it('shows separate durable states and invokes only the existing-hold recovery action at narrow width',async()=>{
  const page=await openRenderer(browser,{},'home',{width:390,height:844});
  try{
    await page.evaluate(()=>{const w=window as any;w.fixturePendingHolds=[{id:'a'.repeat(64),worker:'B',wing:'MANGO',courts:[6],date:'2026-11-03',start:'08:00',end:'11:00',amount:1800,
      advertisedExpiry:'2026-11-01T01:10:00Z',local:'LOCAL_RESPONSE_VALID',provider:'UNKNOWN',qr:'NOT_CHECKED',outstanding:true,freshConfirmationRequired:true,lastCheckedAt:'2026-11-01T01:00:00Z',diagnostic:'PROVIDER_404_BEFORE_ADVERTISED_EXPIRY',contradiction:true}];});
    await showRendererView(page,'records');const panel=page.locator('#pending-holds-panel');await expect.poll(()=>panel.innerText()).toContain('Browser B');
    expect(await panel.innerText()).toContain('UNRESOLVED PROVIDER CONTRADICTION');expect(await panel.innerText()).toContain('Provider: UNKNOWN');
    await panel.getByRole('button',{name:'Recover Existing Checkout',exact:true}).click();
    expect(await page.evaluate(()=>(window as any).fixturePendingRecoveryRequest)).toEqual({action:'recover',id:'a'.repeat(64),mode:'fresh'});
    await panel.getByRole('button',{name:'Recover in original tab',exact:true}).click();
    expect(await page.evaluate(()=>(window as any).fixturePendingRecoveryRequest.mode)).toBe('original');
    const calls=await page.evaluate(()=>(window as any).fixtureCalls as string[]);expect(calls.every(c=>!['testBooking','armFullBooking','resetPrepare','clearLock'].includes(c))).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }finally{await page.close();}
});
