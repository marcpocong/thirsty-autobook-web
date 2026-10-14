/** Read-only installation preflight: writes nothing, stages nothing and never changes lifecycle evidence. */
import { detectInstallation, inspectUpdateSafety, describeUpdateSafety } from './app-installation.mjs';
import { sourceRoot } from './build-support.mjs';
if(process.argv.length>2)throw Error('APP_UPDATE_CHECK_OPTIONS_REFUSED');
const {root,info}=await detectInstallation(sourceRoot);
const report=await inspectUpdateSafety(root);
console.log(`Installation: ${root}\nInstalled build: ${info.buildId} (${info.gitSha})`);
for(const line of describeUpdateSafety(report))console.log(line);
for(const b of report.blockers)console.log(`  BLOCKER ${b.code}${b.path?` ${b.path}`:''}${b.reason?` (${b.reason})`:''}`);
const byTarget={};for(const h of report.historicalUnknown)byTarget[h.targetDate]=(byTarget[h.targetDate]??0)+1;
for(const [date,count] of Object.entries(byTarget).sort())console.log(`  historical UNKNOWN target ${date}: ${count}`);
process.exitCode=report.blockers.length?1:0;
