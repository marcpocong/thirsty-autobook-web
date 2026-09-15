import { expandHours } from './config.js';
import { validateSnapshot, type Snapshot } from './grid.js';
import { selectionAmount, type SelectionPort, type SelectionResult } from './selection.js';
import type { Safety } from './safety.js';
import type { BookingChunk } from './booking-plan.js';
import type {Telemetry} from './telemetry.js';

export interface CheckoutSelection extends SelectionResult { groups:{court:number;hours:string[];amount?:number}[]; totalAmount:number }
export async function selectCheckoutBundle(port:SelectionPort,date:string,grid:Snapshot,chunk:BookingChunk,maximum:number,safety:Safety,dispatched:Set<string>,t?:Telemetry):Promise<CheckoutSelection>{
  const courts=chunk.courts;
  if(!courts||courts.length!==chunk.requiredCourtCount||new Set(courts).size!==courts.length||courts.some(c=>!Number.isInteger(c)||c<1||c>7)||chunk.duration>3||JSON.stringify(expandHours(chunk.start,chunk.duration))!==JSON.stringify(chunk.hours))throw Error('INVALID_CHECKOUT_BUNDLE');
  const read=(g:Snapshot)=>{const cells=validateSnapshot(g,date);if(cells.some(c=>c.state==='UNKNOWN'))throw Error('SELECTION_STATE_UNKNOWN');return cells;};
  if(read(grid).some(c=>c.state==='SELECTED'))throw Error('PREEXISTING_SELECTION');
  await port.guard();safety.check();await safety.stage('SELECTION');t?.mark('selectionAttemptStarted',1);
  let slot=0;
  for(const court of courts)for(const hour of chunk.hours){
    await (port.lightGuard?.()??Promise.resolve());safety.check();dispatched.add(`${date}/${court}/${hour}`);t?.mark(`slot${++slot}ClickStarted`);
    try{await port.click(date,court,hour,'OPEN');t?.mark(`slot${slot}StateConfirmed`);}catch{
      safety.check();const authoritative=read(await port.read()).filter(c=>c.state==='SELECTED');
      if(authoritative.some(c=>!dispatched.has(`${date}/${c.court}/${c.hour}`)))throw Error('UNOWNED_SELECTION');
      throw Error('SELECTION_CONFLICT');
    }
  }
  await port.guard();safety.check();t?.mark('selectionFinalVerificationStarted');
  const selected=read(await port.read()).filter(c=>c.state==='SELECTED');
  if(selected.some(c=>!dispatched.has(`${date}/${c.court}/${c.hour}`)))throw Error('UNOWNED_SELECTION');
  if(selected.length!==courts.length*chunk.duration)throw Error('SELECTION_CONFLICT');
  const summary=await port.summary();safety.check();
  t?.mark('selectionSummaryVerified');
  const amount=selectionAmount(summary,selected.length,maximum*courts.length,courts.length);
  if(!summary.actionable)throw Error('SELECTION_CONFLICT');
  safety.lock();await safety.stage('SELECTION_VERIFIED');t?.mark('selectionFinalVerificationCompleted');t?.mark('selectionVerified');t?.mark('proceedActionable');
  return {date,court:courts[0]!,hours:chunk.hours,groups:courts.map(court=>({court,hours:[...chunk.hours]})),amount,totalAmount:amount,proceedReady:true,attempts:1};
}
