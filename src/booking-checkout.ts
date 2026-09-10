import type { Page } from 'playwright';
import { VENUE } from './config.js';
import { snapshot, validateSnapshot } from './grid.js';
import { selectionPort, selectionAmount, type SelectionResult } from './selection.js';
import { checkout, type Player } from './checkout.js';
import { ondaCheckoutAdapter } from './onda-checkout.js';
import { Safety } from './safety.js';
import { Telemetry } from './telemetry.js';

export async function proceedWithVerifiedSelection(page:Page, selected:SelectionResult, player:Player, maximum:number, authorizeTerms:boolean, safety:Safety,t:Telemetry){
  safety.check();if(!safety.locked)throw new Error('BOOKING_LOCK_REQUIRED');
  const port=selectionPort(page,safety);await port.guard();safety.check();
  const cells=validateSnapshot(await snapshot(page),selected.date);safety.check();
  const current=cells.filter(c=>c.state==='SELECTED');
  if(cells.some(c=>c.state==='UNKNOWN')||current.length!==selected.hours.length||current.some(c=>c.court!==selected.court||!selected.hours.includes(c.hour)))throw new Error('SELECTION_CHANGED_BEFORE_PROCEED');
  const summary=await port.summary();safety.check();
  if(!summary.actionable||selectionAmount(summary,selected.hours.length,maximum)!==selected.amount)throw new Error('SELECTION_CHANGED_BEFORE_PROCEED');
  const expected={venue:VENUE,date:selected.date,court:selected.court,start:selected.hours[0]!,end:`${String(Number(selected.hours.at(-1)!.slice(0,2))+1).padStart(2,'0')}:00`,duration:selected.hours.length,amount:selected.amount,currency:'PHP'};
  safety.check();await page.getByTestId('booking-selection-summary-proceed-button').click();safety.check();t.mark('proceedClicked');
  return checkout(ondaCheckoutAdapter(page,safety,expected,t),safety,t,expected,player,maximum,authorizeTerms);
}
