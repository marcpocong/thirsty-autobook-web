import { describe, expect, it, vi } from 'vitest';

// Any call into the General checkout-chunking path fails this file: Precision must never group targets.
vi.mock('../../src/api-booking/extended-checkout.js', () => ({
  standardCheckoutChunks: () => { throw Error('PRECISION_MUST_NOT_USE_STANDARD_CHECKOUT_CHUNKS'); },
}));

const { dispatchPrecisionRace, freezePrecisionRace, precisionTargetPlan, validatePrecisionTargets } = await import('../../src/api-booking/precision-race.js');
const { prooflessRequest } = await import('../../src/api-booking/proofless-checkout.js');

describe('Precision never uses General checkout chunking', () => {
  it('validates, plans, freezes and dispatches seven targets without standardCheckoutChunks', async () => {
    const date = '2026-09-26', releaseMs = Date.parse('2026-09-24T00:00:00.000Z');
    const targets = validatePrecisionTargets([1, 2, 3, 4, 5, 6, 7].map(court => ({ court, start: '17:00', durationHours: 3 })), date);
    const race = freezePrecisionRace(date, releaseMs, targets.map(target => ({ target, plan: precisionTargetPlan(target, date) })));
    let now = releaseMs - 20_000;
    const courtsPerRequest: number[] = [];
    const results = await dispatchPrecisionRace(race, { now: () => now, prewarmLeadMs: 15_000,
      waitUntil: async at => { await new Promise(resolve => setTimeout(resolve, 0)); now = Math.max(now, at); },
      prewarm: async () => undefined,
      dispatch: async attempt => {
        const request = prooflessRequest(attempt.plan, { clientId: 'c', customerId: 'u', customerEmail: 'e@example.invalid', customerPhone: '09123456789', customerFirstName: 'F', customerLastName: 'P' });
        courtsPerRequest.push(new Set(request.items.map(item => item.spaceId)).size);
        return { state: 'REJECTED' };
      } });
    expect(results).toHaveLength(7);
    expect(courtsPerRequest).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });
});
