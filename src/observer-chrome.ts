import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ONDA_URL, VENUE } from './config.js';

/**
 * Dedicated read-only observer browser, launched the same way as the existing worker browsers: the installed Chrome
 * executable with its own profile and a localhost-only debugging port, then attached read-only. It never shares a
 * worker profile, customer, cookie or security context. Verified live on 2026-10-14: in this launch mode the
 * official page and the same-origin availability read succeed (HTTP 200); in headless Chrome and in
 * automation-launched browsers the site refuses the same read (HTTP 403), so headless is not used.
 */
export interface ObserverBrowser { browser: Browser; context: BrowserContext; page: Page; pid: number | undefined; close(): Promise<void> }
export function findChromeExecutable(): string {
  const candidates = [`${process.env.ProgramFiles ?? ''}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)'] ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  const found = candidates.find(path => path && existsSync(path));
  if (!found) throw Error('CHROME_NOT_INSTALLED');
  return found;
}
const freePort = () => new Promise<number>((done, fail) => { const server = createServer(); server.once('error', fail);
  server.listen(0, '127.0.0.1', () => { const port = (server.address() as { port: number }).port; server.close(() => done(port)); }); });

export async function launchObserverChrome(profileDirectory: string, options: { width?: number; height?: number; timeoutMs?: number; executable?: string } = {}): Promise<ObserverBrowser> {
  const profile = resolve(profileDirectory); mkdirSync(profile, { recursive: true });
  const port = await freePort(), executable = options.executable ?? findChromeExecutable();
  const child: ChildProcess = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', `--window-size=${options.width ?? 640},${options.height ?? 480}`, '--window-position=24,24', ONDA_URL],
    { stdio: 'ignore', windowsHide: false });
  let exited = false; child.once('exit', () => { exited = true; });
  const kill = () => { try { if (!exited) child.kill(); } catch { /* already gone */ } };
  let browser: Browser | undefined;
  const deadline = Date.now() + (options.timeoutMs ?? 20_000);
  while (!browser && Date.now() < deadline) {
    // A second Chrome on a profile that is already open hands off and exits without listening.
    if (exited) throw Error('OBSERVER_PROFILE_BUSY');
    await new Promise(done => setTimeout(done, 200));
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2_000 }); } catch { /* not listening yet */ }
  }
  if (!browser) { kill(); throw Error('OBSERVER_START_TIMEOUT'); }
  const close = async () => {
    try { const cdp = await browser!.newBrowserCDPSession(); await cdp.send('Browser.close'); } catch { /* fall back to process exit */ }
    await Promise.race([new Promise(done => child.once('exit', done)), new Promise(done => setTimeout(done, 5_000))]);
    kill(); await browser!.close().catch(() => undefined);
  };
  try {
    const context = browser.contexts()[0]!;
    // Observer sessions are read-only: every non-GET request and service worker is refused.
    await context.route('**/*', route => route.request().method() === 'GET' ? route.fallback() : route.abort('blockedbyclient'));
    let page = context.pages().find(p => p.url().startsWith('https://app.onda.fit'));
    if (!page) { page = context.pages()[0] ?? await context.newPage(); await page.goto(ONDA_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }); }
    if ((await page.getByTestId('public-booking-hero-title').first().innerText({ timeout: 20_000 })).trim() !== VENUE) throw Error('OBSERVER_VENUE_UNVERIFIED');
    return { browser, context, page, pid: child.pid, close };
  } catch (error) { await close(); throw error; }
}
