import { chromium, type Page } from 'playwright';
import { verifyDedicatedChrome } from './browser.js';
import { ONDA_URL, VENUE } from './config.js';
import { snapshot, validateSnapshot } from './grid.js';
export interface BrowserReview { page:'Schedule'|'Review Booking'|'Payment Summary'|'QR Checkout'|'Unknown'; selected:number|null; hold:'Active'|'Not detected'|'Unknown'; clean:boolean }
export const unknownBrowser:BrowserReview={page:'Unknown',selected:null,hold:'Unknown',clean:false};
export async function inspectLockPage(page:Page):Promise<BrowserReview>{
  const markers=await page.evaluate(()=>({
    checkout:[...document.querySelectorAll('h1')].some(e=>e.textContent?.trim()==='Checkout'&&e.getClientRects().length>0),
    review:[...document.querySelectorAll('h1')].some(e=>e.textContent?.trim()==='Review Booking'&&e.getClientRects().length>0),
    summary:!!document.querySelector('[data-testid="booking-review-payment-summary-sheet"]')?.getClientRects().length,
    hold:[...document.querySelectorAll('p')].some(e=>e.textContent?.trim()==='Slot reserved for'&&e.getClientRects().length>0),
    countdown:[...document.querySelectorAll('p,span')].some(e=>/^\d{1,2}:\d{2}$/.test(e.textContent?.trim()??'')&&e.getClientRects().length>0),
  }));
  if(markers.checkout||markers.hold||markers.countdown)return {...unknownBrowser,page:markers.checkout?'QR Checkout':'Unknown',hold:markers.hold?'Active':'Unknown'};
  if(markers.summary)return {...unknownBrowser,page:'Payment Summary'};
  if(markers.review)return {...unknownBrowser,page:'Review Booking'};
  if(page.url()!==ONDA_URL)return unknownBrowser;
  if((await page.getByTestId('public-booking-hero-title').textContent())?.trim()!==VENUE)return unknownBrowser;
  if((await page.getByTestId('booking-court-filter-label').textContent())?.trim()!=='All Courts')return unknownBrowser;
  const grid=await snapshot(page),cells=validateSnapshot(grid,grid.rows[0]?.date??'');
  if(cells.some(c=>c.state==='UNKNOWN'))return unknownBrowser;
  const selected=cells.filter(c=>c.state==='SELECTED').length;
  return {page:'Schedule',selected,hold:'Not detected',clean:selected===0};
}
export async function probeLockBrowser():Promise<BrowserReview>{
  verifyDedicatedChrome();
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222',{timeout:5000});
  // The short-lived reader exits without closing the user's browser, context or tabs.
  const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>{try{return new URL(p.url()).origin===new URL(ONDA_URL).origin;}catch{return false;}});
  if(pages.length!==1)return unknownBrowser;
  pages[0]!.setDefaultTimeout(2000);
  return inspectLockPage(pages[0]!);
}
