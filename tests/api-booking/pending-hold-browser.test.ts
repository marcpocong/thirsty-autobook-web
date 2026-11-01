import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pendingFixture,fixtureNow} from '../helpers/pending-hold-fixture.js';
import {recoverPendingHold} from '../../src/api-booking/pending-hold-recovery.js';
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});});
afterAll(async()=>{await browser.close();});
describe('real browser, fully intercepted existing-hold recovery',()=>{
  for(const variant of ['canvas','image','fresh tab','stale token','authenticated lookup','access denied','broken image','wrong order','substring amount','wrong identity','missing QR','extra row','duplicate row','aggregate'] as const)
    it(`verifies exact provider/order identity and usable QR: ${variant}`,async()=>{
      const root=await mkdtemp(join(tmpdir(),'hold-browser-')),f=await pendingFixture(root),context=await browser.newContext();let posts=0,foreign=0,gets=0,lookups=0;
      try{
        // The only destination is this in-memory fixture; every other URL is refused.
        await context.route('**/*',async route=>{
          const request=route.request(),u=new URL(request.url());if(u.origin!=='https://app.onda.fit'){foreign++;await route.abort();return;}
          if(request.method()!=='GET'){posts++;await route.fulfill({status:500,body:'Unexpected mutation'});return;}
          if(u.pathname.startsWith('/api/public/bookings/booking-no/')){gets++;
            const denied=variant==='access denied'||variant==='stale token'&&u.searchParams.get('checkoutToken')!=='FRESH-PROVIDER-CAPABILITY';
            await route.fulfill({status:denied?401:200,contentType:'application/json',body:JSON.stringify({success:!denied})});return;}
          if(u.pathname.startsWith('/api/public/bookings/')){gets++;lookups++;
            if(variant==='authenticated lookup'&&lookups===1){await route.fulfill({status:401,body:'Unauthorized'});return;}
            const raw=structuredClone(f.provider);if(variant==='wrong identity')raw.data.id='foreign';
            if(variant==='stale token')Object.assign(raw.data,{checkoutToken:'FRESH-PROVIDER-CAPABILITY'});
            await route.fulfill({contentType:'application/json',body:JSON.stringify(raw)});return;}
          if(u.pathname!=='/book/thirsty-pickle'){await route.abort();return;}
          if(!u.searchParams.has('bookingId')){await route.fulfill({contentType:'text/html',body:'Clean schedule'});return;}
          const summary=variant==='aggregate'?'November 3, 2026\n8:00 AM - 11:00 AM\nCourt 7: Mango Wing\nPending\nQRPH\n1,800.00':
            variant==='wrong order'?f.body.replace('1,800.00','600.00'):variant==='substring amount'?f.body.replace('1,800.00','11,800.00'):variant==='extra row'?f.body+'\n11:00 AM - 12:00 PM\nCourt 7: Mango Wing':
            variant==='duplicate row'?f.body+'\n10:00 AM - 11:00 AM\nCourt 7: Mango Wing':f.body;
          let qr='';
          if(variant==='image')qr='<img alt="Payment QR code" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7h0AAAAASUVORK5CYII=">';
          else if(variant==='broken image')qr='<img alt="Payment QR code" src="data:image/png;base64,broken">';
          else if(variant!=='missing QR')qr='<canvas width="100" height="100"></canvas>';
          await route.fulfill({contentType:'text/html',body:`${summary.split('\n').map(line=>`<div>${line}</div>`).join('')}${qr}<script>fetch('/api/bookings/public-checkout',{method:'POST'}).catch(()=>{});fetch('/api/public/bookings',{method:'POST'}).catch(()=>{});</script>`});
        });
        const page=await context.newPage();
        // Initial fixture page performs no mutations. Mutations in the restored page
        // exercise both guarded creation routes and must never reach the context handler.
        await page.route('https://app.onda.fit/book/thirsty-pickle',route=>route.fulfill({contentType:'text/html',body:'Clean schedule'}),{times:1});
        await page.goto('https://app.onda.fit/book/thirsty-pickle');
        const result=await recoverPendingHold(page,f.directory,{identity:f.identity,now:()=>fixtureNow,claimRoot:join(root,'claims')});
        expect(result.qr).toBe(['canvas','image','aggregate','fresh tab','stale token','authenticated lookup'].includes(variant)?'QR_READY':variant==='wrong identity'?'NOT_CHECKED':'FAILED');
        if(variant==='access denied')expect(result).toMatchObject({provider:'PROVIDER_HOLD_CONFIRMED',code:'PROVIDER_AUTHENTICATION_REQUIRED'});
        if(variant==='fresh tab'){
          const fresh=await context.newPage();await fresh.goto('https://app.onda.fit/book/thirsty-pickle');
          expect((await recoverPendingHold(fresh,f.directory,{identity:f.identity,now:()=>fixtureNow,claimRoot:join(root,'claims')})).qr).toBe('QR_READY');
        }
        expect(posts).toBe(0);expect(foreign).toBe(0);expect(gets).toBe(variant==='fresh tab'?4:variant==='wrong identity'?1:variant==='authenticated lookup'?3:2);expect(f.submissions()).toBe(1);expect(await readFile(f.journalPath,'utf8')).toBe(f.journalBefore);
      }finally{await context.close();await rm(root,{recursive:true,force:true});}
    },30_000);
});
