import type { Dashboard } from '../types.js';
import { describeSmartPlan, smartImmediateSends, type SmartPhase3, type SmartWorker } from '../../src/precision-simple.js';
import { STRATEGY_PRESET_LABEL } from '../../src/strategy-engine.js';
import { byId, facts } from './dom.js';

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
  const setup = state.booking?.setup, name = byId('next-strategy-name'), target = byId('next-strategy-facts'), note = byId('next-strategy-note');
  const build = state.build ? `${state.build.gitSha.slice(0, 7)}${state.build.dirty ? ' + uncommitted' : ''}` : 'unknown';
  if (!setup) { name.textContent = 'Not configured'; facts(target, [['Build', build]]); note.textContent = 'Save a plan under Strategy.'; return; }
  const targetDate = state.booking?.targetDate ?? '—';
  if (setup.RELEASE_STRATEGY === 'precision' && setup.PRECISION_PHASE3) {
    const plan = setup.PRECISION_PHASE3 as SmartPhase3, meta = setup.STRATEGY_V2;
    const workers = [...plan.wave1.map(value => value.workerId), ...plan.standby];
    const ready = workers.filter(worker => state.playerStatus?.[PLAYER_KEYS[worker]] !== false && !(state.identityIssues ?? []).some(issue => issue.startsWith(`Worker ${worker} `)));
    const browsers = workers.filter(worker => state.browserHealth?.[worker]);
    const widths = [...new Set(plan.wave1.map(value => value.fanOutOffsetsMs?.length ?? 1))];
    const sends = smartImmediateSends(plan.wave1),logicalTargets=new Set(plan.wave1.map(value=>value.candidateIndex)).size;
    const liveChildren=state.live?.parents.filter(value=>value.wave==='WAVE_1').flatMap(value=>value.children)??[];
    const feasibility=state.prewarmFeasibility,observedReady=liveChildren.filter(value=>value.state==='READY').length;
    const description = describeSmartPlan(plan);
    const fanOutSource = meta ? meta.fanOut.source === 'OPERATOR_OVERRIDE' ? ` · operator override (machine: ${meta.fanOut.recommendedWidth ?? '—'})`
      : meta.fanOut.source === 'MACHINE_RECOMMENDED' ? ' · machine recommendation' : ' · no capacity profile' : '';
    name.textContent = meta ? `Smart · ${STRATEGY_PRESET_LABEL[meta.preset]}` : 'Smart (custom)';
    facts(target, [
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
    note.textContent = description.summary;
    return;
  }
  if (setup.RELEASE_STRATEGY === 'precision') {
    name.textContent = 'Fixed Precision (legacy)';
    facts(target, [['Target date', targetDate], ['Attempts', String(setup.PRECISION_TARGETS.length)], ['Fan-out', setup.PRECISION_FAN_OUT ? `${setup.PRECISION_TARGETS.reduce((sum,value)=>sum+(value.fanOutReleaseOffsetsMs?.length??1),0)} total` : 'off'],
      ['Wave 2 / Rescue', 'not available in Fixed mode'], ['Build', build]]);
    note.textContent = 'Fixed attempts are sent exactly as listed. The Strategy view builds a Smart plan with backups and Rescue.';
    return;
  }
  name.textContent = 'General';
  facts(target, [['Target date', targetDate], ['Courts', String(setup.COURT_COUNT)], ['Start', setup.START_TIME], ['Duration', `${setup.DURATION_HOURS} h`], ['Build', build]]);
  note.textContent = '';
}
