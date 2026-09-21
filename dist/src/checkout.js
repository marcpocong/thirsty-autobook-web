export function validateSummary(actual, expected, maximumPrice, stage) {
    if (JSON.stringify([...(actual.courts ?? [actual.court])].sort()) !== JSON.stringify([...(expected.courts ?? [expected.court])].sort()))
        throw Error(`${stage}_MISMATCH`);
    for (const key of ['venue', 'date', 'start', 'end', 'duration', 'currency']) {
        if (actual[key] !== expected[key])
            throw new Error(`${stage}_MISMATCH`);
    }
    if (!Number.isFinite(actual.amount) || actual.amount <= 0 || actual.amount !== expected.amount)
        throw new Error(`${stage}_PRICE_MISMATCH`);
}
export async function checkout(adapter, safety, t, expected, player, maximumPrice, authorizeTerms) {
    const step = async (code, work) => {
        try {
            return await work();
        }
        catch (error) {
            safety.check();
            if (error instanceof Error && /^[A-Z_]+$/.test(error.message))
                throw error;
            throw new Error(code);
        }
    };
    safety.lock();
    const review = await step('REVIEW_VALIDATION_FAILED', () => adapter.review());
    safety.check();
    t.mark('reviewDetected');
    validateSummary(review, expected, maximumPrice, 'REVIEW');
    await safety.stage('REVIEW');
    t.mark('reviewValidated');
    safety.check();
    t.mark('playerFillStarted');
    const actual = await step('PLAYER_FORM_FAILED', () => adapter.fillPlayer(player));
    safety.check();
    if (actual.fullName !== player.fullName || actual.phone !== player.phone || actual.email !== player.email)
        throw new Error('PLAYER_VALUES_MISMATCH');
    t.mark('playerFillCompleted');
    safety.check();
    t.mark('playerProceedStarted');
    await step('PLAYER_PROCEED_FAILED', () => adapter.playerProceed());
    safety.check();
    t.mark('playerProceedClicked');
    safety.check();
    const payment = await step('PAYMENT_SUMMARY_FAILED', () => adapter.paymentSummary());
    safety.check();
    t.mark('paymentSummaryDetected');
    validateSummary(payment, review, maximumPrice, 'PAYMENT');
    await safety.stage('PAYMENT_SUMMARY');
    t.mark('paymentSummaryValidated');
    if (!authorizeTerms) {
        t.mark('automationStopped');
        return 'TERMS_NOT_AUTHORIZED';
    }
    return commitPaymentHold(adapter, safety, t, expected, maximumPrice);
}
export async function commitPaymentHold(adapter, safety, t, expected, maximumPrice) {
    safety.check();
    if (!safety.locked)
        throw new Error('BOOKING_LOCK_REQUIRED');
    safety.check();
    t.mark('termsCheckStarted');
    if (!await adapter.acceptTerms())
        throw new Error('TERMS_NOT_CHECKED');
    safety.check();
    t.mark('termsChecked');
    if (adapter.prepareFinalAction) {
        const finalSummary = await adapter.prepareFinalAction();
        safety.check();
        validateSummary(finalSummary, expected, maximumPrice, 'PAYMENT');
    }
    safety.check();
    t.mark('finalOndaActionStarted');
    await safety.finalAction(() => adapter.finalOndaAction());
    t.mark('finalOndaButtonClicked');
    t.mark('paymentBoundaryReached');
    t.mark('automationStopped');
    return 'PAYMENT_BOUNDARY_REACHED';
}
//# sourceMappingURL=checkout.js.map