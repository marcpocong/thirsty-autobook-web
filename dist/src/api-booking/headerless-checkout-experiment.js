import { buildStandardPublicCheckoutRequest, } from './public-checkout.js';
export function buildHeaderlessCheckoutExperiment(plan, customer, facilityId, proofs, maximumAmount) {
    const body = buildStandardPublicCheckoutRequest(plan, customer, facilityId, proofs);
    return {
        mode: 'OFFLINE_HEADERLESS_CONSTRUCTION', dispatchAllowed: false,
        url: 'https://app.onda.fit/api/bookings/public-checkout', method: 'POST',
        credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
    };
}
//# sourceMappingURL=headerless-checkout-experiment.js.map