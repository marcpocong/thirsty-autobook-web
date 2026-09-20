import { loadConfig } from '../config.js';
import { discoverApiAvailability } from './availability-engine.js';
import { OndaLiveAvailabilityProvider } from './live-availability-provider.js';
import type { BookingPreferences } from './types.js';

const date = process.argv[2];
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error('API_PREVIEW_DATE_REQUIRED');
  process.exitCode = 2;
} else {
  try {
    const config = loadConfig();
    if (config.BOOKING_METHOD !== 'api-first') throw Error('API_FIRST_METHOD_REQUIRED');
    const preferences: BookingPreferences = { mode: config.BOOKING_TYPE, targetDate: date, durationHours: config.DURATION_HOURS,
      preferredStartTimes: [config.START_TIME], fallbackStartTimes: config.FALLBACK_TIMES,
      courtPriority: config.PREFERRED_COURTS, fallbackCourts: config.FALLBACK_COURTS, courtCount: config.COURT_COUNT,
      maximumTotalPrice: config.MAX_PRICE, currency: 'PHP' };
    const result = await discoverApiAvailability(new OndaLiveAvailabilityProvider(), preferences);
    console.log(JSON.stringify({ mode: 'API_FIRST_READ_ONLY', targetDate: date, candidates: result.candidates.slice(0, 8).map(plan => ({
      startTime: plan.startTime, endTime: plan.endTime, courts: plan.courts.map(court => court.court), totalPrice: plan.totalPrice,
    })), timing: result.timing, liveCheckout: 'DISABLED', securityContext: 'UNSUPPORTED_CURRENT_NORMAL_SITE_BINDING' }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'API_PREVIEW_FAILED');
    process.exitCode = 1;
  }
}
