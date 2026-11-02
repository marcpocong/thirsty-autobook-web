import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { ONDA_URL } from '../config.js';
import type { CurrentCheckoutHeadersProvider } from './browser-session-transport.js';

/** Closed diagnostic facts about a failed acquisition; never a token, fingerprint or provider text. */
export interface SecurityFailureDetail { failedHelper?: 'challenge' | 'fingerprint' }
export interface SecurityHelperObservation {
  event: 'SECURITY_HELPERS_SETTLED'; durationMs: number; code: string;
  helpers: Partial<Record<'challenge'|'fingerprint',{state:'PENDING'|'READY'|'EMPTY'|'REJECTED';durationMs:number}>>;
}

export class CalendarFreeSecurityError extends Error {
  constructor(readonly code: string, readonly detail: SecurityFailureDetail = {}) { super(code); this.name = 'CalendarFreeSecurityError'; }
}

const failureDetail = (result: { failedHelper?: unknown }): SecurityFailureDetail =>
  result.failedHelper === 'challenge' || result.failedHelper === 'fingerprint' ? { failedHelper: result.failedHelper } : {};

/** Calls Onda's current booking challenge and fingerprint helpers in its own page runtime. */
export function calendarFreeSecurityContext(page: Page, observe?:(value:SecurityHelperObservation)=>void): CurrentCheckoutHeadersProvider {
  let used = false;
  return async () => {
    if (used) throw new CalendarFreeSecurityError('SECURITY_CONTEXT_ALREADY_USED');
    used = true;
    if (page.isClosed() || page.url() !== ONDA_URL) throw new CalendarFreeSecurityError('SECURITY_CONTEXT_PAGE_INVALID');
    const scripts = await page.locator('script[src]').evaluateAll(elements =>
      elements.map(element => (element as HTMLScriptElement).src));
    const origin = new URL(ONDA_URL).origin;
    if (!scripts.some(src => {
      try { const url = new URL(src); return url.origin === origin && url.pathname.startsWith('/_next/static/immutable/chunks/'); }
      catch { return false; }
    }))
      throw new CalendarFreeSecurityError('ONDA_SECURITY_BUNDLE_CHANGED');
    try {
      const source = await readFile(new URL('./calendar-free-security-context-browser.js', import.meta.url), 'utf8');
      const started=performance.now();
      const result = await page.evaluate<{ code?: string; turnstileToken?: string; publicFingerprint?: string; failedHelper?: string; helperStages?:Record<string,{state:unknown;durationMs:unknown}> }>(
        `(${source})()`);
      const durationMs=Math.max(0,Math.round(performance.now()-started)),helpers:SecurityHelperObservation['helpers']={};
      for(const name of ['challenge','fingerprint'] as const){const stage=result.helperStages?.[name];
        if(stage&&['PENDING','READY','EMPTY','REJECTED'].includes(String(stage.state))&&typeof stage.durationMs==='number'&&Number.isFinite(stage.durationMs)&&stage.durationMs>=0)
          helpers[name]={state:stage.state as NonNullable<SecurityHelperObservation['helpers']['challenge']>['state'],durationMs:stage.state==='PENDING'?durationMs:Math.round(stage.durationMs)};}
      try{observe?.({event:'SECURITY_HELPERS_SETTLED',durationMs,code:result.code&&/^[A-Z][A-Z0-9_]{0,63}$/.test(result.code)?result.code:'COMPLETED',helpers});}catch{/* Diagnostics never affect acceptance. */}
      if (page.isClosed() || page.url() !== ONDA_URL) throw new CalendarFreeSecurityError('SECURITY_CONTEXT_PAGE_CHANGED');
      if (result.code) throw new CalendarFreeSecurityError(result.code, failureDetail(result));
      if (!result.turnstileToken || !result.publicFingerprint)
        throw new CalendarFreeSecurityError('SECURITY_CONTEXT_EMPTY');
      return { turnstileToken: result.turnstileToken, publicFingerprint: result.publicFingerprint };
    } catch (error) {
      if (error instanceof CalendarFreeSecurityError) throw error;
      throw new CalendarFreeSecurityError('SECURITY_CONTEXT_BROWSER_FAILED');
    }
  };
}
