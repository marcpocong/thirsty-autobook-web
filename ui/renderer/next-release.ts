import {forecastPreparation} from '../../src/quick-shotgun.js';
import type { Dashboard } from '../types.js';
import { describeSmartPlan, smartImmediateSends, type SmartPhase3, type SmartWorker } from '../../src/precision-simple.js';
import { STRATEGY_PRESET_LABEL } from '../../src/strategy-engine.js';
import { byId, el, facts } from './dom.js';

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
    facts(target, [['Primary target',firstCandidate?`Court ${firstCandidate.court} · ${firstCandidate.start} · ${firstCandidate.durationHours} h`:'—'],['Strategy',meta?.shotgun?.enabled?`Shotgun · Dense Core · ${sends} attempts`:`Normal · ${sends} attempts`],['Timing',range],['Preparation forecast',feasibility?`${feasibility.projectedReady}/${feasibility.configuredWave1Attempts} ${feasibility.verdict?.replaceAll('_',' ')??'checking'}`:'Checked during Prepare for Release'],['Browsers',`${new Set(plan.wave1.map(value=>value.workerId)).size} release groups`],['Backup attempts',plan.budgets.wave2>0?`Up to ${plan.budgets.wave2}`:'Off'],['Reopened-slot rescue',plan.rescueEnabled&&plan.budgets.rescue>0?`ON · up to ${plan.budgets.rescue}`:'OFF']]);
    facts(technical, [
      ['Release readiness', state.releaseReadiness?.verdict.replaceAll('_',' ') ?? 'checking'],
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
    facts(target, [['Target date', targetDate], ['Attempts', String(setup.PRECISION_TARGETS.length)], ['Fan-out', setup.PRECISION_FAN_OUT ? `${setup.PRECISION_TARGETS.reduce((sum,value)=>sum+(value.fanOutReleaseOffsetsMs?.length??1),0)} total` : 'off'],
      ['Wave 2 / Rescue', 'not available in Fixed mode'], ['Build', build]]);
    technical.replaceChildren();
    note.textContent = 'Fixed attempts are sent exactly as listed. The Strategy view builds a Smart plan with backups and Rescue.';
    return;
  }
  name.textContent = 'General';
  facts(target, [['Target date', targetDate], ['Courts', String(setup.COURT_COUNT)], ['Start', setup.START_TIME], ['Duration', `${setup.DURATION_HOURS} h`], ['Build', build]]);
  technical.replaceChildren();
  note.textContent = '';
}

/** Human-facing mirror of the existing arm control after app.ts applies all engine gates. */
export function renderReleasePreflight(state:Dashboard):void {
  const card=byId('next-preflight'),setup=state.booking?.setup,plan=setup?.PRECISION_PHASE3;
  const arm=byId('arm') as HTMLButtonElement,armed=!!state.scheduledRelease;
  byId('release-action-title').textContent=armed?'Armed':'Release pre-flight';
  const title=armed?'WAITING FOR RELEASE':!arm.disabled?'✓ READY FOR RELEASE':'✕ NOT READY';
  const workers=[...new Set(plan?.wave1.map(value=>value.workerId)??[])];
  const children=state.live?.parents.filter(parent=>parent.wave==='WAVE_1').flatMap(parent=>parent.children)??[];
  const required=setup?.STRATEGY_V2?.shotgun?.exactSchedule.length??(plan?smartImmediateSends(plan.wave1):0);
  const ready=children.filter(child=>child.state==='READY').length;
  const issues=workers.filter(worker=>!state.browserHealth?.[worker]).map(worker=>`✕ Browser ${worker} disconnected`);
  const reason=byId('blocked-reason').textContent;
  const first=plan?.wave1[0],candidate=first?plan?.candidates[first.candidateIndex]:undefined,offsets=setup?.STRATEGY_V2?.shotgun?.exactSchedule.map(shot=>shot.configuredOffsetMs)??[];
  const details=el('dl','fact-grid');facts(details,[['Target',candidate?`Court ${candidate.court} · ${candidate.start} · ${candidate.durationHours} h`:'No saved Smart target'],['Strategy',setup?.STRATEGY_V2?.shotgun?.enabled?`Shotgun · ${setup.STRATEGY_V2.shotgun.timingMode.replaceAll('_',' ')} · ${required} attempts`:'Saved release strategy'],['Timing',offsets.length?`${Math.min(...offsets)} → ${Math.max(...offsets)} ms`:'Saved release timing'],['Preparation',children.length?`Live readiness: ${ready}/${required} READY`:state.ready?'Engine preparation complete · child readiness counts not reported':'Live readiness: not yet prepared'],['Browsers',`${workers.filter(worker=>state.browserHealth?.[worker]).length}/${workers.length} connected`],['Terms',state.termsAuthorized?'AUTHORIZED':'Needs authorization']]);
  card.replaceChildren(el('h3','',title),details,...(!armed&&arm.disabled?[el('p','warn-text',reason||'Review preparation, saved plan and Terms before arming.'),...issues.map(issue=>el('p','warn-text',issue))]:[]));
}
