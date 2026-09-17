import type { Page } from 'playwright';
import { DateTime } from 'luxon';
import { setTimeout as delay } from 'node:timers/promises';
import { type Config, type ReleaseSettings, releaseCalendar, compilePreferences, ONDA_URL, VENUE } from './config.js';
import { assertPage } from './browser.js';
import { snapshot, validateSnapshot, resolvePreference } from './grid.js';
import { ReleaseShellFailure, releaseNavigationTarget, waitForBookingShellForRelease, navigateReleasedTargetDate, preopenReleaseCalendar, observePreopenedTarget, clickReleasedTargetDate } from './release-navigation.js';
import { Safety, waitUntil } from './safety.js';
import { Telemetry } from './telemetry.js';
import { emitUiEvent } from './ui-events.js';
import { AvailabilityDiscovery, browserAvailabilityRequest } from './availability-discovery.js';

export async function boundedRelease<T>(maximum: number, retryDelay: number, signal: AbortSignal, attempt: (n: number) => Promise<T | undefined>): Promise<T> {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 2) throw new Error('INVALID_RELOAD_LIMIT');
  for (let n = 1; n <= maximum; n++) {
    signal.throwIfAborted();
    const result = await attempt(n);
    if (result !== undefined) return result;
    if (n < maximum) await delay(retryDelay, undefined, { signal });
  }
  throw new Error('RELEASE_HORIZON_UNAVAILABLE');
}
export interface ReleaseGate { target: ReturnType<typeof releaseCalendar>; beforeArmed(): Promise<void>; verifyContext?():void; onRelease?():void }
export async function observeRelease(page: Page, c: Config | ReleaseSettings, safety: Safety, t: Telemetry, dry: boolean, selecting = false, gate?: ReleaseGate) {
  const target = gate?.target ?? releaseCalendar(c);
  const navigationTarget = releaseNavigationTarget(target.targetDate);
  const preferences = 'START_TIME' in c ? compilePreferences(c) : undefined;
  const discovery = c.AVAILABILITY_DISCOVERY_MODE === 'hybrid' && 'MAX_PRICE' in c
    ? new AvailabilityDiscovery(target.targetDate, c.MAX_PRICE, browserAvailabilityRequest(page, target.targetDate, safety, t), safety, t, preferences) : undefined;
  if (dry && !preferences) throw new Error('DRY_CONFIG_REQUIRED');
  if (Date.now() >= target.releaseMs - c.PREFLIGHT_SECONDS_BEFORE * 1000) throw new Error('TOO_LATE_FOR_PREFLIGHT');
  emitUiEvent({ type: 'plan', targetDate: target.targetDate, releaseMs: target.releaseMs, timezone: c.TIMEZONE });
  page.setDefaultTimeout(c.CRITICAL_STEP_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(c.CRITICAL_STEP_TIMEOUT_MS);
  let preflightCount=0;
  const preflight = async () => {
    const final=preflightCount++>0;if(gate)t.mark(final?'finalPreflightStarted':'initialPreflightStarted');
    t.mark('preflightStarted');
    gate?.verifyContext?.();
    await assertPage(page, safety);
    const s = await snapshot(page);
    const current = DateTime.now().setZone(c.TIMEZONE).toISODate()!;
    const cells = validateSnapshot(s, current);
    if (cells.some(cell => cell.state === 'SELECTED')) throw new Error('PREEXISTING_SELECTION');
    if (await page.getByTestId('booking-court-filter-label').innerText() !== 'All Courts') throw new Error('COURT_FILTER_NOT_ALL');
    if (await page.evaluate(() => document.visibilityState) !== 'visible') throw new Error('TAB_NOT_VISIBLE');
    t.mark('preflightCompleted');
    if(gate)t.mark(final?'finalPreflightCompleted':'initialPreflightCompleted');
  };
  await preflight();
  console.log(JSON.stringify({ mode: selecting ? 'SELECTION ONLY — STOPS BEFORE PROCEED' : dry ? 'DRY RACE — NO SELECTION' : 'RELEASE OBSERVATION — NO BOOKING', venue: VENUE, targetDate: target.targetDate, preferences, maximumPrice: 'MAX_PRICE' in c ? c.MAX_PRICE : undefined, playerInfoLoaded: 'PLAYER_FULL_NAME' in c, localTime: new Date().toString(), manilaTime: DateTime.now().setZone('Asia/Manila').toISO(), release: target.releaseISO, releaseLeadMs: c.RELEASE_LEAD_MS, maxReloads: c.MAX_RELEASE_RELOADS, secondsRemaining: (target.releaseMs - Date.now()) / 1000, abort: 'Q or Ctrl+C' }, null, 2));
  await waitUntil(target.releaseMs - c.PREFLIGHT_SECONDS_BEFORE * 1000, safety.signal);
  await preflight();
  if (c.RELEASE_PREOPEN_CALENDAR) await preopenReleaseCalendar(page, navigationTarget, safety, t, c.CRITICAL_STEP_TIMEOUT_MS, c.BOOKING_HORIZON_DAYS > 0);
  if (gate) await gate.beforeArmed();
  if (Date.now() >= target.releaseMs) throw new Error('PREFLIGHT_MISSED_RELEASE');
  t.mark('armed'); t.mark('releaseScheduled', target.releaseMs);
  console.log('ARMED — waiting for release.');
  await waitUntil(target.releaseMs, safety.signal);
  if(Date.now()-target.releaseMs>1000)throw Error('RELEASE_MISSED');
  t.mark('releaseTriggerFired', Date.now() - target.releaseMs);
  if (gate?.onRelease) gate.onRelease();
  discovery?.start();
  let readyWithoutReload = false;
  let grid:import('./grid.js').Snapshot|undefined;
  if (c.RELEASE_PREOPEN_CALENDAR) {
    t.mark('preopenReleaseCheckStarted');
    if (await observePreopenedTarget(page, navigationTarget, safety)) {
      t.mark('targetEnabledWithoutReload');
      grid=await clickReleasedTargetDate(page, navigationTarget, safety, t, c.CRITICAL_STEP_TIMEOUT_MS);
      readyWithoutReload = true;
    } else { t.mark('targetStillDisabledAtRelease'); t.mark('reloadFallbackStarted'); }
  }
  if (!readyWithoutReload) grid=await boundedRelease(c.MAX_RELEASE_RELOADS, c.RELEASE_RETRY_DELAY_MS, safety.signal, async attempt => {
    safety.check(); t.mark('reloadStarted');
    let response:Awaited<ReturnType<Page['reload']>>;
    try{response=await page.reload({ waitUntil: 'commit' });}
    catch(error){
      const timeout=error instanceof Error&&(error.name==='TimeoutError'||/timeout/i.test(error.name));
      let code=timeout?'RELEASE_PAGE_LOAD_TIMEOUT':'RELEASE_NAVIGATION_FAILED',classification=timeout?'PAGE_LOADING_TIMEOUT':'NAVIGATION_FAILED';
      try{safety.check();}catch(stopped){code=stopped instanceof Error&&['CHROME_DISCONNECTED','SECURITY_CHALLENGE','RATE_LIMITED','ACCESS_BLOCKED','UNEXPECTED_REDIRECT','USER_ABORT'].includes(stopped.message)?stopped.message:'RELEASE_NAVIGATION_FAILED';classification=code==='CHROME_DISCONNECTED'?'BROWSER_DISCONNECTED':code==='UNEXPECTED_REDIRECT'?'UNEXPECTED_NAVIGATION':code==='USER_ABORT'?'ABORTED':code;}
      t.recordNavigation(timeout?'TIMEOUT':'FAILED');t.recordReleaseFailure('RELOAD_NAVIGATION',code,classification);
      if(timeout&&attempt<c.MAX_RELEASE_RELOADS&&!page.isClosed()&&page.url()===ONDA_URL){safety.check();t.mark('releaseShellRecoveryAllowed');return undefined;}
      throw Error(code,{cause:error});
    }
    const httpStatus=response?.status();t.recordNavigation(response?'HTTP_RESPONSE':'NO_RESPONSE',httpStatus);t.mark('reloadCommitted');
    try{await waitForBookingShellForRelease(page, safety, c.CRITICAL_STEP_TIMEOUT_MS, t, {httpStatus});}
    catch(error){if(error instanceof ReleaseShellFailure&&error.recoverableBeforeSelection&&attempt<c.MAX_RELEASE_RELOADS){safety.check();t.mark('releaseShellRecoveryAllowed');return undefined;}throw error;}
    const result = await navigateReleasedTargetDate(page, navigationTarget, safety, t, c.CRITICAL_STEP_TIMEOUT_MS);
    if (result === 'TARGET_DATE_NOT_RELEASED') return undefined;
    return result;
  });
  safety.check();if(!grid)throw Error('STALE_OR_INCOMPLETE_GRID');
  const cells = validateSnapshot(grid, target.targetDate);
  discovery?.captureAtGrid();
  const chosen = preferences && !selecting ? resolvePreference(cells, discovery?.rank(cells, preferences) ?? preferences) : undefined;
  if (preferences && !selecting) t.mark('preferenceResolved');
  if (!selecting) {
    console.log(JSON.stringify({ targetDate: target.targetDate, chosen: chosen ?? null, stoppedBeforeAnySelection: true,
      releaseBranch: readyWithoutReload ? 'NO REFRESH' : 'RELOAD', candidateSource: discovery?.source ?? 'UI_ONLY',
      availability: discovery ? t.events.some(e => e.event === 'availabilityParsed') ? 'SUCCESS' : 'FALLBACK' : 'OFF',
      apiLatencyMs: t.events.find(e => e.event === 'availabilityResponseReceived')?.value ?? 'NOT MEASURED' }, null, 2));
    discovery?.finish();
  }
  return { target, grid, preferences: preferences ?? [], discovery };
}
