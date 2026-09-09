import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
// Closed numeric metadata schema: never accept DOM, URLs, config, error text or PII.
export class Telemetry {
  readonly runID = randomUUID();
  readonly events: { event: string; wall: string; monoMs: number; value?: number }[] = [];
  mark(event: string, value?: number) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(event)) throw new Error('INVALID_EVENT_NAME');
    this.events.push({ event, wall: new Date().toISOString(), monoMs: performance.now(), ...(typeof value === 'number' && Number.isFinite(value) ? { value } : {}) });
  }
  async flush() {
    await mkdir('DiagnosticsLocal', { recursive: true });
    await writeFile(`DiagnosticsLocal/${this.runID}.json`, JSON.stringify({ runID: this.runID, events: this.events }, null, 2));
  }
}
