import { access, readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DateTime } from 'luxon';
import { loadObservationConfig, releaseCalendar, releaseCalendarOn } from '../src/config.js';
import { UiEventSchema } from '../src/ui-events.js';
import { browserIdentity } from '../src/browser.js';
import { networkClockFresh, networkNowMs, readNetworkClock } from '../src/network-clock.js';
export async function readLock(root) {
    try {
        await access(resolve(root, '.local/automation.lock'));
        return true;
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return false;
        return true;
    }
}
export async function readPreviousHolds(root) {
    const directory = resolve(root, '.local/retained-holds');
    const names = await readdir(directory).catch(() => []);
    const holds = await Promise.all(names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(async (name) => {
        try {
            const value = JSON.parse(await readFile(resolve(directory, name), 'utf8'));
            if (typeof value.archivedAt !== 'string' || !Number.isFinite(Date.parse(value.archivedAt)))
                return null;
            const records = [value.lock ?? {}, ...(Array.isArray(value.workers) ? value.workers : [])];
            const expiries = records.filter(record => record.stage === 'HOLD_VERIFIED').map(record => record.holdExpiresAt).filter((v) => typeof v === 'string' && Number.isFinite(Date.parse(v)));
            const runID = typeof value.lock?.runID === 'string' ? value.lock.runID : 'Unknown';
            return { runID, archivedAt: value.archivedAt, expiresAt: expiries.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null };
        }
        catch {
            return null;
        }
    }));
    return holds.filter((hold) => !!hold).sort((a, b) => Date.parse(b.archivedAt) - Date.parse(a.archivedAt));
}
export async function readRetainedHold(root, now = Date.now()) {
    try {
        const lock = JSON.parse(await readFile(resolve(root, '.local/automation.lock'), 'utf8'));
        const workers = lock.mode === 'extended' ? await Promise.all(['a', 'b'].map(id => readFile(resolve(root, `.local/dual/worker-${id}.lock`), 'utf8').then(raw => JSON.parse(raw)).catch(() => ({})))) : [];
        const records = [lock, ...workers];
        // An armed Precision lock is shown (and recovered) exactly like an unresolved final action.
        const stage = records.some(record => record.stage === 'FINAL_ACTION_DISPATCHING' || record.stage === 'FINAL_ACTION_ARMED') ? 'FINAL_ACTION_DISPATCHING' : records.some(record => record.stage === 'HOLD_VERIFIED') ? 'HOLD_VERIFIED' : null;
        if (!stage)
            return null;
        const expiries = records.filter(record => record.stage === 'HOLD_VERIFIED').map(record => record.holdExpiresAt).filter((value) => typeof value === 'string' && Number.isFinite(Date.parse(value)));
        const expiresAt = expiries.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
        return { stage, expiresAt, remainingSeconds: expiresAt ? Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000)) : null };
    }
    catch {
        return null;
    }
}
export async function readHandoff(root) {
    try {
        const lock = JSON.parse(await readFile(resolve(root, '.local/automation.lock'), 'utf8'));
        const event = UiEventSchema.safeParse(lock.handoff);
        return event.success && event.data.type === 'handoff' ? event.data : null;
    }
    catch {
        return null;
    }
}
/** Restore only QR pages verified in the latest API run that matches the retained hold. */
export async function readLatestQrHandoffs(root, expiresAt) {
    const directory = resolve(root, '.local/api-booking/run-progress');
    const files = await readdir(directory).catch(() => []);
    const dated = await Promise.all(files.filter(name => /^[a-f0-9-]{36}\.ndjson$/.test(name)).map(async (name) => ({ name, modified: (await stat(resolve(directory, name)).catch(() => null))?.mtimeMs ?? 0 })));
    const latest = dated.sort((a, b) => b.modified - a.modified)[0];
    if (!latest)
        return [];
    try {
        const entries = (await readFile(resolve(directory, latest.name), 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
        const qr = entries.filter(entry => entry.stage === 'OFFICIAL_QRPH_HANDOFF');
        if (!qr.some(entry => entry.holdExpiresAt === expiresAt))
            return [];
        const results = new Map();
        for (const entry of qr) {
            const worker = entry.workerId;
            if (!['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].includes(String(worker)) || typeof entry.date !== 'string' || typeof entry.startTime !== 'string' || typeof entry.court !== 'number' || typeof entry.durationHours !== 'number' || typeof entry.price !== 'number' || typeof entry.at !== 'string')
                continue;
            const courts = [entry.court, ...(typeof entry.courtB === 'number' ? [entry.courtB] : [])];
            results.set(String(worker), { checkout: worker, courts, date: entry.date, startTime: entry.startTime, endTime: `${String(Number(entry.startTime.slice(0, 2)) + entry.durationHours).padStart(2, '0')}:00`, amount: entry.price, verifiedAt: entry.at, ...(typeof entry.holdExpiresAt === 'string' ? { holdExpiresAt: entry.holdExpiresAt } : {}) });
        }
        return [...results.values()].sort((a, b) => a.checkout.localeCompare(b.checkout));
    }
    catch {
        return [];
    }
}
export async function probeCdp() {
    return (await probeBrowserHealth()).A;
}
async function probePort(port) {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1200), redirect: 'error' });
        const data = await response.json();
        return response.ok && typeof data.Browser === 'string' && data.Browser.startsWith('Chrome/');
    }
    catch {
        return false;
    }
}
export async function probeBrowserHealth() { const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']; const values = await Promise.all(ids.map(id => probePort(browserIdentity(id).port))); return Object.fromEntries(ids.map((id, index) => [id, !!values[index]])); }
export function clockStatus(config, now) {
    const injected = now !== undefined, network = readNetworkClock(), effective = now ?? DateTime.fromMillis(networkNowMs());
    const local = effective.setZone(config.TIMEZONE), today = releaseCalendarOn(config, local.toISODate());
    const next = releaseCalendar(config, effective);
    return { manilaTime: effective.setZone('Asia/Manila').toFormat('HH:mm:ss'), manilaDate: effective.setZone('Asia/Manila').toFormat('ccc, LLL d, yyyy'),
        releaseMs: next.releaseMs, targetDate: next.targetDate, releaseTime: config.RELEASE_TIME, timezone: config.TIMEZONE,
        canArmToday: next.releaseMs > effective.toMillis(), canArmNext: true, todayReleasePassed: effective.toMillis() >= today.releaseMs,
        remainingMs: Math.max(0, next.releaseMs - effective.toMillis()), horizon: config.BOOKING_HORIZON_DAYS, maxReloads: config.MAX_RELEASE_RELOADS, leadMs: config.RELEASE_LEAD_MS, preopenCalendar: config.RELEASE_PREOPEN_CALENDAR,
        networkSynced: injected || networkClockFresh(network, effective.toMillis()), clockSource: injected ? 'injected-test-clock' : network?.source ?? null, clockOffsetMs: network?.offsetMs ?? 0, clockRoundTripMs: injected ? 0 : network?.roundTripMs ?? null, clockSynchronizedAt: injected ? effective.toISO() : network?.synchronizedAt ?? null,
        preflightSecondsBefore: config.PREFLIGHT_SECONDS_BEFORE, wakeSecondsBefore: config.SCHEDULE_WAKE_SECONDS_BEFORE };
}
export function readClock() { return clockStatus(loadObservationConfig()); }
//# sourceMappingURL=status.js.map