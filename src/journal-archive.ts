import { createHash, randomUUID } from 'node:crypto';
import { appendFile, lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * Historical UNKNOWN archival. Archiving NEVER moves, rewrites or reclassifies a journal: the original file stays in
 * place, so the write-once duplicate guard keeps refusing that target (DUPLICATE_LOGICAL_BOOKING_BLOCKED) and the
 * record stays UNKNOWN. The archive is a separate index of SHA-256 digests plus an append-only audit log; it only
 * hides eligible historical records from active operator screens. Restore removes the index entry. Verify re-hashes.
 *
 * Eligibility mirrors the installer's historical rule: well-formed UNKNOWN, no write for 24 hours, every dispatch
 * deadline passed and every recorded hold expired. Armed/dispatching records, verified holds, locks and .arming files
 * are never archived. Age is never evidence about the provider outcome.
 */
export const LIFECYCLE_STORES = Object.freeze(['.local/api-booking', '.local/dual', '.local/retained-holds']);
export const ARCHIVE_DIRECTORY = '.local/journal-archive';
export const HISTORICAL_QUIET_MS = 24 * 60 * 60 * 1000;
export interface JournalRecordSummary {
  path: string; key: string; state: string; targetDate: string; wing?: string; courtIds: number[]; stage?: string;
  lastWriteAt: string; httpStatus?: number; failureCode?: string; sha256: string; size: number;
  eligible: boolean; reason?: string; offline: boolean;
}
export interface ArchiveEntry { key: string; path: string; sha256: string; size: number; state: 'unknown'; targetDate: string; wing?: string; courtIds: number[];
  lastWriteAt: string; archivedAt: string; note: string }
export interface ArchiveIndex { version: 1; entries: ArchiveEntry[] }
const time = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
const slash = (path: string) => path.split(sep).join('/');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Read-only scan of every submission journal in the lifecycle stores. */
export async function scanJournals(root: string, now = Date.now()): Promise<JournalRecordSummary[]> {
  const out: JournalRecordSummary[] = [];
  async function walk(directory: string) {
    if (!existsSync(directory)) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (entry.name !== 'recycle-locks') await walk(path); continue; }
      if (!entry.name.endsWith('.json')) continue;
      let bytes: Buffer, value: any;
      try { bytes = await readFile(path); value = JSON.parse(bytes.toString('utf8')); } catch { continue; }
      if (!value || !value.attempt || typeof value.state !== 'string') continue;
      const a = value.attempt, key = value.key, mtime = (await lstat(path)).mtimeMs;
      const created = time(value.createdAt), updated = time(value.updatedAt), lastWrite = Math.max(Number.isFinite(created) ? created : 0, Number.isFinite(updated) ? updated : 0, mtime);
      let reason: string | undefined;
      const wellFormed = typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) && path.endsWith(`${key}.json`) && ['armed', 'dispatching'].includes(a.stage) && Number.isFinite(created) && Number.isFinite(updated);
      if (value.state !== 'unknown') reason = `STATE_${String(value.state).toUpperCase()}`;
      else if (!wellFormed) reason = 'UNKNOWN_RECORD_UNRECOGNIZED';
      else if (updated > now + 60_000 || created > now + 60_000) reason = 'UNKNOWN_RECORD_FUTURE_DATED';
      else if (now - lastWrite < HISTORICAL_QUIET_MS) reason = 'UNKNOWN_RECORD_RECENT';
      else if ([a.releaseMs, a.dispatchDeadlineMs, a.triggerMs, a.shotDeadlineMs].some(d => d !== undefined && (!Number.isSafeInteger(d) || d > now))) reason = 'UNKNOWN_RECORD_DISPATCH_WINDOW_OPEN';
      else { const expiries = value.observedResponse?.holdExpiresAt;
        if (expiries !== undefined && (!Array.isArray(expiries) || expiries.some((x: unknown) => !Number.isFinite(time(x)) || time(x) > now))) reason = 'UNKNOWN_RECORD_HOLD_MAY_BE_ACTIVE'; }
      out.push({ path: slash(relative(root, path)), key: typeof key === 'string' ? key : '', state: value.state, targetDate: String(a.targetDate ?? 'unknown'), ...(a.wing ? { wing: a.wing } : {}),
        courtIds: Array.isArray(a.courtIds) ? a.courtIds : [], ...(a.stage ? { stage: a.stage } : {}), lastWriteAt: new Date(lastWrite).toISOString(),
        ...(value.diagnostic?.status ? { httpStatus: value.diagnostic.status } : {}), ...(value.failureCode ? { failureCode: value.failureCode } : {}),
        sha256: sha(bytes), size: bytes.length, eligible: !reason, ...(reason ? { reason } : {}), offline: a.executionMode === 'OFFLINE_INTERCEPTED' });
    }
  }
  for (const store of LIFECYCLE_STORES) await walk(join(root, store));
  return out.sort((a, b) => a.targetDate.localeCompare(b.targetDate) || a.path.localeCompare(b.path));
}

