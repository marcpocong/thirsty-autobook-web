import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read-only identity of a local source checkout (HEAD commit and branch), parsed from .git metadata without running
 * git. Used only to tell the operator whether the source folder is ahead of the installed build; it never implies the
 * newer source is built, CI-verified or installed.
 */
export function readSourceStatus(roots: readonly string[], now = new Date()): { headSha: string | null; branch: string | null; readAt: string } | null {
  for (const root of roots) {
    const git = join(root, '.git');
    if (!existsSync(join(git, 'HEAD'))) continue;
    try {
      const head = readFileSync(join(git, 'HEAD'), 'utf8').trim();
      if (/^[a-f0-9]{40}$/.test(head)) return { headSha: head, branch: null, readAt: now.toISOString() };
      const ref = /^ref: (refs\/heads\/[A-Za-z0-9._\/-]{1,200})$/.exec(head)?.[1];
      if (!ref || ref.includes('..')) return { headSha: null, branch: null, readAt: now.toISOString() };
      const branch = ref.slice('refs/heads/'.length);
      const loose = join(git, ...ref.split('/'));
      if (existsSync(loose)) { const sha = readFileSync(loose, 'utf8').trim(); return { headSha: /^[a-f0-9]{40}$/.test(sha) ? sha : null, branch, readAt: now.toISOString() }; }
      const packed = existsSync(join(git, 'packed-refs')) ? readFileSync(join(git, 'packed-refs'), 'utf8') : '';
      const line = packed.split(/\r?\n/).find(value => value.endsWith(` ${ref}`));
      const sha = line?.slice(0, 40) ?? null;
      return { headSha: sha && /^[a-f0-9]{40}$/.test(sha) ? sha : null, branch, readAt: now.toISOString() };
    } catch { return { headSha: null, branch: null, readAt: now.toISOString() }; }
  }
  return null;
}
/** The canonical updater's last lifecycle preflight (.local/build/update-preflight.json): counts and verdict only. */
export function readUpdatePreflight(root: string): { gitSha: string | null; checkedAt: string; eligibility: string; blockers: number; historicalUnknown: number } | null {
  try {
    const value = JSON.parse(readFileSync(join(root, '.local/build/update-preflight.json'), 'utf8')) as Record<string, unknown>;
    if (typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt))) return null;
    return { gitSha: typeof value.gitSha === 'string' && /^[a-f0-9]{40}$/.test(value.gitSha) ? value.gitSha : null, checkedAt: value.checkedAt,
      eligibility: typeof value.eligibility === 'string' && /^[A-Z_]{1,40}$/.test(value.eligibility) ? value.eligibility : 'UNKNOWN',
      blockers: Array.isArray(value.blockers) ? value.blockers.length : 0, historicalUnknown: Array.isArray(value.historicalUnknown) ? value.historicalUnknown.length : 0 };
  } catch { return null; }
}
