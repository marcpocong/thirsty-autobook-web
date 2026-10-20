import {SHOTGUN_MAX_TRIGGER_LATENESS_MS} from '../../src/shotgun.js';
import {forecastPreparation} from '../../src/quick-shotgun.js';
import type { Dashboard } from '../types.js';
import { describeSmartPlan, smartImmediateSends, type SmartPhase3, type SmartWorker } from '../../src/precision-simple.js';
import { STRATEGY_PRESET_LABEL } from '../../src/strategy-engine.js';
import { byId, el, facts } from './dom.js';
import { readinessLayers, readinessSummary } from '../../src/execution-state.js';
import { planWorkerIds } from '../../src/workers.js';
import { releaseBlockers } from './operator-status.js';
import { preflightInput, releasePreflight, renderPreflight } from './preflight.js';

/**
 * NEXT RELEASE summary, generated only from the SAVED authorization (never from the editor draft), so it always states
 * what the armed run will actually do.
 */
const PLAYER_KEYS: Record<SmartWorker, keyof NonNullable<Dashboard['playerStatus']>> = { A: 'primary', B: 'extended', C: 'third', D: 'fourth', E: 'fifth', F: 'sixth', G: 'seventh' };

export function shotgunReadinessText(planned:number,children:Array<{shotIndex?:number;state:string}>):string{
  const observed=children.filter(value=>value.shotIndex!==undefined).slice(0,planned),counts={READY:0,PREPARING:0,FAILED:0,OMITTED:0};
  for(const child of observed){if(child.state==='READY')counts.READY++;else if(child.state==='FAILED'||child.state==='PREWARM_FAILED'||child.state==='BROWSER_FAILED'||child.state==='IDENTITY_FAILED')counts.FAILED++;
    else if(child.state==='OMITTED'||child.state==='NOT_DISPATCHED')counts.OMITTED++;else counts.PREPARING++;}
  const missing=Math.max(0,planned-observed.length),parts=[`${counts.READY}/${planned} READY`];
  if(counts.PREPARING||(!observed.length&&missing))parts.push(`${counts.PREPARING+(!observed.length?missing:0)} PREPARING`);
  if(counts.FAILED)parts.push(`${counts.FAILED} FAILED`);if(counts.OMITTED)parts.push(`${counts.OMITTED} OMITTED`);
  if(observed.length&&missing)parts.push(`${missing} MISSING / NOT YET OBSERVED`);return parts.join(' · ');
}

