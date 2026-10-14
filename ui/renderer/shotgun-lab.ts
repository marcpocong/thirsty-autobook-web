import { COURT_REGISTRY, type Wing } from '../../src/court-registry.js';
import { canonicalReleaseTargetId, exactReleaseTarget } from '../../src/release-target.js';
import { shotgunOffsets } from '../../src/shotgun.js';
import type { DualWingPlan, DualWingTarget } from '../../src/dual-wing-plan.js';
import type { LabResult, LabScenario } from '../../src/shotgun-test-lab.js';
import type { Dashboard } from '../types.js';

const scenarios:Record<LabScenario,string>={ALL_REJECTED:'All attempts rejected · timing comparison',FIRST_SUCCESS:'First attempt succeeds',LATER_SUCCESS:'Later attempt succeeds',MANGO_SUCCESS:'Mango succeeds; Buko incomplete',BUKO_SUCCESS:'Buko succeeds; Mango incomplete',BOTH_SUCCESS:'Both wing objectives succeed',UNKNOWN:'Unknown provider result',PAYMENT_IN_PROGRESS:'409 payment already in progress',THROTTLE:'429 provider throttling',PREPARE_FAILED:'Browser preparation fails',WORKER_UNAVAILABLE:'Worker unavailable',MISSED_TRIGGER:'Request misses trigger',TWO_IN_FLIGHT_SUCCESS:'Two in-flight submissions succeed',PREVIOUS_HOLD:'Previous verified hold active',DUPLICATE_TARGET:'Duplicate exact target',WRONG_WING:'Wrong-wing response',STALE_AVAILABILITY:'Stale availability',MISSING_AVAILABILITY:'Missing availability'};
const get=(id:string)=>document.getElementById(id)!;
const control=(id:string)=>get(id) as HTMLInputElement;
const text=(tag:string,value:string)=>{const e=document.createElement(tag);e.textContent=value;return e;};

