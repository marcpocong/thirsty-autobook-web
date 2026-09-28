import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Controller, type Dependencies } from '../ui/controller.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema, ObservationSchema } from '../src/config.js';
import { clockStatus } from '../ui/status.js';
import type { Runner } from '../ui/processes.js';
import type { Command } from '../ui/types.js';
import { buildExperimentManifest, ensureExperimentManifest, experimentManifestPath } from '../src/arbitration/experiment-manifest.js';
import { buildWave1Analysis, discoverEvidence, renderReport } from '../src/arbitration/wave1-analysis.js';

const temp: string[] = [];
afterEach(() => { for (const path of temp.splice(0)) rmSync(path, { recursive: true, force: true }); });
const view = bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless',
  PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' }));
type Ensure = NonNullable<Dependencies['ensureArbitrationManifest']>;
/** Exactly the main-process wiring (ui/main.ts), pointed at a temporary app .local. */
const desktopEnsure = (localRoot: string): Ensure => input => ensureExperimentManifest({ localRoot,
  release: { targetDate: input.targetDate, releaseMs: input.releaseMs }, createdBy: 'DESKTOP_ARM', clockOffsetMs: input.clockOffsetMs });

function harness(ensure?: (local: string) => Ensure) {
  const local = mkdtempSync(join(tmpdir(), 'arm-manifest-')); temp.push(local);
  const order: string[] = [], calls: Command[] = [], watches: string[] = [], sleep: number[] = [], releaseMs = Date.now() + 3_600_000;
  const runId = '94000000-2222-4333-8444-555555555555';
  let runnerStartedMs = Number.NaN;
  const runner: Runner = command => {
    calls.push(command);
    if (typeof command === 'object' && command.kind === 'apiRun' && command.mode === 'live') {
      runnerStartedMs = Date.now();
      const onDisk = existsSync(experimentManifestPath(local, { targetDate: command.date, releaseMs: command.releaseMs! }));
      order.push(`runner:live:${onDisk ? 'manifest-on-disk' : 'no-manifest'}`);
      // What the real runner logs first (synthetic; no network): its start and the release it was given.
      const at = new Date(runnerStartedMs).toISOString(), progress = join(local, 'api-booking', 'run-progress', `${runId}.ndjson`);
      mkdirSync(resolve(progress, '..'), { recursive: true });
      writeFileSync(progress, [{ runId, mode: 'live', targetDate: command.date, stage: 'RUN_STARTED', at },
        { runId, mode: 'live', targetDate: command.date, stage: 'RUN_CONFIGURATION', releaseMs: command.releaseMs, at }].map(line => JSON.stringify(line)).join('\n') + '\n');
    }
    return { pid: 1, done: Promise.resolve(0), stop: async () => undefined };
  };
  const wired = ensure?.(local);
  const controller = new Controller({ runner, lock: async () => false, cdp: async () => true,
    browserHealth: async () => ({ A: true }), playerStatus: () => ({ primary: true, extended: false }),
    clock: () => ({ ...clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-21T07:00:00+08:00')), releaseMs, clockOffsetMs: 12, targetDate: view.targetDate }),
    startSleepProtection: () => { sleep.push(1); return 1; }, stopSleepProtection: () => undefined,
    startSlotWatch: input => { watches.push(input.date); return { id: `w${watches.length}`, done: Promise.resolve({} as never), stop: async () => ({} as never) }; },
    ...(wired ? { ensureArbitrationManifest: (input: Parameters<Ensure>[0]) => { order.push('ensure'); return wired(input); } } : {}),
    confirm: async () => true, publish: () => undefined, booking: () => view, saveBooking: () => view });
  const prepare = () => controller.resetPrepare({ workflow: 'release', strategy: 'standard', setup: view.setup });
  const arm = async () => { await controller.authorizeTerms(true); await controller.armFullBooking(); };
  const live = () => calls.filter(command => typeof command === 'object' && command.kind === 'apiRun' && command.mode === 'live');
  return { controller, local, runId, order, live, watches, sleep, releaseMs, prepare, arm, runnerStartedMs: () => runnerStartedMs,
    manifestPath: () => experimentManifestPath(local, { targetDate: view.targetDate, releaseMs }) };
}
async function withApiInstallation(work: () => Promise<void>) {
  const previous = process.env.THIRSTY_API_INSTALLATION; process.env.THIRSTY_API_INSTALLATION = '1';
  try { await work(); } finally { if (previous === undefined) delete process.env.THIRSTY_API_INSTALLATION; else process.env.THIRSTY_API_INSTALLATION = previous; }
}

describe('Arm creates the Wave 1 preregistration before the runner starts', () => {
  it('creates the manifest first, from the exact date and release given to the runner', () => withApiInstallation(async () => {
    const h = harness(desktopEnsure);
    await h.prepare(); await h.arm();
    expect(h.order).toEqual(['ensure', 'runner:live:manifest-on-disk']);
    const [live] = h.live(), saved = JSON.parse(readFileSync(h.manifestPath(), 'utf8'));
    expect(live).toMatchObject({ date: view.targetDate, releaseMs: h.releaseMs, clockOffsetMs: 12 });
    expect(saved).toMatchObject({ targetDate: view.targetDate, releaseMs: h.releaseMs, createdBy: 'DESKTOP_ARM', runId: 'UNBOUND_PRE_RUN' });
    expect(Date.parse(saved.createdAt)).toBeLessThanOrEqual(h.runnerStartedMs());
    expect(h.controller.state.arbitrationManifest).toMatchObject({ status: 'ready', verified: false, targetDate: view.targetDate, releaseMs: h.releaseMs });
    const texts = h.controller.state.logs.map(entry => entry.text);
    const created = texts.findIndex(text => text.startsWith(`ARBITRATION_MANIFEST_CREATED · target ${view.targetDate} · release ${new Date(h.releaseMs).toISOString()}`));
    expect(created).toBeGreaterThanOrEqual(0);
    expect(created).toBeLessThan(texts.indexOf('Process started: apiRun · live'));
  }));

  it('verifies and reuses an existing matching preregistration, then arms', () => withApiInstallation(async () => {
    const h = harness(desktopEnsure);
    ensureExperimentManifest({ localRoot: h.local, release: { targetDate: view.targetDate, releaseMs: h.releaseMs }, createdBy: 'DESKTOP_ARM', nowMs: Date.now() - 60_000 });
    const bytes = readFileSync(h.manifestPath(), 'utf8');
    await h.prepare(); await h.arm();
    expect(h.order).toEqual(['ensure', 'runner:live:manifest-on-disk']);
    expect(h.controller.state.arbitrationManifest).toMatchObject({ status: 'ready', verified: true });
    expect(h.controller.state.logs.some(entry => entry.text.startsWith('ARBITRATION_MANIFEST_VERIFIED'))).toBe(true);
    expect(readFileSync(h.manifestPath(), 'utf8')).toBe(bytes);
  }));

  it('never starts the runner, slot watch or sleep protection when the manifest cannot be saved', () => withApiInstallation(async () => {
    const h = harness(local => { writeFileSync(join(local, 'blocked'), 'file'); return desktopEnsure(join(local, 'blocked')); });
    await h.prepare(); await h.arm();
    expect(h.order).toEqual(['ensure']);
    expect(h.live()).toEqual([]); expect(h.watches).toEqual([]); expect(h.sleep).toEqual([]);
    expect(h.controller.state).toMatchObject({ operation: 'idle', ready: true, headline: 'Needs attention',
      detail: 'Investigation setup could not be saved. Nothing was armed. Check that the app can write to its local data folder, then try again.',
      arbitrationManifest: { status: 'blocked', code: 'ARBITRATION_MANIFEST_STORAGE_FAILED' } });
    expect(h.controller.state.logs.some(entry => entry.level === 'error' && entry.text.startsWith('ARBITRATION_MANIFEST_BLOCKED'))).toBe(true);
  }));

  it('never starts the runner on a mismatching preregistration and keeps that file', () => withApiInstallation(async () => {
    const h = harness(desktopEnsure), path = h.manifestPath();
    const other = JSON.stringify({ ...buildExperimentManifest({ targetDate: view.targetDate, releaseMs: h.releaseMs }, Date.now() - 60_000, 'CLI'),
      hypothesisSpecVersion: 'wave1-arbitration-hypotheses/v1.0.0' });
    mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, other);
    await h.prepare(); await h.arm();
    expect(h.live()).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe(other);
    expect(h.controller.state.arbitrationManifest?.reason).toBe('An investigation setup already exists for this release but does not match the current release. '
      + 'Nothing was armed. Details: it preregistered a different hypothesis specification.');
  }));

  it('fails closed when this build has no manifest service', () => withApiInstallation(async () => {
    const h = harness();
    await h.prepare(); await h.arm();
    expect(h.live()).toEqual([]);
    expect(h.controller.state.detail).toBe('This app build cannot create the investigation setup. Nothing was armed.');
  }));

  it('produces a manifest the post-run analyzer recognizes as preregistration, with no manual step', () => withApiInstallation(async () => {
    const h = harness(desktopEnsure);
    await h.prepare(); await h.arm();
    const paths = discoverEvidence(h.local, h.runId);
    expect(paths.experimentManifest).toBe(h.manifestPath());
    expect(paths.associations.experimentManifest).toMatchObject({ status: 'MATCH', confidence: 'MEDIUM',
      basis: 'pre-run unbound manifest + matching release + target date + created before runner start' });
    const report = renderReport(buildWave1Analysis(paths));
    expect(report).toContain('- Experiment manifest: MATCH');
    expect(report).not.toContain('NO_PREREGISTERED_MANIFEST');
  }));

  it('keeps one preregistration across a double click and a re-arm of the same release', () => withApiInstallation(async () => {
    const h = harness(desktopEnsure);
    await h.prepare(); await h.controller.authorizeTerms(true);
    await Promise.all([h.controller.armFullBooking(), h.controller.armFullBooking()]);
    expect(h.order).toEqual(['ensure', 'runner:live:manifest-on-disk']);
    await h.prepare(); await h.arm();
    expect(h.order).toEqual(['ensure', 'runner:live:manifest-on-disk', 'ensure', 'runner:live:manifest-on-disk']);
    expect(h.controller.state.arbitrationManifest).toMatchObject({ status: 'ready', verified: true });
    expect(readdirSync(join(h.local, 'arbitration-manifests'))).toEqual([`${view.targetDate}_${h.releaseMs}`]);
    expect(readdirSync(resolve(h.manifestPath(), '..'))).toEqual(['experiment-manifest.json']);
  }));
});
