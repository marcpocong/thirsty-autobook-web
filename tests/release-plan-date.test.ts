import { describe, expect, it } from 'vitest';
import { browserSessionId } from '../src/browser-session.js';
import { planDateArmable, savedPlanDate } from '../src/release-plan-date.js';

const dated = (...dates: string[]) => ({ PRECISION_PHASE3: { candidates: dates.map(date => ({ rateEvidence: { date } })) } });
describe('saved release plan date', () => {
  it('distinguishes a current, stale, future, mixed and undated plan without changing it', () => {
    const setup = dated('2026-10-22', '2026-10-22'), copy = structuredClone(setup);
    expect(savedPlanDate(dated('2026-10-23'), '2026-10-23')).toMatchObject({ status: 'CURRENT', planDate: '2026-10-23' });
    expect(savedPlanDate(setup, '2026-10-23')).toMatchObject({ status: 'STALE', planDate: '2026-10-22', targetDate: '2026-10-23' });
    expect(savedPlanDate(dated('2026-10-24'), '2026-10-23').status).toBe('FUTURE');
    expect(savedPlanDate(dated('2026-10-22', '2026-10-23'), '2026-10-23').status).toBe('MIXED');
    expect(savedPlanDate({}, '2026-10-23').status).toBe('UNDATED');
    expect(setup).toEqual(copy);
    expect(['CURRENT', 'UNDATED', 'STALE', 'FUTURE', 'MIXED'].map(status => planDateArmable({ status } as never))).toEqual([true, true, false, false, false]);
  });
});
describe('browser launch identity', () => {
  it('is a short opaque hash of the CDP browser id and changes with every launch', () => {
    const a = browserSessionId('ws://127.0.0.1:9222/devtools/browser/0b5c3c1e-1111-4a4a-9b9b-123456789abc');
    expect(a).toMatch(/^[a-f0-9]{16}$/);
    expect(a).not.toContain('0b5c3c1e');
    expect(browserSessionId('ws://127.0.0.1:9222/devtools/browser/0b5c3c1e-2222-4a4a-9b9b-123456789abc')).not.toBe(a);
    expect(browserSessionId('ws://127.0.0.1:9222/devtools/page/x')).toBeNull();
    expect(browserSessionId(undefined)).toBeNull();
  });
});
