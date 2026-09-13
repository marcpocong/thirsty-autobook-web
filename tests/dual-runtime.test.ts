import { it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { ConfigSchema } from '../src/config.js';
import { defaultSetup } from '../ui/booking.js';
import { Safety } from '../src/safety.js';
import { Telemetry } from '../src/telemetry.js';
const spies=vi.hoisted(()=>({attach:vi.fn(),guard:vi.fn(),readiness:vi.fn()}));
vi.mock('../src/browser.js',async importOriginal=>({...await importOriginal<typeof import('../src/browser.js')>(),attach:spies.attach}));
vi.mock('../src/diagnostic-schedule.js',()=>({assertDiagnosticSchedule:spies.guard}));
vi.mock('../src/readiness.js',()=>({readScheduleReadiness:spies.readiness}));
import { runDual, requireDualEvidence, dualValidationFingerprint } from '../src/dual-runtime.js';
const config=()=>ConfigSchema.parse({...defaultSetup,COURT_COUNT:2,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'});
beforeEach(()=>{spies.attach.mockReset();spies.guard.mockReset();spies.readiness.mockReset();spies.attach.mockImplementation(async(_s,_t,id)=>({page:{worker:id.workerId}}));spies.guard.mockResolvedValue(undefined);spies.readiness.mockResolvedValue({schedule:'CLEAN',selectedSlots:0,paymentHold:'NONE'});});
async function local(work:()=>Promise<void>){
  const original=process.cwd();await mkdir('.local',{recursive:true});const root=await mkdtemp(resolve('.local/dual-runtime-test-'));
  try{process.chdir(root);await mkdir('.local/onda-chrome-profile',{recursive:true});await mkdir('.local/onda-chrome-profile-b');await work();}finally{process.chdir(original);if(!root.startsWith(resolve(original,'.local')+sep))throw Error('UNSAFE_TEST_PATH');await rm(root,{recursive:true,force:true});}
}
it('readiness attaches A+B separately, guards each page, makes no browser clicks, releases clean lock and records only readiness',()=>local(async()=>{
  await runDual(config(),'readiness',new Safety(),new Telemetry());expect(spies.attach.mock.calls.map(c=>c[2].workerId)).toEqual(['A','B']);
  expect(spies.attach.mock.calls[0]![0]).not.toBe(spies.attach.mock.calls[1]![0]);expect(spies.guard).toHaveBeenCalledTimes(2);
  await expect(readFile('.local/automation.lock')).rejects.toThrow();const evidence=JSON.parse(await readFile('.local/dual/evidence.json','utf8'));expect(evidence.readiness).toBeTruthy();expect(evidence.selection).toBeUndefined();expect(evidence.full).toBeUndefined();
}));
it.each(['A','B'])('readiness fails and retains both worker states when browser %s is unavailable',worker=>local(async()=>{
  spies.attach.mockImplementation(async(_s,_t,id)=>{if(id.workerId===worker)throw Error('CDP_NOT_LISTENING');return {page:{worker:id.workerId}};});
  await expect(runDual(config(),'readiness',new Safety(),new Telemetry())).rejects.toThrow('DUAL_BROWSER_NOT_READY');
  const lock=JSON.parse(await readFile('.local/automation.lock','utf8'));expect(lock.mode).toBe('dual');expect(lock.pid).toBe(process.pid);expect(lock.workers.map((w:any)=>w.pid)).toEqual([process.pid,process.pid]);
  for(const id of ['a','b'])expect(JSON.parse(await readFile(`.local/dual/worker-${id}.lock`,'utf8')).state).toBe('unknown');
}));
it.each(['ONDA_TAB_AMBIGUOUS_OR_MISSING','SECURITY_CHALLENGE','TAB_NOT_VISIBLE'])('dual readiness rejects %s before any interaction',reason=>local(async()=>{
  spies.guard.mockRejectedValue(Error(reason));await expect(runDual(config(),'readiness',new Safety(),new Telemetry())).rejects.toThrow('DUAL_BROWSER_NOT_READY');expect(spies.readiness).not.toHaveBeenCalled();
}));
it('single/dual mutual exclusion uses the original global lock; no worker bypass exists',()=>local(async()=>{
  const {writeFile}=await import('node:fs/promises');const single=JSON.stringify({pid:process.pid,runID:'single'});await writeFile('.local/automation.lock',single);
  await expect(runDual(config(),'readiness',new Safety(),new Telemetry())).rejects.toThrow('AUTOMATION_LOCK_EXISTS');expect(spies.attach).not.toHaveBeenCalled();expect(await readFile('.local/automation.lock','utf8')).toBe(single);
}));
it('count one cannot initialize the coordinator or any browser worker',()=>local(async()=>{await expect(runDual({...config(),COURT_COUNT:1},'readiness',new Safety(),new Telemetry())).rejects.toThrow('DUAL_CONFIG_REQUIRED');expect(spies.attach).not.toHaveBeenCalled();}));
it('two profile paths cannot alias the same physical directory',()=>local(async()=>{
  const {symlink,rmdir}=await import('node:fs/promises');await rmdir(resolve('.local/onda-chrome-profile-b'));
  await symlink(resolve('.local/onda-chrome-profile'),resolve('.local/onda-chrome-profile-b'),process.platform==='win32'?'junction':'dir');
  await expect(runDual(config(),'readiness',new Safety(),new Telemetry())).rejects.toThrow('DUAL_PROFILE_NOT_ISOLATED');
}));
it('unit/browser readiness alone never authorizes dual production',()=>local(async()=>{
  await runDual(config(),'readiness',new Safety(),new Telemetry());spies.attach.mockClear();
  await expect(requireDualEvidence(dualValidationFingerprint(config()),true)).rejects.toThrow('DUAL_SELECTION_NOT_READY');
  await expect(runDual(config(),'race',new Safety(),new Telemetry(),{authorizeTerms:true})).rejects.toThrow('DUAL_SELECTION_NOT_READY');expect(spies.attach).not.toHaveBeenCalled();
}));
