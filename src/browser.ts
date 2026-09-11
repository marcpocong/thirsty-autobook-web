import { chromium, type Page, type Browser } from 'playwright';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ONDA_URL, VENUE } from './config.js';
import { Safety, securityReason } from './safety.js';
import { classifyRateLimit } from './rate-limit.js';
import type { Telemetry } from './telemetry.js';

export function verifyDedicatedChrome() {
  if (process.platform !== 'win32') throw new Error('WINDOWS_REQUIRED');
  // Read only process/listener metadata. Never print process command lines.
  const script = "$ErrorActionPreference='Stop'; $ls=@(Get-NetTCPConnection -LocalPort 9222 -State Listen); if(-not $ls.Count){throw 'NO_CDP'}; if($ls | Where-Object {$_.LocalAddress -notin @('127.0.0.1','::1')}){throw 'UNSAFE_BIND'}; $ids=@($ls.OwningProcess | Select-Object -Unique); if($ids.Count -ne 1){throw 'AMBIGUOUS_CDP'}; $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ids[0]); @{name=$p.Name;command=$p.CommandLine} | ConvertTo-Json -Compress";
  let result: { name: string; command: string };
  try { result = JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })); }
  catch { throw new Error('CDP_PROFILE_OR_BIND_UNVERIFIED'); }
  const expected = resolve('.local/onda-chrome-profile').toLowerCase();
  const actual = /--user-data-dir=(?:"([^"]+)"|([^\s]+))/.exec(result.command)?.slice(1).find(Boolean);
  if (result.name.toLowerCase() !== 'chrome.exe' || !actual || resolve(actual).toLowerCase() !== expected) throw new Error('WRONG_CHROME_PROFILE');
}
export async function attach(safety: Safety, telemetry?: Telemetry) {
  safety.check(); verifyDedicatedChrome();
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 10000 });
  const candidates = browser.contexts().flatMap(c => c.pages()).filter(p => p.url() === ONDA_URL);
  if (candidates.length !== 1) throw new Error('ONDA_TAB_AMBIGUOUS_OR_MISSING');
  const page = candidates[0]!;
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(15000);
  monitorConnection(browser, page, safety, telemetry);
  await assertPage(page, safety);
  return { browser, page };
}
export function monitorConnection(browser: Browser, page: Page, safety: Safety, telemetry?: Telemetry) {
  browser.on('disconnected', () => safety.stop('CHROME_DISCONNECTED'));
  page.on('close', () => safety.stop('CHROME_DISCONNECTED'));
  page.on('crash', () => safety.stop('CHROME_DISCONNECTED'));
  page.on('response', response => {
    const rateLimit = classifyRateLimit(response);
    if (rateLimit) {
      const { evidence, restricted } = rateLimit;
      telemetry?.rateLimit(evidence.sameOndaSite ? restricted ? 'ondaRateLimited' : 'ondaRetryAfterUnrestricted' : 'thirdPartyRateLimited', evidence);
      if (evidence.sameOndaSite && restricted) safety.stop('RATE_LIMITED', evidence);
    }
    if ([401, 403].includes(response.status()) && response.request().isNavigationRequest()) safety.stop('ACCESS_BLOCKED');
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame() && !safety.boundary && frame.url() !== ONDA_URL) safety.stop('UNEXPECTED_REDIRECT');
  });
}
export async function assertPage(page: Page, safety: Safety) {
  safety.check();
  if (page.url() !== ONDA_URL) throw new Error('WRONG_URL');
  const reason = securityReason(await page.locator('body').innerText());
  if (reason) { safety.stop(reason); safety.check(); }
  if ((await page.getByTestId('public-booking-hero-title').innerText()).trim() !== VENUE) throw new Error('WRONG_VENUE');
  if (await page.getByTestId('booking-selected-date-label').count() !== 1 || await page.getByTestId('booking-grid-body').count() !== 1) throw new Error('GRID_UNVERIFIED');
  safety.check();
}
