import type { Page } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { Safety } from './safety.js';
import { Telemetry } from './telemetry.js';

export const HandoffEvidenceSchema=z.object({
  checkout:z.boolean(),hold:z.boolean(),pending:z.boolean(),orderSummary:z.boolean(),qrph:z.boolean(),qrPresent:z.boolean(),
  countdown:z.string().regex(/^\d{1,2}:[0-5]\d$/).nullable(),amount:z.number().finite().nullable(),currency:z.literal('PHP').nullable(),
}).strict();
export type HandoffEvidence=z.infer<typeof HandoffEvidenceSchema>;
export interface PassiveHandoffReader { read():Promise<HandoffEvidence> }
export interface HandoffResult { status:'Pending'; countdown:string; amount:number; currency:'PHP'; verifiedAt:string }
export function validateHandoff(e:HandoffEvidence,amount:number):HandoffResult|undefined {
  if(!e.checkout||!e.hold||!e.pending||!e.orderSummary||!e.qrph||!e.qrPresent||!e.countdown||e.amount===null||e.currency!=='PHP')return;
  if(e.amount!==amount)throw new Error('HANDOFF_AMOUNT_MISMATCH');
  const [minutes,seconds]=e.countdown.split(':').map(Number);const remaining=minutes!*60+seconds!;
  if(remaining<=0||remaining>600)throw new Error('HANDOFF_HOLD_INACTIVE');
  return {status:'Pending',countdown:e.countdown,amount:e.amount,currency:'PHP',verifiedAt:new Date().toISOString()};
}
// This narrow object has no navigation, locator, click, fill, QR export or payment APIs.
// Only booleans/countdown/amount leave the DOM; QR pixels, URLs and payloads are never read.
export function createPassiveHandoffReader(page:Page,safety:Safety):PassiveHandoffReader {
  return Object.freeze({async read(){
    safety.checkPassiveHandoff();
    if(new URL(page.url()).origin!=='https://app.onda.fit')throw new Error('HANDOFF_ORIGIN_UNVERIFIED');
    const evidence=await page.evaluate(()=>{
      const visible={test(e:Element){return e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';}};
      const nodes=[...document.querySelectorAll('h1,h2,h3,h4,p,span,div')].filter(e=>visible.test(e));
      const exact={find(text:string){return nodes.filter(e=>e.textContent?.trim()===text);}};
      const holds=exact.find('Slot reserved for').filter(e=>e.tagName==='P');
      const countdowns=[...new Set(holds.flatMap(e=>[...(e.parentElement?.querySelectorAll('p')??[])].map(p=>p.textContent?.trim()??'')).filter(s=>/^\d{1,2}:[0-5]\d$/.test(s)))];
      const countdown=countdowns.length===1?countdowns[0]!:null;
      const orders=exact.find('Order summary').filter(e=>e.tagName==='H3');
      const totals=orders.flatMap(e=>[...(e.parentElement?.parentElement?.querySelectorAll('span')??[])]).filter(e=>e.textContent?.trim()==='Total').map(e=>e.parentElement?.textContent?.trim()??'');
      const amounts=[...new Set(totals.map(s=>s.match(/₱((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})$/)?.[1]).filter(Boolean))];
      const panelAmounts=[...document.querySelectorAll('[data-testid="checkout-payment-amount-value"]')].filter(e=>visible.test(e)).map(e=>e.textContent?.trim()??'');
      const amountVerified=amounts.length===1&&panelAmounts.length===1&&panelAmounts[0]===`₱${amounts[0]}`;
      // Observed QR renderer: one visible canvas within this verified payment panel.
      // Presence and layout only: never getContext(), toDataURL(), pixels or QR contents.
      const qr=[...document.querySelectorAll('[data-testid="checkout-payment-amount-panel"] canvas')].filter(e=>visible.test(e)&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0).length===1;
      return {checkout:[...document.querySelectorAll('h1')].some(e=>visible.test(e)&&e.textContent?.trim()==='Checkout'),hold:holds.length>0,pending:exact.find('Pending').some(e=>e.tagName==='SPAN'),orderSummary:orders.length===1,qrph:[...document.querySelectorAll('[data-testid="checkout-payment-method-option"]')].some(e=>visible.test(e)&&e.textContent?.trim()==='QRPH'),qrPresent:qr,countdown,amount:amountVerified?Number(amounts[0]!.replaceAll(',','')):null,currency:amountVerified?'PHP' as const:null};
    });safety.checkPassiveHandoff();return HandoffEvidenceSchema.parse(evidence);
  }});
}
export async function observePaymentHandoff(reader:PassiveHandoffReader,expectedAmount:number,timeoutMs:number,safety:Safety,t:Telemetry):Promise<HandoffResult>{
  safety.checkPassiveHandoff();
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new Error('INVALID_HANDOFF_TIMEOUT');
  const deadline=performance.now()+timeoutMs;let checkoutSeen=false,holdSeen=false;
  // Bounded state polling only, never payment-status polling. Stops at first complete proof.
  while(performance.now()<deadline){
    safety.checkPassiveHandoff();
    const remaining=Math.max(1,deadline-performance.now());
    let evidence:HandoffEvidence;
    try {
      evidence=await new Promise<HandoffEvidence>((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timer);safety.signal.removeEventListener('abort',abort);};
        const abort=()=>{cleanup();reject(safety.signal.reason);};
        const timer=setTimeout(()=>{cleanup();reject(new Error('HANDOFF_STATUS_UNKNOWN'));},remaining);
        safety.signal.addEventListener('abort',abort,{once:true});
        reader.read().then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
      });
    } catch(error){
      safety.checkPassiveHandoff();
      if(error instanceof Error&&/Execution context was destroyed|Cannot find context with specified id/.test(error.message))continue;
      throw error;
    }
    safety.checkPassiveHandoff();
    if(evidence.checkout&&!checkoutSeen){checkoutSeen=true;t.mark('checkoutPageDetected');}
    if(evidence.hold&&!holdSeen){holdSeen=true;t.mark('holdStatusDetected');}
    const result=validateHandoff(evidence,expectedAmount);
    if(result){t.mark('qrHandoffVerified');t.mark('automationStopped');return result;}
    await delay(Math.min(100,Math.max(1,deadline-performance.now())),undefined,{signal:safety.signal});
  }
  throw new Error('HANDOFF_STATUS_UNKNOWN');
}
