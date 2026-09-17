export class SubmissionDispatchError extends Error {
  constructor(readonly code: string, readonly dispatched: boolean) {
    super(code);
    this.name = 'SubmissionDispatchError';
  }
}
