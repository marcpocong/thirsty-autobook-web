/**
 * Offline Chrome for benchmarks. Nothing here can reach Onda:
 * - DNS is disabled (every host maps to NOTFOUND except 127.0.0.1) and all traffic goes to a closed local proxy port;
 * - every https://app.onda.fit request is fulfilled locally by page.route: checkout → synthetic HTTP 409, the booking
 *   page → a tiny local HTML page, anything else → 404;
 * - a self-check refuses to continue if a page can reach the real network.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Browser, Page } from 'playwright';

export const ONDA_BOOKING_URL = 'https://app.onda.fit/book/thirsty-pickle';
export const SYNTHETIC_409 = JSON.stringify({ success: false, error: 'Synthetic benchmark conflict (offline).' });

export function findChrome(explicit: string | undefined, fallback: string): string {
  const path = [explicit ?? '', join(process.env.ProgramFiles ?? '', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['ProgramFiles(x86)'] ?? '', 'Google/Chrome/Application/chrome.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'), process.env.BENCH_CHROME ?? '', fallback].find(value => value && existsSync(value));
  if (!path) throw Error('CHROME_NOT_FOUND');
  return path;
}

export async function closeOfflineChrome(session:OfflineChrome):Promise<void> {
  // connectOverCDP browser.close() only disconnects; close the browser we spawned.
  try { const cdp=await session.browser.newBrowserCDPSession();await cdp.send('Browser.close'); } catch {}
  await session.browser.close().catch(()=>{});
  if(session.process)await stopChromeProcess(session.process,3000);
}
/**
 * Waits for a spawned Chrome to exit, killing it after `graceMs`, and then waits (bounded) for the kill to complete.
 * On Windows, letting Node exit while a just-killed child or its CDP socket is still closing can abort the Node
 * process natively (exit 0xC0000409, no message), which also loses the child's reported result or error.
 */
export async function stopChromeProcess(child:ChildProcess,graceMs:number):Promise<void>{
  if(child.exitCode!==null||child.signalCode!==null)return;
  const exited=new Promise<void>(done=>child.once('exit',()=>done()));
  if(await Promise.race([exited.then(()=>true),new Promise<boolean>(done=>setTimeout(()=>done(false),graceMs))]))return;
  child.kill();
  await Promise.race([exited,new Promise<void>(done=>setTimeout(done,5000))]);
}

export interface OfflineChrome { index: number; port: number; browser: Browser; pages: Page[]; process?: ChildProcess; routeSeen: number[]; version: string | null }

/**
 * Starts one Chrome process with `tabs` Onda-routed pages, the production topology (one browser per worker, one tab per
 * fan-out child). `headed` shows real windows (background tabs behave like production's); default is headless.
 */
