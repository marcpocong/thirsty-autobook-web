import { MATRIX_HOURS } from './api-booking/court-hour-matrix.js';
import { adequate, dayOfWeek, rangeHoursOf, sharedRisk, statisticalRecords, type RangeRef, type ReleaseRecord, type SharedRisk, type SurvivalCount }
  from './release-intelligence.js';
import { cellKey, rangeState } from './slot-evidence.js';

/**
 * Historical Advisor: decision support for Smart backups. Pure: it reads derived intelligence records
 * and returns suggestion cards. It cannot save, prepare, freeze, arm or dispatch anything; the UI may
 * only copy a suggestion into the editable draft.
 *
 * Ranking is a transparent lexicographic order, shown with every result:
 *   1. fully open in the first well-observed snapshot (as a share of well-observed releases),
 *   2. still observed open in the read requested at +1 s,
 *   3. number of well-observed releases (sample size),
 *   4. fewer shared court-hours and overlapping clock hours with earlier picks (diversification),
 *   5. the operator's court order, then start time.
 * No score, model or win probability is produced.
 */
export interface AdvisorInput {
  targetDate: string; courts: number[]; earliestStart: string; latestStart: string; durationHours: number;
  immediate: number; backups: number; exclude?: Array<{ court: number; start: string }>; existing?: RangeRef[];
}
export interface AdvisorEvidence {
  wellObserved: number; lateOrPoor: number; fullyOpenFirst: number; stillOpenAt1s: SurvivalCount; stillOpenAt5s: SurvivalCount;
  reopened: number; lateSnapshotFullyOpen: number; prices: number[]; quality: { good: number; fair: number };
}
export interface AdvisorSuggestion {
  role: 'IMMEDIATE' | 'BACKUP'; court: number; start: string; durationHours: number; title: string;
  evidence: AdvisorEvidence; lines: string[]; sharedWithPicks: SharedRisk[];
}
export interface AdvisorResult {
  dayOfWeek: string; wellObservedReleases: number; releasesConsidered: number; insufficient: boolean;
  rule: string; notes: string[]; suggestions: AdvisorSuggestion[]; candidatesConsidered: number;
}
export const ADVISOR_RULE = 'Order: fully open in the first well-observed snapshot, then still open at +1 s, then more well-observed releases, then fewer shared hours with earlier picks, then your court order and start time.';

