import type { CheckoutDiagnostic } from './checkout-diagnostics.js';

export class SubmissionDispatchError extends Error {
  constructor(readonly code: string, readonly dispatched: boolean,
    readonly diagnostic?: CheckoutDiagnostic) {
    super(code);
    this.name = 'SubmissionDispatchError';
  }
}
