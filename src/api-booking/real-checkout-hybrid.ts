import type { Page } from 'playwright';
import { DateTime } from 'luxon';
import { ONDA_URL, VENUE } from '../config.js';
import { parseCell, selectors, snapshot, waitForGrid, type Snapshot } from '../grid.js';
import { selectionAmount, selectionPort, type SelectionResult } from '../selection.js';
import { ondaCheckoutAdapter } from '../onda-checkout.js';
import { checkout, type Player } from '../checkout.js';
import { Safety, securityReason } from '../safety.js';
import { Telemetry } from '../telemetry.js';
import type { BookingPlan } from './types.js';
import { watchCheckoutMilestones, readCheckoutMilestones } from './checkout-milestones.js';

export interface HybridDryRunResult {
  selection: SelectionResult;
  fullGridReadyAtTarget: boolean;
  elapsedMs: { apiReady: number; pageUsable: number; pickerEnabled: number | null; dateClicked: number | null; targetReady: number;
    targetCellsOpen: number | null; fullGridRendered: number | null; fullGridReady: number | null;
    reviewBooking: number | null; paymentSummary: number };
  barrier: 'target' | 'full-grid';
  checkoutPostBlocked: true;
}

export function validateTargetSnapshot(value: Snapshot, plan: BookingPlan): { fullGridReady: boolean } {
  const date = DateTime.fromISO(plan.targetDate, { zone: 'Asia/Manila' });
  const court = plan.courts[0];
  if (!date.isValid || plan.mode !== 'standard' || plan.chunks.length !== 1 || plan.courts.length !== 1 ||
    !court || court.slots.length !== plan.durationHours || plan.durationHours < 1 || plan.durationHours > 3 ||
    court.date !== plan.targetDate || court.price !== plan.totalPrice || plan.currency !== 'PHP' ||
    plan.startTime !== court.slots[0]?.startTime || plan.endTime !== court.slots.at(-1)?.endTime ||
    court.slots.some((slot, index) => !slot.isAvailable || slot.date !== plan.targetDate ||
      slot.bookingDate !== plan.targetDate || slot.court !== court.court || slot.spaceId !== court.spaceId ||
      slot.currency !== 'PHP' || (index > 0 && court.slots[index - 1]?.endTime !== slot.startTime)) ||
    court.slots.reduce((sum, slot) => sum + slot.price, 0) !== plan.totalPrice)
    throw Error('HYBRID_PLAN_UNSUPPORTED');
  if (value.heading !== date.setLocale('en').toFormat('ccc, LLLL d') || value.busy ||
    value.rows.some(row => row.date !== plan.targetDate)) throw Error('HYBRID_TARGET_NOT_READY');
  const cells = value.cells.map(parseCell);
  if (cells.some(cell => cell.state === 'SELECTED')) throw Error('HYBRID_PREEXISTING_SELECTION');
  for (const slot of court.slots) {
    const matches = cells.filter(cell => cell.court === court.court && cell.hour === slot.startTime &&
      cell.date === plan.targetDate);
    if (matches.some(cell => cell.state === 'UNKNOWN')) throw Error('HYBRID_CELL_UNKNOWN');
    if (matches.length !== 1 || matches[0]!.state !== 'OPEN') throw Error('HYBRID_TARGET_NOT_READY');
  }
  const fullGridReady = value.rows.length === 16 && value.cells.length === 112 &&
    value.rows.every(row => value.cells.filter(cell => cell.hour === row.hour && cell.date === row.date).length === 7);
  return { fullGridReady };
}

function validateSelectedSnapshot(value: Snapshot, plan: BookingPlan): void {
  const heading = DateTime.fromISO(plan.targetDate, { zone: 'Asia/Manila' }).setLocale('en').toFormat('ccc, LLLL d');
  if (value.busy || value.heading !== heading || value.rows.some(row => row.date !== plan.targetDate))
    throw Error('HYBRID_SELECTION_CHANGED');
  const cells = value.cells.map(parseCell);
  const selected = cells.filter(cell => cell.state === 'SELECTED');
  const court = plan.courts[0]!;
  if (court.slots.some(slot => cells.some(cell => cell.court === court.court && cell.hour === slot.startTime &&
    cell.date === plan.targetDate && cell.state === 'UNKNOWN'))) throw Error('HYBRID_CELL_UNKNOWN');
  if (selected.length !== court.slots.length || selected.some(cell => cell.court !== court.court ||
    !court.slots.some(slot => slot.startTime === cell.hour))) throw Error('HYBRID_SELECTION_CHANGED');
}

