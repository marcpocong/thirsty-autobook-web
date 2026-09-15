import type { Page } from 'playwright';
import { expandHours, ONDA_URL, type Preference } from './config.js';
import { snapshot, validateSnapshot, resolvePreference, selectors, type Snapshot, type Cell } from './grid.js';
import { assertPage } from './browser.js';
import { Safety } from './safety.js';
import { Telemetry } from './telemetry.js';
import type { CandidateDiscovery } from './availability-discovery.js';

export interface SelectionSummary { count: string; amount: string; actionable: boolean }
export interface SelectionPort {
  guard(): Promise<void>;
  lightGuard?():Promise<void>;
  read(): Promise<Snapshot>;
  click(date: string, court: number, hour: string, state: 'OPEN' | 'SELECTED'): Promise<void>;
  summary(): Promise<SelectionSummary>;
}
export interface SelectionResult { groups?:{court:number;hours:string[]}[]; date: string; court: number; hours: string[]; amount: number; proceedReady: true; attempts: number }
export function installSelectionSecuritySentinel(){
  const w=window as typeof window&{__thirstyGuard?:{reason?:string;observer:MutationObserver}};
  w.__thirstyGuard?.observer.disconnect();
  const state:{reason?:string;observer:MutationObserver}={observer:null as unknown as MutationObserver};
  const scan=()=>{const text=document.body?.innerText??'';state.reason=/too many requests|rate.?limit|retry.after|\b429\b/i.test(text)?'RATE_LIMITED':/captcha|verify (?:that )?you are human|checking your browser|access denied|automated access.*(?:blocked|prohibited)|automation.*(?:blocked|prohibited)|security challenge/i.test(text)?'SECURITY_CHALLENGE':undefined;};
  scan();state.observer=new MutationObserver(scan);state.observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});w.__thirstyGuard=state;
}
export function readSelectionSecuritySentinel(){
  const g=(window as typeof window&{__thirstyGuard?:{reason?:string}}).__thirstyGuard;
  return {installed:!!g,visible:document.visibilityState==='visible',reason:g?.reason,grid:document.querySelectorAll('[data-testid="booking-grid-body"]').length};
}
export function selectionPort(page: Page, safety: Safety): SelectionPort {
  return {
    guard: async () => {
      await assertPage(page,safety);
      if(await page.evaluate(()=>document.visibilityState)!=='visible')throw new Error('TAB_NOT_VISIBLE');
      await page.evaluate(installSelectionSecuritySentinel);
      safety.check();
    },
    lightGuard:async()=>{
      safety.check();
      const state=await page.evaluate(readSelectionSecuritySentinel);
      // Offline DOM fixtures replace the full guard and therefore have no
      // sentinel. Production always installs it in guard() before this path.
      if(state.installed&&page.url()!==ONDA_URL)throw Error('WRONG_URL');
      if(state.reason)safety.stop(state.reason);safety.check();if(!state.visible)throw Error('TAB_NOT_VISIBLE');if(state.grid!==1)throw Error('GRID_UNVERIFIED');
    }, read: () => snapshot(page),
    async click(date, court, hour, state) {
      safety.check();
      const base = page.locator(`${selectors.row}[data-schedule-grid-row-date="${date}"][data-schedule-grid-row-time="${hour}"] ${selectors.cell}[aria-label^="Court ${court}:"]`);
      const cell = base.filter({ has: page.locator(`[data-slot-state="${state === 'OPEN' ? 'available' : 'selected'}"]`) });
      // A disappeared/disabled candidate is a conflict, never a forced click.
      await cell.click({ timeout: 5000 });
      safety.check();
      await base.locator(`[data-slot-state="${state === 'OPEN' ? 'selected' : 'available'}"]`).waitFor({ state: 'attached', timeout: 1500 });
      safety.check();
    },
    async summary() {
      safety.check();
      const sheet = page.getByTestId('booking-selection-summary-sheet');
      return sheet.evaluate(e => ({ count: e.querySelector('[data-testid="booking-selection-summary-count"]')?.textContent?.trim() ?? '',
        amount: e.querySelector('[data-testid="booking-selection-summary-amount"]')?.textContent?.trim() ?? '',
        actionable: (() => { const b=e.querySelector<HTMLButtonElement>('[data-testid="booking-selection-summary-proceed-button"]'); return !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && b.getClientRects().length > 0; })() }));
    },
  };
}
export function selectionAmount(summary: SelectionSummary, duration: number, maxPrice: number, courtCount = 1) {
  if (!new RegExp(`^${courtCount} Court${courtCount === 1 ? '' : 's'}\\s*•\\s*${duration} Slots?$`).test(summary.count)) throw new Error('SELECTION_SUMMARY_MISMATCH');
  if (!/^(?:₱|PHP)\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?$/.test(summary.amount)) throw new Error('SELECTION_AMOUNT_UNKNOWN');
  const amount = Number(summary.amount.replace(/^(?:₱|PHP)\s*/, '').replaceAll(',', ''));
  if (!Number.isFinite(amount) || amount <= 0 || amount > maxPrice) throw new Error('SELECTION_PRICE_MISMATCH');
  return amount;
}
const key = (p: Preference) => `${p.court}:${p.hours.join(',')}`;
function known(cells: Cell[]) { if (cells.some(c => c.state === 'UNKNOWN')) throw new Error('SELECTION_STATE_UNKNOWN'); }
function intended(c: Cell, p: Preference) { return c.court === p.court && p.hours.includes(c.hour); }
function validatePreference(p: Preference) {
  if (!Number.isInteger(p.court) || p.court < 1 || p.court > 7 || !p.hours.length || Number(p.hours[0]!.slice(0,2)) < 8 || JSON.stringify(expandHours(p.hours[0]!, p.hours.length)) !== JSON.stringify(p.hours)) throw new Error('INVALID_PREFERENCE');
}
// The initial snapshot is the exact validated release snapshot; subsequent reads occur only
// to verify clicks or resolve a bounded conflict. This function never invokes Proceed.
export async function selectResolvedPreference(port: SelectionPort, targetDate: string, initial: Snapshot, preferences: Preference[], maximumPrice: number, maximumAttempts: number, safety: Safety, t: Telemetry, discovery?: CandidateDiscovery): Promise<SelectionResult> {
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 5 || !Number.isFinite(maximumPrice) || maximumPrice <= 0) throw new Error('INVALID_SELECTION_LIMIT');
  preferences.forEach(validatePreference);
  let cells = validateSnapshot(initial, targetDate);
  known(cells);
  if (cells.some(c => c.state === 'SELECTED')) throw new Error('PREEXISTING_SELECTION');
  const attempted = new Set<string>();
  for (let attempt=1; attempt<=maximumAttempts; attempt++) {
    safety.fallback();
    const untried = preferences.filter(p => !attempted.has(key(p)));
    const p = resolvePreference(cells, discovery?.rank(cells, untried) ?? untried);
    if (!p) throw new Error('NO_AVAILABLE_PREFERENCE');
    attempted.add(key(p)); t.mark(attempt === 1 ? 'preferenceResolved' : 'fallbackResolved');
    await port.guard();t.mark('fullGuardCompleted'); safety.check(); t.mark('selectionAttemptStarted', attempt);
    await safety.stage('SELECTION');
    const dispatched = new Set<string>();
    let conflict = false;
    for (const [i,hour] of p.hours.entries()) {
      await (port.lightGuard?.()??Promise.resolve());t.mark('lightGuardCompleted');safety.check(); t.mark(`slot${i+1}ClickStarted`); dispatched.add(hour);
      try { await port.click(targetDate, p.court, hour, 'OPEN'); }
      catch { safety.check(); conflict = true; break; }
      safety.check();
      // click() already waits for this exact cell's OPEN -> SELECTED state.
      t.mark(`slot${i+1}StateConfirmed`);
    }
    safety.check(); await port.guard();t.mark('fullGuardCompleted'); safety.check();
    t.mark('selectionFinalVerificationStarted');
    t.mark('selectionFinalGridRead');t.mark('selectionFullGridRead');cells = validateSnapshot(await port.read(), targetDate); safety.check(); known(cells);
    let selected = cells.filter(c => c.state === 'SELECTED');
    if (selected.some(c => !intended(c,p) || !dispatched.has(c.hour))) throw new Error('UNOWNED_SELECTION');
    if (!conflict && selected.length === p.hours.length) {
      t.mark('selectionSummaryRead');const summary = await port.summary(); safety.check();
      const amount = selectionAmount(summary, p.hours.length, maximumPrice);
      if (summary.actionable) {
        safety.lock(); await safety.stage('SELECTION_VERIFIED'); t.mark('selectionFinalVerificationCompleted');t.mark('selectionVerified'); t.mark('proceedActionable');
        return { date: targetDate, court: p.court, hours: p.hours, amount, proceedReady: true, attempts: attempt };
      }
    }
    t.mark('selectionConflict'); safety.fallback();
    // Cleanup only our positively identified selected subset on a still-valid grid.
    // Abort, unknown cells, changed dates, foreign selection and price mismatches never clean up.
    for (const cell of selected) {
      await port.guard(); safety.check();
      t.mark('selectionFullGridRead');cells = validateSnapshot(await port.read(), targetDate); safety.check(); known(cells);
      if (cells.filter(c => c.state === 'SELECTED').some(c => !intended(c,p) || !dispatched.has(c.hour))) throw new Error('UNOWNED_SELECTION');
      if (cells.find(c => c.court === cell.court && c.hour === cell.hour)?.state !== 'SELECTED') throw new Error('CLEANUP_STATE_CHANGED');
      await port.click(targetDate, cell.court, cell.hour, 'SELECTED'); safety.check();
    }
    t.mark('selectionFullGridRead');cells = validateSnapshot(await port.read(), targetDate); safety.check(); known(cells);
    selected = cells.filter(c => c.state === 'SELECTED');
    if (selected.length) throw new Error('CLEANUP_NOT_VERIFIED');
    t.mark('selectionCleanupVerified');
    if (discovery && attempt < maximumAttempts) {
      discovery.refresh();
      // Re-read UI after verified cleanup; never wait for the optional refresh response.
      await port.guard(); safety.check();
      t.mark('selectionFullGridRead');cells = validateSnapshot(await port.read(), targetDate); safety.check(); known(cells);
      if (cells.some(c => c.state === 'SELECTED')) throw Error('UNOWNED_SELECTION');
    }
  }
  throw new Error('SELECTION_ATTEMPTS_EXHAUSTED');
}
