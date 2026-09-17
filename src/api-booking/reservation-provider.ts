import type { ReservationResult, ReservationSubmission } from './types.js';

export interface ReservationProvider {
  readonly kind: 'mock-reservation-provider';
  submit(submission: ReservationSubmission): Promise<ReservationResult>;
}

export const LIVE_RESERVATION_INTEGRATION_ENABLED = false as const;
export const AVAILABILITY_PROOF_IMPLEMENTED = false as const;
