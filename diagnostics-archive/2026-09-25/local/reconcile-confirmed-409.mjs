import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const root=resolve('.local/api-booking');
const current=join(root,'api-first-journals');
if(existsSync(resolve('.local/automation.lock'))||existsSync(resolve('.local/preparation.lock')))
  throw Error('ACTIVE_OR_UNRESOLVED_LOCK');
const records=[];
for(const item of await readdir(current,{withFileTypes:true})){
  if(!item.isDirectory()||!/^[a-f0-9]{64}$/.test(item.name))continue;
  const directory=join(current,item.name),path=join(directory,`${item.name}.json`);
  try{records.push({directory,record:JSON.parse(await readFile(path,'utf8'))});}catch{}
}
const groups=new Map();
for(const entry of records){
  const r=entry.record;
  if(r.state!=='unknown'||r.failureCode!=='ONDA_HTTP_STATUS_INVALID'||r.diagnostic?.status!==409)continue;
  const key=r.attempt?.planFingerprint;
  if(!/^[a-f0-9]{64}$/.test(key??''))continue;
  groups.set(key,[...(groups.get(key)??[]),entry]);
}
let eligible=0;
for(const entries of groups.values()){
  if(entries.length!==2)continue;
  const [first,second]=entries.map(e=>e.record);
  if(entries.some(({directory,record})=>record.key!==directory.split(/[\\/]/).at(-1)||
    record.attempt?.attemptId!==record.key||record.attempt?.targetDate!=='2026-09-23'||
    record.diagnostic?.responseSource!=='application'||record.observedResponse?.bookingIds?.length||
    record.observedResponse?.transactionId)||
    JSON.stringify(first.attempt.courtIds)!==JSON.stringify(second.attempt.courtIds)||
    JSON.stringify(first.attempt.hourlyBoundaries)!==JSON.stringify(second.attempt.hourlyBoundaries))continue;
  const captures=[];
  for(const entry of entries){
    try{captures.push(JSON.parse(await readFile(join(entry.directory,'checkout-response-private.json'),'utf8')));}catch{}
  }
  if(captures.length!==1)continue;
  const capture=captures[0],body=JSON.parse(capture.body);
  if(capture.status!==409||!String(capture.contentType).toLowerCase().includes('application/json')||
    body.success!==false||body.error!=='This facility allows up to 2 courts per online checkout.'||
    Object.hasOwn(body,'bookings')||Object.hasOwn(body,'transaction'))continue;
  const capturedAt=Date.parse(capture.capturedAt);
  if(!Number.isFinite(capturedAt)||entries.some(({record})=>Math.abs(Date.parse(record.updatedAt)-capturedAt)>60000))continue;
  eligible++;
  if(process.argv.includes('--apply')){
    const archive=join(root,'rejected-attempts');await mkdir(archive,{recursive:true});
    for(const entry of entries){
      await writeFile(join(entry.directory,'confirmed-rejection-reconciliation.json'),JSON.stringify({
        reconciledAt:new Date().toISOString(),reason:'OFFICIAL_HTTP_409_CONFIRMED_NO_BOOKINGS',
        responseStatus:409,sourceKey:entries.find(e=>e.directory!==entry.directory)?.record.key??entry.record.key}));
      await rename(entry.directory,join(archive,`${entry.record.key}-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`));
    }
  }
}
console.log(`Confirmed 409 rejection groups: ${eligible}; ${process.argv.includes('--apply')?'archived':'dry review only'}`);
