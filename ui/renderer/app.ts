import type { Bridge, Dashboard } from '../types.js';
import type { BookingSetup } from '../../src/config.js';
declare global { interface Window { thirsty: Bridge } }
const byId = (id: string) => document.getElementById(id)!;
let latest: Dashboard | undefined;
let renderedLogs = '';
let dirty=false, loadedPlan='';
let courtOrder=[7,6,5,4,3,2,1], fallbackTimes:string[]=[];
const input=(id:string)=>byId(id) as HTMLInputElement;
const friendly=(h:string)=>`${Number(h.slice(0,2))%12||12}:00 ${Number(h.slice(0,2))<12?'AM':'PM'}`;
const hours=Array.from({length:16},(_,i)=>`${String(i+8).padStart(2,'0')}:00`);
for(const id of ['start-time','fallback-time','practice-start','full-start']) (byId(id) as HTMLSelectElement).replaceChildren(...hours.map(h=>new Option(friendly(h),h)));
(byId('practice-court') as HTMLSelectElement).replaceChildren(...Array.from({length:7},(_,i)=>new Option(`Court ${i+1}`,String(i+1))));
input('practice-date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
(byId('full-court') as HTMLSelectElement).replaceChildren(...Array.from({length:7},(_,i)=>new Option(`Court ${i+1}`,String(i+1))));
input('full-date').value=input('practice-date').value;
function changed(){dirty=true;void window.thirsty.authorizeTerms(false).catch(()=>{});byId('edit-status').textContent='Unsaved changes · save before preparing';if(latest)render(latest);}
function editors(){
  const draw=(id:string,items:(string|number)[],fallback:boolean)=>byId(id).replaceChildren(...items.map((item,index)=>{
    const li=document.createElement('li'),label=document.createElement('span');label.textContent=fallback?friendly(String(item)):`Court ${item}`;li.append(label);
    for(const [text,offset] of [['↑',-1],['↓',1]] as const){const button=document.createElement('button');button.textContent=text;button.setAttribute('aria-label',`Move ${label.textContent} ${offset<0?'up':'down'}`);button.disabled=index+offset<0||index+offset>=items.length;button.onclick=()=>{const other=index+offset;[items[index],items[other]]=[items[other]!,items[index]!];editors();changed();};li.append(button);}
    if(fallback){const remove=document.createElement('button');remove.textContent='Remove';remove.onclick=()=>{fallbackTimes.splice(index,1);editors();changed();};li.append(remove);}
    return li;
  }));draw('court-order',courtOrder,false);draw('fallback-order',fallbackTimes,true);
}
editors();
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
function status(id: string, text: string, tone: string) { const el = byId(id); el.textContent = text; el.dataset.tone = tone; }
function render(state: Dashboard) {
  latest = state;
  byId('headline').textContent = state.headline; byId('detail').textContent = state.detail;
  const busy = state.operation !== 'idle';
  const full=state.mode==='full',fullReady=state.capabilities.selectionReady&&state.capabilities.checkoutReady&&state.capabilities.paymentBoundaryReady;
  input('mode-full').checked=full;input('mode-selection').checked=!full;
  input('mode-full').disabled=busy||!fullReady;input('mode-selection').disabled=busy;
  input('terms').disabled=busy||state.lock||dirty||!full||!fullReady;
  byId('mode-label').textContent=full?'FULL BOOKING TO QR':'SELECTION ONLY';
  byId('prepare').firstChild!.textContent=full?'Prepare Full Booking ':'Prepare Selection ';
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
  const review=state.lockReview;
  byId('lock-review').textContent=review?`Run ID: ${review.runID}\nPID: ${review.pid??'Unknown'}\nProcess: ${review.alive===null?'Unknown':review.alive?'Running':'Not running'}\nUI-owned worker: ${review.owned?'Running':'None'}\nBrowser state: ${review.canClear?'Safe at last review':'Needs verification'}\nCurrent page: ${review.page}\nSelected slots: ${review.selected??'Unknown'}\nPayment hold: ${review.hold}\nReason: ${review.reason}\nChecked: ${review.verifiedAt}`:'Browser state: Needs verification. Use Review Lock.';
  const reason=busy?'An operation is running.':state.lock?'Blocked because an automation lock exists. Use Review Lock.':dirty?'Blocked because booking plan has unsaved changes.':!state.booking?'Player information or booking configuration is invalid.':!state.cdp?'Blocked because Chrome is not prepared.':!state.clock?.canArmToday?"Blocked because today?s 08:00 release has passed or preflight time is too short.":full&&!state.termsAuthorized?'Terms authorization is required for Full Booking.':'';
  byId('blocked-reason').textContent=reason;
  for(const id of ['inspect','prepare','arm','dry','observe'])byId(id).title=reason;
  byId('chrome').title=state.lock?'Starts or reuses dedicated Chrome for read-only lock review.':'Starts or reuses dedicated Chrome.';
  (byId('full-practice') as HTMLButtonElement).disabled=busy||state.lock||!state.cdp||!state.booking?.playerConfigured||!fullReady||!input('full-terms').checked;
  (byId('practice') as HTMLButtonElement).disabled=busy||state.lock||!state.cdp;
  byId('practice-blocked').textContent=state.lock?'Blocked because an automation lock exists. Use Review Lock.':!state.cdp?'Start / Attach Chrome first.':!state.booking?.playerConfigured?'Player information is missing.':!fullReady?'Full Booking capability is not verified.':!input('full-terms').checked?'Terms authorization is required for this practice run.':'';
  (byId('prepare') as HTMLButtonElement).disabled=busy||state.lock||dirty||!state.booking;
  (byId('arm') as HTMLButtonElement).disabled = busy || dirty || state.lock || !state.booking || !state.capabilities.selectionReady || !state.cdp || !state.clock?.canArmToday || (full&&(!fullReady||!state.termsAuthorized));
  (byId('dry') as HTMLButtonElement).disabled=busy||dirty||state.lock||!state.booking||!state.clock?.canArmToday;
  (byId('observe') as HTMLButtonElement).disabled=busy||state.lock||!state.clock?.canArmToday;
  input('terms').checked=state.termsAuthorized;
  byId('player-status').textContent=`Player information · ${state.booking?.playerConfigured?'Configured ✓':'Missing / configuration invalid'}`;
  byId('capability-status').textContent=`Selection ${state.capabilities.selectionReady?'ready':'unverified'} · checkout ${state.capabilities.checkoutReady?'verified':'unverified'} · payment handoff ${state.capabilities.paymentBoundaryReady?'verified':'unverified'}`;
  const b=state.booking;
  if(b){
    if(!dirty && loadedPlan!==b.fingerprint){loadedPlan=b.fingerprint;input('start-time').value=b.setup.START_TIME;input('duration').value=String(b.setup.DURATION_HOURS);input('maximum').value=String(b.setup.MAX_PRICE);input('attempts').value=String(b.setup.MAX_SELECTION_ATTEMPTS);courtOrder=[...b.setup.PREFERRED_COURTS];fallbackTimes=[...b.setup.FALLBACK_TIMES];editors();}
    byId('booking-preview').textContent=`TARGET  ${dateLabel(b.targetDate)}\nREQUIRED SLOTS  ${b.slots.join(' · ')}\nCOURT ORDER  ${b.setup.PREFERRED_COURTS.join(' → ')}\nFALLBACK STARTS  ${b.setup.FALLBACK_TIMES.map(friendly).join(' → ')||'None'}\nMAXIMUM  ₱${b.setup.MAX_PRICE.toLocaleString()} · ${b.setup.MAX_SELECTION_ATTEMPTS} candidate attempts\nPLAYER  Configured ✓`;
  }
  const result=state.selection;byId('selection-result').hidden=!result||!!state.handoff;
  if(result)byId('selection-result').textContent=`SLOTS SELECTED\nCourt ${result.court} · ${result.date}\nHours: ${result.hours.join(', ')} · ${result.hours.length} slots\n₱${result.amount.toLocaleString()} · Proceed READY\n${full?'Selection is not yet a hold. See current checkout stage above.':'AUTOMATION STOPPED BEFORE PROCEED\nUSER CONTROL RESTORED'}`;
  byId('handoff-result').hidden=!state.handoff;
  byId('readiness').className = `readiness ${state.ready ? 'ready' : state.operation === 'observe' ? 'armed' : ''}`;
  status('cdp', state.cdp ? 'Reachable locally' : 'Not connected', state.cdp ? 'good' : 'warn');
  status('lock', state.lock ? (busy ? 'Active' : 'Exists · check manually') : 'Clear', state.lock ? 'warn' : 'good');
  const i = state.inspection;
  const fresh = !!i && state.cdp && Date.now() - Date.parse(i.verifiedAt) < 60000;
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
    byId('target-date').textContent = dateLabel(state.plan?.targetDate ?? state.booking?.targetDate ?? state.clock.targetDate);
    byId('safe-config').textContent = `Horizon ${state.clock.horizon} days · lead ${state.clock.leadMs} ms · max ${state.clock.maxReloads} reloads`;
  }
  const signature = JSON.stringify(state.logs);
  if (signature !== renderedLogs) {
    renderedLogs = signature; const log = byId('log'); const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
    if (state.logs.length) log.replaceChildren(...state.logs.map(line => {
      const p = document.createElement('p'); p.className = line.level;
      const time = document.createElement('time'); time.textContent = new Date(line.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila' });
      p.append(time, document.createTextNode(line.text)); return p;
    }));
    if (atBottom) log.scrollTop = log.scrollHeight;
  }
  byId('activity-state').textContent = busy ? `${state.operation.toUpperCase()} · PROCESS ACTIVE` : 'LOCAL PROCESS OUTPUT';
  tick();
}
function tick() {
  // Display only; never launches a command. Authoritative release plan comes from main/CLI.
  if (!latest?.clock) return;
  byId('clock').textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Manila', hourCycle: 'h23' }).format(new Date());
  const release = latest.plan && ['observe','dry','selection','full'].includes(latest.operation) ? latest.plan.releaseMs : latest.clock.releaseMs;
  const seconds = Math.max(0, Math.ceil((release - Date.now()) / 1000));
  byId('countdown').textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(v => String(v).padStart(2, '0')).join(':');
  byId('countdown-label').textContent = latest.operation === 'observe' ? 'SCHEDULED RELEASE IN' : 'NEXT RELEASE IN';
  const hold=latest.handoff;
  if(hold){
    const [m,s]=hold.countdown.split(':').map(Number);const elapsed=(Date.now()-Date.parse(hold.verifiedAt))/1000;const active=elapsed<m!*60+s!;
    byId('handoff-result').textContent=`${active?'PAYMENT HOLD ACTIVE — VERIFIED AT HANDOFF':'HOLD NEEDS MANUAL REVIEW'}\nVenue: Thirsty Pickle | SM Seaside\nCourt ${hold.court} · ${hold.date}\nTime: ${hold.hours[0]}–${String(Number(hold.hours.at(-1)!.slice(0,2))+1).padStart(2,'0')}:00\nAmount: ₱${hold.amount.toLocaleString()}\nLast observed status: Pending\nHold countdown at verification: ${hold.countdown}\nVerified: ${new Date(hold.verifiedAt).toLocaleString('en-GB',{timeZone:'Asia/Manila'})}\n${active?'Complete payment manually in Chrome.':'The observed countdown has elapsed. Check Chrome manually.'}\nAUTOMATION STOPPED · AUTOMATION LOCK RETAINED`;
  }
}
for (const [id, action] of Object.entries({ 'review-lock':()=>window.thirsty.reviewLock(),'clear-lock':()=>window.thirsty.clearLock(),'full-practice':async()=>{const authorized=input('full-terms').checked;input('full-terms').checked=false;await window.thirsty.runFullPractice({target:{date:input('full-date').value,court:Number(input('full-court').value),start:input('full-start').value,duration:Number(input('full-duration').value)},maximum:Number(input('full-maximum').value),authorizeTerms:authorized as true});}, chrome: () => window.thirsty.startChrome(), inspect: () => window.thirsty.inspectOnda(), prepare: () => window.thirsty.prepare(), arm: () => latest?.mode==='full'?window.thirsty.armFullBooking():window.thirsty.armSelection(), dry:()=>window.thirsty.dryRace(), observe:()=>window.thirsty.armObservation(), stop: () => window.thirsty.abortAutomation(), practice:()=>window.thirsty.runPractice({date:input('practice-date').value,court:Number(input('practice-court').value),start:input('practice-start').value,duration:Number(input('practice-duration').value)}) })) {
  byId(id).addEventListener('click', () => { void action().catch(() => { byId('detail').textContent = 'Command refused or unavailable. Check activity and the current process status.'; }); });
}
byId('full-terms').addEventListener('change',()=>{if(latest)render(latest);});
for(const id of ['full-date','full-court','full-start','full-duration','full-maximum'])byId(id).addEventListener('change',()=>{input('full-terms').checked=false;if(latest)render(latest);});
byId('mode-full').addEventListener('change',()=>{void window.thirsty.setMode('full').catch(()=>{});});
byId('mode-selection').addEventListener('change',()=>{void window.thirsty.setMode('selection').catch(()=>{});});
byId('terms').addEventListener('change',()=>{void window.thirsty.authorizeTerms(input('terms').checked).catch(()=>{input('terms').checked=false;});});
for(const id of ['start-time','duration','maximum','attempts'])byId(id).addEventListener('change',changed);
byId('add-fallback').onclick=()=>{const h=input('fallback-time').value;if(h===input('start-time').value||fallbackTimes.includes(h)){byId('edit-status').textContent='Choose a different fallback start.';return;}fallbackTimes.push(h);editors();changed();};
byId('save-booking').onclick=()=>{void(async()=>{
  const setup:BookingSetup={START_TIME:input('start-time').value,DURATION_HOURS:Number(input('duration').value),PREFERRED_COURTS:courtOrder,FALLBACK_COURTS:[],FALLBACK_TIMES:fallbackTimes,MAX_PRICE:Number(input('maximum').value),MAX_SELECTION_ATTEMPTS:Number(input('attempts').value)};
  await window.thirsty.saveBooking(setup);const state=await window.thirsty.getStatus();
  if(state.headline==='Booking plan saved'){dirty=false;loadedPlan='';byId('edit-status').textContent='BOOKING PLAN SAVED';render(state);}else byId('edit-status').textContent='Plan rejected. Check duration, unique times and price.';
})().catch(()=>{byId('edit-status').textContent='Could not save booking setup.';});};
window.thirsty.onStatus(render);
void window.thirsty.getStatus().then(render);
setInterval(tick, 1000);
