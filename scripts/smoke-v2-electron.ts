import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require=createRequire(import.meta.url),executablePath=require('electron') as string;
const env=Object.fromEntries(Object.entries({...process.env,THIRSTY_NODE_EXEC:process.execPath}).filter(([key,value])=>key!=='ELECTRON_RUN_AS_NODE'&&typeof value==='string')) as Record<string,string>;
const app=await _electron.launch({executablePath,args:[resolve('dist/ui/main.js')],env,timeout:30_000});
try {
  const page=await app.firstWindow(),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.locator('nav').waitFor({state:'visible',timeout:30_000});
  const state=await page.evaluate(()=>window.thirsty.getStatus());
  if(state.operation!=='idle'||state.scheduledRelease||state.activeApiRelease)throw Error('ELECTRON_SMOKE_NOT_IDLE');
  await mkdir('.local/v2-ui',{recursive:true});
  await page.screenshot({path:'.local/v2-ui/electron-candidate-home-private.png',fullPage:true});
  await page.locator('nav [data-dest="setup"]').click();
  await page.locator('#dest-setup').waitFor({state:'visible'});
  await page.screenshot({path:'.local/v2-ui/electron-candidate-setup-private.png',fullPage:true});
  if(errors.length)throw Error('ELECTRON_RENDERER_ERRORS');
  await writeFile('.local/v2-ui/electron-smoke.json',JSON.stringify({candidate:true,installed:false,operation:state.operation,
    scheduled:false,termsAuthorized:state.termsAuthorized,rendererErrors:errors.length,build:state.build},null,2));
  console.log('ELECTRON_CANDIDATE_SMOKE_PASS · idle · no scheduling or booking action');
}finally{await app.close();}
