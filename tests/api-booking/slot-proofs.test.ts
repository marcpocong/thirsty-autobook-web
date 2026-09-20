import { describe, expect, it, vi } from 'vitest';
import { acquireFreshSlotProofs, SlotProofError } from '../../src/api-booking/slot-proofs.js';

const hours = [
  { spaceId: 'space-a', date: '2026-09-18', startTime: '12:00', endTime: '13:00' },
  { spaceId: 'space-a', date: '2026-09-18', startTime: '13:00', endTime: '14:00' },
];
const now = new Date('2026-09-18T00:00:00.000Z');

function code(error: unknown) {
  expect(error).toBeInstanceOf(SlotProofError);
  return (error as SlotProofError).code;
}

describe('fresh slot proof acquisition', () => {
  it('requests every exact hour, preserves response association, and bounds concurrency', async () => {
    let inFlight = 0, maximumInFlight = 0;
    const transport = { checkSlot: vi.fn(async request => {
      inFlight++; maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, request.startTime === '12:00' ? 5 : 1));
      inFlight--;
      return { success: true, availabilityProof: `proof-${request.startTime}`, ...request };
    }) };
    const result = await acquireFreshSlotProofs(hours, { clientId: 'client', facilityId: 'facility', transport, clock: () => now, concurrency: 2 });
    expect(maximumInFlight).toBeLessThanOrEqual(2);
    expect(result.map(proof => [proof.startTime, proof.availabilityProof])).toEqual([['12:00', 'proof-12:00'], ['13:00', 'proof-13:00']]);
    expect(transport.checkSlot).toHaveBeenCalledWith({ ...hours[0], clientId: 'client', facilityId: 'facility' });
  });

  it.each([
    ['missing proof', { success: true }, 'AVAILABILITY_PROOF_INVALID'],
    ['failed verification', { success: false }, 'AVAILABILITY_PROOF_INVALID'],
    ['explicitly unavailable', { success: false, isAvailable: false }, 'SLOT_UNAVAILABLE'],
    ['wrong identity', { success: true, availabilityProof: 'proof', date: '2026-09-19' }, 'AVAILABILITY_PROOF_SLOT_MISMATCH'],
  ])('fails closed for %s', async (_label, response, expected) => {
    await expect(acquireFreshSlotProofs([hours[0]!], { clientId: 'client', facilityId: 'facility', transport: { checkSlot: async () => response }, clock: () => now }))
      .rejects.satisfy((error: unknown) => code(error) === expected);
  });

  it('does not reuse duplicate proofs and does not hide request failures', async () => {
    await expect(acquireFreshSlotProofs(hours, { clientId: 'client', facilityId: 'facility', transport: { checkSlot: async request => ({ success: true, availabilityProof: 'same', ...request }) }, clock: () => now }))
      .rejects.satisfy((error: unknown) => code(error) === 'AVAILABILITY_PROOF_DUPLICATE');
    await expect(acquireFreshSlotProofs([hours[0]!], { clientId: 'client', facilityId: 'facility', transport: { checkSlot: async () => { throw Error('network'); } }, clock: () => now }))
      .rejects.satisfy((error: unknown) => code(error) === 'AVAILABILITY_PROOF_REQUEST_FAILED');
  });
});