export async function readArchiveIndex(root: string): Promise<ArchiveIndex> {
  try { const value = JSON.parse(await readFile(join(root, ARCHIVE_DIRECTORY, 'index.json'), 'utf8')) as ArchiveIndex;
    if (value.version !== 1 || !Array.isArray(value.entries)) throw Error('JOURNAL_ARCHIVE_INDEX_INVALID'); return value; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: [] }; throw error; }
}
async function writeIndex(root: string, index: ArchiveIndex) {
  const directory = join(root, ARCHIVE_DIRECTORY); await mkdir(directory, { recursive: true });
  const temporary = join(directory, `index.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(index, null, 2), { mode: 0o600 }); await rename(temporary, join(directory, 'index.json'));
}
async function audit(root: string, event: Record<string, unknown>) {
  const directory = join(root, ARCHIVE_DIRECTORY); await mkdir(directory, { recursive: true });
  await appendFile(join(directory, 'audit.ndjson'), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
}

/**
 * Archives exactly the requested records (identified by their relative journal path: one logical key can have several
 * files, e.g. earlier attempt copies of the same court/time) if each is currently eligible. Never touches the files.
 */
export async function archiveHistoricalUnknown(root: string, paths: readonly string[], note: string, now = Date.now()) {
  const records = await scanJournals(root, now), index = await readArchiveIndex(root);
  const archived: ArchiveEntry[] = [], refused: Array<{ path: string; reason: string }> = [];
  for (const path of new Set(paths)) {
    const record = records.find(r => r.path === path);
    if (!record) { refused.push({ path, reason: 'NOT_FOUND' }); continue; }
    if (!record.eligible || record.offline) { refused.push({ path, reason: record.reason ?? 'OFFLINE_RECORD' }); continue; }
    if (index.entries.some(e => e.path === path)) { refused.push({ path, reason: 'ALREADY_ARCHIVED' }); continue; }
    archived.push({ key: record.key, path: record.path, sha256: record.sha256, size: record.size, state: 'unknown', targetDate: record.targetDate, ...(record.wing ? { wing: record.wing } : {}),
      courtIds: record.courtIds, lastWriteAt: record.lastWriteAt, archivedAt: new Date(now).toISOString(), note: note.slice(0, 200) });
  }
  if (archived.length) { await writeIndex(root, { version: 1, entries: [...index.entries, ...archived] }); await audit(root, { action: 'ARCHIVE', note: note.slice(0, 200), entries: archived.map(e => ({ key: e.key, path: e.path, sha256: e.sha256 })) }); }
  return { archived, refused };
}
/** Removes index entries (by journal path) only. The journals were never moved, so nothing is restored on disk. */
export async function restoreArchived(root: string, paths: readonly string[], note: string) {
  const index = await readArchiveIndex(root), restore = new Set(paths);
  const restored = index.entries.filter(e => restore.has(e.path));
  if (restored.length) { await writeIndex(root, { version: 1, entries: index.entries.filter(e => !restore.has(e.path)) }); await audit(root, { action: 'RESTORE', note: note.slice(0, 200), entries: restored.map(e => ({ key: e.key, path: e.path })) }); }
  return { restored: restored.map(e => e.path) };
}
/** Re-hashes every archived original. CHANGED or MISSING means the archive no longer describes that evidence. */
export async function verifyArchive(root: string) {
  const index = await readArchiveIndex(root);
  const results = await Promise.all(index.entries.map(async e => {
    try { const bytes = await readFile(resolve(root, e.path)); const value = JSON.parse(bytes.toString('utf8'));
      return { key: e.key, path: e.path, status: sha(bytes) === e.sha256 && value.state === 'unknown' ? 'MATCH' as const : 'CHANGED' as const }; }
    catch { return { key: e.key, path: e.path, status: 'MISSING' as const }; }
  }));
  await audit(root, { action: 'VERIFY', total: results.length, match: results.filter(r => r.status === 'MATCH').length });
  return results;
}
/** Operator view: active (non-archived) UNKNOWN records stay visible; archived ones move to the archive tab. */
export async function journalOverview(root: string, now = Date.now()) {
  const [records, index] = await Promise.all([scanJournals(root, now), readArchiveIndex(root)]);
  const archivedPaths = new Set(index.entries.map(e => e.path));
  const unknown = records.filter(r => r.state === 'unknown' && !r.offline);
  return { checkedAt: new Date(now).toISOString(),
    activeUnknown: unknown.filter(r => !archivedPaths.has(r.path)), archived: index.entries,
    eligible: unknown.filter(r => r.eligible && !archivedPaths.has(r.path)).map(r => r.path),
    counts: { journals: records.length, unknown: unknown.length, archived: index.entries.length,
      verified: records.filter(r => r.state === 'verified').length, rejected: records.filter(r => r.state === 'rejected').length,
      armedOrDispatching: records.filter(r => ['armed', 'dispatching'].includes(r.state)).length } };
}
