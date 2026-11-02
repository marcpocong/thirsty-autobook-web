import {describe,it,expect} from 'vitest';
import {assessHoldNotices,type HoldNotice,type HoldTarget} from '../src/hold-preflight.js';
import {pendingFixture,fixtureNow} from './helpers/pending-hold-fixture.js';
import {readPossibleHolds} from '../src/api-booking/possible-hold.js';
import {appendHoldVerification} from '../src/api-booking/pending-hold-state.js';
import {readCheckoutRecoveryRecord,recoveryHash} from '../src/api-booking/checkout-recovery.js';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableSubmissionJournal} from '../src/api-booking/durable-submission-journal.js';

const now=Date.parse('2026-11-03T22:00:00Z'),target:HoldTarget={date:'2026-11-05',court:5,startTime:'19:00',endTime:'22:00'};
const old:HoldNotice={date:'2026-11-03',courts:[5],startTime:'19:00',endTime:'22:00',holdExpiresAt:'2026-11-01T00:10:00Z',dismissible:true};
const classify=(h:HoldNotice,t=target)=>assessHoldNotices([h],[t],now);
describe('expired-advertisement history versus current-plan blockers',()=>{
  it('keeps quiet elapsed nonoverlapping records as unconfirmed history, independently of archival',()=>{
    const bytes=JSON.stringify(old);expect(classify(old)).toEqual({blocking:0,historical:1,providerResolved:0});expect(JSON.stringify(old)).toBe(bytes);
  });
  it('keeps the original date/court/hour UNKNOWN barrier even when the timer elapsed or provider expiry is known',()=>{
    for(const providerResolution of [undefined,'EXPIRED','PAID'] as const)expect(classify({...old,providerResolution},{...target,date:old.date}).blocking).toBe(1);
  });
  it('does not make recent UNKNOWN records or active advertised holds safe for another date',()=>{
    for(const h of [{...old,dismissible:false},{...old,dismissible:undefined},{...old,latestHoldExpiresAt:new Date(now+1).toISOString()}])expect(classify(h).blocking).toBe(1);
  });
  it('uses the last expiry across all hourly children, including mixed-offset timestamps',()=>{
    expect(classify({...old,holdExpiresAt:'2026-11-03T21:00:00Z',latestHoldExpiresAt:'2026-11-04T07:00:00+08:00'}).blocking).toBe(1);
  });
  it('fails closed on malformed dates, hours, expiry, missing plan, untrusted clock or mismatched verification',()=>{
    for(const h of [{...old,date:'2026-02-31'},{...old,startTime:'garbage'},{...old,holdExpiresAt:'bad'},{...old,courts:[]},{...old,verificationInvalid:true}])expect(classify(h).blocking).toBe(1);
    expect(assessHoldNotices([old],[],now).blocking).toBe(1);expect(assessHoldNotices([old],[target],NaN).blocking).toBe(1);
  });
  it('recognizes bound provider terminal evidence without calling an unavailable checkout confirmed expiry',()=>{
    for(const providerResolution of ['EXPIRED','UNAVAILABLE','PAID'] as const)expect(classify({...old,providerResolution,dismissible:false}).providerResolved).toBe(1);
    expect(classify({...old,providerResolution:'UNAVAILABLE',latestHoldExpiresAt:new Date(now+1).toISOString()}).blocking).toBe(1);
  });
  it('checks overlapping hours, court identity and wing identity',()=>{
    expect(classify(old,{...target,date:old.date,startTime:'21:00',endTime:'23:00'}).blocking).toBe(1);
    expect(classify(old,{...target,date:old.date,startTime:'22:00',endTime:'23:00'}).historical).toBe(1);
    expect(classify(old,{...target,date:old.date,wing:'BUKO'}).historical).toBe(1);
    expect(classify(old,{...target,date:old.date,court:6}).historical).toBe(1);
  });
  it('reads separately bound expiry evidence while keeping the original UNKNOWN journal byte-identical and duplicate-blocked',async()=>{
    const root=await mkdtemp(join(tmpdir(),'hold-preflight-')),f=await pendingFixture(root,'A',5);
    // Synthetic fixture for a historical parser failure, not a production state transition.
    const unknown=JSON.parse(await readFile(f.journalPath,'utf8'));unknown.state='unknown';unknown.failureCode='ORIGINAL_UNKNOWN';await writeFile(f.journalPath,JSON.stringify(unknown));
    const bytes=await readFile(f.journalPath),captured=await readCheckoutRecoveryRecord(f.directory);
    await appendHoldVerification(f.directory,{at:new Date(fixtureNow.getTime()+700_000).toISOString(),responseHash:captured.responseHash,journalHash:recoveryHash(bytes),
      local:'LOCAL_RESPONSE_VALID',provider:'EXPIRED_OR_UNAVAILABLE',qr:'NOT_CHECKED',code:'PROVIDER_HOLD_EXPIRED',contradiction:false,httpStatus:200,milestones:[]});
    expect((await readPossibleHolds(root))[0]).toMatchObject({providerResolution:'EXPIRED',latestHoldExpiresAt:f.expiry});
    expect(await readFile(f.journalPath)).toEqual(bytes);
    await expect(new DurableSubmissionJournal(f.directory).begin(f.key)).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
    for(const httpStatus of [403,404]){
      await appendHoldVerification(f.directory,{at:new Date(fixtureNow.getTime()+700_000).toISOString(),responseHash:captured.responseHash,journalHash:recoveryHash(bytes),
        local:'LOCAL_RESPONSE_VALID',provider:'EXPIRED_OR_UNAVAILABLE',qr:'NOT_CHECKED',code:'PROVIDER_HOLD_EXPIRED',contradiction:false,httpStatus,milestones:[]});
      expect((await readPossibleHolds(root))[0]!.providerResolution).toBeUndefined();
    }
    await appendHoldVerification(f.directory,{at:new Date(fixtureNow.getTime()+700_000).toISOString(),responseHash:captured.responseHash,journalHash:recoveryHash(bytes),
      local:'LOCAL_RESPONSE_VALID',provider:'EXPIRED_OR_UNAVAILABLE',qr:'NOT_CHECKED',code:'PROVIDER_HOLD_EXPIRED',contradiction:false,httpStatus:200,milestones:[]});
    await writeFile(f.journalPath,Buffer.concat([bytes,Buffer.from('\n')]));
    expect((await readPossibleHolds(root))[0]).toMatchObject({verificationInvalid:true});expect((await readPossibleHolds(root))[0]!.providerResolution).toBeUndefined();
  });
});
