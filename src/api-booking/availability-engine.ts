import { performance } from 'node:perf_hooks';
import type { AvailabilityProvider } from './availability-provider.js';
import { AvailabilityValidationError, parseAvailability } from './availability-parser.js';
import { BookingPlanningError, rankBookingCandidates } from './booking-planner.js';
import type { AvailabilitySnapshot, BookingPlan, BookingPreferences } from './types.js';

export interface ApiAvailabilityTiming {
  label: 'API-FIRST timing';
  requestDispatchedMs: number | null;
  responseReceivedMs: number | null;
  parsedMs: number | null;
  candidateSelectionMs: number | null;
  totalMs: number | null;
}

export interface ApiAvailabilityDiscovery {
  snapshot: AvailabilitySnapshot;
  candidates: BookingPlan[];
  timing: ApiAvailabilityTiming;
}

export class ApiAvailabilityError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'ApiAvailabilityError'; }
}

/** API-first discovery boundary. It has no Playwright, Page, or grid dependency. */
export async function discoverApiAvailability(
  provider: AvailabilityProvider,
  preferences: BookingPreferences,
  options: { now?: () => Date; maximumAgeMs?: number; candidateLimit?: number } = {},
): Promise<ApiAvailabilityDiscovery> {
  const now = options.now ?? (() => new Date());
  const maximumAgeMs = options.maximumAgeMs ?? 15_000;
  const started = performance.now();
  let requestStarted: number | undefined, responseReceived: number | undefined, parsed: number | undefined, selected: number | undefined;
  try {
    requestStarted = performance.now();
    const envelope = await provider.getAvailability({ startDate: preferences.targetDate, endDate: preferences.targetDate });
    responseReceived = performance.now();
    const snapshot = parseAvailability(envelope.raw, { startDate: preferences.targetDate, endDate: preferences.targetDate,
      capturedAt: envelope.capturedAt, fixtureKind: envelope.fixtureKind, label: envelope.label, now: now(), maximumAgeMs });
    parsed = performance.now();
    const candidates = rankBookingCandidates(snapshot, preferences, options.candidateLimit ?? 32);
    selected = performance.now();
    return { snapshot, candidates, timing: { label: 'API-FIRST timing', requestDispatchedMs: requestStarted - started,
      responseReceivedMs: responseReceived - started, parsedMs: parsed - started, candidateSelectionMs: selected - started,
      totalMs: selected - started } };
  } catch (error) {
    if (error instanceof ApiAvailabilityError) throw error;
    if (error instanceof AvailabilityValidationError || error instanceof BookingPlanningError) throw new ApiAvailabilityError(error.code);
    throw new ApiAvailabilityError('API_AVAILABILITY_FAILED');
  }
}
