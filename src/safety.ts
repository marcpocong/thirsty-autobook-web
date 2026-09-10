import { setTimeout as delay } from 'node:timers/promises';

export class Safety {
  readonly controller = new AbortController();
  locked = false;
  boundary = false;
  get signal() { return this.controller.signal; }
  check() { this.signal.throwIfAborted(); if (this.boundary) throw new Error('PAYMENT_BOUNDARY_REACHED'); }
  stop(code: string) { if (!this.signal.aborted) this.controller.abort(new Error(code)); }
  lock() { this.check(); this.locked = true; }
  fallback() { this.check(); if (this.locked) throw new Error('BOOKING_LOCKED'); }
  async finalAction(action: () => Promise<void>) {
    this.check(); this.locked = true; this.boundary = true;
    // Close the gate BEFORE dispatch; ambiguous failure must never retry.
    await action();
  }
}
export function securityReason(text: string): string | undefined {
  if (/too many requests|rate.?limit|retry.after|\b429\b/i.test(text)) return 'RATE_LIMITED';
  if (/captcha|verify (?:that )?you are human|checking your browser|access denied|automated access.*(?:blocked|prohibited)|automation.*(?:blocked|prohibited)|security challenge/i.test(text)) return 'SECURITY_CHALLENGE';
}
export function requireArmed(mode: string, armed: boolean) {
  if (['race', 'release:observe', 'race:dry', 'selection:armed'].includes(mode) && !armed) throw new Error('ARMED_FLAG_REQUIRED');
}
export async function waitUntil(epochMs: number, signal: AbortSignal) {
  const monoTarget = performance.now() + epochMs - Date.now();
  while (true) {
    signal.throwIfAborted();
    const remaining = monoTarget - performance.now();
    if (remaining <= 0 && Date.now() >= epochMs) return;
    // Yield even in final precision interval, keeping abort input responsive.
    await delay(Math.max(1, Math.min(1000, remaining > 20 ? remaining - 10 : 1)), undefined, { signal });
  }
}
