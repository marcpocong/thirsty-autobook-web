import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Controller } from '../ui/controller.js';
import { bookingView, defaultSetup, describePlan } from '../ui/booking.js';
import { ConfigSchema, ObservationSchema, planFingerprint } from '../src/config.js';
import { clockStatus } from '../ui/status.js';
import type { Runner } from '../ui/processes.js';
import type { Command } from '../ui/types.js';
import { reducePrecisionOutcome } from '../src/api-booking/precision-race.js';

const players = { PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' };
const targets = [{ court: 7, start: '17:00', durationHours: 3 }, { court: 5, start: '17:00', durationHours: 3 }, { court: 3, start: '17:00', durationHours: 3 }];

describe('Precision Release UI boundary', () => {
  it('keeps a General plan fingerprint unchanged by Precision fields it does not use', () => {
    const general = ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, ...players });
    expect(planFingerprint(general)).toBe(planFingerprint({ ...general, PRECISION_TARGETS: targets }));
    const precision = ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: targets, ...players });
    expect(planFingerprint(precision)).not.toBe(planFingerprint(general));
    expect(planFingerprint(precision)).not.toBe(planFingerprint({ ...precision, PRECISION_TARGETS: targets.slice(0, 2) }));
  });

  it('confirmation lists every exact target and the multiple-hold warning', () => {
    const view = bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: targets, ...players }));
    const text = describePlan(view);
    expect(text).toContain('Worker A | Court 7 | 17:00–20:00');
    expect(text).toContain('Worker C | Court 3 | 17:00–20:00');
    expect(text).toContain('These are independent checkout attempts. More than one temporary QR hold may be created. Payment remains manual.');
    expect(text).not.toContain('Court priority');
  });

  it('prepares and arms one worker per target and reports the race outcome, not a failed run', async () => {
    const previous = process.env.THIRSTY_API_INSTALLATION; process.env.THIRSTY_API_INSTALLATION = '1';
    try {
      const view = bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: targets, ...players }));
      const calls: Command[] = [], releaseMs = Date.now() + 3_600_000;
      const runner: Runner = (command, event) => {
        calls.push(command);
        if (typeof command === 'object' && command.kind === 'apiRun' && command.mode === 'live') {
          const stage = (name: string, extra: Record<string, unknown> = {}) => event({ type: 'apiStage', stage: name, elapsedMs: 1, at: new Date().toISOString(), ...extra } as never);
          stage('RUN_STARTED');
          targets.forEach((target, index) => stage('PRECISION_TARGET', { workerId: 'ABC'[index], court: target.court, startTime: target.start, endTime: '20:00', durationHours: 3, assumedPrice: 2100 }));
          targets.forEach((target, index) => stage('PRECISION_TARGET_EVIDENCE', { workerId: 'ABC'[index], court: target.court, startTime: target.start, endTime: '20:00',
            checkpoint: 'FREEZE', evidence: 'NO_PUBLIC_BOOKING_DATE_UNRELEASED', eligible: true }));
          stage('PRECISION_FROZEN', { targetCount: 3, frozenCount: 3 });
          const hold = { workerId: 'A', date: view.targetDate, court: 7, startTime: '17:00', durationHours: 3, price: 2100, bookingId: 'b-1', bookingNo: 'BK-1', holdExpiresAt: new Date(Date.now() + 600_000).toISOString() };
          stage('PENDING_HOLD', hold); stage('OFFICIAL_QRPH_HANDOFF', hold);
          stage('PRECISION_ATTEMPT_STATE', { workerId: 'A', court: 7, startTime: '17:00', endTime: '20:00', attemptState: 'QR_READY' });
          stage('PRECISION_ATTEMPT_STATE', { workerId: 'B', court: 5, startTime: '17:00', endTime: '20:00', attemptState: 'REJECTED', code: 'ONDA_HTTP_STATUS_INVALID' });
          stage('PRECISION_ATTEMPT_STATE', { workerId: 'C', court: 3, startTime: '17:00', endTime: '20:00', attemptState: 'UNKNOWN', code: 'SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED' });
          const summary = reducePrecisionOutcome(['QR_READY', 'REJECTED', 'UNKNOWN']);
          stage('PRECISION_OUTCOME', { outcome: summary.outcome, verifiedCount: 1, unknownCount: 1, rejectedCount: 1, unsentCount: 0, qrAttention: false });
        }
        return { pid: 1, done: Promise.resolve(0), stop: async () => undefined };
      };
      const controller = new Controller({ runner, lock: async () => false, cdp: async () => true,
        browserHealth: async () => ({ A: true, B: true, C: true }), playerStatus: () => ({ primary: true, extended: true, third: true }),
        clock: () => ({ ...clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-24T06:00:00+08:00')), releaseMs, targetDate: view.targetDate }),
        confirm: async () => true, publish: () => undefined, booking: () => view, saveBooking: () => view });
      await controller.resetPrepare({ workflow: 'release', strategy: 'standard', setup: view.setup });
      expect(controller.state.detail).toContain('3 API browsers are ready');
      await controller.authorizeTerms(true); await controller.armFullBooking();
      expect(calls.map(command => typeof command === 'object' && command.kind === 'apiRun' ? `${command.mode}:${command.checkoutMethod}` : 'other'))
        .toEqual(['prepare:proofless', 'dry:proofless', 'live:proofless']);
      expect(controller.state.headline).toBe('OBJECTIVE ACHIEVED · UNRESOLVED EXTRA ATTEMPT — another attempt may also hold a court');
      expect(controller.state.precision?.targets.map(target => [target.workerId, target.state])).toEqual([['A', 'QR_READY'], ['B', 'REJECTED'], ['C', 'UNKNOWN']]);
      expect(controller.state.precision?.frozen).toBe(true);
      expect(controller.state.qrHandoffs?.map(hold => hold.checkout)).toEqual(['A']);
    } finally { if (previous === undefined) delete process.env.THIRSTY_API_INSTALLATION; else process.env.THIRSTY_API_INSTALLATION = previous; }
  });

  it('refuses a Precision arm closer than 3 minutes to release (cannot freeze at T-2 min)', async () => {
    const previous = process.env.THIRSTY_API_INSTALLATION; process.env.THIRSTY_API_INSTALLATION = '1';
    try {
      const view = bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: targets.slice(0, 1), ...players }));
      const calls: Command[] = [];
      const runner: Runner = command => { calls.push(command); return { pid: 1, done: Promise.resolve(0), stop: async () => undefined }; };
      const controller = new Controller({ runner, lock: async () => false, cdp: async () => true, browserHealth: async () => ({ A: true }),
        playerStatus: () => ({ primary: true, extended: false }),
        clock: () => ({ ...clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-24T06:00:00+08:00')), releaseMs: Date.now() + 90_000, targetDate: view.targetDate }),
        confirm: async () => true, publish: () => undefined, booking: () => view, saveBooking: () => view });
      await controller.resetPrepare({ workflow: 'release', strategy: 'standard', setup: view.setup });
      await controller.authorizeTerms(true); await controller.armFullBooking();
      expect(calls.some(command => typeof command === 'object' && command.kind === 'apiRun' && command.mode === 'live')).toBe(false);
      expect(controller.state.detail).toContain('at least 3 minutes');
    } finally { if (previous === undefined) delete process.env.THIRSTY_API_INSTALLATION; else process.env.THIRSTY_API_INSTALLATION = previous; }
  });
});

