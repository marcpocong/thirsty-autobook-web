/**
 * Smart backups: the operator-facing model of a Precision Phase 3 plan.
 *
 * Dependency-free so the renderer, the main process and tests share one compiler. The saved
 * PRECISION_PHASE3 object is always the output of compileSmartPlan, and the "What will happen"
 * text is always generated from a saved (or about-to-be-saved) PRECISION_PHASE3 object, so the
 * summary cannot disagree with the authorization. The backend (config schema and
 * authorizePrecision) still validates everything this module produces.
 *
 * Plain terms: Immediate attempts = Wave 1, Backup choices = Wave 2 candidates, Backup workers =
 * standby, Try reopened slots = Reopen Rescue, Use backups immediately = concurrent Wave 2.
 */
export type SmartWorker = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
/** Mirrors PRECISION_WORKER_IDS (test-enforced). Worker H is never a Precision worker. */
export const SMART_WORKERS: readonly SmartWorker[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
/** Mirrors PRECISION_MAX_CANDIDATES (test-enforced). */
export const SMART_MAX_SLOTS = 21;
/** Hourly rates from this hour on use the evening rate (same boundary as the checkout request's night-rate flag). */
export const SMART_EVENING_FROM = 16;
/** Venue schedule confirmed by the operator: every whole hour from 4 PM onward is PHP 700 on every day. */
export const SMART_EVENING_RATE = 700;
export const SMART_EVENING_RATE_SOURCE = 'venue schedule from 4 PM';
export const SMART_EVENING_RATE_CONFIRMED_AT = '2026-09-30T00:00:00.000Z';
export const SMART_DEFAULT_REOPENED = 1;
/** Mirrors PRECISION_MAX_FAN_OUT and PRECISION_MAX_SENDS (test-enforced). */
export const SMART_MAX_FAN_OUT = 4;
export const SMART_MAX_SENDS = 42;

export type SmartRateStatus = 'TARGET_DATE_PUBLISHED' | 'VENUE_SCHEDULE' | 'OPERATOR_CONFIRMED' | 'REFERENCE';
export interface SmartRateEvidence { source: string; capturedAt: string; status: SmartRateStatus; date: string; perHour: number[]; actionable: boolean }
/** One operator-confirmed rate card for the next release: daytime and evening hourly rates. */
export interface SmartRateTable { day: number | null; evening: number | null; status: 'OPERATOR_CONFIRMED' | 'VENUE_SCHEDULE'; source: string; capturedAt: string; date: string }
export interface SmartPermissions { wave1: boolean; wave2: boolean; rescue: boolean }
/** Public-booking evidence seen when the slot was planned; `override` records a deliberate force-include despite a conflict or failed read. */
export interface SmartPublicEvidence { evidence: 'NO_KNOWN_PUBLIC_CONFLICT' | 'KNOWN_PUBLIC_BOOKING_CONFLICT' | 'UNKNOWN_PUBLIC_QUERY_FAILED' | 'PUBLISHED_OPEN' | 'PUBLISHED_UNAVAILABLE';
  override?: 'OPERATOR_OVERRIDE_PUBLIC_CONFLICT' }
/** Structural copy of release-offset.ts's guarded range (this module stays import-free for the renderer). */
export type SmartReleaseOffset = number;
const validSmartReleaseOffset = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= -2_000 && (value as number) <= 0;
export interface SmartSlot {
  court: number; start: string; durationHours: number;
  /** Immediate attempts only: Release Offset in ms. Absent means normal (at the release time). */
  releaseOffsetMs?: SmartReleaseOffset;
  /** Immediate attempts only: 2–4 fan-out children, one Release Offset each (index order). Replaces releaseOffsetMs. */
  fanOutOffsetsMs?: SmartReleaseOffset[];
  /** Advanced overrides. Absent means automatic. */
  worker?: SmartWorker; priority?: number; permissions?: SmartPermissions; rate?: SmartRateEvidence;
  publicEvidence?: SmartPublicEvidence;
}
export interface SmartDraft {
  immediate: SmartSlot[]; backups: SmartSlot[];
  useBackupsImmediately: boolean; retryReopened: boolean; maxReopenedAttempts: number;
  rates: SmartRateTable;
  /** Advanced overrides. Absent means automatic. */
  advanced: { standby?: SmartWorker[]; wave2?: number; rescue?: number; total?: number };
  /** Analysis-only marker. It never changes authorization; candidate and assignment data remain authoritative. */
  releaseLab?: { version: 1; kind: 'DURATION_OFFSET_V1'; label: 'Duration × Offset' };
}
/** Structural copy of the config PrecisionPhase3Schema. */
export interface SmartPhase3 {
  candidates: Array<{ court: number; start: string; durationHours: number; priority: number; permissions: SmartPermissions; rateEvidence: SmartRateEvidence;
    publicEvidence?: SmartPublicEvidence }>;
  wave1: Array<{ workerId: SmartWorker; candidateIndex: number; releaseOffsetMs?: SmartReleaseOffset; fanOutOffsetsMs?: SmartReleaseOffset[] }>;
  standby: SmartWorker[];
  budgets: { wave2: number; rescue: number; total: number };
  concurrentWave2: boolean; rescueEnabled: boolean;
}
/** `unavailable`: workers known not ready (missing player or invalid identity), by letter only. */
export interface SmartContext { targetDate: string; unavailable?: ReadonlySet<string> }
export interface SmartRateView { evidence: SmartRateEvidence | null; label: string; needsReview: boolean }
export interface SmartCompiled {
  phase3: SmartPhase3 | null; problems: string[]; warnings: string[];
  immediateWorkers: Array<SmartWorker | null>; standby: SmartWorker[]; budgets: { wave2: number; rescue: number; total: number };
  rates: SmartRateView[];
}

const smartHourOf = (start: string) => Number(start.slice(0, 2));
const smartClock = (hour: number) => hour === 24 ? '12:00 MN' : `${hour % 12 || 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
export const smartTime = (start: string) => smartClock(smartHourOf(start));
export const smartRange = (start: string, hours: number) => `${smartTime(start)}–${smartClock(smartHourOf(start) + hours)}`;
export const smartPeso = (amount: number) => `₱${amount.toLocaleString('en-US')}`;
export const smartSlotText = (slot: Pick<SmartSlot, 'court' | 'start' | 'durationHours'>) =>
  `Court ${slot.court} · ${smartTime(slot.start)} · ${slot.durationHours} hour${slot.durationHours === 1 ? '' : 's'}`;
const smartKey = (slot: Pick<SmartSlot, 'court' | 'start' | 'durationHours'>) => `${slot.court}/${slot.start}/${slot.durationHours}`;
const smartOverlap = (a: Pick<SmartSlot, 'court' | 'start' | 'durationHours'>, b: Pick<SmartSlot, 'court' | 'start' | 'durationHours'>) =>
  a.court === b.court && smartHourOf(a.start) < smartHourOf(b.start) + b.durationHours && smartHourOf(b.start) < smartHourOf(a.start) + a.durationHours;
const smartDateText = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)) : 'another date';
const smartCount = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const smartSame = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Sends the immediate attempts make: one each, or one per fan-out child. */
export const smartImmediateSends = (immediate: ReadonlyArray<Pick<SmartSlot, 'fanOutOffsetsMs'>>) =>
  immediate.reduce((sum, slot) => sum + (slot.fanOutOffsetsMs?.length ?? 1), 0);

/** The effective child timing shown by editors. A non-fan-out target is one child. */
export const smartSlotOffsets = (slot: Pick<SmartSlot, 'releaseOffsetMs' | 'fanOutOffsetsMs'>): SmartReleaseOffset[] =>
  slot.fanOutOffsetsMs ? [...slot.fanOutOffsetsMs] : [slot.releaseOffsetMs ?? 0];

/**
 * Changes one immediate target's width without touching any other target. Existing child timings keep their index;
 * only newly added indices use the selected timing profile's deterministic defaults.
 */
export function resizeSmartFanOut(slot: SmartSlot, width: number, defaults: readonly number[]): SmartSlot {
  if (!Number.isInteger(width) || width < 1 || width > SMART_MAX_FAN_OUT) throw Error('FANOUT_WIDTH_INVALID');
  const previous = smartSlotOffsets(slot), offsets = Array.from({ length: width }, (_, index) => previous[index] ?? defaults[index] ?? 0);
  const next: SmartSlot = { ...slot };
  delete next.releaseOffsetMs;
  delete next.fanOutOffsetsMs;
  if (width === 1) {
    if (offsets[0] !== 0) next.releaseOffsetMs = offsets[0];
  } else next.fanOutOffsetsMs = offsets;
  return next;
}

/** Updates the authoritative child representation; it never leaves a competing parent offset beside fan-out. */
export function setSmartChildOffset(slot: SmartSlot, child: number, offset: number): SmartSlot {
  if (!validSmartReleaseOffset(offset)) throw Error('FANOUT_OFFSET_INVALID');
  const offsets = smartSlotOffsets(slot);
  if (!Number.isInteger(child) || child < 0 || child >= offsets.length) throw Error('FANOUT_CHILD_INVALID');
  offsets[child] = offset;
  const next: SmartSlot = { ...slot };
  delete next.releaseOffsetMs;
  delete next.fanOutOffsetsMs;
  if (offsets.length === 1) { if (offsets[0] !== 0) next.releaseOffsetMs = offsets[0]; }
  else next.fanOutOffsetsMs = offsets;
  return next;
}

export function emptySmartDraft(): SmartDraft {
  return { immediate: [], backups: [], useBackupsImmediately: false, retryReopened: false, maxReopenedAttempts: SMART_DEFAULT_REOPENED,
    rates: { day: null, evening: null, status: 'OPERATOR_CONFIRMED', source: '', capturedAt: '', date: '' }, advanced: {} };
}

export const DURATION_OFFSET_PRESET = Object.freeze([
  { durationHours: 3, releaseOffsetMs: -25 }, { durationHours: 3, releaseOffsetMs: -10 },
  { durationHours: 2, releaseOffsetMs: -25 }, { durationHours: 2, releaseOffsetMs: -10 },
  { durationHours: 1, releaseOffsetMs: -25 }, { durationHours: 1, releaseOffsetMs: -10 },
  { durationHours: 1, releaseOffsetMs: 0 },
] as const);

/** Applies only duration and offset to rows the operator already configured. Courts, starts,
 * explicit workers and every other authorization field are preserved; normal compilation
 * remains responsible for rejecting overlaps or end-after-midnight rows. */
export function applyDurationOffsetPreset(draft: SmartDraft): SmartDraft {
  return { ...draft, immediate: draft.immediate.map((slot, index) => {
    const preset = DURATION_OFFSET_PRESET[index];
    if (!preset) return { ...slot };
    const next: SmartSlot = { ...slot, durationHours: preset.durationHours };
    if (preset.releaseOffsetMs === 0) delete next.releaseOffsetMs; else next.releaseOffsetMs = preset.releaseOffsetMs;
    return next;
  }), backups: draft.backups.map(slot => ({ ...slot })), advanced: { ...draft.advanced }, rates: { ...draft.rates },
    releaseLab: { version: 1, kind: 'DURATION_OFFSET_V1', label: 'Duration × Offset' } };
}

/** Rate card from an operator confirmation. The source string satisfies the backend's source pattern. */
export function confirmSmartRates(day: number | null, evening: number | null, status: SmartRateTable['status'], targetDate: string, now: Date): SmartRateTable {
  const valid = (value: number | null) => value !== null && Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
  return { day: valid(day), evening: valid(evening), status, source: status === 'VENUE_SCHEDULE' ? 'current venue schedule' : 'operator confirmed',
    capturedAt: now.toISOString(), date: targetDate };
}

/** The evidence a slot will be authorized with, and a short operator-facing label. */
export function smartRateFor(slot: SmartSlot, rates: SmartRateTable, targetDate: string, immediate: boolean): SmartRateView {
  const review = (label: string): SmartRateView => ({ evidence: null, label, needsReview: true });
  const hours = Array.from({ length: slot.durationHours }, (_, offset) => smartHourOf(slot.start) + offset);
  if (hours.every(hour => hour >= SMART_EVENING_FROM)) {
    const evidence: SmartRateEvidence = { source: SMART_EVENING_RATE_SOURCE, capturedAt: SMART_EVENING_RATE_CONFIRMED_AT,
      status: 'VENUE_SCHEDULE', date: targetDate, perHour: hours.map(() => SMART_EVENING_RATE), actionable: true };
    return { evidence, label: `Expected: ${smartPeso(evidence.perHour.reduce((sum, value) => sum + value, 0))} · fixed venue rate from 4 PM`, needsReview: false };
  }
  if (slot.rate) {
    const rate = slot.rate;
    if (rate.perHour.length !== slot.durationHours || rate.perHour.some(value => !Number.isFinite(value) || value <= 0)) return review('Rate needs review');
    if (rate.date !== targetDate) return { evidence: rate, label: `Rate needs review · confirmed for ${smartDateText(rate.date)}`, needsReview: true };
    if (immediate && (!rate.actionable || rate.status === 'REFERENCE')) return { evidence: rate, label: 'Rate needs review · reference only', needsReview: true };
    const perHour = rate.perHour.map((value, offset) => hours[offset]! >= SMART_EVENING_FROM ? SMART_EVENING_RATE : value);
    const evidence: SmartRateEvidence = perHour.some((value, offset) => value !== rate.perHour[offset])
      ? { ...rate, source: 'confirmed daytime and venue evening schedule', status: 'VENUE_SCHEDULE', perHour }
      : rate;
    return { evidence, label: `Expected: ${smartPeso(perHour.reduce((sum, value) => sum + value, 0))} · exact rate`, needsReview: false };
  }
  const perHour = hours.map(hour => hour >= SMART_EVENING_FROM ? SMART_EVENING_RATE : rates.day);
  if (perHour.some(value => value === null) || !rates.capturedAt || !rates.date || !rates.source) return review('Rate needs review');
  if (rates.date !== targetDate) return review(`Rate needs review · confirmed for ${smartDateText(rates.date)}`);
  const includesEvening = hours.some(hour => hour >= SMART_EVENING_FROM);
  const evidence: SmartRateEvidence = { source: includesEvening ? 'confirmed daytime and venue evening schedule' : rates.source,
    capturedAt: rates.capturedAt, status: includesEvening ? 'VENUE_SCHEDULE' : rates.status, date: rates.date, perHour: perHour as number[], actionable: true };
  return { evidence, label: `Expected: ${smartPeso(evidence.perHour.reduce((sum, value) => sum + value, 0))} · current configured rate`, needsReview: false };
}

const defaultPermissions = (immediate: boolean, rescue: boolean): SmartPermissions => ({ wave1: immediate, wave2: !immediate, rescue });

/** Compiles the visible plan into the exact backend authorization. `phase3` is null while any problem remains. */
export function compileSmartPlan(draft: SmartDraft, context: SmartContext): SmartCompiled {
  const problems: string[] = [], warnings: string[] = [], unavailable = context.unavailable ?? new Set<string>();
  const slots = [...draft.immediate.map(slot => ({ slot, immediate: true })), ...draft.backups.map(slot => ({ slot, immediate: false }))];
  if (!draft.immediate.length) problems.push('Add at least one immediate attempt.');
  if (draft.immediate.length > SMART_WORKERS.length) problems.push(`At most ${SMART_WORKERS.length} immediate attempts (workers A–G).`);
  if (slots.length > SMART_MAX_SLOTS) problems.push(`At most ${SMART_MAX_SLOTS} slots in total.`);
  const seen = new Set<string>();
  for (const { slot, immediate } of slots) {
    if (!Number.isInteger(slot.court) || slot.court < 1 || slot.court > 7 || !/^(0[89]|1\d|2[0-3]):00$/.test(slot.start) ||
      !Number.isInteger(slot.durationHours) || slot.durationHours < 1 || slot.durationHours > 3) { problems.push('A slot has an invalid court, start or duration.'); continue; }
    if (smartHourOf(slot.start) + slot.durationHours > 24) problems.push(`${smartSlotText(slot)} ends after midnight.`);
    if (slot.releaseOffsetMs !== undefined && (!immediate || !validSmartReleaseOffset(slot.releaseOffsetMs)))
      problems.push(`${smartSlotText(slot)} has an invalid release offset.`);
    if (slot.fanOutOffsetsMs !== undefined && (!immediate || slot.releaseOffsetMs !== undefined || !Array.isArray(slot.fanOutOffsetsMs) ||
      slot.fanOutOffsetsMs.length < 2 || slot.fanOutOffsetsMs.length > SMART_MAX_FAN_OUT || slot.fanOutOffsetsMs.some(value => !validSmartReleaseOffset(value))))
      problems.push(`${smartSlotText(slot)} has an invalid fan-out (2–${SMART_MAX_FAN_OUT} children, each with a release offset).`);
    if (seen.has(smartKey(slot))) problems.push(`${smartSlotText(slot)} is listed twice.`);
    seen.add(smartKey(slot));
  }
  draft.immediate.forEach((slot, index) => draft.immediate.slice(index + 1).forEach(other => {
    if (smartOverlap(slot, other) && smartKey(slot) !== smartKey(other)) problems.push(`Immediate attempts ${smartSlotText(slot)} and ${smartSlotText(other)} overlap on the same court.`);
  }));

  // Workers: manual picks first, then the next ready worker in A–G order.
  const manual = draft.immediate.map(slot => slot.worker).filter((worker): worker is SmartWorker => !!worker);
  if (new Set(manual).size !== manual.length) problems.push('Each immediate attempt needs its own worker.');
  if (manual.some(worker => !SMART_WORKERS.includes(worker))) problems.push('Only workers A–G can make Precision attempts.');
  const free = SMART_WORKERS.filter(worker => !unavailable.has(worker) && !manual.includes(worker) && !draft.advanced.standby?.includes(worker));
  const immediateWorkers = draft.immediate.map(slot => slot.worker ?? free.shift() ?? null);
  const missing = immediateWorkers.filter(worker => worker === null).length;
  if (missing) problems.push(`Only ${draft.immediate.length - missing} ready worker${draft.immediate.length - missing === 1 ? ' is' : 's are'} free for ${smartCount(draft.immediate.length, 'immediate attempt')}. Remove an attempt or fix the workers that are not ready.`);
  for (const worker of manual) if (unavailable.has(worker)) warnings.push(`Worker ${worker} is not ready and will not be used.`);

  const retry = draft.retryReopened;
  const permissions = slots.map(({ slot, immediate }) => {
    const value = slot.permissions ? { ...slot.permissions } : defaultPermissions(immediate, retry);
    return immediate ? { ...value, wave1: true } : value;
  });
  slots.forEach(({ slot, immediate }, index) => {
    if (!immediate && !Object.values(permissions[index]!).some(Boolean)) problems.push(`${smartSlotText(slot)} is not allowed in any attempt.`);
  });
  const backupChoices = draft.backups.filter((_, index) => permissions[draft.immediate.length + index]!.wave2).length;

  let standby: SmartWorker[];
  if (draft.advanced.standby) {
    standby = [...draft.advanced.standby];
    if (new Set(standby).size !== standby.length || standby.some(worker => !SMART_WORKERS.includes(worker) || immediateWorkers.includes(worker)))
      problems.push('Backup workers must be distinct and not used by an immediate attempt.');
    for (const worker of standby) if (unavailable.has(worker)) warnings.push(`Worker ${worker} is not ready and will not be used.`);
  } else {
    standby = SMART_WORKERS.filter(worker => !unavailable.has(worker) && !immediateWorkers.includes(worker)).slice(0, backupChoices);
  }
  if (backupChoices > standby.length && !draft.advanced.standby)
    warnings.push(standby.length ? `Only ${smartCount(standby.length, 'backup worker')} ${standby.length === 1 ? 'is' : 'are'} free, so at most ${standby.length} of ${backupChoices} backups can be tried.`
      : 'No worker is free for backups. Backups can only be tried as reopened slots.');

  const reopened = Math.min(7, Math.max(1, Math.floor(draft.maxReopenedAttempts) || SMART_DEFAULT_REOPENED));
  const auto = { wave2: Math.min(backupChoices, standby.length), rescue: retry ? reopened : 0 };
  const wave2 = draft.advanced.wave2 ?? auto.wave2, rescue = draft.advanced.rescue ?? auto.rescue;
  // Every fan-out child is a send; without fan-out this equals the number of immediate attempts.
  const immediateSends = smartImmediateSends(draft.immediate);
  const total = draft.advanced.total ?? immediateSends + wave2 + rescue;
  const budgets = { wave2, rescue, total };
  if (![wave2, rescue, total].every(value => Number.isSafeInteger(value) && value >= 0) || wave2 > 7 || rescue > 7 || total > SMART_MAX_SENDS ||
    wave2 > standby.length || total < immediateSends || total > immediateSends + wave2 + rescue ||
    total > Math.max(SMART_MAX_SLOTS, immediateSends + wave2) + rescue || (rescue > 0 && !retry)) problems.push('Attempt limits are inconsistent. Check Advanced settings.');

  const rates = slots.map(({ slot, immediate }) => smartRateFor(slot, draft.rates, context.targetDate, immediate));
  const review = rates.filter(rate => rate.needsReview).length;
  if (review) problems.push(`Review rates: ${smartCount(review, 'slot needs', 'slots need')} a confirmed rate for ${smartDateText(context.targetDate)}.`);
  for (const rate of rates) if (rate.evidence && !/^[A-Za-z0-9 _./:-]{1,100}$/.test(rate.evidence.source)) problems.push('A rate source contains unsupported characters.');

  const priorities = slots.map(({ slot }, index) => slot.priority ?? index + 1);
  if (priorities.some(value => !Number.isSafeInteger(value) || value < 1)) problems.push('Priorities must be whole numbers from 1.');
  const selected = draft.immediate;
  if (selected.length > 1 && selected.every(slot => slot.start === selected[0]!.start && slot.durationHours === selected[0]!.durationHours))
    warnings.push(`All ${selected.length} immediate attempts share ${smartRange(selected[0]!.start, selected[0]!.durationHours)}. A time-wide unavailable block would affect every attempt.`);

  const phase3: SmartPhase3 | null = problems.length ? null : {
    candidates: slots.map(({ slot }, index) => ({ court: slot.court, start: slot.start, durationHours: slot.durationHours, priority: priorities[index]!,
      permissions: permissions[index]!, rateEvidence: { ...rates[index]!.evidence!, perHour: [...rates[index]!.evidence!.perHour] },
      ...(slot.publicEvidence ? { publicEvidence: { ...slot.publicEvidence } } : {}) })),
    wave1: immediateWorkers.map((workerId, candidateIndex) => ({ workerId: workerId!, candidateIndex,
      ...(draft.immediate[candidateIndex]!.fanOutOffsetsMs ? { fanOutOffsetsMs: [...draft.immediate[candidateIndex]!.fanOutOffsetsMs!] }
        : draft.immediate[candidateIndex]!.releaseOffsetMs ? { releaseOffsetMs: draft.immediate[candidateIndex]!.releaseOffsetMs } : {}) })),
    standby: [...standby], budgets, concurrentWave2: draft.useBackupsImmediately, rescueEnabled: retry,
  };
  return { phase3, problems: [...new Set(problems)], warnings: [...new Set(warnings)], immediateWorkers, standby, budgets, rates };
}

/**
 * Visible plan for a saved authorization. Every value that differs from what the automatic
 * rules would produce is kept as an Advanced override, so saving it unchanged reproduces the
 * same backend object (candidates in canonical order: immediate attempts, then backups).
 */
export function smartDraftFromPhase3(saved: SmartPhase3, context: SmartContext): SmartDraft {
  const assigned = new Map(saved.wave1.map(value => [value.candidateIndex, value.workerId] as const));
  const plain = (index: number): SmartSlot => { const c = saved.candidates[index]!;
    return { court: c.court, start: c.start, durationHours: c.durationHours, ...(c.publicEvidence ? { publicEvidence: { ...c.publicEvidence } } : {}) }; };
  const order = (indices: number[]) => indices.sort((a, b) => saved.candidates[a]!.priority - saved.candidates[b]!.priority || a - b);
  const immediateIndex = saved.wave1.map(value => value.candidateIndex);
  const backupIndex = order(saved.candidates.map((_, index) => index).filter(index => !assigned.has(index)));
  const rescueOn = saved.rescueEnabled;
  // Rate card: the most common evidence set among candidates, split into daytime and evening hourly rates.
  const rateOf = (index: number) => saved.candidates[index]!.rateEvidence;
  const table: SmartRateTable = { day: null, evening: null, status: 'OPERATOR_CONFIRMED', source: '', capturedAt: '', date: '' };
  const firstUsable = [...immediateIndex, ...backupIndex].map(rateOf).find(rate => rate.actionable && (rate.status === 'OPERATOR_CONFIRMED' || rate.status === 'VENUE_SCHEDULE'));
  if (firstUsable) {
    Object.assign(table, { status: firstUsable.status, source: firstUsable.source, capturedAt: firstUsable.capturedAt, date: firstUsable.date });
    for (const index of [...immediateIndex, ...backupIndex]) {
      const c = saved.candidates[index]!, rate = c.rateEvidence;
      if (rate.source !== table.source || rate.capturedAt !== table.capturedAt || rate.status !== table.status || rate.date !== table.date) continue;
      rate.perHour.forEach((price, offset) => { const evening = smartHourOf(c.start) + offset >= SMART_EVENING_FROM;
        if (evening) table.evening ??= price; else table.day ??= price; });
    }
  }
  const draft: SmartDraft = { immediate: saved.wave1.map(value => ({ ...plain(value.candidateIndex), ...(value.fanOutOffsetsMs ? { fanOutOffsetsMs: [...value.fanOutOffsetsMs] }
    : value.releaseOffsetMs ? { releaseOffsetMs: value.releaseOffsetMs } : {}) })),
    backups: backupIndex.map(plain), useBackupsImmediately: saved.concurrentWave2,
    retryReopened: rescueOn, maxReopenedAttempts: rescueOn && saved.budgets.rescue > 0 ? saved.budgets.rescue : SMART_DEFAULT_REOPENED, rates: table, advanced: {} };
  const canonical = [...immediateIndex, ...backupIndex];
  canonical.forEach((index, position) => {
    const slot = position < immediateIndex.length ? draft.immediate[position]! : draft.backups[position - immediateIndex.length]!;
    const c = saved.candidates[index]!, immediate = position < immediateIndex.length;
    if (c.priority !== position + 1) slot.priority = c.priority;
    const expected = defaultPermissions(immediate, rescueOn);
    if (!smartSame(c.permissions, expected)) slot.permissions = { ...c.permissions };
    const fromTable = smartRateFor({ ...slot, rate: undefined }, table, table.date || context.targetDate, immediate).evidence;
    if (!fromTable || !smartSame(fromTable, c.rateEvidence)) slot.rate = { ...c.rateEvidence, perHour: [...c.rateEvidence.perHour] };
  });
  // Workers and limits: pin only what automatic derivation would not reproduce.
  const probe = compileSmartPlan(draft, { ...context, targetDate: table.date || context.targetDate });
  immediateIndex.forEach((index, position) => { if (probe.immediateWorkers[position] !== assigned.get(index)) draft.immediate[position]!.worker = assigned.get(index)!; });
  const pinned = compileSmartPlan(draft, { ...context, targetDate: table.date || context.targetDate });
  if (!smartSame(pinned.standby, saved.standby)) draft.advanced.standby = [...saved.standby];
  const limits = compileSmartPlan(draft, { ...context, targetDate: table.date || context.targetDate }).budgets;
  if (limits.wave2 !== saved.budgets.wave2) draft.advanced.wave2 = saved.budgets.wave2;
  if (limits.rescue !== saved.budgets.rescue) draft.advanced.rescue = saved.budgets.rescue;
  const total = smartImmediateSends(draft.immediate) + (draft.advanced.wave2 ?? limits.wave2) + (draft.advanced.rescue ?? limits.rescue);
  if (total !== saved.budgets.total) draft.advanced.total = saved.budgets.total;
  return draft;
}

export interface SmartPlanSection { title: string; lines: string[] }
export interface SmartPlanDescription { sections: SmartPlanSection[]; summary: string; maxSends: number; warnings: string[] }
const smartExpected = (rate: SmartRateEvidence) => smartPeso(rate.perHour.reduce((sum, value) => sum + value, 0));

/** "What will happen", generated only from the backend object that is (or will be) saved. */
export function describeSmartPlan(plan: SmartPhase3, context: Pick<SmartContext, 'unavailable'> = {}): SmartPlanDescription {
  const unavailable = context.unavailable ?? new Set<string>();
  const assigned = new Set(plan.wave1.map(value => value.candidateIndex));
  const byPriority = (indices: number[]) => indices.sort((a, b) => plan.candidates[a]!.priority - plan.candidates[b]!.priority || a - b);
  const backups = byPriority(plan.candidates.map((_, index) => index).filter(index => !assigned.has(index) && plan.candidates[index]!.permissions.wave2));
  const rescueSlots = plan.candidates.filter(value => value.permissions.rescue).length;
  const immediate = plan.wave1.map((value, position) => {
    const c = plan.candidates[value.candidateIndex]!;
    return `Attempt ${position + 1} · Court ${c.court} · ${smartRange(c.start, c.durationHours)} · Worker ${value.workerId} · Expected ${smartExpected(c.rateEvidence)}` +
      (value.releaseOffsetMs ? ` · ${-value.releaseOffsetMs} ms early` : '') +
      (value.fanOutOffsetsMs ? ` · ${value.fanOutOffsetsMs.length} fan-out children: ${value.fanOutOffsetsMs.map((offset, child) => `${value.workerId}${child} ${offset ? `${-offset} ms early` : 'at release'}`).join(', ')}` : '') +
      (unavailable.has(value.workerId) ? ' · NOT READY, will not be sent' : '');
  });
  const { wave2, rescue, total } = plan.budgets;
  const sections: SmartPlanSection[] = [
    { title: 'At 8:00', lines: [smartImmediateSends(plan.wave1) > plan.wave1.length
      ? `${smartCount(plan.wave1.length, 'immediate target')} will be sent as ${smartImmediateSends(plan.wave1)} independently tracked attempts (fan-out). They do not wait for the released schedule.`
      : `${smartCount(plan.wave1.length, 'immediate attempt')} will be sent. They do not wait for the released schedule.`, ...immediate] },
    { title: 'If a fresh approved backup is open', lines: wave2 > 0
      ? [`Up to ${smartCount(wave2, 'backup attempt')} may be sent by ${plan.standby.map(worker => `Worker ${worker}`).join(', ')}, from ${smartCount(backups.length, 'approved backup')} in the order listed.`,
        plan.concurrentWave2 ? 'Backups may be sent while immediate attempts are still waiting for Onda to respond.' : 'Backups wait until every immediate attempt has been answered.',
        'A backup is used only when a fresh, complete, uncached released schedule shows every hour open, at that schedule\'s current prices.',
        ...backups.map((index, position) => { const c = plan.candidates[index]!; return `Backup ${position + 1} · Court ${c.court} · ${smartRange(c.start, c.durationHours)}`; })]
      : [backups.length ? 'No backup attempts: no backup worker is available.' : 'No backup attempts.'] },
    { title: 'If everything fails and an approved slot reopens', lines: plan.rescueEnabled && rescue > 0
      ? [`Up to ${smartCount(rescue, 'reopened-slot attempt')} may be sent, across ${smartCount(rescueSlots, 'approved slot')}.`,
        'Only after every earlier attempt was conclusively rejected, and only when a fresh schedule shows the slot unavailable and then open again.']
      : ['Off. Reopened slots are not retried.'] },
    { title: 'Safety', lines: ['UNKNOWN stops later attempts. Nothing is retried after an UNKNOWN result.', 'Payment is manual. Nothing is cancelled automatically.',
      plan.wave1.length > 1 || (wave2 > 0 && plan.concurrentWave2)
        ? `More than one temporary hold is possible${wave2 > 0 && plan.concurrentWave2 ? ', including from backups sent immediately' : ''}.`
        : 'Normally at most one temporary hold; a backup or reopened-slot attempt is sent only after the earlier ones were rejected.'] },
  ];
  const sends = smartImmediateSends(plan.wave1);
  const summary = `${plan.wave1.length} immediate${sends > plan.wave1.length ? ` (${sends} sends with fan-out)` : ''} + up to ${smartCount(wave2, 'backup')} + up to ${smartCount(rescue, 'reopened-slot attempt')}`;
  const warnings = [...new Set([...plan.wave1.map(value => value.workerId), ...plan.standby].filter(worker => unavailable.has(worker)))]
    .map(worker => `Worker ${worker} is not ready and will not be used.`);
  return { sections, summary, maxSends: total, warnings };
}

export function smartPlanText(description: SmartPlanDescription): string {
  return [...description.sections.flatMap(section => [section.title, ...section.lines.map(line => `  ${line}`)]),
    `${description.summary}`, `Maximum possible sends: ${description.maxSends}`, ...description.warnings].join('\n');
}
