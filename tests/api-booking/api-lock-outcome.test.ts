import {describe,expect,it} from 'vitest';
import {canReleaseApiLockAfterFailure,canReleaseApiLockAfterParallelFailure,conclusiveNoHoldFromStates} from '../../src/api-booking/api-lock-outcome.js';
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

describe('single-attempt conclusive-no-hold classification (drives A-D/E-F/G-H safe retry)',()=>{
  it('is safe to retry only when every journal for the attempt is rejected',()=>{
    expect(conclusiveNoHoldFromStates(['rejected','rejected'],Error('irrelevant'))).toBe(true);
    expect(conclusiveNoHoldFromStates(['rejected','unknown'],Error('irrelevant'))).toBe(false);
    expect(conclusiveNoHoldFromStates(['verified'],Error('irrelevant'))).toBe(false);
    expect(conclusiveNoHoldFromStates(['unknown'],Error('irrelevant'))).toBe(false);
  });
  it('falls back to the dispatch error only when no journal record exists yet',()=>{
    expect(conclusiveNoHoldFromStates([undefined],new SubmissionDispatchError('CURRENT_CHECKOUT_HEADERS_INVALID',false))).toBe(true);
    expect(conclusiveNoHoldFromStates([undefined],new SubmissionDispatchError('ONDA_TRANSPORT_FAILED',true))).toBe(false);
    expect(conclusiveNoHoldFromStates([undefined,undefined],Error('unexpected'))).toBe(false);
  });
  it('never permits retry for an unknown or verified journal, regardless of the error',()=>{
    expect(conclusiveNoHoldFromStates(['unknown'],new SubmissionDispatchError('X',false))).toBe(false);
    expect(conclusiveNoHoldFromStates(['verified'],new SubmissionDispatchError('X',false))).toBe(false);
  });
  it('never treats a verified hold as safe just because the caller-visible error is an ordinary post-hold failure',()=>{
    // Regression: a proof-based attempt can push a verified hold and only fail
    // later during QR-page restoration (missing token, access grant, state
    // mismatch), which throws a plain Error unrelated to dispatch. The journal
    // — already 'verified' by that point — must be the decisive signal, not
    // the exception's type or message.
    expect(conclusiveNoHoldFromStates(['verified'],Error('OFFICIAL_CHECKOUT_TOKEN_MISSING'))).toBe(false);
    expect(conclusiveNoHoldFromStates(['verified'],Error('OFFICIAL_CHECKOUT_ACCESS_FAILED'))).toBe(false);
    expect(conclusiveNoHoldFromStates(['verified'],Error('OFFICIAL_CHECKOUT_STATE_MISMATCH'))).toBe(false);
  });
});