/** One-court API plan into Onda's own Review and Payment Summary. Stops before Terms and final action. */
export async function runRealCheckoutHybridDryRun(page: Page, plan: BookingPlan, player: Player,
  apiReadyMs: number, startedAt: number, maximumPrice: number,
  barrier: 'target' | 'full-grid' = 'target'): Promise<HybridDryRunResult> {
  if (page.url() !== ONDA_URL) throw Error('HYBRID_WRONG_URL');
  const safety = new Safety();
  const telemetry = new Telemetry();
  let blockedCheckoutPost = false;
  const blockCheckout = async (route: import('playwright').Route) => {
    if (route.request().method() === 'POST') { blockedCheckoutPost = true; await route.abort(); }
    else await route.continue();
  };
  await page.route('**/api/bookings/public-checkout', blockCheckout);
  await page.route('**/api/public/bookings', blockCheckout);
  try {
    await page.getByTestId('public-booking-hero-title').waitFor({ state: 'visible', timeout: 30_000 });
    if ((await page.getByTestId('public-booking-hero-title').innerText()).trim() !== VENUE) throw Error('HYBRID_WRONG_VENUE');
    const pageUsable = Date.now() - startedAt;
    const picker = page.getByRole('button', { name: 'Select booking date', exact: true });
    await picker.waitFor({ state: 'visible', timeout: 15_000 });
    await watchCheckoutMilestones(page, plan);
    const heading = DateTime.fromISO(plan.targetDate, { zone: 'Asia/Manila' }).setLocale('en').toFormat('ccc, LLLL d');
    const currentHeading = (await page.locator(selectors.heading).textContent())?.trim();
    let dateClicked: number | null = null;
    if (currentHeading !== heading) {
      await picker.click();
      const day = page.locator(`button[data-day="${DateTime.fromISO(plan.targetDate).toFormat('M/d/yyyy')}"]`);
      await day.waitFor({ state: 'visible', timeout: 15_000 });
      if (await day.count() !== 1 || !await day.isEnabled()) throw Error('HYBRID_DATE_UNAVAILABLE');
      await day.click();
      dateClicked = Date.now() - startedAt;
    }
    const targetArgs = JSON.stringify({ heading, date: plan.targetDate, court: plan.courts[0]!.court,
      hours: plan.courts[0]!.slots.map(slot => slot.startTime) });
    await page.waitForFunction(`(() => { const { heading, date, court, hours } = ${targetArgs};
      if (document.querySelector('[aria-busy="true"]') || document.querySelector('[data-testid="booking-selected-date-label"]')?.textContent?.trim() !== heading) return false;
      const rows = [...document.querySelectorAll('[data-schedule-grid-row-date][data-schedule-grid-row-time]')];
      if (rows.some(row => row.getAttribute('data-schedule-grid-row-date') !== date)) return false;
      return hours.every(hour => {
        const row = rows.find(row => row.getAttribute('data-schedule-grid-row-time') === hour);
        const cells = [...(row?.querySelectorAll('[data-testid="court-schedule-slot-cell"]') ?? [])]
          .filter(cell => cell.getAttribute('aria-label')?.startsWith('Court ' + court + ':'));
        return cells.length === 1 && cells[0]?.querySelector('[data-slot-state]')?.getAttribute('data-slot-state') === 'available' &&
          !cells[0].disabled && cells[0]?.getAttribute('aria-disabled') !== 'true';
      });
    })()`, undefined, { timeout: 30_000, polling: 'raf' }).catch(error => {
      throw Error('HYBRID_TARGET_TIMEOUT', { cause: error });
    });
    const targetReady = Date.now() - startedAt;
    if (barrier === 'full-grid') await waitForGrid(page, plan.targetDate, safety, 30_000, heading);
    if (page.url() !== ONDA_URL || securityReason(await page.locator('body').innerText())) throw Error('HYBRID_PAGE_UNSAFE');
    const initial = await snapshot(page);
    const { fullGridReady } = validateTargetSnapshot(initial, plan);
    if (await picker.getAttribute('aria-expanded') === 'true') await picker.click();
    const port = selectionPort(page, safety);
    await port.guard();
    for (const slot of plan.courts[0]!.slots) {
      await port.lightGuard?.();
      await port.click(plan.targetDate, plan.courts[0]!.court, slot.startTime, 'OPEN');
    }
    validateSelectedSnapshot(await snapshot(page), plan);
    const summary = await port.summary();
    const amount = selectionAmount(summary, plan.durationHours, maximumPrice);
    if (!summary.actionable || amount !== plan.totalPrice) throw Error('HYBRID_PRICE_OR_SUMMARY_MISMATCH');
    const selected: SelectionResult = { date: plan.targetDate, court: plan.courts[0]!.court,
      hours: plan.courts[0]!.slots.map(slot => slot.startTime), amount, proceedReady: true, attempts: 1 };
    const expected = { venue: VENUE, date: selected.date, court: selected.court,
      start: plan.startTime, end: plan.endTime, duration: plan.durationHours, amount,
      currency: 'PHP' };
    await page.getByTestId('booking-selection-summary-proceed-button').click();
    const outcome = await checkout(ondaCheckoutAdapter(page, safety, expected, telemetry), safety,
      telemetry, expected, player, maximumPrice, false);
    if (outcome !== 'TERMS_NOT_AUTHORIZED' || blockedCheckoutPost) throw Error('HYBRID_DRY_RUN_BOUNDARY_FAILED');
    const reviewEvent = telemetry.events.find(event => event.event === 'reviewDetected');
    const milestones = await readCheckoutMilestones(page, startedAt);
    return { selection: selected, fullGridReadyAtTarget: fullGridReady, barrier,
      elapsedMs: { apiReady: apiReadyMs, pageUsable, pickerEnabled: milestones.pickerEnabled, dateClicked, targetReady,
        targetCellsOpen: milestones.targetCellsOpen, fullGridRendered: milestones.fullGridRendered,
        fullGridReady: milestones.fullGridReady,
        reviewBooking: reviewEvent ? Math.max(0, Date.parse(reviewEvent.wall) - startedAt) : null,
        paymentSummary: Date.now() - startedAt },
      checkoutPostBlocked: true };
  } finally { /* Keep dry-run POST guards active while the visible browser remains open. */ }
}
