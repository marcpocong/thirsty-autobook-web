import {describe,expect,it} from 'vitest';
import {canReleaseApiLockAfterFailure,canReleaseApiLockAfterParallelFailure} from '../../src/api-booking/api-lock-outcome.js';
import {SubmissionDispatchError} from '../../src/api-booking/submission-errors.js';

describe('API lock failure outcome',()=>{
  it('releases a first-checkout lock when security preparation proves no checkout was sent',()=>{
    expect(canReleaseApiLockAfterFailure(false,new SubmissionDispatchError('ONDA_SECURITY_BUNDLE_CHANGED',false),['unknown'])).toBe(true);
  });
  it('retains the lock after any possible dispatch or verified hold',()=>{
    expect(canReleaseApiLockAfterFailure(false,new SubmissionDispatchError('ONDA_TRANSPORT_FAILED',true),['unknown'])).toBe(false);
    expect(canReleaseApiLockAfterFailure(true,new SubmissionDispatchError('ONDA_SECURITY_BUNDLE_CHANGED',false),['rejected'])).toBe(false);
  });
  it('keeps the existing all-rejected journal recovery',()=>{
    expect(canReleaseApiLockAfterFailure(false,Error('PRECHECK_FAILED'),['rejected','rejected'])).toBe(true);
    expect(canReleaseApiLockAfterFailure(false,Error('PRECHECK_FAILED'),[])).toBe(false);
  });
});

describe('parallel API lock failure outcome',()=>{
  it('releases only when every worker proves checkout was not sent',()=>{
    const unsent=new SubmissionDispatchError('ONDA_SECURITY_BUNDLE_CHANGED',false);
    expect(canReleaseApiLockAfterParallelFailure(false,[unsent,unsent],['unknown','unknown'],2)).toBe(true);
    expect(canReleaseApiLockAfterParallelFailure(false,[unsent],['unknown','unknown'],2)).toBe(false);
  });
  it('retains the lock when another worker may have dispatched or created a hold',()=>{
    const unsent=new SubmissionDispatchError('ONDA_SECURITY_BUNDLE_CHANGED',false);
    const sent=new SubmissionDispatchError('ONDA_TRANSPORT_FAILED',true);
    expect(canReleaseApiLockAfterParallelFailure(false,[unsent,sent],['rejected','unknown'],2)).toBe(false);
    expect(canReleaseApiLockAfterParallelFailure(true,[unsent,unsent],['rejected','rejected'],2)).toBe(false);
  });
  it('allows the durable all-rejected recovery path',()=>{
    expect(canReleaseApiLockAfterParallelFailure(false,[Error('PRECHECK_FAILED')],['rejected','rejected'],2)).toBe(true);
  });
});
