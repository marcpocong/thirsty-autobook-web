import { it, expect } from 'vitest';
import { dryCandidate } from '../src/availability-dry.js';
import { ConfigSchema } from '../src/config.js';
import { parseAvailability } from '../src/onda-availability.js';
import { availabilityCells, availabilityFixture, availabilityDate as date } from './availability-fixture.js';
const config = ConfigSchema.parse({ START_TIME:'17:00', DURATION_HOURS:3, PREFERRED_COURTS:[6,5,7],
  FALLBACK_COURTS:[1], FALLBACK_TIMES:['18:00'], MAX_PRICE:1800,
  PLAYER_FULL_NAME:'Fixture Player', PLAYER_PHONE:'09123456789', PLAYER_EMAIL:'fixture@example.test' });
it('uses production preference order and duration regardless of price', () => {
  const api = parseAvailability(availabilityFixture(), date), cells = availabilityCells();
  cells.find(c => c.court === 6 && c.hour === '17:00')!.state = 'TAKEN';
  api.slots.find(c => c.court === 6 && c.startTime === '17:00')!.available = false;
  expect(dryCandidate(date, cells, api, config)).toMatchObject({pass:true, chosen:{court:5,hours:['17:00','18:00','19:00']}, estimatedApiPrice:1800});
  expect(dryCandidate(date, cells, api, {...config,MAX_PRICE:1})).toMatchObject({pass:true,chosen:{court:5}});
});
it.each(['missing','wrong-date'] as const)('falls back safely for %s API and cannot pass rollout', kind => {
  const api = kind === 'missing' ? undefined : parseAvailability(availabilityFixture('2026-09-12'), '2026-09-12');
  const report = dryCandidate(date, availabilityCells(), api, config);
  expect(report).toMatchObject({candidateSource:'UI_ONLY',pass:false,apiUiAgreement:false,chosen:{court:6,hours:['17:00','18:00','19:00']}});
  expect(JSON.stringify(report)).not.toMatch(/Fixture Player|09123456789|fixture@/);
});
it('reports no candidate honestly and enforces the strict target date', () => {
  const api = parseAvailability(availabilityFixture(), date), cells = availabilityCells();
  cells.forEach(c => {c.state='TAKEN';}); api.slots.forEach(s => {s.available=false;});
  expect(dryCandidate(date,cells,api,config)).toMatchObject({pass:false,chosen:null,apiUiAgreement:true});
  expect(() => dryCandidate('2026-09-12',cells,api,config)).toThrow('AVAILABILITY_UI_DATE_MISMATCH');
});
