/** Explicit local recovery only; never clears lifecycle evidence or closes processes. */
import { readFile,rename,rm,mkdir,open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { managedFiles,assertSafeUpdate,hashFile,detectInstallation } from './app-installation.mjs';
import { sourceRoot,distContentId } from './build-support.mjs';
const root=resolve(sourceRoot,'..'),home=join(root,'.local/build');
if(process.argv.length>2)throw Error('ROLLBACK_OPTIONS_REFUSED');
await assertSafeUpdate(root);
const record=join(home,'update-transaction.json'),state=JSON.parse(await readFile(record,'utf8'));
const manifest=JSON.parse(await readFile(join(home,'stage-manifest.json'),'utf8'));
if(!['INSTALLED','APPLYING'].includes(state.status)||state.schema!==1||!Array.isArray(state.entries))throw Error('APP_ROLLBACK_UNAVAILABLE');
for(const e of state.entries)if(!managedFiles.includes(e.name)||e.backup!==join(home,'rollback',String(managedFiles.indexOf(e.name))))throw Error('APP_ROLLBACK_RECORD_INVALID');
// A leftover lock signals interrupted work; don't automatically override another updater.
const mutex=await open(join(home,'update.lock'),'wx').catch(()=>{throw Error('APP_UPDATE_LOCK_REQUIRES_REVIEW');});
try {
 const failed=join(home,'failed-runtime');if(existsSync(failed))throw Error('APP_ROLLBACK_PREVIOUS_RECOVERY_PRESENT');await mkdir(failed);
 for(const e of [...state.entries].reverse()) {
  const live=join(root,e.name);if(existsSync(e.backup)) {
   if(existsSync(live))await rename(live,join(failed,String(managedFiles.indexOf(e.name))));
   await mkdir(dirname(live),{recursive:true});await rename(e.backup,live);
  } else if(!e.hadPrevious&&e.phase==='INSTALLED'&&existsSync(live))await rename(live,join(failed,String(managedFiles.indexOf(e.name))));
 }
 const restored=await detectInstallation(sourceRoot);
 if(restored.info.gitSha!==manifest.previous.gitSha||await distContentId(join(root,'dist'))!==manifest.previous.contentId||await hashFile(join(root,'config.local.json'))!==manifest.preserved.config)throw Error('APP_ROLLBACK_VALIDATION_FAILED');
 state.status='ROLLED_BACK';await (await import('node:fs/promises')).writeFile(record,JSON.stringify(state,null,2)+'\n');
 console.log(JSON.stringify({restored:true,exe:join(root,'Thirsty Pickle Bot.exe'),buildId:restored.info.buildId}));
}finally{await mutex.close();await rm(join(home,'update.lock'),{force:true});}
