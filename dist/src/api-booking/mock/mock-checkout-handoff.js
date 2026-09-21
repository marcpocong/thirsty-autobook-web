export class MockCheckoutHandoff {
    kind = 'mock-checkout-handoff';
    async prepare(holds, now) {
        if (!holds.length || holds.some(hold => !Number.isFinite(Date.parse(hold.holdExpiresAt)) || Date.parse(hold.holdExpiresAt) <= now.getTime()))
            throw Error('MOCK_HANDOFF_HOLD_EXPIRED');
        return {
            kind: 'mock-checkout-ready', synthetic: true, paymentAutomated: false,
            sessions: holds.map((hold, index) => ({
                synthetic: true, sessionId: `synthetic-checkout-${index + 1}`, holdId: hold.holdId,
                expiresAt: hold.holdExpiresAt, action: 'manual-payment-required',
            })),
        };
    }
}
//# sourceMappingURL=mock-checkout-handoff.js.map