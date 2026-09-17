export class SubmissionDispatchError extends Error {
  constructor(readonly code: string, readonly dispatched: boolean,
    readonly diagnostic?: { status: number; category: 'http-rejection' | 'invalid-response'; applicationCode?: string }) {
    super(code);
    this.name = 'SubmissionDispatchError';
  }
}
