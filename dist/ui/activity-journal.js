import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
/** Private, append-only UI timeline shared by every booking method and test run. */
export class ActivityJournal {
    root;
    handles = new Map();
    constructor(root) {
        this.root = root;
    }
    begin(label, at) {
        const runId = randomUUID();
        const directory = resolve(this.root, '.local/booking-runs');
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const path = join(directory, `${runId}.ndjson`);
        const handle = openSync(path, 'wx', 0o600);
        this.handles.set(runId, handle);
        writeSync(handle, `${JSON.stringify({ type: 'run-start', runId, label, at, elapsedMs: 0, deltaMs: 0 })}\n`);
        return { runId, path };
    }
    record(runId, activity) {
        const handle = this.handles.get(runId);
        if (handle === undefined)
            return;
        writeSync(handle, `${JSON.stringify({ type: 'activity', runId, ...activity })}\n`);
    }
    ready(runId, at, elapsedMs) {
        const handle = this.handles.get(runId);
        if (handle === undefined)
            return;
        writeSync(handle, `${JSON.stringify({ type: 'browser-ready', runId, at, elapsedMs })}\n`);
    }
    end(runId, at, elapsedMs, outcome, readyElapsedMs, label) {
        const handle = this.handles.get(runId);
        if (handle === undefined)
            return;
        try {
            writeSync(handle, `${JSON.stringify({ type: 'run-end', runId, at, elapsedMs, outcome, ...(readyElapsedMs === undefined ? {} : { readyElapsedMs }), ...(label ? { label } : {}) })}\n`);
        }
        finally {
            closeSync(handle);
            this.handles.delete(runId);
        }
    }
    history(limit = 12) {
        const directory = resolve(this.root, '.local/booking-runs');
        if (!existsSync(directory))
            return [];
        return readdirSync(directory).filter(name => name.endsWith('.ndjson')).map(name => ({ name, mtime: statSync(join(directory, name)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime).slice(0, Math.max(limit * 3, limit)).flatMap(({ name }) => {
            try {
                const rows = readFileSync(join(directory, name), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
                const start = rows.find(row => row.type === 'run-start'), end = [...rows].reverse().find(row => row.type === 'run-end');
                if (!start || !end || typeof start.runId !== 'string' || typeof start.at !== 'string' || typeof end.at !== 'string' || typeof end.elapsedMs !== 'number' || typeof end.outcome !== 'string')
                    return [];
                const marker = rows.find(row => row.type === 'browser-ready') ?? rows.find(row => row.type === 'activity' && typeof row.text === 'string' && /API browser ready|DUAL READY/.test(row.text));
                const inferredStart = typeof start.label === 'string' && !['prepare', 'chrome', 'inspect', 'saving', 'reviewing', 'clearing', 'resetting', 'apiPreview'].includes(start.label);
                const markerElapsed = marker && typeof marker.elapsedMs === 'number' ? marker.elapsedMs : inferredStart ? 0 : undefined;
                const readyElapsedMs = typeof end.readyElapsedMs === 'number' ? end.readyElapsedMs : markerElapsed === undefined ? undefined : Math.max(0, end.elapsedMs - markerElapsed);
                const readyAt = marker && typeof marker.at === 'string' ? marker.at : inferredStart ? start.at : undefined;
                const activities = rows.flatMap(row => row.type === 'activity' && typeof row.at === 'string' && typeof row.text === 'string' && (row.level === 'info' || row.level === 'error')
                    ? [{ at: row.at, text: row.text, level: row.level, ...(typeof row.elapsedMs === 'number' ? { elapsedMs: row.elapsedMs } : {}), ...(typeof row.deltaMs === 'number' ? { deltaMs: row.deltaMs } : {}) }]
                    : []);
                return [{ runId: start.runId, label: typeof end.label === 'string' ? end.label : typeof start.label === 'string' ? start.label : 'run', startedAt: start.at, endedAt: end.at, outcome: end.outcome, totalElapsedMs: end.elapsedMs, ...(readyAt ? { readyAt } : {}), ...(readyElapsedMs === undefined ? {} : { readyElapsedMs }), activities }];
            }
            catch {
                return [];
            }
        }).slice(0, limit);
    }
}
//# sourceMappingURL=activity-journal.js.map