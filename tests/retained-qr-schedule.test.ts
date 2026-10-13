import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { readFile } from 'node:fs/promises';
import { prepareSchedule } from '../src/booking-prepare.js';
import { Safety } from '../src/safety.js';

let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});});
afterAll(async()=>{await browser.close();});
it('prepares a clean schedule beside the explicitly retained QR, without allowing unknown or extra tabs',async()=>{
  const context=await browser.newContext();
  try{
    const html=(await readFile('fixtures/schedule.html','utf8')).replace('</html>',`<span data-testid="booking-court-filter-label">All Courts</span><button aria-label="Select booking date" aria-expanded="false" onclick="this.setAttribute('aria-expanded',this.getAttribute('aria-expanded')==='true'?'false':'true')">Date</button><button data-day="9/11/2026" onclick="render('2026-09-11');document.querySelector('h3').textContent='Fri, September 11'">11</button></html>`);
    await context.route('**/*',route=>route.fulfill({body:route.request().url().includes('/checkout/')?'<h1>Checkout</h1><div><p>Slot reserved for</p><p id="timer">09:59</p></div>':html,contentType:'text/html'}));
    const qr=await context.newPage();await qr.goto('https://app.onda.fit/checkout/synthetic');
    const page=await context.newPage();await page.bringToFront();
    await expect(prepareSchedule(page,new Safety(),'2026-09-11')).rejects.toThrow('ONDA_TAB_AMBIGUOUS_OR_MISSING');
    await expect(prepareSchedule(page,new Safety(),'2026-09-11',[qr])).resolves.toBeDefined();
    expect(qr.url()).toBe('https://app.onda.fit/checkout/synthetic');
    expect(await qr.locator('#timer').textContent()).toBe('09:59');
    await qr.locator('#timer').evaluate(el=>{el.textContent='unknown';});
    await expect(prepareSchedule(page,new Safety(),'2026-09-11',[qr])).rejects.toThrow('PAYMENT_HOLD_MAY_BE_ACTIVE');
    await qr.locator('#timer').evaluate(el=>{el.textContent='09:59';});
    const extra=await context.newPage();await extra.goto('https://app.onda.fit/checkout/unlisted');await page.bringToFront();
    await expect(prepareSchedule(page,new Safety(),'2026-09-11',[qr])).rejects.toThrow('ONDA_TAB_AMBIGUOUS_OR_MISSING');
    await expect(prepareSchedule(page,new Safety(),'2026-09-11',[qr,extra])).rejects.toThrow('ONDA_TAB_AMBIGUOUS_OR_MISSING');
  }finally{await context.close();}
});
