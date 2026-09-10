import type { Page } from 'playwright';
import { DateTime } from 'luxon';
import { ONDA_URL, VENUE } from './config.js';
import { Safety, securityReason } from './safety.js';
import { type BookingSummary, type CheckoutAdapter, type Player } from './checkout.js';
import type { Telemetry } from './telemetry.js';

// Live evidence: a separate +63 prefix and a formatted national-number input.
export function nationalPhone(value: string): string {
  const digits=value.replace(/[ ()-]/g,'');
  const national=/^09\d{9}$/.test(digits)?digits.slice(1):/^\+?639\d{9}$/.test(digits)?digits.replace(/^\+?63/,''):digits;
  if(!/^9\d{9}$/.test(national))throw new Error('UNSUPPORTED_PHONE_FORMAT');
  return national;
}
export interface ReviewEvidence { venue:string; fullDate:string; shortDate:string; count:string; court:string; times:string[] }
export function reviewSummary(e:ReviewEvidence, selectionAmount:number):BookingSummary {
  const date=DateTime.fromFormat(e.fullDate,'cccc, LLLL d, yyyy',{locale:'en',zone:'Asia/Manila'});
  const court=/^Court ([1-7]): Mango Wing$/.exec(e.court);
  const count=/^Your Reservations \((\d+)\)$/.exec(e.count);
  if(!date.isValid||!court||!count||Number(count[1])!==e.times.length||e.shortDate!==date.toFormat('ccc, LLL d')||e.venue!==VENUE||!e.times.length)throw new Error('REVIEW_STRUCTURE_CHANGED');
  const hours=e.times.map(time=>{
    const match=/^(\d{1,2}):00 (AM|PM) - (\d{1,2}):00 (AM|PM)$/.exec(time);
    if(!match||Number(match[1])<1||Number(match[1])>12||Number(match[3])<1||Number(match[3])>12)throw new Error('REVIEW_TIME_UNKNOWN');
    const start=Number(match[1])%12+(match[2]==='PM'?12:0),end=Number(match[3])%12+(match[4]==='PM'?12:0);
    if(start<8||(start+1)%24!==end)throw new Error('REVIEW_TIME_UNKNOWN');return start;
  });
  if(hours.some((h,i)=>h!==hours[0]!+i))throw new Error('REVIEW_HOURS_MISMATCH');
  const hour=(h:number)=>`${String(h).padStart(2,'0')}:00`;
  // Review has no displayed price; retain the verified grid-summary price until Payment Summary.
  return {venue:e.venue,date:date.toISODate()!,court:Number(court[1]),start:hour(hours[0]!),end:hour(hours[0]!+hours.length),duration:hours.length,amount:selectionAmount,currency:'PHP'};
}
export function paymentAmount(text:string) {
  if(!/^₱(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}$/.test(text))throw new Error('PAYMENT_AMOUNT_UNKNOWN');
  return Number(text.slice(1).replaceAll(',',''));
}
export function ondaCheckoutAdapter(page:Page,safety:Safety,selected:BookingSummary,t?:Telemetry):CheckoutAdapter {
  const guard=async()=>{
    safety.check();if(page.url()!==ONDA_URL)throw new Error('WRONG_URL');
    const reason=securityReason(await page.locator('body').innerText());
    if(reason)safety.stop(reason);safety.check();
  };
  const readReview=async()=>{
    await guard();await page.getByRole('heading',{name:'Review Booking',exact:true}).waitFor();safety.check();
    const evidence=await page.evaluate(()=>{
      const venue=document.querySelector('h2');
      const dates=document.querySelectorAll('[data-testid="booking-review-reservation-date"]');
      if(dates.length!==1||document.querySelectorAll('h2').length!==1)throw new Error('REVIEW_STRUCTURE_CHANGED');
      const card=dates[0]!.parentElement!;
      const spans=[...card.querySelectorAll('span')].map(e=>e.textContent?.trim()??'');
      const courts=spans.filter(s=>s.startsWith('Court '));
      if(courts.length!==1)throw new Error('REVIEW_STRUCTURE_CHANGED');
      const fullDates=[...(venue?.parentElement?.querySelectorAll('span')??[])].map(e=>e.textContent?.trim()??'').filter(s=>/^[A-Za-z]+, [A-Za-z]+ \d+, \d{4}$/.test(s));
      if(fullDates.length!==1)throw new Error('REVIEW_STRUCTURE_CHANGED');
      return {venue:venue?.textContent?.trim()??'',fullDate:fullDates[0]!,shortDate:dates[0]!.textContent?.trim()??'',count:[...document.querySelectorAll('h3')].find(e=>e.textContent?.startsWith('Your Reservations'))?.textContent?.trim()??'',court:courts[0]!,times:spans.filter(s=>/\d.* (AM|PM) - /.test(s))};
    });safety.check();return reviewSummary(evidence,selected.amount);
  };
  const name=page.getByRole('textbox',{name:'Full Name',exact:true});
  const phone=page.getByRole('textbox',{name:'Phone Number',exact:true});
  const email=page.getByRole('textbox',{name:'Email Address',exact:true});
  const sheet=page.getByTestId('booking-review-payment-summary-sheet');
  return {
    review:readReview,
    async fillPlayer(player:Player){
      await guard();await page.getByRole('heading',{name:'Player Information',exact:true}).waitFor();safety.check();
      t?.mark('playerFormDetected');
      if(await phone.getAttribute('type')!=='tel'||await phone.locator('..').getByText('+63',{exact:true}).count()!==1)throw new Error('PHONE_PREFIX_UNVERIFIED');
      const normalized=nationalPhone(player.phone);
      safety.check();await name.fill(player.fullName);safety.check();await phone.fill(normalized);safety.check();await email.fill(player.email);safety.check();
      const actual={fullName:await name.inputValue(),phone:await phone.inputValue(),email:await email.inputValue()};safety.check();
      if(actual.phone.replace(/\D/g,'')!==normalized)throw new Error('PLAYER_VALUES_MISMATCH');
      return {...actual,phone:player.phone};
    },
    async playerProceed(){await guard();await page.getByRole('button',{name:'Proceed',exact:true}).click();safety.check();},
    async paymentSummary(){
      await guard();await sheet.getByRole('heading',{name:'Payment Summary',exact:true}).waitFor();safety.check();
      const review=await readReview();
      const total=await sheet.getByText('Total',{exact:true}).evaluate(e=>{
        const spans=e.parentElement?.querySelectorAll(':scope > span');if(spans?.length!==2)throw new Error('PAYMENT_STRUCTURE_CHANGED');return spans[1]!.textContent?.trim()??'';
      });safety.check();return {...review,amount:paymentAmount(total)};
    },
    async acceptTerms(){await guard();const terms=sheet.getByRole('checkbox',{name:'I agree to the Terms and Conditions, Privacy Policy, and Liability Waiver',exact:true});await terms.check();safety.check();return terms.isChecked();},
    async finalOndaAction(){
      // Only Safety.finalAction can open this one-way dispatch. No post-click DOM reads.
      if(!safety.boundary||!safety.locked||safety.signal.aborted)throw new Error('PAYMENT_GATE_CLOSED');
      await sheet.getByRole('button',{name:'Continue to Payment',exact:true}).click({noWaitAfter:true});
    },
  };
}
