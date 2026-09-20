import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';

/** Local, append-only timing evidence for every API prepare, dry, and QR test run. */
export class ApiRunProgressLog {
  readonly runId = randomUUID();
  readonly path: string;
  private readonly handle: number;
  private previousElapsedMs = 0;

  constructor(readonly mode: string, readonly targetDate: string, directory = resolve('.local/api-booking/run-progress')) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = resolve(directory, `${this.runId}.ndjson`);
    this.handle = openSync(this.path, 'wx', 0o600);
  }

  record(stage: string, at: string, elapsedMs: number, extra: Record<string, string | number | boolean> = {}) {
    const sincePreviousMs = Math.max(0, elapsedMs - this.previousElapsedMs);
    this.previousElapsedMs = elapsedMs;
    const entry = { runId: this.runId, mode: this.mode, targetDate: this.targetDate,
      stage, at, elapsedMs, sincePreviousMs, ...extra };
    writeSync(this.handle, `${JSON.stringify(entry)}\n`);
    return entry;
  }

  close() { closeSync(this.handle); }
}
