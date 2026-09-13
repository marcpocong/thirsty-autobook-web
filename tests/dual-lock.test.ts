import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { reviewLock, clearVerifiedLock } from '../ui/locks.js';
import { resetPracticeSession } from '../ui/practice-reset.js';
import { unknownBrowser, type BrowserReview } from '../src/lock-browser.js';
const clean:BrowserReview={page:'Schedule',selected:0,hold:'Not detected',clean:true};
async function fixture(work:(root:string)=>Promise<void>) {
  await mkdir('.local',{recursive:true});const root=await mkdtemp(resolve('.local/dual-lock-test-'));
  try {
    await mkdir(resolve(root,'.local/dual'),{recursive:true});
    const workers=['A','B'].map(id=>({id,pid:321,runID:'fixture-dual',state:'clean'}));
    await writeFile(resolve(root,'.local/automation.lock'),JSON.stringify({mode:'dual',pid:321,runID:'fixture-dual',workers}));
    for(const w of workers)await writeFile(resolve(root,`.local/dual/worker-${w.id.toLowerCase()}.lock`),JSON.stringify(w));
    await work(root);
  } finally { if(!root.startsWith(resolve('.local')+sep))throw Error('UNSAFE_TEST_PATH');await rm(root,{recursive:true,force:true}); }
}
it('dual safe clear rechecks both dead workers and clean schedules, then removes subordinate and global locks',()=>fixture(async root=>{
  const probe=async()=>clean,dead=()=>false;
  const r=await reviewLock(root,false,probe,dead,probe);expect(r.mode).toBe('dual');expect(r.canClear).toBe(true);expect(r.workers?.map(w=>w.pid)).toEqual([321,321]);
  await clearVerifiedLock(root,r.fingerprint,()=>false,probe,dead,probe);
  for(const f of ['automation.lock','dual/worker-a.lock','dual/worker-b.lock'])await expect(readFile(resolve(root,'.local',f))).rejects.toThrow();
}));
it.each(['active','owned','hold-a','hold-b','unknown-b','review-b','selection-b','missing-state','wrong-run','wrong-worker-pid'])('refuses dual clear for %s',kind=>fixture(async root=>{
  const a=async()=>kind==='hold-a'?{...unknownBrowser,hold:'Active' as const}:clean;
  const b=async()=>kind==='hold-b'?{...unknownBrowser,hold:'Active' as const}:kind==='unknown-b'?unknownBrowser:kind==='review-b'?{...unknownBrowser,page:'Review Booking' as const}:kind==='selection-b'?{...clean,selected:1,clean:false}:clean;
  if(kind==='missing-state')await rm(resolve(root,'.local/dual/worker-b.lock'));
  if(kind==='wrong-run'||kind==='wrong-worker-pid')await writeFile(resolve(root,'.local/dual/worker-b.lock'),JSON.stringify({id:'B',pid:kind==='wrong-worker-pid'?999:321,runID:kind==='wrong-run'?'other':'fixture-dual',state:'clean'}));
  const alive=()=>kind==='active',owned=kind==='owned',r=await reviewLock(root,owned,a,alive,b);expect(r.canClear).toBe(false);
  await expect(clearVerifiedLock(root,r.fingerprint,()=>owned,a,alive,b)).rejects.toThrow();expect(await readFile(resolve(root,'.local/automation.lock'),'utf8')).toContain('fixture-dual');
}));
it('worker state replacement invalidates review fingerprint',()=>fixture(async root=>{
  const probe=async()=>clean,dead=()=>false,r=await reviewLock(root,false,probe,dead,probe);
  await writeFile(resolve(root,'.local/dual/worker-b.lock'),JSON.stringify({id:'B',pid:321,runID:'fixture-dual',state:'hold'}));
  await expect(clearVerifiedLock(root,r.fingerprint,()=>false,probe,dead,probe)).rejects.toThrow('LOCK_BROWSER_STATE_UNKNOWN');
}));
it('single-browser practice reset cannot discard a dual lock or hold',()=>fixture(async root=>{
  await expect(resetPracticeSession(root,async()=>{throw Error('should not probe');},async()=>clean,async()=>true)).rejects.toThrow('DUAL_RESET_NOT_ALLOWED');
  expect(await readFile(resolve(root,'.local/automation.lock'),'utf8')).toContain('dual');
}));
