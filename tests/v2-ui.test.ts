import { it,expect } from 'vitest';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { openRenderer, showRendererView } from './renderer-harness.js';

for(const width of [1440,390])it(`shows a truthful possible hold and provider refusal at ${width}px`,async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    await mkdir('.local/v2-ui',{recursive:true});
    const page=await openRenderer(browser,{possibleHolds:[{key:'synthetic',date:'2026-10-24',courts:[7],startTime:'19:00',endTime:'22:00',amount:2100,
      holdExpiresAt:new Date(Date.now()+300_000).toISOString(),bookingIds:['synthetic-booking'],bookingNumbers:['SYNTHETIC-ONLY'],code:'CHECKOUT_SESSION_INVALID'}]},'setup',{width,height:1000});
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await expect.poll(()=>page.locator('#possible-hold-alert').isVisible()).toBe(true);
    expect(await page.locator('#possible-hold-alert').innerText()).toContain('possible unexpired checkout(s)');
    expect(await page.locator('#possible-hold-alert').innerText()).toContain('Original booking targets remain protected');
    const date=await page.locator('#availability-date').inputValue();
    await page.evaluate(date=>{const w=window as any;w.fixtureState.courtBrowser={type:'courtBrowser',date,capturedAt:new Date().toISOString(),cells:[],
      wings:[{wing:'MANGO',status:'ERROR',code:'AVAILABILITY_HTTP_FAILED',httpStatus:403,requestSent:true,cells:0},
        {wing:'BUKO',status:'ERROR',code:'AVAILABILITY_HTTP_FAILED',httpStatus:403,requestSent:false,cells:0}]};w.fixturePublish(w.fixtureState);},date);
    await expect.poll(()=>page.locator('#court-browser-grid').innerText()).toContain('HTTP 403');
    expect(await page.locator('#court-browser-grid').innerText()).toContain('NOT SENT');
    expect(await page.locator('#court-browser-status').innerText()).not.toContain('Verified');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({path:`.local/v2-ui/${width}-possible-hold.png`,fullPage:true});expect(errors).toEqual([]);
    await page.close();
  }finally{await browser.close();}
},30_000);

for(const width of [1440,390])it(`dismisses and restores old warnings while keeping active holds visible at ${width}px`,async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const old={key:'historical',date:'2026-09-21',courts:[6],startTime:'08:00',endTime:'11:00',amount:1800,
      holdExpiresAt:new Date(Date.now()-3*86400_000).toISOString(),bookingIds:['old-booking'],bookingNumbers:['OLD-ONLY'],code:'UNKNOWN',
      archivePath:'.local/api-booking/api-first-journals/old.json',dismissible:true,archived:false};
    const live={...old,key:'live',bookingIds:['live-booking'],bookingNumbers:['LIVE-ONLY'],
      holdExpiresAt:new Date(Date.now()+300_000).toISOString(),archivePath:undefined,dismissible:false};
    const page=await openRenderer(browser,{possibleHolds:[old,live]},'setup',{width,height:1000});
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const banner=page.locator('#possible-hold-alert');
    expect(await banner.innerText()).toContain('2 unresolved records retained');
    expect(await banner.innerText()).toContain('1 possible unexpired checkout(s)');
    const record={key:'historical',path:old.archivePath,targetDate:old.date,courtIds:old.courts,lastWriteAt:old.holdExpiresAt,eligible:true};
    const overview={counts:{unknown:2},activeUnknown:[record],archived:[],eligible:[old.archivePath],checkedAt:new Date().toISOString()};
    await page.evaluate(o=>{(window as any).fixtureJournals={overview:o,archive:{cancelled:true}};},overview);
    await showRendererView(page,'records');
    await page.locator('#records-panel details summary').first().click();
    await page.getByRole('button',{name:'Archive this notice'}).click();
    expect(await page.evaluate(()=>(window as any).fixtureState.possibleHolds[0].archived)).toBe(false);
    await page.evaluate(()=>{const w=window as any;w.fixtureJournals.archive={archived:[{}],refused:[]};});
    await page.locator('#records-panel details summary').first().click();
    await page.getByRole('button',{name:'Archive this notice'}).click();
    expect(await page.evaluate(()=>(window as any).fixtureState.possibleHolds[0].archived)).toBe(true);
    await showRendererView(page,'setup');
    expect(await banner.innerText()).toContain('1 unresolved records retained');
    expect(await banner.innerText()).toContain('1 possible unexpired checkout(s)');
    await page.evaluate(({o,old})=>{const w=window as any;w.fixtureJournals.overview={...o,activeUnknown:[],archived:[{key:old.key,path:old.archivePath,targetDate:old.date,courtIds:old.courts,archivedAt:new Date().toISOString(),sha256:'a'.repeat(64),note:''}]};}, {o:overview,old});
    await showRendererView(page,'records');await page.getByRole('button',{name:'Restore',exact:true}).click();
    await showRendererView(page,'setup');expect(await banner.innerText()).toContain('2 unresolved records retained');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(()=>(window as any).fixtureCalls)).toEqual(['journalArchive:archive','journalArchive:archive','journalArchive:restore']);
    expect(errors).toEqual([]);
    await page.close();
  }finally{await browser.close();}
},30_000);
