import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, rename, rmdir, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import type { CheckoutDiagnostic } from './checkout-diagnostics.js';

/**
 * 'armed' (Precision, written BEFORE release): the exact target is frozen and a future
 * POST may happen at the authorized release. It is never evidence that nothing was sent.
 * 'dispatching' (legacy/General, written just before the POST) has the same meaning.
 */
export type SubmissionState = 'dispatching' | 'armed' | 'unknown' | 'verified' | 'rejected';
export interface SanitizedSubmissionAttempt {
  attemptId: string;
  planFingerprint: string;
  targetDate: string;
  courtIds: number[];
  hourlyBoundaries: { startTime: string; endTime: string }[];
  expectedBookingCount: number;
  maximumAmount: number;
  stage: 'dispatching' | 'armed';
  /** Armed records only: the authorized release instant and the last instant a POST may start (epoch ms, trusted clock). */
  releaseMs?: number;
  dispatchDeadlineMs?: number;
}
export interface SubmissionRecord {
  key: string;
  state: SubmissionState;
  createdAt: string;
  updatedAt: string;
  attempt: SanitizedSubmissionAttempt;
  diagnostic?: CheckoutDiagnostic;
  observedResponse?: ObservedCheckoutResponse;
  failureCode?: string;
  // Deliberately excludes proofs, credentials, checkout tokens, and customer data.
}
export interface ObservedCheckoutResponse {
  success: boolean;
  bookingIds: string[];
  bookingNumbers: string[];
  bookingSessionIds: string[];
  holdExpiresAt: string[];
  transactionId?: string;
  transactionAmount?: number;
  trustedTotalAmount?: number;
  validationCode: string;
}
export interface SubmissionPermit { readonly key: string }
const unspentPermits = new WeakSet<SubmissionPermit>();
export function consumeSubmissionPermit(permit: SubmissionPermit, expectedKey: string): void {
  if (!permit || permit.key !== expectedKey || !unspentPermits.delete(permit)) throw Error('SUBMISSION_PERMIT_INVALID_OR_USED');
}
export function isSubmissionPermitUnspent(permit: SubmissionPermit): boolean { return unspentPermits.has(permit); }
/** Makes an unspent permit unusable. Returns true only if it was still unspent (so no POST can ever have used it). */
export function revokeSubmissionPermit(permit: SubmissionPermit): boolean { return unspentPermits.delete(permit); }
const ONE_SHOT_FILE = 'supervised-one-shot.json';

function validAttempt(attempt: SanitizedSubmissionAttempt, stage: SanitizedSubmissionAttempt['stage']): boolean {
  return /^[a-f0-9]{64}$/.test(attempt.attemptId) && /^[a-f0-9]{64}$/.test(attempt.planFingerprint) &&
    /^\d{4}-\d{2}-\d{2}$|^unknown$/.test(attempt.targetDate) && Array.isArray(attempt.courtIds) &&
    !attempt.courtIds.some(court => !Number.isInteger(court) || court < 1 || court > 7) &&
    Number.isInteger(attempt.expectedBookingCount) && attempt.expectedBookingCount >= 1 &&
    Number.isFinite(attempt.maximumAmount) && attempt.maximumAmount >= 0 && attempt.stage === stage &&
    (stage !== 'armed' || Number.isSafeInteger(attempt.releaseMs) && Number.isSafeInteger(attempt.dispatchDeadlineMs) &&
      attempt.releaseMs! > 0 && attempt.dispatchDeadlineMs! >= attempt.releaseMs!);
}

/** Write-once, cross-process duplicate guard. Records are never automatically cleared. */
export class DurableSubmissionJournal {
  constructor(private readonly directory: string) {}

  private path(key: string): string {
    if (!/^[a-f0-9]{64}$/.test(key)) throw Error('SUBMISSION_KEY_INVALID');
    return join(resolve(this.directory), `${key}.json`);
  }