export async function launchOfflineChrome(options: { chromium: typeof import('playwright').chromium; chromePath: string; scratch: string; index: number; tabs: number;
  headed?: boolean; basePort?: number; responseDelayMs?: number }): Promise<OfflineChrome> {
  const port = (options.basePort ?? 29544) + options.index, profile = join(options.scratch, 'profiles', `w${options.index}`);
  await mkdir(profile, { recursive: true });
  for (const stop = Date.now() + 20_000; ;) {
    try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) }); } catch { break; }
    if (Date.now() > stop) throw Error('BENCH_PORT_BUSY');
    await new Promise(done => setTimeout(done, 250));
  }
  let child:ChildProcess|undefined;
  let browser:Browser|undefined;
  let version:string|null=null;
  try {
  if(process.platform==='linux') {
    // Supported Playwright startup on Linux CI; Windows retains the production
    // raw Chrome/CDP topology. Both paths keep isolated profiles and the same
    // blocked DNS/proxy, routes and network-escape check.
    const launched=await options.chromium.launchPersistentContext(profile,{executablePath:options.chromePath,headless:!options.headed,serviceWorkers:'block',
      args:[`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--proxy-server=http://127.0.0.1:9']});
    browser=launched.browser()!;version=browser.version();
  } else {
  child = spawn(options.chromePath, [...(options.headed ? [`--window-position=${40 + options.index * 30},${40 + options.index * 30}`, '--window-size=900,700'] : ['--headless=new']),
    `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--proxy-server=http://127.0.0.1:9',
    'about:blank'], { stdio: 'ignore', windowsHide: !options.headed });

  for (const deadline = Date.now() + 20_000; ;) {
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) { version = String((await response.json() as { Browser?: string }).Browser ?? '') || null; break; } } catch { /* starting */ }
    if (Date.now() > deadline) throw Error('BENCH_CHROME_START_TIMEOUT');
    await new Promise(done => setTimeout(done, 100));
  }
  browser = await options.chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  }
  const context = browser.contexts()[0]!;
  const pages: Page[] = [];
  const routeSeen: number[] = [];
  for (let tab = 0; tab < options.tabs; tab++) {
    const page = tab === 0 ? context.pages()[0] ?? await context.newPage() : await context.newPage();
    await page.route('https://app.onda.fit/**', async route => {
      const request = route.request();
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/bookings/public-checkout') {
        routeSeen.push(performance.now());
        if (options.responseDelayMs) await new Promise(done => setTimeout(done, options.responseDelayMs));
        await route.fulfill({ status: 409, contentType: 'application/json', body: SYNTHETIC_409 });
        return;
      }
      if (request.method() === 'GET' && request.url() === ONDA_BOOKING_URL) {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>offline bench</title><p>offline bench</p>' });
        return;
      }
      await route.fulfill({ status: 404, body: '' });
    });
    await page.goto(ONDA_BOOKING_URL, { waitUntil: 'domcontentloaded' });
    const escaped = await page.evaluate(async () => { try { await fetch('https://example.com/', { mode: 'no-cors' }); return true; } catch { return false; } });
    if (escaped) throw Error('BENCH_NETWORK_NOT_ISOLATED');
    pages.push(page);
  }
  // Like production, the first tab is the one in front.
  await pages[0]!.bringToFront();
  return { index: options.index, port, browser, pages, process: child, routeSeen, version };
  } catch(error) {if(browser){try{await (await browser.newBrowserCDPSession()).send('Browser.close');}catch{}await browser.close().catch(()=>{});}if(child)await stopChromeProcess(child,0);throw error;}
}

/** Emulated page-script activity: every 10 ms each tab's main thread is busy for `busyMs` (0 disables). */
export async function startPageBusyWork(page: Page, busyMs: number): Promise<void> {
  if (!(busyMs > 0)) return;
  await page.evaluate(ms => { const w = window as unknown as { __benchBusy?: number };
    if (w.__benchBusy) return; w.__benchBusy = window.setInterval(() => { const end = performance.now() + ms; while (performance.now() < end) { /* busy */ } }, 10); }, busyMs);
}

/**
 * Synthetic stand-in for genuine page-bound security preparation (which cannot run offline): `cpuMs` of work on
 * the tab's main thread, then `waitMs` of idle waiting, like a network round trip. A proxy, clearly not Turnstile.
 */
export function syntheticSecurityPreparation(page: Page, cpuMs: number, waitMs: number) {
  return async () => {
    if (cpuMs > 0 || waitMs > 0) await page.evaluate(async ({ cpu, wait }) => {
      const end = performance.now() + cpu; while (performance.now() < end) { /* busy */ }
      await new Promise(done => setTimeout(done, wait));
    }, { cpu: cpuMs, wait: waitMs });
    else await new Promise(done => setTimeout(done, 5));
    return { turnstileToken: 'offline-bench-token', publicFingerprint: 'offline-bench-print' };
  };
}

/** Machine-wide CPU busy share between two os.cpus() snapshots (works on Windows, unlike loadavg). */
export function cpuSnapshot() { return cpus().map(cpu => ({ ...cpu.times })); }
export function busyPercent(before: ReturnType<typeof cpuSnapshot>, after: ReturnType<typeof cpuSnapshot>): number | null {
  let busy = 0, total = 0;
  after.forEach((times, index) => {
    const prior = before[index]; if (!prior) return;
    const delta = (key: keyof typeof times) => times[key] - prior[key];
    const sum = delta('user') + delta('nice') + delta('sys') + delta('idle') + delta('irq');
    total += sum; busy += sum - delta('idle');
  });
  return total > 0 ? Math.round((busy / total) * 1000) / 10 : null;
}
