/** A sent checkout may have created a reservation, but provider confirmation failed.
 * Retain its evidence and duplicate protection; it must not count toward a quota. */
export class ProviderHoldUnconfirmedError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'ProviderHoldUnconfirmedError'; }
}

/** Independent provider confirmation succeeded, but its QR handoff failed afterwards. */
export class VerifiedHoldQrError extends Error {
  constructor(readonly code: string, readonly hold: { bookingId: string; bookingNo?: string; holdExpiresAt: string; amount: number }) {
    super(code); this.name = 'VerifiedHoldQrError';
  }
}
