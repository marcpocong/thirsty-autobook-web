export function standardCheckoutChunks(plan) {
    if (plan.mode === 'standard') {
        if (plan.chunks.length !== 1 || ![1, 2].includes(plan.chunks[0]?.courts.length ?? 0))
            throw Error('API_STANDARD_CHUNK_INVALID');
    }
    else if (plan.chunks.length !== 2 || plan.durationHours < 4 || plan.durationHours > 6 ||
        plan.chunks.some(chunk => chunk.courts.length !== plan.chunks[0].courts.length || ![1, 2].includes(chunk.courts.length) ||
            chunk.durationHours < 1 || chunk.durationHours > 3)) {
        throw Error('API_EXTENDED_CHUNK_INVALID');
    }
    return plan.chunks.map(chunk => ({ mode: 'standard', targetDate: plan.targetDate,
        startTime: chunk.startTime, endTime: chunk.endTime, durationHours: chunk.durationHours,
        courts: chunk.courts, chunks: [chunk], totalPrice: chunk.totalPrice, currency: plan.currency }));
}
//# sourceMappingURL=extended-checkout.js.map