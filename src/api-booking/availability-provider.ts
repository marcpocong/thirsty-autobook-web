import type { AvailabilityEnvelope, AvailabilityQuery } from './types.js';

export interface AvailabilityProvider {
  readonly kind: 'fixture-backed-mock';
  getAvailability(query: AvailabilityQuery): Promise<AvailabilityEnvelope>;
}

// Live transport is intentionally absent until Onda authorizes and documents an integration.
export const LIVE_AVAILABILITY_INTEGRATION_ENABLED = false as const;
