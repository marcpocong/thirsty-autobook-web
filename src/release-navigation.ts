import type { Page } from 'playwright';
import { DateTime } from 'luxon';
import { ONDA_URL, VENUE } from './config.js';
import { selectors, waitForGrid, snapshot, validateSnapshot } from './grid.js';
import { Safety, securityReason } from './safety.js';
import type { ReleaseFailureClassification, ReleaseFailureCode, ReleaseFailureStage, Telemetry } from './telemetry.js';

// Construct before the release wait; the normal practice navigator is unchanged.
export function releaseNavigationTarget(date: string) {
  const target = DateTime.fromISO(date);
  if (!target.isValid || target.toISODate() !== date) throw Error('INVALID_TARGET_DATE');
  return { date, daySelector: `button[data-day="${target.toFormat('M/d/yyyy')}"]`,
    heading: target.setLocale('en').toFormat('ccc, LLLL d') };
}
type ReleaseTarget = ReturnType<typeof releaseNavigationTarget>;
async function guardReleaseShell(page: Page, safety: Safety) {
  safety.check();
  if (page.url() !== ONDA_URL) throw Error('WRONG_URL');
  const reason = securityReason(await page.locator('body').innerText());
  if (reason) safety.stop(reason);
  safety.check();
}
const classified=(code:ReleaseFailureCode,classification:ReleaseFailureClassification)=>({code,classification});
export class ReleaseShellFailure extends Error{
  constructor(readonly code:ReleaseFailureCode,readonly recoverableBeforeSelection:boolean,cause:unknown){super(code,{cause});this.name='ReleaseShellFailure';}
}
function knownReleaseFailure(code:string){
  if(code==='CHROME_DISCONNECTED')return classified('CHROME_DISCONNECTED','BROWSER_DISCONNECTED');
  if(code==='SECURITY_CHALLENGE')return classified('SECURITY_CHALLENGE','SECURITY_CHALLENGE');
  if(code==='RATE_LIMITED')return classified('RATE_LIMITED','RATE_LIMITED');
  if(code==='ACCESS_BLOCKED')return classified('ACCESS_BLOCKED','ACCESS_BLOCKED');
  if(code==='UNEXPECTED_REDIRECT'||code==='WRONG_URL')return classified(code,'UNEXPECTED_NAVIGATION');
  if(code==='USER_ABORT')return classified('USER_ABORT','ABORTED');
}
async function shellFailure(page:Page,safety:Safety,t:Pick<Telemetry,'recordReleaseFailure'>|undefined,stage:ReleaseFailureStage,error:unknown,httpStatus?:number){
  let result:ReturnType<typeof classified>|undefined;
  try{safety.check();}catch(stopped){result=knownReleaseFailure(stopped instanceof Error?stopped.message:'');}
  if(!result&&page.isClosed())result=classified('CHROME_DISCONNECTED','BROWSER_DISCONNECTED');
  if(!result&&page.url()!==ONDA_URL)result=classified('UNEXPECTED_REDIRECT','UNEXPECTED_NAVIGATION');
  let state:{readyState:string;hasBody:boolean;security?:string}|undefined;
  if(!result){
    try{state=await page.evaluate(()=>({readyState:document.readyState,hasBody:!!document.body,bodyText:document.body?.innerText??''})).then(v=>({readyState:v.readyState,hasBody:v.hasBody,security:securityReason(v.bodyText)}));}
    catch{if(page.isClosed())result=classified('CHROME_DISCONNECTED','BROWSER_DISCONNECTED');}
  }
  if(!result&&state?.security)result=knownReleaseFailure(state.security);
  if(!result&&httpStatus!==undefined&&httpStatus>=400)result=classified('RELEASE_HTTP_STATUS','HTTP_ERROR_STATUS');
  const timeoutError=error instanceof Error&&(error.name==='TimeoutError'||/timeout/i.test(error.name));
  if(!result&&timeoutError){
    if(stage==='WAIT_FOR_VENUE_ATTACHED')result=state?.readyState==='complete'&&state.hasBody?classified('RELEASE_VENUE_ELEMENT_MISSING','MISSING_VENUE_ELEMENT'):classified('RELEASE_PAGE_LOAD_TIMEOUT','PAGE_LOADING_TIMEOUT');
    else if(stage==='WAIT_FOR_VENUE_VISIBLE')result=classified('RELEASE_VENUE_NOT_VISIBLE','VENUE_NOT_VISIBLE');
    else if(stage==='WAIT_FOR_DATE_PICKER_ATTACHED')result=classified('RELEASE_DATE_PICKER_MISSING','MISSING_DATE_PICKER');
    else if(stage==='WAIT_FOR_DATE_PICKER_VISIBLE')result=classified('RELEASE_DATE_PICKER_NOT_VISIBLE','DATE_PICKER_NOT_VISIBLE');
    else if(stage==='WAIT_FOR_DATE_PICKER_ENABLED')result=classified('RELEASE_DATE_PICKER_NOT_READY','DATE_PICKER_NOT_READY');
    else result=classified('RELEASE_PAGE_LOAD_TIMEOUT','PAGE_LOADING_TIMEOUT');
  }
  if(!result)result=classified('RELEASE_SHELL_UNCLASSIFIED','UNCLASSIFIED');
  t?.recordReleaseFailure(stage,result.code,result.classification,httpStatus);
  return new ReleaseShellFailure(result.code,result.classification==='PAGE_LOADING_TIMEOUT',error);
}
export async function waitForBookingShellForRelease(page: Page, safety: Safety, timeout: number, t?: Pick<Telemetry, 'mark'|'recordReleaseFailure'>, navigation?:{httpStatus?:number}) {
  try{safety.check();if(page.url()!==ONDA_URL)throw Error('WRONG_URL');}
  catch(error){throw await shellFailure(page,safety,t,'VERIFY_RELEASE_SHELL',error,navigation?.httpStatus);}
  if(navigation?.httpStatus!==undefined&&navigation.httpStatus>=400)throw await shellFailure(page,safety,t,'VERIFY_RELEASE_SHELL',Error('HTTP_STATUS'),navigation.httpStatus);
  t?.mark('releaseUrlVerified');
  const venue = page.getByTestId('public-booking-hero-title');
  try{await venue.waitFor({ state: 'attached', timeout });}catch(error){throw await shellFailure(page,safety,t,'WAIT_FOR_VENUE_ATTACHED',error,navigation?.httpStatus);}t?.mark('releaseVenueAttached');
  try{await venue.waitFor({ state: 'visible', timeout });}catch(error){throw await shellFailure(page,safety,t,'WAIT_FOR_VENUE_VISIBLE',error,navigation?.httpStatus);}
  t?.mark('releaseVenueVisible');
  if ((await venue.innerText()).trim() !== VENUE){t?.recordReleaseFailure('VERIFY_VENUE','WRONG_VENUE','WRONG_VENUE',navigation?.httpStatus);throw Error('WRONG_VENUE');}
  t?.mark('releaseVenueVerified');
  const picker = page.getByRole('button', { name: 'Select booking date', exact: true, includeHidden: true });
  try{await picker.waitFor({ state: 'attached', timeout });}catch(error){throw await shellFailure(page,safety,t,'WAIT_FOR_DATE_PICKER_ATTACHED',error,navigation?.httpStatus);}t?.mark('releasePickerAttached');
  if (await picker.count() !== 1){t?.recordReleaseFailure('VERIFY_DATE_PICKER','RELEASE_DATE_PICKER_MISSING','MISSING_DATE_PICKER',navigation?.httpStatus);throw Error('RELEASE_DATE_PICKER_MISSING');}
  try{await picker.waitFor({ state: 'visible', timeout });}catch(error){throw await shellFailure(page,safety,t,'WAIT_FOR_DATE_PICKER_VISIBLE',error,navigation?.httpStatus);}t?.mark('releasePickerVisible');
  // Wait only for enabled semantics, never stability or hit-target actionability.
  const handle = await picker.elementHandle();
  if (!handle){t?.recordReleaseFailure('VERIFY_DATE_PICKER','RELEASE_DATE_PICKER_MISSING','MISSING_DATE_PICKER',navigation?.httpStatus);throw Error('RELEASE_DATE_PICKER_MISSING');}
  try {
    try{await page.waitForFunction(e => e.isConnected && !e.matches(':disabled') &&
      !e.closest('[aria-disabled="true"]'), handle, { timeout, polling: 'raf' });}
    catch(error){throw await shellFailure(page,safety,t,'WAIT_FOR_DATE_PICKER_ENABLED',error,navigation?.httpStatus);}
  } finally { await handle.dispose(); }
  if (await picker.count() !== 1 || !await picker.isVisible() || !await picker.isEnabled()){t?.recordReleaseFailure('VERIFY_DATE_PICKER','RELEASE_DATE_PICKER_NOT_READY','DATE_PICKER_NOT_READY',navigation?.httpStatus);throw Error('RELEASE_DATE_PICKER_NOT_READY');}
  t?.mark('releasePickerEnabled');
  try{await guardReleaseShell(page, safety);}catch(error){throw await shellFailure(page,safety,t,'VERIFY_RELEASE_SHELL',error,navigation?.httpStatus);}
  t?.mark('releaseShellReady');
}

