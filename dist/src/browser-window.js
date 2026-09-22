import { chromium } from 'playwright';
import { ONDA_URL } from './config.js';
import { browserIdentity, verifyDedicatedChromeAsync } from './browser.js';
const connections = new Map();
const ondaOrigin = new URL(ONDA_URL).origin;
function ondaPage(page) { try {
    return new URL(page.url()).origin === ondaOrigin;
}
catch {
    return false;
} }
/** Adds a visible identity to the exact worker tab without navigating or touching booking controls. */
export async function identifyWorkerPage(page, workerId) {
    await page.evaluate(id => {
        const prefix = `THIRSTY BOT ${id}`;
        if (!document.title.startsWith(prefix))
            document.title = `${prefix} · ${document.title || 'ONDA'}`;
        const badgeId = 'thirsty-bot-browser-identity';
        let badge = document.getElementById(badgeId);
        if (!badge) {
            badge = document.createElement('div');
            badge.id = badgeId;
            badge.setAttribute('aria-hidden', 'true');
            document.documentElement.append(badge);
        }
        badge.textContent = `BROWSER ${id}`;
        Object.assign(badge.style, { position: 'fixed', top: '8px', right: '8px', zIndex: '2147483647', padding: '7px 11px', borderRadius: '7px', background: '#102b1b', color: '#c7ff91', border: '2px solid #89d84a', font: '700 14px Segoe UI, sans-serif', letterSpacing: '0.08em', boxShadow: '0 3px 14px rgba(0,0,0,.45)', pointerEvents: 'none' });
    }, workerId);
}
export async function showWorkerPage(page, workerId, options = {}) {
    // Presentation is best-effort; it must never turn a verified booking outcome
    // into an unknown result merely because a page was navigating while labeled.
    await identifyWorkerPage(page, workerId).catch(() => undefined);
    const session = await page.context().newCDPSession(page);
    try {
        const { windowId, bounds } = await session.send('Browser.getWindowForTarget');
        if (options.maximize)
            await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
        else if (bounds.windowState === 'minimized')
            await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    }
    finally {
        await session.detach();
    }
    await page.bringToFront();
}
/** Focuses an existing verified worker window. It never starts Chrome or changes the page URL. */
export async function focusDedicatedBrowser(request) {
    const identity = browserIdentity(request.workerId);
    await verifyDedicatedChromeAsync(identity);
    let browser = connections.get(request.workerId);
    if (!browser?.isConnected()) {
        browser = await chromium.connectOverCDP(identity.cdpUrl, { timeout: 5000 }).catch(() => { throw Error('CDP_ENDPOINT_UNAVAILABLE'); });
        connections.set(request.workerId, browser);
        browser.on('disconnected', () => connections.delete(request.workerId));
    }
    const pages = browser.contexts().flatMap(context => context.pages()).filter(ondaPage);
    const exact = request.bookingId ? pages.find(page => {
        try {
            return new URL(page.url()).searchParams.get('bookingId') === request.bookingId;
        }
        catch {
            return false;
        }
    }) : undefined;
    const marked = await Promise.all(pages.map(async (page) => ({ page, title: await page.title().catch(() => '') })));
    const markedPages = marked.filter(candidate => candidate.title.startsWith(`THIRSTY BOT ${request.workerId}`));
    const page = request.bookingId ? exact : markedPages.length === 1 ? markedPages[0].page : pages.length === 1 ? pages[0] : undefined;
    if (!page)
        throw Error(pages.length ? 'ONDA_TAB_AMBIGUOUS_OR_MISSING' : 'ONDA_TAB_MISSING');
    await showWorkerPage(page, request.workerId, { maximize: true });
}
//# sourceMappingURL=browser-window.js.map