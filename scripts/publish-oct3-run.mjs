import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';

// Explicit, run-matched sources only. Never traverse the runtime tree or copy journals/profiles.
const repo=resolve(import.meta.dirname,'..'),runtime=resolve(repo,'..','.local');
const runId='8bdbde81-c127-46ae-96cf-bdb17564a385',targetDate='2026-10-05';
const watch='2026-10-05_3985a823-0d0e-463e-acb7-230c39819df2';
const output=join(repo,'diagnostics-archive','2026-10-03',runId);
const files=[
  [`api-booking/run-progress/${runId}.ndjson`,'run-progress.ndjson'],
  [`slot-watch/${watch}.ndjson`,'slot-watch.ndjson'],
  [`slot-watch/${watch}.summary.json`,'slot-watch.summary.json'],
  [`slot-watch/${watch}.quality.json`,'slot-watch.quality.json'],
  [`slot-watch/${watch}.txt`,'slot-watch.txt'],
  [`release-forensics/${runId}/provider-trace.ndjson`,'provider-trace.ndjson'],
  [`release-forensics/${runId}/critical-path.ndjson`,'critical-path.ndjson'],
  [`release-forensics/${runId}/summary.json`,'forensics-summary.json'],
  [`release-forensics/${runId}/report.txt`,'forensics-report.txt'],
  [`api-booking/precision-races/${runId}-phase3-freeze.json`,'phase3-freeze.json'],
  ['booking-runs/c6361696-84c9-43b4-8a01-7ad632849058.ndjson','booking-activity.ndjson'],
  ...['2026-10-02T23-50-00-223Z-T-10M','2026-10-02T23-59-00-190Z-T-60S','2026-10-02T23-59-30-191Z-T-30S'].map((name,index)=>[`network-clock-evidence/${name}.json`,`clock-${['10m','60s','30s'][index]}.json`]),
];
const privateKey=/(?:password|secret|token|cookie|credential|email|phone|mobile|customer|profile|sessionid|availabilityproof|checkouturl|redirecturl|rawbody|responsebody|requestbody|journal|lock|fingerprint|useragent|hostname|localpath|browserstorage|paymenturl|qr(?:code|url|data)?|name$)/i;
const pathPattern=/[A-Za-z]:\\[^\s"']+|\/(?:Users|home)\/[^\s"']+/g;
const urlPattern=/https?:\/\/[^\s"']+/g;
const emailPattern=/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g;
const phonePattern=/(?:\+?63|0)9\d{9}/g;
const bookingPattern=/\bBK-[A-Z0-9]+\b/gi;
const providerPattern=/\b[a-z0-9]+::[a-z0-9]+::[a-z0-9-]+\b/gi;
const opaquePattern=/\b[a-f0-9]{64}\b|\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi;
const aliases=new Map([[runId,runId],[watch,watch]]);
let redactions=0;
function alias(value){if(!aliases.has(value))aliases.set(value,`REF_${String(aliases.size-1).padStart(3,'0')}`);return aliases.get(value);}
function scrub(value){return value.replace(pathPattern,()=>{redactions++;return '[LOCAL_PATH]';}).replace(urlPattern,()=>{redactions++;return '[URL]';})
  .replace(emailPattern,()=>{redactions++;return '[EMAIL]';}).replace(phonePattern,()=>{redactions++;return '[PHONE]';})
  .replace(providerPattern,value=>{redactions++;return alias(value);})
  .replace(bookingPattern,value=>{redactions++;return alias(value);})
  .replace(opaquePattern,value=>{redactions++;return alias(value);});}
function sanitize(value,key=''){
  if(privateKey.test(key)){redactions++;return '[REDACTED]';}
  if(Array.isArray(value))return value.map(item=>sanitize(item));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,sanitize(item,name)]));
  return typeof value==='string'?scrub(value):value;
}
function sha(text){return createHash('sha256').update(text).digest('hex');}
async function save(name,text){const path=join(output,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,text);return {path:name,bytes:Buffer.byteLength(text),sha256:sha(text)};}
const manifest=[];
for(const [source,name] of files){
  const raw=await readFile(join(runtime,source),'utf8');let content;
  if(name.endsWith('.ndjson')){
    const records=raw.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
    if(name==='run-progress.ndjson'&&(!records.every(row=>row.runId===runId&&row.targetDate===targetDate)||!records.some(row=>row.stage==='RUN_FINISHED'||row.stage==='PROCESS_EXIT')))throw Error('RUN_PROGRESS_MISMATCH');
    if(name==='booking-activity.ndjson'&&(!records.some(row=>row.type==='run-start'&&Math.abs(Date.parse(row.at)-Date.parse('2026-10-02T23:48:17.389Z'))<5000)||!records.some(row=>row.type==='run-end'&&row.outcome==='complete')))throw Error('BOOKING_ACTIVITY_MISMATCH');
    if(name==='slot-watch.ndjson'&&(records[0]?.id!==watch.slice(targetDate.length+1)||records[0]?.date!==targetDate||records[0]?.releaseMs!==1790985600000))throw Error('SLOT_WATCH_MISMATCH');
    if(['provider-trace.ndjson','critical-path.ndjson'].includes(name)&&records[0]?.runId!==runId)throw Error(`${name}_MISMATCH`);
    content=records.map(row=>JSON.stringify(sanitize(row))).join('\n')+'\n';
  }else if(name.endsWith('.json')){
    const data=JSON.parse(raw);
    if(['forensics-summary.json','phase3-freeze.json'].includes(name)&&data.runId!==runId)throw Error(`${name}_MISMATCH`);
    content=JSON.stringify(sanitize(data),null,2)+'\n';
  }else content=scrub(raw.trimEnd())+'\n';
  manifest.push(await save(name,content));
}
const report=await readFile(join(output,'REPORT.md'),'utf8');
manifest.push({path:'REPORT.md',bytes:Buffer.byteLength(report),sha256:sha(report)});
manifest.sort((a,b)=>a.path.localeCompare(b.path));
const forbidden=/[A-Za-z]:\\Users\\|https?:\/\/|(?:\+?63|0)9\d{9}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\bBK-[A-Z0-9]+\b|checkout-response-private|config\.local\.json|\.env\.local|Bearer\s+[A-Za-z0-9]/i;
for(const entry of manifest){const text=await readFile(join(output,entry.path),'utf8');if(sha(text)!==entry.sha256||Buffer.byteLength(text)!==entry.bytes)throw Error(`ARCHIVE_HASH_MISMATCH: ${entry.path}`);
  if(forbidden.test(text))throw Error(`ARCHIVE_PRIVATE_DATA_CHECK_FAILED: ${entry.path}`);}
await save('manifest.json',JSON.stringify({schema:'sanitized-release-archive/v1',runId,targetDate,watchId:watch,redactions,files:manifest},null,2)+'\n');
console.log(JSON.stringify({output,files:manifest.length,redactions,aliases:aliases.size}));
