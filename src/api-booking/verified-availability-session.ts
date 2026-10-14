import { chromium } from 'playwright';
import { browserIdentity, verifyDedicatedChromeAsync } from '../browser.js';
import { ONDA_URL, VENUE } from '../config.js';
import { OndaBrowserAvailabilityProvider } from './browser-availability-provider.js';
import type { Wing } from '../court-registry.js';
/** Read-only attachment. Never navigates, opens tabs, acquires security or borrows a profile. */
export async function verifiedAvailabilitySession() {
  const identity=browserIdentity('A');await verifyDedicatedChromeAsync(identity);
  const browser=await chromium.connectOverCDP(identity.cdpUrl,{timeout:10_000});
  try {
    const pages=browser.contexts().flatMap(context=>context.pages()).filter(page=>page.url()===ONDA_URL);
    if(pages.length!==1)throw Error('AVAILABILITY_BROWSER_PREPARATION_REQUIRED');
    const page=pages[0]!;
    if((await page.getByTestId('public-booking-hero-title').first().innerText({timeout:5000})).trim()!==VENUE)throw Error('WRONG_VENUE');
    return {page,provider:(wing:Wing='MANGO')=>new OndaBrowserAvailabilityProvider(page,{wing,allowIncompleteRange:true}),close:()=>browser.close()};
  }catch(error){await browser.close();throw error;}
}
