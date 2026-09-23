import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
/** Local, append-only timing evidence for every API prepare, dry, and QR test run. */
export class ApiRunProgressLog {
    mode;
    targetDate;
    runId = randomUUID();
    path;
    handle;
    diagnosticBufferSize;
    schedule;
    diagnosticQueue = [];
    diagnosticDropped = 0;
    diagnosticFlushScheduled = false;
    diagnosticWrites = Promise.resolve();
    closed = false;
    previousElapsedMs = 0;
    previousDiagnosticElapsedMs = 0;
    constructor(mode, targetDate, directory = resolve('.local/api-booking/run-progress'), options = {}) {
        this.mode = mode;
        this.targetDate = targetDate;
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        this.path = resolve(directory, `${this.runId}.ndjson`);
        this.handle = openSync(this.path, 'ax', 0o600);
        this.diagnosticBufferSize = options.diagnosticBufferSize ?? 512;
        if (!Number.isInteger(this.diagnosticBufferSize) || this.diagnosticBufferSize < 1)
            throw Error('RUN_PROGRESS_BUFFER_INVALID');
        this.schedule = options.schedule ?? (callback => setImmediate(callback));
    }
    entry(stage, at, elapsedMs, sincePreviousMs, extra = {}) {
        return { runId: this.runId, mode: this.mode, targetDate: this.targetDate,
            stage, at, elapsedMs, sincePreviousMs, ...extra };
    }
    record(stage, at, elapsedMs, extra = {}) {
        const entry = this.entry(stage, at, elapsedMs, Math.max(0, elapsedMs - this.previousElapsedMs), extra);
        this.previousElapsedMs = elapsedMs;
        writeSync(this.handle, `${JSON.stringify(entry)}\n`);
        return entry;
    }
    /** High-frequency detail shares the same append-only trace without blocking the caller on disk I/O. */
    recordDiagnostic(stage, at, elapsedMs, extra = {}) {
        const entry = this.entry(stage, at, elapsedMs, Math.max(0, elapsedMs - this.previousDiagnosticElapsedMs), extra);
        this.previousDiagnosticElapsedMs = elapsedMs;
        if (this.closed) {
            this.diagnosticDropped++;
            return entry;
        }
        if (this.diagnosticQueue.length >= this.diagnosticBufferSize) {
            if (stage === 'RUN_DIAGNOSTIC_SUMMARY') {
                this.diagnosticQueue.shift();
                this.diagnosticDropped++;
            }
            else {
                this.diagnosticDropped++;
                return entry;
            }
        }
        this.diagnosticQueue.push(`${JSON.stringify(entry)}\n`);
        if (!this.diagnosticFlushScheduled) {
            this.diagnosticFlushScheduled = true;
            this.schedule(() => { void this.flushDiagnostics(); });
        }
        return entry;
    }
    flushDiagnostics() {
        this.diagnosticFlushScheduled = false;
        if (!this.diagnosticQueue.length && !this.diagnosticDropped)
            return this.diagnosticWrites;
        const lines = this.diagnosticQueue;
        this.diagnosticQueue = [];
        if (this.diagnosticDropped) {
            lines.push(`${JSON.stringify(this.entry('DIAGNOSTIC_EVENTS_DROPPED', new Date().toISOString(), this.previousDiagnosticElapsedMs, 0, { droppedCount: this.diagnosticDropped }))}\n`);
            this.diagnosticDropped = 0;
        }
        const content = lines.join('');
        this.diagnosticWrites = this.diagnosticWrites.catch(() => undefined)
            .then(() => appendFile(this.path, content, { encoding: 'utf8', mode: 0o600 }))
            .catch(() => { this.diagnosticDropped += lines.length; });
        return this.diagnosticWrites;
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        await this.flushDiagnostics();
        closeSync(this.handle);
    }
}
//# sourceMappingURL=run-progress-log.js.map