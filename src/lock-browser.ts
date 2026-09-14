import { chromium, type Page } from 'playwright';
import { verifyDedicatedChrome, browserA, type BrowserIdentity } from './browser.js';
import { ONDA_URL, VENUE } from './config.js';
import { snapshot, validateSnapshot } from './grid.js';
export type HoldState='Active'|'Expired'|'Not detected'|'Unknown';
export interface BrowserReview { page:'Schedule'|'Review Booking'|'Payment Summary'|'QR Checkout'|'Unknown'; selected:number|null; hold:HoldState; countdownSeconds?:number|null; clean:boolean }
export const unknownBrowser:BrowserReview={page:'Unknown',selected:null,hold:'Unknown',countdownSeconds:null,clean:false};
async function holdComponent(page:Page){
  return page.evaluate(()=>{
    // Keep this callback self-contained. Named local helpers are decorated by
    // tsx/esbuild with __name, which does not exist in Playwright's page realm.
    const labels=[...document.querySelectorAll('p')].filter(p=>p.getClientRects().length>0&&getComputedStyle(p).visibility!=='hidden'&&p.textContent?.trim()==='Slot reserved for');
    if(labels.length===0)return {present:false,countdown:null as string|null,ambiguous:false};
    if(labels.length!==1)return {present:true,countdown:null as string|null,ambiguous:true};
    const values=[...new Set([...(labels[0]!.parentElement?.querySelectorAll('p')??[])].filter(p=>p.getClientRects().length>0&&getComputedStyle(p).visibility!=='hidden').map(p=>p.textContent?.trim()??'').filter(s=>/^\d{1,2}:[0-5]\d$/.test(s)))];
    return {present:true,countdown:values.length===1?values[0]!:null,ambiguous:values.length!==1};
  });
}
export async function inspectLockPage(page:Page):Promise<BrowserReview>{
  const markers=await page.evaluate(()=>({
    checkout:[...document.querySelectorAll('h1')].some(e=>e.textContent?.trim()==='Checkout'&&e.getClientRects().length>0),
    review:[...document.querySelectorAll('h1')].some(e=>e.textContent?.trim()==='Review Booking'&&e.getClientRects().length>0),
    summary:!!document.querySelector('[data-testid="booking-review-payment-summary-sheet"]')?.getClientRects().length,
  }));
  const component=await holdComponent(page);
  if(markers.checkout||component.present){
    if(component.ambiguous||!component.countdown)return {...unknownBrowser,page:markers.checkout?'QR Checkout':'Unknown'};
    const [m,s]=component.countdown.split(':').map(Number),seconds=m!*60+s!;
    if(seconds>0)return {...unknownBrowser,page:markers.checkout?'QR Checkout':'Unknown',hold:'Active',countdownSeconds:seconds};
    await page.waitForTimeout(150);
    const stable=await holdComponent(page);
    if(stable.present&&!stable.ambiguous&&stable.countdown&&/^0{1,2}:00$/.test(stable.countdown))return {...unknownBrowser,page:markers.checkout?'QR Checkout':'Unknown',hold:'Expired',countdownSeconds:0};
    return {...unknownBrowser,page:markers.checkout?'QR Checkout':'Unknown'};
  }
  if(markers.summary)return {...unknownBrowser,page:'Payment Summary',hold:'Not detected'};
  if(markers.review)return {...unknownBrowser,page:'Review Booking',hold:'Not detected'};
  if(page.url()!==ONDA_URL)return unknownBrowser;
  if((await page.getByTestId('public-booking-hero-title').textContent())?.trim()!==VENUE)return unknownBrowser;
  if((await page.getByTestId('booking-court-filter-label').textContent())?.trim()!=='All Courts')return unknownBrowser;
  const grid=await snapshot(page),cells=validateSnapshot(grid,grid.rows[0]?.date??'');
  if(cells.some(c=>c.state==='UNKNOWN'))return unknownBrowser;
  const selected=cells.filter(c=>c.state==='SELECTED').length;
  return {page:'Schedule',selected,hold:'Not detected',countdownSeconds:null,clean:selected===0};
}
export async function probeLockBrowser(identity:BrowserIdentity=browserA):Promise<BrowserReview>{
  verifyDedicatedChrome(identity);
  const browser=await chromium.connectOverCDP(identity.cdpUrl,{timeout:5000});
  // The short-lived reader exits without closing the user's browser, context or tabs.
  const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>{try{return new URL(p.url()).origin===new URL(ONDA_URL).origin;}catch{return false;}});
  if(pages.length!==1)return unknownBrowser;
  pages[0]!.setDefaultTimeout(2000);
  return inspectLockPage(pages[0]!);
}
