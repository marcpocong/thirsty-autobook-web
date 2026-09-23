import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SlotWatch, readSlotWatchHistory, slotWatchSchedule, type SlotWatchView } from '../src/slot-watch.js';
import type { AvailabilitySlot, AvailabilitySnapshot } from '../src/api-booking/types.js';
import type { PublicBookingRecords } from '../src/api-booking/public-bookings.js';

const date = '2026-09-26';
const releaseMs = Date.parse('2026-09-24T00:00:00.000Z');
const hours = Array.from({ length: 16 }, (_, index) => `${String(index + 8).padStart(2, '0')}:00`);

function snapshot(released: boolean, taken: string[] = []): AvailabilitySnapshot {
  const slots: AvailabilitySlot[] = released ? [1, 2, 3, 4, 5, 6, 7].flatMap(court => hours.map(startTime => ({
    court, spaceId: `space-${court}`, date, bookingDate: date, startTime, endTime: `${String(Number(startTime.slice(0, 2)) + 1).padStart(2, '0')}:00`,
    isAvailable: !taken.includes(`${court}/${startTime}`), isNightRate: false, isNextDay: false, currency: 'PHP', price: 600 }))) : [];
  return { capturedAt: new Date(releaseMs).toISOString(), fixtureKind: 'live', label: 'test', requestedDates: [date],
    returnedDates: { [date]: released }, incompleteDates: released ? [] : [date], slots };
}

async function withDirectory<T>(work: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(join(tmpdir(), 'thirsty-slot-watch-'));
  try { return await work(directory); }
  finally { if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error('TEST_CLEANUP_PATH_INVALID'); await rm(directory, { recursive: true, force: true }); }
}

