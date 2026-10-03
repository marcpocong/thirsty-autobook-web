import { describe, expect, it } from 'vitest';
import { BookingSetupSchema, ConfigSchema, planFingerprint } from '../src/config.js';
import { defaultSetup, describePlan, bookingView } from '../ui/booking.js';
import { formatReleaseOffset, isValidReleaseTrigger, RELEASE_OFFSET_MAX_MS, RELEASE_OFFSET_MIN_MS, releaseTriggerMs } from '../src/release-offset.js';
import { assertDirectDispatchWindow, DIRECT_MAX_DISPATCH_LATENESS_MS } from '../src/api-booking/proofless-checkout.js';
import { API_RELEASE_MAX_LATENESS_MS, assertApiReleaseFresh } from '../src/api-booking/api-release.js';

const players = { PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' };
const setup = (extra: Record<string, unknown> = {}) => ({ ...defaultSetup, BOOKING_METHOD: 'proofless', ...extra });
const config = (extra: Record<string, unknown> = {}) => ConfigSchema.parse({ ...setup(extra), ...players });
const release = Date.UTC(2026, 8, 29, 0, 0, 0);

describe('Release Offset setting', () => {
  it('allows a user-selected whole-millisecond offset through two seconds and defaults to 0 ms for legacy plans', () => {
    expect([RELEASE_OFFSET_MIN_MS, RELEASE_OFFSET_MAX_MS]).toEqual([-2000, 0]);
    const { RELEASE_OFFSET_MS: _omitted, ...legacy } = setup();
    expect(BookingSetupSchema.parse(legacy).RELEASE_OFFSET_MS).toBe(0);
    expect(config().RELEASE_OFFSET_MS).toBe(0);
  });

  it('accepts any whole millisecond in range and rejects values outside it', () => {
    for (const value of [-2000, -1733, -101, -1, 0]) expect(BookingSetupSchema.safeParse(setup({ RELEASE_OFFSET_MS: value })).success).toBe(true);
    for (const value of [-2001, 1, 100, -50.5, Number.NaN, '-50'])
      expect(BookingSetupSchema.safeParse(setup({ RELEASE_OFFSET_MS: value })).success).toBe(false);
  });

  it('applies to Proofless Direct only', () => {
    for (const method of ['browser', 'hybrid', 'api-first']) {
      const result = BookingSetupSchema.safeParse(setup({ BOOKING_METHOD: method, RELEASE_OFFSET_MS: -10 }));
      expect(result.success).toBe(false);
      expect(result.error?.issues.map(issue => issue.message)).toContain('Release Offset applies to Proofless Direct only.');
      expect(BookingSetupSchema.safeParse(setup({ BOOKING_METHOD: method, RELEASE_OFFSET_MS: 0 })).success).toBe(true);
    }
  });

  it('is part of the armed plan fingerprint only when non-zero', () => {
    expect(planFingerprint(config({ RELEASE_OFFSET_MS: 0 }))).toBe(planFingerprint(config()));
    const offsets = [-2000, -1733, -101, -1, 0];
    const fingerprints = offsets.map(value => planFingerprint(config({ RELEASE_OFFSET_MS: value })));
    expect(new Set(fingerprints).size).toBe(offsets.length);
  });

  it('is stated in the arming confirmation only when non-zero', () => {
    expect(describePlan(bookingView(config()))).not.toContain('Release offset');
    expect(describePlan(bookingView(config({ RELEASE_OFFSET_MS: -25 }))))
      .toContain('Release offset: −25 ms · checkout may be sent up to 25 ms before the official release time.');
  });
});

describe('release trigger', () => {
  it('is the release instant plus any guarded whole-millisecond offset', () => {
    expect(releaseTriggerMs(release)).toBe(release);
    expect(releaseTriggerMs(release, -50)).toBe(release - 50);
    expect(releaseTriggerMs(release, -731)).toBe(release - 731);
    expect(() => releaseTriggerMs(release, -2001)).toThrow('RELEASE_OFFSET_INVALID');
    expect(() => releaseTriggerMs(release + 0.5, 0)).toThrow('RELEASE_OFFSET_INVALID');
    expect(isValidReleaseTrigger(release, release - 100)).toBe(true);
    expect(isValidReleaseTrigger(release, release - 2000)).toBe(true);
    expect(isValidReleaseTrigger(release, release - 2001)).toBe(false);
    expect(isValidReleaseTrigger(release, release + 5)).toBe(false);
    expect([formatReleaseOffset(-100), formatReleaseOffset(0)]).toEqual(['−100 ms', '0 ms']);
  });

  it('moves only the start of the Proofless dispatch window; the lateness bound stays on the release', () => {
    const trigger = release - 50;
    expect(() => assertDirectDispatchWindow(release, trigger - 1, trigger)).toThrow('DIRECT_RELEASE_WINDOW_MISSED');
    expect(() => assertDirectDispatchWindow(release, trigger, trigger)).not.toThrow();
    expect(() => assertDirectDispatchWindow(release, release + DIRECT_MAX_DISPATCH_LATENESS_MS, trigger)).not.toThrow();
    expect(() => assertDirectDispatchWindow(release, release + DIRECT_MAX_DISPATCH_LATENESS_MS + 1, trigger)).toThrow('DIRECT_RELEASE_WINDOW_MISSED');
    // An out-of-range or later-than-release trigger is never honoured.
    expect(() => assertDirectDispatchWindow(release, release - 2001, release - 2001)).toThrow('DIRECT_RELEASE_WINDOW_MISSED');
    expect(() => assertDirectDispatchWindow(release, release + 5, release + 5)).toThrow('DIRECT_RELEASE_WINDOW_MISSED');
    expect(() => assertDirectDispatchWindow(release, release + 2_000, release + 2_000, true)).not.toThrow();
    expect(() => assertDirectDispatchWindow(release, release + 3_000, release + 2_000, true)).not.toThrow();
    expect(() => assertDirectDispatchWindow(release, release + 3_001, release + 2_000, true)).toThrow('DIRECT_RELEASE_WINDOW_MISSED');
    // Without a trigger the window is unchanged: never before release.
    expect(() => assertDirectDispatchWindow(release, release - 1)).toThrow('DIRECT_RELEASE_WINDOW_MISSED');
  });

  it('the General release freshness check uses the same trigger', () => {
    const trigger = release - 100;
    expect(() => assertApiReleaseFresh(release, trigger - 1, trigger)).toThrow('RELEASE_MISSED');
    expect(() => assertApiReleaseFresh(release, trigger, trigger)).not.toThrow();
    expect(() => assertApiReleaseFresh(release, release + API_RELEASE_MAX_LATENESS_MS, trigger)).not.toThrow();
    expect(() => assertApiReleaseFresh(release, release + API_RELEASE_MAX_LATENESS_MS + 1, trigger)).toThrow('RELEASE_MISSED');
    expect(() => assertApiReleaseFresh(release, release - 2001, release - 2001)).toThrow('RELEASE_MISSED');
  });
});

describe('per-attempt Release Offset (Precision)', () => {
  const fixed = (targets: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
    setup({ DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: targets, ...extra });
  const a = { court: 7, start: '19:00', durationHours: 3 }, b = { court: 6, start: '19:00', durationHours: 3 };

  it('each Fixed attempt may carry its own user-selected offset; absent means normal', () => {
    const parsed = BookingSetupSchema.parse(fixed([{ ...a, releaseOffsetMs: -1733 }, b]));
    expect(parsed.PRECISION_TARGETS).toEqual([{ ...a, releaseOffsetMs: -1733 }, b]);
    for (const value of [-2001, 5, -50.5, '-50'])
      expect(BookingSetupSchema.safeParse(fixed([{ ...a, releaseOffsetMs: value }])).success).toBe(false);
  });

  it('Precision sets offsets per attempt, so a plan-wide offset is rejected there', () => {
    const result = BookingSetupSchema.safeParse(fixed([a], { RELEASE_OFFSET_MS: -25 }));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(issue => issue.message)).toContain('Precision Release sets the offset on each attempt.');
  });

  it('a per-attempt offset is part of the armed plan fingerprint', () => {
    const base = planFingerprint(ConfigSchema.parse({ ...fixed([a, b]), ...players }));
    const early = planFingerprint(ConfigSchema.parse({ ...fixed([{ ...a, releaseOffsetMs: -10 }, b]), ...players }));
    const other = planFingerprint(ConfigSchema.parse({ ...fixed([a, { ...b, releaseOffsetMs: -10 }]), ...players }));
    expect(new Set([base, early, other]).size).toBe(3);
  });

  it('the arming confirmation states each attempt as normal or with its offset', () => {
    const text = describePlan(bookingView(ConfigSchema.parse({ ...fixed([{ ...a, releaseOffsetMs: -100 }, b]), ...players })));
    expect(text).toContain('Worker A | Court 7 | 19:00–22:00 | 3 h | ~PHP 2100 (assumed rate) | Offset \u2212100 ms: sent up to 100 ms before the official release time');
    expect(text).toContain('Worker B | Court 6 | 19:00–22:00 | 3 h | ~PHP 2100 (assumed rate) | Normal');
  });
});
