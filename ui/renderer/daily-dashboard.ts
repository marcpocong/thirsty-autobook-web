import type { Dashboard } from '../types.js';
import type { DailyView } from '../daily-planning.js';
import { DAILY_PRESETS, newReleaseProfile, preferenceDifferences, type ReleaseProfile } from '../../src/automatic-release.js';
import { compileObjective, enabledWings } from '../../src/booking-objective.js';
import { reduceShotgunAttempts } from '../../src/capacity-advice.js';
import { releaseInstantFor } from '../../src/wing-release-data.js';
import { acceptGeneratedDraft, bookingSetupState, dashboardPreflight, prepareFromDashboard, primaryFromDashboard, reloadRestoredDraft, recoverFromDashboard } from './booking-setup.js';
import { renderPreflight } from './preflight.js';
import { el, fill, hooks, onPane, onRender, manilaTime, dateText, rangeText } from './navigation.js';

let view:DailyView|undefined, state:Dashboard|undefined, editing:ReleaseProfile|null=null, busy=false, message='', rendered='';
const host=()=>document.getElementById('daily-dashboard')!;
const button=(id:string,text:string,action:()=>void,disabled=false,primary=false)=>{
  const b=el('button',{id,type:'button',class:primary?'primary-action':'secondary compact',text});b.disabled=busy||disabled;b.onclick=action;return b;
};
async function act(action:Parameters<Window['thirsty']['daily']>[0]){
  let completed=false;busy=true;rendered='';render();
  try{const result=await window.thirsty.daily(action);if(result&&'migrationRequired' in result)view=result;else view=await window.thirsty.daily({action:'status'});message='';completed=result?.restored!==false;}
  catch(e){const code=e instanceof Error?e.message:'';message=/PROFILE_INVALID|CUSTOM_BUDGET/.test(code)?'Check the preference values. A fully custom schedule needs matching reviewed assignments and offsets.':/STATE_REQUIRES_REVIEW/.test(code)?'A lock, possible hold or unresolved result needs review before restoring.':'This action could not finish. Review readiness and local diagnostics; existing booking records are unchanged.';}
  finally{busy=false;rendered='';render();}
  return completed;
}
const field=(label:string,control:HTMLElement)=>el('label',{class:'daily-field'},el('span',{text:label}),control);
function checkbox(id:string,label:string,checked:boolean){const c=el('input',{id,type:'checkbox'});c.checked=checked;return field(label,c);}
function preferenceForm(){
  if(!editing){const current=bookingSetupState().objective;
    editing=view?.profile?structuredClone(view.profile):{...newReleaseProfile(Date.now()),origin:'OWNER_REVIEWED',objective:structuredClone(current),preferredBudget:current.shotgun.budget,
      preset:'CUSTOM',distribution:current.shotgun.timingMode==='CUSTOM'||current.shotgun.allocationMode==='CUSTOM'?'CUSTOM':'AUTOMATIC'};
  }
  const p=editing, preset=el('select',{id:'daily-preset','aria-label':'Shotgun preset'},...DAILY_PRESETS.map(s=>el('option',{value:s.id,text:`${s.label}${s.budget?` · ${s.budget} preferred`:''}`})));preset.value=p.preset;
  const budget=el('input',{id:'daily-budget',type:'number',min:'1',max:'42',step:'1',value:String(p.preferredBudget)});
  preset.onchange=()=>{const selected=DAILY_PRESETS.find(s=>s.id===preset.value);if(selected?.budget)budget.value=String(selected.budget);};
  budget.addEventListener('input',()=>{const selected=DAILY_PRESETS.find(s=>s.id===preset.value);if(selected?.budget!==Number(budget.value))preset.value='CUSTOM';});
  const distribution=el('select',{id:'daily-distribution'},...[
    ['AUTOMATIC','Automatic · diversify the distinct-court goal'],['FOCUSED','Focused · weight priority courts'],['DIVERSIFIED','Diversified · equal attempts'],['CUSTOM','Fully custom · preserve reviewed assignments and offsets']
  ].map(([value,text])=>el('option',{value:value!,text:text!})));distribution.value=p.distribution;
  const reminders=el('input',{id:'daily-reminders',value:p.reminders.join(', '),placeholder:'60, 30, 10'});
  const workerInput=el('input',{id:'daily-workers',value:p.workers.join(', '),placeholder:'A, B'});
  const summary=el('p',{class:'small',text:`Reusable goal: ${enabledWings(p.objective).map(w=>`${w} Courts ${p.objective.wings[w].courts.map(c=>c.court).join(' → ')} · ${rangeText(p.objective.wings[w].startTimes[0]!,p.objective.wings[w].durationHours)}`).join(' / ')}. Strategy: ${p.objective.strategy}.`});
  const copyGoal=button('daily-copy-goal','Use the current Booking Setup goal',()=>{p.objective=structuredClone(bookingSetupState().objective);message='Current goal copied into these preferences. Save recurring preferences to accept it.';rendered='';render();});
  const save=button('daily-save-profile','Save recurring preferences',()=>{
    const candidate:ReleaseProfile={...p,origin:'OWNER_REVIEWED',updatedAt:new Date().toISOString(),preset:preset.value as ReleaseProfile['preset'],preferredBudget:Number(budget.value),distribution:distribution.value as ReleaseProfile['distribution'],
      enabled:(host().querySelector('#daily-enabled') as HTMLInputElement).checked,notifications:(host().querySelector('#daily-notifications') as HTMLInputElement).checked,
      reminders:reminders.value.trim()?reminders.value.split(',').map(v=>Number(v.trim())):[],workers:workerInput.value.split(',').map(v=>v.trim().toUpperCase()).filter(Boolean)};
    void act({action:'saveProfile',value:candidate}).then(ok=>{if(!ok)return;editing=null;return act({action:'status'});});
  },state?.operation!=='idle');
  const details=el('details',{id:'daily-preferences',class:'tool-details'},el('summary',{text:view?.migrationRequired?'Review & enable recurring preferences':'Recurring preferences'}),
    el('p',{class:'small',text:'Courts, priorities, time window, duration, fallback choices, price caps and strategy come from your reviewed booking goal. Presets set a preference; capacity and live permission remain separate checks.'}),summary,copyGoal,
    el('div',{class:'daily-form'},checkbox('daily-enabled','Automatically prepare my next release draft',p.enabled),checkbox('daily-notifications','Local Windows reminders while Thirsty is running',p.notifications),field('Preferred Shotgun preset',preset),field('Preferred attempt budget',budget),field('Target distribution',distribution),field('Authorized worker preferences (A–G)',workerInput),field('Minutes before release',reminders)),
    el('p',{class:'small muted',text:'Expanded 12 requires exact calibration and feasible preparation. High-density 16 is experimental. A larger budget does not establish higher winning probability or provider permission.'}),save);
  // Preserve in-progress form values through status updates and opening/closing other details.
  details.addEventListener('input',()=>{p.preset=preset.value as ReleaseProfile['preset'];p.preferredBudget=Number(budget.value);p.distribution=distribution.value as ReleaseProfile['distribution'];p.reminders=reminders.value.split(',').map(v=>Number(v.trim()));p.workers=workerInput.value.split(',').map(v=>v.trim());p.enabled=(host().querySelector('#daily-enabled') as HTMLInputElement).checked;p.notifications=(host().querySelector('#daily-notifications') as HTMLInputElement).checked;});
  return details;
}
function render(){
  if(!state)return;
  if(document.activeElement?.closest('#daily-preferences'))return;
  const setup=bookingSetupState(), key=JSON.stringify([view,Math.floor(Date.now()/60_000),state.operation,state.ready,state.booking?.fingerprint,state.securityCheck,state.shotgunTimingVerdict,state.clock?.networkSynced,state.lock,state.runSummary,setup.view?.state,setup.gates?.primary,busy,message]);
  if(key===rendered)return;rendered=key;
  const oldOpen=host().querySelector<HTMLDetailsElement>('#daily-preferences')?.open??false;
  if(!view){fill(host(),el('h2',{text:'Daily release assistant'}),el('p',{class:'small',text:'Loading recurring preferences…'}));return;}
  const active=state.operation!=='idle', draft=view.generated, advice=view.advice;
  const title=el('div',{class:'daily-heading'},el('div',{},el('p',{class:'eyebrow',text:'Thirsty · daily release assistant'}),el('h2',{text:draft?`Next draft · ${Object.entries(draft.targetDates).map(([w,d])=>`${w} ${dateText(d)}`).join(' / ')}`:'Your next release, with fewer steps'})),el('span',{class:'state-badge','data-tone':active?'live':'info',text:active?state.operation.toUpperCase():draft?'DRAFT · NOT AUTHORIZED':'REVIEW PREFERENCES'}));
  const facts=draft?el('dl',{class:'daily-metrics'},...[
    ['Release',manilaTime(Date.parse(draft.releaseAt))+' Manila'],['Countdown',`${Math.max(0,Math.ceil((Date.parse(draft.releaseAt)-Date.now()-(state.clock?.clockOffsetMs??0))/60_000))} min`],['Strategy',draft.objective.strategy],['Preferred attempts',String(view.profile?.preferredBudget??'—')],['Compiled proposal',String(advice?.compiled??compileObjective(draft.objective,{nowMs:Date.now()}).attemptCount)],['Preparation proposal',advice?.recommended?`${advice.recommended} · owner review required`:'Evidence needed'],['Executable now',String(advice?.executable??0)]
  ].map(([label,value])=>el('div',{},el('dt',{text:label!}),el('dd',{text:value!})))):el('p',{class:'small',text:view.migrationRequired?'Your existing saved choices are preserved. Review them below to enable recurring planning.':'Enable recurring drafts in preferences, then select Plan Next Release.'});
  const changes=draft?preferenceDifferences(setup.objective,draft.objective):[];
  const diff=el('details',{class:'tool-details',id:'daily-differences'},el('summary',{text:`Previous/manual draft → proposed draft · ${changes.length} changes`}),changes.length?el('ul',{class:'plain-list small'},...changes.map(d=>el('li',{text:`${d.field}: ${d.before} → ${d.after}`}))):el('p',{text:'The proposal matches the current editable draft.'}));
  const proposal=draft?compileObjective(draft.objective,{nowMs:Date.now(),unavailableWorkers:new Set(['A','B','C','D','E','F','G'].filter(w=>!view?.profile?.workers.includes(w)))}):null;
  const allocation=proposal?el('details',{class:'tool-details',id:'daily-allocation'},el('summary',{text:'Allocation preview · immediately authorized targets stay separate from alternatives'}),
    el('div',{class:'table-scroll'},el('table',{class:'attempt-table'},el('thead',{},el('tr',{},...['Court & date','Hours','Worker','Planned attempts','Offsets (ms)','Readiness'].map(text=>el('th',{text})))),
      el('tbody',{},...proposal.cohorts.flatMap(c=>(c.smart?.phase3?.wave1??[]).map(a=>{const t=c.smart!.phase3!.candidates[a.candidateIndex]!,offsets=a.fanOutOffsetsMs??[a.releaseOffsetMs??0];return el('tr',{},el('td',{text:`${t.wing??'MANGO'} ${t.court} · ${t.bookingDate??draft!.targetDates.MANGO}`}),el('td',{text:rangeText(t.start,t.durationHours)}),el('td',{text:a.workerId}),el('td',{text:String(offsets.length)}),el('td',{text:offsets.join(', ')}),el('td',{text:state!.browserHealth?.[a.workerId]?'Connected · preparation/checks still required':'Browser not connected'}));}))))),
    el('p',{class:'small',text:'Compilation is a draft preview. Omitted attempts and readiness blockers are shown by the preparation forecast; alternatives cannot activate after arming.'})):null;
  const capacityProposal=draft&&advice?.recommended&&advice.recommended<advice.preferred?reduceShotgunAttempts(draft.objective,advice.recommended):null;
  const capacityReview=capacityProposal?el('details',{class:'tool-details',id:'daily-capacity-proposal'},el('summary',{text:`Capacity proposal · ${advice!.preferred} preferred → ${advice!.recommended} attempts`}),
    el('p',{class:'small',text:'This changes only the draft after you accept. Your recurring preference remains unchanged. Save and calibrate the exact revised schedule before authorization.'}),
    el('ul',{class:'plain-list small'},...preferenceDifferences(draft!.objective,capacityProposal).map(d=>el('li',{text:`${d.field}: ${d.before} → ${d.after}`}))),
    button('daily-accept-capacity','Accept capacity proposal into draft',()=>{try{acceptGeneratedDraft(capacityProposal);}catch{message='The draft is locked.';rendered='';render();}},active)):null;
  const g=setup.gates, primary=g?.primary;
  const primaryText=primary?.action==='PREPARE'?'Check & Prepare for release':primary?.action==='AUTHORIZE_ARM'?'Review authorization & arm':primary?.label??'Review saved plan';
  const primaryClick=()=>{if(primary?.action==='PREPARE')prepareFromDashboard();else if(primary?.action==='STOP')void window.thirsty.abortAutomation();else if(primary?.action==='AUTHORIZE_ARM')hooks.showView('release');else primaryFromDashboard();};
  const actions=el('div',{class:'button-row daily-actions'},button('daily-primary',primaryText,primaryClick,!primary?.gate.enabled,true),button('daily-plan-next','Plan Next Release',()=>void act({action:'generate'}),active||!view.profile),
    draft?button('daily-accept','Review proposed draft',()=>{try{acceptGeneratedDraft(draft.objective);}catch{message='The draft is locked while a run or preparation is active.';rendered='';render();}},active):null);
  const readiness=el('div',{id:'daily-readiness',class:'daily-readiness'}), preflight=dashboardPreflight();
  if(preflight)renderPreflight(readiness,preflight,{compact:false,onRecover:recoverFromDashboard,busy:active});
  const snapshotPanel=el('details',{class:'tool-details',id:'daily-snapshots'},el('summary',{text:'Last Known Good · validated configuration snapshots'}),
    el('p',{class:'small',text:'Configuration validation is distinct from offline calibration, live dispatch and a verified hold. Restoring requires confirmation and a new date/environment review.'}),
    button('daily-capture','Snapshot validated saved configuration',()=>void act({action:'snapshot'}),active),
    ...view.snapshots.map(s=>el('div',{class:'snapshot-row'},el('span',{class:'small',text:`${manilaTime(Date.parse(s.createdAt))} · ${s.reason.replaceAll('_',' ')} · ${s.build?.buildId??'build unknown'} · calibration ${s.calibration?.status??'not tested'}`}),
      button(`restore-${s.id}`,'Review restoration',()=>{void window.thirsty.daily({action:'restorePreview',id:s.id}).then((preview:{changes:Array<{field:string;before:string;after:string}>;blocked:boolean})=>{
        const review=el('div',{id:'daily-restore-review'},el('h3',{text:'Before → after restoration'}),el('ul',{class:'plain-list small'},...preview.changes.map(c=>el('li',{text:`${c.field}: ${c.before} → ${c.after}`}))),
          el('p',{text:preview.blocked?'Booking state needs review. Restoration is blocked.':'Configuration only. Owner confirmation follows. Preparation and authorization must be renewed.'}),
          button('daily-confirm-restore','Restore Last Known Good',()=>void act({action:'restore',id:s.id}).then(ok=>{if(ok)reloadRestoredDraft();}),preview.blocked));host().querySelector('#daily-restore-review')?.remove();snapshotPanel.append(review);
      }).catch(()=>{message='Snapshot review could not be loaded.';rendered='';render();});},active))));
  const report=view.reports[0];
  const reports=el('details',{class:'tool-details',id:'daily-report'},el('summary',{text:report?'Latest automatic run analysis':'Post-run analysis · no completed release recorded'}),
    report?el('div',{},el('strong',{text:report.conclusion}),el('p',{class:'small',text:report.summary.nextStep}),el('ul',{class:'plain-list small'},...report.recommendations.map(text=>el('li',{text}))),report.comparison?el('p',{class:'small',text:report.comparison}):null,el('pre',{text:JSON.stringify(report,null,2)})):el('p',{class:'small',text:'Completed run telemetry will appear here automatically. Prepared requests, initiated requests, verified holds and paid bookings remain distinct.'}));
  const live=state.runSummary?el('div',{class:'daily-live',role:'status'},el('h3',{text:'Live release command center'}),el('p',{text:state.runSummary.detail}),el('p',{class:'small',text:state.runSummary.nextStep}),button('daily-live-open','Open Live & History',()=>hooks.showView('live'))):null;
  const pref=preferenceForm();pref.open=oldOpen;
  fill(host(),title,facts,view.error?el('p',{class:'notice',text:view.error}):null,message?el('p',{class:'notice',role:'status',text:message}):null,actions,
    primary&&!primary.gate.enabled?el('p',{class:'small',text:primary.gate.reason??'Review the plan first.'}):null,
    el('p',{class:'small muted',text:'The primary action uses the saved release plan. Review and save a proposed draft before preparing it. Check & Prepare opens required bot browsers and runs genuine security preparation; it does not arm. Reminders require this app to stay running; Windows delivery is best effort.'}),
    advice?.reasons.length?el('details',{class:'tool-details'},el('summary',{text:`Attempt budget · ${advice.status.replaceAll('_',' ')}`}),el('ul',{class:'plain-list small'},...advice.reasons.map(text=>el('li',{text})))):null,
    draft?diff:null,allocation,capacityReview,pref,readiness,live,reports,snapshotPanel);
}
export function initDailyDashboard(){
  onRender(s=>{state=s;if(s.daily)view=s.daily;render();});
  onPane(p=>{if(['home','setup','release'].includes(p)&&typeof window.thirsty.daily==='function')void act({action:'status'});});
  window.thirsty.onDestination?.(destination=>hooks.showView(destination));
  if(typeof window.thirsty.daily==='function')void act({action:'status'});
}
