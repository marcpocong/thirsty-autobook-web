export type BookingMode = 'standard' | 'extended';
export type FixtureKind = 'captured-historical' | 'synthetic' | 'live';

export interface AvailabilityQuery {
  startDate: string;
  endDate: string;
}

export interface AvailabilityEnvelope {
  raw: unknown;
  capturedAt: string;
  fixtureKind: FixtureKind;
  label: string;
}

export interface AvailabilitySlot {
  court: number;
  spaceId: string;
  date: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  isNightRate: boolean;
  isNextDay: boolean;
  currency: string;
  price: number;
}

export interface AvailabilitySnapshot {
  capturedAt: string;
  fixtureKind: FixtureKind;
  label: string;
  requestedDates: string[];
  returnedDates: Record<string, boolean>;
  incompleteDates: string[];
  slots: AvailabilitySlot[];
}

export interface ParseAvailabilityOptions extends AvailabilityQuery {
  capturedAt: string;
  fixtureKind: FixtureKind;
  label: string;
  now: Date;
  maximumAgeMs: number;
  requireCompleteRange?: boolean;
}

export interface BookingPreferences {
  mode: BookingMode;
  targetDate: string;
  durationHours: number;
  preferredStartTimes: string[];
  fallbackStartTimes: string[];
  courtPriority: number[];
  fallbackCourts: number[];
  exactCourts?: number[][];
  courtCount: 1 | 2;
  maximumTotalPrice: number;
  currency: 'PHP';
}

export interface PlannedCourt {
  court: number;
  spaceId: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  price: number;
  currency: string;
  slots: AvailabilitySlot[];
}

export interface BookingPlan {
  mode: BookingMode;
  targetDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  courts: PlannedCourt[];
  chunks: { startTime: string; endTime: string; durationHours: number; courts: PlannedCourt[]; totalPrice: number }[];
  totalPrice: number;
  currency: string;
}

export interface ReservationSubmission {
  runId: string;
  intentId: string;
  plan: BookingPlan;
  integration: 'mock-only';
}

export interface PendingHold {
  synthetic: true;
  holdId: string;
  court: number;
  intentId: string;
  facilityId: string;
  spaceId: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  currency: string;
  amount: number;
  chunkIndex: number;
  status: 'pending';
  paymentStatus: 'pending';
  holdExpiresAt: string;
}

export type ReservationResult =
  | { kind: 'verified-pending-hold'; synthetic: true; holds: PendingHold[] }
  | { kind: 'conflict'; synthetic: true; code: 'RESERVATION_CONFLICT' }
  | { kind: 'validation-failure'; synthetic: true; code: 'RESERVATION_VALIDATION_FAILED' }
  | { kind: 'unknown-outcome'; synthetic: true; code: 'SUBMISSION_OUTCOME_UNKNOWN'; reconciliationRequired: true }
  | { kind: 'partial-success'; synthetic: true; holds: PendingHold[]; failedCourts: { chunkIndex: number; court: number }[]; reconciliationRequired: true }
  | { kind: 'expired-hold'; synthetic: true; holds: PendingHold[]; code: 'HOLD_EXPIRED' };

export interface CheckoutSession {
  synthetic: true;
  sessionId: string;
  holdId: string;
  expiresAt: string;
  action: 'manual-payment-required';
}

export interface CheckoutHandoffResult {
  kind: 'mock-checkout-ready';
  synthetic: true;
  sessions: CheckoutSession[];
  paymentAutomated: false;
}

export interface MockTimings {
  label: 'MOCK timing';
  availabilityMs: number;
  parsingMs: number;
  planningMs: number;
  reservationMs: number;
  checkoutMs: number;
}

export type CoordinatorResult =
  | { kind: 'manual-payment-required'; synthetic: true; plan: BookingPlan; holds: PendingHold[]; handoff: CheckoutHandoffResult; timings: MockTimings }
  | { kind: 'stopped'; synthetic: true; reason: ReservationResult['kind'] | 'checkout-preparation-failed'; reservation: ReservationResult; holds?: PendingHold[]; reconciliationRequired: boolean; timings: MockTimings };
