import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableSubmissionJournal, type SubmissionRecord } from '../../src/api-booking/durable-submission-journal.js';
import { firstUnjournaledCandidate } from '../../src/api-booking/candidate-journal.js';
import type { BookingPlan } from '../../src/api-booking/types.js';

const key = 'a'.repeat(64);
const now = new Date('2026-09-21T04:00:00.000Z');
async function cleanup(root: string) {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw Error('TEST_CLEANUP_PATH_INVALID');
  await rm(root, { recursive: true, force: true });
}
const record = (state: SubmissionRecord['state'], expiries: string[]): SubmissionRecord => ({
  key, state, createdAt: '2026-09-21T03:55:00.000Z', updatedAt: '2026-09-21T03:56:00.000Z',
  attempt: { attemptId: key, planFingerprint: key, targetDate: '2026-09-21', courtIds: [7],
    hourlyBoundaries: [{ startTime: '12:00', endTime: '13:00' }], expectedBookingCount: 1,
    maximumAmount: 600, stage: 'dispatching' },
  observedResponse: { success: true, bookingIds: ['booking-1'], bookingNumbers: ['number-1'],
    bookingSessionIds: ['session-1'], holdExpiresAt: expiries, validationCode: 'CHECKOUT_RESPONSE_VERIFIED' },
});

describe('expired API hold reuse', () => {
  it('archives a confirmed rejected attempt but keeps an uncertain attempt blocked', async () => {
    const root=await mkdtemp(join(tmpdir(),'thirsty-rejected-journal-'));
    try {
      const directory=join(root,key),journal=new DurableSubmissionJournal(directory);
      await mkdir(directory);
      await writeFile(join(directory,`${key}.json`),JSON.stringify({...record('rejected',[]),observedResponse:undefined,failureCode:'ONDA_HTTP_STATUS_INVALID'}));
      expect(await journal.recycleReusable(key,now)).toBe('reused');
      expect((await readdir(join(root,'rejected-attempts')))).toHaveLength(1);
      await mkdir(directory);
      await writeFile(join(directory,`${key}.json`),JSON.stringify({...record('unknown',[]),observedResponse:undefined}));
      expect(await journal.recycleReusable(key,now)).toBe('blocked');
    }finally{await cleanup(root);}
  });
  it('archives a verified expired hold and permits a fresh journal for the same block', async () => {
    const root = await mkdtemp(join(tmpdir(), 'thirsty-expired-journal-'));
    try {
      const directory = join(root, key), journal = new DurableSubmissionJournal(directory);
      await mkdir(directory); await writeFile(join(directory, `${key}.json`), JSON.stringify(record('verified', ['2026-09-21T03:59:59.000Z'])));
      await writeFile(join(directory, 'checkout-response-private.json'), 'previous response');
      expect(await journal.recycleExpiredVerified(key, now)).toBe('reused');
      const archived = join(root, 'expired-holds', (await readdir(join(root, 'expired-holds')))[0]!);
      expect(JSON.parse(await readFile(join(archived, `${key}.json`), 'utf8'))).toMatchObject({ state: 'verified' });
      expect(await readFile(join(archived, 'checkout-response-private.json'), 'utf8')).toBe('previous response');
      await journal.begin(key, now); expect((await journal.read(key)).state).toBe('dispatching');
    } finally { await cleanup(root); }
  });

  it('selects an expired preferred candidate again after archiving its prior journal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'thirsty-repeat-candidate-'));
    try {
      const facilityId='facility',spaceId='court-7',date='2026-09-21',startTime='12:00',endTime='13:00';
      const logicalKey=DurableSubmissionJournal.key(facilityId,spaceId,date,startTime,endTime);
      const directory=join(root,logicalKey),journal=new DurableSubmissionJournal(directory);
      await mkdir(directory);await writeFile(join(directory,`${logicalKey}.json`),JSON.stringify({ ...record('verified',['2026-09-21T03:59:59.000Z']),key:logicalKey,attempt:{...record('verified',[]).attempt,attemptId:logicalKey} }));
      const court={court:7,spaceId,date,startTime,endTime,durationMinutes:60,price:600,currency:'PHP',slots:[]};
      const plan:BookingPlan={mode:'standard',targetDate:date,startTime,endTime,durationHours:1,courts:[court],chunks:[{startTime,endTime,durationHours:1,courts:[court],totalPrice:600}],totalPrice:600,currency:'PHP'};
      const selected=await firstUnjournaledCandidate([plan],facilityId,async currentKey=>(await new DurableSubmissionJournal(join(root,currentKey)).recycleExpiredVerified(currentKey,now))==='blocked');
      expect(selected?.plan).toBe(plan);
      expect(await journal.recycleExpiredVerified(logicalKey,now)).toBe('unused');
    }finally{await cleanup(root);}
  });

  it('archives a prior hold only once when two selectors race for the same key', async () => {
    const root=await mkdtemp(join(tmpdir(),'thirsty-recycle-race-'));
    try {
      const directory=join(root,key),journal=new DurableSubmissionJournal(directory);
      await mkdir(directory);await writeFile(join(directory,`${key}.json`),JSON.stringify(record('verified',['2026-09-21T03:59:59.000Z'])));
      const outcomes=await Promise.all([journal.recycleExpiredVerified(key,now),journal.recycleExpiredVerified(key,now)]);
      expect(outcomes.filter(value=>value==='reused')).toHaveLength(1);
      expect((await readdir(join(root,'expired-holds')))).toHaveLength(1);
    }finally{await cleanup(root);}
  });

  it.each([
    ['active', 'verified', ['2026-09-21T04:00:01.000Z']],
    ['unknown', 'unknown', ['2026-09-21T03:59:59.000Z']],
    ['missing expiry', 'verified', []],
  ] as const)('keeps %s attempts blocked', async (_label, state, expiries) => {
    const root = await mkdtemp(join(tmpdir(), 'thirsty-blocked-journal-'));
    try {
      const directory = join(root, key), journal = new DurableSubmissionJournal(directory);
      await mkdir(directory); await writeFile(join(directory, `${key}.json`), JSON.stringify(record(state, [...expiries])));
      expect(await journal.recycleExpiredVerified(key, now)).toBe('blocked');
      expect((await journal.read(key)).state).toBe(state);
    } finally { await cleanup(root); }
  });
});
