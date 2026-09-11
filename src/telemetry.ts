import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { emitUiEvent } from './ui-events.js';
import type { RateLimitEvidence } from './rate-limit.js';
import { releasePerformance } from './release-performance.js';
// Closed numeric metadata schema: never accept DOM, URLs, config, error text or PII.
export class Telemetry {
  readonly runID = randomUUID();
  readonly events: { event: string; wall: string; monoMs: number; value?: number; evidence?: RateLimitEvidence }[] = [];
  rateLimit(event: 'ondaRateLimited' | 'thirdPartyRateLimited' | 'ondaRetryAfterUnrestricted', evidence: RateLimitEvidence) {
    // Explicit field allowlist, never spread response/request objects into diagnostics.
    const { reason, timestamp, monoMs, hostname, status, resourceType, navigation, retryAfterPresent, sameOndaSite } = evidence;
    this.mark(event);
    this.events.at(-1)!.evidence = { reason, timestamp, monoMs, hostname, status, resourceType, navigation, retryAfterPresent, sameOndaSite };
  }
  mark(event: string, value?: number) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(event)) throw new Error('INVALID_EVENT_NAME');
    this.events.push({ event, wall: new Date().toISOString(), monoMs: performance.now(), ...(typeof value === 'number' && Number.isFinite(value) ? { value } : {}) });
    if (process.env.THIRSTY_UI_EVENTS === '1') {
      const latest = this.events.at(-1)!;
      emitUiEvent({ type: 'telemetry', event, wall: latest.wall, ...(latest.value !== undefined ? { value: latest.value } : {}) });
    }
  }
  document(failure?: string, stopEvidence?: RateLimitEvidence) {
    return { runID: this.runID, events: this.events, releasePerformance: releasePerformance(this.events),
      ...(failure ? { failure } : {}), ...(stopEvidence ? { stopEvidence } : {}) };
  }
  publishPerformance() {
    const summary = releasePerformance(this.events);
    if (summary) emitUiEvent({ type: 'releasePerformance', summary });
  }
  async flush(failure?: string, stopEvidence?: RateLimitEvidence) {
    await mkdir('DiagnosticsLocal', { recursive: true });
    await writeFile(`DiagnosticsLocal/${this.runID}.json`, JSON.stringify(this.document(failure, stopEvidence), null, 2));
    this.publishPerformance();
  }
}
