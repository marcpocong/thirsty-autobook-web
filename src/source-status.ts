import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

/**
 * Read-only identity of a local source checkout (HEAD commit and branch), parsed from .git metadata without running
 * git. Used only to tell the operator whether the source folder is ahead of the installed build; it never implies the
 * newer source is built, CI-verified or installed.
 */
export function readSourceStatus(roots: readonly string[], now = new Date()): { headSha: string | null; branch: string | null; readAt: string } | null {
  for (const root of roots) {
    let git = join(root, '.git');
    // Worktrees keep HEAD beside their gitdir file and shared refs in commondir.
    try{if(existsSync(git)&&statSync(git).isFile()){const match=/^gitdir: ([^\r\n]+)\r?\n?$/.exec(readFileSync(git,'utf8'));if(!match)continue;git=resolve(root,match[1]!);}}catch{continue;}
    if (!existsSync(join(git, 'HEAD'))) continue;
    try {
      const head = readFileSync(join(git, 'HEAD'), 'utf8').trim();
      if (/^[a-f0-9]{40}$/.test(head)) return { headSha: head, branch: null, readAt: now.toISOString() };
      const ref = /^ref: (refs\/heads\/[A-Za-z0-9._\/-]{1,200})$/.exec(head)?.[1];
      if (!ref || ref.includes('..')) return { headSha: null, branch: null, readAt: now.toISOString() };
      const branch = ref.slice('refs/heads/'.length);
      let common=git;try{if(existsSync(join(git,'commondir')))common=resolve(git,readFileSync(join(git,'commondir'),'utf8').trim());}catch{/* use gitdir */}
      const loose = join(common, ...ref.split('/'));
      if (existsSync(loose)) { const sha = readFileSync(loose, 'utf8').trim(); return { headSha: /^[a-f0-9]{40}$/.test(sha) ? sha : null, branch, readAt: now.toISOString() }; }
      const packed = existsSync(join(common, 'packed-refs')) ? readFileSync(join(common, 'packed-refs'), 'utf8') : '';
      const line = packed.split(/\r?\n/).find(value => value.endsWith(` ${ref}`));
      const sha = line?.slice(0, 40) ?? null;
      return { headSha: sha && /^[a-f0-9]{40}$/.test(sha) ? sha : null, branch, readAt: now.toISOString() };
    } catch { return { headSha: null, branch: null, readAt: now.toISOString() }; }
  }
  return null;
}
/** Read-only update transaction evidence. Availability is not permission to install or roll back. */
export function readUpdateHistory(root:string):{lastSuccessfulUpdate:string|null;rollbackAvailable:boolean;transactionStatus:string}|null{
  try{
    const path=join(root,'.local/build/update-transaction.json'),v=JSON.parse(readFileSync(path,'utf8')) as {schema?:unknown;status?:unknown;entries?:Array<{backup?:unknown}>};
    if(v.schema!==1||typeof v.status!=='string'||!['INSTALLED','ROLLED_BACK','APPLYING','PREPARING'].includes(v.status)||!Array.isArray(v.entries))return null;
    const home=resolve(root,'.local/build/rollback');
    const rollbackAvailable=['INSTALLED','APPLYING'].includes(v.status)&&v.entries.length>0&&v.entries.every(e=>typeof e.backup==='string'&&dirname(resolve(e.backup))===home&&/^\d+$/.test(resolve(e.backup).slice(home.length+1))&&existsSync(e.backup));
    return {lastSuccessfulUpdate:v.status==='INSTALLED'?statSync(path).mtime.toISOString():null,rollbackAvailable,transactionStatus:v.status};
  }catch{return null;}
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
