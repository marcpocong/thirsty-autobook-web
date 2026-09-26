import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {buildReleaseForensics} from '../Source/src/release-forensics.ts';
import {PrecisionSession,classifyActionableObservation,adaptiveMaxAgeMs} from '../Source/src/api-booking/precision-phase3.ts';
const root=resolve(import.meta.dirname,'..'),id='e69098a8-b8b2-444e-b0ea-2b1170f1420f';
const out=join(root,'DiagnosticsLocal/final-forensics-2026-09-26');mkdirSync(out,{recursive:true});
const sources={run:'.local/api-booking/run-progress/'+id+'.ndjson',watch:'.local/slot-watch/2026-09-28_3ca6d99a-c914-4d25-ac93-7ccd75bda270.ndjson',provider:'.local/release-forensics/'+id+'/provider-trace.ndjson',critical:'.local/release-forensics/'+id+'/critical-path.ndjson',freeze:'.local/api-booking/precision-races/'+id+'-phase3-freeze.json'};
for(const [k,v] of Object.entries(sources))copyFileSync(join(root,v),join(out,k+(k==='freeze'?'.json':'.ndjson')));
const lines=k=>readFileSync(join(out,k+'.ndjson'),'utf8').trim().split('\n').map(JSON.parse);
const run=lines('run'),watch=lines('watch'),critical=lines('critical'),auth=JSON.parse(readFileSync(join(out,'freeze.json'),'utf8')).authorization;
const summary=buildReleaseForensics({runProgressPath:join(out,'run.ndjson'),observerLogPath:join(out,'watch.ndjson'),providerTracePath:join(out,'provider.ndjson'),outputDirectory:out,status:'final'});
const session=new PrecisionSession(auth);for(const w of auth.wave1)session.record({id:w.workerId,candidateId:w.candidateId,workerId:w.workerId,wave:'WAVE_1',state:'REJECTED'});
let newest=0;const eligible=[];
for(const o of watch.filter(x=>x.type==='availability')){newest=Math.max(newest,o.seq);const age=adaptiveMaxAgeMs(o.responseOffsetMs-o.requestOffsetMs,2500);const now=auth.releaseMs+o.responseOffsetMs+25;session.observe(classifyActionableObservation(o,newest,auth.releaseMs,now,age));if(o.requestOffsetMs<15000)continue;const selections=session.select('RESCUE',now,age);if(selections.length)eligible.push({seq:o.seq,responseOffsetMs:o.responseOffsetMs,choices:selections.map(s=>({court:s.candidate.court,start:s.candidate.start,worker:s.workerId,evidenceSeq:s.evidenceSeq}))});}
const refreshes=[];const starts=run.filter(x=>x.stage==='SECURITY_PREPARATION_STARTED'&&x.workerId==='G'&&x.elapsedMs>1800000);
for(const start of starts){const finish=run.find(x=>x.stage==='SECURITY_PREPARATION_COMPLETED'&&x.workerId==='G'&&x.elapsedMs>start.elapsedMs);const selected=run.filter(x=>x.stage==='PHASE3_EVIDENCE'&&x.elapsedMs<=start.elapsedMs).at(-1);const latest=run.filter(x=>x.stage==='PHASE3_EVIDENCE'&&x.elapsedMs<=finish.elapsedMs).at(-1);refreshes.push({selectedSeq:selected.seq,latestSeqAtCompletion:latest.seq,durationMs:finish.durationMs,selectedAt:selected.at,completedCorrected:new Date(Date.parse(finish.at)+373).toISOString(),sameSequenceGuardPass:selected.seq===latest.seq});}
const obs=watch.filter(x=>x.type==='availability');
const final={runId:id,outcome:run.find(x=>x.stage==='PHASE3_OUTCOME'),exit:run.find(x=>x.stage==='PROCESS_EXIT'),observer:summary.observer,critical,targets:summary.targets,refreshes,offlineEligibleRescueReads:eligible,latestObservation:obs.at(-1),fitness:Object.fromEntries([...new Set(run.filter(x=>x.stage==='PHASE3_EVIDENCE').map(x=>x.fitness))].map(f=>[f,run.filter(x=>x.stage==='PHASE3_EVIDENCE'&&x.fitness===f).length]))};
writeFileSync(join(out,'analysis.json'),JSON.stringify(final,null,2)+'\n');
console.log(JSON.stringify({out,refreshes,eligible,fitness:final.fitness,last:obs.at(-1),observer:summary.observer},null,2));
