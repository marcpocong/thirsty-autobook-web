import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type TraceValue = string | number | boolean;
type TraceExtra = Record<string, TraceValue>;

export interface RunProgressLogOptions {
  diagnosticBufferSize?: number;
  schedule?: (callback: () => void) => void;
}

/** Local, append-only timing evidence for every API prepare, dry, and QR test run. */
export class ApiRunProgressLog {
  readonly runId = randomUUID();
  readonly path: string;
  private readonly handle: number;
  private readonly diagnosticBufferSize: number;
  private readonly schedule: (callback: () => void) => void;
  private diagnosticQueue: string[] = [];
  private diagnosticDropped = 0;
  private diagnosticFlushScheduled = false;
  private diagnosticWrites: Promise<void> = Promise.resolve();
  private closed = false;
  private previousElapsedMs = 0;
  private previousDiagnosticElapsedMs = 0;

  constructor(readonly mode: string, readonly targetDate: string, directory = resolve('.local/api-booking/run-progress'),
    options: RunProgressLogOptions = {}) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = resolve(directory, `${this.runId}.ndjson`);
    this.handle = openSync(this.path, 'ax', 0o600);
    this.diagnosticBufferSize = options.diagnosticBufferSize ?? 512;
    if (!Number.isInteger(this.diagnosticBufferSize) || this.diagnosticBufferSize < 1)
      throw Error('RUN_PROGRESS_BUFFER_INVALID');
    this.schedule = options.schedule ?? (callback => setImmediate(callback));
  }

  private entry(stage: string, at: string, elapsedMs: number, sincePreviousMs: number, extra: TraceExtra = {}) {
    return { runId: this.runId, mode: this.mode, targetDate: this.targetDate,
      stage, at, elapsedMs, sincePreviousMs, ...extra };
  }

  record(stage: string, at: string, elapsedMs: number, extra: TraceExtra = {}) {
    const entry = this.entry(stage, at, elapsedMs, Math.max(0, elapsedMs - this.previousElapsedMs), extra);
    this.previousElapsedMs = elapsedMs;
    writeSync(this.handle, `${JSON.stringify(entry)}\n`);
    return entry;
  }

  /** High-frequency detail shares the same append-only trace without blocking the caller on disk I/O. */
  recordDiagnostic(stage: string, at: string, elapsedMs: number, extra: TraceExtra = {}) {
    const entry = this.entry(stage, at, elapsedMs, Math.max(0, elapsedMs - this.previousDiagnosticElapsedMs), extra);
    this.previousDiagnosticElapsedMs = elapsedMs;
    if (this.closed) {
      this.diagnosticDropped++;
      return entry;
    }
    if (this.diagnosticQueue.length >= this.diagnosticBufferSize) {
      if (stage === 'RUN_DIAGNOSTIC_SUMMARY') { this.diagnosticQueue.shift(); this.diagnosticDropped++; }
      else { this.diagnosticDropped++; return entry; }
    }
    this.diagnosticQueue.push(`${JSON.stringify(entry)}\n`);
    if (!this.diagnosticFlushScheduled) {
      this.diagnosticFlushScheduled = true;
      this.schedule(() => { void this.flushDiagnostics(); });
    }
    return entry;
  }

  private flushDiagnostics(): Promise<void> {
    this.diagnosticFlushScheduled = false;
    if (!this.diagnosticQueue.length && !this.diagnosticDropped) return this.diagnosticWrites;
    const lines = this.diagnosticQueue;
    this.diagnosticQueue = [];
    if (this.diagnosticDropped) {
      lines.push(`${JSON.stringify(this.entry('DIAGNOSTIC_EVENTS_DROPPED', new Date().toISOString(),
        this.previousDiagnosticElapsedMs, 0, { droppedCount: this.diagnosticDropped }))}\n`);
      this.diagnosticDropped = 0;
    }
    const content = lines.join('');
    this.diagnosticWrites = this.diagnosticWrites.catch(() => undefined)
      .then(() => appendFile(this.path, content, { encoding: 'utf8', mode: 0o600 }))
      .catch(() => { this.diagnosticDropped += lines.length; });
    return this.diagnosticWrites;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.flushDiagnostics();
    closeSync(this.handle);
  }
}