export function renderNextRelease(state: Dashboard): void {
  const setup = state.booking?.setup, name = byId('next-strategy-name'), target = byId('next-strategy-facts'), technical=byId('next-strategy-technical'), note = byId('next-strategy-note');
  const build = state.build ? `${state.build.gitSha.slice(0, 7)}${state.build.dirty ? ' + uncommitted' : ''}` : 'unknown';
  if (!setup) { name.textContent = 'Not configured'; facts(target, [['Status','No saved strategy']]); facts(technical,[['Build', build]]); note.textContent = 'Save a strategy before preparing a release.'; return; }
  const targetDate = state.booking?.targetDate ?? '—';
  if (setup.RELEASE_STRATEGY === 'precision' && setup.PRECISION_PHASE3) {
    const plan = setup.PRECISION_PHASE3 as SmartPhase3, meta = setup.STRATEGY_V2;
    const workers = [...plan.wave1.map(value => value.workerId), ...plan.standby];
    const ready = workers.filter(worker => state.playerStatus?.[PLAYER_KEYS[worker]] !== false && !(state.identityIssues ?? []).some(issue => issue.startsWith(`Worker ${worker} `)));
    const browsers = workers.filter(worker => state.browserHealth?.[worker]);
    const widths = [...new Set(plan.wave1.map(value => value.fanOutOffsetsMs?.length ?? 1))];
    const sends = smartImmediateSends(plan.wave1),logicalTargets=new Set(plan.wave1.map(value=>value.candidateIndex)).size;
    const liveChildren=state.live?.parents.filter(value=>value.wave==='WAVE_1').flatMap(value=>value.children)??[];
    const unavailable=new Set(Object.entries(PLAYER_KEYS).filter(([worker,key])=>state.playerStatus?.[key]===false||(state.identityIssues??[]).some(issue=>issue.startsWith(`Worker ${worker} `))).map(([worker])=>worker));
    const feasibility=forecastPreparation(plan,unavailable,state.prewarmFeasibility),observedReady=liveChildren.filter(value=>value.state==='READY').length;
    const description = describeSmartPlan(plan);
    const fanOutSource = meta ? meta.fanOut.source === 'OPERATOR_OVERRIDE' ? ` · operator override (machine: ${meta.fanOut.recommendedWidth ?? '—'})`
      : meta.fanOut.source === 'MACHINE_RECOMMENDED' ? ' · machine recommendation' : ' · no capacity profile' : '';
    name.textContent = meta?.shotgun?.enabled ? 'Shotgun' : meta ? `Normal · ${STRATEGY_PRESET_LABEL[meta.preset]}` : 'Smart (custom)';
    const firstTarget=plan.wave1[0],firstCandidate=firstTarget?plan.candidates[firstTarget.candidateIndex]:undefined,range=meta?.shotgun?.exactSchedule.length?`${meta.shotgun.exactSchedule[0]!.configuredOffsetMs} → ${meta.shotgun.exactSchedule.at(-1)!.configuredOffsetMs} ms`:'Measured timing';
    facts(target, [['Wing','Mango Wing'],['Primary target',firstCandidate?`Court ${firstCandidate.court} · ${firstCandidate.start} · ${firstCandidate.durationHours} h`:'—'],['Strategy',meta?.shotgun?.enabled?`Shotgun · Dense Core · ${sends} attempts`:`Normal · ${sends} attempts`],['Timing',range],...(meta?.shotgun?.enabled?[['Strict trigger tolerance',`${SHOTGUN_MAX_TRIGGER_LATENESS_MS} ms · late attempts omitted`] as [string,string],['Tabs required',plan.wave1.map(a=>`${a.workerId}: ${a.fanOutOffsetsMs?.length??1}`).join(' / ')] as [string,string],['Local timing test',state.shotgunTimingVerdict?`${state.shotgunTimingVerdict.status.replaceAll('_',' ')} · ${state.shotgunTimingVerdict.p95!==null?`p95 ${state.shotgunTimingVerdict.p95} ms · max ${state.shotgunTimingVerdict.max} ms · `:''}${state.shotgunTimingVerdict.reason}`:state.shotgunTiming?`${state.shotgunTiming.status} · p95 ${state.shotgunTiming.p95??'unmeasured'} ms · max ${state.shotgunTiming.max??'unmeasured'} ms · ${state.shotgunTiming.omittedShots} omitted · ${state.shotgunTiming.compressedPairs} compressed pairs`:'NOT TESTED for this plan and build'] as [string,string]]:[]),['Preparation forecast',feasibility?`${feasibility.projectedReady}/${feasibility.configuredWave1Attempts} ${feasibility.verdict?.replaceAll('_',' ')??'checking'}`:'Checked during Prepare for Release'],['Browsers',`${new Set(plan.wave1.map(value=>value.workerId)).size} release groups`],['Backup attempts',plan.budgets.wave2>0?`Up to ${plan.budgets.wave2}`:'Off'],['Reopened-slot rescue',plan.rescueEnabled&&plan.budgets.rescue>0?`ON · up to ${plan.budgets.rescue}`:'OFF']]);
    facts(technical, [
      ['Engine checks (detail)', state.releaseReadiness?.verdict.replaceAll('_',' ') ?? 'checking'],
      ['Build integrity', state.releaseReadiness?.checks.find(value=>value.id==='build')?.detail ?? build],
      ['Trusted clock', state.releaseReadiness?.checks.find(value=>value.id==='clock')?.detail ?? 'checking'],
      ['Observer', state.releaseReadiness?.checks.find(value=>value.id==='observer')?.detail ?? 'offline'],
      ['Target date', targetDate],
      ['Immediate logical targets', String(logicalTargets)],
      [meta?.shotgun?.enabled?'Shotgun':'Fan-out', meta?.shotgun?.enabled?`${sends} total Wave 1 sends · budget ${meta.shotgun.budget} · ${meta.shotgun.windowStartMs}…${meta.shotgun.windowEndMs} ms`:`${widths.length === 1 ? widths[0] : widths.join('/')} per target · ${sends} send${sends === 1 ? '' : 's'}${fanOutSource}`],
      ...(meta?.shotgun?.enabled?[['Shotgun readiness',shotgunReadinessText(meta.shotgun.exactSchedule.length,liveChildren)] as [string,string]]:[]),
      ...(feasibility?[['Projected readiness',`${feasibility.projectedReady}/${feasibility.configuredWave1Attempts} preparable · ${feasibility.projectedAtRisk} at risk · ${feasibility.projectedOmitted} omitted`] as [string,string],
        ['Preparation forecast',`lead ${(feasibility.prewarmLeadMs/1000).toFixed(1)} s · p95 ${(feasibility.preparationP95Ms/1000).toFixed(1)} s (${feasibility.p95Source==='FALLBACK'?'fallback':`${feasibility.sampleCount} samples`})`] as [string,string],
        ...(liveChildren.length?[['Observed readiness',shotgunReadinessText(feasibility.configuredWave1Attempts,liveChildren)] as [string,string],
          ...(observedReady<feasibility.projectedReady&&liveChildren.some(value=>['FAILED','OMITTED','NOT_DISPATCHED','PREWARM_FAILED'].includes(value.state))?[['Forecast divergence','Observed preparation is behind feasibility forecast.'] as [string,string]]:[])]:[])]:[]),
      ['Standby workers', plan.standby.length ? plan.standby.join(', ') : 'none'],
      ['Wave 2', plan.budgets.wave2 > 0 ? `up to ${plan.budgets.wave2}${plan.concurrentWave2 ? ' · concurrent' : ''}` : 'off'],
      ['Rescue', plan.rescueEnabled && plan.budgets.rescue > 0 ? `on · up to ${plan.budgets.rescue}` : 'off'],
      ['Maximum possible sends', String(description.maxSends)],
      ['Players ready', `${ready.length}/${workers.length}`],
      ['Browsers ready', `${browsers.length}/${workers.length}`],
      ['Security prewarm', state.live?.tiers ?? (state.live?.prewarm ? `lead ${Math.round(state.live.prewarm.leadMs / 1000)} s` : widths.some(width => width > 1) ? 'tiered: Tier 1 first' : 'all at once, 15 s before')],
      ['Ready workers', state.releaseReadiness ? `${state.releaseReadiness.readyWorkers.length}/${workers.length}${state.releaseReadiness.degradedWorkers.length?` · degraded ${state.releaseReadiness.degradedWorkers.join(', ')}`:''}` : `${ready.length}/${workers.length}`],
      ['Build', build],
    ]);
    note.textContent = `${description.summary} Payment remains manual; the bot stops at QR.`;
    return;
  }
  if (setup.RELEASE_STRATEGY === 'precision') {
    name.textContent = 'Fixed Precision (legacy)';
    facts(target, [['Wing','Mango Wing'],['Target date', targetDate], ['Attempts', String(setup.PRECISION_TARGETS.length)], ['Fan-out', setup.PRECISION_FAN_OUT ? `${setup.PRECISION_TARGETS.reduce((sum,value)=>sum+(value.fanOutReleaseOffsetsMs?.length??1),0)} total` : 'off'],
      ['Wave 2 / Rescue', 'not available in Fixed mode'], ['Build', build]]);
    technical.replaceChildren();
    note.textContent = 'Fixed attempts are sent exactly as listed. The Strategy view builds a Smart plan with backups and Rescue.';
    return;
  }
  name.textContent = 'General';
  facts(target, [['Wing','Mango Wing'],['Target date', targetDate], ['Courts', String(setup.COURT_COUNT)], ['Start', setup.START_TIME], ['Duration', `${setup.DURATION_HOURS} h`], ['Build', build]]);
  technical.replaceChildren();
  note.textContent = '';
}

