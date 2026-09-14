import { expandHours } from './config.js';
import { validateSnapshot, type Snapshot } from './grid.js';
import { selectionAmount, type SelectionPort, type SelectionResult } from './selection.js';
import type { Safety } from './safety.js';
import type { BookingChunk } from './booking-plan.js';

export interface CheckoutSelection extends SelectionResult { groups:{court:number;hours:string[];amount?:number}[]; totalAmount:number }
export async function selectCheckoutBundle(port:SelectionPort,date:string,grid:Snapshot,chunk:BookingChunk,maximum:number,safety:Safety,dispatched:Set<string>):Promise<CheckoutSelection>{
  const courts=chunk.courts;
  if(!courts||courts.length!==chunk.requiredCourtCount||new Set(courts).size!==courts.length||courts.some(c=>!Number.isInteger(c)||c<1||c>7)||chunk.duration>3||JSON.stringify(expandHours(chunk.start,chunk.duration))!==JSON.stringify(chunk.hours))throw Error('INVALID_CHECKOUT_BUNDLE');
  const read=(g:Snapshot)=>{const cells=validateSnapshot(g,date);if(cells.some(c=>c.state==='UNKNOWN'))throw Error('SELECTION_STATE_UNKNOWN');return cells;};
  if(read(grid).some(c=>c.state==='SELECTED'))throw Error('PREEXISTING_SELECTION');
  await safety.stage('SELECTION');
  for(const court of courts)for(const hour of chunk.hours){
    await port.guard();safety.check();dispatched.add(`${date}/${court}/${hour}`);
    try{await port.click(date,court,hour,'OPEN');}catch{ safety.check();throw Error('SELECTION_CONFLICT'); }
    const selected=read(await port.read()).filter(c=>c.state==='SELECTED');
    if(selected.some(c=>!dispatched.has(`${date}/${c.court}/${c.hour}`)))throw Error('UNOWNED_SELECTION');
    if(!selected.some(c=>c.court===court&&c.hour===hour))throw Error('SELECTION_CONFLICT');
  }
  await port.guard();safety.check();
  const selected=read(await port.read()).filter(c=>c.state==='SELECTED');
  if(selected.some(c=>!dispatched.has(`${date}/${c.court}/${c.hour}`)))throw Error('UNOWNED_SELECTION');
  if(selected.length!==courts.length*chunk.duration)throw Error('SELECTION_CONFLICT');
  const summary=await port.summary();safety.check();
  const amount=selectionAmount(summary,selected.length,maximum*courts.length,courts.length);
  if(!summary.actionable)throw Error('SELECTION_CONFLICT');
  safety.lock();await safety.stage('SELECTION_VERIFIED');
  return {date,court:courts[0]!,hours:chunk.hours,groups:courts.map(court=>({court,hours:[...chunk.hours]})),amount,totalAmount:amount,proceedReady:true,attempts:1};
}
