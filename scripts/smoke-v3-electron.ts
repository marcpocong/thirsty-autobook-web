/** Isolated source-candidate UI/IPC smoke. No real browser preparation or provider request is permitted. */
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { newReleaseProfile } from '../src/automatic-release.js';
import { DailyPlanning } from '../ui/daily-planning.js';
import type { Dashboard } from '../ui/types.js';

if(!resolve('.').includes('thirsty-v3-automatic-release'))throw Error('ISOLATED_V3_WORKTREE_REQUIRED');
const profile=newReleaseProfile(Date.now());profile.notifications=false;
await new DailyPlanning(resolve('.')).saveProfile(profile,{operation:'idle'} as Dashboard);
const require=createRequire(import.meta.url),executablePath=require('electron') as string;
const env=Object.fromEntries(Object.entries({...process.env,THIRSTY_NODE_EXEC:process.execPath,THIRSTY_API_TEST_INSTALLATION:'1',
  PLAYER_FULL_NAME:'Synthetic Electron Fixture',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}).filter(([k,v])=>k!=='ELECTRON_RUN_AS_NODE'&&typeof v==='string')) as Record<string,string>;
const application=await _electron.launch({executablePath,args:[resolve('dist/ui/main.js'),'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'],env,timeout:30_000});
try{
  await application.evaluate(({BrowserWindow,session})=>{
    for(const w of BrowserWindow.getAllWindows())w.hide();
    session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
  });
  const page=await application.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.locator('#daily-primary').waitFor({state:'visible'});
  const initial=await page.evaluate(()=>window.thirsty.getStatus());
  if(initial.operation!=='idle'||initial.scheduledRelease||initial.activeApiRelease||initial.termsAuthorized)throw Error('SMOKE_NOT_IDLE_UNARMED');
  const first=await page.evaluate(()=>window.thirsty.daily({action:'generate'})),second=await page.evaluate(()=>window.thirsty.daily({action:'generate'}));
  if(!first.generated||first.generated.id!==second.generated?.id)throw Error('DRAFT_NOT_IDEMPOTENT');
  const before=initial.booking?.fingerprint;
  for(const dest of ['setup','activity','settings','home'])await page.locator(`nav [data-dest="${dest}"]`).click();
  await page.reload();await page.locator('#daily-primary').waitFor({state:'visible'});
  const reloaded=await page.evaluate(()=>window.thirsty.daily({action:'status'})),final=await page.evaluate(()=>window.thirsty.getStatus());
  if(reloaded.generated?.id!==first.generated.id||final.booking?.fingerprint!==before||final.operation!=='idle'||final.scheduledRelease||final.activeApiRelease||final.termsAuthorized)throw Error('SMOKE_CHANGED_AUTHORIZATION');
  const supported=await application.evaluate(({Notification})=>Notification.isSupported());
  if(errors.length)throw Error(`RENDERER_ERRORS:${errors.length}`);
  await mkdir('.local/v3-verification',{recursive:true});await page.screenshot({path:'.local/v3-verification/electron-candidate.png',fullPage:true});
  await writeFile('.local/v3-verification/electron-smoke.json',JSON.stringify({candidate:true,installed:false,operation:final.operation,armed:false,termsAuthorized:false,
    draftId:first.generated.id,rendererReloadPersistence:true,unchangedSavedPlan:true,externalRendererNetworkingBlocked:true,notificationApiSupported:supported,toastReceiptVerified:false,rendererErrors:errors.length,build:final.build},null,2));
  console.log('V3_ELECTRON_SMOKE_PASS · isolated candidate · idle/unarmed · idempotent draft/reload · saved plan unchanged · no provider action');
}finally{await application.close();}
