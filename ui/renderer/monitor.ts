import type { Dashboard } from '../types.js';
import { el, fill, hooks, manilaTime, peso, onPane } from './navigation.js';
import { operationalState, releaseCountdown, attemptCounters, holdPresentation, operatorEventText, presentedHolds } from './operational-state.js';
import { pendingHoldRows, pendingHoldBusy, recover } from './pending-holds.js';

let latest: Dashboard | undefined, sampledAt = 0, clockSample='', signature = '', eventSignature = '', fallbackSignature='';
const byId = (id: string) => document.getElementById(id)!;
const text = (id: string, value: string) => { const e = byId(id); if (e.textContent !== value) e.textContent = value; };
function clockTick() {
  if (!latest) return;
  const op=operationalState(latest,pendingHoldRows(),Date.now()+(latest.clock?.clockOffsetMs??0));
  const hold=presentedHolds(latest,pendingHoldRows(),Date.now()+(latest.clock?.clockOffsetMs??0)).filter(r=>holdPresentation(r,Date.now()+(latest!.clock?.clockOffsetMs??0)).confirmed).sort((a,b)=>Date.parse(a.advertisedExpiry!)-Date.parse(b.advertisedExpiry!))[0];
  const holdSeconds=hold?Math.max(0,Math.ceil((Date.parse(hold.advertisedExpiry!)-Date.now()-(latest.clock?.clockOffsetMs??0))/1000)):0;
  const value = !op.active&&hold?`Hold expires in ${String(Math.floor(holdSeconds/60)).padStart(2,'0')}:${String(holdSeconds%60).padStart(2,'0')}${latest.clock?.networkSynced?'':' (local estimate)'}`:['DISPATCHING','WAITING FOR PROVIDER','STOPPING'].includes(op.label)?op.label:releaseCountdown(latest, performance.now() - sampledAt);
  text('monitor-countdown', value); text('operation-countdown', value);
  text('monitor-title',op.label);text('operation-label',op.label);
  text('live-run-state',op.label);
  if(!latest.live?.parents.length){text('live-result',op.label);text('live-guidance',op.detail);}
  byId('monitor-countdown').classList.toggle('inactive', !op.releaseMs&&!hold);
  // Expiry changes presentation only. It never establishes a terminal provider result.
  if (!byId('view-live').hidden && (pendingHoldRows().length||latest.qrHandoffs?.length)) renderHolds(latest);
  const now=Date.now()+(latest.clock?.clockOffsetMs??0);
  for(const node of document.querySelectorAll<HTMLElement>('[data-hold-expiry]')) {
    const seconds=Math.max(0,Math.ceil((Number(node.dataset.holdExpiry)-now)/1000));
    const value=`${seconds} s to advertised expiry`;
    if(node.textContent!==value)node.textContent=value;
  }
}
let holdsSignature = '';
function renderHolds(s: Dashboard) {
  const host = byId('monitor-holds'), now = Date.now() + (s.clock?.clockOffsetMs ?? 0);
  const rows = presentedHolds(s,pendingHoldRows(),now).filter(r => r.outstanding && (!r.advertisedExpiry || Date.parse(r.advertisedExpiry) > now));
  const possible=(s.possibleHolds??[]).filter(h=>Date.parse(h.holdExpiresAt)>now);
  const key = JSON.stringify([rows, rows.map(r=>holdPresentation(r,now).label), possible, s.operation,pendingHoldBusy()]);
  if (key === holdsSignature) return; holdsSignature = key;
  const review = el('button', { type: 'button', class: 'secondary compact', text: 'Review existing checkouts' });
  review.onclick = () => hooks.showView('records');
  fill(host, el('div', { class: 'section-title' }, el('h2', { text: 'Pending checkouts' }), review),
    ...rows.map(row => { const h = holdPresentation(row, now);
      const action=el('button',{type:'button',class:'secondary compact',text:'Recover Existing Checkout'});
      action.disabled=(!row.currentHandoff&&(s.operation!=='idle'||hooks.labRunning||pendingHoldBusy()))||!row.worker;
      action.textContent=row.currentHandoff?`Focus Browser ${row.worker}`:'Recover Existing Checkout';
      action.onclick=()=>{if(row.currentHandoff&&row.worker){void window.thirsty.focusBrowser({workerId:row.worker}).catch(()=>{action.textContent='Browser unavailable';});}else void recover(row.id,'original');};
      return el('article', { class: 'monitor-hold', 'data-tone': h.confirmed ? 'ok' : 'warn' },
        el('strong', { text: `Browser ${row.worker ?? '?'} · ${row.wing} Court ${row.courts.join(' + ')} · ${h.label}` }),
        el('p',{class:'small',text:row.currentHandoff?'Source: current official QR handoff':'Source: saved recovery evidence'}),
        el('p', { text: `${row.date} · ${row.start}–${row.end} · ${row.amount === null ? 'Amount unknown' : peso(row.amount)}` }),
        el('p', { class: 'small', text: `Provider: ${h.confirmed ? 'confirmed' : 'fresh confirmation required'} · QR: ${h.qrReady ? 'ready' : 'fresh verification required'} · ${Number.isFinite(h.remaining) ? `Advertised expiry ${manilaTime(Date.parse(row.advertisedExpiry!))} Manila` : 'Expiry unknown'}. Payment remains manual.` }),
        row.advertisedExpiry?el('p',{class:'small','data-hold-expiry':String(Date.parse(row.advertisedExpiry))}):null,action); }),
    possible.length?el('p',{class:'target-conflict',text:`${possible.length} possible unexpired checkout(s): ${possible.map(h=>`Court ${h.courts.join(' / ')} · ${h.date} · ${h.startTime}–${h.endTime} · advertised deadline ${manilaTime(Date.parse(h.holdExpiresAt))}`).join('; ')}. Provider status UNKNOWN. Review the original records before expiry; do not submit again.`}):null,
    !rows.length ? el('p', { class: 'small', text: 'No freshly confirmed active checkout in this view. Saved captures and expired or unresolved evidence remain in Activity → Records & archive.' }) : null,
    (s.qrHandoffs?.length ?? 0) > 0 ? el('p', { class: 'small', text: 'Local response validation alone does not establish provider confirmation. Fresh official handoff evidence and existing-checkout recovery are shown separately.' }) : null);
}
export function renderMonitor(s: Dashboard, freshSample=true) {
  latest = s;
  const sample=JSON.stringify([s.clock?.releaseMs,s.clock?.remainingMs,s.clock?.networkSynced,s.clock?.clockSynchronizedAt]);
  if(freshSample&&sample!==clockSample){clockSample=sample;sampledAt=performance.now();}
  const now = Date.now() + (s.clock?.clockOffsetMs ?? 0), rows = presentedHolds(s,pendingHoldRows(),now), op = operationalState(s,rows,now);
  const confirmed = rows.filter(r => holdPresentation(r, now).confirmed), recovered=confirmed.filter(r=>!r.currentHandoff), qr = recovered.filter(r => holdPresentation(r, now).qrReady),currentQr=confirmed.filter(r=>r.currentHandoff);
  const label = op.label;
  text('monitor-title', label); text('monitor-guidance', op.detail);
  text('operation-label', label); text('activity-operation', label);
  byId('operation-indicator').hidden = !op.active && !confirmed.length;
  byId('operation-indicator').dataset.tone = op.tone;
  byId('monitor-stop').hidden = !op.active && s.operation !== 'stopping';
  byId('monitor-stop-note').hidden = byId('monitor-stop').hidden;
  text('monitor-clock-note', `${op.releaseMs ? `${manilaTime(op.releaseMs, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })} Asia/Manila · ` : ''}${s.clock?.networkSynced ? `Trusted controller clock · ${s.clock.clockQuality ?? 'quality unavailable'}` : 'Network clock not synchronized · release countdown unavailable; hold time is a local estimate'}`);
  const setup = s.booking?.setup, c = attemptCounters(s);
  const facts = op.availableNow?[['Current booking date',op.targetDate??'Awaiting current request evidence'],['Wing',op.currentTarget?.wing??'Awaiting current run evidence'],['Operation','Available Now'],['Prepared request reference',op.fingerprint??'Not published'],['Prepared / observed browsers',op.workers.join(' · ')||'Not yet reported']]:!op.active&&confirmed.length&&!setup ? [['Booking date',confirmed[0]!.date],['Wing',confirmed[0]!.wing],['Operation','Existing checkout recovery'],['Saved authorization','Original immutable recovery record'],['Checkout browser',confirmed.map(r=>r.worker??'?').join(' · ')]] : [['Booking date', op.targetDate ?? 'No saved plan'], ['Wing', setup?.STRATEGY_V2?.objective ? Object.entries(setup.STRATEGY_V2.objective.wings ?? {}).filter(([, w]) => (w as { enabled?: boolean }).enabled).map(([w]) => w).join(' + ') || 'MANGO' : 'MANGO'],
    ['Strategy', setup?.STRATEGY_V2?.shotgun?.enabled ? 'Shotgun' : setup?.RELEASE_STRATEGY === 'precision' ? 'Precision' : setup?.BOOKING_TYPE ?? '—'],
    ['Saved authorization', op.fingerprint ?? 'None'], ['Required browsers', op.workers.join(' · ') || 'None']];
  const key = JSON.stringify([facts, c, recovered.length, qr.length,currentQr.length, s.ready]);
  if (key !== signature) {
    signature = key;
    fill(byId('monitor-plan'), ...facts.map(([k, v]) => el('div', {}, el('dt', { text: k! }), el('dd', { text: v! }))));
    let counters = document.getElementById('monitor-counters');
    if (!counters) { counters = el('div', { id: 'monitor-counters', class: 'live-overview' }); byId('live-attempt-counts').after(counters); }
    fill(counters, ...Object.entries({ 'Recovery confirmed': recovered.length, 'Recovery QR ready': qr.length,'Current official QR':currentQr.length,...(!op.availableNow||s.live?.parents.length?{Armed:c.armed,UNKNOWN:c.unknown,Rejected:c.rejected,'Internal failure':c.failed,'Definitively unsent':c.unsent}:{}) })
      .map(([k, v]) => el('div', {}, el('span', { text: k }), el('strong', { text: String(v) }))));
  }
  // Existing live.ts renders observed workers. Before the first attempt, show the frozen authorization's workers.
  if (!s.live?.parents.length && op.workers.length) {
    const host = byId('live-workers'); host.hidden = false;
    const fallbackKey=JSON.stringify([op.workers,op.label,s.browserHealth,s.ready,setup?.PRECISION_PHASE3,op.availableNow,op.currentTarget]);
    if(fallbackKey!==fallbackSignature){fallbackSignature=fallbackKey;
    fill(host, ...op.workers.map(w => { const focus = el('button', { type: 'button', class: 'secondary compact', text: `Focus Browser ${w}` });
      focus.disabled = !s.browserHealth?.[w]; focus.onclick = () => { void window.thirsty.focusBrowser({ workerId: w }).catch(() => { focus.textContent = 'Browser unavailable'; }); };
      const assigned = op.availableNow?[op.currentTarget?.workerId===w&&op.currentTarget.court?`Court ${op.currentTarget.court} · ${op.currentTarget.startTime??'Time not yet reported'}`:'Current request · court assignment not yet reported']:setup?.PRECISION_PHASE3?.wave1.filter(a => a.workerId === w).map(a => { const t = setup.PRECISION_PHASE3!.candidates[a.candidateIndex]; return t ? `Court ${t.court} · ${t.start} · ${t.durationHours} h · ${a.fanOutOffsetsMs?.length ?? 1} attempt(s)` : 'Target unavailable'; });
      return el('li', { 'data-tone': s.browserHealth?.[w] ? 'running' : 'warn' }, el('strong', { text: `Browser ${w}` }), el('span', { text: assigned?.join(' / ') || 'Saved plan allocation' }), el('span', { text: `${s.browserHealth?.[w] ? 'Connected' : 'Missing browser'} · ${op.active ? op.label : s.ready ? 'Prepared' : 'Not prepared'}` }), focus); }));}
  } else fallbackSignature='';
  const events = [...new Map((s.logs ?? []).filter(e => !s.runTiming || Date.parse(e.at) >= Date.parse(s.runTiming.startedAt)).map(e => [`${e.at}:${e.text}`, e])).values()].slice(-80);
  const eventKey = JSON.stringify(events);
  if (eventKey !== eventSignature) {
    eventSignature = eventKey;
    const host = byId('monitor-events'), oldScroll = host.scrollTop;
    fill(host, ...events.map(e => el('li', {}, el('time', { datetime: e.at, text: manilaTime(Date.parse(e.at), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }), el('span', { text: operatorEventText(e.text,s) }))),
      !events.length ? el('li', { class: 'empty', text: 'No recorded events for this operation yet.' }) : null);
    host.scrollTop = oldScroll;
  }
  renderHolds(s); clockTick();
}
export function initMonitor() {
  byId('operation-indicator').onclick = () => hooks.showView('live');
  byId('monitor-stop').onclick = () => { void window.thirsty.abortAutomation().catch(() => undefined); };
  setInterval(clockTick, 250);
  document.addEventListener('pending-holds:updated',()=>{if(latest)renderMonitor(latest,false);});
  onPane(pane => { if (pane === 'live' && latest) clockTick(); });
}
