import { describe, expect, it } from 'vitest';
import { bookingSetupProblem } from '../src/booking-setup.js';
import { BookingSetupSchema, ConfigSchema, planFingerprint } from '../src/config.js';
import { defaultSetup } from '../ui/booking.js';

const special = {
  ...defaultSetup,
  SESSION_MODE: 'special-friday' as const,
  BOOKING_METHOD: 'api-first' as const,
  BOOKING_TYPE: 'extended' as const,
  COURT_COUNT: 4 as const,
  START_TIME: '17:00',
  DURATION_HOURS: 5,
  PREFERRED_COURTS: [6, 7, 1, 2, 3, 4, 5],
  FALLBACK_TIMES: [],
};

describe('special Friday configuration', () => {
  it('accepts only the fixed asymmetric-session envelope', () => {
    expect(BookingSetupSchema.parse(special).SESSION_MODE).toBe('special-friday');
    expect(bookingSetupProblem(special)).toBeUndefined();
    expect(BookingSetupSchema.safeParse({ ...special, START_TIME: '18:00' }).success).toBe(false);
    expect(bookingSetupProblem({ ...special, FALLBACK_TIMES: ['18:00'] })).toContain('must remain fixed');
  });

  it('makes the special session part of the release fingerprint', () => {
    const player = { PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' };
    const normal = ConfigSchema.parse({ ...special, ...player, SESSION_MODE: 'normal' });
    const configured = ConfigSchema.parse({ ...special, ...player });
    expect(planFingerprint(configured)).not.toBe(planFingerprint(normal));
  });
});
