import type { AvailabilityProvider } from '../availability-provider.js';
import type { AvailabilityEnvelope, AvailabilityQuery } from '../types.js';

export class MockAvailabilityProvider implements AvailabilityProvider {
  readonly kind = 'fixture-backed-mock' as const;

  constructor(private readonly fixture: AvailabilityEnvelope) {}

  async getAvailability(query: AvailabilityQuery): Promise<AvailabilityEnvelope> {
    const envelope = structuredClone(this.fixture);
    if (!envelope.raw || typeof envelope.raw !== 'object') return envelope;
    const root = envelope.raw as { data?: { dates?: Record<string, boolean>; slotsBySpace?: Record<string, unknown[]> } };
    if (!root.data?.dates || !root.data.slotsBySpace) return envelope;
    root.data.dates = Object.fromEntries(Object.entries(root.data.dates).filter(([date]) => date >= query.startDate && date <= query.endDate));
    root.data.slotsBySpace = Object.fromEntries(Object.entries(root.data.slotsBySpace).map(([spaceId, slots]) => [
      spaceId,
      slots.filter(slot => {
        if (!slot || typeof slot !== 'object' || !('date' in slot)) return true;
        const date = (slot as { date: unknown }).date;
        return typeof date !== 'string' || (date >= query.startDate && date <= query.endDate);
      }),
    ]));
    return envelope;
  }
}
