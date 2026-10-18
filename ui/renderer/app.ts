import { hooks, PANE_DESTINATION, type Destination, type Pane } from './navigation.js';
import { initBookingSetup } from './booking-setup.js';
import { initHome } from './home.js';
import { initActivity } from './activity.js';
import { COURT_REGISTRY } from '../../src/court-registry.js';
import {shotgunCriticalInterval} from '../../src/shotgun.js';
import type { Bridge, Dashboard, RunHistoryEntry } from '../types.js';
import type { BookingSetup } from '../../src/config.js';
import {bookingSetupProblem,reconcileFallbackTimes,type FallbackReconciliation} from '../../src/booking-setup.js';
import type {ReleasePerformance} from '../../src/release-performance.js';
import {formatReleaseOffset,isReleaseOffsetMs} from '../../src/release-offset.js';
import {applyDurationOffsetPreset,compileSmartPlan,confirmSmartRates,describeSmartPlan,emptySmartDraft,resizeSmartFanOut,setSmartChildOffset,smartDraftFromPhase3,smartPeso,smartRange,smartSlotOffsets,smartSlotText,SMART_EVENING_RATE,SMART_MAX_SLOTS,SMART_WORKERS,
  type SmartDraft,type SmartSlot,type SmartWorker,type SmartPhase3,type SmartReleaseOffset} from '../../src/precision-simple.js';
