import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:19446');
try {
  const page = browser.contexts()[0]?.pages().find(page => page.url().includes('/Thirsty%20Bot%20API%20Test/dist/ui/renderer/index.html'));
  if (!page) throw Error('PACKAGED_UI_NOT_FOUND');
  await page.locator('#workflow-release').click();
  const browserOption = await page.locator('#booking-method option[value="browser"]').textContent();
  if (!browserOption?.includes('BROWSER')) throw Error('BROWSER_METHOD_UNAVAILABLE');
  await page.locator('#booking-method').selectOption('api-first');
  await page.locator('#prepare').click();
  await page.waitForFunction(() => document.querySelector('#headline')?.textContent?.includes('API BROWSER READY'),
    undefined, { timeout: 90_000 });
  console.log(JSON.stringify({ stage: 'PACKAGED_PREPARED', title: await page.title(),
    method: await page.locator('#booking-method').inputValue(),
    headline: await page.locator('#headline').innerText(),
    dryVisible: await page.locator('#api-dry-controls').isVisible() }));
  const date = process.argv[2] ?? '2026-09-20';
  await page.locator('#api-dry-date').fill(date);
  await page.locator('#api-preview').click();
  await page.waitForFunction(() => {
    const text = document.querySelector('#headline')?.textContent ?? '';
    return text.includes('API DRY RUN COMPLETE') || text.includes('Needs attention') || text.includes('API run needs attention');
  }, undefined, { timeout: 90_000 });
  console.log(JSON.stringify({ stage: 'PACKAGED_DRY_RESULT', headline: await page.locator('#headline').innerText(),
    detail: await page.locator('#detail').innerText(),
    apiMethodSelected: await page.locator('#booking-method').inputValue() === 'api-first' }));
} finally { await browser.close(); }
