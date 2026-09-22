import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { availabilityFixture } from '../availability-fixture.js';
import { parseAvailability } from '../../src/api-booking/availability-parser.js';
import { planBooking } from '../../src/api-booking/booking-planner.js';
import { submitCalendarFreeTwoHourCheckout } from '../../src/api-booking/calendar-free-checkout.js';
import { THIRSTY_PICKLE_CLIENT_ID } from '../../src/api-booking/local-customer.js';
import { DurableSubmissionJournal } from '../../src/api-booking/durable-submission-journal.js';
import {OndaBrowserSessionTransport} from '../../src/api-booking/browser-session-transport.js';

const date = '2026-09-18';
const at = new Date('2026-09-18T00:00:00Z');
const availability = parseAvailability(availabilityFixture(date), { startDate: date, endDate: date,
  capturedAt: at.toISOString(), fixtureKind: 'synthetic', label: 'offline', now: at, maximumAgeMs: 1000 });
const plan = planBooking(availability, { mode: 'standard', targetDate: date, durationHours: 2,
  preferredStartTimes: ['12:00'], fallbackStartTimes: [], courtPriority: [3], fallbackCourts: [], courtCount: 1,
  maximumTotalPrice: 1200, currency: 'PHP' });
const customer = { clientId: THIRSTY_PICKLE_CLIENT_ID, customerId: 'synthetic-customer',
  customerFirstName: 'Synthetic', customerLastName: 'Guest', customerEmail: 'test@example.invalid', customerPhone: '0000000000' };
const approval = { courts: [3], date, startTime: '12:00', endTime: '14:00', maximumAmount: 1200,
  customerId: customer.customerId, approvalReference: 'offline-only' };

describe('calendar-free checkout approval boundary', () => {
  it('cannot enter the reservation path with its gate closed', async () => {
    const page = { evaluate: vi.fn(), addScriptTag: vi.fn() } as unknown as Page;
    const journal = {} as DurableSubmissionJournal;
    await expect(submitCalendarFreeTwoHourCheckout({ page, plan, availability, customer, approval, journal }))
      .rejects.toThrow('CALENDAR_FREE_SUBMISSION_DISABLED');
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('rejects a changed court or price before any browser action', async () => {
    const prior = process.env.ONDA_CALENDAR_FREE_CHECKOUT;
    const priorSubmit = process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT;
    process.env.ONDA_CALENDAR_FREE_CHECKOUT = 'APPROVED_ONE_SHOT';
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = 'SUPERVISED_ONE_SHOT';
    try {
      const page = { evaluate: vi.fn(), addScriptTag: vi.fn() } as unknown as Page;
      const journal = {} as DurableSubmissionJournal;
      await expect(submitCalendarFreeTwoHourCheckout({ page, plan,
        availability: { ...availability, fixtureKind: 'live', capturedAt: new Date().toISOString() },
        customer, approval: { ...approval, courts: [4] }, journal })).rejects.toThrow('CALENDAR_FREE_APPROVAL_MISMATCH');
      expect(page.evaluate).not.toHaveBeenCalled();
    } finally {
      if (prior === undefined) delete process.env.ONDA_CALENDAR_FREE_CHECKOUT;
      else process.env.ONDA_CALENDAR_FREE_CHECKOUT = prior;
      if (priorSubmit === undefined) delete process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT;
      else process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT = priorSubmit;
    }
  });
  it('does not use a prewarmed security context from another browser page',async()=>{
    const prior=process.env.ONDA_CALENDAR_FREE_CHECKOUT,priorSubmit=process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT;
    process.env.ONDA_CALENDAR_FREE_CHECKOUT='APPROVED_ONE_SHOT';
    process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT='SUPERVISED_ONE_SHOT';
    try{
      const page={evaluate:vi.fn()} as unknown as Page;
      const other={evaluate:vi.fn()} as unknown as Page;
      const transport=new OndaBrowserSessionTransport(other,async()=>({turnstileToken:'synthetic',publicFingerprint:'synthetic'}));
      await expect(submitCalendarFreeTwoHourCheckout({page,plan,
        availability:{...availability,fixtureKind:'live',capturedAt:new Date().toISOString()},customer,approval,
        journal:{} as DurableSubmissionJournal,transport})).rejects.toThrow('CALENDAR_FREE_TRANSPORT_PAGE_MISMATCH');
      expect(page.evaluate).not.toHaveBeenCalled();
      expect(other.evaluate).not.toHaveBeenCalled();
    }finally{
      if(prior===undefined)delete process.env.ONDA_CALENDAR_FREE_CHECKOUT;else process.env.ONDA_CALENDAR_FREE_CHECKOUT=prior;
      if(priorSubmit===undefined)delete process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT;else process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT=priorSubmit;
    }
  });
});
