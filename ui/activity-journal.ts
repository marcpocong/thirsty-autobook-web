import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Activity } from './types.js';

/** Private, append-only UI timeline shared by every booking method and test run. */
export class ActivityJournal {
  private readonly handles = new Map<string, number>();
  constructor(private readonly root: string) {}

  begin(label: string, at: string) {
    const runId = randomUUID();
    const directory = resolve(this.root, '.local/booking-runs');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${runId}.ndjson`);
    const handle = openSync(path, 'wx', 0o600);
    this.handles.set(runId, handle);
    writeSync(handle, `${JSON.stringify({ type: 'run-start', runId, label, at, elapsedMs: 0, deltaMs: 0 })}\n`);
    return { runId, path };
  }

  record(runId: string, activity: Activity) {
    const handle = this.handles.get(runId);
    if (handle === undefined) return;
    writeSync(handle, `${JSON.stringify({ type: 'activity', runId, ...activity })}\n`);
  }

  end(runId: string, at: string, elapsedMs: number, outcome: string) {
    const handle = this.handles.get(runId);
    if (handle === undefined) return;
    try { writeSync(handle, `${JSON.stringify({ type: 'run-end', runId, at, elapsedMs, outcome })}\n`); }
    finally { closeSync(handle); this.handles.delete(runId); }
  }
}