import {fanOutTimingPlan,minimumMeaningfulSpacingMs} from '../../src/fanout-timing.js';
import {logicalTargetId,migrateShotgunSettings,SHOTGUN_MEANINGFUL_SPACING_MS} from '../../src/shotgun.js';
import {initStrategy,reconstructLineage,renderStrategy,strategySaved,strategySaveSnapshot,strategyMainCourtOrderChanged,strategyModificationCount,suggestionLineage,type EditableSuggestionLineage,type StrategyV2Meta} from './strategy.js';
import {renderLive} from './live.js';
import {renderInsights} from './insights.js';
import {renderNextRelease,renderReleasePreflight} from './next-release.js';
import {provenanceStatus} from '../../src/provenance.js';
import {initSlotWatchView,renderSlotWatch,selectWatch,setSlotMatrixMode} from './slot-watch-view.js';
import {dateLabel,evidenceLabel,evidenceSlot,friendly,hourlySlots,hours,readText,relative,slotStateInfo} from './format.js';
import {PRECISION_MAX_ATTEMPTS,PRECISION_MAX_FAN_OUT} from '../../src/workers.js';
declare global { interface Window { thirsty: Bridge } }
const byId = (id: string) => document.getElementById(id)!;
let latest: Dashboard | undefined;
let renderedLogs = '';
let renderedPreviousHolds = '';
let selectedRunId:string|undefined;
let timingReadyKey='';
let timingReadyStartedMono=0;
let timingReadyInitialMs=0;
let dirty=false, loadedPlan='';
let courtOrder=[7,6,5,4,3,2,1], fallbackTimes:string[]=[];
const input=(id:string)=>byId(id) as HTMLInputElement;
let workflow:'test'|'release'='release';
/** Panes inside the four destinations (Home, Booking Setup, Activity, Settings). */
type View = Pane;
let currentView:View='home';
const browserFocusMessages:Partial<Record<WorkerId,string>>={};
const browserFocusPending:Partial<Record<WorkerId,boolean>>={};
// Electron prefixes IPC rejections, so match the known codes anywhere in the message.
// A wrong reason here sends the operator looking in the wrong place.
function browserFocusFailure(worker:WorkerId,error:unknown){
  const text=error instanceof Error?error.message:String(error);
  const code=['CDP_NOT_LISTENING','CDP_ENDPOINT_UNAVAILABLE','CDP_WRONG_PROFILE','CDP_WRONG_PORT','CDP_PROCESS_NOT_CHROME',
    'CDP_PROFILE_MISSING','CDP_UNSAFE_BIND','CDP_AMBIGUOUS_LISTENER','CDP_IDENTITY_MISMATCH','CDP_PROCESS_METADATA_UNAVAILABLE',
    'ONDA_TAB_AMBIGUOUS_OR_MISSING','ONDA_TAB_MISSING'].find(known=>text.includes(known));
  if(code==='CDP_NOT_LISTENING'||code==='CDP_ENDPOINT_UNAVAILABLE')return `Browser ${worker} is not running. Its Chrome window was closed.`;
  if(code==='ONDA_TAB_MISSING')return `Browser ${worker} has no Onda tab open.`;
  if(code==='ONDA_TAB_AMBIGUOUS_OR_MISSING')return `Browser ${worker} has more than one Onda tab; open the right one in Chrome.`;
  if(code)return `Browser ${worker} could not be verified (${code.replaceAll('_',' ').toLowerCase()}).`;
  return `Browser ${worker} could not be brought to the front. ${text.replace(/^Error invoking remote method '[^']*':\s*/,'').slice(0,140)}`;
}
function runDetail(run:RunHistoryEntry){
  const detail=document.createElement('div');detail.className='run-detail';
  const facts=document.createElement('dl');facts.className='run-detail-facts';
  const fact=(name:string,value:string)=>{const item=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;item.append(dt,dd);return item;};
  const players=playersByWorker(latest?.playerStatus);
  facts.append(fact('Run ID',run.runId),fact('Started',`${new Date(run.startedAt).toLocaleString('en-GB',{timeZone:'Asia/Manila'})} Manila`),fact('Browser ready',run.readyAt?`${new Date(run.readyAt).toLocaleString('en-GB',{timeZone:'Asia/Manila'})} Manila`:'Not recorded'),fact('Finished',`${new Date(run.endedAt).toLocaleString('en-GB',{timeZone:'Asia/Manila'})} Manila`),fact('Measured time',`${((run.readyElapsedMs??0)/1000).toFixed(3)} seconds · browser ready to finish`),fact('Whole process',`${(run.totalElapsedMs/1000).toFixed(3)} seconds · includes startup/preparation`),fact('Outcome',run.outcome.toUpperCase()));
  for(const hold of run.qrHandoffs??[]){
    const player=hold.checkout?players[hold.checkout]:undefined;
    const who=hold.checkout?`${player?.fullName||`Browser ${hold.checkout}`}`:'Player';
    facts.append(fact(`Booking${hold.checkout?` (Browser ${hold.checkout})`:''}`,
      `${who} · Court${hold.courts.length===1?'':'s'} ${hold.courts.join(' + ')} · ${hold.date} · ${hold.startTime}–${hold.endTime} · ₱${hold.amount.toLocaleString()}`));
  }
  const timeline=document.createElement('div');timeline.className='run-detail-events';
  if(run.activities?.length)timeline.replaceChildren(...run.activities.map(activity=>{const event=document.createElement('div');event.className=`run-detail-event ${activity.level}`;const time=document.createElement('time');time.textContent=new Date(activity.at).toLocaleTimeString('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3});const message=document.createElement('span');message.textContent=activity.text;const timing=document.createElement('span');timing.className='run-detail-event-timing';timing.textContent=activity.elapsedMs===undefined?'':`${(activity.elapsedMs/1000).toFixed(3)}s total · ${((activity.deltaMs??0)/1000).toFixed(3)}s step`;event.append(time,message,timing);return event;}));
  else timeline.append(Object.assign(document.createElement('p'),{className:'empty',textContent:'No detailed activity was recorded for this older run.'}));
  detail.append(facts);
  if(run.qrHandoffs?.length){
    const booking=document.createElement('div');booking.className='qr-summary-list';
    const note=document.createElement('p');note.className='small';note.textContent='Full booking detail cards, expanded from the summary above. Player name/email reflect the currently saved profile.';
    for(const hold of run.qrHandoffs)booking.append(buildHandoffCard(hold,players));
    detail.append(Object.assign(document.createElement('h3'),{textContent:'Booking details'}),note,booking);
  }
  detail.append(Object.assign(document.createElement('h3'),{textContent:'Activity timeline'}),timeline);
  return detail;
}
function showRunDetail(run:RunHistoryEntry){
  selectedRunId=run.runId;byId('run-detail-title').textContent=run.label.replaceAll('·',' / ').toUpperCase();
  byId('run-detail-content').replaceChildren(runDetail(run));byId('run-detail-modal').hidden=false;(byId('run-detail-close') as HTMLButtonElement).focus();
}
function closeRunDetail(){selectedRunId=undefined;byId('run-detail-modal').hidden=true;byId('run-detail-content').replaceChildren();}
let confirmActiveId:string|undefined;
function settleConfirm(confirmed:boolean){
  if(!confirmActiveId)return;
  const id=confirmActiveId;confirmActiveId=undefined;
  byId('confirm-modal').hidden=true;
  void window.thirsty.confirmResponse(id,confirmed);
}
window.thirsty.onConfirmRequest(request=>{
  confirmActiveId=request.id;
  byId('confirm-dialog').dataset.tone=request.tone;
  byId('confirm-badge').textContent=request.tone==='warning'?'CAUTION':'CONFIRM';
  byId('confirm-title').textContent=request.title;
  byId('confirm-message').textContent=request.message;
  byId('confirm-detail').textContent=request.detail;
  (byId('confirm-cancel') as HTMLButtonElement).textContent=request.cancelLabel??'Cancel';
  (byId('confirm-ok') as HTMLButtonElement).textContent=request.confirmLabel;
  byId('confirm-modal').hidden=false;
  (byId('confirm-cancel') as HTMLButtonElement).focus();
});
type CourtCount=1|2|3|4|5|6|7;type WorkerId='A'|'B'|'C'|'D'|'E'|'F'|'G'|'H';
const requiredWorkers=(strategy:string,count:number):WorkerId[]=>['A','B','C','D','E','F','G','H'].slice(0,(strategy==='extended'?2:1)*Math.ceil(count/2)) as WorkerId[];
const workerLabel=(worker:WorkerId)=>worker==='A'?'Primary player':`Player ${'ABCDEFGH'.indexOf(worker)+1}`;
const ALL_WORKERS:WorkerId[]=['A','B','C','D','E','F','G','H'];
type PrecisionRow={court:number;start:string;durationHours:number;releaseOffsetMs?:SmartReleaseOffset;fanOutReleaseOffsetsMs?:SmartReleaseOffset[]};
type PrecisionMode='fixed'|'smart';
interface FormDraft {testWing?:'MANGO'|'BUKO';bukoCourt?:number;releaseStrategy:'general'|'precision';precisionCount:number;precisionTargets:PrecisionRow[];precisionFanOut?:boolean;precisionMode?:PrecisionMode;smart?:SmartDraft;releaseOffsetMs?:number;method:'browser'|'hybrid'|'api-first'|'proofless';strategy:'standard'|'extended';date:string;courtCount:CourtCount;start:string;duration:number;attempts:number;courtOrder:number[];fallbackTimes:string[];exactA:string;exactB:string}
let testDraft:FormDraft|undefined,releaseDraft:FormDraft|undefined,testDirty=false,releaseDirty=false;
let releaseAdjustment:FallbackReconciliation|undefined;
// The layout is static in index.html; only these few controls move with the active view.
const primary=byId('primary-actions');
const releaseView=byId('view-release'),testsView=byId('view-tests');
const testAction=testsView.querySelector('.test-action')!,testResults=byId('test-results');
const releaseAction=releaseView.querySelector('.release-action')!;
const VIEWS=['home','release','strategy','live','history','tools','tests','setup','records'] as const;
// These views only observe; they stay reachable while a run is in progress.
const OBSERVER_VIEWS:readonly View[]=['live','history','tools','records'];
// The main release dashboard is also safe to revisit during a run: render() keeps
// its mutating controls in the running/disabled state. Strategy remains blocked
// so an in-flight plan cannot be edited accidentally.
const RUN_ACCESSIBLE_VIEWS:readonly View[]=['home','setup','release',...OBSERVER_VIEWS];
const DESTINATION_ELEMENTS:Record<Destination,string>={home:'view-home',setup:'dest-setup',activity:'dest-activity',settings:'view-tools'};
function showView(view:View){
  if(hooks.labRunning&&!['setup','live','history','records'].includes(view))return;
  if(latest&&latest.operation!=='idle'&&latest.operation!=='scheduled'&&!RUN_ACCESSIBLE_VIEWS.includes(view)&&!(view==='tests'&&workflow==='test'))return;
  currentView=view;
  const destination=PANE_DESTINATION[view];
  for(const [dest,id] of Object.entries(DESTINATION_ELEMENTS))if(id!==`view-${view}`||dest!==destination)byId(id).hidden=dest!==destination;
  for(const id of VIEWS){if(id==='home'||id==='tools')continue;byId(`view-${id}`).hidden=id!==view;}
  byId('view-home').hidden=destination!=='home';byId('view-tools').hidden=destination!=='settings';
  for(const tab of document.querySelectorAll<HTMLElement>('[data-dest]'))if(tab.closest('nav'))tab.setAttribute('aria-current',tab.dataset.dest===destination?'page':'false');
  for(const tab of document.querySelectorAll<HTMLElement>('.activity-tabs [data-pane]'))tab.setAttribute('aria-current',tab.dataset.pane===view?'page':'false');
  const setupWorkflow=destination==='setup'?hooks.desiredWorkflow?.()??null:null;
  const nextWorkflow=view==='tests'?'test':view==='release'||view==='strategy'?'release':setupWorkflow??(view==='home'||view==='setup'||OBSERVER_VIEWS.includes(view)?workflow:'release');
  if(nextWorkflow!==workflow){storeDraft();workflow=nextWorkflow;if(workflow==='test'&&latest?.booking){const s=latest.booking.setup;applyDraft({testWing:testDraft?.testWing??'MANGO',bukoCourt:testDraft?.bukoCourt??1,releaseStrategy:'general',precisionCount:1,precisionTargets:[],method:s.BOOKING_METHOD,strategy:s.BOOKING_TYPE,date:testDraft?.date??input('test-date').value,courtCount:s.COURT_COUNT,start:s.START_TIME,duration:s.DURATION_HOURS,attempts:s.MAX_SELECTION_ATTEMPTS,courtOrder:[...s.PREFERRED_COURTS],fallbackTimes:[...s.FALLBACK_TIMES],exactA:'',exactB:''});testDirty=false;}if(workflow==='release'&&releaseDraft)applyDraft(releaseDraft);dirty=workflow==='test'?testDirty:releaseDirty;input('terms').checked=false;void window.thirsty.setWorkflow(workflow).then(()=>window.thirsty.getStatus()).then(render);}
  (view==='tests'?testResults:primary).append(byId('observed-price'),byId('selection-result'),byId('handoff-result'));
  (view==='tests'?testsView:releaseView).append(byId('lock-card'));
  if(latest)render(latest);
  for(const listener of hooks.paneListeners)listener(view);
}
/** A destination opens its current pane; Booking Setup chooses the pane for its active section. */
let lastActivityPane:View='live';
function showDestination(destination:Destination){
  if(destination==='home')showView('home');
  else if(destination==='settings')showView('tools');
  else if(destination==='activity')showView(lastActivityPane);
  else showView((document.querySelector<HTMLElement>('#setup-steps [aria-current="step"]')?.dataset.step==='5')?(hooks.desiredWorkflow?.()==='test'?'tests':'release'):'setup');
}
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-dest]'))button.addEventListener('click',()=>showDestination(button.dataset.dest as Destination));
for(const button of document.querySelectorAll<HTMLButtonElement>('.activity-tabs [data-pane]'))button.addEventListener('click',()=>{lastActivityPane=button.dataset.pane as View;showView(lastActivityPane);});
hooks.showView=showView;hooks.latest=()=>latest;hooks.setLabRunning=value=>{hooks.labRunning=value;if(latest)render(latest);};
byId('edit-strategy').onclick=()=>showView('strategy');
input('test-date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

const endFriendly=(start:string,duration:number)=>Number(start.slice(0,2))+duration===24?'12:00 MN':friendly(`${String(Number(start.slice(0,2))+duration).padStart(2,'0')}:00`);
for(const id of ['start-time','fallback-time','practice-start','full-start','dual-start']) (byId(id) as HTMLSelectElement).replaceChildren(...hours.map(h=>new Option(friendly(h),h)));
(byId('practice-court') as HTMLSelectElement).replaceChildren(...Array.from({length:7},(_,i)=>new Option(`Court ${i+1}`,String(i+1))));
input('practice-date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
(byId('full-court') as HTMLSelectElement).replaceChildren(...Array.from({length:7},(_,i)=>new Option(`Court ${i+1}`,String(i+1))));
input('full-date').value=input('practice-date').value;
input('dual-date').value=input('practice-date').value;
for(const id of ['dual-court-a','dual-court-b'])(byId(id) as HTMLSelectElement).replaceChildren(...Array.from({length:7},(_,i)=>new Option(`Court ${i+1}`,String(i+1))));
input('dual-court-a').value='7';input('dual-court-b').value='6';
const PRECISION_WORKERS=['A','B','C','D','E','F','G'] as const;
// Smart backups editor. The draft lives here; the saved PRECISION_PHASE3 is always compileSmartPlan's output,
// and "What will happen" is generated from that same compiled object.
let precisionMode:PrecisionMode='fixed',smartDraft:SmartDraft=emptySmartDraft(),acceptedSmartDraft:SmartDraft|null=null,smartLineage:EditableSuggestionLineage={immediate:[],backups:[]},smartRenderKey='',smartRatesOpen=false;
/** Goal/preset/fan-out choices that produced the Smart draft (saved as STRATEGY_V2; metadata only, never an authorization). */
let strategyMeta:StrategyV2Meta|undefined;
const cloneSmart=(value:SmartDraft):SmartDraft=>JSON.parse(JSON.stringify(value)) as SmartDraft;
const smartDraftFromSaved=(setup:BookingSetup,targetDate:string)=>{
  const draft=smartDraftFromPhase3(setup.PRECISION_PHASE3!,{targetDate,unavailable:unreadyWorkers()});
  if(setup.RELEASE_LAB)draft.releaseLab={...setup.RELEASE_LAB};
  if(setup.STRATEGY_V2?.shotgun){const {counts:_counts,exactSchedule:_schedule,capacity:_capacity,version:_version,...settings}=setup.STRATEGY_V2.shotgun;
    draft.shotgun=structuredClone(migrateShotgunSettings(settings));}
  return draft;
};
/** Workers known not ready, by letter only: a player that is not configured, or an identity problem from the latest preparation. */
function unreadyWorkers():Set<string>{
  const status=latest?.playerStatus,out=new Set<string>();
  const configured:Record<SmartWorker,boolean|undefined>={A:status?.primary,B:status?.extended,C:status?.third,D:status?.fourth,E:status?.fifth,F:status?.sixth,G:status?.seventh};
  for(const worker of SMART_WORKERS)if(configured[worker]===false)out.add(worker);
  for(const issue of latest?.identityIssues??[]){const match=/^Worker ([A-G]) /.exec(issue);if(match)out.add(match[1]!);}
  return out;
}
const smartContext=()=>{const profile=latest?.fanOut?.latest,usable=profile?.compatible&&!profile.stale?profile.profile:null;
  return {targetDate:latest?.booking?.targetDate??'',unavailable:unreadyWorkers(),shotgunCapacity:{meaningfulSpacingMs:Math.max(SHOTGUN_MEANINGFUL_SPACING_MS,
    minimumMeaningfulSpacingMs(usable,Math.max(1,Math.min(PRECISION_MAX_FAN_OUT,smartDraft.shotgun?.budget??1))).spacingMs),recommendedBurstChildren:usable?.recommendation.width,
    groupAnchorMs:strategyMeta?.timingCalibration?.groupShiftMs??0}};};
const smartCompiled=()=>compileSmartPlan(smartDraft,smartContext());
function normalizeLineage(){for(const kind of ['immediate','backups'] as const){smartLineage[kind].splice(smartDraft[kind].length);while(smartLineage[kind].length<smartDraft[kind].length)smartLineage[kind].push(null);}}
function smartEdit(mutate:(draft:SmartDraft,lineage:EditableSuggestionLineage)=>void){mutate(smartDraft,smartLineage);normalizeLineage();if(strategyMeta)strategyMeta={...strategyMeta,lineage:structuredClone(smartLineage)};renderSmart(true);changed();}
function smartElement<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,text?:string){const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;}
function smartSelect(id:string,label:string,choices:Array<[string,string]>,value:string,onChange:(value:string)=>void){
  const wrap=document.createElement('label'),select=document.createElement('select');select.id=id;wrap.append(label,select);
  select.replaceChildren(...choices.map(([text,option])=>new Option(text,option)));select.value=value;select.addEventListener('change',()=>onChange(select.value));return wrap;
}
function smartField(id:string,label:string,value:string,placeholder:string,onChange:(value:string)=>void,type='text'){
  const wrap=document.createElement('label'),field=document.createElement('input');field.id=id;field.type=type;field.value=value;field.placeholder=placeholder;
  field.addEventListener('change',()=>onChange(field.value.trim()));wrap.append(label,field);return wrap;
}
function smartOffsetField(id:string,releaseOffsetMs:number|undefined,onChange:(offset:number)=>void,label='Send early by (ms)'){
  const wrap=document.createElement('label'),field=document.createElement('input');field.id=id;field.type='text';field.inputMode='numeric';field.value=String(-(releaseOffsetMs??0));
  const commit=()=>{const value=releaseOffsetFromEarlyInput(field.value);if(!Number.isFinite(value)){field.setCustomValidity('Enter a whole number from 0 to 2000.');field.reportValidity();return;}field.setCustomValidity('');if(value!==releaseOffsetMs)onChange(value);};
  field.addEventListener('input',()=>field.setCustomValidity(''));field.addEventListener('blur',commit);field.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();field.blur();}});wrap.append(label,field);return wrap;
}
function smartOffsetInput(slot:SmartSlot,child:number,offset:number){
  if(isReleaseOffsetMs(offset))return setSmartChildOffset(slot,child,offset);
  const offsets=smartSlotOffsets(slot);offsets[child]=offset;const next={...slot};delete next.releaseOffsetMs;delete next.fanOutOffsetsMs;
  if(offsets.length===1)next.releaseOffsetMs=offsets[0];else next.fanOutOffsetsMs=offsets;return next;
}
function smartButton(text:string,label:string,disabled:boolean,onClick:()=>void){
  const button=smartElement('button','secondary compact',text);button.type='button';button.setAttribute('aria-label',label);button.disabled=disabled;button.onclick=onClick;return button;
}
/** A new slot copies the last one onto the next free court, so it is never a duplicate or a same-court overlap. */
function smartNewSlot():SmartSlot{
  const all=[...smartDraft.immediate,...smartDraft.backups],last=all.at(-1)??{court:7,start:'19:00',durationHours:3};
  const busy=(court:number,start:string,duration:number)=>all.some(slot=>slot.court===court&&Number(slot.start.slice(0,2))<Number(start.slice(0,2))+duration&&Number(start.slice(0,2))<Number(slot.start.slice(0,2))+slot.durationHours);
  for(const start of [last.start,...hours.filter(h=>h!==last.start)])for(let step=1;step<=7;step++){
    const court=((last.court-1-step+14)%7)+1;
    if(Number(start.slice(0,2))+last.durationHours<=24&&!busy(court,start,last.durationHours))return {court,start,durationHours:last.durationHours};
  }
  return {court:last.court,start:last.start,durationHours:last.durationHours};
}
function smartRow(kind:'immediate'|'backups',slot:SmartSlot,index:number,compiled:ReturnType<typeof compileSmartPlan>,unready:Set<string>){
  const list=smartDraft[kind],li=smartElement('li','smart-row'),noun=kind==='immediate'?'attempt':'backup';
  const rate=compiled.rates[(kind==='immediate'?0:smartDraft.immediate.length)+index];
  const set=(patch:Partial<SmartSlot>)=>smartEdit(draft=>{draft[kind][index]={...draft[kind][index]!,...patch};});
  const fields=smartElement('div','smart-row-fields');
  fields.append(smartSelect(`smart-${kind}-court-${index}`,'Court',Array.from({length:7},(_,c)=>[`Court ${c+1}`,String(c+1)] as [string,string]),String(slot.court),value=>set({court:Number(value)})),
    smartSelect(`smart-${kind}-start-${index}`,'Start',hours.map(h=>[friendly(h),h] as [string,string]),slot.start,value=>set({start:value})),
    smartSelect(`smart-${kind}-duration-${index}`,'Duration',[['1 hour','1'],['2 hours','2'],['3 hours','3']],String(slot.durationHours),value=>set({durationHours:Number(value)})));
  if(kind==='immediate'){
    const offsets=smartSlotOffsets(slot),timing=(strategyMeta?.fanOut.basedOnTiming??(strategyMeta?.fanOut.timing==='CUSTOM'?undefined:strategyMeta?.fanOut.timing)??'BALANCED') as 'TIGHT'|'BALANCED'|'WIDE';
    fields.append(smartSelect(`smart-immediate-width-${index}`,'Fan-out',Array.from({length:PRECISION_MAX_FAN_OUT},(_,index)=>index+1).map(width=>[`${width} child${width===1?'':'ren'}`,String(width)] as [string,string]),String(offsets.length),value=>smartEdit(draft=>{
      const width=Number(value),profile=latest?.fanOut?.latest?.profile??null,defaults=fanOutTimingPlan(timing,width,profile).children.map(child=>child.configuredOffsetMs);
      draft.immediate[index]=resizeSmartFanOut(draft.immediate[index]!,width,defaults);
    })));
    const worker=compiled.immediateWorkers[index]??String.fromCharCode(65+index);
    offsets.forEach((offset,child)=>fields.append(smartOffsetField(offsets.length===1?`smart-immediate-offset-${index}`:`smart-immediate-offset-${index}-${child}`,offset,value=>smartEdit(draft=>{
      draft.immediate[index]=smartOffsetInput(draft.immediate[index]!,child,value);
    }),offsets.length===1?'Send early by (ms)':`${worker}${child} early by (ms)`)));
  }
  const facts=smartElement('div','smart-row-facts');
  if(kind==='immediate'){const worker=compiled.immediateWorkers[index]??null,chip=smartElement('span','smart-worker',worker?`Worker ${worker}`:'No worker free');
    chip.dataset.tone=!worker||unready.has(worker)?'warn':'good';facts.append(chip);}
  const price=smartElement('span','smart-rate',rate?.label??'Rate needs review');price.dataset.tone=rate?.needsReview?'warn':'muted';facts.append(price);
  const move=(step:number)=>smartEdit((draft,lineage)=>{const items=draft[kind],origins=lineage[kind],other=index+step;[items[index],items[other]]=[items[other]!,items[index]!];[origins[index],origins[other]]=[origins[other]!,origins[index]!];});
  const actions=smartElement('div','smart-row-actions');
  actions.append(smartButton('↑',`Move ${noun} ${index+1} up`,index===0,()=>move(-1)),smartButton('↓',`Move ${noun} ${index+1} down`,index===list.length-1,()=>move(1)),
    smartButton('Remove',`Remove ${noun} ${index+1}`,false,()=>smartEdit((draft,lineage)=>{draft[kind].splice(index,1);lineage[kind].splice(index,1);})));
  li.append(smartElement('strong','smart-row-title',`${kind==='immediate'?'Attempt':'Backup'} ${index+1}`),fields,facts,actions);
  const worker=kind==='immediate'?compiled.immediateWorkers[index]:null;
  if(worker&&unready.has(worker))li.append(smartElement('p','smart-row-warn',`Worker ${worker} is not ready and will not be used.`));
  return li;
}
function smartSummary(compiled:ReturnType<typeof compileSmartPlan>,unready:Set<string>){
  const host=byId('smart-summary');
  if(compiled.phase3){
    const description=describeSmartPlan(compiled.phase3,{unavailable:unready});
    host.replaceChildren(...description.sections.map(section=>{const block=smartElement('div','smart-summary-section'),list=smartElement('ul','');
      list.append(...section.lines.map(line=>smartElement('li','',line)));block.append(smartElement('strong','',section.title),list);return block;}),
      smartElement('p','smart-summary-total',`${description.summary}. Maximum possible sends: ${description.maxSends}.`));
  } else host.replaceChildren(smartElement('p','small','Resolve the items below to see exactly what will happen.'));
  byId('smart-problems').replaceChildren(...compiled.problems.map(text=>{const item=smartElement('li','',text);item.dataset.tone='bad';return item;}),
    ...compiled.warnings.map(text=>{const item=smartElement('li','',text);item.dataset.tone='warn';return item;}));
}
function smartAdvanced(compiled:ReturnType<typeof compileSmartPlan>){
  const body=byId('smart-advanced-body'),group=(title:string)=>{const block=smartElement('fieldset','smart-adv-group');block.append(smartElement('legend','',title));return block;};
  const workers=group('Worker for each immediate attempt');
  smartDraft.immediate.forEach((slot,index)=>workers.append(smartSelect(`smart-adv-worker-${index}`,`Attempt ${index+1} · ${smartSlotText(slot)}`,
    [[`Automatic${!slot.worker&&compiled.immediateWorkers[index]?` (${compiled.immediateWorkers[index]})`:''}`,''],...SMART_WORKERS.map(worker=>[`Worker ${worker}`,worker] as [string,string])],slot.worker??'',
    value=>smartEdit(draft=>{const next={...draft.immediate[index]!};if(value)next.worker=value as SmartWorker;else delete next.worker;draft.immediate[index]=next;}))));
  const standby=group('Backup workers'),auto=document.createElement('label'),autoBox=document.createElement('input');autoBox.type='checkbox';autoBox.id='smart-adv-standby-auto';
  autoBox.checked=!smartDraft.advanced.standby;auto.append(autoBox,' Choose backup workers automatically');
  autoBox.addEventListener('change',()=>smartEdit(draft=>{if(autoBox.checked)delete draft.advanced.standby;else draft.advanced.standby=[...compiled.standby];}));
  const boxes=smartElement('div','smart-adv-workers');
  for(const worker of SMART_WORKERS){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.id=`smart-adv-standby-${worker}`;
    box.checked=compiled.standby.includes(worker);box.disabled=!smartDraft.advanced.standby;label.append(box,` ${worker}`);
    box.addEventListener('change',()=>smartEdit(draft=>{const chosen=new Set(draft.advanced.standby??[]);if(box.checked)chosen.add(worker);else chosen.delete(worker);
      draft.advanced.standby=SMART_WORKERS.filter(value=>chosen.has(value));}));boxes.append(label);}
  standby.append(auto,boxes);
  const limits=group('Attempt limits'),limit=(key:'wave2'|'rescue'|'total',label:string)=>smartField(`smart-adv-${key}`,label,smartDraft.advanced[key]===undefined?'':String(smartDraft.advanced[key]),
    `Automatic: ${compiled.budgets[key]}`,value=>smartEdit(draft=>{if(value==='')delete draft.advanced[key];else draft.advanced[key]=Number(value);}),'number');
  limits.append(limit('wave2','Maximum backup sends'),limit('rescue','Maximum reopened-slot sends'),limit('total','Maximum total sends'));
  const slots=group('Per-slot strategy and exact rates');
  const all=[...smartDraft.immediate.map((slot,index)=>({slot,index,kind:'immediate' as const})),...smartDraft.backups.map((slot,index)=>({slot,index,kind:'backups' as const}))];
  all.forEach(({slot,index,kind},position)=>{
    const row=smartElement('div','smart-adv-slot'),immediate=kind==='immediate';
    const defaults={wave1:immediate,wave2:!immediate,rescue:smartDraft.retryReopened},effective=slot.permissions??defaults;
    const patch=(mutate:(next:SmartSlot)=>void)=>smartEdit(draft=>{const next=JSON.parse(JSON.stringify(draft[kind][index])) as SmartSlot;mutate(next);draft[kind][index]=next;});
    const permission=(field:'wave2'|'rescue',label:string)=>smartSelect(`smart-adv-${field}-${position}`,label,[['Automatic',''],['Yes','yes'],['No','no']],slot.permissions?(effective[field]?'yes':'no'):'',
      value=>patch(next=>{const current={...(next.permissions??defaults)};current[field]=value===''?defaults[field]:value==='yes';
        if(JSON.stringify({...current,wave1:immediate||current.wave1})===JSON.stringify(defaults))delete next.permissions;else next.permissions=current;}));
    const rate=slot.rate,rateField=(key:'source'|'capturedAt'|'date',label:string,placeholder:string,type='text')=>smartField(`smart-adv-${key}-${position}`,label,rate?String(rate[key]):'',placeholder,
      value=>patch(next=>{if(next.rate)next.rate={...next.rate,[key]:value};}),type);
    row.append(smartElement('strong','',`${immediate?'Attempt':'Backup'} ${index+1} · ${smartSlotText(slot)}`),
      smartField(`smart-adv-priority-${position}`,'Priority',slot.priority===undefined?'':String(slot.priority),`Automatic: ${position+1}`,
        value=>patch(next=>{if(value==='')delete next.priority;else next.priority=Number(value);}),'number'),
      permission('wave2','Can be used as a backup'),permission('rescue','Can retry if reopened'),
      smartField(`smart-adv-prices-${position}`,'Exact hourly prices (₱, comma separated)',rate?rate.perHour.join(','):'','Blank: use the confirmed rates',value=>patch(next=>{
        if(!value){delete next.rate;return;}
        next.rate={source:next.rate?.source||smartDraft.rates.source||'operator confirmed',capturedAt:next.rate?.capturedAt||new Date().toISOString(),
          status:next.rate?.status??'OPERATOR_CONFIRMED',date:next.rate?.date||smartContext().targetDate,perHour:value.split(',').map(part=>Number(part.trim())),actionable:next.rate?.actionable??true};})),
      rateField('source','Rate source','Uses the rate card'),
      smartSelect(`smart-adv-status-${position}`,'Evidence status',[['Operator confirmed','OPERATOR_CONFIRMED'],['Current venue schedule','VENUE_SCHEDULE'],['Target date published','TARGET_DATE_PUBLISHED'],['Reference only','REFERENCE']],
        rate?.status??'OPERATOR_CONFIRMED',value=>patch(next=>{if(next.rate)next.rate={...next.rate,status:value as NonNullable<SmartSlot['rate']>['status']};})),
      rateField('capturedAt','Captured time (ISO)','Uses the rate card'),rateField('date','Applicable date','Uses the rate card','date'));
    for(const control of row.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[id^="smart-adv-source"],[id^="smart-adv-status"],[id^="smart-adv-capturedAt"],[id^="smart-adv-date"]'))control.disabled=!rate;
    slots.append(row);
  });
  const card=group('Rate card evidence'),table=smartDraft.rates,tableField=(key:'source'|'capturedAt'|'date',label:string,type='text')=>smartField(`smart-adv-card-${key}`,label,table[key],'',
    value=>smartEdit(draft=>{draft.rates={...draft.rates,[key]:value};}),type);
  card.append(tableField('source','Source'),smartSelect('smart-adv-card-status','Evidence status',[['Operator confirmed','OPERATOR_CONFIRMED'],['Current venue schedule','VENUE_SCHEDULE']],table.status,
    value=>smartEdit(draft=>{draft.rates={...draft.rates,status:value as SmartDraft['rates']['status']};})),tableField('capturedAt','Captured time (ISO)'),tableField('date','Applicable date','date'));
  const compiledView=group('Compiled authorization (read only)');
  compiledView.append(smartElement('pre','smart-adv-json',JSON.stringify(compiled.phase3??{problems:compiled.problems},null,2)));
  body.replaceChildren(workers,standby,limits,slots,card,compiledView);
}
function renderSmart(force=false){
  const unready=unreadyWorkers(),compiled=compileSmartPlan(smartDraft,smartContext());
  renderReleaseLab(compiled);
  const key=JSON.stringify([smartDraft,latest?.booking?.targetDate,[...unready],smartRatesOpen,precisionMode]);
  if(document.activeElement instanceof HTMLInputElement&&document.activeElement.id.startsWith('smart-immediate-offset-'))return compiled;
  if(!force&&key===smartRenderKey)return compiled;
  smartRenderKey=key;
  const focused=document.activeElement instanceof HTMLElement&&document.activeElement.closest('#smart-editor')?document.activeElement.id:'';
  const rows=(kind:'immediate'|'backups',empty:string)=>smartDraft[kind].length?smartDraft[kind].map((slot,index)=>smartRow(kind,slot,index,compiled,unready)):[smartElement('li','empty',empty)];
  byId('smart-immediate').replaceChildren(...rows('immediate','No immediate attempts yet. Add at least one.'));
  byId('smart-backups').replaceChildren(...rows('backups','No backup choices. Only the immediate attempts will be sent.'));
  const count=smartDraft.immediate.length+smartDraft.backups.length;
  (byId('smart-add-immediate') as HTMLButtonElement).disabled=smartDraft.immediate.length>=SMART_WORKERS.length||count>=SMART_MAX_SLOTS;
  (byId('smart-add-backup') as HTMLButtonElement).disabled=count>=SMART_MAX_SLOTS;
  const standby=compiled.standby;
  byId('smart-backup-workers').textContent=!smartDraft.backups.length?'':standby.length?`${standby.length} backup worker${standby.length===1?'':'s'} available: ${standby.join(', ')}`:'No backup worker is free. Backups can only be tried as reopened slots.';
  input('smart-concurrent').checked=smartDraft.useBackupsImmediately;input('smart-rescue').checked=smartDraft.retryReopened;
  byId('smart-rescue-max-row').hidden=!smartDraft.retryReopened;input('smart-rescue-max').value=String(smartDraft.maxReopenedAttempts);
  const rates=smartDraft.rates,review=compiled.rates.filter(rate=>rate.needsReview).length;
  const planned=[...smartDraft.immediate,...smartDraft.backups];
  const usesHour=(evening:boolean)=>planned.some(slot=>Array.from({length:slot.durationHours},(_,offset)=>Number(slot.start.slice(0,2))+offset>=16).includes(evening));
  const rateText=(label:string,value:number|null,needed:boolean)=>value!==null?[`${label} ${smartPeso(value)}/hour`]:needed?[`${label} rate not set`]:[];
  const rateSummary=[...rateText('Daytime',rates.day,usesHour(false)),...(usesHour(true)?[`Evening ${smartPeso(SMART_EVENING_RATE)}/hour · fixed venue schedule from 4 PM`]:[]),
    ...(usesHour(false)&&rates.date?[`${rates.status==='VENUE_SCHEDULE'?'daytime venue schedule':'daytime rate confirmed with the venue'} for ${dateLabel(rates.date)}`]:[]),
    ...(review?[`${review} slot${review===1?' needs':'s need'} review`]:planned.length?['No rate review needed']:[])];
  byId('smart-rate-summary').textContent=rateSummary.length?rateSummary.join(' · '):'Add a plan to see its expected rates.';
  byId('smart-review-rates').dataset.attention=String(review>0);
  byId('smart-rate-review').hidden=!smartRatesOpen;
  smartSummary(compiled,unready);smartAdvanced(compiled);
  if(focused){const again=document.getElementById(focused);if(again&&again!==document.activeElement)again.focus();}
  return compiled;
}
function renderReleaseLab(compiled=compileSmartPlan(smartDraft,smartContext())){
  const precision=precisionSelected(),smart=precision&&precisionMode==='smart',slots=!precision?[]:smart?smartDraft.immediate:precisionRows();
  byId('release-lab-matrix').replaceChildren(...slots.map((slot,index)=>{
    const tr=document.createElement('tr'),worker=smart?compiled.immediateWorkers[index]:PRECISION_WORKERS[index],rate=smart?compiled.rates[index]?.evidence:undefined;
    const timing=smartSlotOffsets(slot).map((offset,child)=>`${worker??String.fromCharCode(65+index)}${smartSlotOffsets(slot).length>1?child:''} ${offset} ms`).join(', ');
    const values=[worker??'—',`Court ${slot.court}`,slot.start,`${slot.durationHours}h`,timing,smart?(rate?smartPeso(rate.perHour.reduce((a,b)=>a+b,0)):'Needs rate review'):'Shown after applying preset'];
    tr.replaceChildren(...values.map(value=>Object.assign(document.createElement('td'),{textContent:value})));return tr;
  }));
  byId('release-lab-status').textContent=!precision
    ? 'Choose PRECISION RELEASE above to configure experiment rows. Release Lab does not create booking targets.'
    : !smart
    ? 'Fixed attempts are shown below. Applying the preset switches these exact rows to Smart backups before labelling the experiment.'
    : smartDraft.releaseLab
      ? 'Duration × Offset metadata will be frozen beside the authorized plan. Existing validation still controls whether the plan can be saved or armed.'
      : 'No Release Lab experiment is labelled.';
  (byId('release-lab-preset') as HTMLButtonElement).disabled=!precision;
  (byId('release-lab-disable') as HTMLButtonElement).disabled=!precision||!smartDraft.releaseLab;
  const lab=latest?.releaseLab,results=byId('release-lab-results');
  if(!lab)results.replaceChildren(smartElement('p','small','No Release Lab report has been generated yet.'));
  else results.replaceChildren(smartElement('h4','',`Latest results · ${dateLabel(lab.targetDate)}`),
    smartElement('p','small',`Duration · ${lab.byDuration.map(value=>`${value.key}h: ${value.attemptCount} attempt${value.attemptCount===1?'':'s'}, median wait ${value.medianProviderWaitMs===null?'—':`${value.medianProviderWaitMs.toFixed(1)} ms`}`).join(' · ')||'No joined attempts'}`),
    smartElement('p','small',`Offsets · ${lab.byOffset.map(value=>`${value.key} ms: ${value.attemptCount}, browser start ${value.medianBrowserRequestStartOffsetMs===null?'—':`${value.medianBrowserRequestStartOffsetMs.toFixed(1)} ms`}`).join(' · ')||'No joined attempts'}`),
    smartElement('p','small',`Blanket · ${lab.blanket??'none detected'} · Movement clusters: 1h ${lab.distribution.oneHour}, 2h ${lab.distribution.twoHour}, 3h ${lab.distribution.threeHour}, 4+ ${lab.distribution.fourPlus}, ambiguous ${lab.distribution.ambiguous}`),
    smartElement('p','small',`Reopen Rescue · ${lab.actionableReopenings} actionable reopening${lab.actionableReopenings===1?'':'s'} · ${lab.rescueAttempts} attempted · Detailed report: ${lab.reportPath}`));
}
initStrategy({state:()=>latest,mainCourtOrder:()=>[...courtOrder],draft:()=>smartDraft,unready:unreadyWorkers,
  meta:()=>strategyMeta,
  useSuggestion:(draft,meta)=>{input('precision-strategy').value='precision';precisionMode='smart';smartDraft=cloneSmart(draft);acceptedSmartDraft=cloneSmart(draft);
    smartLineage=suggestionLineage(draft);const accepted=compileSmartPlan(draft,smartContext()).phase3;strategyMeta={...meta,lineage:structuredClone(smartLineage),...(accepted?{acceptedPhase3:accepted}:{}),provenance:{source:'SMART_SUGGESTED',operatorModifications:0}};smartRatesOpen=false;
    syncStrategy();renderSmart(true);changed();},
  accepted:()=>acceptedSmartDraft,
  lineage:()=>smartLineage,
  ensureMeta:()=>{if(strategyMeta)return;strategyMeta={version:1,preset:'CUSTOM',goal:{primeFrom:'17:00',primeUntil:'24:00',durations:[3,2,1],courts:[...courtOrder]},
    fanOut:{width:1,source:'NO_PROFILE',recommendedWidth:null,timing:'BALANCED',basedOnTiming:'BALANCED',profileCreatedAt:null},
    provenance:{source:'OPERATOR_BUILT',operatorModifications:0}};},
  edit:mutate=>smartEdit(mutate),
  addTarget:(slot,kind)=>{input('precision-strategy').value='precision';precisionMode='smart';syncStrategy();smartEdit(draft=>{
    draft[kind].push(slot);if(kind==='immediate'&&draft.shotgun&&!draft.shotgun.selectedTargetIds.includes(logicalTargetId(slot)))draft.shotgun.selectedTargetIds.push(logicalTargetId(slot));
  });},
  resetAll:()=>{if(!acceptedSmartDraft)return;smartDraft=cloneSmart(acceptedSmartDraft);smartLineage=suggestionLineage(acceptedSmartDraft);if(strategyMeta)strategyMeta={...strategyMeta,lineage:structuredClone(smartLineage),fanOut:{...strategyMeta.fanOut,
    width:smartDraft.immediate[0]?smartSlotOffsets(smartDraft.immediate[0]).length:strategyMeta.fanOut.width,source:strategyMeta.fanOut.acceptedSource??strategyMeta.fanOut.source,
    ...(strategyMeta.fanOut.basedOnTiming?{timing:strategyMeta.fanOut.basedOnTiming}: {})}};renderSmart(true);changed();},
  save:()=>saveBookingPlan(),
  activateSmart:()=>{input('precision-strategy').value='precision';precisionMode='smart';syncStrategy();},
  nextRelease:()=>showView('release')});
byId('smart-add-immediate').onclick=()=>smartEdit(draft=>{draft.immediate.push(smartNewSlot());});
byId('smart-add-backup').onclick=()=>smartEdit(draft=>{draft.backups.push(smartNewSlot());});
byId('release-lab-preset').onclick=()=>{
  if(!precisionSelected())return;
  if(precisionMode!=='smart'){
    smartDraft={...smartDraft,immediate:precisionRows().map(row=>({...row}))};
    precisionMode='smart';syncStrategy();
  }
  smartDraft=applyDurationOffsetPreset(smartDraft);renderSmart(true);changed();
};
byId('release-lab-disable').onclick=()=>smartEdit(draft=>{delete draft.releaseLab;});
byId('smart-concurrent').addEventListener('change',()=>smartEdit(draft=>{draft.useBackupsImmediately=input('smart-concurrent').checked;}));
byId('smart-rescue').addEventListener('change',()=>smartEdit(draft=>{draft.retryReopened=input('smart-rescue').checked;}));
byId('smart-rescue-max').addEventListener('change',()=>smartEdit(draft=>{draft.maxReopenedAttempts=Math.min(7,Math.max(1,Math.floor(Number(input('smart-rescue-max').value))||1));}));
byId('smart-review-rates').onclick=()=>{smartRatesOpen=!smartRatesOpen;
  if(smartRatesOpen){input('smart-rate-day').value=smartDraft.rates.day===null?'':String(smartDraft.rates.day);input('smart-rate-evening').value=String(SMART_EVENING_RATE);
    input('smart-rate-status').value=smartDraft.rates.status;}
  renderSmart(true);if(smartRatesOpen)input('smart-rate-day').focus();};
byId('smart-rate-cancel').onclick=()=>{smartRatesOpen=false;renderSmart(true);};
byId('smart-rate-confirm').onclick=()=>{
  const read=(id:string)=>{const value=input(id).value.trim();return value===''?null:Number(value);};
  const day=read('smart-rate-day'),evening=read('smart-rate-evening'),target=latest?.booking?.targetDate;
  if(!target||[day,evening].some(value=>value!==null&&!(Number.isFinite(value)&&value>0))||(day===null&&evening===null)){byId('smart-rate-summary').textContent='Enter at least one positive hourly rate.';return;}
  smartRatesOpen=false;smartEdit(draft=>{draft.rates=confirmSmartRates(day,evening,input('smart-rate-status').value as SmartDraft['rates']['status'],target,new Date());});
};
for(let i=0;i<PRECISION_WORKERS.length;i++){
  (byId(`precision-court-${i}`) as HTMLSelectElement).replaceChildren(...Array.from({length:7},(_,c)=>new Option(`Court ${c+1}`,String(c+1))));
  (byId(`precision-start-${i}`) as HTMLSelectElement).replaceChildren(...hours.map(h=>new Option(friendly(h),h)));
  const offsets=document.createElement('div');offsets.className='precision-offsets';
  const widthLabel=document.createElement('label'),width=document.createElement('select');width.id=`precision-width-${i}`;width.replaceChildren(...Array.from({length:PRECISION_MAX_FAN_OUT},(_,child)=>new Option(`${child+1} shot${child?'s':''}`,String(child+1))));width.value=String(Math.min(4,PRECISION_MAX_FAN_OUT));widthLabel.className='fan-out-width';widthLabel.append('Shots for this target',width);offsets.append(widthLabel);
  for(let child=0;child<PRECISION_MAX_FAN_OUT;child++){const offset=document.createElement('label'),field=document.createElement('input');field.id=child?`precision-offset-${i}-${child}`:`precision-offset-${i}`;field.type='text';field.inputMode='numeric';field.value='0';offset.className=child?'fan-out-child-offset':'';offset.dataset.child=String(child);offset.append(child?`Attempt ${child+1} early by (ms)`:'Send early by (ms)',field);offsets.append(offset);}
  byId(`precision-evidence-${i}`).before(offsets);
  input(`precision-start-${i}`).value='17:00';input(`precision-duration-${i}`).value='3';input(`precision-court-${i}`).value=String([7,5,3,6,4,2,1][i]);
}
const fixedCommittedOffsets=new Map<string,string>();
for(let i=0;i<PRECISION_WORKERS.length;i++)for(let child=0;child<PRECISION_MAX_FAN_OUT;child++){
  const id=child?`precision-offset-${i}-${child}`:`precision-offset-${i}`,field=input(id);fixedCommittedOffsets.set(id,field.value);
  const commit=()=>{if(!Number.isFinite(releaseOffsetFromEarlyInput(field.value))){field.setCustomValidity('Enter a whole number from 0 to 2000.');field.reportValidity();return;}
    field.setCustomValidity('');if(fixedCommittedOffsets.get(id)!==field.value){fixedCommittedOffsets.set(id,field.value);changed();}};
  field.addEventListener('input',()=>field.setCustomValidity(''));field.addEventListener('blur',commit);
  field.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();field.blur();}});
}
/** The exact targets the operator configured; nothing is inferred or added. */
function precisionRows():PrecisionRow[]{
  const fanOut=precisionFanOut();
  return Array.from({length:Number(input('precision-count').value)||1},(_,i)=>{const releaseOffsetMs=releaseOffsetFromEarlyInput(fixedCommittedOffsets.get(`precision-offset-${i}`)??'0') as SmartReleaseOffset;
    const width=fanOut?Number(input(`precision-width-${i}`).value):1;
    return {court:Number(input(`precision-court-${i}`).value),start:input(`precision-start-${i}`).value,durationHours:Number(input(`precision-duration-${i}`).value),
      ...(fanOut&&width>1?{fanOutReleaseOffsetsMs:Array.from({length:width},(_,child)=>releaseOffsetFromEarlyInput(fixedCommittedOffsets.get(child?`precision-offset-${i}-${child}`:`precision-offset-${i}`)??'0') as SmartReleaseOffset)}:
        releaseOffsetMs===0?{}:{releaseOffsetMs})};});
}
function precisionFanOut(){return precisionMode==='fixed'&&input('precision-fan-out').checked;}
function syncPrecisionFanOut(){
  const enabled=precisionFanOut();
  for(let i=0;i<PRECISION_WORKERS.length;i++){
    const width=enabled?Number(input(`precision-width-${i}`).value):1;
    for(const field of byId(`precision-row-${i}`).querySelectorAll<HTMLElement>('.fan-out-child-offset'))field.hidden=Number(field.dataset.child)>=width;
  }
  for(const field of document.querySelectorAll<HTMLElement>('.fan-out-width'))field.hidden=!enabled;
  byId('precision-fan-out-note').hidden=!enabled;
  if(enabled){const recommendation=latest?.fanOut?.latest,usable=!!recommendation?.compatible&&!recommendation.stale;
    const count=Number(input('precision-count').value)||1,widths=Array.from({length:count},(_,i)=>Number(input(`precision-width-${i}`).value));
    const over=usable?widths.filter(width=>width>recommendation.recommendedWidth).length:0;
    byId('precision-fan-out-note').textContent=`${widths.reduce((sum,width)=>sum+width,0)} immediate shots configured (up to ${PRECISION_MAX_ATTEMPTS*PRECISION_MAX_FAN_OUT} across ${PRECISION_MAX_ATTEMPTS} workers). ${usable?`Machine recommendation: ${recommendation.recommendedWidth} per target.${over?` ${over} target(s) exceed it; operator override with measured readiness/timing limits.`:''}`:'No compatible measured recommendation; wider schedules are operator overrides.'} Multiple pending holds are possible; payment remains manual.`;}
}
function precisionSelected(){return workflow==='release'&&input('precision-strategy').value==='precision';}
/** Release Offset: the UI accepts a positive "send early by" value; saved timing is release-relative and therefore negative. */
function releaseOffsetFromEarlyInput(raw:string){const text=raw.trim(),early=/^\d+$/.test(text)?Number(text):Number.NaN;const offset=early===0?0:-early;return isReleaseOffsetMs(offset)?offset:Number.NaN;}
function releaseOffsetApplies(){return workflow==='release'&&!precisionSelected()&&input('booking-method').value==='proofless';}
function releaseOffsetValue(){return releaseOffsetApplies()?releaseOffsetFromEarlyInput(input('release-offset-ms').value):0;}
function setReleaseOffset(value:number){input('release-offset-ms').value=String(isReleaseOffsetMs(value)?-value:0);}
function strategyFields():Pick<BookingSetup,'RELEASE_STRATEGY'|'PRECISION_TARGETS'|'PRECISION_FAN_OUT'|'PRECISION_PHASE3'|'RELEASE_LAB'|'STRATEGY_V2'>{
  if(!precisionSelected())return {RELEASE_STRATEGY:'general',PRECISION_TARGETS:releaseDraft?.precisionTargets??[],PRECISION_FAN_OUT:false};
  if(precisionMode!=='smart')return {RELEASE_STRATEGY:'precision',PRECISION_TARGETS:precisionRows(),PRECISION_FAN_OUT:precisionFanOut()};
  const compiled=smartCompiled();
  const baseline=(index:number)=>{const origin=smartLineage.immediate[index],match=origin?/^I(\d+)$/.exec(origin):null;return match?acceptedSmartDraft?.immediate[Number(match[1])]:undefined;};
  const timingModified=!!acceptedSmartDraft&&smartDraft.immediate.some((slot,index)=>!baseline(index)||JSON.stringify(smartSlotOffsets(slot))!==JSON.stringify(smartSlotOffsets(baseline(index)!)));
  const widthModified=!!acceptedSmartDraft&&smartDraft.immediate.some((slot,index)=>smartSlotOffsets(slot).length!==(baseline(index)?smartSlotOffsets(baseline(index)!).length:0));
  const currentWidth=smartDraft.immediate[0]?smartSlotOffsets(smartDraft.immediate[0]).length:strategyMeta?.fanOut.width??1;
  const shotgunMeta=compiled.shotgun&&smartDraft.shotgun?{...structuredClone(smartDraft.shotgun),version:1 as const,counts:{...compiled.shotgun.counts},
    exactSchedule:compiled.shotgun.shots.map(({logicalTargetId,shotIndex,configuredOffsetMs})=>({logicalTargetId,shotIndex,configuredOffsetMs})),
    capacity:{meaningfulSpacingMs:compiled.shotgun.meaningfulSpacingMs,recommendedMaximum:compiled.shotgun.recommendedMaximum,warning:compiled.shotgun.capacityWarning,
      groupAnchorMs:compiled.shotgun.groupAnchorMs}}:undefined;
  const meta=strategyMeta?{...strategyMeta,fanOut:{...strategyMeta.fanOut,width:currentWidth,source:widthModified?'OPERATOR_OVERRIDE' as const:strategyMeta.fanOut.acceptedSource??strategyMeta.fanOut.source,
      timing:timingModified?'CUSTOM' as const:strategyMeta.fanOut.basedOnTiming??(strategyMeta.fanOut.timing==='CUSTOM'?'BALANCED':strategyMeta.fanOut.timing)},
    ...(shotgunMeta?{shotgun:shotgunMeta}:{shotgun:undefined}),lineage:structuredClone(smartLineage),provenance:{source:acceptedSmartDraft?'SMART_SUGGESTED' as const:strategyMeta.provenance?.source??'EXISTING_SMART_PLAN' as const,operatorModifications:strategyModificationCount(smartDraft,acceptedSmartDraft,smartLineage)}}:undefined;
  return {RELEASE_STRATEGY:'precision',PRECISION_TARGETS:[],PRECISION_FAN_OUT:false,...(compiled.phase3?{PRECISION_PHASE3:compiled.phase3}:{}),
    ...(smartDraft.releaseLab?{RELEASE_LAB:smartDraft.releaseLab}:{}),...(compiled.phase3&&meta?{STRATEGY_V2:meta}:{})};
}
/** Precision is Proofless Direct, Standard only: lock those two fields while it is selected. */
function syncStrategy(){
  const precision=precisionSelected(),count=Number(input('precision-count').value)||1;
  byId('precision-strategy').parentElement!.hidden=workflow!=='release';
  byId('setup-fields').classList.toggle('precision-mode',precision);byId('precision-setup').hidden=!precision;
  const smart=precisionMode==='smart';input('precision-mode-smart').checked=smart;input('precision-mode-fixed').checked=!smart;
  byId('legacy-precision-setup').hidden=smart;byId('smart-editor').hidden=!smart;byId('legacy-freeze-note').hidden=smart;
  input('precision-fan-out').disabled=smart;
  syncPrecisionFanOut();
  for(let i=0;i<PRECISION_WORKERS.length;i++)byId(`precision-row-${i}`).hidden=i>=count;
  if(precision){input('booking-method').value='proofless';input('booking-type').value='standard';if(Number(input('duration').value)>3)input('duration').value='3';}
  (byId('booking-method') as HTMLSelectElement).disabled=precision;(byId('booking-type') as HTMLSelectElement).disabled=precision;
  byId('release-offset').hidden=!releaseOffsetApplies();
  renderReleaseLab();
}
function formDraft():FormDraft{return {testWing:input('test-wing').value as 'MANGO'|'BUKO',bukoCourt:Number(input('test-buko-court').value),releaseStrategy:input('precision-strategy').value==='precision'?'precision':'general',precisionCount:Number(input('precision-count').value)||1,precisionTargets:precisionRows(),precisionFanOut:precisionFanOut(),precisionMode,smart:cloneSmart(smartDraft),releaseOffsetMs:releaseOffsetValue(),method:input('booking-method').value as 'browser'|'hybrid'|'api-first'|'proofless',strategy:input('booking-type').value as 'standard'|'extended',date:input('test-date').value,courtCount:Number(input('court-count').value) as CourtCount,start:input('start-time').value,duration:Number(input('duration').value),attempts:Number(input('attempts').value),courtOrder:[...courtOrder],fallbackTimes:[...fallbackTimes],exactA:input('exact-a').value,exactB:input('exact-b').value};}
function applyDraft(d:FormDraft){if(workflow==='test'){input('test-wing').value=d.testWing??'MANGO';input('test-buko-court').value=String(d.bukoCourt??1);}input('precision-strategy').value=d.releaseStrategy;input('precision-count').value=String(Math.min(PRECISION_WORKERS.length,Math.max(1,d.precisionCount)));
  input('precision-fan-out').checked=d.precisionFanOut??false;
  for(let i=0;i<PRECISION_WORKERS.length;i++){input(`precision-width-${i}`).value=String(Math.min(4,PRECISION_MAX_FAN_OUT));for(let child=0;child<PRECISION_MAX_FAN_OUT;child++){const id=child?`precision-offset-${i}-${child}`:`precision-offset-${i}`;input(id).value='0';fixedCommittedOffsets.set(id,'0');}}
  d.precisionTargets.slice(0,PRECISION_WORKERS.length).forEach((t,i)=>{input(`precision-court-${i}`).value=String(t.court);input(`precision-start-${i}`).value=t.start;input(`precision-duration-${i}`).value=String(t.durationHours);
    const offsets=t.fanOutReleaseOffsetsMs??[t.releaseOffsetMs??0];input(`precision-width-${i}`).value=String(offsets.length);offsets.slice(0,PRECISION_MAX_FAN_OUT).forEach((value,child)=>{const id=child?`precision-offset-${i}-${child}`:`precision-offset-${i}`;input(id).value=String(-value);fixedCommittedOffsets.set(id,String(-value));});});
  precisionMode=d.precisionMode??'fixed';smartDraft=cloneSmart(d.smart??emptySmartDraft());smartLineage=acceptedSmartDraft?reconstructLineage(smartDraft,acceptedSmartDraft,strategyMeta?.lineage):{immediate:smartDraft.immediate.map(()=>null),backups:smartDraft.backups.map(()=>null)};smartRatesOpen=false;setReleaseOffset(d.releaseOffsetMs??0);
  input('booking-method').value=d.method;input('booking-type').value=d.strategy;input('test-date').value=d.date;input('court-count').value=String(d.courtCount);input('start-time').value=d.start;input('duration').value=String(d.duration);input('attempts').value=String(d.attempts);courtOrder=[...d.courtOrder];fallbackTimes=[...d.fallbackTimes];input('exact-a').value=d.exactA;input('exact-b').value=d.exactB;editors();syncStrategy();renderSmart(true);}
