import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ApiAutomationLock } from '../../src/api-booking/api-automation-lock.js';

let root:string,previous:string;
beforeEach(async()=>{previous=process.cwd();root=await mkdtemp(join(tmpdir(),'thirsty-api-lock-'));process.chdir(root);});
afterEach(async()=>{process.chdir(previous);if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw Error('UNSAFE_TEST_PATH');await rm(root,{recursive:true,force:true});});

it('exclusively records API dispatch and retains a verified hold expiry',async()=>{
 const lock=await ApiAutomationLock.acquire('standard',['A']);
 await expect(ApiAutomationLock.acquire('standard',['A'])).rejects.toThrow('AUTOMATION_LOCK_EXISTS');
 await lock.dispatching();expect(JSON.parse(await readFile('.local/automation.lock','utf8'))).toMatchObject({mode:'standard',workers:['A'],stage:'FINAL_ACTION_DISPATCHING'});
 const holdExpiresAt=new Date(Date.now()+60000).toISOString();await lock.held(holdExpiresAt);
 expect(JSON.parse(await readFile('.local/automation.lock','utf8'))).toMatchObject({stage:'HOLD_VERIFIED',holdExpiresAt});
});

it('removes only its own pre-hold lock when a run ends safely',async()=>{
 const lock=await ApiAutomationLock.acquire('extended',['A','B']);await lock.release();
 await expect(readFile('.local/automation.lock','utf8')).rejects.toMatchObject({code:'ENOENT'});
});
