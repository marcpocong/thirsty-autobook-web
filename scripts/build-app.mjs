/** Build only into internal staging, then update the one recognized installation. */
import { execFileSync } from 'node:child_process';
import { chmod, cp, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compile, copyAssets, verifyDist, writeBuildInfo, sourceRoot, gitInfo, distContentId } from './build-support.mjs';
import { detectInstallation, assertSafeUpdate, inspectUpdateSafety, describeUpdateSafety, protectedStateManifest, assertProtectedStateUnchanged, applyUpdate, hashFile, treeDigest } from './app-installation.mjs';
import { brandElectronRuntime, verifyRuntimeBranding } from './brand-electron-runtime.mjs';
if(process.platform!=='win32')throw Error('WINDOWS_BUILD_REQUIRED');
if(process.argv.length>2)throw Error('APP_UPDATE_OPTIONS_REFUSED (only the canonical installation may be updated)');
const root=sourceRoot,git=gitInfo();
if(git.dirty!==false||git.branch!=='main')throw Error('APP_UPDATE_COMMITTED_MAIN_REQUIRED');
const remote=execFileSync('git',['ls-remote','origin','refs/heads/main'],{cwd:root,encoding:'utf8'}).trim().split(/\s/)[0];
if(remote!==git.gitSha)throw Error('APP_UPDATE_REMOTE_SOURCE_MISMATCH');
const ci=JSON.parse(execFileSync('gh',['run','list','--commit',git.gitSha,'--workflow','ci.yml','--limit','1','--json','headSha,status,conclusion,url'],{cwd:root,encoding:'utf8'}));
if(ci.length!==1||ci[0].headSha!==git.gitSha||ci[0].status!=='completed'||ci[0].conclusion!=='success')throw Error('APP_UPDATE_FINAL_CI_REQUIRED');
const installation=await detectInstallation(root),output=installation.root;
const home=join(output,'.local/build'),stage=join(home,'staging');
// Installation safety only. Historical UNKNOWN journals are reported and preserved; they stay UNKNOWN and keep blocking their targets.
const safety=await inspectUpdateSafety(output);
for(const line of describeUpdateSafety(safety))console.log(line);
await mkdir(home,{recursive:true});
await writeFile(join(home,'update-preflight.json'),JSON.stringify({gitSha:git.gitSha,...safety},null,2)+'\n');
// No stage or working file is changed while any active blocker remains.
if(safety.blockers.length)throw Error(`${safety.blockers[0].code} (${safety.blockers.length} active blocker(s); see .local/build/update-preflight.json)`);
if(existsSync(join(home,'update.lock')))throw Error('APP_UPDATE_IN_PROGRESS_OR_INTERRUPTED');
const transaction=join(home,'update-transaction.json');
if(existsSync(transaction)&&!['INSTALLED','ROLLED_BACK'].includes(JSON.parse(await readFile(transaction,'utf8')).status))throw Error('APP_UPDATE_RECOVERY_REQUIRED');
if(existsSync(stage))throw Error('APP_UPDATE_STAGE_ALREADY_EXISTS (review the internal stage before removing it)');
await mkdir(stage);
const preserved={config:await hashFile(join(output,'config.local.json')),private:await treeDigest(join(output,'.local/private'))};
// Write-once, read-only record of every lifecycle file (path, size, SHA-256), taken before staging and rechecked after install.
const protectedState=await protectedStateManifest(output),protectedHome=join(home,'protected-state');await mkdir(protectedHome,{recursive:true});
const protectedPath=join(protectedHome,`${new Date().toISOString().replace(/[:.]/g,'-')}-${git.gitSha.slice(0,7)}.json`);
await writeFile(protectedPath,JSON.stringify({recordedAt:new Date().toISOString(),gitSha:git.gitSha,historicalUnknown:safety.historicalUnknown.length,...protectedState},null,2)+'\n',{flag:'wx'});
await chmod(protectedPath,0o444);
console.log(`Protected lifecycle files recorded: ${protectedState.count} (${protectedState.digest})`);
const staging=join(stage,'dist');compile(staging,root);await copyAssets(staging,root);
const buildInfo=await writeBuildInfo(staging,{root,kind:'installation'});
const verification=await verifyDist(staging,{root});if(verification.problems.length)throw Error('PACKAGED_DIST_INCONSISTENT');
for(const name of ['src','ui','scripts','node_modules','assets/brand'])await cp(join(root,name),join(stage,name),{recursive:true});
for(const name of ['package.json','package-lock.json'])await copyFile(join(root,name),join(stage,name));
await mkdir(join(stage,'.local/runtime'),{recursive:true});await copyFile(process.execPath,join(stage,'.local/runtime/node.exe'));
const compiler=['Framework64','Framework'].map(arch=>resolve(process.env.SystemRoot,'Microsoft.NET',arch,'v4.0.30319/csc.exe')).find(existsSync);
if(!compiler)throw Error('CSC_NOT_FOUND');
const icon=join(stage,'.local/thirsty-pickle-bot.ico');
execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts/build-brand-assets.ps1'),'-Source',join(root,'assets/brand/thirsty-pickle-bot.png'),'-Icon',icon],{cwd:root,stdio:'inherit',windowsHide:true});
// Windows can use the owning process's PE icon even when the launcher/window is branded.
// Customize only the staged runtime; node_modules in the source checkout remains pristine.
const runtime=join(stage,'node_modules/electron/dist/electron.exe'),iconBytes=await readFile(icon);
await writeFile(runtime,brandElectronRuntime(await readFile(runtime),iconBytes));
const runtimeBranding=verifyRuntimeBranding(await readFile(runtime),iconBytes);
console.log(`Windows runtime branding verified: ${runtimeBranding.productName} (${runtimeBranding.iconFrames} icon sizes)`);
execFileSync(compiler,['/nologo','/target:winexe','/optimize+',`/win32icon:${icon}`,'/reference:System.Windows.Forms.dll',`/out:${join(stage,'Thirsty Pickle Bot.exe')}`,join(root,'scripts/ThirstyPickleBotLauncher.cs')],{cwd:root,stdio:'inherit',windowsHide:true});
const appHash=await hashFile(join(stage,'Thirsty Pickle Bot.exe'));
await writeFile(join(stage,'BUILD-INFO.txt'),`Thirsty Pickle Bot self-contained installation\nBuilt: ${buildInfo.builtAt}\nSource Commit: ${buildInfo.gitSha}\nBranch: ${buildInfo.branch}\nDirty: no\nBuild ID: ${buildInfo.buildId}\nDist Content ID: ${buildInfo.contentId}\nDist Verified: yes (${verification.checkedFiles} files against a fresh compile of the source)\nLauncher SHA256: ${appHash.toUpperCase()}\nPayment remains manual. Canonical in-place installation.\n`);
// Hash all staged files (including dependencies and launcher), not just compiled modules.
const stagedDigest=await treeDigest(stage);
const expected={};
const {stat}=await import('node:fs/promises');
const {managedFiles}=await import('./app-installation.mjs');
for(const name of managedFiles){const p=join(stage,name),s=await stat(p);expected[name]=await(s.isDirectory()?treeDigest(p):hashFile(p));}
await writeFile(join(home,'stage-manifest.json'),JSON.stringify({gitSha:git.gitSha,buildId:buildInfo.buildId,stagedDigest,expected,runtimeBranding,ci:ci[0],previous:installation.info,preserved,protectedState:{path:protectedPath,count:protectedState.count,digest:protectedState.digest}},null,2));
async function validate(path) {
  const {managedFiles}=await import('./app-installation.mjs');const {stat}=await import('node:fs/promises');
  for(const name of managedFiles){const p=join(path,name),s=await stat(p),digest=await(s.isDirectory()?treeDigest(p):hashFile(p));if(digest!==expected[name])throw Error(`APP_UPDATE_INTEGRITY_FAILED ${name}`);}
  const info=JSON.parse(await readFile(join(path,'dist/build-info.json'),'utf8'));
  if(info.gitSha!==git.gitSha||info.dirty!==false||await distContentId(join(path,'dist'))!==info.contentId)throw Error('APP_UPDATE_PROVENANCE_FAILED');
  verifyRuntimeBranding(await readFile(join(path,'node_modules/electron/dist/electron.exe')),await readFile(join(path,'.local/thirsty-pickle-bot.ico')));
  if(await hashFile(join(output,'config.local.json'))!==preserved.config||await treeDigest(join(output,'.local/private'))!==preserved.private)throw Error('APP_UPDATE_PRIVATE_STATE_CHANGED');
  // Any added, removed or changed lifecycle byte fails validation; an installed failure rolls back.
  await assertProtectedStateUnchanged(output,protectedState);
}
const result=await applyUpdate(output,stage,{validate,beforeApply:async()=>{if(gitInfo().gitSha!==git.gitSha||gitInfo().dirty)throw Error('APP_UPDATE_SOURCE_CHANGED');await assertSafeUpdate(output);await assertProtectedStateUnchanged(output,protectedState);}});
await rm(stage,{recursive:true});
const protectedAfter=await assertProtectedStateUnchanged(output,protectedState);
await writeFile(join(home,'installed-update.json'),JSON.stringify({finishedAt:new Date().toISOString(),output,exe:join(output,'Thirsty Pickle Bot.exe'),previous:installation.info,current:buildInfo,sha256:appHash,preserved,runtimeBranding,
  protectedState:{path:protectedPath,count:protectedAfter.count,digest:protectedAfter.digest,unchangedAfterInstall:true},historicalUnknownPreserved:safety.historicalUnknown.length,ci:ci[0],...result},null,2));
console.log(JSON.stringify({output,exe:join(output,'Thirsty Pickle Bot.exe'),buildId:buildInfo.buildId,gitSha:buildInfo.gitSha,version:buildInfo.packageVersion,privateStatePreserved:true,
  protectedLifecycleFiles:protectedAfter.count,protectedLifecycleUnchanged:true,historicalUnknownPreserved:safety.historicalUnknown.length}));
