import {describe,it,expect,vi,afterEach} from 'vitest';
const fault=vi.hoisted(()=>({stage:'' as ''|'write'|'sync'|'link',writes:0,writeAt:1}));
vi.mock('node:fs/promises',async original=>{
  const fs=await original<typeof import('node:fs/promises')>();
  return {...fs,link:async(...args:Parameters<typeof fs.link>)=>{if(fault.stage==='link')throw Object.assign(Error('synthetic disk fault'),{code:'EIO'});return fs.link(...args);},
    open:async(...args:Parameters<typeof fs.open>)=>{const handle=await fs.open(...args);if(!String(args[0]).includes('.pending-'))return handle;
      return new Proxy(handle,{get(target,key){if(key==='writeFile')return async(...values:Parameters<typeof handle.writeFile>)=>{
        fault.writes++;if(fault.stage==='write'&&fault.writes===fault.writeAt)throw Object.assign(Error('synthetic full disk'),{code:'ENOSPC'});return target.writeFile(...values);};
        if(key==='sync'&&fault.stage==='sync')return async()=>{throw Object.assign(Error('synthetic flush fault'),{code:'EIO'});};
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    }};
});
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pendingFixture,fixtureNow} from '../helpers/pending-hold-fixture.js';
import {saveCheckoutRecovery,prepareCheckoutRecovery,CHECKOUT_RECOVERY_FILE} from '../../src/api-booking/checkout-recovery.js';
import type {CheckoutHttpResponse} from '../../src/api-booking/browser-session-transport.js';
import {appendHoldVerification,readHoldVerification} from '../../src/api-booking/pending-hold-state.js';
const roots:string[]=[];
afterEach(async()=>{fault.stage='';fault.writes=0;fault.writeAt=1;for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function data(){const root=await mkdtemp(join(tmpdir(),'recovery-disk-'));roots.push(root);const f=await pendingFixture(root);return {...f,target:join(root,'new-capture')};}
describe('private response durability and sanitization',()=>{
  it.each(['write','sync','link'] as const)('does not publish partial captures after %s failure',async stage=>{
    const f=await data();fault.stage=stage;fault.writes=0;
    await expect(saveCheckoutRecovery(f.target,{status:200,body:JSON.stringify(f.raw)} as CheckoutHttpResponse,f.plan,'A',fixtureNow)).rejects.toThrow();
    await expect(readFile(join(f.target,CHECKOUT_RECOVERY_FILE))).rejects.toMatchObject({code:'ENOENT'});
    expect((await readdir(f.target)).filter(x=>x.endsWith('.tmp'))).toEqual([]);
  });
  it('retains a complete capture if the subsequent verification receipt cannot be written',async()=>{
    const f=await data();fault.stage='write';fault.writes=0;fault.writeAt=2;
    await expect(saveCheckoutRecovery(f.target,{status:200,body:JSON.stringify(f.raw)} as CheckoutHttpResponse,f.plan,'A',fixtureNow)).rejects.toThrow();
    fault.stage='';expect((await prepareCheckoutRecovery(f.target,fixtureNow)).hold.trustedTotalAmount).toBe(1800);
    expect(await readHoldVerification(f.target)).toBeNull();
  });
  it('publishes write-once private evidence, excludes unrelated contact/cookie fields and restricts permissions',async()=>{
    const f=await data(),raw={...f.raw,cookies:'DO-NOT-STORE',customer_email:'private-unrelated@example.invalid'};
    await saveCheckoutRecovery(f.target,{status:200,body:JSON.stringify(raw)} as CheckoutHttpResponse,f.plan,'B',fixtureNow);
    const path=join(f.target,CHECKOUT_RECOVERY_FILE),before=await readFile(path,'utf8');
    expect(before).not.toContain('DO-NOT-STORE');expect(before).not.toContain('private-unrelated@example.invalid');
    expect(before).toContain('PRIVATE-A-0'); // necessary original access stays in the private file only
    await expect(saveCheckoutRecovery(f.target,{status:200,body:JSON.stringify(raw)} as CheckoutHttpResponse,f.plan,'C',fixtureNow)).rejects.toMatchObject({code:'EEXIST'});
    expect(await readFile(path,'utf8')).toBe(before);if(process.platform!=='win32')expect((await stat(path)).mode&0o077).toBe(0);
    expect(JSON.stringify(await readHoldVerification(f.target))).not.toContain('PRIVATE-A-0');
  });
  it('preserves a receipt for malformed HTTP 200 without reporting local validity or provider success',async()=>{
    const f=await data();await saveCheckoutRecovery(f.target,{status:200,body:'not-json PRIVATE-UNRELATED'} as CheckoutHttpResponse,f.plan,'A',fixtureNow);
    expect(await readHoldVerification(f.target)).toMatchObject({local:'RESPONSE_CAPTURED',provider:'NOT_CHECKED',qr:'NOT_CHECKED'});
    await expect(prepareCheckoutRecovery(f.target,fixtureNow)).rejects.toThrow('CHECKOUT_RESPONSE_INVALID');
    expect(await readFile(join(f.target,CHECKOUT_RECOVERY_FILE),'utf8')).not.toContain('PRIVATE-UNRELATED');
  });
  it('appends concurrent immutable verification records without sequence conflicts or overwrites',async()=>{
    const f=await data(),first=(await readHoldVerification(f.directory))!;const {schema,sequence,...value}=first;
    const results=await Promise.all(Array.from({length:4},()=>appendHoldVerification(f.directory,value)));
    expect(new Set(results.map(v=>v.sequence)).size).toBe(4);expect((await readHoldVerification(f.directory))?.sequence).toBe(5);
    expect(await readFile(f.journalPath,'utf8')).toBe(f.journalBefore);
  });
});
