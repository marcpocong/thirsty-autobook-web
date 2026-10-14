import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe,it,expect,afterEach } from 'vitest';
// @ts-expect-error plain ESM build helper
import { distContentId } from '../scripts/build-support.mjs';
// @ts-expect-error plain ESM installation helper
import { detectInstallation,assertSafeUpdate,applyUpdate,managedFiles,hashFile } from '../scripts/app-installation.mjs';
const fixtures:string[]=[];
afterEach(async()=>{for(const p of fixtures.splice(0))await rm(p,{recursive:true,force:true});});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'pickle-update-'));fixtures.push(root);return root;}
async function put(root:string,path:string,value:string){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),value);}
async function recognized(){const root=await fixture();await mkdir(join(root,'Source'));await mkdir(join(root,'.local/private'),{recursive:true});
const info={gitSha:'a'.repeat(40),buildId:'old-build',contentId:''};
for(const file of ['Thirsty Pickle Bot.exe','.local/runtime/node.exe','scripts/run-thirsty-pickle-bot.mjs','node_modules/electron/dist/electron.exe'])await put(root,file,'old');
await mkdir(join(root,'dist'));info.contentId=await distContentId(join(root,'dist'));await put(root,'dist/build-info.json',JSON.stringify(info));await put(root,'config.local.json','{ "BOOKING_METHOD": "proofless", "MAX_PRICE": 0 }\r\n');
await put(root,'BUILD-INFO.txt',`Thirsty Pickle Bot self-contained installation\nSource Commit: ${info.gitSha}\nBuild ID: ${info.buildId}\nLauncher SHA256: ${await hashFile(join(root,'Thirsty Pickle Bot.exe'))}`);return root;}
describe('canonical update detection and lifecycle refusal',()=>{
 it('recognizes the exact parent and refuses missing markers, nested ambiguity and changed launcher',async()=>{
 const root=await recognized();expect((await detectInstallation(join(root,'Source'))).root).toBe(root);
 await put(root,'Thirsty Pickle Bot/Thirsty Pickle Bot.exe','duplicate');await expect(detectInstallation(join(root,'Source'))).rejects.toThrow('AMBIGUOUS');
 await rm(join(root,'Thirsty Pickle Bot'),{recursive:true});await put(root,'Thirsty Pickle Bot.exe','tampered');await expect(detectInstallation(join(root,'Source'))).rejects.toThrow('PROVENANCE');
 await expect(detectInstallation(join(await fixture(),'Source'))).rejects.toThrow('UNRECOGNIZED');
 const second=await recognized();await put(second,'dist/tampered.js','bad');await expect(detectInstallation(join(second,'Source'))).rejects.toThrow('RUNTIME_INCONSISTENT');
 });
 it('refuses active app, unknown dispatch and active hold without modifying them',async()=>{
 const root=await recognized();await expect(assertSafeUpdate(root,{processes:[{ExecutablePath:root+'\\node_modules\\electron\\dist\\electron.exe'}]})).rejects.toThrow('ACTIVE_PROCESS');
 const lock=JSON.stringify({stage:'FINAL_ACTION_DISPATCHING'});await put(root,'.local/automation.lock',lock);
 await expect(assertSafeUpdate(root,{processes:[]})).rejects.toThrow('UNRESOLVED');expect(await readFile(join(root,'.local/automation.lock'),'utf8')).toBe(lock);
 await put(root,'.local/automation.lock',JSON.stringify({stage:'HOLD_VERIFIED',holdExpiresAt:'2099-01-01T00:00:00Z'}));await expect(assertSafeUpdate(root,{processes:[]})).rejects.toThrow('UNRESOLVED');
 await put(root,'.local/automation.lock',JSON.stringify({stage:'HOLD_VERIFIED',holdExpiresAt:'2020-01-01T00:00:00Z'}));await expect(assertSafeUpdate(root,{processes:[]})).resolves.toBeUndefined();
 await put(root,'.local/api-booking/api-first-journals/key/record.json',JSON.stringify({attempt:{},state:'unknown'}));await expect(assertSafeUpdate(root,{processes:[]})).rejects.toThrow('UNRESOLVED_JOURNAL');
 });
});
async function transaction(){const root=await recognized(),stage=join(root,'.local/build/staging');
for(const name of managedFiles){await put(root,name==='dist'?'dist/file':name==='node_modules'?'node_modules/file':['src','ui','scripts','assets/brand'].includes(name)?name+'/file':name,'previous');await put(stage,['dist','src','ui','scripts','node_modules','assets/brand'].includes(name)?name+'/file':name,'new');}
await put(root,'.local/private/customer.json','private');await put(root,'.local/api-first-chrome-profile/Default/Cookies','cookies');return{root,stage};}
describe('in-place transaction with private state preservation',()=>{
 it('replaces managed files only and retains an internal numbered rollback',async()=>{
 const {root,stage}=await transaction();const config=await readFile(join(root,'config.local.json'),'utf8');await applyUpdate(root,stage);
 expect(await readFile(join(root,'Thirsty Pickle Bot.exe'),'utf8')).toBe('new');expect(await readFile(join(root,'config.local.json'),'utf8')).toBe(config);
 expect(await readFile(join(root,'.local/private/customer.json'),'utf8')).toBe('private');expect(await readFile(join(root,'.local/api-first-chrome-profile/Default/Cookies'),'utf8')).toBe('cookies');
 expect(await readFile(join(root,'.local/build/rollback/9'),'utf8')).toBe('previous');
 });
 it('restores all previous runtime files after a mid-install failure or installed validation failure',async()=>{
 for(const mode of ['move','validation']){const{root,stage}=await transaction();let validations=0;
 await expect(applyUpdate(root,stage,{afterMove:async(name:string)=>{if(mode==='move'&&name==='scripts')throw Error('injected');},validate:async()=>{if(mode==='validation'&&++validations===2)throw Error('injected');}})).rejects.toThrow('injected');
 expect(await readFile(join(root,'Thirsty Pickle Bot.exe'),'utf8')).toBe('previous');expect(await readFile(join(root,'dist/file'),'utf8')).toBe('previous');expect(await readFile(join(root,'.local/private/customer.json'),'utf8')).toBe('private');expect(JSON.parse(await readFile(join(root,'.local/build/update-transaction.json'),'utf8')).status).toBe('ROLLED_BACK');}
 });
 it('does not touch runtime when stage integrity or the final lifecycle recheck fails',async()=>{
 const{root,stage}=await transaction();await expect(applyUpdate(root,stage,{validate:async()=>{throw Error('bad package');}})).rejects.toThrow('bad package');
 expect(await readFile(join(root,'Thirsty Pickle Bot.exe'),'utf8')).toBe('previous');
 await expect(applyUpdate(root,stage,{beforeApply:async()=>{throw Error('new hold');}})).rejects.toThrow('new hold');expect(await readFile(join(root,'dist/file'),'utf8')).toBe('previous');
 });
});
