export type AdaptiveLaneCommitment = 'proof' | 'proofless';

/**
 * Fail-closed one-way gate for the E/F adaptive lane. Whichever attempt
 * (proof-based upgrade or the existing proofless release-time fallback)
 * commits first wins; the other observes the commitment and backs off. A
 * proof commitment can only be reopened by an explicit, conclusive
 * pre-dispatch failure (see releaseProofCommitment) — never by an uncertain
 * or dispatched outcome, and never after a proofless commitment.
 *
 * Deliberately does not offer an error-type-based "did this dispatch?"
 * classifier: once a hold may already exist (e.g. a proof-based attempt
 * succeeded and then failed during QR-page restoration), the exception
 * thrown to the caller is an ordinary Error unrelated to dispatch state.
 * The only trustworthy signal is the durable submission journal — see
 * conclusiveNoHoldFromStates in api-lock-outcome.ts, which callers must use
 * per attempt (fulfilled => dispatched; rejected => check the journal).
 */
export class AdaptiveDirectLaneGate {
  private state: 'watching' | AdaptiveLaneCommitment = 'watching';

  get commitment(): 'watching' | AdaptiveLaneCommitment { return this.state; }

  /** Synchronous compare-and-set: true only if this call made the commitment. */
  tryCommit(kind: AdaptiveLaneCommitment): boolean {
    if (this.state !== 'watching') return false;
    this.state = kind;
    return true;
  }

  /**
   * Reopens proofless eligibility, but only from a proof commitment and only
   * when every proof-based attempt conclusively never left this machine. Once
   * a proofless commitment is made, or once any proof attempt may have
   * dispatched, this is permanently a no-op.
   */
  releaseProofCommitment(): void {
    if (this.state === 'proof') this.state = 'watching';
  }
}
