import {describe,expect,it} from 'vitest';
import {canReleaseApiLockAfterFailure} from '../../src/api-booking/api-lock-outcome.js';
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