describe('Precision Release with seven attempts (A-G)', () => {
  const seven = [1, 2, 3, 4, 5, 6, 7].map(court => ({ court, start: '17:00', durationHours: 3 }));
  it('prepares and arms exactly workers A-G (never H) and lists all seven targets', async () => {
    const previous = process.env.THIRSTY_API_INSTALLATION; process.env.THIRSTY_API_INSTALLATION = '1';
    try {
      const view = bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: seven, ...players }));
      expect(describePlan(view)).toContain('Worker G | Court 7 | 17:00–20:00');
      expect(describePlan(view)).toContain('7 independent checkout attempts are authorized');
      const calls: Command[] = [], releaseMs = Date.now() + 3_600_000;
      const runner: Runner = command => { calls.push(command); return { pid: 1, done: Promise.resolve(0), stop: async () => undefined }; };
      const controller = new Controller({ runner, lock: async () => false, cdp: async () => true,
        browserHealth: async () => ({ A: true, B: true, C: true, D: true, E: true, F: true, G: true, H: false }),
        playerStatus: () => ({ primary: true, extended: true, third: true, fourth: true, fifth: true, sixth: true, seventh: true, eighth: false }),
        clock: () => ({ ...clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-24T06:00:00+08:00')), releaseMs, targetDate: view.targetDate }),
        confirm: async () => true, publish: () => undefined, booking: () => view, saveBooking: () => view });
      await controller.resetPrepare({ workflow: 'release', strategy: 'standard', setup: view.setup });
      expect(controller.state.detail).toContain('7 API browsers are ready');
      await controller.authorizeTerms(true); await controller.armFullBooking();
      expect(calls.map(command => typeof command === 'object' && command.kind === 'apiRun' ? command.mode : 'other')).toEqual(['prepare', 'dry', 'live']);
    } finally { if (previous === undefined) delete process.env.THIRSTY_API_INSTALLATION; else process.env.THIRSTY_API_INSTALLATION = previous; }
  });
  it('refuses preparation when a configured Precision worker has no player (no fallback identity)', async () => {
    const previous = process.env.THIRSTY_API_INSTALLATION; process.env.THIRSTY_API_INSTALLATION = '1';
    try {
      const view = bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: seven, ...players }));
      const calls: Command[] = [];
      const runner: Runner = command => { calls.push(command); return { pid: 1, done: Promise.resolve(0), stop: async () => undefined }; };
      const controller = new Controller({ runner, lock: async () => false, cdp: async () => true,
        browserHealth: async () => ({ A: true, B: true, C: true, D: true, E: true, F: true, G: true }),
        playerStatus: () => ({ primary: true, extended: true, third: true, fourth: true, fifth: true, sixth: false, seventh: true }),
        clock: () => ({ ...clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-24T06:00:00+08:00')), releaseMs: Date.now() + 3_600_000, targetDate: view.targetDate }),
        confirm: async () => true, publish: () => undefined, booking: () => view, saveBooking: () => view });
      await controller.resetPrepare({ workflow: 'release', strategy: 'standard', setup: view.setup });
      expect(calls).toHaveLength(0);
      expect(controller.state.apiFirstReady).toBe(false);
    } finally { if (previous === undefined) delete process.env.THIRSTY_API_INSTALLATION; else process.env.THIRSTY_API_INSTALLATION = previous; }
  });
});

