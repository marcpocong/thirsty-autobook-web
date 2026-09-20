import type { Page } from 'playwright';
import type { BookingPlan } from './types.js';

export interface CheckoutMilestones { pickerEnabled: number | null; targetCellsOpen: number | null;
  fullGridRendered: number | null; targetActionable: number | null; fullGridReady: number | null }

/** Watches Onda's rendered state without changing controls or booking data. */
export async function watchCheckoutMilestones(page: Page, plan: BookingPlan): Promise<void> {
  const target = JSON.stringify({ date: plan.targetDate, court: plan.courts[0]!.court,
    hours: plan.courts[0]!.slots.map(slot => slot.startTime) });
  await page.evaluate(`(() => {
    const target = ${target};
    const previous = window.__thirstyCheckoutMilestones;
    if (previous) { previous.observer.disconnect(); clearInterval(previous.timer); }
    const state = { pickerEnabled: null, targetCellsOpen: null, fullGridRendered: null,
      targetActionable: null, fullGridReady: null,
      observer: null, timer: null };
    const scan = () => {
      const now = performance.timeOrigin + performance.now();
      const picker = [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'Select booking date');
      if (state.pickerEnabled === null && picker && picker.checkVisibility() && !picker.disabled &&
          picker.getAttribute('aria-disabled') !== 'true') state.pickerEnabled = now;
      const heading = document.querySelector('[data-testid="booking-selected-date-label"]')?.textContent?.trim();
      const grid = document.querySelector('[data-testid="booking-grid-body"]');
      if (!grid || !heading) return;
      const rows = [...grid.querySelectorAll('[data-schedule-grid-row-date][data-schedule-grid-row-time]')];
      if (!rows.length || rows.some(row => row.getAttribute('data-schedule-grid-row-date') !== target.date)) return;
      const cells = [...grid.querySelectorAll('[data-testid="court-schedule-slot-cell"]')];
      const targetOpen = target.hours.every(hour => {
        const row = rows.find(value => value.getAttribute('data-schedule-grid-row-time') === hour);
        const matches = [...(row?.querySelectorAll('[data-testid="court-schedule-slot-cell"]') ?? [])]
          .filter(cell => cell.getAttribute('aria-label')?.startsWith('Court ' + target.court + ':'));
        return matches.length === 1 && matches[0].querySelector('[data-slot-state]')?.getAttribute('data-slot-state') === 'available' &&
          !matches[0].disabled && matches[0].getAttribute('aria-disabled') !== 'true';
      });
      const fullRendered = rows.length === 16 && cells.length === 112 &&
        rows.every(row => row.querySelectorAll('[data-testid="court-schedule-slot-cell"]').length === 7);
      if (state.targetCellsOpen === null && targetOpen) state.targetCellsOpen = now;
      if (state.fullGridRendered === null && fullRendered) state.fullGridRendered = now;
      if (!document.querySelector('[aria-busy="true"]')) {
        if (state.targetActionable === null && targetOpen) state.targetActionable = now;
        if (state.fullGridReady === null && fullRendered) state.fullGridReady = now;
      }
    };
    state.observer = new MutationObserver(scan);
    state.observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    state.timer = setInterval(scan, 50);
    window.__thirstyCheckoutMilestones = state;
    scan();
  })()`);
}

export async function readCheckoutMilestones(page: Page, startedAt: number): Promise<CheckoutMilestones> {
  const values = await page.evaluate(`(() => {
    const state = window.__thirstyCheckoutMilestones;
    return state ? { pickerEnabled: state.pickerEnabled, targetCellsOpen: state.targetCellsOpen,
      fullGridRendered: state.fullGridRendered, targetActionable: state.targetActionable,
      fullGridReady: state.fullGridReady } : null;
  })()`) as CheckoutMilestones | null;
  const elapsed = (value: number | null | undefined) => value == null ? null : Math.max(0, Math.round(value - startedAt));
  return { pickerEnabled: elapsed(values?.pickerEnabled), targetCellsOpen: elapsed(values?.targetCellsOpen),
    fullGridRendered: elapsed(values?.fullGridRendered), targetActionable: elapsed(values?.targetActionable),
    fullGridReady: elapsed(values?.fullGridReady) };
}