export function installShotgunLab(host:{state:()=>Dashboard|null|undefined;showLive:()=>void;setRunning:(value:boolean)=>void}) {
  let targets:DualWingTarget[]=[], running=false, revision=0;
  const customCounts=new Map<string,number>();
  let defaults:{MANGO:{bookingDate:string;releaseAt:string};BUKO:{bookingDate:string;releaseAt:string}}|null=null;
  const scenarioSelect=get('lab-scenario') as HTMLSelectElement;
  scenarioSelect.replaceChildren(...Object.entries(scenarios).map(([value,label])=>new Option(label,value)));
  const status=(value:string)=>{get('lab-status').textContent=value;};
  const edited=()=>{revision++;get('lab-review-output').textContent='Plan changed · review again before running or saving.';get('lab-results').replaceChildren();};
  window.thirsty.onLabPhase?.(phase=>{if(running)status(phase);});
  const makeTarget=(wing:Wing,court=3,date=defaults?.[wing].bookingDate??'')=>({...exactReleaseTarget({wing,court,start:'18:00',durationHours:2,bookingDate:date}),priority:targets.length+1,
    priceAuthority:{source:'offline fixture',capturedAt:new Date().toISOString(),perHour:[700,700],kind:'OFFLINE_FIXTURE' as const}});
  function plan():DualWingPlan {
    const budget=Number(control('lab-budget').value),allocation=control('lab-allocation').value;
    const counts=Object.fromEntries(targets.map((t,i)=>[canonicalReleaseTargetId(t),allocation==='FOCUSED'?(i===0?budget:0):Number((get(`lab-count-${i}`) as HTMLInputElement)?.value??1)]));
    const activeCount=allocation==='CUSTOM'||allocation==='FOCUSED'?Object.values(counts).reduce((a,b)=>a+b,0):budget;
    return {version:2,purpose:control('lab-purpose').value as DualWingPlan['purpose'],objective:control('lab-objective').value as DualWingPlan['objective'],targets:structuredClone(targets),
      shotgun:{enabled:true,budget,allocationMode:allocation==='FOCUSED'?'CUSTOM':allocation as DualWingPlan['shotgun']['allocationMode'],selectedTargetIds:targets.map(canonicalReleaseTargetId),
        ...(allocation==='CUSTOM'||allocation==='FOCUSED'?{customCounts:counts}:{}),windowStartMs:-2000,windowEndMs:0,timingMode:'CUSTOM',customOffsetsMs:shotgunOffsets(activeCount,-2000,0)}};
  }
  function renderTargets() {
    get('lab-targets').replaceChildren(...targets.map((t,index)=>{
      const row=document.createElement('div');row.className='lab-target';
      row.append(text('strong',`Priority ${index+1} · ${t.wing} Court ${t.court}`));
      const fields=document.createElement('div');fields.className='setup-grid';
      const field=(label:string,node:HTMLInputElement|HTMLSelectElement,change:()=>void)=>{node.setAttribute('aria-label',label);const l=document.createElement('label');l.append(text('span',label),node);node.onchange=()=>{try{change();edited();renderTargets();}catch(e){status((e as Error).message);}};fields.append(l);};
      const select=(values:Array<[string,string]>,value:string)=>{const s=document.createElement('select');s.replaceChildren(...values.map(([v,l])=>new Option(l,v)));s.value=value;return s;};
      const input=(type:string,value:string)=>{const i=document.createElement('input');i.type=type;i.value=value;return i;};
      const update=(patch:Partial<DualWingTarget>)=>{const next={...t,...patch};Object.assign(next,exactReleaseTarget({...next,spaceId:undefined}));if(patch.wing||patch.court||patch.bookingDate||patch.start||patch.durationHours)next.priceAuthority={source:'offline fixture',capturedAt:new Date().toISOString(),perHour:Array.from({length:next.durationHours},()=>700),kind:'OFFLINE_FIXTURE'};targets[index]=next;};
      const wing=select([['MANGO','Mango'],['BUKO','Buko']],t.wing);field('Wing',wing,()=>update({wing:wing.value as Wing}));
      const court=select(Array.from({length:7},(_,i)=>[String(i+1),`Court ${i+1}`]),String(t.court));field('Court',court,()=>update({court:Number(court.value)}));
      const date=input('date',t.bookingDate);field('Exact booking date',date,()=>update({bookingDate:date.value}));
      const start=select(Array.from({length:16},(_,i)=>[`${String(i+8).padStart(2,'0')}:00`,`${String(i+8).padStart(2,'0')}:00`]),t.start);field('Start',start,()=>update({start:start.value}));
      const duration=select([['1','1 hour'],['2','2 hours'],['3','3 hours']],String(t.durationHours));field('Duration',duration,()=>update({durationHours:Number(duration.value)}));
      const price=input('text',t.priceAuthority.perHour.join(', '));field('Hourly prices (PHP)',price,()=>{t.priceAuthority={source:'operator confirmed',capturedAt:new Date().toISOString(),perHour:price.value.split(',').map(Number),kind:'OPERATOR_CONFIRMED'};});
      const count=input('number',String(customCounts.get(canonicalReleaseTargetId(t))??1));count.id=`lab-count-${index}`;count.min='0';count.max='42';field('Custom attempts',count,()=>{customCounts.set(canonicalReleaseTargetId(t),Number(count.value));});
      row.append(fields,text('p',`End ${String(Number(t.start.slice(0,2))+t.durationHours).padStart(2,'0')}:00 · ${t.priceAuthority.kind.replaceAll('_',' ')} · ${t.spaceId}`));
      const buttons=document.createElement('div');buttons.className='button-row';
      const action=(label:string,fn:()=>void)=>{const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;b.onclick=()=>{fn();targets.forEach((t,i)=>t.priority=i+1);edited();renderTargets();};buttons.append(b);};
      action('Move up',()=>{if(index>0)[targets[index-1],targets[index]]=[targets[index]!,targets[index-1]!];});
      action('Move down',()=>{if(index<targets.length-1)[targets[index+1],targets[index]]=[targets[index]!,targets[index+1]!];});
      action('Remove',()=>{targets.splice(index,1);});row.append(buttons);return row;
    }));
  }
  async function review() {
    const current=revision,compiled=await window.thirsty.shotgunLab({action:'preview',value:plan()});
    if(current!==revision)throw Error('Plan changed during review');
    const output=get('lab-review-output');output.replaceChildren(text('p',compiled.problems.length?compiled.problems.join(' '):'PLANNING / OFFLINE SUPPORTED · live Shotgun blocked'));
    if(compiled.releaseAt)output.append(text('p',`Configured shared release: ${new Date(compiled.releaseAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'})} Manila. Buko uses your assumed 8 AM schedule.`));
    for(const t of compiled.targets)output.append(text('p',`${t.wing} Court ${t.court} · ${t.bookingDate} · ${t.start}–${t.end} · ${t.attempts} attempts · PHP ${t.priceAuthority.perHour.reduce((a:number,b:number)=>a+b,0)} · ${t.priceAuthority.kind.replaceAll('_',' ')}`));
    if(compiled.shotgun)output.append(text('p',`${compiled.shotgun.shots.length} aggregate attempts · offsets ${compiled.shotgun.shots.map((s:{configuredOffsetMs:number})=>s.configuredOffsetMs).join(', ')} ms · ${Object.keys(compiled.shotgun.counts).length} target allocations`));
    return compiled;
  }
  const safely=(task:()=>Promise<unknown>)=>{void task().catch(e=>status((e as Error).message));};
  get('lab-review').onclick=()=>safely(review);
  get('lab-save').onclick=()=>safely(async()=>{const compiled=await review();if(compiled.problems.length)throw Error('Resolve plan problems before saving');await window.thirsty.shotgunLab({action:'save',value:plan()});status('Dual-wing planning draft saved. Live release remains blocked.');});
  get('lab-load').onclick=()=>safely(async()=>{const saved=await window.thirsty.shotgunLab({action:'load'}) as DualWingPlan|null;if(!saved){status('No saved dual-wing plan yet.');return;}targets=structuredClone(saved.targets);control('lab-purpose').value=saved.purpose;control('lab-objective').value=saved.objective;control('lab-budget').value=String(saved.shotgun.budget);control('lab-allocation').value=saved.shotgun.allocationMode;edited();renderTargets();for(const [i,t] of targets.entries()){const value=saved.shotgun.customCounts?.[canonicalReleaseTargetId(t)]??1;customCounts.set(canonicalReleaseTargetId(t),value);control(`lab-count-${i}`).value=String(value);}await review();});
  get('lab-add').onclick=()=>{if(targets.length>=7){status('At most seven immediate targets.');return;}const wing=(control('lab-wings').value==='MANGO'?'MANGO':control('lab-wings').value==='BUKO'?'BUKO':targets.length%2?'BUKO':'MANGO') as Wing;targets.push(makeTarget(wing,Math.max(1,7-targets.length)));edited();renderTargets();};
  get('lab-dates').onclick=()=>{if(!defaults)return;targets=targets.map(t=>({...t,bookingDate:defaults![t.wing].bookingDate,priceAuthority:{...t.priceAuthority,source:'offline fixture',kind:'OFFLINE_FIXTURE',capturedAt:new Date().toISOString()}}));edited();renderTargets();};
  control('lab-wings').onchange=()=>{const wing=control('lab-wings').value;targets=wing==='BOTH'?[makeTarget('MANGO'),makeTarget('BUKO')]:[makeTarget(wing as Wing)];edited();renderTargets();};
  for(const id of ['lab-purpose','lab-objective','lab-budget','lab-allocation','lab-scenario','lab-countdown'])control(id).onchange=edited;
  get('lab-live').onclick=host.showLive;
  get('lab-stop').onclick=()=>safely(async()=>{await window.thirsty.shotgunLab({action:'stop'});status('Stopping unsent work; waiting for dispatched fixtures and browser cleanup.');});
  get('lab-run').onclick=()=>safely(async()=>{
    if(running)return;const compiled=await review();if(compiled.problems.length)throw Error('Resolve plan problems before rehearsal');
    running=true;host.setRunning(true);
    for(const node of get('view-lab').querySelectorAll<HTMLInputElement>('input,select,button'))node.disabled=true;
    (get('lab-stop') as HTMLButtonElement).disabled=false;status('Preparing isolated Chrome workers. Countdown begins after worker startup. Every request is intercepted.');
    try{const result=await window.thirsty.shotgunLab({action:'run',value:{plan:plan(),scenario:control('lab-scenario').value,countdownSeconds:Number(control('lab-countdown').value)}}) as LabResult;renderResult(result);status('Offline rehearsal finished. No real reservation or QR was created.');}
    finally{running=false;host.setRunning(false);for(const node of get('view-lab').querySelectorAll<HTMLInputElement>('input,select,button'))node.disabled=false;(get('lab-stop') as HTMLButtonElement).disabled=true;}
  });
  function renderResult(r:LabResult) {
    const output=get('lab-results');output.replaceChildren(text('h3',r.label),text('p',`Planned ${r.planned} · initiated ${r.initiated} · omitted ${r.omitted} · missed deadlines ${r.missedDeadlines} · compressed pairs ${r.compressedPairs}`),
      text('p',`Trigger → local Chrome request initiation: p50 ${r.timing.p50?.toFixed(2)??'unmeasured'} / p95 ${r.timing.p95?.toFixed(2)??'unmeasured'} / max ${r.timing.max?.toFixed(2)??'unmeasured'} ms · CPU busy ${r.cpuBusyPercent??'unmeasured'}%`),
      text('p',`Worker preparation: ${r.preparation.filter(p=>p.ready).length} ready / ${r.preparation.length} reported. Synthetic security only.`));
    for(const wing of r.wings)output.append(text('p',`${wing.wing}: planned ${wing.planned}, initiated ${wing.initiated}, simulated holds ${wing.holds} · ${wing.complete?'wing completion observed':'incomplete'}`));
    const achieved=r.objective==='ANY_ONE'?r.wings.some(w=>w.complete):r.wings.length===2&&r.wings.every(w=>w.complete);output.append(text('strong',`Simulated objective: ${achieved?'complete':'incomplete'}`));
    const wrap=document.createElement('div');wrap.className='lab-table-wrap';const table=document.createElement('table');table.className='lab-result-table';
    const head=document.createElement('tr');for(const label of ['Target','Worker','Offset','Outcome'])head.append(text('th',label));table.append(head);
    for(const o of r.outcomes){const row=document.createElement('tr');for(const value of [`${o.wing} Court ${o.court} · ${o.date}`,o.worker,`${o.offsetMs} ms`,`${o.state==='HOLD_VERIFIED_QR_ATTENTION'?'SIMULATED HOLD':o.state} ${o.code??''}`])row.append(text('td',value));table.append(row);}wrap.append(table);output.append(wrap);
    for(const warning of r.warnings)output.append(text('p',warning));output.append(text('p',`Isolated run: ${r.runId}`));
  }
  get('lab-published-load').onclick=()=>safely(async()=>{
    const date=control('lab-published-date').value;get('lab-published-status').textContent='Reading both wings using prepared Chrome. No checkout.';
    await window.thirsty.browseCourts(date);const state=await window.thirsty.getStatus(),e=state.courtBrowser;
    if(!e||e.date!==date||Date.now()-Date.parse(e.capturedAt)<0||Date.now()-Date.parse(e.capturedAt)>15000)throw Error('Availability UNKNOWN. Prepare and verify dedicated Chrome in Book Now first.');
    get('lab-published-slots').replaceChildren(...e.cells.filter(c=>c.available&&c.price!==null&&(control('lab-wings').value==='BOTH'||control('lab-wings').value===c.wing)).map(c=>{
      const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=`${c.wing} ${c.court} · ${c.start} · PHP ${c.price}`;
      b.onclick=()=>{if(Date.now()-Date.parse(e.capturedAt)>15000){get('lab-published-status').textContent='Snapshot expired. Load again.';return;}if(targets.length>=7){status('Remove a target before adding another.');return;}
        targets.push({...exactReleaseTarget({wing:c.wing,court:c.court,bookingDate:date,start:c.start,durationHours:1}),priority:targets.length+1,priceAuthority:{source:'target date published browser read',capturedAt:e.capturedAt,perHour:[c.price!],kind:'TARGET_DATE_PUBLISHED'}});control('lab-purpose').value='CURRENT_SLOT_REHEARSAL';edited();renderTargets();};return b;
    }));get('lab-published-status').textContent='Fresh one-hour slots. Click to add an exact rehearsal target. Longer targets need every hour rechecked.';
  });
  safely(async()=>{defaults=await window.thirsty.shotgunLab({action:'defaults'});targets=[makeTarget('MANGO'),makeTarget('BUKO')];control('lab-published-date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());get('lab-policy').textContent=`Next release: ${new Date(defaults!.MANGO.releaseAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'})} Manila. Mango booking date: ${defaults!.MANGO.bookingDate}. Buko booking date: ${defaults!.BUKO.bookingDate}. Mango: existing 08:00 Manila / +2 calendar days. Buko: owner-assumed 08:00 Manila / +6 calendar days. Both wings: Courts 1–7. Planning and offline rehearsal are available; live Shotgun compatibility remains blocked.`;renderTargets();});
}
