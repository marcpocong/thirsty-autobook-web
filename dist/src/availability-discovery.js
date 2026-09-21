import { ONDA_URL } from './config.js';
import { classifyRateLimit } from './rate-limit.js';
import { availabilityPath, parseAvailability, apiCandidates, hybridPreferences, compareAvailability } from './onda-availability.js';
function unreleasedEmptyResponse(raw) {
    if (!raw || typeof raw !== 'object')
        return false;
    const body = raw;
    if (body.success !== true || !body.data || typeof body.data !== 'object')
        return false;
    const data = body.data;
    return !!data.dates && typeof data.dates === 'object' && !Array.isArray(data.dates) &&
        !!data.slotsBySpace && typeof data.slotsBySpace === 'object' && !Array.isArray(data.slotsBySpace) &&
        Object.keys(data.dates).length === 0 && Object.keys(data.slotsBySpace).length === 0;
}
// Release discovery must survive a same-tab reload. BrowserContext.request shares
// the context cookie jar but is not tied to the page's JavaScript execution context.
export function releaseAvailabilityRequest(page, targetDate, safety, t, timeout = 2500, notReleasedAttempts = 0) {
    const url = new URL(availabilityPath(targetDate), ONDA_URL).href;
    return async () => {
        safety.check();
        if (page.url() !== ONDA_URL) {
            t.mark('availabilityWrongPage');
            t.mark('availabilityFallbackToUi');
            return;
        }
        const started = performance.now();
        t.mark('availabilityRequestStarted');
        t.mark('availabilitySessionTransport');
        try {
            const response = await page.context().request.get(url, { timeout, failOnStatusCode: false, maxRedirects: 0 });
            t.mark('availabilityResponseReceived', performance.now() - started);
            const status = response.status(), headers = response.headers();
            t.mark('availabilityHttpStatus', status);
            const retry = headers['retry-after']?.trim() ?? '';
            const restricted = status === 429 || (/^\d+$/.test(retry) ? Number(retry) > 0 :
                /^[A-Za-z]{3},/.test(retry) && Date.parse(retry) > Date.now());
            if (restricted) {
                const evidence = { reason: 'RATE_LIMITED', timestamp: new Date().toISOString(), monoMs: performance.now(),
                    hostname: 'app.onda.fit', status, resourceType: 'fetch', navigation: false,
                    retryAfterPresent: !!headers['retry-after'], sameOndaSite: true };
                t.rateLimit('ondaRateLimited', evidence);
                safety.stop('RATE_LIMITED', evidence);
            }
            if (status === 401 || status === 403)
                safety.stop('ACCESS_BLOCKED');
            if (headers['cf-mitigated'] === 'challenge')
                safety.stop('SECURITY_CHALLENGE');
            safety.check();
            if (status !== 200) {
                t.mark('availabilityHttpFailure');
                t.mark('availabilityFallbackToUi');
                return;
            }
            const body = await response.body();
            if (body.length > 2_000_000) {
                t.mark('availabilityOversize');
                t.mark('availabilityFallbackToUi');
                return;
            }
            const contentType = headers['content-type'] ?? '';
            if (!contentType.includes('application/json')) {
                if (/captcha|verify (?:that )?you are human|checking your browser|security challenge|access denied/i.test(body.toString('utf8')))
                    safety.stop('SECURITY_CHALLENGE');
                t.mark('availabilityNonJson');
                t.mark('availabilityFallbackToUi');
                return;
            }
            let raw;
            try {
                raw = JSON.parse(body.toString('utf8'));
            }
            catch {
                t.mark('availabilityInvalidJson');
                t.mark('availabilityFallbackToUi');
                return;
            }
            if (unreleasedEmptyResponse(raw)) {
                t.mark('availabilityDateNotReleased');
                if (notReleasedAttempts < 4) {
                    await new Promise(resolve => setTimeout(resolve, [250, 500, 1000, 2000][notReleasedAttempts]));
                    safety.check();
                    return releaseAvailabilityRequest(page, targetDate, safety, t, timeout, notReleasedAttempts + 1)();
                }
                t.mark('availabilityFallbackToUi');
                return;
            }
            try {
                const parseStarted = performance.now(), snapshot = parseAvailability(raw, targetDate);
                t.mark('availabilityParsed', performance.now() - parseStarted);
                t.mark('availabilityUnknownSpaces', snapshot.unknownSpaces);
                return snapshot;
            }
            catch {
                t.mark('availabilitySchemaRejected');
                t.mark('availabilityFallbackToUi');
                return;
            }
        }
        catch (error) {
            if (safety.signal.aborted)
                t.mark('availabilitySafetyAbort');
            else if (error instanceof Error && error.name === 'TimeoutError')
                t.mark('availabilityTransportTimeout');
            else
                t.mark('availabilityTransportFailed');
            t.mark('availabilityFallbackToUi');
            return;
        }
    };
}
export function browserAvailabilityRequest(page, targetDate, safety, t, timeout = 2500) {
    const path = availabilityPath(targetDate); // Precompute before the release wait.
    return async () => {
        safety.check();
        if (page.url() !== ONDA_URL) {
            t.mark('availabilityFallbackToUi');
            return;
        }
        const started = performance.now();
        t.mark('availabilityRequestStarted');
        // Observe security headers outside evaluate too: reload can destroy its execution context.
        const onResponse = (response) => {
            if (response.url() !== new URL(path, ONDA_URL).href)
                return;
            const rate = classifyRateLimit(response);
            if (rate?.restricted) {
                t.rateLimit('ondaRateLimited', rate.evidence);
                safety.stop('RATE_LIMITED', rate.evidence);
            }
            else if ([401, 403].includes(response.status()))
                safety.stop('ACCESS_BLOCKED');
            else if (response.headers()['cf-mitigated'] === 'challenge')
                safety.stop('SECURITY_CHALLENGE');
        };
        page.on('response', onResponse);
        const abort = () => {
            void page.evaluate(() => {
                globalThis.__thirstyAvailabilityAbort?.();
            }).catch(() => { });
        };
        safety.signal.addEventListener('abort', abort, { once: true });
        try {
            const response = await page.evaluate(async ({ path, timeout }) => {
                const controller = new AbortController();
                const state = globalThis;
                state.__thirstyAvailabilityAbort = () => controller.abort();
                const timer = setTimeout(() => controller.abort(), timeout);
                try {
                    const response = await fetch(path, { method: 'GET', credentials: 'same-origin', mode: 'same-origin',
                        redirect: 'error', signal: controller.signal });
                    const retry = response.headers.get('retry-after')?.trim() ?? '';
                    const restricted = response.status === 429 || (/^\d+$/.test(retry) ? Number(retry) > 0 : /^[A-Za-z]{3},/.test(retry) && Date.parse(retry) > Date.now());
                    const meta = { status: response.status, restricted, retryAfterPresent: response.headers.has('retry-after') };
                    if (restricted || [401, 403].includes(response.status))
                        return { ...meta, kind: 'blocked' };
                    if (response.headers.get('cf-mitigated') === 'challenge')
                        return { ...meta, kind: 'challenge' };
                    const text = await response.text();
                    if (!response.headers.get('content-type')?.includes('application/json') && /captcha|verify (?:that )?you are human|checking your browser|security challenge|access denied/i.test(text))
                        return { ...meta, kind: 'challenge' };
                    if (!response.ok || text.length > 2_000_000)
                        return { ...meta, kind: 'failed' };
                    try {
                        return { ...meta, kind: 'json', data: JSON.parse(text) };
                    }
                    catch {
                        return { ...meta, kind: 'failed' };
                    }
                }
                finally {
                    clearTimeout(timer);
                    delete state.__thirstyAvailabilityAbort;
                }
            }, { path, timeout });
            t.mark('availabilityResponseReceived', performance.now() - started);
            if (response.restricted) {
                const evidence = { reason: 'RATE_LIMITED', timestamp: new Date().toISOString(), monoMs: performance.now(),
                    hostname: 'app.onda.fit', status: response.status, resourceType: 'fetch', navigation: false,
                    retryAfterPresent: response.retryAfterPresent, sameOndaSite: true };
                t.rateLimit('ondaRateLimited', evidence);
                safety.stop('RATE_LIMITED', evidence);
            }
            else if (response.kind === 'blocked')
                safety.stop('ACCESS_BLOCKED');
            else if (response.kind === 'challenge')
                safety.stop('SECURITY_CHALLENGE');
            safety.check();
            if (response.kind !== 'json') {
                t.mark('availabilityFallbackToUi');
                return;
            }
            const parseStarted = performance.now(), snapshot = parseAvailability(response.data, targetDate);
            t.mark('availabilityParsed', performance.now() - parseStarted);
            t.mark('availabilityUnknownSpaces', snapshot.unknownSpaces);
            return snapshot;
        }
        catch (error) {
            // Navigation may destroy evaluate/fetch. This optional request is never restarted by reload.
            // The shared Safety remains aborted for rate limits/security; it is never reset here.
            if (safety.signal.aborted)
                t.mark('availabilitySafetyAbort');
            else if (error instanceof Error && /execution context was destroyed|navigation|target closed/i.test(error.message))
                t.mark('availabilityPageContextDestroyed');
            else if (error instanceof Error && error.name === 'TimeoutError')
                t.mark('availabilityTransportTimeout');
            else
                t.mark('availabilityTransportFailed');
            t.mark('availabilityFallbackToUi');
            return undefined;
        }
        finally {
            safety.signal.removeEventListener('abort', abort);
            page.off('response', onResponse);
        }
    };
}
export class AvailabilityDiscovery {
    targetDate;
    maximum;
    request;
    safety;
    t;
    preferences;
    snapshot;
    earlyCandidates;
    active = false;
    closed = false;
    accept = true;
    requests = 0;
    source = 'UI_ONLY';
    constructor(targetDate, maximum, request, safety, t, preferences) {
        this.targetDate = targetDate;
        this.maximum = maximum;
        this.request = request;
        this.safety = safety;
        this.t = t;
        this.preferences = preferences;
    }
    start() { this.launch(false); }
    refresh() { this.snapshot = undefined; this.earlyCandidates = undefined; this.launch(true); }
    launch(refresh) {
        this.safety.check();
        if (this.closed || this.active || this.requests >= 3)
            return;
        this.requests++;
        this.active = true;
        this.accept = true;
        if (refresh)
            this.t.mark('availabilityRefreshStarted');
        // Deliberately no awaited availability task on the UI path. All rejections are handled.
        void this.request().then(result => {
            if (!this.closed && this.accept && !this.safety.signal.aborted) {
                this.snapshot = result;
                if (result && this.preferences) {
                    const started = performance.now();
                    this.earlyCandidates = apiCandidates(result, this.preferences, this.maximum);
                    this.t.mark('availabilityApiCandidatesReady', performance.now() - started);
                    this.t.mark('availabilityApiCandidateCount', this.earlyCandidates.length);
                }
            }
        }).catch(() => { this.t.mark('availabilityFallbackToUi'); }).finally(() => {
            this.active = false;
            if (refresh)
                this.t.mark('availabilityRefreshCompleted');
        });
    }
    captureAtGrid() { this.accept = false; }
    finish() { this.closed = true; this.snapshot = undefined; this.earlyCandidates = undefined; }
    rank(cells, preferences) {
        this.safety.check();
        const started = performance.now();
        const result = hybridPreferences(this.snapshot, this.targetDate, cells, preferences, this.maximum, this.earlyCandidates);
        if (this.snapshot) {
            const comparison = compareAvailability(this.snapshot, cells);
            this.t.mark('availabilityApiUiAgreed', comparison.agreed);
            this.t.mark('availabilityApiUiDisagreed', comparison.domOpenApiClosed + comparison.domClosedApiOpen);
        }
        this.source = result.source;
        this.t.mark(result.source === 'API+UI' ? 'candidateSourceApiUi' : 'candidateSourceUiOnly');
        if (result.source === 'UI_ONLY')
            this.t.mark('availabilityFallbackToUi');
        this.t.mark('availabilityCandidateResolved', performance.now() - started);
        return result.preferences;
    }
}
//# sourceMappingURL=availability-discovery.js.map