export async function preopenReleaseCalendar(page: Page, target: ReleaseTarget, safety: Safety, t: Telemetry, timeout: number, expectDisabled: boolean) {
  t.mark('preopenPreparationStarted');
  await guardReleaseShell(page, safety);
  const before = await snapshot(page);
  const picker = page.getByRole('button', { name: 'Select booking date', exact: true });
  if (await picker.getAttribute('aria-expanded') !== 'true') { safety.check(); await picker.click({ timeout }); }
  const day = page.locator(target.daySelector);
  await day.waitFor({ state: 'visible', timeout });
  if (await day.count() !== 1) throw Error('TARGET_DATE_STRUCTURE_CHANGED');
  t.mark('preopenTargetDetected');
  const enabled = await day.isEnabled();
  if (expectDisabled && enabled) throw Error('TARGET_DATE_ALREADY_RELEASED');
  await guardReleaseShell(page, safety);
  if (JSON.stringify(await snapshot(page)) !== JSON.stringify(before)) throw Error('PREOPEN_BOOKING_STATE_CHANGED');
  if (await picker.getAttribute('aria-expanded') !== 'true') throw Error('PREOPEN_CALENDAR_CLOSED');
  t.mark(enabled ? 'preopenTargetEnabled' : 'preopenTargetDisabled');
  t.mark('releaseCalendarPreopened');
  t.mark('preopenCalendarLeftOpen');
}

