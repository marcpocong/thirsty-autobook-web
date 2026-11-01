import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pendingFixture,fakeRecoveryPage,fixtureNow} from '../helpers/pending-hold-fixture.js';
import {PendingHoldService} from '../../src/api-booking/pending-hold-service.js';
import {recoverPendingHold} from '../../src/api-booking/pending-hold-recovery.js';
import {DurableSubmissionJournal} from '../../src/api-booking/durable-submission-journal.js';
import {assertCanonicalRecoveryRuntime} from '../../src/api-booking/recovery-runtime.js';
import {assertRecoveryWindow} from '../../src/api-booking/recovery-window.js';
describe('process restart, independent workers and crash evidence',()=>{
  it('blocks external recovery beside an active dispatcher without clearing any lock',async()=>{
    const root=await mkdtemp(join(tmpdir(),'recovery-window-'));try{
      await mkdir(join(root,'.local'));const path=join(root,'.local/automation.lock');
      for(const stage of ['ARMED','FINAL_ACTION_DISPATCHING']){
        const bytes=JSON.stringify({stage,pid:process.pid});await writeFile(path,bytes);
        await expect(assertRecoveryWindow(root,fixtureNow)).rejects.toThrow('RECOVERY_DISPATCH_ACTIVE_OR_UNRESOLVED');expect(await readFile(path,'utf8')).toBe(bytes);
      }
      await writeFile(path,JSON.stringify({stage:'HOLD_VERIFIED',pid:process.pid}));await expect(assertRecoveryWindow(root,fixtureNow)).resolves.toBeUndefined();
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('uses only the existing authenticated lookup when no captured token exists, and keeps token errors separate from local validity',async()=>{
    const root=await mkdtemp(join(tmpdir(),'recovery-token-'));try{
      const f=await pendingFixture(root,'A',7,false,'missing'),{page,mocks}=fakeRecoveryPage(f);
      const result=await recoverPendingHold(page,f.directory,{identity:f.identity,now:()=>fixtureNow,claimRoot:join(root,'claims')});
      expect(result).toMatchObject({local:'LOCAL_RESPONSE_VALID',provider:'PROVIDER_HOLD_CONFIRMED',qr:'QR_READY'});
      expect(mocks.evaluate.mock.calls.map(x=>x[1].kind)).toEqual(['LOOKUP']);
      const invalid=await pendingFixture(root,'B',6,false,'invalid'),p=fakeRecoveryPage(invalid);
      const failure=await recoverPendingHold(p.page,invalid.directory,{identity:invalid.identity,now:()=>fixtureNow,claimRoot:join(root,'claims')});
      expect(failure).toMatchObject({local:'LOCAL_RESPONSE_VALID',provider:'UNKNOWN',code:'CHECKOUT_RECOVERY_TOKEN_MISSING'});expect(p.mocks.evaluate).not.toHaveBeenCalled();
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('requires fresh provider verification in a separate process without editing existing journals',async()=>{
    const root=await mkdtemp(join(tmpdir(),'recovery-restart-'));try{
      const f=await pendingFixture(root),connect=async()=>({page:fakeRecoveryPage(f).page,identity:f.identity,disconnect:async()=>{}});
      const service=new PendingHoldService(root,connect,()=>fixtureNow),id=(await service.list())[0]!.id;
      expect((await service.recover(id)).qr).toBe('QR_READY');
      const script="import {PendingHoldService} from './src/api-booking/pending-hold-service.ts';console.log(JSON.stringify(await new PendingHoldService(process.argv[1]).list()));";
      const text=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',script,root],{cwd:resolve('.'),encoding:'utf8',windowsHide:true});
      const rows=JSON.parse(text);expect(rows[0]).toMatchObject({provider:'UNKNOWN',freshConfirmationRequired:true,outstanding:true});
      expect(text).not.toContain('PRIVATE-');expect(await readFile(f.journalPath,'utf8')).toBe(f.journalBefore);
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('ignores only a proven dead recovery owner after process loss and preserves its claim evidence',async()=>{
    const root=await mkdtemp(join(tmpdir(),'recovery-crash-'));try{
      const f=await pendingFixture(root),claims=join(root,'claims');await mkdir(claims);
      const pid=Number(execFileSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8',windowsHide:true}));
      const owner=randomUUID(),path=join(claims,`A-${owner}.json`),bytes=JSON.stringify({schema:1,worker:'A',pid,owner,at:fixtureNow.toISOString()});await writeFile(path,bytes);
      const state=await recoverPendingHold(fakeRecoveryPage(f).page,f.directory,{identity:f.identity,now:()=>fixtureNow,claimRoot:claims});
      expect(state.qr).toBe('QR_READY');expect(await readFile(path,'utf8')).toBe(bytes);
      await expect(new DurableSubmissionJournal(f.directory).begin(f.key)).rejects.toThrow('DUPLICATE_LOGICAL_BOOKING_BLOCKED');
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('keeps browser B/C tokens and targets isolated during concurrent independent recovery',async()=>{
    const root=await mkdtemp(join(tmpdir(),'recovery-workers-'));try{
      const b=await pendingFixture(root,'B',6),c=await pendingFixture(root,'C',5),bp=fakeRecoveryPage(b),cp=fakeRecoveryPage(c);
      const states=await Promise.all([recoverPendingHold(bp.page,b.directory,{identity:b.identity,now:()=>fixtureNow,claimRoot:join(root,'claims')}),
        recoverPendingHold(cp.page,c.directory,{identity:c.identity,now:()=>fixtureNow,claimRoot:join(root,'claims')})]);
      expect(states.every(s=>s.qr==='QR_READY')).toBe(true);
      const bargs=bp.mocks.evaluate.mock.calls[0]![1] as unknown as {token:string},cargs=cp.mocks.evaluate.mock.calls[0]![1] as unknown as {token:string};
      expect(bargs.token).toBe('PRIVATE-B-0');expect(cargs.token).toBe('PRIVATE-C-0');
      expect(await readFile(b.journalPath,'utf8')).toBe(b.journalBefore);expect(await readFile(c.journalPath,'utf8')).toBe(c.journalBefore);
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('refuses live entry from an unrecognized source/runtime instead of bypassing update protection',async()=>{
    const root=await mkdtemp(join(tmpdir(),'not-an-installation-'));try{await expect(assertCanonicalRecoveryRuntime(root)).rejects.toThrow('RECOVERY_RUNTIME_NOT_VERIFIED');}
    finally{await rm(root,{recursive:true,force:true});}
  });
});