function storeDraft(){const d=formDraft();if(workflow==='test')testDraft=d;else releaseDraft=d;}
function reconcileReleaseDraft(){
  if(workflow!=='release')return;
  const reconciliation=reconcileFallbackTimes(input('start-time').value,Number(input('duration').value),fallbackTimes);
  if(reconciliation.removed.length){fallbackTimes=[...reconciliation.valid];releaseAdjustment=reconciliation;editors();}
}
function changed(){input('terms').checked=false;reconcileReleaseDraft();strategyMainCourtOrderChanged();if(workflow==='test')testDirty=true;else releaseDirty=true;dirty=true;storeDraft();void window.thirsty.invalidatePreparation?.().catch(()=>{});byId('edit-status').textContent='SETTINGS CHANGED · Press Reset & Prepare.';if(latest)render(latest);}
function syncViableControls(){
  const duration=Number(input('duration').value),start=input('start-time').value,extended=input('booking-type').value==='extended';
  input('duration').min=extended?'4':'1';input('duration').max=extended?'6':'3';
  for(const option of [...(byId('start-time') as HTMLSelectElement).options])option.disabled=Number(option.value.slice(0,2))+duration>24;
  const viable=hours.filter(h=>h!==start&&!fallbackTimes.includes(h)&&Number(h.slice(0,2))+duration<=24);
  const picker=byId('fallback-time') as HTMLSelectElement,previous=picker.value;picker.replaceChildren(...viable.map(h=>new Option(friendly(h),h)));if(viable.includes(previous))picker.value=previous;
  (byId('add-fallback') as HTMLButtonElement).disabled=!viable.length;
}
function editors(){
  const draw=(id:string,items:(string|number)[],fallback:boolean)=>byId(id).replaceChildren(...items.map((item,index)=>{
    const li=document.createElement('li'),label=document.createElement('span');label.textContent=fallback?friendly(String(item)):`Court ${item}`;li.append(label);
    for(const [text,offset] of [['↑',-1],['↓',1]] as const){const button=document.createElement('button');button.textContent=text;button.setAttribute('aria-label',`Move ${label.textContent} ${offset<0?'up':'down'}`);button.disabled=index+offset<0||index+offset>=items.length;button.onclick=()=>{const other=index+offset;[items[index],items[other]]=[items[other]!,items[index]!];editors();changed();};li.append(button);}
    if(fallback){const remove=document.createElement('button');remove.textContent='Remove';remove.onclick=()=>{fallbackTimes.splice(index,1);editors();changed();};li.append(remove);}
    return li;
  }));draw('court-order',courtOrder,false);draw('fallback-order',fallbackTimes,true);
}
editors();
testDraft=formDraft();
function renderBlockAudit(target:HTMLElement,audit:Dashboard['blockAudit']|null,date:string){
  target.replaceChildren();
  if(!audit){
    const empty=document.createElement('div');empty.className='audit-empty';
    const title=document.createElement('strong');title.textContent='No audit for this date';
    const note=document.createElement('span');note.textContent=date?`Check ${dateLabel(date)} to see confirmed blocks and schedule coverage.`:'Choose a date, then check all courts.';
    empty.append(title,note);target.append(empty);return;
  }
  const statusInfo={
    OPEN:{label:'Open',symbol:'✓',detail:'Published by Onda as available'},
    BLOCKED:{label:'Blocked',symbol:'×',detail:'Confirmed booking record or published unavailable cell'},
    UNRELEASED:{label:'No known booking · not yet published',symbol:'—',detail:'Target date not yet published; no public booking record. NOT confirmed open.'},
    UNKNOWN:{label:'Unknown / read failed',symbol:'?',detail:'No authoritative state (read failed, booking lookup failed, or unexpected response); never treated as open'},
  } as const;
  const top=document.createElement('div');top.className='audit-overview';
  const heading=document.createElement('div'),eyebrow=document.createElement('span'),title=document.createElement('strong');
  eyebrow.className='audit-target-label';eyebrow.textContent='AUDIT TARGET';title.textContent=dateLabel(audit.date);heading.append(eyebrow,title);
  const source=document.createElement('span');source.className='audit-source';source.textContent='112 hourly cells · Courts 1–7 · 8 AM–12 MN';top.append(heading,source);
  const counts=document.createElement('div');counts.className='audit-counts';
  for(const status of ['BLOCKED','OPEN','UNRELEASED','UNKNOWN'] as const){
    const count=audit.cells.filter(cell=>cell.status===status).length,card=document.createElement('div');card.className=`audit-count audit-${status.toLowerCase()}`;
    const value=document.createElement('strong'),label=document.createElement('span');value.textContent=String(count);label.textContent=statusInfo[status].label;card.append(value,label);counts.append(card);
  }
  const warning=document.createElement('p');warning.className='audit-guidance';warning.textContent='UNKNOWN and UNRELEASED are not proof that a court is open. Only green OPEN cells are confirmed available; red BLOCKED cells must be avoided.';
  const publicBlocks=audit.cells.filter(cell=>cell.status==='BLOCKED'&&cell.source==='PUBLIC_BOOKING');
  const confirmed=document.createElement('section');confirmed.className='audit-confirmed';
  const confirmedTitle=document.createElement('div');confirmedTitle.className='audit-subtitle';
  const confirmedHeading=document.createElement('strong');confirmedHeading.textContent='Confirmed public-record blocks';
  const confirmedCount=document.createElement('span');confirmedCount.textContent=`${publicBlocks.length} cell${publicBlocks.length===1?'':'s'}`;confirmedTitle.append(confirmedHeading,confirmedCount);confirmed.append(confirmedTitle);
  const chips=document.createElement('div');chips.className='audit-block-chips';
  if(publicBlocks.length)for(const court of Array.from({length:7},(_,index)=>index+1)){
    const cells=publicBlocks.filter(cell=>cell.court===court);if(!cells.length)continue;
    const chip=document.createElement('span');chip.textContent=`Court ${court} · ${cells.map(cell=>friendly(cell.hour)).join(', ')}`;chips.append(chip);
  }else{const clear=document.createElement('span');clear.className='audit-no-blocks';clear.textContent='No confirmed public booking records were returned for this date.';chips.append(clear);}
  confirmed.append(chips);
  const legend=document.createElement('div');legend.className='audit-legend';
  for(const status of ['OPEN','BLOCKED','UNRELEASED','UNKNOWN'] as const){const item=document.createElement('span'),mark=document.createElement('i');item.className=`audit-${status.toLowerCase()}`;mark.textContent=statusInfo[status].symbol;item.append(mark,document.createTextNode(`${statusInfo[status].label} · ${statusInfo[status].detail}`));legend.append(item);}
  const matrixSection=document.createElement('section');matrixSection.className='audit-matrix-section';
  const matrixTitle=document.createElement('div');matrixTitle.className='audit-subtitle';matrixTitle.append(Object.assign(document.createElement('strong'),{textContent:'Court-by-hour matrix'}),Object.assign(document.createElement('span'),{textContent:'Scroll horizontally to inspect every hour'}));
  const scroll=document.createElement('div');scroll.className='audit-matrix-scroll';scroll.tabIndex=0;
  const table=document.createElement('table');table.className='audit-matrix';
  const thead=document.createElement('thead'),header=document.createElement('tr');header.append(Object.assign(document.createElement('th'),{textContent:'Court'}));
  for(const hour of hours){const th=document.createElement('th');th.textContent=friendly(hour).replace(':00 ','');th.title=friendly(hour);header.append(th);}thead.append(header);table.append(thead);
  const tbody=document.createElement('tbody');
  for(const court of Array.from({length:7},(_,index)=>index+1)){
    const row=document.createElement('tr'),courtHeading=document.createElement('th');courtHeading.scope='row';courtHeading.textContent=`C${court}`;courtHeading.title=`Court ${court}`;row.append(courtHeading);
    for(const hour of hours){const cell=audit.cells.find(value=>value.court===court&&value.hour===hour)!,td=document.createElement('td');td.className=`audit-cell audit-${cell.status.toLowerCase()}`;td.textContent=statusInfo[cell.status].symbol;td.title=`Court ${court} · ${friendly(hour)} · ${statusInfo[cell.status].label} · ${cell.source.replaceAll('_',' ').toLowerCase()}`;td.setAttribute('aria-label',td.title);row.append(td);}tbody.append(row);
  }
  table.append(tbody);scroll.append(table);matrixSection.append(matrixTitle,scroll);
  target.append(top,counts,warning,confirmed,legend,matrixSection);
}
const holdExpired=(hold:{holdExpiresAt?:string})=>!!hold.holdExpiresAt&&Date.parse(hold.holdExpiresAt)<=Date.now();
function activeHandoffs(state:Dashboard){return (state.qrHandoffs??[]).filter(hold=>!holdExpired(hold));}
type PlayerDetails={fullName:string;phone:string;email:string}|undefined;
function playersByWorker(details:Dashboard['playerStatus']):Record<WorkerId,PlayerDetails>{return {A:details?.primaryDetails,B:details?.extendedDetails,C:details?.thirdDetails,D:details?.fourthDetails,E:details?.fifthDetails,F:details?.sixthDetails,G:details?.seventhDetails,H:details?.eighthDetails};}
function buildHandoffCard(hold:import('../types.js').QrHandoffSummary,players:Record<WorkerId,PlayerDetails>){
  const card=document.createElement('div');card.className='qr-summary-item';
  const worker=hold.checkout,player=worker?players[worker]:undefined;
  const heading=document.createElement('strong');heading.textContent=worker?`Browser ${worker} · ${player?.fullName||`Player ${worker}`}`:'QR checkout';
  const phase=document.createElement('div');phase.className=`qr-summary-phase ${(hold.status??'qr-ready')==='qr-ready'?'ready':'pending'}`;phase.textContent=(hold.status??'qr-ready')==='qr-ready'?'QR READY · VERIFY DETAILS BEFORE PAYING':'PAYMENT HOLD ACTIVE · OPENING QR PAGE';
  const identity=document.createElement('div');identity.className='qr-summary-email';identity.textContent=player?.email||'Player email unavailable';
  const booking=document.createElement('div');booking.className='qr-summary-booking';booking.textContent=`${hold.wing==='BUKO'?'Buko Wing':'Mango Wing'} · Court${hold.courts.length===1?'':'s'} ${hold.courts.join(' + ')}\nDate: ${dateLabel(hold.date)} (${hold.date})\nTime: ${hold.startTime}–${hold.endTime}\nSlots: ${hourlySlots(hold.startTime,hold.endTime).join(' · ')}`;
  const amount=document.createElement('div');amount.className='qr-summary-amount';amount.textContent=`Amount: ₱${hold.amount.toLocaleString()} · ${holdExpired(hold)?'Recorded hold timer elapsed; check Chrome':'Payment pending'}`;
  card.append(heading,phase,identity,booking,amount);
  if(hold.bookingNo){const reference=document.createElement('div');reference.className='small';reference.textContent=`Booking reference: ${hold.bookingNo}`;card.append(reference);}
  if(hold.holdExpiresAt&&Number.isFinite(Date.parse(hold.holdExpiresAt))){const expiry=document.createElement('div');expiry.className='small';expiry.textContent=`Recorded hold expiry: ${new Date(hold.holdExpiresAt).toLocaleString('en-GB',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})} Manila`;card.append(expiry);}
  if(worker){
    const action=document.createElement('button');action.type='button';action.className='show-browser secondary';action.textContent=`Show Browser ${worker}`;
    const result=document.createElement('span');result.className='show-browser-result';result.setAttribute('role','status');result.textContent=browserFocusMessages[worker]??'';
    action.disabled=!!browserFocusPending[worker];
    action.onclick=()=>showBrowser(worker,hold.bookingId);
    card.append(action,result);
  }
  return card;
}
const renderedQrSummary:Record<string,string>={};
function renderQrSummary(state:Dashboard){
  const handoffs=activeHandoffs(state);
  const qrReady=handoffs.filter(hold=>(hold.status??'qr-ready')==='qr-ready').length;
  const players=playersByWorker(state.playerStatus);
  // Signature includes hold-expiry and the Show Browser pending/message state so a rebuild
  // still happens on those transitions, but routine polling with nothing actually changed
  // must not tear down an in-flight Show Browser button/click.
  const signature=JSON.stringify({handoffs:handoffs.map(hold=>({...hold,expired:holdExpired(hold)})),players,browserFocusPending,browserFocusMessages});
  for(const id of ['qr-summary-release','qr-summary-test']){
    const container=byId(id);container.hidden=!handoffs.length;
    if(!handoffs.length){container.replaceChildren();renderedQrSummary[id]='';continue;}
    if(renderedQrSummary[id]===signature)continue;
    renderedQrSummary[id]=signature;
    const title=document.createElement('strong');title.className='qr-summary-title';
    title.textContent=qrReady===handoffs.length?`All QR pages reached · ${qrReady} checkout${qrReady===1?'':'s'}`:`Live checkout status · ${qrReady} of ${handoffs.length} QR page${handoffs.length===1?'':'s'} ready`;
    const note=document.createElement('p');note.className='small';note.textContent='Confirm every court and time slot below against the visible Onda QR pages before scanning or paying. A hold is not final booking confirmation.';
    const list=document.createElement('div');list.className='qr-summary-list';
    for(const hold of handoffs)list.append(buildHandoffCard(hold,players));
    container.replaceChildren(title,note,list);
  }
}
/** Browsers the current plan needs, so the strip can flag a needed browser that is closed. */
function neededWorkers():WorkerId[]{
  if(workflow==='release'&&precisionSelected()){
    if(precisionMode==='smart'){const compiled=smartCompiled();return [...new Set([...compiled.immediateWorkers.filter(worker=>worker!==null),...compiled.standby])] as WorkerId[];}
    return PRECISION_WORKERS.slice(0,Number(input('precision-count').value)||1) as WorkerId[];
  }
  const strategy=input('booking-type').value,count=Number(input('court-count').value);
  return requiredWorkers(strategy,count);
}
function showBrowser(worker:WorkerId,bookingId?:string){
  if(browserFocusPending[worker])return;
  browserFocusPending[worker]=true;browserFocusMessages[worker]=`Opening Browser ${worker}…`;
  if(latest)render(latest);
  void window.thirsty.focusBrowser({workerId:worker,...(bookingId?{bookingId}:{})})
    .then(result=>{browserFocusMessages[worker]=result==='focused'
      ?`Browser ${worker} is now in front, maximized on its screen.`
      :`Browser ${worker} was restored on its screen, but Windows kept another window in front. Check the taskbar.`;})
    .catch((error:unknown)=>{browserFocusMessages[worker]=browserFocusFailure(worker,error);})
    .finally(()=>{browserFocusPending[worker]=false;if(latest)render(latest);});
}
let renderedBrowsers='';
function renderBrowsers(state:Dashboard,busy:boolean){
  const health=state.browserHealth??{} as Partial<Record<WorkerId,boolean>>,needed=neededWorkers();
  const open=ALL_WORKERS.filter(worker=>health[worker]).length;
  const closeBlocked=busy||!!state.scheduledRelease;
  for(const id of ['close-browsers','close-browsers-tools']){const button=input(id);button.disabled=closeBlocked;button.title=closeBlocked?'Blocked while a run is active or a release is armed.':'Close every Chrome window the bot opened. Your own Chrome is not touched.';}
  const signature=JSON.stringify({health,needed,browserFocusPending,browserFocusMessages,players:state.playerStatus});
  if(signature===renderedBrowsers)return;
  renderedBrowsers=signature;
  const players=playersByWorker(state.playerStatus);
  byId('browser-strip').replaceChildren(...ALL_WORKERS.map(worker=>{
    const dot=document.createElement('button');dot.type='button';dot.className=`browser-dot${health[worker]?' open':''}${needed.includes(worker)?' needed':''}`;
    dot.textContent=worker;dot.disabled=!health[worker];
    dot.title=`Browser ${worker} · ${health[worker]?'open — click to bring it to the front':needed.includes(worker)?'closed · needed by the saved plan':'closed'}`;
    dot.setAttribute('aria-label',dot.title);
    dot.onclick=()=>showBrowser(worker);
    return dot;
  }));
  byId('browser-list').replaceChildren(...ALL_WORKERS.map(worker=>{
    const row=document.createElement('div');row.className=`browser-row${health[worker]?' open':''}`;
    const dot=document.createElement('span');dot.className=`browser-dot${health[worker]?' open':''}${needed.includes(worker)?' needed':''}`;dot.textContent=worker;
    const text=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('span');
    name.textContent=`Browser ${worker} · ${players[worker]?.fullName??workerLabel(worker)}`;
    detail.textContent=browserFocusMessages[worker]??(health[worker]?'Open':needed.includes(worker)?'Closed · needed by the saved plan':'Closed');
    text.append(name,detail);
    const show=document.createElement('button');show.type='button';show.className='secondary';show.textContent='Show';
    show.disabled=!health[worker]||!!browserFocusPending[worker];show.onclick=()=>showBrowser(worker);
    row.append(dot,text,show);return row;
  }));
  byId('browser-list').setAttribute('aria-label',`${open} of 8 bot browsers open`);
}
function renderStatusBar(state:Dashboard){
  const clock=state.clock;
  const sync=byId('status-clock-sync');sync.textContent=clock?.networkSynced?'Synced':'Not synced';sync.dataset.tone=clock?.networkSynced?'good':'warn';
  const lock=byId('status-lock');lock.textContent=state.lock?'Active':'Clear';lock.dataset.tone=state.lock?'warn':'good';
  const watch=state.slotWatch,watchText=byId('status-watch-text');
  const label=!watch?'Idle':watch.status==='waiting'?`Waiting · ${dateLabel(watch.date).split(',')[0]}`:watch.status==='watching'?`Watching · ${watch.polls} reads`:watch.status==='finished'?'Finished':'Stopped';
  watchText.textContent=label;watchText.dataset.tone=!watch?'muted':watch.status==='watching'?'good':watch.status==='waiting'?'warn':'muted';
}
const forensicState=(value:string|null)=>value??'not observed';
let renderedForensics='';
/** Runs view: one concise card per generated forensic report; the raw detail stays in the local report. */
function renderForensics(state:Dashboard){
  const list=state.releaseForensics??[],signature=JSON.stringify(list);
  if(signature===renderedForensics)return;
  renderedForensics=signature;
  const host=byId('release-forensics-list');
  if(!list.length){host.replaceChildren(Object.assign(document.createElement('p'),{className:'empty',textContent:'No forensic report yet. One is written automatically after each live run.'}));return;}
  host.replaceChildren(...list.map(entry=>{
    const card=document.createElement('details');card.className='forensic-item';
    const summary=document.createElement('summary');
    const title=document.createElement('strong');title.textContent=`${dateLabel(entry.date)} · ${entry.reference==='release'&&entry.referenceMs!==null?`release ${new Date(entry.referenceMs).toLocaleString('en-GB',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})}`:'immediate test'} · ${entry.status.toUpperCase()}`;
    const facts=document.createElement('span');facts.className='meta';
    facts.textContent=`First POST ${entry.firstPostOffsetMs===null?'—':relative(entry.firstPostOffsetMs)} · last POST ${entry.lastPostOffsetMs===null?'—':relative(entry.lastPostOffsetMs)} · first published grid ${entry.firstPublished?readText(entry.firstPublished):'not observed'} · provider trace ${entry.traceAvailable?'available':'unavailable'}${entry.outcome?` · ${entry.outcome}`:''}`;
    summary.append(title,facts);
    const rows=document.createElement('div');rows.className='forensic-targets';
    for(const target of entry.targets){
      const row=document.createElement('div');row.className='forensic-target';
      row.textContent=`Worker ${target.workerId} · Court ${target.court} · ${target.startTime}–${target.endTime} · POST ${target.postOffsetMs===null?'not sent':relative(target.postOffsetMs)} · first published ${forensicState(target.firstPublishedState)} · ${target.statusCode===null?'no response':`HTTP ${target.statusCode}${target.errorHint?` ${target.errorHint}`:''}`}${target.headersOffsetMs!==null?` · headers ${relative(target.headersOffsetMs)}`:''}${target.bodyOffsetMs!==null?` · body ${relative(target.bodyOffsetMs)}`:''}${target.protocol?` · ${target.protocol}${target.reused===null?'':target.reused?' reused':' new connection'}`:''}`;
      rows.append(row);
    }
    const path=document.createElement('p');path.className='small forensic-path';path.textContent=`Report: ${entry.reportPath}`;path.title=entry.reportPath;
    card.append(summary,rows,path);return card;
  }));
}
function status(id: string, text: string, tone: string) { const el = byId(id); el.textContent = text; el.dataset.tone = tone; }
/** A gate is done (true), not yet done (false), automatic at arm time ('pending') or blocked with a reason. */
type Gate=[string,boolean|'pending'|'blocked',string?];
function gateRows(gates:Gate[]){return gates.map(([label,state,detail])=>{
  const tone=state===true?'good':state==='pending'?'pending':state==='blocked'?'bad':'warn';
  const row=document.createElement('div');row.className=`gate ${tone}`;
  const mark=document.createElement('span');mark.className='gate-mark';mark.textContent={good:'✓',pending:'○',bad:'✕',warn:'–'}[tone];
  mark.setAttribute('aria-label',{good:'Done',pending:'Automatic',bad:'Blocked',warn:'Pending'}[tone]);
  const text=document.createElement('span');text.append(label);
  if(detail){const note=document.createElement('small');note.className='gate-detail';note.textContent=detail;text.append(note);}
  row.append(mark,text);return row;});}
