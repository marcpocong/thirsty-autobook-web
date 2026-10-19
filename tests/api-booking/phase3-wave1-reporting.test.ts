import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { armPrecisionRace, dispatchArmedPrecisionRace, disarmUnfired, fireArmedAttempt, armedWindow, settleArmedAttempt } from '../../src/api-booking/armed-dispatch.js';
import { dispatchPhase3Wave1 } from '../../src/api-booking/phase3-wave1-reporting.js';
import { BrowserSessionTransportError } from '../../src/api-booking/browser-session-transport.js';
import { consumeSubmissionPermit, DurableSubmissionJournal, revokeSubmissionPermit } from '../../src/api-booking/durable-submission-journal.js';
import { freezePrecisionRace, precisionTargetPlan, validatePrecisionTargets, type PrecisionAttempt } from '../../src/api-booking/precision-race.js';
import type { DirectTransport } from '../../src/api-booking/proofless-checkout.js';
import { TrustedReleaseClock } from '../../src/release-clock.js';
import { summarizeRunOutcome } from '../../src/run-outcome.js';
import { UiEventSchema, type ApiStageEvent, type ApiStageFields } from '../../src/ui-events.js';
import { reduceLiveRun } from '../../ui/live-run.js';
import type { LiveRunView } from '../../ui/types.js';

const date = '2026-10-22';
const customer = { clientId: '00000000-0000-4000-8000-00000000c11e', customerId: '00000000-0000-4000-8000-000000000b00',
  customerEmail: 'fixture@example.invalid', customerPhone: '09123456789', customerFirstName: 'Fixture', customerLastName: 'Player' };
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'wave1-reporting-')); });
afterEach(async () => { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw Error('UNSAFE_TEST_PATH'); await rm(root, { recursive: true, force: true }); });

async function fixture(blockThird = false) {
  const releaseMs = Date.now() + 60_000;
  const targets = validatePrecisionTargets([7, 6, 5].slice(0, blockThird ? 3 : 2).map(court => ({ court, start: '19:00', durationHours: 3 })), date);
  const race = freezePrecisionRace(date, releaseMs, targets.map(target => ({ target, plan: precisionTargetPlan(target, date) })));
  let blockedPath: string | undefined;
  if (blockThird) {
    const key = targets[2]!.targetKey, journal = new DurableSubmissionJournal(join(root, key));
    await journal.begin(key); await journal.mark(key, 'unknown'); blockedPath = join(root, key, `${key}.json`);
  }
  const armed = await armPrecisionRace(race, { customerFor: () => customer, journalRoot: root, releaseMs, now: Date.now });
  return { armed, releaseMs, blockedPath, clock: TrustedReleaseClock.fromOffset(0, { method: 'test', sampleCount: 5 }) };
}

function capture() {
  const events: ApiStageEvent[] = [], released = new Map<string, number>();
  const candidates = new Map<string, { court: number; startTime: string; endTime: string }>();
  let view: LiveRunView | null = null;
  const stage = (name: string, fields: ApiStageFields = {}) => {
    const event = UiEventSchema.parse({ type: 'apiStage', stage: name, elapsedMs: 0, ...fields }) as ApiStageEvent;
    events.push(event); view = reduceLiveRun(view, event, candidates);
  };
  stage('RUN_STARTED');
  return { events, released, stage, view: () => view!,
    reporting: { stage, fieldsFor: (child: PrecisionAttempt) => ({ candidateId: child.target.targetKey, attemptId: `correlation-${child.id}`,
      court: child.target.court, startTime: child.target.start, endTime: child.target.end }),
      releaseBinding: (child: PrecisionAttempt) => released.set(child.id, (released.get(child.id) ?? 0) + 1) } };
}