const LIMIT_TEXT:Record<string,string>={PREWARM_WORKER_UNAVAILABLE:'a required browser is not connected',PREWARM_CAPACITY_EXCEEDED:'preparation capacity',PREWARM_FRESHNESS_LIMIT:'security context would expire before its trigger',PREWARM_TRIGGER_TOO_EARLY:'not ready before its trigger',PREWARM_PROJECTED_OMISSION:'preparation capacity'};
/**
 * One forecast rule for every readiness display. Before preparation: the CAPACITY forecast of the saved plan (configured
 * browsers, measured history). After preparation: the engine's live forecast over the browsers actually connected.
 * Never a connected-browser forecast before anything was prepared (that would report omissions for the wrong reason).
 */
export function layerForecast(state:Dashboard,prepared:boolean):Parameters<typeof readinessLayers>[0]['forecast']{
  const plan=state.booking?.setup.PRECISION_PHASE3 as SmartPhase3|undefined;if(!plan)return null;
  const unavailable=new Set(Object.entries(PLAYER_KEYS).filter(([worker,key])=>state.playerStatus?.[key]===false||(state.identityIssues??[]).some(issue=>issue.startsWith(`Worker ${worker} `))).map(([worker])=>worker));
  const f=prepared?state.prewarmFeasibility:forecastPreparation(plan,unavailable,state.prewarmFeasibility);
  if(!f)return {verdict:'UNAVAILABLE',ready:0,configured:smartImmediateSends(plan.wave1),atRisk:0,omitted:0,measured:false,samples:0};
  return {verdict:f.verdict,ready:f.projectedReady,configured:f.configuredWave1Attempts,atRisk:f.projectedAtRisk,omitted:f.projectedOmitted,measured:f.p95Source!=='FALLBACK',samples:f.sampleCount,
    basis:prepared?'live, connected browsers':'capacity, before preparation',limits:(f.limitingConstraints??[]).map(code=>LIMIT_TEXT[code]??code)};
}
/**
 * Readiness of the SAVED release authorization, on the same five layers as Booking Setup (execution-state.ts). It never
 * derives readiness from a button's enabled state and never calls a forecast "ready for release".
 */