/** Wave 1 preregistration: created automatically when an API release is armed; only shown for the release it covers. */
function manifestGate(state:Dashboard,releaseMs:number|undefined):Gate{
  const manifest=state.arbitrationManifest;
  if(!manifest||releaseMs===undefined||manifest.releaseMs!==releaseMs)return ['Investigation manifest · Automatic when you arm','pending'];
  if(manifest.status==='blocked')return ['Investigation manifest · BLOCKED · could not preregister this release','blocked',manifest.reason];
  return [`Investigation manifest · READY · ${manifest.verified?'existing preregistration verified':'preregistered before run'}`,true];
}
/** Build provenance: short label in the navigation bar, full record in Tools. */
function renderBuild(state: Dashboard) {
  const build = state.build;
  const label = byId('build-label');
  const provenance = provenanceStatus(build?.gitSha === 'unknown' ? null : build?.gitSha, state.sourceStatus);
  label.textContent = build ? `Build ${build.gitSha.slice(0, 7)}${build.dirty ? ' + uncommitted' : ''}${provenance.tone === 'warn' && state.sourceStatus?.headSha ? ' · newer source not installed' : ''}` : 'Build: unknown';
  label.dataset.tone = !build || build.dirty !== false || provenance.tone === 'warn' ? 'warn' : 'muted';
  label.title = build ? `${build.gitSha} · ${build.branch} · built ${build.builtAt} · ${build.buildId}` : 'No build-info.json: this run was not produced by a clean build.';
  const details = byId('build-details');
  const rows: Array<[string, string]> = build ? [['Git SHA', build.gitSha], ['Branch', build.branch],
    ['Source state', build.dirty === null ? 'unknown' : build.dirty ? 'UNCOMMITTED CHANGES were included' : 'clean (committed source only)'],
    ['Built', build.builtAt], ['Build ID', build.buildId], ['Dist content ID', build.contentId], ['Kind', build.kind], ['Package version', build.packageVersion], ['Node', build.node],
    // Source Updated / CI Verified / Installed / Installed Runtime Verified are separate facts; GitHub alone never means installed.
    ['Installed', build.kind === 'installation' ? `Yes · this app runs ${build.gitSha.slice(0, 7)} built ${build.builtAt}` : 'No · development or source build, not the canonical installation'],
    ['CI verified', build.kind === 'installation' ? 'Required by the canonical updater for this exact commit before it was installed' : 'Not established for a development build'],
    ['Installed runtime verified', build.kind === 'installation' ? 'Checked by the updater against a fresh compile (BUILD-INFO.txt); re-check with npm run verify:dist -- --dist ../dist' : 'Not applicable'],
    ['Source checkout', provenance.detail],
    ['Last installation preflight', state.updatePreflight ? `${state.updatePreflight.eligibility} · ${state.updatePreflight.blockers} active lifecycle blocker${state.updatePreflight.blockers === 1 ? '' : 's'} · ${state.updatePreflight.historicalUnknown} historical UNKNOWN record${state.updatePreflight.historicalUnknown === 1 ? '' : 's'} preserved (never reclassified) · checked ${state.updatePreflight.checkedAt}` : 'Not recorded. Run npm run app:update-check (read-only) from Source.']]
    : [['Build', 'No build-info.json was found. Rebuild with npm run release:build (or npm run ui:build for development).'], ['Source checkout', provenance.detail]];
  details.replaceChildren(...rows.flatMap(([term, value]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = term; dd.textContent = value; return [dt, dd]; }));
}
/** Legacy panes render first; the destination modules (Booking Setup, Home, Activity) render from the same state. */
/** The legacy form's unsaved-edit flag applies only while that form owns the release plan. */
const formDirty=()=>workflow==='release'&&!!hooks.useSavedRelease?.()?false:dirty;
function render(state: Dashboard) { renderPanes(state); for (const renderer of hooks.renderers) renderer(state); }
function renderPanes(state: Dashboard) {
  latest = state;
  renderBuild(state);
  renderNextRelease(state);
  renderLive(state);
  renderInsights(state);
  renderStrategy(state);
  renderPrecision(state);
  renderQrSummary(state);
  renderStatusBar(state);
  renderSlotWatch(state);
  renderForensics(state);
  renderPhase4(state);
  byId('headline').textContent = state.headline; byId('detail').textContent = state.detail;
  const apiRelease=state.operation==='full'?state.activeApiRelease:null;
  const armed=!!state.scheduledRelease;
  const busy = state.operation !== 'idle'&&state.operation!=='scheduled';
  for(const id of ['test-wing','test-buko-court','test-date','book-now-start','book-now-duration','book-now-objective','book-now-exact','browse-courts'])input(id).disabled=busy;
  byId('stop').hidden=!(busy||hooks.labRunning);byId('inline-stop').hidden=!(busy||hooks.labRunning||armed||!!apiRelease);
  const playerStatus=state.playerStatus??{primary:!!state.booking?.playerConfigured,extended:!!state.booking?.extendedPlayerConfigured,third:!!state.booking?.thirdPlayerConfigured,fourth:!!state.booking?.fourthPlayerConfigured,fifth:!!state.booking?.fifthPlayerConfigured,sixth:!!state.booking?.sixthPlayerConfigured,seventh:!!state.booking?.seventhPlayerConfigured,eighth:!!state.booking?.eighthPlayerConfigured};
  const dual=state.booking?.setup.BOOKING_TYPE==='standard'&&state.booking.setup.COURT_COUNT===2;
  // Keep the dual practice entry point visible in the safe single-court
  // default; actions stay disabled until count 2 is explicitly saved.
  byId('dual-panel').hidden=false;
  (byId('dual-fields') as HTMLFieldSetElement).disabled=busy;
  (byId('dual-prepare') as HTMLButtonElement).disabled=busy||state.lock||formDirty()||!dual;
  (byId('dual-dry') as HTMLButtonElement).disabled=busy||state.lock||formDirty()||!dual||!state.cdp;
  (byId('dual-selection') as HTMLButtonElement).disabled=busy||state.lock||formDirty()||!dual||!state.cdp||!input('dual-noncompetitive').checked;
  (byId('dual-full') as HTMLButtonElement).disabled=busy||state.lock||formDirty()||!dual||!state.cdp||!input('dual-noncompetitive').checked||!input('dual-terms').checked;
  byId('dual-readiness').textContent=dual
    ? ['A','B'].map(id=>{const w=state.dualWorkers?.[id as 'A'|'B'];return `Browser ${id}: ${w?`${w.state.toUpperCase()} (last observed ${new Date(w.verifiedAt).toLocaleTimeString()})`:'NOT VERIFIED'}`;}).join('\n')+`\nDual selection: ${state.dualValidation?.selection?'READY':'NOT READY'}\n${state.dualValidation?.full?'DUAL FULL FLOW VERIFIED':'FULL DUAL HOLD NOT YET VERIFIED'}`
    : 'Legacy dual practice only: Set Courts to book to 2 with Standard saved settings. Use the main controls for Standard / Extended bookings.';
  const dualResult=state.dualResult;byId('dual-result').hidden=!dualResult;
  byId('dual-result').textContent=dualResult?`${dualResult.status.replaceAll('_',' ')}\n${dualResult.date} / ${dualResult.hours.join(', ')}\nBrowser A: Court ${dualResult.courtA}\nBrowser B: Court ${dualResult.courtB}\nSource: ${dualResult.candidateSource}`:'';
  const full=workflow==='release'||state.mode==='full',fullReady=state.capabilities.selectionReady&&state.capabilities.checkoutReady&&state.capabilities.paymentBoundaryReady;
  input('mode-full').checked=full;input('mode-selection').checked=!full;
  input('mode-full').disabled=busy||!fullReady;input('mode-selection').disabled=busy;
  input('terms').disabled=armed||busy||state.lock||formDirty()||!full||!fullReady;
  byId('mode-label').textContent=full?'FULL BOOKING TO QR':'SELECTION ONLY';
  byId('prepare').firstChild!.textContent=dual?'Prepare Selected Dual Run ':full?'Prepare Full Booking ':'Prepare Selection ';
  byId('arm').textContent=full?'Arm Full Booking':'Arm Booking Selection';
  byId('arm-description').textContent=full?'Per-run terms + confirmation required · stops at QR Checkout · payment stays manual':'Explicit confirmation · leaves selected slots · stops before Proceed';
  byId('full-gate').textContent=fullReady?'VERIFIED / AVAILABLE':'LOCKED / NOT READY';
  for (const id of ['inspect', 'prepare', 'arm','dry','observe']) (byId(id) as HTMLButtonElement).disabled = busy || state.lock;
  (byId('chrome') as HTMLButtonElement).disabled = busy;
  (byId('setup-fields') as HTMLFieldSetElement).disabled=busy;
  // A retained lock blocks browser-changing practice actions, but operators can
  // still prepare the next exact target and its one-run Terms authorization.
  for(const id of ['practice-fields','full-practice-fields']) (byId(id) as HTMLFieldSetElement).disabled=busy;
  byId('lock-card').hidden=!state.lock;
  const unresolvedCheckout=state.retainedLockStage==='FINAL_ACTION_DISPATCHING';
  byId('lock-note').textContent=unresolvedCheckout?'The previous checkout ended with a retained safety lock. Reset & Prepare will inspect every required browser and recover only when they are conclusively clean.':state.canPrepareOverHold?'The previous payment hold remains recorded. Prepare New Run opens a fresh schedule for another run in this bot. Payment stays manual.':'Booking actions are blocked. You can still edit and save your next booking plan locally.';
  (byId('review-lock') as HTMLButtonElement).disabled=busy;
  byId('clear-lock').hidden=!state.lockReview?.canClear;
  (byId('clear-lock') as HTMLButtonElement).disabled=busy;
  (byId('reset-practice') as HTMLButtonElement).disabled=busy;
  const review=state.lockReview;
  byId('lock-review').textContent=review?`Run ID: ${review.runID}\nPID: ${review.pid??'Unknown'}\nProcess: ${review.alive===null?'Unknown':review.alive?'Running':'Not running'}\nUI-owned worker: ${review.owned?'Running':'None'}\nBrowser state: ${review.canClear?'Safe at last review':'Needs verification'}\nCurrent page: ${review.page}\nSelected slots: ${review.selected??'Unknown'}\nPayment hold: ${review.hold}\nReason: ${review.reason}\nChecked: ${review.verifiedAt}`:'Browser state: Needs verification. Use Review Lock.';
  if(review?.mode==='dual')byId('lock-review').textContent=`Mode: DUAL\nCoordinator PID: ${review.pid??'Unknown'} / ${review.alive===false?'Not running':review.alive?'Running':'Unknown'}\n${review.workers?.map(w=>`Browser ${w.id}: PID ${w.pid??'Unknown'} / ${w.alive===false?'Not running':w.alive?'Running':'Unknown'} / ${w.page} / selected ${w.selected??'Unknown'} / hold ${w.hold} / recorded ${w.recordedState}`).join('\n')}\nReason: ${review.reason}`;
  const reason=busy?'An operation is running.':state.lock?'Reset & Prepare will inspect the retained session safely.':!playerStatus.primary?'Primary player configuration is missing.':!state.ready?'Press Reset & Prepare for the current settings.':!state.termsAuthorized?'Authorize Terms for this run.':'';
  byId('blocked-reason').textContent=reason;
  for(const id of ['inspect','prepare','arm','dry','observe'])byId(id).title=reason;
  byId('chrome').title=state.lock?'Starts or reuses dedicated Chrome for read-only lock review.':'Starts or reuses dedicated Chrome.';
  (byId('full-practice') as HTMLButtonElement).disabled=busy||state.lock||!state.cdp||!state.booking?.playerConfigured||!fullReady||!input('full-terms').checked;
  (byId('practice') as HTMLButtonElement).disabled=busy||state.lock||!state.cdp;
  byId('practice-blocked').textContent=state.lock?'Use Reset Practice Session to inspect and safely restart the dedicated practice environment.':!state.cdp?'Start / Attach Chrome first.':!state.booking?.playerConfigured?'Player information is missing.':!fullReady?'Full Booking capability is not verified.':!input('full-terms').checked?'Terms authorization is required for this practice run.':'';
  (byId('prepare') as HTMLButtonElement).disabled=armed||busy||state.lock||formDirty()||!state.booking;
  (byId('arm') as HTMLButtonElement).disabled = armed?false:busy || state.lock || !state.booking || !state.capabilities.selectionReady || !state.cdp || (full&&(!fullReady||!state.termsAuthorized));
  (byId('dry') as HTMLButtonElement).disabled=busy||formDirty()||state.lock||!state.booking||!state.clock?.canArmToday;
  (byId('observe') as HTMLButtonElement).disabled=busy||state.lock||!state.clock?.canArmToday;
  input('terms').checked=state.termsAuthorized||armed;
  byId('player-status').textContent=`Player information · ${state.booking?.playerConfigured?'Configured ✓':'Missing / configuration invalid'}`;
  byId('capability-status').textContent=`Selection ${state.capabilities.selectionReady?'ready':'unverified'} · checkout ${state.capabilities.checkoutReady?'verified':'unverified'} · payment handoff ${state.capabilities.paymentBoundaryReady?'verified':'unverified'}`;
  const b=state.booking;
  if(b){
   if(!releaseDirty&&loadedPlan!==b.fingerprint){
    loadedPlan=b.fingerprint;strategyMeta=b.setup.STRATEGY_V2?structuredClone(b.setup.STRATEGY_V2):undefined;
    const loadedSmart=b.setup.PRECISION_PHASE3?smartDraftFromSaved(b.setup,b.targetDate):undefined;
    // A reset baseline exists only when an accepted Smart suggestion was actually persisted. Never manufacture one from the current plan.
    acceptedSmartDraft=strategyMeta?.acceptedPhase3?smartDraftFromPhase3(strategyMeta.acceptedPhase3,{targetDate:b.targetDate,unavailable:unreadyWorkers()}):null;
    releaseDraft={releaseStrategy:b.setup.RELEASE_STRATEGY??'general',precisionCount:Math.max(1,b.setup.PRECISION_TARGETS?.length??0),precisionTargets:[...(b.setup.PRECISION_TARGETS??[])],precisionFanOut:b.setup.PRECISION_FAN_OUT,precisionMode:b.setup.PRECISION_PHASE3?'smart':'fixed',smart:loadedSmart,releaseOffsetMs:b.setup.RELEASE_OFFSET_MS??0,method:b.setup.BOOKING_METHOD??'browser',strategy:b.setup.BOOKING_TYPE??'standard',date:testDraft?.date??input('test-date').value,courtCount:b.setup.COURT_COUNT,start:b.setup.START_TIME,duration:b.setup.DURATION_HOURS,attempts:b.setup.MAX_SELECTION_ATTEMPTS,courtOrder:[...b.setup.PREFERRED_COURTS],fallbackTimes:[...b.setup.FALLBACK_TIMES],exactA:'',exactB:''};
    if(b.fallbackReconciliation.removed.length){releaseAdjustment=b.fallbackReconciliation;releaseDirty=true;}if(workflow==='release'){applyDraft(releaseDraft);dirty=releaseDirty;}}
     if(workflow==='release'&&precisionMode==='smart')renderSmart();
    byId('booking-preview').textContent=`${dual?'2 COURTS / SAME TIME BLOCK\n':''}TARGET  ${dateLabel(b.targetDate)}\nREQUIRED SLOTS  ${b.slots.join(' · ')}\nCOURT ORDER  ${b.setup.PREFERRED_COURTS.join(' → ')}\nFALLBACK STARTS  ${b.setup.FALLBACK_TIMES.map(friendly).join(' → ')||'None'}\n${b.setup.MAX_SELECTION_ATTEMPTS} candidate attempts · No price ceiling\nPLAYER  Configured ✓`;
  }

  const result=state.selection;byId('selection-result').hidden=!result||!!state.handoff;
  if(result)byId('selection-result').textContent=`SLOTS SELECTED\nCourt ${result.court} · ${result.date}\nHours: ${result.hours.join(', ')} · ${result.hours.length} slots\n₱${result.amount.toLocaleString()} · Proceed READY\n${full?'Selection is not yet a hold. See current checkout stage above.':'AUTOMATION STOPPED BEFORE PROCEED\nUSER CONTROL RESTORED'}`;
  byId('handoff-result').hidden=!state.handoff;
  byId('readiness').className = `readiness ${state.ready ? 'ready' : state.operation === 'observe' ? 'armed' : ''}`;
  status('cdp', state.cdp ? 'Reachable locally' : 'Not connected', state.cdp ? 'good' : 'warn');
  status('lock', state.lock ? (busy ? 'Active' : 'Exists · check manually') : 'Clear', state.lock ? 'warn' : 'good');
  const i = state.inspection;
  const fresh = !!i && state.cdp && Date.now() - Date.parse(i.verifiedAt) < 60000;
  const clock = state.clock;
  byId('release-strategy').textContent = clock ? `Pre-open calendar: ${clock.preopenCalendar ? 'ON' : 'OFF'}\nRelease trigger: ${clock.releaseTime}.000 ${clock.timezone}\nRelease lead: ${clock.leadMs} ms\n${clock.preopenCalendar ? '1. Check already-open target\n2. If enabled: click without refresh\n3. Otherwise: immediate reload fallback' : 'At release: bounded reload, minimal shell, strict target grid'}\nAuto-enable at 08:00: UNVERIFIED` : 'Configuration unavailable';
  byId('next-readiness').textContent = `Chrome/CDP: ${state.cdp ? 'REACHABLE' : 'NOT READY'}\nOnda: ${fresh && i?.gridToday && i.allCourts && i.visible ? 'READY (last inspection)' : 'NEEDS INSPECTION'}\nBooking plan: ${state.booking && !formDirty() ? 'READY' : 'NOT READY'}\nPlayer: ${state.booking?.playerConfigured ? 'READY' : 'NOT READY'}\nPre-open strategy: ${clock ? clock.preopenCalendar ? 'ON' : 'OFF' : 'UNKNOWN'}\nNo existing selections: ${fresh && i?.selected === 0 ? 'YES (last inspection)' : 'NOT VERIFIED'}\nAutomation lock: ${state.lock ? 'BLOCKED' : 'CLEAR'}\nTerms authorization: required per run\nRelease: ${clock ? `${clock.releaseTime} ${clock.timezone}` : 'UNKNOWN'}\nTarget: ${clock?.targetDate ?? 'UNKNOWN'}`;
  if(dual)byId('next-readiness').textContent=`2 courts / SAME TIME BLOCK\n${byId('dual-readiness').textContent}\nBooking plan: ${state.booking&&!formDirty()?'SAVED':'NOT READY'}\nAutomation lock: ${state.lock?'BLOCKED':'CLEAR'}\nTerms authorization: required per run\nRelease: ${clock?`${clock.releaseTime} ${clock.timezone}`:'UNKNOWN'}\nTarget: ${clock?.targetDate??'UNKNOWN'}`;
  const performance=state.releasePerformance,ms=(value:number|null)=>value===null?'N/A':`${value} ms`;
  const workerPerformance=(label:string,p:ReleasePerformance['workers']['A'])=>p?`${label}\nBranch: ${p.branch}\nTrigger → target enabled: ${ms(p.triggerToTargetEnabledMs)}\nTarget enabled → click: ${ms(p.targetEnabledToClickMs)}\nTarget click → grid ready: ${ms(p.targetClickToGridReadyMs)}\nGrid ready → snapshot: ${ms(p.gridReadyToSnapshotCompletedMs)}\nSnapshot → preference: ${ms(p.snapshotToPreferenceResolvedMs)}\n\nSELECTION\nPreference → first click: ${ms(p.preferenceToFirstSlotClickMs)}\nFirst click → last confirmed: ${ms(p.firstSlotClickToLastStateConfirmedMs)}\nLast confirmed → verification: ${ms(p.lastSlotConfirmedToSelectionVerificationMs)}\nVerification → Proceed: ${ms(p.selectionVerificationToBookingProceedMs)}\n\nCHECKOUT\nProceed → Review: ${ms(p.proceedToReviewDetectedMs)}\nReview detect → validate: ${ms(p.reviewDetectedToValidatedMs)}\nReview → Player form: ${ms(p.reviewValidatedToPlayerFormDetectedMs)}\nPlayer form → fill: ${ms(p.playerFormDetectedToFillCompletedMs)}\nFill → player Proceed: ${ms(p.fillCompletedToPlayerProceedMs)}\nPlayer Proceed → Payment: ${ms(p.playerProceedToPaymentSummaryDetectedMs)}\nPayment detect → validate: ${ms(p.paymentSummaryDetectedToValidatedMs)}\nPayment → Terms: ${ms(p.paymentValidatedToTermsControlMs)}\nTerms → checked: ${ms(p.termsControlToTermsCheckedMs)}\nChecked → final actionable: ${ms(p.termsCheckedToFinalButtonActionableMs)}\n\nHANDOFF\nFinal action → click: ${ms(p.finalActionStartedToClickedMs)}\nFinal click → Checkout: ${ms(p.finalClickToCheckoutPageMs)}\nCheckout → hold: ${ms(p.checkoutPageToHoldStatusMs)}\nHold → QR verified: ${ms(p.holdStatusToQrHandoffMs)}\n\nTOTAL\nTrigger → selection: ${ms(p.triggerToSelectionVerifiedMs)}\nTrigger → Proceed: ${ms(p.triggerToBookingProceedMs)}\nTrigger → final click: ${ms(p.triggerToFinalClickMs)}\nTrigger → QR hold: ${ms(p.triggerToQrHandoffMs)}\n\nCounters:\nSelection full-grid reads: ${p.counters.selectionFullGridReads}\nPre-Proceed grid reads: ${p.counters.preProceedGridReads}\nFull guards: ${p.counters.fullGuards}\nLight guards: ${p.counters.lightGuards}\nSlot clicks: ${p.counters.slotClicks}\nSelection summary reads: ${p.counters.selectionSummaryReads}\nReview parses: ${p.counters.reviewParses}\nPayment parses: ${p.counters.paymentSummaryParses}\nTerms acquisitions: ${p.counters.termsControlAcquisitions}`:`${label}\nN/A`;
  const overall=performance?`OVERALL\nTrigger → both selections: ${ms(performance.overall.triggerToBothSelectionsVerifiedMs)}\nTrigger → both final clicks: ${ms(performance.overall.triggerToBothFinalClicksMs)}\nTrigger → both QR holds: ${ms(performance.overall.triggerToBothQrHandoffsMs)}`:'OVERALL\nN/A';
  byId('release-performance').textContent=performance?[workerPerformance('BROWSER A',performance.workers.A),workerPerformance('BROWSER B',performance.workers.B),overall].join('\n\n'):'No release measurements in this session.';
  status('onda', i ? (fresh ? 'Verified' : 'Last inspection') : 'Not inspected', fresh ? 'good' : 'muted');
  status('venue', i ? 'Thirsty Pickle | SM Seaside' : 'Not verified', fresh ? 'good' : 'muted');
  status('filter', i ? (i.allCourts ? 'All Courts' : 'Check in Chrome') : 'Unknown', fresh && i?.allCourts ? 'good' : 'muted');
  status('displayed-date', i?.date ?? 'Unknown', fresh && i?.gridToday ? 'good' : 'warn');
  status('selected', i?.selected === null || !i ? 'Unknown' : String(i.selected), fresh && i?.selected === 0 ? 'good' : 'warn');
  byId('checked-at').textContent = i ? `Checked ${new Date(i.verifiedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila' })}` : 'Not inspected';
  if (state.clock) {
    byId('clock').textContent = state.clock.manilaTime; byId('clock-date').textContent = state.clock.manilaDate;
    byId('clock-source').textContent=state.clock.networkSynced?`${state.clock.clockSource} · offset ${state.clock.clockOffsetMs.toFixed(1)} ms · RTT ${state.clock.clockRoundTripMs?.toFixed(1)??'?'} ms`:'NETWORK CLOCK REQUIRED BEFORE RELEASE';
    const offset=state.booking?.setup.BOOKING_METHOD==='proofless'?state.booking.setup.RELEASE_OFFSET_MS??0:0;
    byId('release-time').textContent = state.clock.releaseTime; byId('release-zone').textContent = state.clock.timezone+(offset?` · release offset ${formatReleaseOffset(offset)}`:'');
    const activePlan = state.operation === 'observe' ? state.plan : null;
    byId('target-date').textContent = dateLabel(['observe','dry','selection','full'].includes(state.operation) && state.plan ? state.plan.targetDate : state.clock.targetDate);
    byId('safe-config').textContent = `Horizon ${state.clock.horizon} days · lead ${state.clock.leadMs} ms · max ${state.clock.maxReloads} reloads`;
  }
  const signature = JSON.stringify(state.logs);
  if (signature !== renderedLogs) {
    renderedLogs = signature; const log = byId('log'); const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
    if (state.logs.length) log.replaceChildren(...state.logs.map(line => {
      const p = document.createElement('div'); p.className = `activity-row ${line.level}`;
      const time = document.createElement('time'); time.textContent = new Date(line.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3 });
      const message=document.createElement('span');message.className='activity-message';message.textContent=line.text;
      const metrics=document.createElement('span');metrics.className='activity-metrics';
      if(line.elapsedMs!==undefined){for(const [label,value] of [['TOTAL',line.elapsedMs],['STEP',Number(line.deltaMs??0)]] as const){const chip=document.createElement('span');chip.className='timing-chip';chip.textContent=`${label} ${(value/1000).toFixed(3)}s`;metrics.append(chip);}}
      p.append(time,message,metrics); return p;
    }));
    if (atBottom) log.scrollTop = log.scrollHeight;
  }
  byId('activity-state').textContent = busy ? `${state.operation.toUpperCase()} · PROCESS ACTIVE` : state.runTiming?.logPath?'TIMING LOG SAVED LOCALLY':'LOCAL PROCESS OUTPUT';
  const history=byId('run-history-list');
  const completed=(state.runHistory??[]).filter(run=>run.readyElapsedMs!==undefined&&!/\bprepare\b/i.test(run.label));
  if(!completed.length)history.replaceChildren(Object.assign(document.createElement('p'),{className:'empty',textContent:'No completed browser-ready runs recorded yet.'}));
  else history.replaceChildren(...completed.map(run=>{
    const row=document.createElement('div');row.className='run-history-item';row.dataset.outcome=run.outcome;
    const summary=document.createElement('button');summary.type='button';summary.className='run-history-toggle';summary.setAttribute('aria-haspopup','dialog');
    const summaryGrid=document.createElement('span');summaryGrid.className='run-summary-grid';
    const label=document.createElement('strong');label.textContent=run.label.replaceAll('·',' / ').toUpperCase();
    const duration=document.createElement('span');duration.className='run-time';duration.textContent=`${(run.readyElapsedMs!/1000).toFixed(3)} seconds`;
    const meta=document.createElement('span');meta.className='run-meta';meta.textContent=`${new Date(run.startedAt).toLocaleString('en-GB',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'medium'})} Manila · ${run.outcome.toUpperCase()} · browser-ready → finish · preparation excluded`;
    const disclosure=document.createElement('span');disclosure.className='run-disclosure';disclosure.textContent='View details';
    summaryGrid.append(label,duration,meta,disclosure);summary.append(summaryGrid);
    summary.onclick=()=>showRunDetail(run);row.append(summary);return row;
  }));
  if(selectedRunId){const selected=completed.find(run=>run.runId===selectedRunId);if(selected)showRunDetail(selected);else closeRunDetail();}
  const previousHolds=state.previousHolds??[];
  byId('previous-holds').hidden=!previousHolds.length;
  // Every log line republishes the state. Rebuilding this list each time reset its scroll
  // position, so an operator could not read older holds while a run was writing output.
  const previousHoldsSignature=JSON.stringify(previousHolds);
  if(previousHoldsSignature!==renderedPreviousHolds){
    renderedPreviousHolds=previousHoldsSignature;
    byId('previous-holds-list').replaceChildren(...previousHolds.map(hold=>{
      const row=document.createElement('div');row.className='previous-hold-item';
      const label=document.createElement('strong');label.textContent=`Run ${hold.runID}`;
      const detail=document.createElement('span');detail.textContent=`Recorded expiry: ${hold.expiresAt?new Date(hold.expiresAt).toLocaleString('en-GB',{timeZone:'Asia/Manila'}):'Unknown'} Manila · Retained ${new Date(hold.archivedAt).toLocaleString('en-GB',{timeZone:'Asia/Manila'})}`;
      row.append(label,detail);return row;
    }));
  }
  byId('mode-label').textContent=workflow==='test'?'TEST NOW':'RELEASE BOOKING';
   byId('prepare').firstChild!.textContent='RESET & PREPARE ';
   const methodValue=workflow==='test'&&input('book-now-exact').checked?'api-first':input('booking-method').value,apiFirst=['api-first','proofless'].includes(methodValue),proofless=methodValue==='proofless';
   byId('test-booking').textContent=proofless?'RUN PROOFLESS TEST TO QR':apiFirst?'RUN API TEST TO QR':'RUN TEST TO QR';
   byId('api-dry-controls').hidden=!apiFirst||workflow!=='test';
   byId('test-availability').hidden=!apiFirst;
   (byId('api-preview') as HTMLButtonElement).disabled=busy||state.lock||!state.apiFirstReady;
  // When Booking Setup owns Next Release, the legacy form never gates or describes the release plan.
  const draftProblem=workflow==='release'&&!hooks.useSavedRelease?.()?bookingSetupProblem(currentSetup()):undefined;
  byId('configuration-status').hidden=workflow!=='release';
  byId('configuration-status').textContent=draftProblem?`CONFIGURATION: NEEDS ATTENTION\n${draftProblem}`:'CONFIGURATION: VALID';
  byId('configuration-status').dataset.tone=draftProblem?'warn':'good';
  const adjustment=releaseAdjustment??state.bookingAdjustment??b?.fallbackReconciliation;
  byId('booking-adjustment').hidden=workflow!=='release'||!adjustment?.removed.length;
  if(adjustment?.removed.length)byId('booking-adjustment').textContent=`BOOKING SETTINGS ADJUSTED\n${adjustment.removed.length} invalid fallback start${adjustment.removed.length===1?' was':'s were'} removed because ${adjustment.removed.length===1?'it no longer fits':'they no longer fit'} the current primary booking.`;
  if(adjustment?.removed.length)byId('booking-adjustment').textContent=`BOOKING SETTINGS ADJUSTED\n${adjustment.removed.length} invalid fallback start${adjustment.removed.length===1?' was':'s were'} removed.\nRemoved:\n${adjustment.removed.map(r=>`${friendly(r.time)} - ${r.reason==='CROSSES_MIDNIGHT'?`${Number(input('duration').value)} hours would end after midnight`:r.reason==='DUPLICATES_PRIMARY_START'?'duplicates the primary start':r.reason==='DUPLICATE_FALLBACK'?'duplicate fallback':'invalid time'}`).join('\n')}\nPrimary booking unchanged:\n${friendly(input('start-time').value)} -> ${endFriendly(input('start-time').value,Number(input('duration').value))}`;
  input('prepare').disabled=['prepare','stopping','saving','resetting'].includes(state.operation)||!!draftProblem;
  byId('arm').textContent=armed?'CANCEL ARMED RELEASE':'ARM NEXT RELEASE';byId('arm').hidden=workflow==='test';
  byId('test-booking').hidden=workflow==='release';byId('test-date-label').hidden=workflow==='release';
  input('test-booking').disabled=busy||formDirty()||state.lock||!state.ready||!input('terms').checked;
  input('terms').disabled=armed||busy||formDirty()||state.lock||!state.ready;
  byId('terms').parentElement!.lastChild!.textContent=workflow==='test'?' I authorize accepting Onda Terms for this booking':' I authorize accepting Onda Terms for this booking';
  if(workflow==='release'&&armed)byId('terms').parentElement!.lastChild!.textContent=' AUTHORIZED FOR THIS EXACT SCHEDULED RUN';
  byId('workflow-test').setAttribute('aria-pressed',String(workflow==='test'));byId('workflow-release').setAttribute('aria-pressed',String(workflow==='release'));
  input('workflow-test').disabled=busy;input('workflow-release').disabled=busy;
  input('save-booking').disabled=busy||workflow==='test';
   if(workflow==='release'){input('arm').disabled ||= formDirty()||!state.ready||!input('terms').checked||!state.clock?.networkSynced||(!apiFirst&&!fullReady);byId('blocked-reason').textContent=state.lock?'RESET REQUIRED':formDirty()?'SETTINGS CHANGED · Press Reset & Prepare.':!state.clock?.networkSynced?'Sync with Google Time before arming.':!state.ready?'Reset & Prepare before arming.':!input('terms').checked?'Authorize Terms, then Arm Next Release.':'';}
  if(workflow==='test')byId('blocked-reason').textContent=state.lock?'RESET REQUIRED':formDirty()?'SETTINGS CHANGED · Press Reset & Prepare.':!state.ready?'Reset & Prepare before running a test.':!input('terms').checked?'Authorize Terms, then run your test.':'';
  if(workflow==='release'&&armed){input('arm').disabled=false;byId('blocked-reason').textContent='';}
  if(apiRelease)byId('blocked-reason').textContent='';
  if(state.bookingResult){byId('handoff-result').hidden=false;byId('handoff-result').textContent=state.bookingResult.description+'\n'+state.bookingResult.outcomes.map((v,i)=>`Checkout ${i+1}: ${v}`).join('\n');}
   const duration=Number(input('duration').value),start=Number(input('start-time').value.slice(0,2)),strategy=input('booking-type').value;
  const count=Number(input('court-count').value),releaseText=state.clock?new Date(state.clock.releaseMs).toLocaleString('en-US',{timeZone:state.clock.timezone,month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'Calculating';
   const method=input('booking-method').value==='browser'?'NORMAL BROWSER':input('booking-method').value==='hybrid'?'HYBRID AVAILABILITY':proofless?'PROOFLESS DIRECT':'API-FIRST · WITH PROOFS';
   const workers=workflow==='release'?neededWorkers():requiredWorkers(strategy,count),checkoutCount=workers.length;
    byId('booking-preview').textContent=`${workflow==='release'?`RELEASE PLAN\nRelease: ${releaseText}\nTarget: ${state.clock?dateLabel(state.clock.targetDate):'Not configured'}\n`:''}${method}\n${strategy.toUpperCase()} | ${count} COURT${count===1?'':'S'}\n${friendly(input('start-time').value)} -> ${endFriendly(input('start-time').value,duration)} | ${duration} hours\nFallback starts: ${fallbackTimes.map(friendly).join(' -> ')||'None'}\nCourt priority: ${courtOrder.join(' -> ')}\n${strategy==='extended'?`Extended split: ${duration===4?'3h + 1h (alternatives 2h + 2h, 1h + 3h)':duration===5?'3h + 2h (alternative 2h + 3h)':'3h + 3h'}\n`:''}${workers.length} browser${workers.length===1?'':'s'} | ${checkoutCount} checkout${checkoutCount===1?'':'s'} | Players: ${workers.join(' + ')}\nNo price ceiling\nAttempts: ${input('attempts').value} | Payment: MANUAL${proofless?'\nProofless Direct: Reset & Prepare audits all court/hour blocks; the armed run refreshes them at 7:30, selects the first unblocked saved fallback, and submits without availability proofs. Proofless tests require your manual confirmation that the exact cells are open.':input('booking-method').value==='api-first'?'\nAPI first: availability and fresh per-hour proofs are acquired before checkout.':''}`;
  if(duration>6){byId('booking-preview').textContent='Extended booking supports up to 6 consecutive hours.';input('test-booking').disabled=true;input('arm').disabled=true;}
   const runWorkers=requiredWorkers(strategy,count),playerReadyByWorker={A:playerStatus.primary,B:playerStatus.extended,C:playerStatus.third,D:playerStatus.fourth,E:playerStatus.fifth,F:playerStatus.sixth,G:playerStatus.seventh,H:playerStatus.eighth};
  const playersReady=runWorkers.every(worker=>playerReadyByWorker[worker]);
   byId('player-status').textContent=runWorkers.map(worker=>`${workerLabel(worker)}: ${playerReadyByWorker[worker]?'Configured':'Missing'}`).join(' | ');
  const profile=(label:string,p?:{fullName:string;phone:string;email:string})=>{const card=document.createElement('div');const heading=document.createElement('strong');heading.textContent=label;card.append(heading,document.createElement('br'),document.createTextNode(p?`${p.fullName}\n${p.phone}\n${p.email}`:'Missing or invalid configuration'));card.style.whiteSpace='pre-line';return card;};
   const profiles={A:playerStatus.primaryDetails,B:playerStatus.extendedDetails,C:playerStatus.thirdDetails,D:playerStatus.fourthDetails,E:playerStatus.fifthDetails,F:playerStatus.sixthDetails,G:playerStatus.seventhDetails,H:playerStatus.eighthDetails};
   byId('player-details').replaceChildren(...runWorkers.map(worker=>profile(`${workerLabel(worker)} · Checkout ${worker}`,profiles[worker])));
  input('test-booking').disabled ||= !playersReady;input('arm').disabled ||= !playersReady;
  const releaseMode=workflow==='release';byId('release-schedule').hidden=!releaseMode;byId('release-readiness-card').hidden=!releaseMode;
  renderBrowsers(state,busy);
  if(!input('block-audit-date').value&&state.clock?.targetDate)input('block-audit-date').value=state.clock.targetDate;
  const blockAuditDate=input('block-audit-date').value;
  (byId('check-release-blocks') as HTMLButtonElement).disabled=busy||!blockAuditDate;
  const audit=state.blockAudit?.date===blockAuditDate?state.blockAudit:null;
  renderBlockAudit(byId('block-audit-result'),audit,blockAuditDate);
  if(releaseMode&&state.clock){
    byId('release-passed').textContent=state.clock.todayReleasePassed?`TODAY'S ${friendly(state.clock.releaseTime.slice(0,5))} RELEASE HAS PASSED`:'';
    const release=state.scheduledRelease??apiRelease;
    byId('next-release').textContent=new Date(release?.releaseMs??state.clock.releaseMs).toLocaleString('en-US',{timeZone:state.clock.timezone,month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
    byId('next-target').textContent=dateLabel(release?.targetDate??state.clock.targetDate);
    const finalAt=(release?.releaseMs??state.clock.releaseMs)-state.clock.preflightSecondsBefore*1000;
    byId('schedule-meta').textContent=`Final preflight: ${new Date(finalAt).toLocaleTimeString('en-US',{timeZone:state.clock.timezone,hour:'numeric',minute:'2-digit',second:'2-digit'})} | System: ${apiRelease?{PREPARING:'ARMED · PREPARING',WAITING:'WAITING FOR RELEASE',RUNNING:'RUNNING',FAILED:'NEEDS ATTENTION'}[apiRelease.phase]:state.scheduleStatus??(armed?'WAITING':'NOT ARMED')}`;
  }
  const apiPrepared=!!state.apiFirstReady&&!!state.ready&&!!state.booking&&['api-first','proofless'].includes(state.booking.setup.BOOKING_METHOD)&&!state.lock&&state.preparedPlanFingerprint===state.booking.fingerprint;
  const prepared=apiPrepared||!!state.preparedContext&&state.preparedContext.workflow==='release'&&state.preparedContext.configFingerprint===state.booking?.fingerprint;
   const required=workflow==='release'?neededWorkers():requiredWorkers(strategy,count);
  const verificationGates:Gate[]=apiFirst
    ? [['Onda venue verified',apiPrepared],[proofless?'Court/hour block audit complete':'Availability checked',proofless?state.assumedPrice!==undefined&&state.assumedPrice!==null:state.apiStage?.stage==='CANDIDATE_READY'||!!state.observedPrice]]
    : [['Onda verified',prepared],['All Courts verified',prepared],['Selected slots: 0',prepared],['Payment holds: none',prepared&&!state.lock]];
  const gates:Gate[]=[['Configuration valid',!draftProblem],['Google network clock synchronized',!!state.clock?.networkSynced],['Next release calculated',!!state.clock],['Booking target calculated',!!state.clock?.targetDate],...required.map(id=>[`${workerLabel(id)} configured`,!!playerReadyByWorker[id]] as [string,boolean]),...required.map(id=>[`Browser ${id} prepared`,apiFirst?apiPrepared&&!!state.browserHealth?.[id]:prepared&&!!state.preparedContext?.browsers.some(b=>b.id===id)] as [string,boolean]),...verificationGates,['Automation lock clear',!state.lock],['Prepared fingerprint matches',prepared],['Terms authorized for this run',state.termsAuthorized||armed],
    ...(apiFirst?[manifestGate(state,state.scheduledRelease?.releaseMs??apiRelease?.releaseMs??state.clock?.releaseMs)]:[]),['Armed for next release',armed||!!apiRelease||state.apiStage?.stage==='WAITING_FOR_RELEASE']];
  if(apiRelease){
    for(const gate of gates){
      if(gate[0]==='Terms authorized for this run')gate[1]=true;
      if(gate[0]==='Automation lock clear'){gate[0]='Active release owns automation lock';gate[1]=true;}
    }
  }
  byId('release-readiness').replaceChildren(...gateRows(gates));
  byId('release-readiness-card').dataset.state=armed||apiRelease?'armed':prepared?'prepared':'draft';byId('sleep-warning').hidden=!armed&&!apiRelease;byId('sleep-warning').textContent=`Sleep protection: ${state.sleepProtection?'ACTIVE':'NOT AVAILABLE'} | Keep the PC powered on. Do not hibernate or close the laptop lid if Windows sleeps on lid close.`;
   const savedSetup=state.booking?.setup;
   if(savedSetup?.RELEASE_STRATEGY==='precision'){
     const p=savedSetup.PRECISION_PHASE3;
     byId('saved-plan-summary').textContent=p?smartSavedSummary(p,state.booking!.targetDate):
       `PRECISION RELEASE · GOAL: 1 COURT · PROOFLESS DIRECT\n${savedSetup.PRECISION_TARGETS.map((t,i)=>`Worker ${PRECISION_WORKERS[i]} · Court ${t.court} · ${friendly(t.start)}–${endFriendly(t.start,t.durationHours)} · ${t.durationHours} h`).join('\n')}\nIndependent attempts: more than one temporary QR hold may be created. Payment remains manual.\nTarget: ${dateLabel(state.booking!.targetDate)}`;
   }
   else byId('saved-plan-summary').textContent=state.booking?(`${state.booking.setup.BOOKING_METHOD.toUpperCase()} · ${state.booking.setup.BOOKING_TYPE.toUpperCase()} · ${state.booking.setup.COURT_COUNT} court${state.booking.setup.COURT_COUNT===1?'':'s'}\n${friendly(state.booking.setup.START_TIME)}–${endFriendly(state.booking.setup.START_TIME,state.booking.setup.DURATION_HOURS)} · ${state.booking.setup.DURATION_HOURS} hours\nCourt priority: ${state.booking.setup.PREFERRED_COURTS.join(' → ')}\nFallback starts: ${state.booking.setup.FALLBACK_TIMES.map(friendly).join(', ')||'None'}\nTarget: ${dateLabel(state.booking.targetDate)}`):'No saved plan available.';
  const actualAmount=state.handoff?.amount??state.observedPrice??state.selection?.amount;
   byId('observed-price').hidden=(actualAmount===undefined||actualAmount===null)&&(state.assumedPrice===undefined||state.assumedPrice===null);
   byId('observed-price').textContent=[actualAmount!==undefined&&actualAmount!==null?`Observed booking price: ₱${actualAmount.toLocaleString()} · Review the amount in Onda before final booking authorization.`:'',
     state.assumedPrice!==undefined&&state.assumedPrice!==null?`Proofless estimated total: ₱${state.assumedPrice.toLocaleString()} · UNVERIFIED prior-rate assumption; the actual price may differ.`:'',
     'Payment stays manual.'].filter(Boolean).join('\n');
  const action=input('main-action'),hold=!!state.handoff||!!state.lock,blockedHold=hold&&!state.canPrepareOverHold;
  const apiWaiting=state.operation==='full'&&state.apiStage?.stage==='WAITING_FOR_RELEASE';
  const actionState=apiRelease||apiWaiting?'armed':busy?'running':blockedHold?'hold':armed?'armed':state.ready&&!formDirty()?'review':'prepare';
  action.textContent=actionState==='prepare'&&unresolvedCheckout?'Reset & Prepare':actionState==='prepare'&&state.canPrepareOverHold?'Prepare New Run':{hold:'Review Hold',running:'Preparing…',armed:'Emergency Stop',review:'Authorize and Arm',prepare:'Prepare'}[actionState];
  action.disabled=actionState==='running'||actionState==='prepare'&&!!input('prepare').disabled;
  byId('release-action-title').textContent=actionState==='armed'?'Armed':actionState==='running'?'Preparing browsers and release contexts…':actionState==='review'?'Ready to arm':'Prepare for release';
  byId('main-action-hint').textContent=unresolvedCheckout?'Inspects every required browser; it will not clear the lock unless the old worker is dead and all Onda state is clean.':state.canPrepareOverHold?'The verified hold stays recorded. Prepare a fresh schedule in the same bot before another run.':blockedHold?'Review the retained lock before any new action.':actionState==='review'?'Authorize Terms for this exact saved strategy, then arm.':actionState==='armed'?'Release is scheduled. Emergency Stop cancels the armed release.':actionState==='running'?'Preparing the required browsers. Wait for readiness to finish.':'Check the saved strategy, then prepare its required browsers.';
  input('terms').parentElement!.hidden=currentView==='release'?actionState!=='review':false;
  if(state.booking?.setup.STRATEGY_V2?.shotgun?.enabled&&!apiRelease)byId('main-action-hint').textContent='Live Shotgun pilot: arming checks browser and timing readiness, then requires owner attestation for this exact plan. Payment stays manual.';
  if(apiRelease)byId('main-action-hint').textContent='The authorized release runner is active. Emergency Stop cancels it; child preparation is reported separately.';
  renderReleasePreflight(state);
  byId('primary-actions').hidden=currentView!=='tests'&&!state.selection&&!state.handoff&&!state.bookingResult;
  // Booking Setup owns Available Now: its current checkout step supplies the date.
  const testDate=String(hooks.testRequest?.()?.request.date??input('test-date').value);
  input('test-date').disabled=busy;
  const testPrepared=!!state.ready&&!testDirty&&state.workflow==='test'&&!!b&&(
    (input('book-now-exact').checked||input('test-wing').value==='BUKO'||['api-first','proofless'].includes(b.setup.BOOKING_METHOD))&&!!state.apiFirstReady ||
    !!state.preparedContext&&state.preparedContext.workflow==='test'&&state.preparedContext.date===testDate);
  const testBrowsers=input('book-now-exact').checked||input('test-wing').value==='BUKO'?['A'] as WorkerId[]:b?requiredWorkers(b.setup.BOOKING_TYPE,b.setup.COURT_COUNT):['A'] as WorkerId[];
  const testGates:[string,boolean][]=[
    ['Target date selected',!!testDate],['Booking preferences available',!!b],...testBrowsers.map(id=>[`${workerLabel(id)} configured`,!!playerReadyByWorker[id]] as [string,boolean]),
    ...testBrowsers.map(id=>[`Browser ${id} prepared`,testPrepared&&!!state.browserHealth?.[id]] as [string,boolean]),
    ['Automation lock clear',!state.lock],['Preparation matches this date and plan',testPrepared],
    ['Terms authorized for this booking',!!state.termsAuthorized]
  ];
  byId('test-readiness').replaceChildren(...gateRows(testGates));
   byId('test-buko-court-label').hidden=false;
   for(const option of (byId('test-buko-court') as HTMLSelectElement).options)option.textContent=`${input('test-wing').value==='BUKO'?'Buko':'Mango'} · Court ${option.value}`;
   byId('test-plan-summary').textContent=b?`${b.setup.BOOKING_METHOD.toUpperCase()} · ${b.setup.BOOKING_TYPE.toUpperCase()} · ${b.setup.COURT_COUNT} court${b.setup.COURT_COUNT===1?'':'s'}\n${friendly(b.setup.START_TIME)}–${endFriendly(b.setup.START_TIME,b.setup.DURATION_HOURS)} · ${b.setup.DURATION_HOURS} hours\nCourt priority: ${b.setup.PREFERRED_COURTS.join(' → ')}\nFallback starts: ${b.setup.FALLBACK_TIMES.map(friendly).join(', ')||'None'}\nTest date: ${testDate?dateLabel(testDate):'Choose a date'}${input('exact-a').value.trim()||input('exact-b').value.trim()?`\nAdvanced exact court override: ${[input('exact-a').value,input('exact-b').value].filter(Boolean).join(' / ')}`:''}`:'No saved booking plan available.';
  const liveTestHandoffs=workflow==='test'&&state.workflow==='test'?activeHandoffs(state):[];
  const readyTestHandoffs=liveTestHandoffs.filter(hold=>(hold.status??'qr-ready')==='qr-ready').length;
  const expectedTestHandoffs=Math.max(testBrowsers.length,liveTestHandoffs.length);
  byId('test-headline').textContent=liveTestHandoffs.length
    ? readyTestHandoffs===expectedTestHandoffs?'CONFIRM BOOKING DETAILS BEFORE PAYING':`CHECKOUTS REACHING QR · ${readyTestHandoffs}/${expectedTestHandoffs}`
    : workflow==='test'&&state.workflow==='test'?state.headline:state.lock?'Review retained hold':testPrepared?'Ready to review':'Prepare your browser';
   const baseTestDetail=liveTestHandoffs.length
     ? `${readyTestHandoffs} of ${expectedTestHandoffs} required QR page${expectedTestHandoffs===1?' is':'s are'} verified. Check the player, courts, date, every hourly slot, amount, and booking reference below before scanning any QR code.`
     : workflow==='test'&&state.workflow==='test'?state.detail:state.lock?'Review the existing browser and payment hold before testing again.':testPrepared?'Review Terms, then run the saved plan.':'Choose a date, then prepare the saved booking plan.';
  byId('test-detail').textContent=baseTestDetail;
  const testState=busy?'running':blockedHold?'hold':testPrepared?'review':'prepare';
  const testButton=input('test-main-action');
  testButton.textContent=testState==='prepare'&&unresolvedCheckout?'Reset & Prepare':testState==='prepare'&&state.canPrepareOverHold?'Prepare New Run':{running:'Running',hold:'Review Hold',review:'Authorize and Book to QR',prepare:'Prepare'}[testState];
   if(input('test-wing').value==='BUKO')byId('test-plan-summary').textContent=`Buko Wing · Court ${input('test-buko-court').value} · Normal booking\n${testDate?dateLabel(testDate):'Choose a date'} · ${b?friendly(b.setup.START_TIME):''} · ${b?.setup.DURATION_HOURS??'?'} hour(s)\nAvailability is checked in your dedicated Chrome before submission.\nExact court and time; no fallback substitution. Stops at QR.\nScheduled releases and Shotgun are disabled for Buko.${b&&b.setup.DURATION_HOURS>3?'\nChoose a duration of 1–3 hours in Strategy.':''}`;
   if(input('book-now-exact').checked)byId('test-plan-summary').textContent=`${input('test-wing').value==='BUKO'?'Buko':'Mango'} · Court ${input('test-buko-court').value} · ${testDate||'Choose a date'}\n${friendly(input('book-now-start').value)} · ${input('book-now-duration').value} hour(s) · One exact court\nNormal · fresh proofs · no alternatives · stops at genuine QR · manual payment`;
   testButton.disabled=testState==='running'||testState==='prepare'&&(!b||!testDate||blockedHold||!input('book-now-exact').checked&&input('test-wing').value==='BUKO'&&b.setup.DURATION_HOURS>3);
   byId('test-main-action-hint').textContent=unresolvedCheckout?'Inspects both API browsers and clears the retained safety lock only after clean-state verification.':state.canPrepareOverHold?'The verified hold stays recorded. Preparing opens a fresh schedule in the same bot.':blockedHold?'Review the retained lock before another test.':testState==='review'?'This test can create real temporary payment holds. Review Terms and confirm the test before continuing.':testState==='running'?'The current test is in progress.':'Prepare the required browser or browsers for the selected date.';
  testResults.hidden=!!byId('observed-price').hidden&&!!byId('selection-result').hidden&&!!byId('handoff-result').hidden;
   syncViableControls();tick();
}
byId('main-action').onclick=()=>{if(!latest)return;if(hooks.primaryAction?.())return;if(latest.operation==='full'&&(latest.activeApiRelease||latest.apiStage?.stage==='WAITING_FOR_RELEASE')){void window.thirsty.abortAutomation().catch(()=>{});return;}if(latest.scheduledRelease){input('arm').click();return;}if((latest.lock||latest.handoff)&&!latest.canPrepareOverHold){void window.thirsty.reviewLock().catch(()=>{});return;}if(latest.ready&&!dirty){if(input('terms').checked)input('arm').click();else byId('terms').focus();}else input('prepare').click();};
byId('test-main-action').onclick=()=>{if(!latest)return;if((latest.lock||latest.handoff)&&!latest.canPrepareOverHold){void window.thirsty.reviewLock().catch(()=>{});return;}if(input('test-main-action').textContent==='Authorize and Book to QR'){if(input('terms').checked)input('test-booking').click();else byId('terms').focus();}else input('prepare').click();};
function tick() {
  // Display only; never launches a command. Authoritative release plan comes from main/CLI.
  const effectiveNow=Date.now()+(latest?.clock?.clockOffsetMs??0);
  if(latest?.booking?.setup.STRATEGY_V2?.shotgun?.enabled && latest.activeApiRelease && shotgunCriticalInterval(latest.activeApiRelease.releaseMs,effectiveNow))return;
  const now=new Date(effectiveNow);
  byId('clock').textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Manila', hourCycle: 'h23' }).format(now);
  byId('clock-date').textContent = new Intl.DateTimeFormat('en-US', { weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'Asia/Manila' }).format(now);
  byId('status-clock').textContent = byId('clock').textContent;
  if (!latest) return;
  renderQrSummary(latest);
  byId('run-timing').textContent=latest.runTiming?.readyAt?`${((latest.runTiming.endedAt?latest.runTiming.readyElapsedMs??0:Math.max(0,Date.now()-Date.parse(latest.runTiming.readyAt)))/1000).toFixed(3)} seconds · ${latest.runTiming.endedAt?'finished':'running'}`:latest.runTiming?'Waiting for browser ready':'No browser-ready run active';
  if(latest.runTiming&&(!latest.runTiming.endedAt||latest.runTiming.readyAt)){
    const run=latest.runTiming;
    if(!run.readyAt){byId('countdown').textContent='--:--:--.---';byId('countdown-label').textContent=run.endedAt?'READY TIMING UNAVAILABLE':`${run.label.toUpperCase()} · WAITING FOR BROWSER`;byId('release-time').textContent='Timing starts when browser is ready';byId('release-zone').textContent='startup excluded';return;}
    const readyKey=`${run.runId}:${run.readyAt}`;
    if(timingReadyKey!==readyKey){timingReadyKey=readyKey;timingReadyStartedMono=performance.now();timingReadyInitialMs=Math.max(0,Date.now()-Date.parse(run.readyAt));}
    const elapsed=run.endedAt?run.readyElapsedMs??0:Math.max(0,timingReadyInitialMs+performance.now()-timingReadyStartedMono);
    const seconds=Math.floor(elapsed/1000);
    byId('countdown').textContent=`${[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(v=>String(v).padStart(2,'0')).join(':')}.${String(Math.floor(elapsed%1000)).padStart(3,'0')}`;
    byId('countdown-label').textContent=run.endedAt?'LAST RUN · BROWSER READY → FINISH':`${run.label.toUpperCase()} · BROWSER READY`;
    byId('release-time').textContent=`${(elapsed/1000).toFixed(3)} seconds`;
    byId('release-zone').textContent=`${Math.round(elapsed)} milliseconds · preparation excluded`;
    return;
  }
  if (!latest.clock) return;
  const release = latest.scheduledRelease?.releaseMs??latest.activeApiRelease?.releaseMs??(latest.plan && ['observe','dry','selection','full'].includes(latest.operation) ? latest.plan.releaseMs : latest.clock.releaseMs);
  const seconds = Math.max(0, Math.ceil((release - effectiveNow) / 1000));
  byId('countdown').textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(v => String(v).padStart(2, '0')).join(':');
  byId('countdown-label').textContent = latest.operation === 'observe' ? 'SCHEDULED RELEASE IN' : 'NEXT RELEASE IN';
  const hold=latest.bookingResult?null:latest.handoff;
  if(hold){
    const [m,s]=hold.countdown.split(':').map(Number);const elapsed=(Date.now()-Date.parse(hold.verifiedAt))/1000;const active=elapsed<m!*60+s!;
    byId('handoff-result').textContent=`${active?'PAYMENT HOLD ACTIVE — VERIFIED AT HANDOFF':'HOLD NEEDS MANUAL REVIEW'}\nVenue: Thirsty Pickle | SM Seaside\nCourt ${hold.court} · ${hold.date}\nTime: ${hold.hours[0]}–${String(Number(hold.hours.at(-1)!.slice(0,2))+1).padStart(2,'0')}:00\nAmount: ₱${hold.amount.toLocaleString()}\nLast observed status: Pending\nHold countdown at verification: ${hold.countdown}\nVerified: ${new Date(hold.verifiedAt).toLocaleString('en-GB',{timeZone:'Asia/Manila'})}\n${active?'Complete payment manually in Chrome.':'The observed countdown has elapsed. Check Chrome manually.'}\nAUTOMATION STOPPED · AUTOMATION LOCK RETAINED`;
  }
}
 for (const [id, action] of Object.entries({ 'sync-clock':()=>window.thirsty.syncClock(),'review-lock':()=>window.thirsty.reviewLock(),'clear-lock':()=>window.thirsty.clearLock(),'reset-practice':()=>window.thirsty.resetPractice(),'dual-prepare':()=>window.thirsty.prepareDual(),'api-preview':()=>window.thirsty.apiPreview(input('test-date').value),'full-practice':async()=>{const authorized=input('full-terms').checked;input('full-terms').checked=false;await window.thirsty.runFullPractice({target:{date:input('full-date').value,court:Number(input('full-court').value),start:input('full-start').value,duration:Number(input('full-duration').value)},authorizeTerms:authorized as true});}, chrome: () => window.thirsty.startChrome(), inspect: () => window.thirsty.inspectOnda(), prepare: async () => {input('terms').checked=false;storeDraft();const releaseOverride=workflow==='release'?hooks.releaseSetup?.():null;
    // Booking Setup (Next Release) prepares exactly the saved authorization; the legacy form is never substituted.
    const savedOnly=workflow==='release'&&!!hooks.useSavedRelease?.()&&!!latest?.booking;
    await window.thirsty.resetPrepare(workflow==='test'?{workflow:'test',...testRequest()}:savedOnly?{workflow:'release',strategy:latest!.booking!.setup.BOOKING_TYPE}:{workflow:'release',strategy:releaseOverride?'standard':input('booking-type').value as 'standard'|'extended',setup:releaseOverride??currentSetup()});const state=await window.thirsty.getStatus();if(state.ready){if(workflow==='test')testDirty=false;else releaseDirty=false;dirty=false;}render(state);}, arm: () => window.thirsty.armFullBooking(), dry:()=>window.thirsty.dryRace(), observe:()=>window.thirsty.armObservation(), stop: () => window.thirsty.abortAutomation(), practice:()=>window.thirsty.runPractice({date:input('practice-date').value,court:Number(input('practice-court').value),start:input('practice-start').value,duration:Number(input('practice-duration').value)}) })) {
  byId(id).addEventListener('click', () => { void action().catch(async() => { render(await window.thirsty.getStatus()); }); });
 }
byId('check-release-blocks').addEventListener('click',()=>{void window.thirsty.checkReleaseBlocks(input('block-audit-date').value).catch(async()=>{render(await window.thirsty.getStatus());});});
for(const id of ['close-browsers','close-browsers-tools'])byId(id).addEventListener('click',()=>{void window.thirsty.closeBotBrowsers().catch(async()=>{render(await window.thirsty.getStatus());});});
byId('watch-next-release').addEventListener('click',()=>{selectWatch(undefined);void window.thirsty.watchNextRelease().catch(async()=>{render(await window.thirsty.getStatus());});});
for(const button of document.querySelectorAll<HTMLButtonElement>('#slot-matrix-mode button'))button.addEventListener('click',()=>{setSlotMatrixMode(button.dataset.mode==='first'?'first':'current');if(latest)render(latest);});
byId('stop-slot-watch').addEventListener('click',()=>{void window.thirsty.stopSlotWatch().catch(async()=>{render(await window.thirsty.getStatus());});});
byId('status-watch').addEventListener('click',()=>{selectWatch(undefined);showView('live');});
initSlotWatchView({rerender:()=>{if(latest)render(latest);}});
byId('block-audit-date').addEventListener('change',()=>{if(latest)render(latest);});
byId('full-terms').addEventListener('change',()=>{if(latest)render(latest);});
for(const id of ['full-date','full-court','full-start','full-duration'])byId(id).addEventListener('change',()=>{input('full-terms').checked=false;if(latest)render(latest);});
byId('mode-full').addEventListener('change',()=>{void window.thirsty.setMode('full').catch(()=>{});});
byId('mode-selection').addEventListener('change',()=>{void window.thirsty.setMode('selection').catch(()=>{});});
byId('terms').addEventListener('change',()=>{void window.thirsty.authorizeTerms(input('terms').checked).catch(()=>{input('terms').checked=false;});});
 for(const id of ['book-now-start','book-now-duration','book-now-exact','test-wing','test-buko-court','booking-method','test-date','court-count','start-time','duration','attempts','exact-a','exact-b'])byId(id).addEventListener('change',changed);
byId('booking-method').addEventListener('change',()=>{byId('release-offset').hidden=!releaseOffsetApplies();});
byId('release-offset-ms').addEventListener('change',changed);
for(const id of ['precision-strategy','precision-count',...PRECISION_WORKERS.map((_,i)=>i).flatMap(i=>[`precision-court-${i}`,`precision-start-${i}`,`precision-duration-${i}`,`precision-width-${i}`])])
  byId(id).addEventListener('change',()=>{syncStrategy();changed();});
byId('precision-fan-out').addEventListener('change',()=>{syncStrategy();changed();});
for(const id of ['precision-mode-fixed','precision-mode-smart'])byId(id).addEventListener('change',()=>{
  precisionMode=input('precision-mode-smart').checked?'smart':'fixed';
  // Switching an empty Smart plan on starts from the fixed attempts already on screen.
  if(precisionMode==='smart'&&!smartDraft.immediate.length&&!smartDraft.backups.length)smartDraft.immediate=precisionRows().map(row=>({...row}));
  syncStrategy();renderSmart(true);changed();});
byId('booking-type').addEventListener('change',()=>{const extended=input('booking-type').value==='extended',d=Number(input('duration').value);if(extended&&d<4)input('duration').value='4';if(!extended&&d>3)input('duration').value='3';syncViableControls();changed();});
byId('add-fallback').onclick=()=>{const h=input('fallback-time').value;if(h===input('start-time').value||fallbackTimes.includes(h)){byId('edit-status').textContent='Choose a different fallback start.';return;}if(workflow==='release'){const reconciliation=reconcileFallbackTimes(input('start-time').value,Number(input('duration').value),[...fallbackTimes,h]);if(reconciliation.removed.length){releaseAdjustment=reconciliation;byId('edit-status').textContent=bookingSetupProblem({...currentSetup(),FALLBACK_TIMES:[...fallbackTimes,h]})??'That fallback does not fit the current booking.';if(latest)render(latest);return;}}fallbackTimes.push(h);editors();changed();};
async function saveBookingPlan():Promise<boolean>{
  if(precisionSelected()&&precisionMode==='smart'){const compiled=smartCompiled();if(!compiled.phase3||compiled.problems.length){byId('edit-status').textContent=compiled.problems[0]??'Resolve the Smart backups items first.';renderSmart(true);return false;}}
   const setup:BookingSetup={...strategyFields(),RELEASE_OFFSET_MS:releaseOffsetValue(),BOOKING_METHOD:input('booking-method').value as 'browser'|'hybrid'|'api-first'|'proofless',BOOKING_TYPE:input('booking-type').value as 'standard'|'extended',COURT_COUNT:Number(input('court-count').value) as CourtCount,START_TIME:input('start-time').value,DURATION_HOURS:Number(input('duration').value),PREFERRED_COURTS:courtOrder,FALLBACK_COURTS:[],FALLBACK_TIMES:fallbackTimes,MAX_SELECTION_ATTEMPTS:Number(input('attempts').value)};
  const savedStrategyKey=strategySaveSnapshot();
  await window.thirsty.saveBooking(setup);const state=await window.thirsty.getStatus();
  if(strategySaveSnapshot()!==savedStrategyKey){byId('edit-status').textContent='Draft changed while saving. Review and save again.';render(state);return false;}
  if(state.headline==='Booking plan saved'){releaseDirty=false;if(workflow==='release')dirty=false;loadedPlan='';byId('edit-status').textContent='BOOKING PLAN SAVED';strategySaved(savedStrategyKey);render(state);strategySaved(strategySaveSnapshot());renderStrategy(state);return true;}else byId('edit-status').textContent='Plan rejected. Check duration and unique times.';
  return false;
}
byId('save-booking').onclick=()=>{void saveBookingPlan().catch(()=>{byId('edit-status').textContent='Could not save booking setup.';});};
byId('dual-dry').onclick=()=>{void window.thirsty.runDualPractice({kind:'dualDry',date:input('dual-date').value}).catch(()=>{});};
for(const [id,kind] of [['dual-selection','dualPractice'],['dual-full','dualFullPractice']] as const)byId(id).onclick=()=>{
  const authorized=input('dual-terms').checked;input('dual-terms').checked=false;
  void window.thirsty.runDualPractice({kind,input:{target:{date:input('dual-date').value,court:Number(input('dual-court-a').value),start:input('dual-start').value,duration:Number(input('dual-duration').value)},courtB:Number(input('dual-court-b').value),noncompetitive:input('dual-noncompetitive').checked as true,authorizeTerms:kind==='dualFullPractice'&&authorized,armed:kind==='dualFullPractice'}}).catch(()=>{});
};
for(const id of ['dual-date','dual-court-a','dual-court-b','dual-start','dual-duration','dual-noncompetitive'])byId(id).addEventListener('change',()=>{input('dual-terms').checked=false;if(latest)render(latest);});
byId('dual-terms').addEventListener('change',()=>{if(latest)render(latest);});

for(const [id,mode] of [['workflow-test','test'],['workflow-release','release']] as const)byId(id).onclick=()=>{storeDraft();workflow=mode;if(mode==='test'&&testDraft)applyDraft(testDraft);if(mode==='release'&&releaseDraft)applyDraft(releaseDraft);dirty=mode==='test'?testDirty:releaseDirty;input('terms').checked=false;void window.thirsty.setWorkflow(mode);if(latest)render(latest);};
function testRequest(){
  // Booking Setup owns Available Now: Prepare and Book use exactly its current checkout step.
  const override=hooks.testRequest?.();
  if(override)return override as {method:'browser'|'hybrid'|'api-first'|'proofless';request:Parameters<typeof window.thirsty.testBooking>[0]['request']};
  const setup=latest?.booking?.setup;
  if(!setup)throw Error('BOOKING_PLAN_MISSING');
  if(input('book-now-exact').checked){
    const wing=input('test-wing').value as 'MANGO'|'BUKO',court=Number(input('test-buko-court').value);
    return {method:'api-first' as const,request:{wing,strategy:'standard' as const,date:input('test-date').value,start:input('book-now-start').value,duration:Number(input('book-now-duration').value),courtCount:1 as const,priority:[court],fallbackStarts:[],exact:[[court]]}};
  }
  if(input('test-wing').value==='BUKO'){
    if(setup.DURATION_HOURS>3)throw Error('BUKO_EXACT_NORMAL_PLAN_REQUIRED');
    const court=Number(input('test-buko-court').value);
    return {method:'api-first' as const,request:{wing:'BUKO' as const,strategy:'standard' as const,date:input('test-date').value,start:setup.START_TIME,duration:setup.DURATION_HOURS,courtCount:1 as const,priority:[court],fallbackStarts:[],exact:[[court]]}};
  }
  const exactA=input('exact-a').value.trim(),exactB=input('exact-b').value.trim();
  const exact=exactA||exactB?{exact:(setup.BOOKING_TYPE==='extended'?[exactA,exactB]:[exactA]).map(value=>value.split(',').map(court=>Number(court.trim())))}:{};
  return {method:setup.BOOKING_METHOD,request:{strategy:setup.BOOKING_TYPE,date:input('test-date').value,start:setup.START_TIME,duration:setup.DURATION_HOURS,courtCount:setup.COURT_COUNT,priority:[...setup.PREFERRED_COURTS],fallbackStarts:[...setup.FALLBACK_TIMES],...exact}};
}
 function currentSetup():BookingSetup{return {...strategyFields(),RELEASE_OFFSET_MS:releaseOffsetValue(),BOOKING_METHOD:input('booking-method').value as 'browser'|'hybrid'|'api-first'|'proofless',BOOKING_TYPE:input('booking-type').value as 'standard'|'extended',COURT_COUNT:Number(input('court-count').value) as CourtCount,START_TIME:input('start-time').value,DURATION_HOURS:Number(input('duration').value),PREFERRED_COURTS:courtOrder,FALLBACK_COURTS:[],FALLBACK_TIMES:fallbackTimes,MAX_SELECTION_ATTEMPTS:Number(input('attempts').value)};}
byId('test-booking').onclick=()=>{const authorized=input('terms').checked;input('terms').checked=false;void window.thirsty.testBooking({...testRequest(),authorizeTerms:authorized as true}).catch(()=>{byId('detail').textContent='Check booking fields and Terms authorization.';});};
// Phase 4 views. Plain summaries first; technical metrics only under Details. Nothing here saves, prepares or arms.
const QUALITY_LABEL:Record<string,string>={GOOD:'Good',FAIR:'Fair',POOR:'Poor · too late or too coarse for the 8:00 moment',NONE:'Not observed'};
const ORIGIN_LABEL:Record<string,string>={REAL_RELEASE:'current release architecture',HISTORICAL_PRE_PHASE3:'historical, before the current release architecture',SYNTHETIC:'synthetic test data',OFFLINE_BENCHMARK:'offline benchmark'};
const OUTCOME_LABEL:Record<string,string>={OBJECTIVE_ACHIEVED:'Hold verified',OBJECTIVE_ACHIEVED_EXTRA_HOLD:'Hold verified; another attempt also holds a court',
  OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED:'All sent attempts were rejected',ALL_REJECTED_WAITING_FOR_REOPEN:'All sent attempts were rejected',MANUAL_RECONCILIATION_REQUIRED:'UNKNOWN result; checked manually',
  NOTHING_DISPATCHED:'Nothing was sent',API_NO_AVAILABLE_CANDIDATE:'No available candidate was found',SPECIAL_SESSION_NOT_AVAILABLE:'The plan found no usable session'};
const VERDICT_LABEL:Record<string,[string,string]>={READY:['Ready','good'],NEEDS_ATTENTION:['Needs attention','warn'],INSUFFICIENT_DATA:['Insufficient data','muted']};
const secondsText=(ms:number|null|undefined)=>ms===null||ms===undefined?'not recorded':`${ms<0?'−':'+'}${(Math.abs(ms)/1000).toFixed(1)} s`;
const outcomeText=(code:string|null)=>code?OUTCOME_LABEL[code]??code.replaceAll('_',' ').toLowerCase():'Not recorded';
function detailsList(summaryText:string,lines:string[]){
  const details=smartElement('details','tool-details'),list=smartElement('ul','');details.append(smartElement('summary','',summaryText),list);
  list.append(...lines.map(line=>smartElement('li','',line)));return details;
}
function factList(rows:Array<[string,string]>){
  const facts=smartElement('dl','insight-facts');
  for(const [name,value] of rows){const item=document.createElement('div');item.append(smartElement('dt','',name),smartElement('dd','',value));facts.append(item);}
  return facts;
}
let phase4Key='';
function renderPhase4(state:Dashboard){
  const key=JSON.stringify([state.intelligence,state.phase4]);if(key===phase4Key)return;phase4Key=key;
  const intelligence=state.intelligence,phase=state.phase4;
  const real=(intelligence?.releases??[]).filter(release=>release.origin==='REAL_RELEASE'||release.origin==='HISTORICAL_PRE_PHASE3');
  const release=real[0],host=byId('release-insights');
  if(!release)host.replaceChildren(smartElement('p','empty',intelligence?.generatedAt?'No recorded release yet.':'No release intelligence yet. Use Tools → Rebuild intelligence.'));
  else{
    const earlier=real.slice(1).map(value=>value.firstPublishedResponseOffsetMs).filter((value):value is number=>value!==null).sort((a,b)=>a-b);
    const median=earlier.length?earlier[Math.floor(earlier.length/2)]!:null;
    host.replaceChildren(factList([['Release',`${dateLabel(release.targetDate)} target · ${ORIGIN_LABEL[release.origin]??release.origin}`],
      ['First useful grid',release.firstPublishedResponseOffsetMs===null?'Not observed':`answered ${secondsText(release.firstPublishedResponseOffsetMs)} after 8:00 · quality ${QUALITY_LABEL[release.quality]??release.quality}`],
      ['Attempts',`${release.attempts.immediate} immediate · ${release.attempts.backup} backup · ${release.attempts.reopened} reopened-slot`],
      ['Result',outcomeText(release.outcome)],
      ['Reopened slots',release.reopened?`${release.reopened} court-hour${release.reopened===1?'':'s'} were seen reopening later (cause unknown)`:'None observed'],
      ['Compared with history',median===null?'No earlier release to compare yet.':`Earlier releases answered their first useful grid at a median ${secondsText(median)} (${earlier.length} release${earlier.length===1?'':'s'}).`]]),
      detailsList('Details',[...release.reasons,...release.notes,`Release record ${release.key}`]));
  }
  const busy=!!phase?.busy;
  for(const id of ['rebuild-intelligence','clear-intelligence','run-network-check','replay-saved'])(byId(id) as HTMLButtonElement).disabled=busy;
  byId('intelligence-status').textContent=phase?.message||(intelligence?.generatedAt
    ?`Last rebuilt ${new Date(intelligence.generatedAt).toLocaleString('en-GB',{timeZone:'Asia/Manila'})} Manila · ${intelligence.realReleases} real release${intelligence.realReleases===1?'':'s'} · ${intelligence.adequateReleases} well observed`:'Not built yet.');
  const list=byId('intelligence-list');
  list.replaceChildren(...(intelligence?.releases??[]).map(value=>{const line=smartElement('div','intelligence-line');
    line.append(smartElement('strong','',`${dateLabel(value.targetDate)} · ${ORIGIN_LABEL[value.origin]??value.origin}`),
      smartElement('span','',`Quality ${QUALITY_LABEL[value.quality]??value.quality} · first grid ${secondsText(value.firstPublishedResponseOffsetMs)} · ${value.attempts.immediate+value.attempts.backup+value.attempts.reopened} attempts · ${outcomeText(value.outcome)}`));return line;}),
    ...(phase?.warmth?[smartElement('p','small',`Connection warmth: ${phase.warmth.verdict}. ${phase.warmth.reasons.join(' ')}`)]:[]));
  if(!intelligence?.releases.length)list.append(smartElement('p','empty','No releases recorded.'));
  const net=phase?.networkReadiness,result=byId('network-result');
  if(net){const [label,tone]=VERDICT_LABEL[net.verdict]??[net.verdict,'muted'];const head=smartElement('p','tool-verdict',label);head.dataset.tone=tone;
    result.replaceChildren(head,smartElement('p','small',net.reasons.join(' ')),detailsList('Details',[
      `Measured ${new Date(net.measuredAt).toLocaleString('en-GB',{timeZone:'Asia/Manila'})} Manila · ${net.target}`,
      `${net.succeeded} of ${net.requests} reads succeeded · ${net.complete} complete`,
      `Read time median ${net.medianMs??'—'} ms · p90 ${net.p90Ms??'needs 10 reads'} · p95 ${net.p95Ms??'needs 20 reads'} · max ${net.maxMs??'—'} ms`,
      `Connections: ${net.newConnections??'unmeasured'} new, ${net.reusedRequests??'unmeasured'} reused · setup ${net.connectMs.length?net.connectMs.map(value=>`${value} ms`).join(', '):'none'} · DNS ${net.dnsMs??'—'} ms · ${net.protocol}`,
      `Network clock: ${net.clock.kept} of ${net.clock.samples} samples kept · offset ${net.clock.offsetMs??'—'} ms · round trip ${net.clock.minRoundTripMs??'—'}–${net.clock.medianRoundTripMs??'—'} ms · spread ${net.clock.spreadMs??'—'} ms · ${net.clock.quality}`,
      `Interfaces: ${net.interfaces.map(value=>`${value.name} (${value.kind})`).join(', ')||'none reported'} · link speed not measured`,
      net.history.previousRuns?`Earlier checks: ${net.history.previousRuns}, median read time ${net.history.previousMedianMs??'—'} ms`:'No earlier checks to compare.']));}
  else if(phase?.busy==='network')result.replaceChildren(smartElement('p','small','Checking…'));
}
function renderReplay(host:HTMLElement,summary:Awaited<ReturnType<Bridge['replayPlan']>>){
  if(summary.blocked){host.replaceChildren(smartElement('p','small',summary.blocked));return;}
  const cards=summary.results.map(result=>{
    const card=smartElement('div','replay-card');card.append(smartElement('strong','',`${dateLabel(result.targetDate)} release · ${ORIGIN_LABEL[result.origin]??result.origin}`),smartElement('p','replay-statement',result.statement));
    const lines=result.immediate.map(value=>`Immediate · Court ${value.court} · ${smartRange(value.startTime,Number(value.endTime.slice(0,2))-Number(value.startTime.slice(0,2)))}: ${value.firstPublished.replaceAll('_',' ').toLowerCase()} in the first published grid${value.firstPublishedRead?` (answered ${secondsText(value.firstPublishedRead.responseOffsetMs)})`:''}`);
    if(result.backup)lines.push(`Backup opportunity at ${secondsText(result.backup.atResponseOffsetMs)}: ${result.backup.selections.map(value=>`Court ${value.court} ${value.startTime}–${value.endTime} (Worker ${value.workerId}, ${smartPeso(value.amount)})`).join('; ')}`);
    for(const value of result.rescue)lines.push(`Reopened-slot opportunity at ${secondsText(value.atResponseOffsetMs)}: Court ${value.court} ${value.startTime}–${value.endTime}`);
    if(result.conflicts.length)lines.push(`${result.conflicts.length} open backup${result.conflicts.length===1?' was':'s were'} skipped because an active attempt overlapped it.`);
    card.append(smartElement('ul','',undefined));card.lastElementChild!.append(...lines.map(line=>smartElement('li','',line)));
    card.append(detailsList('Details',[...result.censored,...result.assumptions,`Evidence used: ${Object.entries(result.fitness).map(([key,count])=>`${count} ${key.replaceAll('_',' ').toLowerCase()}`).join(', ')||'none'}`,
      ...result.forensicOpenings.map(value=>`Observed open (${value.fitness.replaceAll('_',' ').toLowerCase()}): Court ${value.court} ${value.startTime}–${value.endTime}, read #${value.seq} answered ${secondsText(value.responseOffsetMs)}`)]));
    return card;
  });
  host.replaceChildren(...(cards.length?cards:[smartElement('p','small','No recorded release has a court/hour grid to replay yet.')]),
    ...summary.skipped.map(value=>smartElement('p','small',`Not replayed (${value.releaseKey.split('@')[0]} target): ${value.reason}`)));
}
function adviceRequest(){
  const courts=input('advisor-courts').value.split(/[ ,]+/).filter(Boolean).map(Number);
  const exclude=input('advisor-exclude').value.split(/[ ,]+/).filter(Boolean).map(value=>{const match=/^([1-7])@(\d{1,2})(?::00)?$/.exec(value.trim());
    return match?{court:Number(match[1]),start:`${match[2]!.padStart(2,'0')}:00`}:null;});
  if(!courts.length||courts.some(court=>!Number.isInteger(court)||court<1||court>7))return 'Courts must be numbers from 1 to 7, separated by commas.';
  if(exclude.some(value=>value===null))return 'Write exclusions like 3@19:00, separated by commas.';
  if(input('advisor-from').value>input('advisor-to').value)return 'The earliest start must not be after the latest start.';
  return {courts,earliestStart:input('advisor-from').value,latestStart:input('advisor-to').value,durationHours:Number(input('advisor-duration').value),
    immediate:Math.min(7,Math.max(0,Math.floor(Number(input('advisor-immediate').value)||0))),backups:Math.min(14,Math.max(0,Math.floor(Number(input('advisor-backups').value)||0))),
    exclude:exclude as Array<{court:number;start:string}>,existing:[...smartDraft.immediate,...smartDraft.backups].map(({court,start,durationHours})=>({court,start,durationHours}))};
}
function renderAdvice(result:Awaited<ReturnType<Bridge['adviseFromHistory']>>){
  if('blocked' in result){byId('advisor-status').textContent=result.blocked;byId('advisor-results').replaceChildren();return;}
  byId('advisor-status').textContent=`${result.rule} ${result.notes.join(' ')} Well-observed ${result.dayOfWeek} releases: ${result.wellObservedReleases}.`;
  byId('advisor-results').replaceChildren(...result.suggestions.map(suggestion=>{
    const card=smartElement('div','advisor-card'),list=smartElement('ul','');
    card.append(smartElement('span','advisor-role',suggestion.role==='IMMEDIATE'?'Immediate attempt':'Backup choice'),smartElement('strong','',suggestion.title),list);
    list.append(...suggestion.lines.map(line=>smartElement('li','',line)));
    const add=smartButton('Add to draft',`Add ${suggestion.title} to the draft as ${suggestion.role==='IMMEDIATE'?'an immediate attempt':'a backup choice'}`,false,()=>{
      const slot={court:suggestion.court,start:suggestion.start,durationHours:suggestion.durationHours};
      const present=[...smartDraft.immediate,...smartDraft.backups].some(value=>value.court===slot.court&&value.start===slot.start&&value.durationHours===slot.durationHours);
      if(present||(suggestion.role==='IMMEDIATE'&&smartDraft.immediate.length>=SMART_WORKERS.length)){add.textContent=present?'Already in draft':'Immediate list full';add.disabled=true;return;}
      smartEdit(draft=>{(suggestion.role==='IMMEDIATE'?draft.immediate:draft.backups).push(slot);});add.textContent='Added to draft';add.disabled=true;});
    const row=smartElement('div','button-row');row.append(add);card.append(row);return card;
  }));
}
for(const id of ['advisor-from','advisor-to'])(byId(id) as HTMLSelectElement).replaceChildren(...hours.map(h=>new Option(friendly(h),h)));
input('advisor-from').value='17:00';input('advisor-to').value='20:00';
byId('smart-suggest').onclick=()=>{const panel=byId('smart-advisor');panel.hidden=!panel.hidden;
  if(!panel.hidden){input('advisor-immediate').value=String(Math.max(1,smartDraft.immediate.length||4));input('advisor-backups').value=String(Math.max(0,smartDraft.backups.length||3));}};
byId('smart-advisor-close').onclick=()=>{byId('smart-advisor').hidden=true;};
byId('advisor-run').onclick=()=>{const request=adviceRequest();if(typeof request==='string'){byId('advisor-status').textContent=request;return;}
  byId('advisor-status').textContent='Reading release history…';
  void window.thirsty.adviseFromHistory(request).then(renderAdvice).catch(()=>{byId('advisor-status').textContent='Suggestions are unavailable right now.';});};
byId('smart-replay').onclick=()=>{const compiled=smartCompiled(),host=byId('smart-replay-results');
  if(!compiled.phase3){host.replaceChildren(smartElement('p','small','Resolve the items above before replaying this draft.'));return;}
  host.replaceChildren(smartElement('p','small','Replaying recorded releases…'));
  void window.thirsty.replayPlan({source:'draft',phase3:compiled.phase3}).then(summary=>renderReplay(host,summary)).catch(()=>{host.replaceChildren(smartElement('p','small','Replay is unavailable right now.'));});};
byId('replay-saved').onclick=()=>{const host=byId('replay-results');host.replaceChildren(smartElement('p','small','Replaying recorded releases…'));
  void window.thirsty.replayPlan({source:'saved'}).then(summary=>renderReplay(host,summary)).catch(()=>{host.replaceChildren(smartElement('p','small','Replay is unavailable right now.'));});};
byId('run-network-check').onclick=()=>{void window.thirsty.runNetworkCheck().catch(()=>{});};
byId('rebuild-intelligence').onclick=()=>{void window.thirsty.rebuildIntelligence().catch(()=>{});};
byId('clear-intelligence').onclick=()=>{void window.thirsty.clearIntelligence().catch(()=>{});};
window.thirsty.onStatus(render);
void window.thirsty.getStatus().then(render);
setInterval(tick, 100);
const activity=document.querySelector<HTMLElement>('.activity')!;
const expand=byId('activity-expand') as HTMLButtonElement;
function setActivityExpanded(value:boolean){activity.classList.toggle('expanded',value);expand.setAttribute('aria-expanded',String(value));expand.textContent=value?'Restore':'Maximize';}
expand.addEventListener('click',()=>setActivityExpanded(!activity.classList.contains('expanded')));
byId('run-detail-close').addEventListener('click',closeRunDetail);
byId('run-detail-modal').addEventListener('click',event=>{if(event.target===byId('run-detail-modal'))closeRunDetail();});
byId('confirm-cancel').addEventListener('click',()=>settleConfirm(false));
byId('confirm-ok').addEventListener('click',()=>settleConfirm(true));
document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(!byId('confirm-modal').hidden)settleConfirm(false);else if(!byId('run-detail-modal').hidden)closeRunDetail();else if(activity.classList.contains('expanded'))setActivityExpanded(false);});

const PRECISION_EVIDENCE_TEXT:Record<string,string>={PUBLIC_BOOKING_PRESENT:'PUBLIC BOOKING PRESENT',UNAVAILABLE_WITH_PUBLIC_BOOKING:'UNAVAILABLE WITH PUBLIC BOOKING',
  UNAVAILABLE_WITHOUT_PUBLIC_BOOKING:'Unavailable without public booking record',UNKNOWN:'UNKNOWN / READ FAILED',
  NO_PUBLIC_BOOKING_DATE_UNRELEASED:'No known booking · target date not yet published',CONFIRMED_OPEN:'CONFIRMED OPEN (published)'};
const PRECISION_STATE_TEXT:Record<string,[string,'ok'|'warn'|'bad'|'']>={EXCLUDED_BEFORE_FREEZE:['NOT DISPATCHED — excluded before freeze','warn'],
  BROWSER_FAILED:['NOT DISPATCHED — browser failed','warn'],IDENTITY_FAILED:['NOT DISPATCHED — player binding missing','warn'],
  JOURNAL_BLOCKED:['NOT DISPATCHED — earlier attempt on record','warn'],PREWARM_FAILED:['NOT DISPATCHED — PREWARM FAILED','warn'],
  WINDOW_MISSED:['NOT DISPATCHED — window missed','warn'],NOT_DISPATCHED:['NOT DISPATCHED','warn'],REJECTED:['REJECTED by Onda',''],
  UNKNOWN:['UNKNOWN — may have been sent · do not retry','bad'],HOLD_VERIFIED:['HOLD VERIFIED','ok'],
  HOLD_VERIFIED_QR_ATTENTION:['HOLD VERIFIED · QR HANDOFF NEEDS ATTENTION — use Show Browser','bad'],QR_READY:['HOLD VERIFIED · QR READY','ok']};
/** Next Release summary of a saved Smart plan, generated from the saved authorization itself. */
function smartSavedSummary(plan:NonNullable<BookingSetup['PRECISION_PHASE3']>,targetDate:string){
  const description=describeSmartPlan(plan as SmartPhase3,{unavailable:unreadyWorkers()});
  return ['PRECISION · SMART BACKUPS · GOAL: 1 HOLD',`${description.summary} · maximum ${description.maxSends} sends`,
    ...description.sections.flatMap(section=>[section.title.toUpperCase(),...section.lines.map(line=>`  ${line}`)]),...description.warnings,`Target: ${dateLabel(targetDate)}`].join('\n');
}
const SMART_OUTCOME:Record<string,string>={OBJECTIVE_ACHIEVED:'Hold verified',OBJECTIVE_ACHIEVED_EXTRA_HOLD:'Hold verified · another attempt also holds a court',
  MANUAL_RECONCILIATION_REQUIRED:'UNKNOWN result · check Onda manually; nothing more will be sent',ALL_REJECTED_WAITING_FOR_REOPEN:'All attempts rejected',NOTHING_DISPATCHED:'Nothing was sent'};
const AVAILABILITY_STATUS:Record<string,string>={ACTIONABLE_FRESH:'Fresh · usable for backups',ACTIONABLE_BOUNDED_CACHE:'Bounded cache age · usable for backups',FORENSIC_ONLY_CACHE_AGE_UNKNOWN:'Cached or age unknown · not used',
  FORENSIC_ONLY_STALE:'Too old · not used',FORENSIC_ONLY_INCOMPLETE:'Incomplete · not used',FORENSIC_ONLY_OUTDATED_REQUEST:'Older read answered late · not used',
  UNRELEASED:'Not released yet',FAILED:'Read failed'};
const ATTEMPT_LABEL:Record<string,string>={WAVE_1:'Immediate attempt',WAVE_2:'Backup attempt',RESCUE:'Reopened-slot attempt'};
function renderPrecision(state:Dashboard){
  const setup=state.booking?.setup,live=state.precision;
  if(setup?.RELEASE_STRATEGY==='precision'&&setup.PRECISION_PHASE3){
    const p=setup.PRECISION_PHASE3 as SmartPhase3,phase=state.phase3,panel=byId('precision-panel');panel.hidden=false;
    const current=state.slotWatch?.current?.seq===phase?.seq&&(phase?.fitness==='ACTIONABLE_FRESH'||phase?.fitness==='ACTIONABLE_BOUNDED_CACHE');
    const description=describeSmartPlan(p,{unavailable:unreadyWorkers()});
    byId('precision-summary').textContent=[`Smart backups · ${SMART_OUTCOME[phase?.outcome??'']??(phase?.frozen?'Plan frozen for release':'Configured')}`,
      `${description.summary} · maximum ${description.maxSends} sends`,
      `Availability status: ${AVAILABILITY_STATUS[phase?.fitness??'']??'Waiting for the released schedule'}`].join('\n');
    const assigned=new Map(p.wave1.map(value=>[value.candidateIndex,value.workerId] as const));
    const backups=p.candidates.map((_,index)=>index).filter(index=>!assigned.has(index)).sort((a,b)=>p.candidates[a]!.priority-p.candidates[b]!.priority||a-b);
    const lines=[...p.wave1.map(value=>value.candidateIndex),...backups].map((index,position)=>{
      const c=p.candidates[index]!,worker=assigned.get(index),line=document.createElement('div');line.className='precision-line';
      const title=document.createElement('strong');title.textContent=worker?`Immediate · Worker ${worker} · Court ${c.court} · ${smartRange(c.start,c.durationHours)}`
        :`Backup ${position-p.wave1.length+1} · Court ${c.court} · ${smartRange(c.start,c.durationHours)}`;
      const slotHours=Array.from({length:c.durationHours},(_,offset)=>`${String(Number(c.start.slice(0,2))+offset).padStart(2,'0')}:00`);
      const cells=slotHours.map(hour=>state.slotWatch?.cells.find(value=>value.court===c.court&&value.hour===hour));
      const freshOpen=current&&cells.every(cell=>cell?.state==='OPEN'&&typeof cell.currentPrice==='number'&&cell.currentPrice>0);
      const evidence=document.createElement('span');evidence.textContent=freshOpen?`Fresh open · released price ${smartPeso(cells.reduce((total,cell)=>total+cell!.currentPrice!,0))}`:
        cells.some(cell=>cell?.state==='TAKEN')?'Unavailable':AVAILABILITY_STATUS[phase?.fitness??'']??'Waiting for the released schedule';
      const price=document.createElement('span');price.textContent=worker?`Expected ${smartPeso(c.rateEvidence.perHour.reduce((a,b)=>a+b,0))}`:'Uses the released price';
      line.append(title,evidence,price);return line;
    });
    for(const worker of p.standby){const line=document.createElement('div');line.className='precision-line';line.textContent=`Backup worker ${worker} · waits for a fresh opening`;lines.push(line);}
    for(const attempt of phase?.attempts??[]){const line=document.createElement('div');line.className='precision-line';
      line.textContent=`${ATTEMPT_LABEL[attempt.wave]??attempt.wave} · Worker ${attempt.workerId} · ${attempt.state}`;lines.push(line);}
    byId('precision-table').replaceChildren(...lines);
    if(state.identityIssues?.length)byId('precision-summary').textContent+=`\n${state.identityIssues.join('\n')}`;
    return;
  }
  const configured=setup?.RELEASE_STRATEGY==='precision'?setup.PRECISION_TARGETS:[];
  const rows=live?.targets.length?live.targets:configured.map((t,i)=>({workerId:PRECISION_WORKERS[i]!,court:t.court,startTime:t.start,
    endTime:`${String(Number(t.start.slice(0,2))+t.durationHours).padStart(2,'0')}:00`,durationHours:t.durationHours}));
  const panel=byId('precision-panel');panel.hidden=!rows.length;
  if(!rows.length)return;
  const fanOut=setup?.PRECISION_FAN_OUT===true;
  byId('precision-summary').textContent=(fanOut?`FAN-OUT · ${rows.length} worker goal${rows.length===1?'':'s'} → ${rows.length*4} independently tracked tab attempts\n`:'')+(live?.outcome?`Outcome: ${live.outcome.replaceAll('_',' ')}`:
    live?.frozen?`FROZEN at ${live.frozenAt?new Date(live.frozenAt).toLocaleTimeString('en-GB',{timeZone:'Asia/Manila'}):'T-2 min'} · ${live.frozenCount??0} attempt(s) will be sent at release · no further changes`:
    live?.checkpoint?`Latest evidence: ${live.checkpoint}${live.checkpointAt?` at ${new Date(live.checkpointAt).toLocaleTimeString('en-GB',{timeZone:'Asia/Manila'})}`:''} · freezes at T-2 min`:
    'Configured targets · evidence appears after Reset & Prepare and at T-60, T-30, T-10 and T-2 min.');
  if(state.identityIssues?.length)byId('precision-summary').textContent+=`\n${state.identityIssues.join('\n')}`;
  byId('precision-table').replaceChildren(...rows.map(row=>{
    const line=document.createElement('div');line.className='precision-line';
    const target=document.createElement('strong');target.textContent=`Worker ${row.workerId} · Court ${row.court} · ${row.startTime}–${row.endTime}`;
    const evidence=document.createElement('span');const ev='evidence' in row?row.evidence:undefined;
    evidence.textContent=ev?`${PRECISION_EVIDENCE_TEXT[ev]??ev}${'eligible' in row&&row.eligible===false?' · NOT ELIGIBLE':''}`:'Evidence pending';
    const status=document.createElement('span');const st='state' in row?row.state:undefined;const dup='duplicateOf' in row?row.duplicateOf:undefined;
    const [text,tone]=st==='IDENTITY_FAILED'&&dup?[`NOT DISPATCHED — IDENTITY FAILED: duplicate Onda customer ID (duplicates Worker ${dup})`,'warn' as const]:st?PRECISION_STATE_TEXT[st]??[st,'']:['Awaiting release',''];
    status.textContent=text+('security' in row&&row.security==='failed'&&!st?' · security prewarm failed':'')+('bookingNo' in row&&row.bookingNo?` · Booking ${row.bookingNo}`:'')+
      ('holdExpiresAt' in row&&row.holdExpiresAt?` · hold until ${new Date(row.holdExpiresAt).toLocaleTimeString('en-GB',{timeZone:'Asia/Manila'})}`:'');
    if(tone)status.dataset.tone=tone;
    line.append(target,evidence,status);return line;
  }));
  for(let i=0;i<PRECISION_WORKERS.length;i++){const row=live?.targets.find(t=>t.workerId===PRECISION_WORKERS[i]);
    byId(`precision-evidence-${i}`).textContent=row?.evidence?`Latest (${row.checkpoint??''}): ${PRECISION_EVIDENCE_TEXT[row.evidence]??row.evidence}`:'';}
}

// Book Now edits never overwrite the saved release strategy.
(byId('book-now-start') as HTMLSelectElement).replaceChildren(...Array.from({length:16},(_,i)=>new Option(friendly(`${String(i+8).padStart(2,'0')}:00`),`${String(i+8).padStart(2,'0')}:00`)));
input('book-now-start').value='18:00';
// The both-wing availability grid is rendered by Booking Setup (booking-setup.ts).

hooks.prepare=async()=>{byId('prepare').click();};
initBookingSetup();initHome();initActivity();
// Buko or both wings are planned in Booking Setup (the saved legacy plan stays Mango).
input('strategy-wing').onchange=()=>{const value=input('strategy-wing').value;if(value!=='MANGO'){input('strategy-wing').value='MANGO';document.dispatchEvent(new CustomEvent('booking-setup:wing',{detail:value}));}};
