import { EventEmitter } from 'node:events';
import { it, expect, vi } from 'vitest';
import type { Browser, Page, Response } from 'playwright';
import { monitorConnection } from '../src/browser.js';
import { Safety } from '../src/safety.js';
import { Telemetry } from '../src/telemetry.js';
import { classifyRateLimit } from '../src/rate-limit.js';
import { readFile, unlink } from 'node:fs/promises';

function response(hostname: string, status: number, retryAfter?: string) {
  return {
    status: () => status,
    url: () => `https://private-user:private-password@${hostname}/private-path?token=secret-query#secret-fragment`,
    headers: () => ({ authorization: 'secret-auth', 'set-cookie': 'secret-cookie', ...(retryAfter !== undefined ? { 'retry-after': retryAfter } : {}) }),
    request: () => ({ resourceType: () => 'script', isNavigationRequest: () => false,
      postData: () => { throw Error('MUST_NOT_READ_BODY'); } }),
    body: () => { throw Error('MUST_NOT_READ_BODY'); },
  } as unknown as Response;
}
function monitored() {
  const page = new EventEmitter(), browser = new EventEmitter(), safety = new Safety(), t = new Telemetry();
  monitorConnection(browser as unknown as Browser, page as unknown as Page, safety, t);
  return { page, safety, t };
}

it.each(['onda.fit', 'app.onda.fit', 'api.onda.fit'])('Onda-owned %s 429 stops and preserves evidence before abort listeners', hostname => {
  const { page, safety, t } = monitored();
  const aborted = vi.fn(() => {
    expect(safety.stopEvidence).toMatchObject({ reason: 'RATE_LIMITED', hostname, status: 429, sameOndaSite: true });
    expect(t.events.at(-1)?.event).toBe('ondaRateLimited');
  });
  safety.signal.addEventListener('abort', aborted);
  page.emit('response', response(hostname, 429));
  expect(() => safety.check()).toThrow('RATE_LIMITED');
  expect(aborted).toHaveBeenCalledOnce();
});

it.each(['120', new Date(Date.now() + 86400000).toUTCString()])('Onda meaningful Retry-After %s stops', retry => {
  const { page, safety } = monitored();
  page.emit('response', response('app.onda.fit', 503, retry));
  expect(() => safety.check()).toThrow('RATE_LIMITED');
  expect(safety.stopEvidence?.retryAfterPresent).toBe(true);
});

it.each(['0', '', 'nonsense', 'Wed, 01 Jan 2020 00:00:00 GMT'])('nonrestrictive Retry-After %s is recorded without a hard stop', retry => {
  const { page, safety, t } = monitored();
  page.emit('response', response('app.onda.fit', 200, retry));
  expect(() => safety.check()).not.toThrow();
  expect(t.events.at(-1)?.event).toBe('ondaRetryAfterUnrestricted');
  page.emit('response', response('app.onda.fit', 429, retry));
  expect(() => safety.check()).toThrow('RATE_LIMITED');
});

it.each(['analytics.example.com', 'evilonda.fit', 'onda.fit.evil.example'])('third-party %s 429 and Retry-After never terminate solely for those responses', hostname => {
  const { page, safety, t } = monitored();
  page.emit('response', response(hostname, 429));
  page.emit('response', response(hostname, 503, '120'));
  expect(() => safety.check()).not.toThrow();
  expect(t.events.map(e => e.event)).toEqual(['thirdPartyRateLimited', 'thirdPartyRateLimited']);
  expect(t.events.every(e => e.evidence?.sameOndaSite === false)).toBe(true);
});

it('persisted evidence has only the allowed fields and no private request/response contents', async () => {
  const { page, safety, t } = monitored();
  page.emit('response', response('app.onda.fit', 429, '120'));
  await t.flush();
  const path = `DiagnosticsLocal/${t.runID}.json`;
  try {
    const persisted = await readFile(path, 'utf8');
    const evidence = JSON.parse(persisted).events[0].evidence;
    expect(Object.keys(evidence).sort()).toEqual(['reason', 'timestamp', 'monoMs', 'hostname', 'status', 'resourceType', 'navigation', 'retryAfterPresent', 'sameOndaSite'].sort());
    expect(evidence).toEqual(safety.stopEvidence);
    expect(persisted).not.toMatch(/private-|secret-|token|authorization|cookie|https:|\?/i);
    expect(Number.isFinite(evidence.monoMs)).toBe(true);
    expect(Number.isFinite(Date.parse(evidence.timestamp))).toBe(true);
  } finally { await unlink(path); }
});

it('keeps the first stop source and handles normal responses without evidence', () => {
  expect(classifyRateLimit(response('app.onda.fit', 200))).toBeUndefined();
  const { page, safety } = monitored();
  page.emit('response', response('onda.fit', 429));
  page.emit('response', response('other.onda.fit', 503, '120'));
  expect(safety.stopEvidence?.hostname).toBe('onda.fit');
});
