import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SLOT_WATCH_EARLY_OFFSETS_MS, SLOT_WATCH_MAX_IN_FLIGHT, SlotWatch, readSlotWatchHistory, slotWatchSchedule, type SlotWatchView, SLOT_WATCH_HOLD_EXPIRY_WINDOW_MS } from '../src/slot-watch.js';
import type { AvailabilitySlot, AvailabilitySnapshot } from '../src/api-booking/types.js';
import type { PublicBookingRecords } from '../src/api-booking/public-bookings.js';
import { VirtualClock } from './helpers/virtual-clock.js';

const date = '2026-09-26';
const releaseMs = Date.parse('2026-09-24T00:00:00.000Z');
const hours = Array.from({ length: 16 }, (_, index) => `${String(index + 8).padStart(2, '0')}:00`);

/** A published snapshot unless `published` is false; `taken` cells unavailable, `missing` cells absent. */
function snapshot(published: boolean, taken: string[] = [], missing: string[] = []): AvailabilitySnapshot {
  const slots: AvailabilitySlot[] = published ? [1, 2, 3, 4, 5, 6, 7].flatMap(court => hours.filter(hour => !missing.includes(`${court}/${hour}`)).map(startTime => ({
    court, spaceId: `space-${court}`, date, bookingDate: date, startTime, endTime: `${String(Number(startTime.slice(0, 2)) + 1).padStart(2, '0')}:00`,
    isAvailable: !taken.includes(`${court}/${startTime}`), isNightRate: false, isNextDay: false, currency: 'PHP', price: Number(startTime.slice(0, 2)) >= 16 ? 700 : 600 }))) : [];
  return { capturedAt: new Date(releaseMs).toISOString(), fixtureKind: 'live', label: 'test', requestedDates: [date],
    returnedDates: published ? { [date]: true } : {}, incompleteDates: published ? [] : [date], slots, emptyUnreleasedResponse: !published };
}

async function withDirectory<T>(work: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), 'thirsty-slot-watch-'));
  try { return await work(directory); }
  finally { if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error('TEST_CLEANUP_PATH_INVALID'); await rm(directory, { recursive: true, force: true }); }
}
const lines = async (path: string) => (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);

describe('Release slot watch schedule', () => {
  it('launches an overlapping early burst at release, then the slower cadence, with public records far less often', () => {
    const { availability, bookings } = slotWatchSchedule();
    expect(availability[0]).toBe(-60_000);
    expect(availability.at(-1)).toBe(15 * 60_000);
    expect([...availability].sort((a, b) => a - b)).toEqual(availability);
    expect(SLOT_WATCH_EARLY_OFFSETS_MS).toEqual([0, 250, 500, 1_000, 2_000, 5_000]);
    for (const offset of SLOT_WATCH_EARLY_OFFSETS_MS) expect(availability).toContain(offset);
    // The early burst never needs more slots than the cap: six launches, six slots.
    expect(SLOT_WATCH_EARLY_OFFSETS_MS.length).toBeLessThanOrEqual(SLOT_WATCH_MAX_IN_FLIGHT);
    // Fewer planned reads in the first 10 s than the old serial 500 ms schedule (20).
    expect(availability.filter(offset => offset >= 0 && offset < 10_000).length).toBeLessThan(20);
    expect(bookings.filter(offset=>offset>=0&&offset<=30_000)).toEqual(Array.from({length:16},(_,index)=>index*2_000));
    expect(bookings.filter(offset=>offset>30_000&&offset<=120_000)).toEqual(Array.from({length:18},(_,index)=>35_000+index*5_000));
    expect(bookings.filter(offset=>offset>120_000&&offset<=570_000)).toEqual(Array.from({length:30},(_,index)=>135_000+index*15_000));
    expect(bookings.at(-1)).toBe(900_000);
    // 1 s reads across the hold-expiry window (+9:55 to +11:05): first-wave holds reopen 10 min after they were created.
    expect(availability.filter(offset => offset >= SLOT_WATCH_HOLD_EXPIRY_WINDOW_MS[0] && offset <= SLOT_WATCH_HOLD_EXPIRY_WINDOW_MS[1]))
      .toEqual(Array.from({ length: 71 }, (_, index) => 595_000 + index * 1_000));
  });
});

