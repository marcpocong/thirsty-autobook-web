import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFile } from 'node:fs/promises';
import { snapshot, validateSnapshot, waitForGrid, resolvePreference } from '../src/grid.js';
import { Safety } from '../src/safety.js';
import { monitorConnection } from '../src/browser.js';
import { installSelectionSecuritySentinelSource,readSelectionSecuritySentinel,selectionPort,selectResolvedPreference } from '../src/selection.js';
import { Telemetry } from '../src/telemetry.js';
let browser: Browser;
let page: Page;
beforeAll(async()=>{
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>route.abort());
  page=await context.newPage();
});
beforeEach(async()=>{await page.setContent(await readFile('fixtures/schedule.html','utf8'));});
afterAll(async()=>{await browser?.close();}); // Only the test-owned synthetic browser.
it('parses all seven courts in one snapshot, excluding legend state',async()=>{
  const s=await snapshot(page);const cells=validateSnapshot(s,'2026-09-10');
  expect(cells.length).toBe(112);expect(cells.filter(c=>c.state==='SELECTED')).toHaveLength(0);
  expect(resolvePreference(cells,[{court:3,hours:['10:00','11:00']},{court:1,hours:['10:00','11:00']}])?.court).toBe(1);
});
it('rejects stale rows after heading changes and waits for target row sentinel',async()=>{
  await page.getByRole('button',{name:'Next day',exact:true}).click();
  const stale=await snapshot(page);expect(stale.heading).toBe('Fri, September 11');
  expect(()=>validateSnapshot(stale,'2026-09-11')).toThrow('STALE');
  const ready=waitForGrid(page,'2026-09-11',new Safety());
  await page.evaluate(()=>{(window as unknown as {render:(date:string)=>void}).render('2026-09-11');});
  await ready;
  expect(validateSnapshot(await snapshot(page),'2026-09-11')).toHaveLength(112);
});
it('rejects partial and mixed-date grids',async()=>{
  const s=await snapshot(page);s.rows[0]!.date='2026-09-09';expect(()=>validateSnapshot(s,'2026-09-10')).toThrow();
  const s2=await snapshot(page);s2.cells.pop();expect(()=>validateSnapshot(s2,'2026-09-10')).toThrow('GRID_STRUCTURE');
});
it('selects and deselects consecutive same-court slots using observed semantics',async()=>{
  const a=page.getByRole('button',{name:'Court 1: Mango Wing 10 AM to 11 AM available',exact:true});
  const b=page.getByRole('button',{name:'Court 1: Mango Wing 11 AM to 12 PM available',exact:true});
  await a.click();await b.click();
  const selected=validateSnapshot(await snapshot(page),'2026-09-10').filter(c=>c.state==='SELECTED');
  expect(selected.map(c=>[c.court,c.hour])).toEqual([[1,'10:00'],[1,'11:00']]);
  for(const c of selected)await page.getByRole('button',{name:c.label,exact:true}).click();
  expect(validateSnapshot(await snapshot(page),'2026-09-10').filter(c=>c.state==='SELECTED')).toHaveLength(0);
});
it('fails closed on an actual test-owned page close',async()=>{
  const disposable=await browser.newPage();const safety=new Safety();
  monitorConnection(browser,disposable,safety);
  await disposable.close();expect(()=>safety.check()).toThrow('CHROME_DISCONNECTED');
});
it('installs the selection security sentinel across the Playwright boundary without Node transform helpers',async()=>{
  expect(installSelectionSecuritySentinelSource).not.toContain('__name');
  await page.evaluate(installSelectionSecuritySentinelSource);
  expect(await page.evaluate(readSelectionSecuritySentinel)).toMatchObject({installed:true,visible:true,grid:1});
  await page.evaluate(()=>{const w=window as typeof window&{__thirstyGuard?:{observer:MutationObserver}};w.__thirstyGuard?.observer.disconnect();delete w.__thirstyGuard;});
});
it('production DOM port selects consecutive cells, verifies summary and never clicks Proceed',async()=>{
  await page.evaluate(()=>{
    const sheet=document.createElement('div');sheet.dataset.testid='booking-selection-summary-sheet';sheet.innerHTML='<span data-testid="booking-selection-summary-count">1 Court • 2 Slots</span><span data-testid="booking-selection-summary-amount">₱1,200</span><button data-testid="booking-selection-summary-proceed-button">Proceed</button>';document.body.append(sheet);
    sheet.querySelector('button')!.onclick=()=>{throw Error('PROCEED_MUST_NOT_BE_CLICKED');};
  });
  const safety=new Safety(),port=selectionPort(page,safety);port.guard=async()=>safety.check(); // Offline fixture has no live Onda URL.
  const result=await selectResolvedPreference(port,'2026-09-10',await snapshot(page),[{court:1,hours:['10:00','11:00']}],1200,3,safety,new Telemetry());expect(result.court).toBe(1);expect(safety.locked).toBe(true);expect(validateSnapshot(await snapshot(page),'2026-09-10').filter(c=>c.state==='SELECTED')).toHaveLength(2);
});