export function renderReleasePreflight(state:Dashboard):void {
  const card=byId('next-preflight'),setup=state.booking?.setup,plan=setup?.PRECISION_PHASE3;
  const apiRelease=state.operation==='full'?state.activeApiRelease:null;
  const armed=!!state.scheduledRelease||!!apiRelease;
  byId('release-action-title').textContent=armed?'Armed':'Saved plan readiness';
  const workers=setup?planWorkerIds(setup):[];
  const children=state.live?.parents.filter(parent=>parent.wave==='WAVE_1').flatMap(parent=>parent.children)??[];
  const required=setup?.STRATEGY_V2?.shotgun?.exactSchedule.length??(plan?smartImmediateSends(plan.wave1):0);
  const ready=children.filter(child=>child.state==='READY').length;
  const prepared=!!state.ready&&!!state.preparedPlanFingerprint&&state.preparedPlanFingerprint===state.booking?.fingerprint;
  const f=state.prewarmFeasibility;
  const layers=readinessLayers({plan:{problems:setup?0:1,runtime:setup?'VALID':'INVALID',saved:!!setup},
    environment:{prepared,forOtherPlan:!!state.ready&&!!state.preparedPlanFingerprint&&!prepared,required:workers.length,connected:workers.filter(worker=>state.browserHealth?.[worker]).length,identityIssues:state.identityIssues?.length??0},
    forecast:layerForecast(state,prepared),
    security:plan?{planned:required,ready,preparing:children.filter(child=>child.state==='PREPARING').length,failed:children.filter(child=>['FAILED','PREWARM_FAILED'].includes(child.state)).length,
      omitted:children.filter(child=>child.state==='OMITTED').length,leadMs:state.live?.prewarm?.leadMs??f?.prewarmLeadMs??null}:null,
    // The same pre-release security evidence Booking Setup shows (only for the prepared saved plan).
    securityCheck:prepared?state.securityCheck??null:null,
    armed:{armed:armed&&apiRelease?.phase!=='RUNNING',running:apiRelease?.phase==='RUNNING'},readinessBlockers:releaseBlockers(state)});
  const title=apiRelease?{PREPARING:'ARMED · PREPARING RELEASE CONTEXTS',WAITING:'WAITING FOR RELEASE',RUNNING:'RELEASE IN PROGRESS',FAILED:'RELEASE NEEDS ATTENTION'}[apiRelease.phase]:armed?'WAITING FOR RELEASE':readinessSummary(layers);
  const first=plan?.wave1[0],candidate=first?plan?.candidates[first.candidateIndex]:undefined,offsets=setup?.STRATEGY_V2?.shotgun?.exactSchedule.map(shot=>shot.configuredOffsetMs)??[];
  const details=el('dl','fact-grid');facts(details,[['Plan',state.booking?`Saved release authorization ${state.booking.fingerprint.slice(0,12)}`:'No saved release plan'],
    ['Target',candidate?`Court ${candidate.court} · ${candidate.start} · ${candidate.durationHours} h`:'No saved Smart target'],['Strategy',setup?.STRATEGY_V2?.shotgun?.enabled?`Shotgun · ${setup.STRATEGY_V2.shotgun.timingMode.replaceAll('_',' ')} · ${required} attempts`:'Saved release strategy'],
    ['Timing',offsets.length?`${Math.min(...offsets)} → ${Math.max(...offsets)} ms`:'Saved release timing'],
    ['Live security',children.length?`${ready}/${required} ready (actual evidence for this run)`:'not yet prepared · runs only after arming'],
    ['Browsers',`${workers.filter(worker=>state.browserHealth?.[worker]).length}/${workers.length} connected`],['Terms',armed?'AUTHORIZED FOR THIS RUN':state.termsAuthorized?'AUTHORIZED':'Needs authorization']]);
  // One preflight model for every view (src/release-preflight.ts); actions stay in Review & Run.
  const rows=el('div','preflight compact');
  renderPreflight(rows,releasePreflight(preflightInput(state,layers,{prepared,forOther:!!state.ready&&!!state.preparedPlanFingerprint&&!prepared,
    armed:armed&&apiRelease?.phase!=='RUNNING',running:apiRelease?.phase==='RUNNING',securityCheck:prepared?state.securityCheck??null:null})),{compact:true});
  card.replaceChildren(el('h3','',title),rows,details);
}
