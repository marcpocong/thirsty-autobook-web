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
// Text is scoped to the already established Payment Summary sheet. No new selector.
export function verifyRentalQuantity(lines:string[],expected:number){
  const rentals=lines.map(s=>s.trim()).filter(s=>/^Court rental\b/i.test(s));
  if(rentals.length!==1)throw Error('PAYMENT_RENTAL_STRUCTURE_CHANGED');
  const match=/^Court rental \((\d+) \u00d7 (\u20b1(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})\)$/.exec(rentals[0]!);
  if(!match||!Number.isFinite(paymentAmount(match[2]!))||paymentAmount(match[2]!)<=0)throw Error('PAYMENT_RENTAL_STRUCTURE_CHANGED');
  if(Number(match[1])!==expected)throw Error('PAYMENT_QUANTITY_MISMATCH');
}
export function ondaCheckoutAdapter(page:Page,safety:Safety,selected:BookingSummary,t?:Telemetry,paymentSummaryTimeoutMs=60000):CheckoutAdapter {
  const guard=async()=>{
    safety.check();if(page.url()!==ONDA_URL)throw new Error('WRONG_URL');
    const reason=securityReason(await page.locator('body').innerText());
    if(reason)safety.stop(reason);safety.check();
  };
  const readReview=async()=>{
    await guard();await page.getByRole('heading',{name:'Review Booking',exact:true}).waitFor();safety.check();
    const evidence=await page.evaluate(()=>{
      const venues=document.querySelectorAll('h2');
      const dates=[...document.querySelectorAll('[data-testid="booking-review-reservation-date"]')];
      if(venues.length!==1||dates.length<1||dates.length>2)throw new Error('REVIEW_STRUCTURE_CHANGED');
      const venue=venues[0]!;
      const fullDates=[...(venue.parentElement?.querySelectorAll('span')??[])].map(e=>e.textContent?.trim()??'').filter(s=>/^[A-Za-z]+, [A-Za-z]+ \d+, \d{4}$/.test(s));
      const counts=[...document.querySelectorAll('h3')].filter(e=>e.textContent?.startsWith('Your Reservations'));
      if(fullDates.length!==1||counts.length!==1)throw new Error('REVIEW_STRUCTURE_CHANGED');
      const cards=dates.map(date=>{
        const spans=[...date.parentElement!.querySelectorAll('span')].map(e=>e.textContent?.trim()??'');
        const courts=spans.filter(s=>s.startsWith('Court '));
        if(courts.length!==1)throw new Error('REVIEW_STRUCTURE_CHANGED');
        return {venue:venue.textContent?.trim()??'',fullDate:fullDates[0]!,shortDate:date.textContent?.trim()??'',court:courts[0]!,times:spans.filter(s=>/\d.* (AM|PM) - /.test(s))};
      });
      return {count:counts[0]!.textContent?.trim()??'',cards};
    });safety.check();t?.mark('reviewParsed');return reviewBundleSummary(evidence,selected.amount);

  };
  const name=page.getByRole('textbox',{name:'Full Name',exact:true});
  const phone=page.getByRole('textbox',{name:'Phone Number',exact:true});
  const email=page.getByRole('textbox',{name:'Email Address',exact:true});
  const sheet=page.getByTestId('booking-review-payment-summary-sheet');
  // Scope Terms to the verified Payment Summary panel. This prevents a
  // hidden or duplicated page-level checkbox from satisfying the gate.
  const termsPanel=page.locator('[data-testid="booking-review-terms-panel"]:visible');
  const nativeTerms=termsPanel.locator('input[type="checkbox"]:visible');
  const roleTerms=termsPanel.locator('[role="checkbox"]:visible');
  async function termsControl(){
    // Onda can paint the Payment Summary heading before hydrating its Terms
    // control. Wait for the control itself instead of treating that short
    // render gap as a changed DOM structure.
    try{await page.waitForFunction(()=>{
      const panels=[...document.querySelectorAll<HTMLElement>('[data-testid="booking-review-terms-panel"]')].filter(e=>e.checkVisibility());
      if(panels.length!==1)return false;const controls=[...panels[0]!.querySelectorAll<HTMLElement>('input[type="checkbox"],[role="checkbox"]')].filter(e=>e.checkVisibility());return controls.length===1;
    },undefined,{timeout:6000,polling:'raf'});}catch{throw new Error('TERMS_STRUCTURE_CHANGED');}
    safety.check();t?.mark('termsControlDetected');
    if(await termsPanel.count()!==1)throw Error('TERMS_STRUCTURE_CHANGED');
    const nativeCount=await nativeTerms.count();if(nativeCount===1)return {locator:nativeTerms,native:true as const};
    if(await roleTerms.count()===1)return {locator:roleTerms,native:false as const};
    throw Error('TERMS_STRUCTURE_CHANGED');
  }
  async function termsChecked(control:Awaited<ReturnType<typeof termsControl>>){
    return control.native ? control.locator.isChecked() : (await control.locator.getAttribute('aria-checked')) === 'true';
  }
  async function ensureTermsChecked(){
    const termsCommitted=async(control:Awaited<ReturnType<typeof termsControl>>)=>{
      if(!await termsChecked(control))return false;
      // Onda enables this button from its own controlled Terms state. A DOM
      // checked property alone can briefly be ahead of that state.
      return await finalButton.count()===0||await finalButton.isEnabled();
    };
    for(let attempt=0;attempt<8;attempt++){
      const control=await termsControl();
      if(await termsCommitted(control))return;
      if(control.native){
        if(await control.locator.isDisabled())throw new Error('TERMS_NOT_ACTIONABLE');
        // Use a plain click so a React change-event rerender cannot make
        // Playwright's post-check assertion race the replacement node.
        try { await control.locator.click({noWaitAfter:true}); }
        catch {
          // The click may have dispatched successfully before Onda detached
          // the input. Reacquire the replacement and let the verification
          // below decide whether another click is necessary.
          try {
            const replacement=await termsControl();
            if(await termsChecked(replacement))return;
          } catch { /* retry the bounded loop */ }
          const label=control.locator.locator('xpath=ancestor::label[1]');
          if(await label.count()===1)await label.click();
        }
      }else{
        if(await control.locator.getAttribute('aria-disabled')==='true'||!await control.locator.isVisible())throw new Error('TERMS_NOT_ACTIONABLE');
        await control.locator.click();
      }
      safety.check();
      // The change event can replace the panel immediately after the check.
      // Reacquire the settled visible control before verifying its state.
      const verified=await termsControl();
      if(await termsCommitted(verified))return;
      try{await page.waitForFunction(()=>{
        const panels=[...document.querySelectorAll<HTMLElement>('[data-testid="booking-review-terms-panel"]')].filter(e=>e.checkVisibility());if(panels.length!==1)return false;
        const controls=[...panels[0]!.querySelectorAll<HTMLInputElement>('[type="checkbox"],[role="checkbox"]')].filter(e=>e.checkVisibility());if(controls.length!==1)return false;
        const checked=controls[0]!.matches('input')?(controls[0] as HTMLInputElement).checked:controls[0]!.getAttribute('aria-checked')==='true';
        const buttons=[...document.querySelectorAll<HTMLButtonElement>('button')].filter(b=>b.textContent?.trim()==='Confirm & Proceed to Payment');return checked&&(!buttons.length||buttons.length===1&&!buttons[0]!.disabled&&buttons[0]!.getAttribute('aria-disabled')!=='true');
      },undefined,{timeout:1500,polling:'raf'});return;}catch{/* bounded reacquire */}
    }
    throw new Error('TERMS_NOT_CHECKED');
  }
  const finalButton=sheet.getByRole('button',{name:'Continue to Payment',exact:true});
  let verifiedReview:BookingSummary|undefined,verifiedPayment:BookingSummary|undefined;
  const readPayment=async()=>{
    await guard();await sheet.getByRole('heading',{name:'Payment Summary',exact:true}).waitFor({timeout:paymentSummaryTimeoutMs});safety.check();
    // Revalidate the booking identity as Payment Summary appears, before Terms.
    const review=await readReview();
    verifyRentalQuantity(await sheet.locator('span').allTextContents(),(selected.courts?.length??1)*selected.duration);
    const total=await sheet.getByText('Total',{exact:true}).evaluate(e=>{
      const spans=e.parentElement?.querySelectorAll(':scope > span');if(spans?.length!==2)throw new Error('PAYMENT_STRUCTURE_CHANGED');return spans[1]!.textContent?.trim()??'';
    });safety.check();t?.mark('paymentSummaryParsed');return verifiedPayment={...review,amount:paymentAmount(total)};
  };
  return {
    review:async()=>verifiedReview=await readReview(),
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
    paymentSummary:readPayment,
    async acceptTerms(){
      await guard();
      await ensureTermsChecked();
      return true;
    },
    async prepareFinalAction(){
      if(!verifiedPayment)throw Error('PAYMENT_SUMMARY_FAILED');
      // Re-read the still-visible booking identity immediately before the
      // one-way action. Payment entry reused the first verified Review, so
      // this is the second (not third) full review parse on the happy path.
      const finalReview=await readReview();
      for(const key of ['courts','venue','date','start','end','duration'] as const)if(JSON.stringify(finalReview[key])!==JSON.stringify(verifiedReview?.[key]))throw Error('PAYMENT_MISMATCH');
      await guard();await sheet.getByRole('heading',{name:'Payment Summary',exact:true}).waitFor({timeout:paymentSummaryTimeoutMs});
      verifyRentalQuantity(await sheet.locator('span').allTextContents(),(selected.courts?.length??1)*selected.duration);
      const total=await sheet.getByText('Total',{exact:true}).evaluate(e=>{const spans=e.parentElement?.querySelectorAll(':scope > span');if(spans?.length!==2)throw Error('PAYMENT_STRUCTURE_CHANGED');return spans[1]!.textContent?.trim()??'';});
      const payment={...verifiedPayment,amount:paymentAmount(total)};safety.check();
      if(!safety.locked)throw new Error('TERMS_NOT_CHECKED');
      // Onda may re-render Payment Summary after the first check. Re-assert
      // the checkbox immediately before the one-way final handoff.
      await ensureTermsChecked();
      if(await finalButton.count()!==1)throw Error('FINAL_BUTTON_UNVERIFIED');
      if((await finalButton.innerText()).trim()!=='Confirm & Proceed to Payment')throw new Error('FINAL_BUTTON_UNVERIFIED');
      if(!await finalButton.isVisible()||!await finalButton.isEnabled())throw new Error('FINAL_BUTTON_NOT_ACTIONABLE');
      t?.mark('finalButtonActionable');await guard();return payment;
    },
    async finalOndaAction(){
      // Only Safety.finalAction can open this one-way dispatch. No post-click DOM reads.
      if(!safety.boundary||!safety.locked||safety.signal.aborted)throw new Error('PAYMENT_GATE_CLOSED');
      safety.consumeFinalDispatch();
      await finalButton.click({noWaitAfter:true});
    },
  };
}

export function reviewBundleSummary(e:{count:string;cards:Omit<ReviewEvidence,'count'>[]},amount:number):BookingSummary {
  const total=e.cards.reduce((n,c)=>n+c.times.length,0);
  if(e.count!==`Your Reservations (${total})`||e.cards.length<1||e.cards.length>2)throw Error('REVIEW_STRUCTURE_CHANGED');
  const summaries=e.cards.map(c=>reviewSummary({...c,count:`Your Reservations (${c.times.length})`},amount));
  const first=summaries[0]!;
  if(new Set(summaries.map(s=>s.court)).size!==summaries.length||summaries.some(s=>s.date!==first.date||s.start!==first.start||s.end!==first.end||s.duration>3))throw Error('REVIEW_STRUCTURE_CHANGED');
  return {...first,courts:summaries.map(s=>s.court)};
}
