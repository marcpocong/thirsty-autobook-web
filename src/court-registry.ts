/** Public page metadata observed through authorized Chrome on 2026-10-14 (Asia/Manila).
 * Identity verification is separate from authorization and checkout compatibility.
 * Legacy integer court identities remain Mango-only; Buko is never aliased to 1–7.
 */
export type Wing = 'MANGO' | 'BUKO';
export const FACILITY_ID = '5f8786bd-dc61-4509-b893-74cda8f783f7';
export const MANGO_SPACE_IDS = Object.freeze({
  1: 'c8c8fb0a-518e-4838-b006-8f200e477788',
  2: 'df1a98c3-deb2-4721-949a-d5a1e54fdce0',
  3: '0e853a91-33b6-4de2-9237-778007a9313b',
  4: '2166184c-db40-4a04-9a80-656878f7327b',
  5: '1cdcd209-71ce-4a72-a2f6-9252c4d06a01',
  6: '7aa7d361-9e60-433f-85ed-9e8eeaef8f96',
  7: '648d72bb-0789-40c6-9557-66709da121ba',
});
export const BUKO_SPACE_IDS = Object.freeze({
  1: 'bea300b2-34ef-4f9c-a465-4cabcb945c44',
  2: '2b9c19e6-99fc-47de-b853-03f9234dc456',
  3: '6631032a-3d90-452c-8aa5-d7de9b01ae0e',
  4: 'a49b62f8-5713-4e08-a69d-de9072ecc914',
  5: '3260ae72-61ad-45b8-8d4e-840eb9ac8ebe',
  6: '778c8116-1b51-43f0-a0ce-1945df16c0ef',
  7: 'ca22630b-5550-41b2-a818-99928fa3074a',
});
export const BUKO_DISABLED_REASON = 'Buko scheduled releases and Shotgun are disabled: recurring release policy is unverified. For an open date, use Test Now → Buko Wing → Book Available Now (one exact court, Normal only).';
export interface RegisteredCourt {
  id: `${Wing}:${number}`; wing: Wing; number: number; displayName: string;
  facilityId: string; spaceId: string; bookingMethods: readonly string[];
  /** Observed metadata, not a substitute for current per-slot prices or maintenance. */
  pricing: Readonly<{ currency: 'PHP'; weekdayDay: number; weekendDay: number; evening: number }>;
  scheduleSummary: string;
  releasePolicyId: Wing;
  disabledReason?: string;
}
export const COURT_REGISTRY: readonly RegisteredCourt[] = Object.freeze(
  (['MANGO', 'BUKO'] as const).flatMap(wing => Object.entries(wing === 'MANGO' ? MANGO_SPACE_IDS : BUKO_SPACE_IDS)
    .map(([number, spaceId]): RegisteredCourt => Object.freeze({
      id: `${wing}:${number}` as RegisteredCourt['id'], wing, number: Number(number),
      displayName: wing === 'MANGO' ? `Court ${number}: Mango Wing 🥭` : `🥥 Buko Wing: Court ${number}`,
      facilityId: FACILITY_ID, spaceId,
      pricing: Object.freeze({ currency: 'PHP', weekdayDay: 600, weekendDay: wing === 'MANGO' ? 700 : 600, evening: 700 }),
      scheduleSummary: wing === 'MANGO' ? 'Daily 08:00–24:00; court/date maintenance may apply'
        : 'Mon–Thu 16:00–24:00; Fri–Sun 08:00–24:00; court/date maintenance may apply',
      releasePolicyId: wing,
      bookingMethods: Object.freeze(wing === 'MANGO' ? ['browser', 'hybrid', 'api-first', 'proofless'] : ['api-first-normal']),
      ...(wing === 'BUKO' ? { disabledReason: BUKO_DISABLED_REASON } : {}),
    }))));
export function courtBySpace(spaceId: string): RegisteredCourt | undefined {
  return COURT_REGISTRY.find(court => court.spaceId === spaceId);
}
export function courtByName(name: string): RegisteredCourt | undefined {
  // Legacy Mango labels are accepted explicitly; arbitrary names never supply identity.
  return COURT_REGISTRY.find(court => court.displayName === name ||
    (court.wing === 'MANGO' && name === `Court ${court.number}: Mango Wing`));
}
export function assertCourtFacility(spaceId: string, facilityId: string): RegisteredCourt {
  const court = courtBySpace(spaceId);
  if (!court || court.facilityId !== facilityId) throw Error('COURT_FACILITY_MISMATCH');
  return court;
}
