import type { Page } from 'playwright';
import { VENUE } from './config.js';
import { snapshot, validateSnapshot } from './grid.js';
import { selectionPort, selectionAmount, type SelectionResult } from './selection.js';
import { checkout, type Player } from './checkout.js';
import { ondaCheckoutAdapter } from './onda-checkout.js';
import { Safety } from './safety.js';
import { Telemetry } from './telemetry.js';
import {createPassiveHandoffReader,observePaymentHandoff} from './payment-handoff.js';
import {emitUiEvent} from './ui-events.js';
import {showWorkerPage} from './browser-window.js';
import type {WorkerId} from './workers.js';

export async function proceedWithVerifiedSelection(page:Page, selected:SelectionResult, player:Player, maximum:number, authorizeTerms:boolean, safety:Safety,t:Telemetry,paymentSummaryTimeoutMs=60000){
  safety.check();if(!safety.locked)throw new Error('BOOKING_LOCK_REQUIRED');
  const port=selectionPort(page,safety);await port.guard();t.mark('fullGuardCompleted');safety.check();
  t.mark('preProceedGridRead');const cells=validateSnapshot(await snapshot(page),selected.date);safety.check();
  const groups=selected.groups??[{court:selected.court,hours:selected.hours}];
  if(groups.length<1||groups.length>2||new Set(groups.map(g=>g.court)).size!==groups.length||selected.hours.length>3||groups.some(g=>JSON.stringify(g.hours)!==JSON.stringify(selected.hours)))throw Error('INVALID_CHECKOUT_BUNDLE');
  const current=cells.filter(c=>c.state==='SELECTED');
  if(cells.some(c=>c.state==='UNKNOWN')||current.length!==groups.reduce((n,g)=>n+g.hours.length,0)||current.some(c=>!groups.some(g=>g.court===c.court&&g.hours.includes(c.hour))))throw new Error('SELECTION_CHANGED_BEFORE_PROCEED');
  t.mark('selectionSummaryRead');const summary=await port.summary();safety.check();
  if(!summary.actionable||selectionAmount(summary,selected.hours.length*groups.length,maximum,groups.length)!==selected.amount)throw new Error('SELECTION_CHANGED_BEFORE_PROCEED');
  const expected={courts:groups.map(g=>g.court),venue:VENUE,date:selected.date,court:selected.court,start:selected.hours[0]!,end:`${String(Number(selected.hours.at(-1)!.slice(0,2))+1).padStart(2,'0')}:00`,duration:selected.hours.length,amount:selected.amount,currency:'PHP'};
  safety.check();t.mark('bookingProceedStarted');await page.getByTestId('booking-selection-summary-proceed-button').click();safety.check();t.mark('bookingProceedClicked');t.mark('proceedClicked');
  return checkout(ondaCheckoutAdapter(page,safety,expected,t,paymentSummaryTimeoutMs),safety,t,expected,player,maximum,authorizeTerms);
}
export async function fullBookingToQr(page:Page,selected:SelectionResult,player:Player,maximum:number,authorizeTerms:boolean,timeoutMs:number,safety:Safety,t:Telemetry,paymentSummaryTimeoutMs=60000,workerId:WorkerId='A'){
  safety.check();if(!authorizeTerms)throw new Error('TERMS_AUTHORIZATION_REQUIRED');
  // Construct the read-only capability before handoff. It exposes no active methods.
  const reader=createPassiveHandoffReader(page,safety);
  try {
    await proceedWithVerifiedSelection(page,selected,player,maximum,true,safety,t,paymentSummaryTimeoutMs);
  }catch(error){
    if(safety.boundary&&!safety.signal.aborted)throw new Error('HANDOFF_STATUS_UNKNOWN');
    throw error;
  }
  try {
    const hold=await observePaymentHandoff(reader,selected.amount,timeoutMs,safety,t);
    const [minutes,seconds]=hold.countdown.split(':').map(Number);
    await safety.stage('HOLD_VERIFIED',{holdVerifiedAt:hold.verifiedAt,holdExpiresAt:new Date(Date.parse(hold.verifiedAt)+(minutes!*60+seconds!)*1000).toISOString()});
    await showWorkerPage(page,workerId).catch(()=>undefined);
    emitUiEvent({type:'handoff',workerId,date:selected.date,court:selected.court,hours:selected.hours,...hold});
    return hold;
  }catch(error){
    if(safety.signal.aborted)throw error;
    throw new Error('HANDOFF_STATUS_UNKNOWN');
  }
}
