import type { SubmissionState } from './durable-submission-journal.js';
import { SubmissionDispatchError } from './submission-errors.js';

/** Release only when no verified hold exists and checkout is proven unsent or every journal is rejected. */
export function canReleaseApiLockAfterFailure(verifiedHold:boolean,error:unknown,states:SubmissionState[]):boolean {
  if(verifiedHold)return false;
  return error instanceof SubmissionDispatchError&&!error.dispatched||states.length>0&&states.every(state=>state==='rejected');
}