describe('customer-identity problems surface at Reset & Prepare', () => {
  it('shows "Worker B — customer identity invalid: duplicates Worker A" and that the other attempts remain usable', async () => {
    const previous = process.env.THIRSTY_API_INSTALLATION; process.env.THIRSTY_API_INSTALLATION = '1';
    try {
      const view = bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: targets, ...players }));
      const runner: Runner = (command, event) => {
        if (typeof command === 'object' && command.kind === 'apiRun' && ['prepare', 'dry'].includes(command.mode)) {
          event({ type: 'apiStage', stage: 'RUN_STARTED', elapsedMs: 0 });
          event({ type: 'apiStage', stage: 'CUSTOMER_IDENTITY_INVALID', elapsedMs: 1, workerId: 'B', code: 'DUPLICATE_ONDA_CUSTOMER_ID', duplicateOf: 'A' });
          if (command.mode === 'dry') event({ type: 'apiStage', stage: 'PRECISION_ATTEMPT_STATE', elapsedMs: 2, workerId: 'B', court: 5, startTime: '17:00', endTime: '20:00',
            attemptState: 'IDENTITY_FAILED', code: 'DUPLICATE_ONDA_CUSTOMER_ID', duplicateOf: 'A' });
        }
        return { pid: 1, done: Promise.resolve(0), stop: async () => undefined };
      };
      const controller = new Controller({ runner, lock: async () => false, cdp: async () => true,
        browserHealth: async () => ({ A: true, B: true, C: true }), playerStatus: () => ({ primary: true, extended: true, third: true }),
        clock: () => ({ ...clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-24T06:00:00+08:00')), releaseMs: Date.parse('2026-09-24T00:00:00.000Z') + 86_400_000, targetDate: view.targetDate }),
        confirm: async () => true, publish: () => undefined, booking: () => view, saveBooking: () => view });
      await controller.resetPrepare({ workflow: 'release', strategy: 'standard', setup: view.setup });
      expect(controller.state.apiFirstReady).toBe(true);
      expect(controller.state.detail).toContain('Worker B — customer identity invalid: duplicates Worker A. Worker B will not dispatch; the other valid Precision attempts remain usable.');
      expect(controller.state.identityIssues).toHaveLength(1);
      expect(controller.state.precision?.targets.find(target => target.workerId === 'B')).toMatchObject({ state: 'IDENTITY_FAILED', duplicateOf: 'A' });
      const uuid=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      expect(controller.state.detail).not.toMatch(uuid);
      expect(controller.state.identityIssues!.join(' ')).not.toMatch(uuid);
    } finally { if (previous === undefined) delete process.env.THIRSTY_API_INSTALLATION; else process.env.THIRSTY_API_INSTALLATION = previous; }
  });
});