// Exactly one DOM evaluation: no locator waits, polling, requests or recovery clicks.
export async function observePreopenedTarget(page: Page, target: ReleaseTarget, safety: Safety) {
  safety.check();
  if (page.url() !== ONDA_URL) throw Error('WRONG_URL');
  const result = await page.evaluate(selector => {
    const days = document.querySelectorAll<HTMLButtonElement>(selector);
    const day = days[0];
    return { enabled: days.length === 1 && !!day &&
      day.checkVisibility() && !day.matches(':disabled') && !day.closest('[aria-disabled="true"]') };
  }, target.daySelector);
  safety.check();
  return result.enabled;
}

export async function clickReleasedTargetDate(page: Page, target: ReleaseTarget, safety: Safety, t: Telemetry, timeout: number) {
  const picker = page.getByRole('button', { name: 'Select booking date', exact: true });
  const day = page.locator(target.daySelector);
  safety.check(); t.mark('targetDateEnabled'); t.mark('targetDateClickStarted');
  await day.click({ timeout });
  safety.check(); t.mark('targetDateClicked');
  await page.waitForFunction(({ selector, heading }) => {
    const labels = document.querySelectorAll(selector);
    return labels.length === 1 && labels[0]!.textContent?.trim() === heading;
  }, { selector: selectors.heading, heading: target.heading }, { timeout, polling: 'raf' });
  safety.check(); t.mark('targetHeadingDetected');
  await waitForGrid(page, target.date, safety, timeout, target.heading);
  safety.check();t.mark('targetGridReady');t.mark('gridSnapshotStarted');
  const validated=await snapshot(page);validateSnapshot(validated, target.date);t.mark('gridSnapshotCompleted');
  safety.check();
  if (await picker.getAttribute('aria-expanded') === 'true') {
    safety.check(); await picker.click({ timeout });
  }
  safety.check(); return validated;
}
export async function navigateReleasedTargetDate(page: Page, target: ReleaseTarget, safety: Safety, t: Telemetry, timeout: number) {
  await guardReleaseShell(page, safety);
  const picker = page.getByRole('button', { name: 'Select booking date', exact: true });
  if (await picker.getAttribute('aria-expanded') !== 'true') {
    safety.check(); await picker.click({ timeout });
  }
  safety.check(); t.mark('targetPickerOpened');
  const day = page.locator(target.daySelector);
  // Allow calendar hydration; a missing/ambiguous day is a structure error,
  // whereas a present, disabled day is the only normal release retry signal.
  try { await day.waitFor({ state: 'visible', timeout }); }
  catch { safety.check(); await guardReleaseShell(page, safety); throw Error('TARGET_DATE_STRUCTURE_CHANGED'); }
  await guardReleaseShell(page, safety);
  t.mark('targetDateDetected');
  if (!await day.isEnabled()) {
    safety.check(); t.mark('targetDateNotReleased'); return 'TARGET_DATE_NOT_RELEASED' as const;
  }
  return clickReleasedTargetDate(page, target, safety, t, timeout);
}
