import { FACILITY_ID } from './onda-availability.js';
// Exact observed normal-site paths. Ignore query strings, bodies, headers and all other traffic.
export function passiveEndpoint(url, method) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return undefined;
    }
    if (parsed.origin !== 'https://app.onda.fit')
        return undefined;
    if (method === 'GET' && parsed.pathname === `/api/public/facilities/${FACILITY_ID}/date-availability`)
        return 'AVAILABILITY';
    if (method === 'POST' && parsed.pathname === `/api/public/facilities/${FACILITY_ID}/member-only-court-slots`)
        return 'CHECKOUT_PREPARATION';
    if (method === 'POST' && parsed.pathname === '/api/bookings/public-checkout')
        return 'RESERVATION_SUBMISSION';
    return undefined;
}
export function observePassiveReleaseNetwork(page, t) {
    let nextId = 0;
    const active = new Map();
    const request = (r) => {
        try {
            if (active.has(r))
                return;
            const endpoint = passiveEndpoint(r.url(), r.method());
            if (!endpoint || active.size >= 16)
                return;
            const id = ++nextId;
            active.set(r, { id, endpoint });
            t.recordPassiveNetwork(id, endpoint, 'DISPATCHED');
        }
        catch { /* passive */ }
    };
    const response = (r) => {
        try {
            const item = active.get(r.request());
            if (!item || item.headersSeen)
                return;
            item.headersSeen = true;
            item.status = r.status();
            t.recordPassiveNetwork(item.id, item.endpoint, 'HEADERS', item.status);
        }
        catch { /* passive */ }
    };
    const finished = (r) => {
        try {
            const item = active.get(r);
            if (!item)
                return;
            active.delete(r);
            t.recordPassiveNetwork(item.id, item.endpoint, 'COMPLETED', item.status);
        }
        catch { /* passive */ }
    };
    const failed = (r) => {
        try {
            const item = active.get(r);
            if (!item)
                return;
            active.delete(r);
            const reason = r.failure()?.errorText;
            t.recordPassiveNetwork(item.id, item.endpoint, 'FAILED', item.status, reason?.includes('ERR_ABORTED') ? 'CANCELED_OR_NAVIGATED' : reason ? 'NETWORK_FAILURE' : 'UNKNOWN');
        }
        catch { /* passive */ }
    };
    page.on('request', request);
    page.on('response', response);
    page.on('requestfinished', finished);
    page.on('requestfailed', failed);
    return () => {
        page.off('request', request);
        page.off('response', response);
        page.off('requestfinished', finished);
        page.off('requestfailed', failed);
        for (const item of active.values())
            t.recordPassiveNetwork(item.id, item.endpoint, 'FAILED', item.status, 'UNKNOWN');
        active.clear();
    };
}
//# sourceMappingURL=passive-release-network.js.map