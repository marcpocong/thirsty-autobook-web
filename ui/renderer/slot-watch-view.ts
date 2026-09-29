import type { Dashboard } from '../types.js';
import { byId, el, inputById as input } from './dom.js';
import { dateLabel, evidenceLabel, evidenceSlot, friendly, hourlySlots, hours, manilaMs, readText, relative, slotStateInfo } from './format.js';

/**
 * LIVE view: the release Slot Watch (read-only court/hour observation), moved out of app.ts. Rendering only; the
 * watch itself runs in the desktop main process.
 */
let rerender: () => void = () => {};
export function initSlotWatchView(options: { rerender: () => void }): void { rerender = options.rerender; }
/** Show the live watch (undefined) or a finished one from history. */
export function selectWatch(id: string | undefined): void { selectedWatchId = id; }
export function setSlotMatrixMode(mode: 'current' | 'first'): void { slotMatrixMode = mode; }
let selectedWatchId:string|undefined,renderedSlotWatch='',slotMatrixMode:'current'|'first'='current';
type SlotSummary=NonNullable<Dashboard['slotWatchHistory']>[number];
type SlotView=NonNullable<Dashboard['slotWatch']>;
function slotFact(label:string,value:string,extra=''){const fact=document.createElement('div');fact.className=`slot-fact ${extra}`;const name=document.createElement('span'),text=document.createElement('strong');name.textContent=label;text.textContent=value;fact.append(name,text);return fact;}
function slotMatrix(cells:SlotView['cells'],ours:Set<string>,mode:'current'|'first',recentSince?:number){
  const scroll=document.createElement('div');scroll.className='audit-matrix-scroll';scroll.tabIndex=0;
  const table=document.createElement('table');table.className='audit-matrix';
  const head=document.createElement('tr');head.append(Object.assign(document.createElement('th'),{textContent:'Court'}));
  for(const hour of hours){const th=document.createElement('th');th.textContent=friendly(hour).replace(':00 ','');th.title=friendly(hour);head.append(th);}
  const thead=document.createElement('thead');thead.append(head);const tbody=document.createElement('tbody');
  for(const court of [1,2,3,4,5,6,7]){
    const row=document.createElement('tr'),label=document.createElement('th');label.scope='row';label.textContent=`C${court}`;label.title=`Court ${court}`;row.append(label);
    for(const hour of hours){
      const cell=cells.find(value=>value.court===court&&value.hour===hour);
      const state=mode==='first'?(cell?.first?evidenceSlot[cell.first]:'UNKNOWN'):cell?.state??'UNKNOWN',info=slotStateInfo[state],td=document.createElement('td');
      const mine=ours.has(`${court}/${hour}`);
      td.className=`slot-cell ${info.css}${mode==='current'&&cell?.record?' slot-record':''}${mine?' slot-ours':''}${mode==='current'&&recentSince!==undefined&&cell?.changedSinceReleaseMs!==undefined&&cell.changedSinceReleaseMs>=recentSince?' slot-recent':''}`;
      td.textContent=info.symbol;
      if(mode==='current'&&cell?.changedSinceReleaseMs!==undefined){const when=document.createElement('small');when.textContent=`${cell.changedSinceReleaseMs<0?'−':'+'}${Math.abs(cell.changedSinceReleaseMs/1000).toFixed(1)}s`;td.append(when);}
      const first=cell?.first?` · first published: ${evidenceLabel[cell.first]}${typeof cell.firstPrice==='number'?` · PHP ${cell.firstPrice}`:''}`:' · not yet published';
      td.title=`Court ${court} · ${friendly(hour)} · ${mode==='first'?'first published grid':'now'}: ${info.label}${mode==='current'&&cell?.record?' · public booking record':''}${mine?' · verified hold by this bot':''}${mode==='current'?first:''}${mode==='current'&&cell?.changedSinceReleaseMs!==undefined?` · last change seen in a read answered ${relative(cell.changedSinceReleaseMs)} after release`:''}`;
      td.setAttribute('aria-label',td.title);row.append(td);
    }
    tbody.append(row);
  }
  table.append(thead,tbody);scroll.append(table);
  const legend=document.createElement('div');legend.className='slot-legend';
  for(const state of ['OPEN','TAKEN','UNRELEASED','UNKNOWN'] as const){const item=document.createElement('span'),mark=document.createElement('i');mark.className=`slot-cell ${slotStateInfo[state].css}`;item.append(mark,document.createTextNode(slotStateInfo[state].label));legend.append(item);}
  const record=document.createElement('span'),recordMark=document.createElement('i');recordMark.className='slot-cell slot-unknown slot-record';record.append(recordMark,document.createTextNode('Public booking record'));
  const mine=document.createElement('span'),mineMark=document.createElement('i');mineMark.className='slot-cell slot-taken slot-ours';mine.append(mineMark,document.createTextNode('Verified hold by this bot'));
  legend.append(record,mine);
  const wrap=document.createElement('div');wrap.append(scroll,legend);return wrap;
}
function slotTimeline(entries:SlotView['timeline']){
  if(!entries.length)return [Object.assign(document.createElement('p'),{className:'empty',textContent:'No slot changes recorded yet.'})];
  return entries.map(entry=>{
    const row=document.createElement('div');
    const kind=entry.kind==='published'?'published':entry.kind==='record'?'record':entry.to==='UNAVAILABLE'?'taken':entry.to==='OPEN'?'opened':'other';row.className=`slot-event ${kind}`;
    const time=document.createElement('time');time.textContent=`req ${relative(entry.after.requestOffsetMs)}`;time.title='Request start of the first read that showed this';
    const where=document.createElement('strong');where.textContent=entry.kind==='published'?'Schedule published':`Court ${entry.court} · ${friendly(entry.hour)}`;
    const what=document.createElement('span');
    what.textContent=entry.kind==='published'?`${entry.openCount??0} open · ${entry.unavailableCount??0} unavailable · ${entry.unknownCount??0} unknown in the first published grid`
      :entry.kind==='record'?(entry.appeared?'Public booking record appeared':'Public booking record no longer listed'):`${evidenceLabel[entry.from??'UNKNOWN']} → ${evidenceLabel[entry.to??'UNKNOWN']}`;
    const gap=document.createElement('span');gap.className='window';const prefix=entry.kind==='record'?'#b':'#';
    gap.textContent=`${entry.before?`between ${readText(entry.before,prefix)}`:'first read'} and ${readText(entry.after,prefix)}${entry.overlapping?' · reads overlapped':''}`;
    row.append(time,where,what,gap);return row;
  });
}
function oursFor(state:Dashboard,date:string){
  const ours=new Set<string>();
  for(const hold of state.qrHandoffs??[])if(hold.date===date)for(const court of hold.courts)for(const slot of hourlySlots(hold.startTime,hold.endTime))ours.add(`${court}/${slot.slice(0,5)}`);
  return ours;
}
function summaryCells(summary:SlotSummary,mode:'current'|'first'):SlotView['cells']{
  const matrix=mode==='first'?summary.firstPublishedMatrix??'':summary.finalMatrix;
  return matrix.split(',').filter(Boolean).flatMap(row=>{const [court,codes]=row.split(':');return [...(codes??'')].map((code,index)=>{
    const state=(code==='O'?'OPEN':code==='X'?'TAKEN':code==='U'?'UNRELEASED':'UNKNOWN') as SlotView['cells'][number]['state'];
    return {court:Number(court),hour:hours[index]!,state,record:false,...(mode==='first'?{first:state==='OPEN'?'OPEN' as const:state==='TAKEN'?'UNAVAILABLE' as const:'UNKNOWN' as const}:{})};});});
}
export function renderSlotWatch(state:Dashboard){
  const live=state.slotWatch??null,history=state.slotWatchHistory??[];
  const selected=selectedWatchId?history.find(entry=>entry.id===selectedWatchId):undefined;
  const signature=JSON.stringify({live,selected:selected?.id,history:history.map(entry=>entry.id),ours:state.qrHandoffs,slotMatrixMode});
  const active=!!live&&(live.status==='waiting'||live.status==='watching');
  input('watch-next-release').hidden=active;input('stop-slot-watch').hidden=!active;
  if(signature===renderedSlotWatch)return;
  renderedSlotWatch=signature;
  const summary:SlotSummary|undefined=selected??live?.summary;
  const date=selected?.date??live?.date,releaseMs=selected?.releaseMs??live?.releaseMs;
  const meta=byId('slot-watch-meta');meta.replaceChildren();
  for(const button of document.querySelectorAll<HTMLButtonElement>('#slot-matrix-mode button'))button.setAttribute('aria-pressed',String(button.dataset.mode===slotMatrixMode));
  if(!date||releaseMs===undefined){
    const empty=document.createElement('div');empty.className='audit-empty';
    empty.append(Object.assign(document.createElement('strong'),{textContent:'No release watched yet'}),Object.assign(document.createElement('span'),{textContent:'Arm a release, or press Watch next release to observe one without booking.'}));
    byId('slot-watch-matrix').replaceChildren(empty);
    byId('slot-watch-summary').replaceChildren();byId('slot-watch-timeline').replaceChildren(...slotTimeline([]));
  }else{
    const status=selected?selected.status:live!.status;
    const badge=document.createElement('span');badge.className=`slot-status-badge ${status}`;badge.textContent=selected?`SAVED · ${status.toUpperCase()}`:status.toUpperCase();
    const statusFact=slotFact('Status','');statusFact.querySelector('strong')!.replaceChildren(badge);
    const reads=selected?`${selected.availability.answered+selected.availability.failed} (${selected.availability.failed} failed)`:`${live!.polls} (${live!.failedPolls} failed)`;
    meta.append(statusFact,slotFact('Target date',dateLabel(date)),slotFact('Release',`${manilaMs(new Date(releaseMs).toISOString())} Manila`),slotFact('Reads',reads),
      ...(!selected&&live?[slotFact('In flight',`${live.inFlight} of ${live.maxInFlight}${live.notLaunched?` · ${live.notLaunched} not launched`:''}`)]:[]),
      ...(!selected&&live?.lastLatencyMs!==undefined?[slotFact('Last read',`${live.lastLatencyMs} ms${live.lastError?` · ${live.lastError}`:''}`)]:[]),
      (()=>{const path=selected?.reportPath??summary?.reportPath??live!.logPath,fact=slotFact(summary?'Report':'Log file',path.split(/[\\/]/).at(-1)??path,'path');fact.title=path;return fact;})());
    const cells:SlotView['cells']=selected?summaryCells(selected,slotMatrixMode):live!.cells;
    const recent=!selected&&live?.lastPollAt?Date.parse(live.lastPollAt)-releaseMs-1500:undefined;
    byId('slot-watch-matrix').replaceChildren(slotMatrix(cells,oursFor(state,date),slotMatrixMode,recent));
    const facts=byId('slot-watch-summary');facts.replaceChildren();
    const publication=summary?.publication??live?.publication;
    const box=document.createElement('div');box.className='slot-summary';
    if(summary?.legacy)box.append(slotFact('Saved watch','Older format · details in its report'));
    else{
      box.append(slotFact('First published grid',publication?.firstPublished?readText(publication.firstPublished):'Not observed yet'),
        ...(publication?.lastUnpublished?[slotFact('Last read without the date',readText(publication.lastUnpublished))]:[]));
      if(summary){
        const counts=summary.firstPublishedCounts;
        box.append(slotFact('At first publication',counts?`${counts.OPEN} open · ${counts.UNAVAILABLE} unavailable${counts.UNKNOWN?` · ${counts.UNKNOWN} unknown`:''}`:'—'),
          slotFact('Open → unavailable',String(summary.openToUnavailable.length)),
          slotFact('Unavailable at first publication',`${summary.unavailableAtFirstPublication.length} (${summary.unavailableAtFirstPublication.filter(cell=>!cell.record).length} without public booking record · cause unknown)`),
          slotFact('Unavailable → open',String(summary.reopened.length)),slotFact('Median read time',summary.availability.medianLatencyMs===null?'—':`${Math.round(summary.availability.medianLatencyMs)} ms`),
          slotFact('Max in flight',`${summary.availability.maxInFlight} of ${summary.schedule?.maxInFlight??'?'}${summary.availability.notLaunched?` · ${summary.availability.notLaunched} not launched`:''}`),
          ...(summary.quality?[slotFact('Cache quality',`MISS ${Math.round(summary.quality.cacheRates.MISS*100)}% · HIT ${Math.round(summary.quality.cacheRates.HIT*100)}% · STALE ${Math.round(summary.quality.cacheRates.STALE*100)}%`),
            slotFact('Evidence quality',`${summary.quality.contradictions} contradictions · ${summary.quality.reopenings.confirmed} confirmed reopenings · ${summary.quality.bookingCoverage.successfulCourtQueries}/${summary.quality.bookingCoverage.totalCourtQueries} booking court reads`)]:[]));
      }
      const candidates=selected?.candidates??live?.candidates??[];
      if(candidates.length){const list=el('div','slot-candidates');list.append(el('strong','',`Configured candidates · freshest evidence`));
        for(const candidate of candidates)list.append(el('div','precision-line',`${candidate.workerId?`Worker ${candidate.workerId} · `:''}${candidate.label??`C${candidate.court} ${candidate.start}–${candidate.end}`} · ${candidate.state.replaceAll('_',' ')} · evidence age ≤ ${candidate.evidenceAgeUpperBoundMs===null?'unknown':`${Math.ceil(candidate.evidenceAgeUpperBoundMs)} ms`}${candidate.reopening?` · reopening ${candidate.reopening.toLowerCase().replaceAll('_',' ')}`:''}`));
        box.append(list);}
    }
    facts.append(box);
    const timeline=byId('slot-watch-timeline'),atBottom=timeline.scrollTop+timeline.clientHeight>=timeline.scrollHeight-20;
    timeline.replaceChildren(...slotTimeline(selected?selected.timeline:live!.timeline));
    if(atBottom)timeline.scrollTop=timeline.scrollHeight;
  }
  const list=byId('slot-watch-history');
  if(!history.length)list.replaceChildren(Object.assign(document.createElement('p'),{className:'empty',textContent:'No finished watches yet.'}));
  else list.replaceChildren(...history.map(entry=>{
    const button=document.createElement('button');button.type='button';button.className='slot-history-item';button.setAttribute('aria-pressed',String(entry.id===selectedWatchId));
    const title=document.createElement('strong');title.textContent=`${dateLabel(entry.date)} · release ${new Date(entry.releaseMs).toLocaleString('en-GB',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})}`;
    const fast=document.createElement('span');fast.className='fast';fast.textContent=entry.legacy?'older format':entry.publication.firstPublished?`published req ${relative(entry.publication.firstPublished.requestOffsetMs)}`:'date not seen';
    const meta=document.createElement('span');meta.className='meta';meta.textContent=entry.legacy?`${entry.availability.answered} reads · ${entry.status}${entry.id===selectedWatchId?' · showing':''}`
      :`${entry.openToUnavailable.length} open → unavailable · ${entry.unavailableAtFirstPublication.length} unavailable at first publication · ${entry.availability.answered} reads · ${entry.status}${entry.id===selectedWatchId?' · showing':''}`;
    button.append(title,fast,meta);
    button.onclick=()=>{selectedWatchId=selectedWatchId===entry.id?undefined:entry.id;rerender();};
    return button;
  }));
}