describe('Release slot watch', () => {
  it('adds a 500 ms publication burst after +2 s and stops only that burst once the date appears', () => withDirectory(async directory => {
    const clock=new VirtualClock(releaseMs-1_000);let calls=0;
    const watch=new SlotWatch({date,releaseMs,directory,now:clock.nowFn,sleep:clock.sleep,dynamicScheduling:true,
      schedule:{availability:[0,2_000,5_000],bookings:[]},
      readAvailability:(_date,signal)=>clock.delayed(40,()=>snapshot(++calls>=4),signal)});
    await clock.runUntil(watch.done);
    const reads=(await lines(watch.path)).filter(line=>line.type==='availability');
    expect(reads.map(line=>line.scheduledOffsetMs)).toEqual([0,2_000,2_500,3_000,3_500,5_000]);
    expect(reads.find(line=>line.scheduledOffsetMs===3_000)).toMatchObject({targetDatePresent:true});
    expect(reads.some(line=>Number(line.scheduledOffsetMs)>3_500&&Number(line.scheduledOffsetMs)<5_000)).toBe(false);
  }));

  it('derives a per-slot ten-minute expiry window and densifies public-booking reads around it',()=>withDirectory(async directory=>{
    const clock=new VirtualClock(releaseMs-1_000);
    const watch=new SlotWatch({date,releaseMs,directory,now:clock.nowFn,sleep:clock.sleep,dynamicScheduling:true,
      schedule:{availability:[0,6_000],bookings:[]},candidates:[{id:'c7',court:7,start:'19:00',end:'22:00'}],
      readAvailability:(_date,signal)=>{const offset=clock.now-releaseMs,taken=offset>=6_000&&offset<606_000?['7/19:00','7/20:00','7/21:00']:[];
        return clock.delayed(40,()=>({snapshot:snapshot(true,taken),cache:{status:'MISS',ageS:0}}),signal);},
      readBookings:(_date,signal)=>clock.delayed(40,()=>({blocks:[],failedCourts:[]}),signal)});
    return clock.runUntil(watch.done).then(async summary=>{
      const log=await lines(watch.path),window=log.find(line=>line.type==='expiry-window');
      expect(window).toMatchObject({court:7,hour:'19:00',holdDurationMs:600_000});
      expect(log.filter(line=>line.type==='bookings').map(line=>line.scheduledOffsetMs)).toContain(606_000);
      expect(summary.candidates[0]).toMatchObject({id:'c7',state:'FULLY_OPEN',reopening:'CONFIRMED',freshness:'ORIGIN_FRESH'});
    });
  }));

  it('keeps safe provider metadata and writes cache, latency, contradiction, candidate and booking coverage quality',()=>withDirectory(async directory=>{
    const clock=new VirtualClock(releaseMs-1_000);let call=0;
    const watch=new SlotWatch({date,releaseMs,directory,now:clock.nowFn,sleep:clock.sleep,candidates:[{id:'target',court:7,start:'19:00',end:'22:00'}],
      schedule:{availability:[1_000,2_000,12_000],bookings:[2_000]},
      readAvailability:(_date,signal)=>{call++;const taken=call===1?['7/19:00','7/20:00','7/21:00']:[];
        const cache=call===2?{status:'STALE',ageS:10}:{status:'MISS',ageS:0};
        return clock.delayed(40,()=>({snapshot:snapshot(true,taken),cache,provider:{vercelId:`sin1::safe-${call}`,date:'Thu, 24 Sep 2026 00:00:00 GMT',matchedPath:'/api/public/availability'}}),signal);},
      readBookings:(_date,signal)=>clock.delayed(40,()=>({blocks:[],failedCourts:[]}),signal)});
    return clock.runUntil(watch.done).then(async summary=>{
      expect(summary.current?.seq).toBe(3);
      expect(summary.candidates[0]).toMatchObject({state:'FULLY_OPEN',reopening:'CONFIRMED'});
      expect(summary.quality).toMatchObject({cache:{MISS:2,STALE:1},reopenings:{confirmed:3,inconsistent:0},candidateReopenings:1,
        bookingCoverage:{launched:1,answered:1,successfulCourtQueries:7,totalCourtQueries:7}});
      const availability=(await lines(watch.path)).filter(line=>line.type==='availability');
      expect(availability[0]).toMatchObject({provider:{vercelId:'sin1::safe-1',matchedPath:'/api/public/availability'}});
      expect(await readFile(summary.qualityReportPath!,'utf8')).toContain('"candidateReopenings": 1');
      expect(await readFile(summary.reportPath,'utf8')).toContain('SLOT WATCH QUALITY');
    });
  }));

  it('a slow first GET does not stop the later early reads from launching on time', () => withDirectory(async directory => {
    const clock = new VirtualClock(releaseMs - 1_000);
    let call = 0;
    const watch = new SlotWatch({ date, releaseMs, directory, now: clock.nowFn, sleep: clock.sleep,
      schedule: { availability: [...SLOT_WATCH_EARLY_OFFSETS_MS], bookings: [] },
      // The T+0 read takes 6 s; every later one 100 ms.
      readAvailability: (_date, signal) => clock.delayed(++call === 1 ? 6_000 : 100, () => snapshot(true), signal) });
    const summary = await clock.runUntil(watch.done);
    const reads = (await lines(watch.path)).filter(line => line.type === 'availability');
    expect(reads.map(line => [line.seq, line.requestOffsetMs, line.responseOffsetMs])).toEqual([
      [2, 250, 350], [3, 500, 600], [4, 1_000, 1_100], [5, 2_000, 2_100], [6, 5_000, 5_100], [1, 0, 6_000]]);
    expect(summary.availability).toMatchObject({ launched: 6, answered: 6, notLaunched: 0, maxInFlight: 2 });
  }));

  it('enforces the in-flight cap and records every launch the cap refused', () => withDirectory(async directory => {
    const clock = new VirtualClock(releaseMs - 1_000);
    const views: SlotWatchView[] = [];
    const watch = new SlotWatch({ date, releaseMs, directory, now: clock.nowFn, sleep: clock.sleep, maxInFlight: 3,
      schedule: { availability: [0, 250, 500, 1_000, 2_000, 7_000], bookings: [] },
      readAvailability: (_date, signal) => clock.delayed(5_000, () => snapshot(true), signal), onUpdate: view => views.push(view) });
    const summary = await clock.runUntil(watch.done);
    const log = await lines(watch.path);
    expect(log.filter(line => line.type === 'not-launched')).toMatchObject([
      { kind: 'availability', scheduledOffsetMs: 1_000, reason: 'CAP_REACHED', inFlight: 3 },
      { kind: 'availability', scheduledOffsetMs: 2_000, reason: 'CAP_REACHED', inFlight: 3 }]);
    // Refused launches are never observations.
    expect(log.filter(line => line.type === 'availability').map(line => line.scheduledOffsetMs)).toEqual([0, 250, 500, 7_000]);
    expect(summary.availability).toMatchObject({ launched: 4, answered: 4, notLaunched: 2, maxInFlight: 3 });
    expect(Math.max(...views.map(view => view.inFlight))).toBe(3);
  }));

  it('keeps request-order evidence when answers arrive out of order and never lets an older answer replace a newer one', () => withDirectory(async directory => {
    const clock = new VirtualClock(releaseMs - 1_000);
    // Prompt example: #2 started +250 answered +2.0 s OPEN; #3 started +500 answered +0.9 s unavailable (court 3 at 15:00).
    const plan = [{ ms: 100, value: snapshot(false) }, { ms: 1_750, value: snapshot(true) }, { ms: 400, value: snapshot(true, ['3/15:00']) }];
    let call = 0;
    const views: SlotWatchView[] = [];
    const watch = new SlotWatch({ date, releaseMs, directory, now: clock.nowFn, sleep: clock.sleep,
      schedule: { availability: [0, 250, 500], bookings: [] },
      readAvailability: (_date, signal) => { const next = plan[call++]!; return clock.delayed(next.ms, () => next.value, signal); }, onUpdate: view => views.push(view) });
    await clock.advance(releaseMs + 1_000);
    // After #3 answered (+0.9 s) and before #2 answers: the UI shows #3.
    const early = views.at(-1)!;
    expect(early.current).toEqual({ seq: 3, requestOffsetMs: 500, responseOffsetMs: 900 });
    expect(early.cells.find(cell => cell.court === 3 && cell.hour === '15:00')!.state).toBe('TAKEN');
    const summary = await clock.runUntil(watch.done);
    const late = views.at(-1)!;
    // #2 answered last, but it is the OLDER request: the current state stays #3.
    expect(late.current).toEqual({ seq: 3, requestOffsetMs: 500, responseOffsetMs: 900 });
    expect(late.cells.find(cell => cell.court === 3 && cell.hour === '15:00')!.state).toBe('TAKEN');
    // Raw log is in response order; seq keeps request order.
    expect((await lines(watch.path)).filter(line => line.type === 'availability').map(line => line.seq)).toEqual([1, 3, 2]);
    expect(summary.requestOrder.map(row => row.seq)).toEqual([1, 2, 3]);
    // The change is placed between #2 and #3 in request order and flagged as overlapping reads, not given a moment.
    expect(summary.openToUnavailable).toEqual([{ court: 3, hour: '15:00', record: null, overlapping: true,
      before: { seq: 2, requestOffsetMs: 250, responseOffsetMs: 2_000 }, after: { seq: 3, requestOffsetMs: 500, responseOffsetMs: 900 } }]);
    expect(summary.publication).toMatchObject({ lastUnpublished: { seq: 1 }, firstPublished: { seq: 2, requestOffsetMs: 250, responseOffsetMs: 2_000 },
      firstPublishedResponse: { seq: 3, requestOffsetMs: 500, responseOffsetMs: 900 } });
    const report = await readFile(summary.reportPath, 'utf8');
    expect(report).toContain('#2 request +0.250 s → response +2.000 s');
    expect(report).toContain('reads overlapped: their provider-side order is not established');
  }));

  it('persists request start, response, duration, completeness, the exact matrix and prices for every read', () => withDirectory(async directory => {
    const clock = new VirtualClock(releaseMs - 1_000);
    const watch = new SlotWatch({ date, releaseMs, directory, now: clock.nowFn, sleep: clock.sleep, schedule: { availability: [250], bookings: [] },
      readAvailability: (_date, signal) => clock.delayed(630, () => ({ snapshot: snapshot(true, ['1/08:00']), cache: { status: 'MISS', ageS: 0 } }), signal) });
    await clock.runUntil(watch.done);
    const [read] = (await lines(watch.path)).filter(line => line.type === 'availability');
    expect(read).toMatchObject({ seq: 1, scheduledOffsetMs: 250, requestOffsetMs: 250, responseOffsetMs: 880, durationMs: 630, outcome: 'ok',
      targetDatePresent: true, dateFlag: 'published', responseComplete: true, counts: { OPEN: 111, TAKEN: 1, UNRELEASED: 0, UNKNOWN: 0 },
      requestedAt: new Date(releaseMs + 250).toISOString(), respondedAt: new Date(releaseMs + 880).toISOString(), cache: { status: 'MISS', ageS: 0 } });
    expect(String(read!.matrix)).toMatch(/^1:XOOOOOOOOOOOOOOO,/);
    expect((read!.prices as number[][])[0]).toEqual([600, 600, 600, 600, 600, 600, 600, 600, 700, 700, 700, 700, 700, 700, 700, 700]);
  }));

  it('derives the first-published state and price of every cell; a missing cell stays unknown, never open', () => withDirectory(async directory => {
    const clock = new VirtualClock(releaseMs - 1_000);
    const plan = [snapshot(false), snapshot(true, ['2/19:00'], ['3/15:00']), snapshot(true, ['2/19:00'])];
    let call = 0;
    const watch = new SlotWatch({ date, releaseMs, directory, now: clock.nowFn, sleep: clock.sleep, schedule: { availability: [-500, 250, 1_000], bookings: [] },
      readAvailability: (_date, signal) => { const value = plan[call++]!; return clock.delayed(100, () => value, signal); } });
    const summary = await clock.runUntil(watch.done);
    const cell = (court: number, hour: string) => summary.cells.find(value => value.court === court && value.hour === hour)!;
    expect(cell(1, '08:00').firstPublished).toEqual({ state: 'OPEN', price: 600, observation: { seq: 2, requestOffsetMs: 250, responseOffsetMs: 350 } });
    expect(cell(2, '19:00').firstPublished).toMatchObject({ state: 'UNAVAILABLE', price: 700 });
    // Published date but the cell was missing: unknown (and not open) in the first published grid.
    expect(cell(3, '15:00').firstPublished).toEqual({ state: 'UNKNOWN', price: null, observation: { seq: 2, requestOffsetMs: 250, responseOffsetMs: 350 } });
    expect(cell(3, '15:00').firstOpen).toEqual({ seq: 3, requestOffsetMs: 1_000, responseOffsetMs: 1_100 });
    expect(summary.firstPublishedCounts).toEqual({ OPEN: 110, UNAVAILABLE: 1, UNKNOWN: 1 });
    const incomplete = (await lines(watch.path)).filter(line => line.type === 'availability')[1];
    expect(incomplete).toMatchObject({ responseComplete: false, counts: { UNKNOWN: 1 } });
    expect(summary.unavailableAtFirstPublication).toEqual([{ court: 2, hour: '19:00', record: null }]);
  }));

  it('detects OPEN → unavailable and unavailable → OPEN with the bracketing reads', () => withDirectory(async directory => {
    const clock = new VirtualClock(releaseMs - 1_000);
    const plan = [snapshot(true), snapshot(true, ['7/18:00']), snapshot(true)];
    let call = 0;
    const watch = new SlotWatch({ date, releaseMs, directory, now: clock.nowFn, sleep: clock.sleep, schedule: { availability: [250, 1_000, 600_000], bookings: [] },
      readAvailability: (_date, signal) => { const value = plan[call++]!; return clock.delayed(40, () => value, signal); } });
    const summary = await clock.runUntil(watch.done);
    expect(summary.openToUnavailable).toEqual([{ court: 7, hour: '18:00', record: null, overlapping: false,
      before: { seq: 1, requestOffsetMs: 250, responseOffsetMs: 290 }, after: { seq: 2, requestOffsetMs: 1_000, responseOffsetMs: 1_040 } }]);
    expect(summary.reopened).toEqual([{ court: 7, hour: '18:00', overlapping: false,confidence:'UNKNOWN',
      before: { seq: 2, requestOffsetMs: 1_000, responseOffsetMs: 1_040 }, after: { seq: 3, requestOffsetMs: 600_000, responseOffsetMs: 600_040 } }]);
    expect(summary.timeline.filter(entry => entry.kind === 'state').map(entry => `${entry.from}->${entry.to}`)).toEqual(['OPEN->UNAVAILABLE', 'UNAVAILABLE->OPEN']);
    expect(summary.stillOpen).toBe(112);
  }));

  it('reads public booking records on their own sparse schedule, one at a time, and keeps failed courts unknown', () => withDirectory(async directory => {
    const clock = new VirtualClock(releaseMs - 61_000);
    const reads: Array<{ ms: number; value: PublicBookingRecords }> = [
      { ms: 50, value: { blocks: [{ court: 3, startTime: '15:00', endTime: '16:00' }], failedCourts: [] } },
      // Court 3 fails here: its earlier record must not be reported as removed.
      { ms: 9_000, value: { blocks: [{ court: 7, startTime: '18:00', endTime: '19:00' }], failedCourts: [3] } },
      { ms: 50, value: { blocks: [{ court: 7, startTime: '18:00', endTime: '19:00' }], failedCourts: [] } },
    ];
    let call = 0;
    const watch = new SlotWatch({ date, releaseMs, directory, now: clock.nowFn, sleep: clock.sleep,
      schedule: { availability: [-60_000, 2_000], bookings: [-60_000, 2_000, 10_000, 30_000] },
      readAvailability: (_date, signal) => clock.delayed(50, () => snapshot(true, ['3/15:00', '7/18:00']), signal),
      readBookings: (_date, signal) => { const next = reads[call++]!; return clock.delayed(next.ms, () => next.value, signal); } });
    const summary = await clock.runUntil(watch.done);
    const log = await lines(watch.path);
    // The +2 s read took 9 s, so the +10 s booking read was not launched (and is recorded as such).
    expect(log.filter(line => line.type === 'not-launched')).toMatchObject([{ kind: 'bookings', scheduledOffsetMs: 10_000, reason: 'PREVIOUS_READ_IN_FLIGHT' }]);
    expect(log.filter(line => line.type === 'bookings').map(line => [line.seq, line.requestOffsetMs, line.responseOffsetMs, line.failedCourts]))
      .toEqual([[1, -60_000, -59_950, []], [2, 2_000, 11_000, [3]], [3, 30_000, 30_050, []]]);
    const cell = (court: number, hour: string) => summary.cells.find(value => value.court === court && value.hour === hour)!;
    expect(cell(7, '18:00').firstRecord).toEqual({ observation: { seq: 2, requestOffsetMs: 2_000, responseOffsetMs: 11_000 },
      previous: { seq: 1, requestOffsetMs: -60_000, responseOffsetMs: -59_950 } });
    expect(cell(3, '15:00').firstRecord?.observation.seq).toBe(1);
    // Removed only at b3 (court 3 answered again), never at b2 where court 3 failed.
    expect(cell(3, '15:00').recordRemoved).toEqual({ observation: { seq: 3, requestOffsetMs: 30_000, responseOffsetMs: 30_050 },
      previous: { seq: 1, requestOffsetMs: -60_000, responseOffsetMs: -59_950 } });
    expect(summary.bookings).toMatchObject({ launched: 3, answered: 3, notLaunched: 1, failedCourtQueries: 1 });
    expect(summary.timeline.filter(entry => entry.kind === 'record').map(entry => `${entry.court}/${entry.hour}:${entry.appeared}`)).toEqual(['7/18:00:true', '3/15:00:false']);
  }));

  it('writes neutral wording: unavailable without a public record is "cause unknown", never a venue block', () => withDirectory(async directory => {
    const clock = new VirtualClock(releaseMs - 1_000);
    const watch = new SlotWatch({ date, releaseMs, directory, now: clock.nowFn, sleep: clock.sleep,
      schedule: { availability: [250, 1_000], bookings: [2_000] },
      readAvailability: (_date, signal) => clock.delayed(40, () => snapshot(true, ['3/08:00', '1/14:00']), signal),
      readBookings: (_date, signal) => clock.delayed(40, () => ({ blocks: [{ court: 1, startTime: '14:00', endTime: '15:00' }], failedCourts: [] }), signal) });
    const summary = await clock.runUntil(watch.done);
    const report = await readFile(summary.reportPath, 'utf8');
    expect(report).toContain('8 AM (no matching public booking record · cause unknown)');
    expect(report).toContain('2 PM (public booking record, first seen +2.040 s)');
    expect(report).toContain('A public booking record shows that a booking record exists. It does not show who made it or why.');
    expect(report).not.toMatch(/venue|admin|bot hold|likely|competitor|taken/i);
    expect(JSON.stringify(summary)).not.toMatch(/venue|admin block|bot hold|likely/i);
  }));

  it('stops on request, cancels in-flight reads and never reads again', () => withDirectory(async directory => {
    const clock = new VirtualClock(releaseMs - 1_000);
    let reads = 0;
    const watch = new SlotWatch({ date, releaseMs, directory, now: clock.nowFn, sleep: clock.sleep, schedule: { availability: [0, 250, 60_000], bookings: [] },
      readAvailability: (_date, signal) => { reads++; return clock.delayed(10_000, () => snapshot(true), signal); } });
    await clock.advance(releaseMs + 300);
    const summary = await watch.stop('release cancelled');
    expect(summary).toMatchObject({ status: 'stopped', reason: 'release cancelled', availability: { launched: 2, aborted: 2, answered: 0 } });
    await clock.advance(releaseMs + 120_000);
    expect(reads).toBe(2);
  }));

  it('records a failed read without changing the last known matrix, and a late launch as not launched', () => withDirectory(async directory => {
    const clock = new VirtualClock(releaseMs);
    let call = 0;
    const watch = new SlotWatch({ date, releaseMs, directory, now: clock.nowFn, sleep: async (ms, signal) => {
      // Simulates the PC sleeping through the +5 s launch: that scheduler wait overshoots to +7 s (read timeouts are 15 s timers).
      if (ms !== 15_000 && clock.now < releaseMs + 5_000 && clock.now + ms >= releaseMs + 5_000) { clock.now = releaseMs + 7_000; return; }
      return clock.sleep(ms, signal);
    }, schedule: { availability: [250, 750, 5_000], bookings: [] },
    readAvailability: (_date, signal) => ++call === 2 ? Promise.reject(Error('AVAILABILITY_RATE_LIMITED')) : clock.delayed(20, () => snapshot(true), signal) });
    const summary = await clock.runUntil(watch.done);
    expect(summary.availability).toMatchObject({ launched: 2, answered: 1, failed: 1, notLaunched: 1 });
    expect(summary.stillOpen).toBe(112);
    const log = await lines(watch.path);
    expect(log.filter(line => line.type === 'availability')[1]).toMatchObject({ outcome: 'failed', code: 'AVAILABILITY_RATE_LIMITED', responseComplete: false });
    expect(log.find(line => line.type === 'not-launched')).toMatchObject({ scheduledOffsetMs: 5_000, reason: 'LATE' });
  }));

  it('times out a read that never answers, and records the clock offset in effect', () => withDirectory(async directory => {
    const clock = new VirtualClock(releaseMs - 1_000);
    let offset = 43.4;
    const watch = new SlotWatch({ date, releaseMs, directory, now: clock.nowFn, sleep: clock.sleep, readTimeoutMs: 15_000, clockOffset: () => offset,
      schedule: { availability: [-500, 0], bookings: [] },
      readAvailability: (_date, signal) => { offset = 52.1; return clock.delayed(60_000, () => snapshot(true), signal); } });
    const summary = await clock.runUntil(watch.done);
    const log = await lines(watch.path);
    expect(log.filter(line => line.type === 'availability').map(line => [line.code, line.durationMs])).toEqual([['AVAILABILITY_READ_TIMEOUT', 15_000], ['AVAILABILITY_READ_TIMEOUT', 15_000]]);
    expect(log.filter(line => line.type === 'clock').map(line => line.offsetMs)).toEqual([43.4, 52.1]);
    expect(summary.clockOffsetMs).toBe(52.1);
  }));

  it('lists finished watches as light digests (no per-cell evidence) and keeps older files as legacy entries', () => withDirectory(async directory => {
    const clock = new VirtualClock(releaseMs - 1_000);
    const watch = new SlotWatch({ date, releaseMs, directory, now: clock.nowFn, sleep: clock.sleep, schedule: { availability: [250], bookings: [] },
      readAvailability: (_date, signal) => clock.delayed(40, () => snapshot(true), signal) });
    await clock.runUntil(watch.done);
    await writeFile(join(directory, '2026-09-19_legacy.summary.json'), JSON.stringify({ version: 1, id: 'legacy', date: '2026-09-19', releaseMs, polls: 10, failedPolls: 1,
      taken: [], neverOpen: [], reopened: [], finalMatrix: '1:OOOOOOOOOOOOOOOO', reportPath: 'old.txt', logPath: 'old.ndjson', timeline: [] }));
    const history = readSlotWatchHistory(directory);
    expect(history.map(entry => entry.id).sort()).toEqual(['legacy', watch.id].sort());
    const current = history.find(entry => entry.id === watch.id)!;
    expect(current).not.toHaveProperty('cells');
    expect(current).not.toHaveProperty('requestOrder');
    expect(history.find(entry => entry.id === 'legacy')).toMatchObject({ legacy: true, availability: { answered: 9, failed: 1 }, finalMatrix: '1:OOOOOOOOOOOOOOOO' });
  }));
});