  static key(facilityId: string, spaceId: string, date: string, startTime: string, endTime: string): string {
    return createHash('sha256').update(JSON.stringify([facilityId, spaceId, date, startTime, endTime])).digest('hex');
  }

  async begin(key: string, now = new Date(), attempt?: SanitizedSubmissionAttempt): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = this.path(key);
    const safeAttempt = attempt ?? { attemptId: key, planFingerprint: key, targetDate: 'unknown', courtIds: [], hourlyBoundaries: [],
      expectedBookingCount: 1, maximumAmount: 0, stage: 'dispatching' as const };
    if (!validAttempt(safeAttempt, 'dispatching')) throw Error('SUBMISSION_ATTEMPT_INVALID');
    let handle;
    try { handle = await open(path, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Error('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
      throw error;
    }
    try {
      const time = now.toISOString();
      await handle.writeFile(JSON.stringify({ key, state: 'dispatching', createdAt: time, updatedAt: time, attempt: safeAttempt } satisfies SubmissionRecord));
      await handle.sync();
    } finally { await handle.close(); }
  }

  /**
   * Pre-release durable intent for one exact Precision target. The record appears
   * complete or not at all: it is written and flushed under a temporary name and
   * hard-linked into place (EEXIST = this logical target already has a record),
   * then flushed again so the new name is durable before any permit exists.
   */
  async arm(key: string, now: Date, attempt: SanitizedSubmissionAttempt): Promise<void> {
    if (!validAttempt(attempt, 'armed')) throw Error('SUBMISSION_ATTEMPT_INVALID');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const time = now.toISOString();
    await this.createComplete(this.path(key), JSON.stringify({ key, state: 'armed', createdAt: time, updatedAt: time, attempt } satisfies SubmissionRecord),
      'DUPLICATE_LOGICAL_BOOKING_BLOCKED');
  }

  /**
   * Claims the write-once one-shot for an armed record, before release. The permit
   * exists only after the claim file is complete and flushed, so a missing or
   * incomplete claim file proves no permit (and therefore no POST) ever existed.
   */
  async claimArmedOneShot(key: string, now = new Date()): Promise<SubmissionPermit> {
    const intent = await this.read(key);
    if (intent.key !== key || intent.state !== 'armed') throw Error('SUBMISSION_STATE_INVALID');
    await this.createComplete(join(resolve(this.directory), ONE_SHOT_FILE), JSON.stringify({ claimedAt: now.toISOString(), mode: 'armed' }),
      'SUPERVISED_ONE_SHOT_ALREADY_USED');
    const permit = Object.freeze({ key });
    unspentPermits.add(permit);
    return permit;
  }

  /** True when the one-shot claim file exists with complete content (a permit may have been issued). */
  async oneShotClaimed(): Promise<boolean> {
    try {
      const value = JSON.parse(await readFile(join(resolve(this.directory), ONE_SHOT_FILE), 'utf8')) as { claimedAt?: unknown };
      return typeof value.claimedAt === 'string' && Number.isFinite(Date.parse(value.claimedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return false;
      throw error;
    }
  }

  private async createComplete(path: string, content: string, existsCode: string): Promise<void> {
    const temporary = join(dirname(path), `.${randomUUID()}.arming`);
    const handle = await open(temporary, 'wx', 0o600);
    let linked = false;
    try {
      await handle.writeFile(content);
      await handle.sync();
      try { await link(temporary, path); linked = true; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') throw Error(existsCode);
        if (!['EPERM', 'ENOTSUP', 'ENOSYS', 'EXDEV', 'EINVAL'].includes(code ?? '')) throw error;
      }
      // Flush again through the same file so the new directory entry is durable too.
      if (linked) await handle.sync();
    } finally { await handle.close(); await unlink(temporary).catch(() => undefined); }
    if (linked) return;
    // File systems without hard links: exclusive create + write + flush (an interrupted write stays unreadable, never "complete").
    let fallback;
    try { fallback = await open(path, 'wx', 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Error(existsCode); throw error; }
    try { await fallback.writeFile(content); await fallback.sync(); } finally { await fallback.close(); }
  }

  async claimSupervisedOneShot(key: string, now = new Date()): Promise<SubmissionPermit> {
    const intent = await this.read(key);
    if (intent.state !== 'dispatching') throw Error('SUBMISSION_STATE_INVALID');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let handle;
    try { handle = await open(join(resolve(this.directory), 'supervised-one-shot.json'), 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Error('SUPERVISED_ONE_SHOT_ALREADY_USED');
      throw error;
    }
    try { await handle.writeFile(JSON.stringify({ claimedAt: now.toISOString() })); await handle.sync(); }
    finally { await handle.close(); }
    const permit = Object.freeze({ key });
    unspentPermits.add(permit);
    return permit;
  }

  async mark(key: string, state: Exclude<SubmissionState, 'dispatching'>, now = new Date(),
    diagnostic?: SubmissionRecord['diagnostic'], observedResponse?: ObservedCheckoutResponse,
    failureCode?: string): Promise<void> {
    const path = this.path(key);
    const prior = JSON.parse(await readFile(path, 'utf8')) as SubmissionRecord;
    if (prior.key !== key || (prior.state !== 'dispatching' && prior.state !== 'armed')) throw Error('SUBMISSION_STATE_INVALID');
    if (diagnostic && (!Number.isInteger(diagnostic.status) || diagnostic.status < 100 || diagnostic.status > 599 ||
      !['http-rejection', 'invalid-response'].includes(diagnostic.category) ||
      !['json', 'html', 'text', 'empty', 'other'].includes(diagnostic.contentKind) ||
      !['cloudflare', 'application', 'unknown'].includes(diagnostic.responseSource) ||
      !['verification', 'availability', 'customer', 'rate-limit', 'access', 'other', 'none'].includes(diagnostic.errorHint) ||
      (diagnostic.applicationCode !== undefined && !/^[A-Z][A-Z0-9_]{0,63}$/.test(diagnostic.applicationCode)) ||
      (diagnostic.cloudflareRay !== undefined && !/^[a-f0-9]{8,32}(?:-[A-Za-z0-9]{2,8})?$/.test(diagnostic.cloudflareRay))))
      throw Error('SUBMISSION_DIAGNOSTIC_INVALID');
    const safeId = (value: string) => /^[A-Za-z0-9_-]{1,200}$/.test(value);
    if (observedResponse && (typeof observedResponse.success !== 'boolean' ||
      ![observedResponse.bookingIds, observedResponse.bookingNumbers, observedResponse.bookingSessionIds]
        .every(values => Array.isArray(values) && values.length <= 12 &&
          values.every(value => typeof value === 'string' && safeId(value))) ||
      !Array.isArray(observedResponse.holdExpiresAt) || observedResponse.holdExpiresAt.length > 12 ||
      observedResponse.holdExpiresAt.some(value => typeof value !== 'string' || value.length > 40 ||
        !Number.isFinite(Date.parse(value))) ||
      (observedResponse.transactionId !== undefined && !safeId(observedResponse.transactionId)) ||
      (observedResponse.transactionAmount !== undefined && !Number.isFinite(observedResponse.transactionAmount)) ||
      (observedResponse.trustedTotalAmount !== undefined && !Number.isFinite(observedResponse.trustedTotalAmount)) ||
      !/^[A-Z][A-Z0-9_]{0,63}$/.test(observedResponse.validationCode)))
      throw Error('SUBMISSION_OBSERVATION_INVALID');
    if (failureCode !== undefined && !/^[A-Z][A-Z0-9_]{0,79}$/.test(failureCode))
      throw Error('SUBMISSION_FAILURE_CODE_INVALID');
    const handle = await open(path, 'r+');
    try {
      await handle.truncate(0);
      await handle.writeFile(JSON.stringify({ ...prior, state, updatedAt: now.toISOString(),
      ...(diagnostic ? { diagnostic } : {}), ...(observedResponse ? { observedResponse } : {}),
      ...(failureCode ? { failureCode } : {}) } satisfies SubmissionRecord));
      await handle.sync();
    } finally { await handle.close(); }
  }

  async read(key: string): Promise<SubmissionRecord> {
    return JSON.parse(await readFile(this.path(key), 'utf8')) as SubmissionRecord;
  }

  /**
   * Read-only preview of recycleReusable (no lock, no archive move): whether a new
   * attempt on this logical target would be allowed. Used by fleet validation.
   */
  async peekDisposition(key: string, now = new Date()): Promise<'unused' | 'reusable' | 'blocked'> {
    let record: SubmissionRecord;
    try { record = await this.read(key); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'unused'; return 'blocked'; }
    if (record.key !== key || record.attempt?.attemptId !== key) return 'blocked';
    if (record.state === 'armed') return await this.oneShotClaimed().catch(() => true) ? 'blocked' : 'reusable';
    const observed = record.observedResponse, expiries = observed?.holdExpiresAt;
    const rejected = record.state === 'rejected' && !observed?.success && !observed?.bookingIds?.length && !observed?.bookingNumbers?.length &&
      !observed?.bookingSessionIds?.length && !observed?.holdExpiresAt?.length && !observed?.transactionId;
    const expired = record.state === 'verified' && !!expiries?.length && expiries.length === record.attempt.expectedBookingCount &&
      expiries.every(value => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now.getTime());
    return rejected || expired ? 'reusable' : 'blocked';
  }

  /** Archive conclusive outcomes before permitting another attempt for the same block. */
  async recycleReusable(key: string, now = new Date()): Promise<'unused' | 'reused' | 'blocked'> {
    if (!/^[a-f0-9]{64}$/.test(key)) throw Error('SUBMISSION_KEY_INVALID');
    const parent = dirname(resolve(this.directory));
    const lockRoot = join(parent, 'recycle-locks'), lock = join(lockRoot, key);
    await mkdir(lockRoot, { recursive: true, mode: 0o700 });
    try { await mkdir(lock); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'blocked';
      throw error;
    }
    try {
      let record: SubmissionRecord;
      try { record = await this.read(key); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'unused';
        throw error;
      }
      const expiries = record.observedResponse?.holdExpiresAt;
      if (record.key !== key || record.attempt?.attemptId !== key || !Number.isFinite(now.getTime())) return 'blocked';
      // Armed without a complete one-shot claim: arming never finished, no permit was ever
      // issued, so no POST can have left. Anything else armed may have been sent.
      if (record.state === 'armed') {
        if (await this.oneShotClaimed()) return 'blocked';
        const archiveRoot = join(parent, 'unsent-attempts');
        await mkdir(archiveRoot, { recursive: true, mode: 0o700 });
        await rename(resolve(this.directory), join(archiveRoot, `${key}-${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`));
        return 'reused';
      }
      const rejected = record.state === 'rejected' && !record.observedResponse?.success &&
        !record.observedResponse?.bookingIds?.length && !record.observedResponse?.bookingNumbers?.length &&
        !record.observedResponse?.bookingSessionIds?.length && !record.observedResponse?.holdExpiresAt?.length &&
        !record.observedResponse?.transactionId;
      const expired = record.state === 'verified' && !!expiries?.length &&
        expiries.length === record.attempt.expectedBookingCount &&
        expiries.every(value => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now.getTime());
      if (!rejected && !expired) return 'blocked';
      const archiveRoot = join(parent, rejected ? 'rejected-attempts' : 'expired-holds');
      await mkdir(archiveRoot, { recursive: true, mode: 0o700 });
      await rename(resolve(this.directory), join(archiveRoot, `${key}-${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`));
      return 'reused';
    } finally { await rmdir(lock); }
  }

  async recycleExpiredVerified(key: string, now = new Date()): Promise<'unused' | 'reused' | 'blocked'> {
    return this.recycleReusable(key, now);
  }
}
