import type { Page } from 'playwright';
import { join } from 'node:path';
import { launchObserverChrome } from '../observer-chrome.js';
import { OndaBrowserAvailabilityProvider } from './browser-availability-provider.js';
import { parseAvailability } from './availability-parser.js';
import { COURT_REGISTRY, type Wing } from '../court-registry.js';
import { LiveAvailabilityError } from './live-availability-provider.js';
import { releaseInstantFor, WING_RELEASE_POLICIES } from '../wing-release-data.js';

/**
 * One-click read-only availability. The checker owns a dedicated guest Chrome profile and process; it never attaches to
 * a checkout worker, never resolves a customer, never acquires checkout security and never borrows credentials. All
 * non-GET requests and service workers are blocked. It reads the public date-availability endpoint with the page's own
 * same-origin session exactly as the official site does, in a small dedicated window that closes after the check.
 */
export type CellState = 'OPEN' | 'BLOCKED' | 'UNRELEASED' | 'UNKNOWN';
export interface ObservedCell { wing: Wing; court: number; start: string; state: CellState; available: boolean; price: number | null }
export interface WingRead { wing: Wing; status: 'OK' | 'UNRELEASED' | 'ERROR'; capturedAt?: string; code?: string; cells: number; httpStatus?:number; requestSent?:boolean }
export interface AvailabilityCheck { date: string; capturedAt: string; observer: 'headless' | 'window'; cells: ObservedCell[]; wings: WingRead[] }
const HOURS = Array.from({ length: 16 }, (_, index) => `${String(8 + index).padStart(2, '0')}:00`);
const safeCode = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : 'AVAILABILITY_READ_FAILED';

/** Every registered court/hour gets an explicit state. Missing data is UNKNOWN, never open. */
export function cellsFromSnapshot(wing: Wing, date: string, snapshot: { slots: ReadonlyArray<{ court: number; date: string; startTime: string; isAvailable: boolean; price?: number }>; emptyUnreleasedResponse?: boolean } | null): ObservedCell[] {
  const courts = COURT_REGISTRY.filter(c => c.wing === wing).map(c => c.number);
  return courts.flatMap(court => HOURS.map(start => {
    if (!snapshot) return { wing, court, start, state: 'UNKNOWN' as const, available: false, price: null };
    if (snapshot.emptyUnreleasedResponse) return { wing, court, start, state: 'UNRELEASED' as const, available: false, price: null };
    const slot = snapshot.slots.find(s => s.date === date && s.court === court && s.startTime === start);
    if (!slot) return { wing, court, start, state: 'UNKNOWN' as const, available: false, price: null };
    return { wing, court, start, state: slot.isAvailable ? 'OPEN' as const : 'BLOCKED' as const, available: slot.isAvailable, price: typeof slot.price === 'number' ? slot.price : null };
  }));
}

/** A complete closed grid before a verified release is not evidence that every court is booked. */
export function applyReleaseWindow(cells: ObservedCell[], wing: Wing, date: string, capturedAt: string): ObservedCell[] {
  const expected=COURT_REGISTRY.filter(c=>c.wing===wing).length*HOURS.length;
  if(WING_RELEASE_POLICIES[wing]?.status==='VERIFIED'&&Number.isFinite(Date.parse(capturedAt))
    &&releaseInstantFor(date,wing)>Date.parse(capturedAt)&&cells.length===expected&&cells.every(c=>c.state==='BLOCKED'))
    return cells.map(c=>({...c,state:'UNRELEASED',available:false}));
  return cells;
}

async function readWing(page: Page, wing: Wing, date: string) {
  let headers=new Headers();
  const provider = new OndaBrowserAvailabilityProvider(page, { wing, allowIncompleteRange: true, timeoutMs: 15_000,onHeaders:value=>{headers=value;} });
  const envelope = await provider.getAvailability({ startDate: date, endDate: date });
  const age=headers.get('age');
  if(age&&/^\d+$/.test(age)&&Number(age)>15)throw new LiveAvailabilityError('AVAILABILITY_STALE',200,true);
  return { capturedAt: envelope.capturedAt, snapshot: parseAvailability(envelope.raw, { wing, startDate: date, endDate: date, capturedAt: envelope.capturedAt, fixtureKind: envelope.fixtureKind,
    label: 'DEDICATED READ-ONLY OBSERVER', now: new Date(), maximumAgeMs: 15_000, requireCompleteRange: false }) };
}

export async function checkAvailability(date: string, options: { directory: string; isAborted?: () => boolean; onPhase?: (phase: string) => void;
  open?: () => Promise<{ page: Page; close: () => Promise<void> }> }): Promise<AvailabilityCheck> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('AVAILABILITY_DATE_INVALID');
  options.onPhase?.('Starting the dedicated read-only availability observer (small Chrome window; headless is refused by the site)');
  const session = await (options.open ?? (() => launchObserverChrome(join(options.directory, 'observer-chrome-profile'))))();
  try {
    const wings: WingRead[] = [], cells: ObservedCell[] = [];
    let refusal:LiveAvailabilityError|undefined;
    for (const wing of ['MANGO', 'BUKO'] as const) {
      if (options.isAborted?.()) throw Error('USER_ABORT');
      try {
        if(refusal)throw new LiveAvailabilityError(refusal.code,refusal.httpStatus,false,refusal.retryAfterMs);
        const read = await readWing(session.page, wing, date);
        const observed=applyReleaseWindow(cellsFromSnapshot(wing,date,read.snapshot),wing,date,read.capturedAt);
        const unreleased=observed.every(c=>c.state==='UNRELEASED');
        wings.push({ wing, status: unreleased ? 'UNRELEASED' : 'OK', capturedAt: read.capturedAt, cells: read.snapshot.slots.length,
          ...(unreleased&&!read.snapshot.emptyUnreleasedResponse?{code:'VERIFIED_RELEASE_NOT_REACHED'}:{}) });
        cells.push(...observed);
      } catch (error) {
        if(error instanceof LiveAvailabilityError&&[401,403,429].includes(error.httpStatus??0))refusal=error;
        wings.push({ wing, status: 'ERROR', code: safeCode(error), cells: 0,
          ...(error instanceof LiveAvailabilityError?{httpStatus:error.httpStatus,requestSent:error.requestSent}:{}) });
        cells.push(...cellsFromSnapshot(wing, date, null));
      }
    }
    const times = wings.flatMap(w => w.capturedAt ? [Date.parse(w.capturedAt)] : []);
    // Freshness is the OLDEST wing read, so a cell is never presented as fresher than its evidence.
    return { date, capturedAt: new Date(times.length ? Math.min(...times) : Date.now()).toISOString(), observer: 'window', cells, wings };
  } finally { await session.close(); }
}
