import { setTimeout as delay } from 'node:timers/promises';
export class Safety {
    persistStage;
    async stage(stage, evidence) { await this.persistStage?.(stage, evidence); }
    controller = new AbortController();
    locked = false;
    boundary = false;
    stopEvidence;
    finalDispatchAvailable = false;
    get signal() { return this.controller.signal; }
    check() { this.signal.throwIfAborted(); if (this.boundary)
        throw new Error('PAYMENT_BOUNDARY_REACHED'); }
    stop(code, evidence) {
        if (!this.signal.aborted) {
            this.stopEvidence = evidence;
            this.controller.abort(new Error(code));
        }
    }
    lock() { this.check(); this.locked = true; }
    fallback() { this.check(); if (this.locked)
        throw new Error('BOOKING_LOCKED'); }
    checkPassiveHandoff() {
        this.signal.throwIfAborted();
        if (!this.boundary || !this.locked)
            throw new Error('HANDOFF_GATE_NOT_SEALED');
    }
    consumeFinalDispatch() {
        this.checkPassiveHandoff();
        if (!this.finalDispatchAvailable)
            throw new Error('FINAL_ACTION_ALREADY_DISPATCHED');
        this.finalDispatchAvailable = false;
    }
    async finalAction(action) {
        this.check();
        await this.stage('FINAL_ACTION_DISPATCHING');
        this.check();
        this.locked = true;
        this.boundary = true;
        this.finalDispatchAvailable = true;
        // Close the gate BEFORE dispatch; ambiguous failure must never retry.
        try {
            await action();
        }
        finally {
            this.finalDispatchAvailable = false;
        }
    }
}
export function securityReason(text) {
    if (/too many requests|rate.?limit|retry.after|\b429\b/i.test(text))
        return 'RATE_LIMITED';
    if (/captcha|verify (?:that )?you are human|checking your browser|access denied|automated access.*(?:blocked|prohibited)|automation.*(?:blocked|prohibited)|security challenge/i.test(text))
        return 'SECURITY_CHALLENGE';
}
export function requireArmed(mode, armed) {
    if (['race', 'release:observe', 'race:dry', 'selection:armed', 'handoff:test', 'practice:full'].includes(mode) && !armed)
        throw new Error('ARMED_FLAG_REQUIRED');
}
export async function waitUntil(epochMs, signal) {
    const monoTarget = performance.now() + epochMs - Date.now();
    while (true) {
        signal.throwIfAborted();
        // A wall-clock jump or resume past an exact schedule must wake the caller
        // immediately so it can fail closed instead of waiting on monotonic time.
        if (Date.now() >= epochMs)
            return;
        const remaining = monoTarget - performance.now();
        if (remaining <= 0 && Date.now() >= epochMs)
            return;
        // Yield even in final precision interval, keeping abort input responsive.
        await delay(Math.max(1, Math.min(1000, remaining > 20 ? remaining - 10 : 1)), undefined, { signal });
    }
}
//# sourceMappingURL=safety.js.map