describe('actual Wave 1 failure reporting through the runner wrapper (offline)', () => {
  it('real pre-send coordinator failure reports every child, durable and unarmed reasons, and cleans bindings once', async () => {
    const { armed, clock, blockedPath } = await fixture(true), observed = capture();
    const blockedBytes = await readFile(blockedPath!, 'utf8');
    // Represent a previously expired local child whose permit was already revoked before a later Stop.
    const expired = armed.attempts[0]!;
    revokeSubmissionPermit(expired.permit); expired.state = 'refused';
    await expired.journal.mark(expired.key, 'rejected', new Date(), undefined, undefined, 'SHOTGUN_TRIGGER_MISSED');
    let posts = 0;
    await expect(dispatchPhase3Wave1(armed, () => dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 60_000,
      isAborted: () => true, prewarm: async () => undefined,
      transportFor: () => ({ publicCheckoutProofless: async () => { posts++; throw Error('UNEXPECTED_POST'); } }) }), observed.reporting)).rejects.toThrow('USER_ABORT');
    expect(posts).toBe(0);
    const children = observed.view().parents.flatMap(parent => parent.children);
    expect(children).toHaveLength(3); // No synthetic PHASE3_FAN_OUT_CHILD events seed the single-child parents.
    expect(children.map(child => [child.state, child.code])).toEqual([
      ['NOT_DISPATCHED', 'SHOTGUN_TRIGGER_MISSED'], ['NOT_DISPATCHED', 'USER_ABORT'], ['JOURNAL_BLOCKED', 'DUPLICATE_LOGICAL_BOOKING_BLOCKED']]);
    expect(summarizeRunOutcome(children, 3)).toMatchObject({ initiated: 0, unsent: 3, pending: 0, unknown: 0, settled: true, headline: 'NOTHING DISPATCHED' });
    expect(observed.events.filter(event => event.stage === 'PHASE3_WAVE1_UNSENT')).toHaveLength(3);
    expect([...observed.released.values()]).toEqual([1, 1, 1]);
    expect(await armed.attempts[1]!.journal.read(armed.attempts[1]!.key)).toMatchObject({ state: 'rejected', failureCode: 'USER_ABORT' });
    expect(await expired.journal.read(expired.key)).toMatchObject({ state: 'rejected', failureCode: 'SHOTGUN_TRIGGER_MISSED' });
    expect(await readFile(blockedPath!, 'utf8')).toBe(blockedBytes); // UNKNOWN is untouched.
  });

  it('an unexpected throw after a real intercepted send never reclassifies or releases the fired child', async () => {
    const { armed, releaseMs } = await fixture(), observed = capture(), fired = armed.attempts[0]!, error = Error('UNEXPECTED_COORDINATOR_FAILURE');
    const transport: DirectTransport = { publicCheckoutProofless: async (request, permit, options) => {
      consumeSubmissionPermit(permit, fired.key); options?.beforePost?.();
      throw new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID', true,
        { status: 409, category: 'http-rejection', contentKind: 'json', responseSource: 'application', errorHint: 'availability' }, true);
    } };
    const sent = fireArmedAttempt(fired, transport, { nowMs: () => releaseMs }, armedWindow(armed, fired), () => false);
    await expect(settleArmedAttempt(fired, sent, () => releaseMs)).rejects.toThrow();
    const before = await fired.journal.read(fired.key);
    observed.stage('PHASE3_SETTLED', { candidateId: fired.target.targetKey, attemptId: `correlation-${fired.attempt.id}`, workerId: fired.target.workerId, state: 'REJECTED' });
    await expect(dispatchPhase3Wave1(armed, async () => { await disarmUnfired(armed, error.message, Date.now); throw error; }, observed.reporting)).rejects.toBe(error);
    expect(observed.events.filter(event => event.stage === 'PHASE3_WAVE1_UNSENT').map(event => event.attemptId)).toEqual([`correlation-${armed.attempts[1]!.attempt.id}`]);
    expect(observed.released.has(fired.attempt.id)).toBe(false);
    expect([...observed.released.values()]).toEqual([1]);
    expect(await fired.journal.read(fired.key)).toEqual(before);
    expect(summarizeRunOutcome(observed.view().parents.flatMap(parent => parent.children), 2)).toMatchObject({ initiated: 1, rejected: 1, unsent: 1, pending: 0, settled: true });
  });

  it('reporting exceptions do not replace the original coordinator failure or skip other binding cleanup', async () => {
    const { armed } = await fixture(), observed = capture(), error = Error('USER_ABORT');
    await expect(dispatchPhase3Wave1(armed, async () => { await disarmUnfired(armed, error.message, Date.now); throw error; },
      { ...observed.reporting, stage: () => { throw Error('REPORTER_BROKEN'); } })).rejects.toBe(error);
    expect([...observed.released.values()]).toEqual([1, 1]);
  });
});
