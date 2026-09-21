import type { BookingPlan } from './types.js';
import type { FreshSlotProof } from './slot-proofs.js';
import {
  buildStandardPublicCheckoutRequest,
  type PublicCheckoutRequest,
  type ResolvedGuestCustomer,
} from './public-checkout.js';

/** Offline request construction only. This module has no browser, fetch, permit, or dispatch method. */
export interface HeaderlessCheckoutExperiment {
  readonly mode: 'OFFLINE_HEADERLESS_CONSTRUCTION';
  readonly dispatchAllowed: false;
  readonly url: 'https://app.onda.fit/api/bookings/public-checkout';
  readonly method: 'POST';
  readonly credentials: 'same-origin';
  readonly redirect: 'error';
  readonly cache: 'no-store';
  readonly headers: Readonly<{ 'Content-Type': 'application/json'; Accept: 'application/json' }>;
  readonly body: PublicCheckoutRequest;
}

export function buildHeaderlessCheckoutExperiment(
  plan: BookingPlan,
  customer: ResolvedGuestCustomer,
  facilityId: string,
  proofs: readonly FreshSlotProof[],
  maximumAmount: number,
): HeaderlessCheckoutExperiment {
  const body = buildStandardPublicCheckoutRequest(plan, customer, facilityId, proofs);
  return {
    mode: 'OFFLINE_HEADERLESS_CONSTRUCTION', dispatchAllowed: false,
    url: 'https://app.onda.fit/api/bookings/public-checkout', method: 'POST',
    credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body,
  };
}
