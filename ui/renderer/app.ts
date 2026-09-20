import type { Bridge, Dashboard } from '../types.js';
import type { BookingSetup } from '../../src/config.js';
import {bookingSetupProblem,reconcileFallbackTimes,type FallbackReconciliation} from '../../src/booking-setup.js';
import type {ReleasePerformance} from '../../src/release-performance.js';
declare global { interface Window { thirsty: Bridge } }
const byId = (id: string) => document.getElementById(id)!;
let latest: Dashboard | undefined;
let renderedLogs = '';
let timingReadyKey='';
let timingReadyStartedMono=0;
let timingReadyInitialMs=0;
let dirty=false, loadedPlan='';
let courtOrder=[7,6,5,4,3,2,1], fallbackTimes:string[]=[];
const input=(id:string)=>byId(id) as HTMLInputElement;
let workflow:'test'|'release'='test';
interface FormDraft {method:'browser'|'hybrid'|'api-first';strategy:'standard'|'extended';date:string;courtCount:1|2;start:string;duration:number;maximum:number;attempts:number;courtOrder:number[];fallbackTimes:string[];exactA:string;exactB:string}
let testDraft:FormDraft|undefined,releaseDraft:FormDraft|undefined,testDirty=false,releaseDirty=false;
let releaseAdjustment:FallbackReconciliation|undefined;
byId('simple-status').append(byId('readiness'));
byId('simple-status').before(document.querySelector('.hero')!);
byId('simple-status').after(document.querySelector('.activity')!);
const primary=byId('primary-actions');
primary.prepend(byId('prepare'),byId('terms').parentElement!);
primary.append(byId('api-dry-controls'),byId('arm'),byId('blocked-reason'),byId('selection-result'),byId('handoff-result'));
byId('release-schedule').after(primary);
const advanced=byId('advanced-extra');
advanced.append(byId('lock-card'),document.querySelector('.mode-options')!,document.querySelector('.editors')!,byId('attempts').parentElement!,byId('save-booking'),byId('edit-status'));
input('test-date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
input('api-dry-date').value=input('test-date').value;

const friendly=(h:string)=>`${Number(h.slice(0,2))%12||12}:00 ${Number(h.slice(0,2))<12?'AM':'PM'}`;
const endFriendly=(start:string,duration:number)=>Number(start.slice(0,2))+duration===24?'12:00 MN':friendly(`${String(Number(start.slice(0,2))+duration).padStart(2,'0')}:00`);
const hours=Array.from({length:16},(_,i)=>`${String(i+8).padStart(2,'0')}:00`);
for(const id of ['start-time','fallback-time','practice-start','full-start','dual-start']) (byId(id) as HTMLSelectElement).replaceChildren(...hours.map(h=>new Option(friendly(h),h)));
(byId('practice-court') as HTMLSelectElement).replaceChildren(...Array.from({length:7},(_,i)=>new Option(`Court ${i+1}`,String(i+1))));
input('practice-date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
(byId('full-court') as HTMLSelectElement).replaceChildren(...Array.from({length:7},(_,i)=>new Option(`Court ${i+1}`,String(i+1))));
input('full-date').value=input('practice-date').value;
input('dual-date').value=input('practice-date').value;
for(const id of ['dual-court-a','dual-court-b'])(byId(id) as HTMLSelectElement).replaceChildren(...Array.from({length:7},(_,i)=>new Option(`Court ${i+1}`,String(i+1))));
input('dual-court-a').value='7';input('dual-court-b').value='6';
function formDraft():FormDraft{return {method:input('booking-method').value as 'browser'|'hybrid'|'api-first',strategy:input('booking-type').value as 'standard'|'extended',date:input('test-date').value,courtCount:Number(input('court-count').value) as 1|2,start:input('start-time').value,duration:Number(input('duration').value),maximum:Number(input('maximum').value),attempts:Number(input('attempts').value),courtOrder:[...courtOrder],fallbackTimes:[...fallbackTimes],exactA:input('exact-a').value,exactB:input('exact-b').value};}
function applyDraft(d:FormDraft){input('booking-method').value=d.method;input('booking-type').value=d.strategy;input('test-date').value=d.date;input('court-count').value=String(d.courtCount);input('start-time').value=d.start;input('duration').value=String(d.duration);input('maximum').value=String(d.maximum);input('attempts').value=String(d.attempts);courtOrder=[...d.courtOrder];fallbackTimes=[...d.fallbackTimes];input('exact-a').value=d.exactA;input('exact-b').value=d.exactB;editors();}
function storeDraft(){const d=formDraft();if(workflow==='test')testDraft=d;else releaseDraft=d;}
function reconcileReleaseDraft(){
  if(workflow!=='release')return;
  const reconciliation=reconcileFallbackTimes(input('start-time').value,Number(input('duration').value),fallbackTimes);
  if(reconciliation.removed.length){fallbackTimes=[...reconciliation.valid];releaseAdjustment=reconciliation;editors();}
}
function changed(){input('terms').checked=false;reconcileReleaseDraft();if(workflow==='test')testDirty=true;else releaseDirty=true;dirty=true;storeDraft();void window.thirsty.invalidatePreparation?.().catch(()=>{});byId('edit-status').textContent='SETTINGS CHANGED · Press Reset & Prepare.';if(latest)render(latest);}
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
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
function status(id: string, text: string, tone: string) { const el = byId(id); el.textContent = text; el.dataset.tone = tone; }
function render(state: Dashboard) {
  latest = state;
  byId('headline').textContent = state.headline; byId('detail').textContent = state.detail;
  const armed=!!state.scheduledRelease;
  const busy = state.operation !== 'idle'&&state.operation!=='scheduled';
  const playerStatus=state.playerStatus??{primary:!!state.booking?.playerConfigured,extended:!!state.booking?.extendedPlayerConfigured};
  const dual=state.booking?.setup.BOOKING_TYPE==='standard'&&state.booking.setup.COURT_COUNT===2;
  // Keep the dual practice entry point visible in the safe single-court
  // default; actions stay disabled until count 2 is explicitly saved.
  byId('dual-panel').hidden=false;
  (byId('dual-fields') as HTMLFieldSetElement).disabled=busy;
  (byId('dual-prepare') as HTMLButtonElement).disabled=busy||state.lock||dirty||!dual;
  (byId('dual-dry') as HTMLButtonElement).disabled=busy||state.lock||dirty||!dual||!state.cdp;
  (byId('dual-selection') as HTMLButtonElement).disabled=busy||state.lock||dirty||!dual||!state.cdp||!input('dual-noncompetitive').checked;
  (byId('dual-full') as HTMLButtonElement).disabled=busy||state.lock||dirty||!dual||!state.cdp||!input('dual-noncompetitive').checked||!input('dual-terms').checked;
  byId('dual-readiness').textContent=dual
    ? ['A','B'].map(id=>{const w=state.dualWorkers?.[id as 'A'|'B'];return `Browser ${id}: ${w?`${w.state.toUpperCase()} (last observed ${new Date(w.verifiedAt).toLocaleTimeString()})`:'NOT VERIFIED'}`;}).join('\n')+`\nDual selection: ${state.dualValidation?.selection?'READY':'NOT READY'}\n${state.dualValidation?.full?'DUAL FULL FLOW VERIFIED':'FULL DUAL HOLD NOT YET VERIFIED'}`
    : 'Legacy dual practice only: Set Courts to book to 2 with Standard saved settings. Use the main controls for Standard / Extended bookings.';
  const dualResult=state.dualResult;byId('dual-result').hidden=!dualResult;
  byId('dual-result').textContent=dualResult?`${dualResult.status.replaceAll('_',' ')}\n${dualResult.date} / ${dualResult.hours.join(', ')}\nBrowser A: Court ${dualResult.courtA}\nBrowser B: Court ${dualResult.courtB}\nSource: ${dualResult.candidateSource}`:'';
  const full=workflow==='release'||state.mode==='full',fullReady=state.capabilities.selectionReady&&state.capabilities.checkoutReady&&state.capabilities.paymentBoundaryReady;
  input('mode-full').checked=full;input('mode-selection').checked=!full;
  input('mode-full').disabled=busy||!fullReady;input('mode-selection').disabled=busy;
  input('terms').disabled=armed||busy||state.lock||dirty||!full||!fullReady;
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
  (byId('prepare') as HTMLButtonElement).disabled=armed||busy||state.lock||dirty||!state.booking;
  (byId('arm') as HTMLButtonElement).disabled = armed?false:busy || state.lock || !state.booking || !state.capabilities.selectionReady || !state.cdp || (full&&(!fullReady||!state.termsAuthorized));
  (byId('dry') as HTMLButtonElement).disabled=busy||dirty||state.lock||!state.booking||!state.clock?.canArmToday;
  (byId('observe') as HTMLButtonElement).disabled=busy||state.lock||!state.clock?.canArmToday;
  input('terms').checked=state.termsAuthorized||armed;
  byId('player-status').textContent=`Player information · ${state.booking?.playerConfigured?'Configured ✓':'Missing / configuration invalid'}`;
  byId('capability-status').textContent=`Selection ${state.capabilities.selectionReady?'ready':'unverified'} · checkout ${state.capabilities.checkoutReady?'verified':'unverified'} · payment handoff ${state.capabilities.paymentBoundaryReady?'verified':'unverified'}`;
  const b=state.booking;
  if(b){
     if(!releaseDirty&&loadedPlan!==b.fingerprint){loadedPlan=b.fingerprint;releaseDraft={method:b.setup.BOOKING_METHOD??'browser',strategy:b.setup.BOOKING_TYPE??'standard',date:testDraft?.date??input('test-date').value,courtCount:b.setup.COURT_COUNT,start:b.setup.START_TIME,duration:b.setup.DURATION_HOURS,maximum:b.setup.MAX_PRICE,attempts:b.setup.MAX_SELECTION_ATTEMPTS,courtOrder:[...b.setup.PREFERRED_COURTS],fallbackTimes:[...b.setup.FALLBACK_TIMES],exactA:'',exactB:''};if(b.fallbackReconciliation.removed.length){releaseAdjustment=b.fallbackReconciliation;releaseDirty=true;}if(workflow==='release'){applyDraft(releaseDraft);dirty=releaseDirty;}}
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
  byId('next-readiness').textContent = `Chrome/CDP: ${state.cdp ? 'REACHABLE' : 'NOT READY'}\nOnda: ${fresh && i?.gridToday && i.allCourts && i.visible ? 'READY (last inspection)' : 'NEEDS INSPECTION'}\nBooking plan: ${state.booking && !dirty ? 'READY' : 'NOT READY'}\nPlayer: ${state.booking?.playerConfigured ? 'READY' : 'NOT READY'}\nPre-open strategy: ${clock ? clock.preopenCalendar ? 'ON' : 'OFF' : 'UNKNOWN'}\nNo existing selections: ${fresh && i?.selected === 0 ? 'YES (last inspection)' : 'NOT VERIFIED'}\nAutomation lock: ${state.lock ? 'BLOCKED' : 'CLEAR'}\nTerms authorization: required per run\nRelease: ${clock ? `${clock.releaseTime} ${clock.timezone}` : 'UNKNOWN'}\nTarget: ${clock?.targetDate ?? 'UNKNOWN'}`;
  if(dual)byId('next-readiness').textContent=`2 courts / SAME TIME BLOCK\n${byId('dual-readiness').textContent}\nBooking plan: ${state.booking&&!dirty?'SAVED':'NOT READY'}\nAutomation lock: ${state.lock?'BLOCKED':'CLEAR'}\nTerms authorization: required per run\nRelease: ${clock?`${clock.releaseTime} ${clock.timezone}`:'UNKNOWN'}\nTarget: ${clock?.targetDate??'UNKNOWN'}`;
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
    byId('release-time').textContent = state.clock.releaseTime; byId('release-zone').textContent = state.clock.timezone;
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
    const label=document.createElement('strong');label.textContent=run.label.replaceAll('·',' / ').toUpperCase();
    const duration=document.createElement('span');duration.className='run-time';duration.textContent=`${(run.readyElapsedMs!/1000).toFixed(3)} seconds`;
    const meta=document.createElement('span');meta.className='run-meta';meta.textContent=`${new Date(run.startedAt).toLocaleString('en-GB',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'medium'})} Manila · ${run.outcome.toUpperCase()} · browser-ready → finish · preparation excluded`;
    row.append(label,duration,meta);return row;
  }));
  byId('mode-label').textContent=workflow==='test'?'TEST NOW':'RELEASE BOOKING';
   byId('prepare').firstChild!.textContent='RESET & PREPARE ';
   const apiFirst=input('booking-method').value==='api-first';
   byId('test-booking').textContent=apiFirst?'RUN API TEST TO QR':'RUN TEST TO QR';
   byId('api-dry-controls').hidden=!apiFirst||workflow!=='release';
   (byId('api-preview') as HTMLButtonElement).disabled=busy||state.lock||!state.apiFirstReady;
  const draftProblem=workflow==='release'?bookingSetupProblem(currentSetup()):undefined;
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
  input('test-booking').disabled=busy||dirty||state.lock||!state.ready||!input('terms').checked;
  input('terms').disabled=armed||busy||dirty||state.lock||!state.ready;
  byId('terms').parentElement!.lastChild!.textContent=workflow==='test'?' I authorize accepting Onda Terms for this test':' I authorize accepting Onda Terms for this booking';
  if(workflow==='release'&&armed)byId('terms').parentElement!.lastChild!.textContent=' AUTHORIZED FOR THIS EXACT SCHEDULED RUN';
  byId('workflow-test').setAttribute('aria-pressed',String(workflow==='test'));byId('workflow-release').setAttribute('aria-pressed',String(workflow==='release'));
  input('workflow-test').disabled=busy;input('workflow-release').disabled=busy;
  input('save-booking').disabled=busy||workflow==='test';
   if(workflow==='release'){input('arm').disabled ||= dirty||!state.ready||!input('terms').checked||(!apiFirst&&!fullReady);byId('blocked-reason').textContent=state.lock?'RESET REQUIRED':dirty?'SETTINGS CHANGED · Press Reset & Prepare.':!state.ready?'Reset & Prepare before arming.':!input('terms').checked?'Authorize Terms, then Arm Next Release.':'';}
  if(workflow==='test')byId('blocked-reason').textContent=state.lock?'RESET REQUIRED':dirty?'SETTINGS CHANGED · Press Reset & Prepare.':!state.ready?'Reset & Prepare before running a test.':!input('terms').checked?'Authorize Terms, then run your test.':'';
  if(workflow==='release'&&armed){input('arm').disabled=false;byId('blocked-reason').textContent='';}
  if(state.bookingResult){byId('handoff-result').hidden=false;byId('handoff-result').textContent=state.bookingResult.description+'\n'+state.bookingResult.outcomes.map((v,i)=>`Checkout ${i+1}: ${v}`).join('\n');}
  const duration=Number(input('duration').value),start=Number(input('start-time').value.slice(0,2)),strategy=input('booking-type').value;
  byId('booking-preview').textContent=`${workflow==='release'?'Target: '+(state.booking?.targetDate??'Not configured')+'\n':''}${strategy.toUpperCase()} | ${input('court-count').value} court(s) | ${input('start-time').value}-${String(start+duration).padStart(2,'0')}:00\nFallback starts: ${fallbackTimes.map(friendly).join(', ')||'None'}\n${strategy==='extended'?'2 browsers | 2 checkouts | 2 payment holds\nPreferred split: '+(duration===4?'3 + 1; alternatives 2 + 2, 1 + 3':duration===5?'3 + 2; alternative 2 + 3':'3 + 3')+'\nSame courts prioritized across checkouts.':'1 browser | 1 checkout | 1 payment hold'}\nNo price ceiling | Payment manual`;
  const count=Number(input('court-count').value),releaseText=state.clock?new Date(state.clock.releaseMs).toLocaleString('en-US',{timeZone:state.clock.timezone,month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'Calculating';
   const method=input('booking-method').value==='browser'?'NORMAL BROWSER':input('booking-method').value==='hybrid'?'HYBRID AVAILABILITY':'API-FIRST';
   byId('booking-preview').textContent=`${workflow==='release'?`RELEASE PLAN\nRelease: ${releaseText}\nTarget: ${state.clock?dateLabel(state.clock.targetDate):'Not configured'}\n`:''}${method}\n${strategy.toUpperCase()} | ${count} COURT${count===1?'':'S'}\n${friendly(input('start-time').value)} -> ${endFriendly(input('start-time').value,duration)} | ${duration} hours\nFallback starts: ${fallbackTimes.map(friendly).join(' -> ')||'None'}\nCourt priority: ${courtOrder.join(' -> ')}\n${strategy==='extended'?`Extended split: ${duration===4?'3h + 1h (alternatives 2h + 2h, 1h + 3h)':duration===5?'3h + 2h (alternative 2h + 3h)':'3h + 3h'}\n2 browsers | 2 checkouts | Same courts prioritized | Players: Primary + Extended`:'Browser: A | 1 checkout | Player: Primary'}\nNo price ceiling\nAttempts: ${input('attempts').value} | Payment: MANUAL${input('booking-method').value==='api-first'?'\nAPI first: dry run available; live runs once at the armed release.':''}`;
  if(duration>6){byId('booking-preview').textContent='Extended two-browser booking currently supports up to 6 consecutive hours.';input('test-booking').disabled=true;input('arm').disabled=true;}
  const playersReady=playerStatus.primary&&(strategy!=='extended'||playerStatus.extended);
  byId('player-status').textContent=`Primary player: ${playerStatus.primary?'Configured':'Missing'}${strategy==='extended'?' | Extended player: '+(playerStatus.extended?'Configured':'Missing'):''}`;
  const profile=(label:string,p?:{fullName:string;phone:string;email:string})=>{const card=document.createElement('div');const heading=document.createElement('strong');heading.textContent=label;card.append(heading,document.createElement('br'),document.createTextNode(p?`${p.fullName}\n${p.phone}\n${p.email}`:'Missing or invalid configuration'));card.style.whiteSpace='pre-line';return card;};
  byId('player-details').replaceChildren(profile('Primary player · Checkout A',playerStatus.primaryDetails),profile('Extended player · Checkout B',playerStatus.extendedDetails));
  input('test-booking').disabled ||= !playersReady;input('arm').disabled ||= !playersReady;
  const releaseMode=workflow==='release';byId('release-schedule').hidden=!releaseMode;byId('release-readiness-card').hidden=!releaseMode;
  if(releaseMode&&state.clock){
    byId('release-passed').textContent=state.clock.todayReleasePassed?`TODAY'S ${friendly(state.clock.releaseTime.slice(0,5))} RELEASE HAS PASSED`:'';
    byId('next-release').textContent=new Date(armed?state.scheduledRelease!.releaseMs:state.clock.releaseMs).toLocaleString('en-US',{timeZone:state.clock.timezone,month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
    byId('next-target').textContent=dateLabel(armed?state.scheduledRelease!.targetDate:state.clock.targetDate);
    const finalAt=(armed?state.scheduledRelease!.releaseMs:state.clock.releaseMs)-state.clock.preflightSecondsBefore*1000;
    byId('schedule-meta').textContent=`Final preflight: ${new Date(finalAt).toLocaleTimeString('en-US',{timeZone:state.clock.timezone,hour:'numeric',minute:'2-digit',second:'2-digit'})} | System: ${state.scheduleStatus??(armed?'WAITING':'NOT ARMED')}`;
  }
  const prepared=!!state.preparedContext&&state.preparedContext.workflow==='release'&&state.preparedContext.configFingerprint===state.booking?.fingerprint;
  const required=strategy==='extended'?['A','B'] as const:['A'] as const;
  const gates:[string,boolean][]=[['Configuration valid',!draftProblem],['Next release calculated',!!state.clock],['Booking target calculated',!!state.clock?.targetDate],['Primary player configured',playerStatus.primary],...(strategy==='extended'?[['Extended player configured',playerStatus.extended] as [string,boolean]]:[]),...required.map(id=>[`Browser ${id} prepared`,prepared&&!!state.preparedContext?.browsers.some(b=>b.id===id)] as [string,boolean]),['Onda verified',prepared],['All Courts verified',prepared],['Selected slots: 0',prepared],['Payment holds: none',prepared&&!state.lock],['Automation lock clear',!state.lock],['Prepared fingerprint matches',prepared],['Terms authorized for this run',state.termsAuthorized||armed],['Armed for next release',armed]];
  const readiness=byId('release-readiness');readiness.replaceChildren(...gates.map(([label,ok])=>{const e=document.createElement('div');e.className=`gate ${ok?'good':'warn'}`;e.textContent=`${ok?'OK':'--'} ${label}`;return e;}));readiness.className='gate-list';
  byId('release-readiness-card').dataset.state=armed?'armed':prepared?'prepared':'draft';byId('sleep-warning').hidden=!armed;byId('sleep-warning').textContent=`Sleep protection: ${state.sleepProtection?'ACTIVE':'NOT AVAILABLE'} | Keep the PC powered on. Do not hibernate or close the laptop lid if Windows sleeps on lid close.`;
  syncViableControls();tick();
}
function tick() {
  // Display only; never launches a command. Authoritative release plan comes from main/CLI.
  const now=new Date();
  byId('clock').textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Manila', hourCycle: 'h23' }).format(now);
  byId('clock-date').textContent = new Intl.DateTimeFormat('en-US', { weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'Asia/Manila' }).format(now);
  if (!latest) return;
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
  const release = latest.scheduledRelease?.releaseMs??(latest.plan && ['observe','dry','selection','full'].includes(latest.operation) ? latest.plan.releaseMs : latest.clock.releaseMs);
  const seconds = Math.max(0, Math.ceil((release - Date.now()) / 1000));
  byId('countdown').textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(v => String(v).padStart(2, '0')).join(':');
  byId('next-release-countdown').textContent=byId('countdown').textContent;
  byId('countdown-label').textContent = latest.operation === 'observe' ? 'SCHEDULED RELEASE IN' : 'NEXT RELEASE IN';
  const hold=latest.bookingResult?null:latest.handoff;
  if(hold){
    const [m,s]=hold.countdown.split(':').map(Number);const elapsed=(Date.now()-Date.parse(hold.verifiedAt))/1000;const active=elapsed<m!*60+s!;
    byId('handoff-result').textContent=`${active?'PAYMENT HOLD ACTIVE — VERIFIED AT HANDOFF':'HOLD NEEDS MANUAL REVIEW'}\nVenue: Thirsty Pickle | SM Seaside\nCourt ${hold.court} · ${hold.date}\nTime: ${hold.hours[0]}–${String(Number(hold.hours.at(-1)!.slice(0,2))+1).padStart(2,'0')}:00\nAmount: ₱${hold.amount.toLocaleString()}\nLast observed status: Pending\nHold countdown at verification: ${hold.countdown}\nVerified: ${new Date(hold.verifiedAt).toLocaleString('en-GB',{timeZone:'Asia/Manila'})}\n${active?'Complete payment manually in Chrome.':'The observed countdown has elapsed. Check Chrome manually.'}\nAUTOMATION STOPPED · AUTOMATION LOCK RETAINED`;
  }
}
 for (const [id, action] of Object.entries({ 'review-lock':()=>window.thirsty.reviewLock(),'clear-lock':()=>window.thirsty.clearLock(),'reset-practice':()=>window.thirsty.resetPractice(),'dual-prepare':()=>window.thirsty.prepareDual(),'api-preview':()=>window.thirsty.apiPreview(input('api-dry-date').value),'full-practice':async()=>{const authorized=input('full-terms').checked;input('full-terms').checked=false;await window.thirsty.runFullPractice({target:{date:input('full-date').value,court:Number(input('full-court').value),start:input('full-start').value,duration:Number(input('full-duration').value)},maximum:Number(input('full-maximum').value),authorizeTerms:authorized as true});}, chrome: () => window.thirsty.startChrome(), inspect: () => window.thirsty.inspectOnda(), prepare: async () => {input('terms').checked=false;storeDraft();await window.thirsty.resetPrepare(workflow==='test'?{workflow:'test',...testRequest()}:{workflow:'release',strategy:input('booking-type').value as 'standard'|'extended',setup:currentSetup()});const state=await window.thirsty.getStatus();if(state.ready){if(workflow==='test')testDirty=false;else releaseDirty=false;dirty=false;}render(state);}, arm: () => window.thirsty.armFullBooking(), dry:()=>window.thirsty.dryRace(), observe:()=>window.thirsty.armObservation(), stop: () => window.thirsty.abortAutomation(), practice:()=>window.thirsty.runPractice({date:input('practice-date').value,court:Number(input('practice-court').value),start:input('practice-start').value,duration:Number(input('practice-duration').value)}) })) {
  byId(id).addEventListener('click', () => { void action().catch(async() => { render(await window.thirsty.getStatus()); }); });
}
byId('full-terms').addEventListener('change',()=>{if(latest)render(latest);});
for(const id of ['full-date','full-court','full-start','full-duration','full-maximum'])byId(id).addEventListener('change',()=>{input('full-terms').checked=false;if(latest)render(latest);});
byId('mode-full').addEventListener('change',()=>{void window.thirsty.setMode('full').catch(()=>{});});
byId('mode-selection').addEventListener('change',()=>{void window.thirsty.setMode('selection').catch(()=>{});});
byId('terms').addEventListener('change',()=>{void window.thirsty.authorizeTerms(input('terms').checked).catch(()=>{input('terms').checked=false;});});
 for(const id of ['booking-method','test-date','court-count','start-time','duration','maximum','attempts','exact-a','exact-b'])byId(id).addEventListener('change',changed);
byId('booking-type').addEventListener('change',()=>{const extended=input('booking-type').value==='extended',d=Number(input('duration').value);if(extended&&d<4)input('duration').value='4';if(!extended&&d>3)input('duration').value='3';syncViableControls();changed();});
byId('add-fallback').onclick=()=>{const h=input('fallback-time').value;if(h===input('start-time').value||fallbackTimes.includes(h)){byId('edit-status').textContent='Choose a different fallback start.';return;}if(workflow==='release'){const reconciliation=reconcileFallbackTimes(input('start-time').value,Number(input('duration').value),[...fallbackTimes,h]);if(reconciliation.removed.length){releaseAdjustment=reconciliation;byId('edit-status').textContent=bookingSetupProblem({...currentSetup(),FALLBACK_TIMES:[...fallbackTimes,h]})??'That fallback does not fit the current booking.';if(latest)render(latest);return;}}fallbackTimes.push(h);editors();changed();};
byId('save-booking').onclick=()=>{void(async()=>{
   const setup:BookingSetup={BOOKING_METHOD:input('booking-method').value as 'browser'|'hybrid'|'api-first',BOOKING_TYPE:input('booking-type').value as 'standard'|'extended',COURT_COUNT:Number(input('court-count').value) as 1|2,START_TIME:input('start-time').value,DURATION_HOURS:Number(input('duration').value),PREFERRED_COURTS:courtOrder,FALLBACK_COURTS:[],FALLBACK_TIMES:fallbackTimes,MAX_PRICE:Number(input('maximum').value),MAX_SELECTION_ATTEMPTS:Number(input('attempts').value)};
  await window.thirsty.saveBooking(setup);const state=await window.thirsty.getStatus();
  if(state.headline==='Booking plan saved'){releaseDirty=false;if(workflow==='release')dirty=false;loadedPlan='';byId('edit-status').textContent='BOOKING PLAN SAVED';render(state);}else byId('edit-status').textContent='Plan rejected. Check duration and unique times.';
})().catch(()=>{byId('edit-status').textContent='Could not save booking setup.';});};
byId('dual-dry').onclick=()=>{void window.thirsty.runDualPractice({kind:'dualDry',date:input('dual-date').value}).catch(()=>{});};
for(const [id,kind] of [['dual-selection','dualPractice'],['dual-full','dualFullPractice']] as const)byId(id).onclick=()=>{
  const authorized=input('dual-terms').checked;input('dual-terms').checked=false;
  void window.thirsty.runDualPractice({kind,input:{target:{date:input('dual-date').value,court:Number(input('dual-court-a').value),start:input('dual-start').value,duration:Number(input('dual-duration').value)},courtB:Number(input('dual-court-b').value),maximum:Number(input('dual-maximum').value),noncompetitive:input('dual-noncompetitive').checked as true,authorizeTerms:kind==='dualFullPractice'&&authorized,armed:kind==='dualFullPractice'}}).catch(()=>{});
};
for(const id of ['dual-date','dual-court-a','dual-court-b','dual-start','dual-duration','dual-maximum','dual-noncompetitive'])byId(id).addEventListener('change',()=>{input('dual-terms').checked=false;if(latest)render(latest);});
byId('dual-terms').addEventListener('change',()=>{if(latest)render(latest);});

for(const [id,mode] of [['workflow-test','test'],['workflow-release','release']] as const)byId(id).onclick=()=>{storeDraft();workflow=mode;if(mode==='test'&&testDraft)applyDraft(testDraft);if(mode==='release'&&releaseDraft)applyDraft(releaseDraft);dirty=mode==='test'?testDirty:releaseDirty;input('terms').checked=false;void window.thirsty.setWorkflow(mode);if(latest)render(latest);};
function testRequest(){return {method:input('booking-method').value as 'browser'|'hybrid'|'api-first',request:{strategy:input('booking-type').value as 'standard'|'extended',date:input('test-date').value,start:input('start-time').value,duration:Number(input('duration').value),courtCount:Number(input('court-count').value) as 1|2,priority:courtOrder,fallbackStarts:[...fallbackTimes],...((input('exact-a').value.trim()||input('exact-b').value.trim())?{exact:(input('booking-type').value==='extended'?['exact-a','exact-b']:['exact-a']).map(id=>input(id).value.split(',').map(v=>Number(v.trim())))}:{})},maximum:Number(input('maximum').value)};}
 function currentSetup():BookingSetup{return {BOOKING_METHOD:input('booking-method').value as 'browser'|'hybrid'|'api-first',BOOKING_TYPE:input('booking-type').value as 'standard'|'extended',COURT_COUNT:Number(input('court-count').value) as 1|2,START_TIME:input('start-time').value,DURATION_HOURS:Number(input('duration').value),PREFERRED_COURTS:courtOrder,FALLBACK_COURTS:[],FALLBACK_TIMES:fallbackTimes,MAX_PRICE:Number(input('maximum').value),MAX_SELECTION_ATTEMPTS:Number(input('attempts').value)};}
byId('test-booking').onclick=()=>{const authorized=input('terms').checked;input('terms').checked=false;void window.thirsty.testBooking({...testRequest(),authorizeTerms:authorized as true}).catch(()=>{byId('detail').textContent='Check booking fields and Terms authorization.';});};
window.thirsty.onStatus(render);
void window.thirsty.getStatus().then(render);
setInterval(tick, 100);
const activity=document.querySelector<HTMLElement>('.activity')!;
const expand=byId('activity-expand') as HTMLButtonElement;
function setActivityExpanded(value:boolean){activity.classList.toggle('expanded',value);expand.setAttribute('aria-expanded',String(value));expand.textContent=value?'Restore':'Maximize';}
expand.addEventListener('click',()=>setActivityExpanded(!activity.classList.contains('expanded')));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&activity.classList.contains('expanded'))setActivityExpanded(false);});
