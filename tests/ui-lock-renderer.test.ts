import {it,expect,beforeAll,afterAll} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,sep} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
import {Controller} from '../ui/controller.js';
import {bookingView,defaultSetup} from '../ui/booking.js';
import {ConfigSchema} from '../src/config.js';
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});});
afterAll(async()=>{await browser.close();});
const plan=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
async function renderer(old=false){
 const page=await browser.newPage();const html=(old?execFileSync('git',['show','2edebd0:ui/renderer/index.html'],{encoding:'utf8'}):await readFile('ui/renderer/index.html','utf8')).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'').replace(/<script[^>]*src="app.js"[^>]*><\/script>/,'');await page.setContent(html);
 const state={operation:'idle',headline:'Test retained lock',detail:'',ready:false,cdp:true,lock:true,inspection:null,clock:null,plan:null,logs:[],liveRace:true,booking:plan,termsAuthorized:false,capabilities:{selectionReady:true,checkoutReady:true,paymentBoundaryReady:true},selection:null,mode:'full',handoff:null};
 await page.evaluate(state=>{(window as any).thirsty={getStatus:async()=>state,onStatus:()=>()=>{},authorizeTerms:async()=>{},saveBooking:async(input:any)=>{state.booking.setup=input;state.booking.fingerprint='saved';state.headline='Booking plan saved';}};},state);
 const source=old?execFileSync('git',['show','2edebd0:ui/renderer/app.ts'],{encoding:'utf8'}):await readFile('ui/renderer/app.ts','utf8');
 await page.addScriptTag({type:'module',content:stripTypeScriptTypes(source)});
 await page.waitForFunction(()=>document.getElementById('headline')?.textContent==='Test retained lock');return page;
}
it('reproduces the previous retained-lock editor and Save disabling in the actual renderer',async()=>{const p=await renderer(true);expect(await p.locator('#duration').isDisabled()).toBe(true);expect(await p.locator('#save-booking').isDisabled()).toBe(true);await p.close();});
it('actual renderer keeps all setup controls, Save, Review and Stop enabled while booking actions remain blocked',async()=>{
 const p=await renderer();for(const id of ['start-time','duration','maximum','attempts','fallback-time','save-booking','review-lock','stop'])expect(await p.locator('#'+id).isEnabled(),id).toBe(true);
 expect(await p.locator('#court-order button').nth(1).isEnabled()).toBe(true);
 for(const id of ['arm','prepare','dry','observe','practice','full-practice'])expect(await p.locator('#'+id).isDisabled(),id).toBe(true);
 expect(await p.locator('#chrome').isEnabled()).toBe(true);
 expect(await p.locator('#full-terms').isEnabled()).toBe(true);
 expect(await p.locator('#full-date').isEnabled()).toBe(true);
 await p.locator('#duration').fill('3');await p.locator('#maximum').fill('1800');await p.locator('#start-time').selectOption('10:00');await p.locator('#save-booking').click();await p.waitForFunction(()=>document.getElementById('edit-status')?.textContent==='BOOKING PLAN SAVED');expect(await p.locator('#duration').inputValue()).toBe('3');await p.close();
});
it('real config save/reload persists duration, price, start, attempts, courts and fallback into engine config under a retained lock',async()=>{
 await mkdir('.local',{recursive:true});const root=await mkdtemp(resolve('.local/config-persistence-'));
 try{await mkdir(resolve(root,'.local'));await writeFile(resolve(root,'.local/automation.lock'),'fixture-lock');await writeFile(resolve(root,'.env.local'),'PLAYER_FULL_NAME=Fixture Player\nPLAYER_PHONE=09123456789\nPLAYER_EMAIL=fixture@example.invalid\n');
 const booking=pathToFileURL(resolve('ui/booking.ts')).href,config=pathToFileURL(resolve('src/config.ts')).href;
 const setup={...defaultSetup,START_TIME:'10:00',DURATION_HOURS:3,MAX_PRICE:1800,MAX_SELECTION_ATTEMPTS:2,PREFERRED_COURTS:[1,2,3,4,5,6,7],FALLBACK_TIMES:['14:00']};
 const script=`import {saveBooking} from ${JSON.stringify(booking)};import {loadConfig} from ${JSON.stringify(config)};process.chdir(${JSON.stringify(root)});saveBooking(${JSON.stringify(setup)});const c=loadConfig();console.log(JSON.stringify({start:c.START_TIME,duration:c.DURATION_HOURS,maximum:c.MAX_PRICE,attempts:c.MAX_SELECTION_ATTEMPTS,courts:c.PREFERRED_COURTS,fallback:c.FALLBACK_TIMES}));`;
 const output=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{encoding:'utf8'});
 expect(JSON.parse(output)).toEqual({start:'10:00',duration:3,maximum:1800,attempts:2,courts:[1,2,3,4,5,6,7],fallback:['14:00']});expect(await readFile(resolve(root,'.local/automation.lock'),'utf8')).toBe('fixture-lock');
 const reload=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {readBooking} from ${JSON.stringify(booking)};process.chdir(${JSON.stringify(root)});console.log(JSON.stringify(readBooking().setup));`],{encoding:'utf8'});expect(JSON.parse(reload)).toEqual(setup);
 }finally{if(!root.startsWith(resolve('.local')+sep))throw Error('UNSAFE_TEST_PATH');await rm(root,{recursive:true,force:true});}
});
it('EXE delegates to the same npm UI entry and main resolves project root independently of cwd',async()=>{
 expect(await readFile('scripts/ThirstyLauncher.cs','utf8')).toContain('scripts/run-ui.mjs');expect(await readFile('scripts/ThirstyLauncher.cs','utf8')).toContain('start.WorkingDirectory = root');expect(await readFile('ui/main.ts','utf8')).toContain("resolve(dirname(fileURLToPath(import.meta.url)), '../..')");
});
