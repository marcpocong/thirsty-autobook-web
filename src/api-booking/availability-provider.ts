import type { AvailabilityEnvelope, AvailabilityQuery } from './types.js';

export interface AvailabilityProvider {
  readonly kind: 'fixture-backed-mock' | 'onda-live-availability';
  getAvailability(query: AvailabilityQuery): Promise<AvailabilityEnvelope>;
}

// Read-only live availability is separate from reservation submission.
export const LIVE_AVAILABILITY_INTEGRATION_ENABLED = true as const;
