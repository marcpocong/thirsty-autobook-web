import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { buildLabel, BuildInfoSchema, readBuildInfo, type BuildInfo } from '../src/build-info.js';
import { openRenderer } from './renderer-harness.js';
// @ts-expect-error: plain ESM build helper without type declarations
import { compareTrees, COPIED_ASSETS, distContentId, removeGenerated } from '../scripts/build-support.mjs';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function tree(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'dist-'));
  directories.push(root);
  for (const [file, content] of Object.entries(files)) { await mkdir(join(root, file, '..'), { recursive: true }); await writeFile(join(root, file), content); }
  return root;
}

describe('source-vs-dist consistency', () => {
  it('passes an identical dist and allows only the known copied assets', async () => {
    const fresh = await tree({ 'src/a.js': 'a', 'src/a.js.map': 'm', 'ui/main.js': 'u' });
    const dist = await tree({ 'src/a.js': 'a', 'src/a.js.map': 'm', 'ui/main.js': 'u', 'build-info.json': '{}', 'ui/renderer/index.html': '<p>' });
    expect(COPIED_ASSETS).toContain('build-info.json');
    await expect(compareTrees(fresh, dist)).resolves.toMatchObject({ checkedFiles: 3, problems: [] });
  });

  it('reports stale, missing and orphaned modules (the tracked-dist drift class of bug)', async () => {
    const fresh = await tree({ 'src/api-booking/public-checkout.js': 'fixed', 'src/time-range.js': 'new', 'ui/main.js': 'u' });
    const dist = await tree({ 'src/api-booking/public-checkout.js': 'old', 'ui/main.js': 'u', 'src/api-booking/special-session.js': 'deleted source' });
    const { problems } = await compareTrees(fresh, dist);
    expect(problems).toEqual(expect.arrayContaining([{ kind: 'stale', file: 'src/api-booking/public-checkout.js' },
      { kind: 'missing', file: 'src/time-range.js' }, { kind: 'orphan', file: 'src/api-booking/special-session.js' }]));
    expect(problems).toHaveLength(3);
  });

  it('skips source maps when the dist lives elsewhere (maps embed the relative source path)', async () => {
    const fresh = await tree({ 'src/a.js': 'a', 'src/a.js.map': 'here' });
    const dist = await tree({ 'src/a.js': 'a', 'src/a.js.map': 'elsewhere', 'src/old.js.map': 'x' });
    await expect(compareTrees(fresh, dist, { compareMaps: false })).resolves.toMatchObject({ problems: [] });
    expect((await compareTrees(fresh, dist)).problems.map((problem: { kind: string }) => problem.kind).sort()).toEqual(['orphan', 'stale']);
  });

  it('gives a content ID that changes with runtime bytes but not with maps or build-info', async () => {
    const a = await tree({ 'src/a.js': 'a', 'src/a.js.map': 'm1', 'build-info.json': '1' });
    const b = await tree({ 'src/a.js': 'a', 'src/a.js.map': 'm2', 'build-info.json': '2' });
    const c = await tree({ 'src/a.js': 'b' });
    expect(await distContentId(a)).toBe(await distContentId(b));
    expect(await distContentId(a)).not.toBe(await distContentId(c));
  });

  it('only ever removes directories named like generated dist output', async () => {
    await expect(removeGenerated(join(tmpdir(), 'src'))).rejects.toThrow('REFUSING_TO_REMOVE_NON_DIST_DIRECTORY');
    await expect(removeGenerated(join(tmpdir(), 'not-a-dist-folder'))).rejects.toThrow('REFUSING');
  });
});

const info: BuildInfo = { schema: 'thirsty-build-info/v1', kind: 'installation', gitSha: 'b8cbc1668c0493d3b007301cb15577dadf3ce7b1', branch: 'main',
  dirty: false, builtAt: '2026-09-29T02:18:00.000Z', packageVersion: '0.1.0', node: 'v24.15.0', contentId: 'a'.repeat(64), buildId: 'b8cbc16-aaaaaaaaaa' };

describe('build provenance', () => {
  it('reads and validates build-info.json and never throws', async () => {
    const root = await tree({ 'good.json': JSON.stringify(info), 'bad.json': '{"schema":"other"}', 'broken.json': '{' });
    expect(readBuildInfo(join(root, 'good.json'))).toEqual(info);
    expect(readBuildInfo(join(root, 'bad.json'))).toBeNull();
    expect(readBuildInfo(join(root, 'broken.json'))).toBeNull();
    expect(readBuildInfo(join(root, 'missing.json'))).toBeNull();
    expect(() => BuildInfoSchema.parse({ ...info, gitSha: 'not-a-sha' })).toThrow();
    expect(buildLabel(info)).toContain('b8cbc16 · clean');
    expect(buildLabel({ ...info, dirty: true })).toContain('UNCOMMITTED CHANGES');
    expect(buildLabel(null)).toMatch(/unavailable/);
  });
});

describe('build SHA display in the renderer', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) }); });
  afterAll(async () => { await browser.close(); });

  it('shows the short SHA in the navigation bar and the full record in Tools', async () => {
    const page = await openRenderer(browser, { build: info }, 'tools');
    expect(await page.locator('#build-label').textContent()).toBe('Build b8cbc16');
    const details = await page.locator('#build-details').textContent();
    expect(details).toContain(info.gitSha);
    expect(details).toContain('clean (committed source only)');
    expect(details).toContain(info.buildId);
    await page.close();
  });

  it('flags uncommitted and unknown builds', async () => {
    const dirty = await openRenderer(browser, { build: { ...info, dirty: true } }, 'tools');
    expect(await dirty.locator('#build-label').textContent()).toBe('Build b8cbc16 + uncommitted');
    expect(await dirty.locator('#build-label').getAttribute('data-tone')).toBe('warn');
    await dirty.close();
    const none = await openRenderer(browser, { build: null }, 'tools');
    expect(await none.locator('#build-label').textContent()).toBe('Build: unknown');
    expect(await none.locator('#build-details').textContent()).toContain('No build-info.json');
    await none.close();
  });
});
