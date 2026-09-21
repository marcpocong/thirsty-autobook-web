export class MockAvailabilityProvider {
    fixture;
    kind = 'fixture-backed-mock';
    constructor(fixture) {
        this.fixture = fixture;
    }
    async getAvailability(query) {
        const envelope = structuredClone(this.fixture);
        if (!envelope.raw || typeof envelope.raw !== 'object')
            return envelope;
        const root = envelope.raw;
        if (!root.data?.dates || !root.data.slotsBySpace)
            return envelope;
        root.data.dates = Object.fromEntries(Object.entries(root.data.dates).filter(([date]) => date >= query.startDate && date <= query.endDate));
        root.data.slotsBySpace = Object.fromEntries(Object.entries(root.data.slotsBySpace).map(([spaceId, slots]) => [
            spaceId,
            slots.filter(slot => {
                if (!slot || typeof slot !== 'object' || !('date' in slot))
                    return true;
                const date = slot.date;
                return typeof date !== 'string' || (date >= query.startDate && date <= query.endDate);
            }),
        ]));
        return envelope;
    }
}
//# sourceMappingURL=mock-availability-provider.js.map