const label = (hour: number) => hour === 24 ? '12:00 MN' : `${hour % 12 || 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
const rangeTitle = (range: RangeRef) => `Court ${range.court} · ${label(Number(range.start.slice(0, 2)))}–${label(Number(range.start.slice(0, 2)) + range.durationHours)}`;
const overlapsSameCourt = (a: RangeRef, b: RangeRef) => a.court === b.court &&
  Number(a.start.slice(0, 2)) < Number(b.start.slice(0, 2)) + b.durationHours && Number(b.start.slice(0, 2)) < Number(a.start.slice(0, 2)) + a.durationHours;
const share = (part: number, whole: number) => whole ? part / whole : -1;

export function rangeEvidence(range: RangeRef, records: readonly ReleaseRecord[]): AdvisorEvidence {
  const hours = rangeHoursOf(range.start, range.durationHours);
  const evidence: AdvisorEvidence = { wellObserved: 0, lateOrPoor: 0, fullyOpenFirst: 0, stillOpenAt1s: { observed: 0, open: 0 }, stillOpenAt5s: { observed: 0, open: 0 },
    reopened: 0, lateSnapshotFullyOpen: 0, prices: [], quality: { good: 0, fair: 0 } };
  for (const record of records) {
    const map = new Map(record.cells.map(cell => [cellKey(cell.court, cell.hour), cell] as const));
    const parts = hours.map(hour => map.get(cellKey(range.court, hour)));
    if (parts.some(cell => !cell)) continue;
    const state = rangeState(parts.map(cell => cell!.first === 'O' ? 'OPEN' : cell!.first === 'X' ? 'UNAVAILABLE' : 'UNKNOWN'));
    if (state === 'UNKNOWN_INCOMPLETE') continue;
    if (parts.some(cell => cell!.reopen && !cell!.reopen.cacheUncertain)) evidence.reopened++;
    if (!adequate(record.quality.label)) { evidence.lateOrPoor++; if (state === 'FULLY_OPEN') evidence.lateSnapshotFullyOpen++; continue; }
    evidence.wellObserved++; evidence.quality[record.quality.label === 'GOOD' ? 'good' : 'fair']++;
    if (parts.every(cell => cell!.price !== null)) evidence.prices.push(parts.reduce((sum, cell) => sum + cell!.price!, 0));
    if (state !== 'FULLY_OPEN') continue;
    evidence.fullyOpenFirst++;
    for (const [ms, target] of [[1_000, evidence.stillOpenAt1s], [5_000, evidence.stillOpenAt5s]] as const) {
      const states = parts.map(cell => cell!.at[String(ms)]);
      if (states.every(value => value === 'O' || value === 'X')) { target.observed++; if (states.every(value => value === 'O')) target.open++; }
    }
  }
  evidence.prices.sort((a, b) => a - b);
  return evidence;
}

function evidenceLines(evidence: AdvisorEvidence, day: string): string[] {
  const plural = `${day}${evidence.wellObserved === 1 ? '' : 's'}`;
  const lines = [evidence.wellObserved
    ? `Fully open in first usable snapshot: ${evidence.fullyOpenFirst} of ${evidence.wellObserved} well-observed ${plural}`
    : `No well-observed ${day} release yet (sample size 0).`];
  if (evidence.stillOpenAt1s.observed) lines.push(`Still observed open at +1 s: ${evidence.stillOpenAt1s.open} of ${evidence.stillOpenAt1s.observed}`);
  else if (evidence.fullyOpenFirst) lines.push('Still open at +1 s: not observed (no read requested in that window).');
  if (evidence.stillOpenAt5s.observed) lines.push(`Still observed open at +5 s: ${evidence.stillOpenAt5s.open} of ${evidence.stillOpenAt5s.observed}`);
  if (evidence.lateOrPoor) lines.push(`Late or poorly observed snapshots (not release-instant): fully open in ${evidence.lateSnapshotFullyOpen} of ${evidence.lateOrPoor}`);
  if (evidence.reopened) lines.push(`Reopened after being unavailable (cache-certain): ${evidence.reopened}`);
  if (evidence.prices.length) lines.push(`Price in first snapshot: ${[...new Set(evidence.prices)].map(value => `₱${value.toLocaleString('en-US')}`).join(', ')} (${evidence.prices.length} observation${evidence.prices.length === 1 ? '' : 's'})`);
  lines.push(`Evidence quality: ${evidence.wellObserved ? [evidence.quality.good && `${evidence.quality.good} good`, evidence.quality.fair && `${evidence.quality.fair} fair`].filter(Boolean).join(', ') : 'insufficient'}`);
  return lines;
}

/** Suggestions strictly inside the operator's constraints; never an invented court or time. */
export function adviseFromHistory(input: AdvisorInput, allRecords: readonly ReleaseRecord[]): AdvisorResult {
  const day = dayOfWeek(input.targetDate), records = statisticalRecords(allRecords).filter(record => record.dayOfWeek === day);
  const courts = [...new Set(input.courts)].filter(court => Number.isInteger(court) && court >= 1 && court <= 7);
  const duration = Math.min(3, Math.max(1, Math.floor(input.durationHours)));
  const from = Number(input.earliestStart.slice(0, 2)), to = Number(input.latestStart.slice(0, 2));
  const excluded = new Set((input.exclude ?? []).map(value => `${value.court}/${value.start}`));
  const existing = input.existing ?? [];
  const candidates: RangeRef[] = [];
  for (const court of courts) for (const start of MATRIX_HOURS) {
    const hour = Number(start.slice(0, 2));
    if (hour < from || hour > to || hour + duration > 24 || excluded.has(`${court}/${start}`)) continue;
    const range = { court, start, durationHours: duration };
    if (existing.some(value => value.court === court && value.start === start && value.durationHours === duration)) continue;
    candidates.push(range);
  }
  const evidence = new Map(candidates.map(range => [`${range.court}/${range.start}`, rangeEvidence(range, records)] as const));
  const wellObservedReleases = records.filter(record => adequate(record.quality.label)).length;
  const picks: AdvisorSuggestion[] = [];
  const pick = (role: AdvisorSuggestion['role'], count: number) => {
    for (let slot = 0; slot < count; slot++) {
      const chosen = [...picks.map(value => value as RangeRef), ...existing];
      const open = candidates.filter(range => !picks.some(value => value.court === range.court && value.start === range.start) &&
        !chosen.some(value => overlapsSameCourt(value, range)));
      if (!open.length) return;
      const keyed = open.map(range => {
        const item = evidence.get(`${range.court}/${range.start}`)!;
        const risks = chosen.map(value => sharedRisk(value, range, records));
        return { range, item, risks, keys: [-share(item.fullyOpenFirst, item.wellObserved), -share(item.stillOpenAt1s.open, item.stillOpenAt1s.observed), -item.wellObserved,
          risks.reduce((sum, risk) => sum + risk.sharedCells, 0), risks.reduce((sum, risk) => sum + risk.overlappingHours, 0), courts.indexOf(range.court), Number(range.start.slice(0, 2))] };
      }).sort((a, b) => { for (let index = 0; index < a.keys.length; index++) if (a.keys[index] !== b.keys[index]) return a.keys[index]! - b.keys[index]!; return 0; });
      const best = keyed[0]!;
      const lines = evidenceLines(best.item, day);
      const timeShared = best.risks.filter(risk => risk.overlappingHours > 0).length;
      if (best.risks.length) lines.push(timeShared ? `Overlaps in time with ${timeShared} earlier pick${timeShared === 1 ? '' : 's'} on other courts (a time-wide block would affect both).` : 'No time overlap with earlier picks.');
      picks.push({ role, court: best.range.court, start: best.range.start, durationHours: best.range.durationHours, title: rangeTitle(best.range),
        evidence: best.item, lines, sharedWithPicks: best.risks });
    }
  };
  pick('IMMEDIATE', Math.max(0, Math.min(7, Math.floor(input.immediate))));
  pick('BACKUP', Math.max(0, Math.min(14, Math.floor(input.backups))));
  const notes = wellObservedReleases ? [] : [`No well-observed ${day} release is on record, so these follow your court order and spread start times. They are not evidence-based yet.`];
  if (records.length > wellObservedReleases) notes.push(`${records.length - wellObservedReleases} ${day} release${records.length - wellObservedReleases === 1 ? ' was' : 's were'} observed too late or too coarsely to count as release-instant evidence.`);
  notes.push('Suggestions change only the draft. Review, then save the plan yourself.');
  return { dayOfWeek: day, wellObservedReleases, releasesConsidered: records.length, insufficient: !wellObservedReleases, rule: ADVISOR_RULE, notes,
    suggestions: picks, candidatesConsidered: candidates.length };
}