describe('Release slot watch', () => {
  it('reads densely right after release and keeps watching for fifteen minutes', () => {
    const schedule = slotWatchSchedule(), offsets = schedule.map(entry => entry.offsetMs);
    expect(offsets[0]).toBe(-60_000);
    expect(offsets.at(-1)).toBe(15 * 60_000);
    expect(offsets.filter(offset => offset > 0 && offset < 10_000).length).toBeGreaterThanOrEqual(20);
    expect(schedule.find(entry => entry.offsetMs === 2_000)?.bookings).toBe(true);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it('records exact timestamps for publication, takes, booking records and reopenings', () => withDirectory(async directory => {
    let now = releaseMs - 60_000;
    // Each read: [offset from release, availability, booking records or undefined]
    const reads: Array<[number, AvailabilitySnapshot, PublicBookingRecords | undefined]> = [
      [-60_000, snapshot(false), { blocks: [], failedCourts: [] }],
      [250, snapshot(true, ['1/19:00']), undefined],
      [750, snapshot(true, ['1/19:00', '7/18:00']), undefined],
      [2_000, snapshot(true, ['1/19:00', '7/18:00']), { blocks: [{ court: 7, startTime: '18:00', endTime: '19:00' }], failedCourts: [] }],
      [600_000, snapshot(true, ['1/19:00']), undefined],
    ];
    let index = 0;
    const updates: SlotWatchView[] = [];
    const watch = new SlotWatch({ date, releaseMs, directory, now: () => now, clockOffsetMs: -12, clockSynced: true,
      schedule: reads.map(([offsetMs, , bookings]) => ({ offsetMs, bookings: bookings !== undefined })),
      sleep: async ms => { now += ms; },
      // Each read takes 40 ms of network time.
      readAvailability: async () => { const value = reads[index]![1]; now += 40; return value; },
      readBookings: async () => reads[index]![2]!,
      onUpdate: view => { updates.push(view); if (view.polls > index) index = view.polls; } });
    const summary = await watch.done;

    expect(summary).toMatchObject({ status: 'finished', polls: 5, failedPolls: 0, medianLatencyMs: 40, openAtFirstRead: 111,
      releaseVisibleSinceReleaseMs: 290, fastestTakeMs: 790, stillOpen: 111 });
    expect(summary.taken).toEqual([{ court: 7, hour: '18:00', openedSinceReleaseMs: 290, takenSinceReleaseMs: 790, windowMs: 500, recordSinceReleaseMs: 2040 }]);
    expect(summary.neverOpen).toEqual([{ court: 1, hour: '19:00', record: false }]);
    expect(summary.reopened).toEqual([{ court: 7, hour: '18:00', sinceReleaseMs: 600_040 }]);

    // The UI timeline summarizes the 112-cell publication instead of listing every cell.
    const kinds = summary.timeline.map(entry => entry.kind);
    expect(kinds.filter(kind => kind === 'published')).toHaveLength(1);
    expect(summary.timeline.find(entry => entry.kind === 'published')).toMatchObject({ openCount: 111, takenCount: 1, sinceReleaseMs: 290 });
    expect(summary.timeline.find(entry => entry.kind === 'record')).toMatchObject({ court: 7, hour: '18:00', appeared: true, sinceReleaseMs: 2040 });
    const cell = updates.at(-1)!.cells.find(value => value.court === 7 && value.hour === '18:00')!;
    expect(cell).toMatchObject({ state: 'OPEN', record: true, changedSinceReleaseMs: 600_040 });
    expect(updates.at(-1)!.cells.find(value => value.court === 2 && value.hour === '08:00')!.changedSinceReleaseMs).toBeUndefined();

    // The log keeps every read and every per-cell transition with network-clock timestamps.
    const lines = (await readFile(watch.path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(lines[0]).toMatchObject({ type: 'header', date, clockOffsetMs: -12, clockSynced: true });
    const polls = lines.filter(line => line.type === 'poll');
    expect(polls).toHaveLength(5);
    expect(polls[0]).toMatchObject({ seq: 1, latencyMs: 40, sinceReleaseMs: -59_960, dateReleased: false, matrix: expect.stringMatching(/^1:U{16},/) });
    expect(polls[1]!.requestedAt).toBe(new Date(releaseMs + 250).toISOString());
    expect(polls[1]!.respondedAt).toBe(new Date(releaseMs + 290).toISOString());
    expect(lines.filter(line => line.type === 'change' && line.kind === 'state' && line.from === 'UNRELEASED')).toHaveLength(112);
    expect(lines.at(-1)).toMatchObject({ type: 'summary', fastestTakeMs: 790 });

    const report = await readFile(summary.reportPath, 'utf8');
    expect(report).toContain('Fastest take: +0.790 s');
    expect(report).toContain('Court 7 6 PM');
    expect(report).toContain('Court 1: 7 PM (no booking record — likely venue block)');
    expect(readSlotWatchHistory(directory).map(entry => entry.id)).toEqual([watch.id]);
  }));

  it('stops early on request and never reads again', () => withDirectory(async directory => {
    let now = releaseMs - 60_000, reads = 0;
    let release!: () => void;
    const blocked = new Promise<void>(done => { release = done; });
    const watch = new SlotWatch({ date, releaseMs, directory, now: () => now,
      sleep: async (ms, signal) => { if (now + ms >= releaseMs) { signal.addEventListener('abort', () => release(), { once: true }); await blocked; return; } now += ms; },
      readAvailability: async () => { reads++; return snapshot(false); }, readBookings: async () => ({ blocks: [], failedCourts: [] }) });
    await new Promise(done => setTimeout(done, 5));
    const summary = await watch.stop('release cancelled');
    expect(summary).toMatchObject({ status: 'stopped', reason: 'release cancelled' });
    const before = reads;
    await new Promise(done => setTimeout(done, 5));
    expect(reads).toBe(before);
    expect(reads).toBeGreaterThan(0);
  }));

  it('records a failed read without changing the last known matrix', () => withDirectory(async directory => {
    let now = releaseMs, call = 0;
    const watch = new SlotWatch({ date, releaseMs, directory, now: () => now,
      schedule: [{ offsetMs: 250, bookings: false }, { offsetMs: 750, bookings: false }], sleep: async ms => { now += ms; },
      readAvailability: async () => { if (++call === 2) throw Error('AVAILABILITY_RATE_LIMITED'); return snapshot(true); } });
    const summary = await watch.done;
    expect(summary).toMatchObject({ polls: 2, failedPolls: 1, stillOpen: 112 });
    const lines = (await readFile(watch.path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(lines.filter(line => line.type === 'poll')[1]).toMatchObject({ availability: 'failed', code: 'AVAILABILITY_RATE_LIMITED' });
  }));
});
