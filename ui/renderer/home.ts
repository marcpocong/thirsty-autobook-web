import { pendingHoldRows } from './pending-holds.js';
import { operationalState, presentedHolds, holdPresentation } from './operational-state.js';
import type { Dashboard } from '../types.js';
import { enabledWings } from '../../src/booking-objective.js';
import { capabilityMatrix, METHOD_LABEL, STRATEGY_LABEL } from '../../src/capability-matrix.js';
import { nextReleaseFor, WING_RELEASE_POLICIES } from '../../src/wing-release-data.js';
import { bookingSetupState, dashboardPreflight } from './booking-setup.js';
import { planWorkerIds } from '../../src/workers.js';
import { hooks, el, fill, manilaTime, dateText, wingName, onRender, peso } from './navigation.js';

/** Home: what happens next, what is saved, what is ready and what needs a person. Read-only. */
let journals: { activeUnknown: number; archived: number; checkedAt: number } | null = null;
const byId = (id: string) => document.getElementById(id)!;
async function refreshJournals() {
  try { const o = await window.thirsty.journalArchive({ action: 'overview' }) as { activeUnknown: unknown[]; archived: unknown[] }; journals = { activeUnknown: o.activeUnknown.length, archived: o.archived.length, checkedAt: Date.now() }; }
  catch { journals = null; }
}
export function initHome() {
  void refreshJournals();
  setInterval(() => { void refreshJournals(); }, 5 * 60_000);
  onRender(renderHome);
  renderSettings();
}
/** Settings: the configured release calendar with evidence status, and the full capability matrix. */
function renderSettings() {
  fill(byId('release-verification'), el('dl', { class: 'fact-grid' }, ...(['MANGO', 'BUKO'] as const).flatMap(w => { const p = WING_RELEASE_POLICIES[w];
    return [el('dt', { text: `${wingName(w)} release` }), el('dd', { text: p ? `${p.releaseTime.slice(0, 5)} Manila · booking date +${p.horizonOffsetDays} days · ${(p.status ?? 'UNKNOWN').replace('_', ' ')} — ${p.evidence}` : 'Unknown' })]; })),
    el('p', { class: 'small', text: 'OWNER ASSUMED and PROVISIONAL are used for planning and offline rehearsal only and are never upgraded automatically. Buko live scheduled booking stays offline-only until the Buko 08:00 release transition is observed and Buko proofless checkout is verified; book open Buko dates with Available Now.' }));
  const rows = capabilityMatrix(1);
  fill(byId('capability-matrix'), el('div', { class: 'table-scroll' }, el('table', { class: 'attempt-table', id: 'capability-table' }, el('thead', {}, el('tr', {}, ...['Mode', 'Strategy', 'Checkout', 'Wing', 'Status', 'Reason'].map(h => el('th', { text: h })))),
    el('tbody', {}, ...rows.map(r => el('tr', { 'data-status': r.verdict.status }, el('td', { text: r.mode === 'AVAILABLE_NOW' ? 'Available Now' : 'Next Release' }), el('td', { text: STRATEGY_LABEL[r.strategy] }), el('td', { text: METHOD_LABEL[r.method] }), el('td', { text: wingName(r.wing) }),
      el('td', { text: r.verdict.status.replace('_', ' ') }), el('td', { class: 'small', text: r.verdict.reasons[0] ?? '' })))))), el('p', { class: 'small', text: 'Shown for one court per wing. Mango Browser/Hybrid support at most two courts; Buko accepts one exact court per checkout, so more Buko courts run as separate checkouts.' }));
}
const countdown = (ms: number) => { if (ms <= 0) return 'now'; const h = Math.floor(ms / 3_600_000), m = Math.floor(ms % 3_600_000 / 60_000); return h ? `in ${h} h ${m} min` : `in ${m} min`; };
export function renderHome(state: Dashboard) {
  const now = Date.now(), setup = bookingSetupState(), mango = nextReleaseFor(now, 'MANGO'), buko = nextReleaseFor(now, 'BUKO');
  fill(byId('home-release-body'), el('strong', { class: 'home-big', text: manilaTime(mango.releaseMs) }), el('p', { class: 'small', text: `Manila · ${countdown(mango.releaseMs - now)} · network clock ${state.clock?.networkSynced ? 'synchronized' : 'not synchronized (synced again automatically when arming)'}` }),
    el('dl', { class: 'fact-grid compact-facts' }, el('dt', { text: 'Mango date' }), el('dd', { text: `${dateText(mango.bookingDate)} · ${WING_RELEASE_POLICIES.MANGO?.status ?? 'UNKNOWN'}` }),
      el('dt', { text: 'Buko date' }), el('dd', { text: `${dateText(buko.bookingDate)} · ${(WING_RELEASE_POLICIES.BUKO?.status ?? 'UNKNOWN').replace('_', ' ')}${buko.releaseMs !== mango.releaseMs ? ` · releases ${manilaTime(buko.releaseMs)}` : ''}` })));
  const o = setup.objective, v = setup.view, compiled = setup.compiled;
  fill(byId('home-goal-body'), ...(setup.documentSaved || v ? [el('strong', { text: `${o.mode === 'AVAILABLE_NOW' ? 'Available Now' : 'Next Release'} · ${STRATEGY_LABEL[o.strategy]}` }),
    el('ul', { class: 'plain-list' }, ...enabledWings(o).map(w => el('li', { text: `${wingName(w)} ${dateText(o.wings[w].bookingDate)} · ${o.quotaScope === 'PER_WING' ? `${o.wings[w].minimum === o.wings[w].ideal ? o.wings[w].ideal : `${o.wings[w].minimum}–${o.wings[w].ideal}`} court(s)` : 'shared quota'} · courts ${[...o.wings[w].courts].sort((a, b) => a.priority - b.priority).map(c => c.court).join(', ')} · ${o.wings[w].startTimes.join(' / ')}` }))),
    el('p', { class: 'small', text: setup.documentSaved ? `Draft saved ${manilaTime(Date.parse(setup.documentSaved.savedAt))}` : 'Not saved yet' })] : [el('p', { class: 'small', text: 'Loading…' })]));
  fill(byId('home-state-body'), el('span', { class: 'state-badge', 'data-tone': v?.tone ?? 'muted', text: v?.label ?? '—' }), el('p', { class: 'small', text: v?.detail ?? '' }),
    state.activeApiRelease ? el('p', { class: 'small', text: `Armed for ${manilaTime(state.activeApiRelease.releaseMs)} · ${state.activeApiRelease.phase}` }) : state.scheduledRelease ? el('p', { class: 'small', text: 'A scheduled release is armed.' }) : null,
    el('p', { class: 'small muted', text: `Live capability for this goal: ${compiled.liveStatus.replace('_', ' ')}` }));
  const health: Partial<Record<string, boolean>> = state.browserHealth ?? {}, needed = new Set(o.mode==='NEXT_RELEASE'&&state.booking?planWorkerIds(state.booking.setup):[...compiled.normalSteps.flatMap(s => s.workers), ...(compiled.cohorts[0]?.smart?.phase3?.wave1.map(a => a.workerId) ?? [])]);
  fill(byId('home-browsers-body'), el('div', { class: 'browser-dots' }, ...(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const).map(w => el('span', { class: 'browser-dot', 'data-open': String(!!health[w]), 'data-needed': String(needed.has(w)), title: `Browser ${w}${needed.has(w) ? ' · needed by this plan' : ''} · ${health[w] ? 'open' : 'not running'}`, text: w }))),
    el('p', { class: 'small', text: `${[...needed].filter(w => health[w]).length}/${needed.size} needed browsers open · ${state.ready ? 'prepared' : 'not prepared'} · availability uses its own read-only observer` }));
  const holds = (state.qrHandoffs ?? []).filter(h => h.holdExpiresAt && Date.parse(h.holdExpiresAt) > now);
  const currentHolds=presentedHolds(state,pendingHoldRows(),now).filter(r=>r.outstanding&&r.advertisedExpiry&&Date.parse(r.advertisedExpiry)>now);
  fill(byId('home-holds-body'), currentHolds.length ? el('ul', { class: 'plain-list' }, ...currentHolds.map(h => el('li', { text: `${wingName(h.wing)} Court ${h.courts.join(' + ')} · ${dateText(h.date)} ${h.start}–${h.end} · ${h.amount===null?'Amount unknown':peso(h.amount)} · ${holdPresentation(h,now).label} · advertised expiry ${manilaTime(Date.parse(h.advertisedExpiry!), { hour: '2-digit', minute: '2-digit' })} Manila · payment manual${h.worker ? ` · Browser ${h.worker}` : ''}` })))
    : el('p', { class: 'small', text: 'No freshly confirmed active checkout in this view. Local captures and unresolved records remain in Activity. Payment is always manual.' }));
  const warnings: Array<[string, string]> = [];
  const preflight=dashboardPreflight();
  if(o.mode==='NEXT_RELEASE'&&preflight&&['NEEDS_ACTION','BLOCKED'].includes(preflight.verdict))warnings.push(['warn',`Release readiness: ${preflight.summary}`]);
  // The same typed failure and run accounting Booking Setup shows, first.
  if (state.attention) warnings.push(['bad', `${state.attention.title}: ${state.attention.detail} → ${state.attention.recovery.label} in Booking Setup → Review & Run.`]);
  for (const h of holds) { const left = Date.parse(h.holdExpiresAt!) - now; if (left < 180_000) warnings.push(['warn', `A recorded checkout deadline is in ${Math.max(0, Math.round(left / 1000))} s. Verify the existing reservation and correct QR before paying manually.`]); }
  if (state.runSummary?.holds) warnings.push(['warn','Run hold counts describe locally validated responses. Check Activity → Records & archive → Pending Holds & Recovery for independent provider confirmation and current QR readiness.']);
  if (journals?.activeUnknown) warnings.push(['muted', `${journals.activeUnknown} submission record(s) have an UNKNOWN outcome and keep their targets blocked. Review or archive them in Activity → Records & archive.`]);
  if (!state.clock?.networkSynced && mango.releaseMs - now < 30 * 60_000) warnings.push(['warn', 'The network clock is not synchronized. Arming synchronizes it automatically.']);
  for (const w of enabledWings(o)) { const c = compiled.capability[w]; if (c && !c.live) warnings.push(['muted', `${wingName(w)}: ${c.status.replace('_', ' ')} for live use — ${c.reasons[0]}`]); }
  if (compiled.problems.length) warnings.push(['warn', `Booking Setup has ${compiled.problems.length} item(s) to fix.`]);
  const list=(items:Array<[string,string]>)=>el('ul',{class:'strategy-warnings'},...items.map(([tone,text])=>el('li',{'data-tone':tone,text})));
  fill(byId('home-warnings-body'),warnings.length?list(warnings.slice(0,3)):el('p',{class:'small',text:'No additional alerts. Review the saved plan before preparation.'}),
    warnings.length>3?el('details',{class:'technical-drawer'},el('summary',{text:`Additional context (${warnings.length-3})`}),list(warnings.slice(3))):null);
  const op=operationalState(state,pendingHoldRows(),now);
  const draftNeedsReview=v?.state==='DRAFT'&&!op.active&&['IDLE','SAVED','PREPARED'].includes(op.label);
  byId('home-title').textContent=draftNeedsReview?'Draft changes need review':op.active?op.label:op.label==='SAVED'?'Saved plan needs preparation':op.label==='IDLE'?'Nothing currently running':op.label;
  byId('home-subtitle').textContent=draftNeedsReview?`${v.detail} The saved authorization remains unchanged.`:op.detail;
  fill(byId('home-state-body'),el('span',{class:'state-badge','data-tone':op.tone,text:op.label}),el('p',{class:'small',text:op.detail}));
  const primary=byId('home-start-setup') as HTMLButtonElement;
  primary.dataset.dest=op.active||['QR READY','HOLD CONFIRMED'].includes(op.label)?'monitor':'setup';
  primary.textContent=draftNeedsReview?'Review booking draft':op.active||['QR READY','HOLD CONFIRMED'].includes(op.label)?'Open Live Monitor':op.label==='SAFETY LOCK'||op.label==='NEEDS ATTENTION'?'Review required action':op.label==='PREPARED'?'Review readiness':op.label==='SAVED'?'Prepare saved plan':'Continue Booking Setup';
  primary.onclick=()=>hooks.showView(draftNeedsReview?'setup':op.active||['QR READY','HOLD CONFIRMED'].includes(op.label)?'live':state.attention||op.label==='PREPARED'?'release':op.label==='SAVED'&&o.mode==='NEXT_RELEASE'?'release':op.label==='SAFETY LOCK'||op.label==='NEEDS ATTENTION'?'records':'setup');
}
