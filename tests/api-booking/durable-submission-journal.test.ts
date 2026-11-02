import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableSubmissionJournal } from '../../src/api-booking/durable-submission-journal.js';

describe('durable submission journal', () => {
  it('persists a bounded date-publication rejection without turning it into UNKNOWN',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'onda-date-rejection-'));
    try{const journal=new DurableSubmissionJournal(directory),key=DurableSubmissionJournal.key('facility','court','2026-11-05','19:00','22:00');
      await journal.begin(key);await journal.mark(key,'rejected',new Date(),{status:400,category:'http-rejection',contentKind:'json',responseSource:'application',errorHint:'date-unavailable'});
      expect(JSON.parse(await readFile(join(directory,`${key}.json`),'utf8'))).toMatchObject({state:'rejected',diagnostic:{status:400,errorHint:'date-unavailable'}});
    }finally{await rm(directory,{recursive:true,force:true});}
  });
  it('blocks concurrent callers and restart replay without storing sensitive material', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'onda-submission-'));
    try {
      const first = new DurableSubmissionJournal(directory);
      const second = new DurableSubmissionJournal(directory);
      const key = DurableSubmissionJournal.key('facility', 'court', '2026-09-18', '08:00', '10:00');
      const outcomes = await Promise.allSettled([first.begin(key), second.begin(key)]);
      expect(outcomes.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      await expect(new DurableSubmissionJournal(directory).begin(key)).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
      await first.mark(key, 'unknown');
      await expect(second.begin(key)).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
      const record = await readFile(join(directory, `${key}.json`), 'utf8');
      expect(record).not.toMatch(/proof|token|customer|email|cookie/i);
      expect(JSON.parse(record)).toMatchObject({ key, state: 'unknown' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
