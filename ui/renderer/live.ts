import type { Dashboard, LiveParentView } from '../types.js';
import { byId, el, empty } from './dom.js';

/**
 * LIVE: the current run summarized by logical target. Each target shows one line; its attempts (fan-out children) are
 * expanded on demand, so 28 attempts never become 28 undifferentiated rows.
 */
const hour = (time?: string) => { if (!time) return '?'; const value = Number(time.slice(0, 2)); return value === 24 ? '12 MN' : `${value % 12 || 12} ${value < 12 ? 'AM' : 'PM'}`; };
const waveLabel = { WAVE_1: 'Release attempts', WAVE_2: 'Backup attempts', RESCUE: 'Reopened-slot rescue' } as const;
const stateText = (state: string) => state.replaceAll('_', ' ').toLowerCase();
const seconds = (ms: number) => `${ms < 0 ? '−' : '+'}${Math.floor(Math.abs(ms) / 60_000)}:${String(Math.floor(Math.abs(ms) % 60_000 / 1000)).padStart(2, '0')}`;

function parentSummary(parent: LiveParentView): string {
  const counts = new Map<string, number>();
  for (const child of parent.children) counts.set(child.state, (counts.get(child.state) ?? 0) + 1);
  return [...counts].map(([state, count]) => `${count} ${stateText(state)}`).join(', ');
}

export function renderLive(state: Dashboard): void {
  const live = state.live, host = byId('live-attempts');
  const children=live?.parents.flatMap(value=>value.children)??[],planned=state.booking?.setup.STRATEGY_V2?.shotgun?.exactSchedule.length??children.length;
  const ready=children.filter(value=>value.state==='READY').length,dispatched=children.filter(value=>['IN_FLIGHT','REJECTED','UNKNOWN','QR_READY','VERIFIED','HOLD_VERIFIED','HOLD_VERIFIED_QR_ATTENTION'].includes(value.state)).length;
  const pending=children.filter(value=>['PREPARING','READY','ARMED','IN_FLIGHT'].includes(value.state)).length,first=live?.parents.find(value=>value.wave==='WAVE_1')??live?.parents[0];
  byId('live-primary-target').textContent=first?`${first.court?`Court ${first.court}`:'Target'} · ${hour(first.startTime)}–${hour(first.endTime)}`:'Waiting for a release';
  byId('live-planned').textContent=String(planned);byId('live-ready').textContent=String(ready);byId('live-dispatched').textContent=String(dispatched);byId('live-pending').textContent=String(pending);
  const unknown=children.some(value=>value.state==='UNKNOWN'),hold=children.some(value=>['QR_READY','VERIFIED','HOLD_VERIFIED','HOLD_VERIFIED_QR_ATTENTION'].includes(value.state)),throttle=children.some(value=>value.code?.includes('429')||value.code?.includes('THROTTLE')),
    allRejected=children.length>0&&children.every(value=>['REJECTED','NOT_DISPATCHED','FAILED','PREWARM_FAILED','WINDOW_MISSED'].includes(value.state));
  const result=hold?'HOLD VERIFIED':throttle?'PROVIDER THROTTLE DETECTED':unknown?'OUTCOME UNKNOWN — DO NOT RETRY':allRejected?'ALL ATTEMPTS REJECTED':dispatched?'WAITING FOR PROVIDER':ready?'READY FOR RELEASE':state.operation!=='idle'&&state.operation!=='scheduled'?'PREPARING':'WAITING FOR A RUN';
  const tone=hold?'ok':unknown||throttle?'danger':allRejected?'warn':dispatched||ready?'running':'muted';
  byId('live-result').textContent=result;byId('live-result').dataset.tone=tone;
  byId('live-guidance').textContent=hold?'Review the verified QR browser and booking details. Payment remains manual.':throttle?'Remaining same-target Dense Core attempts were stopped. Do not manually retry.':unknown?'Reconcile the provider state before any retry. The safety lock remains authoritative.':allRejected?'No hold was verified. Review details after the run completes.':dispatched?'Requests have left; wait for provider outcomes.':ready?'Attempts are prepared. Keep the PC awake and do not change the saved plan.':'Prepare and arm from Next Release. No action is needed here.';
  byId('live-run-state').textContent = hold?'✓ HOLD':unknown||throttle?'✕ ATTENTION':state.operation !== 'idle' && state.operation !== 'scheduled'?'● RUNNING':live?.parents.length?'✓ FINISHED':'○ IDLE';
  const observer=state.slotWatch&&['waiting','watching'].includes(state.slotWatch.status)
    ? `Observer ONLINE${state.slotWatch.lastLatencyMs!==undefined?` · ${Math.round(state.slotWatch.lastLatencyMs)} ms`:''}`:'Observer OFFLINE / DEGRADED';
  const lockdown=state.operation==='full'&&state.clock&&state.clock.remainingMs<=1_000?'RELEASE CRITICAL LOCKDOWN active':'';
  const allChildren=live?.parents.filter(value=>value.wave==='WAVE_1').flatMap(value=>value.children)??[],shotgunChildren=allChildren.filter(value=>value.shotIndex!==undefined),shotgunTotal=state.booking?.setup.STRATEGY_V2?.shotgun?.exactSchedule.length;
  const sent=shotgunChildren.filter(value=>['IN_FLIGHT','REJECTED','UNKNOWN','QR_READY','VERIFIED','HOLD_VERIFIED','HOLD_VERIFIED_QR_ATTENTION'].includes(value.state)).length;
  const suppressed=shotgunChildren.filter(value=>value.state==='NOT_DISPATCHED'&&value.code?.startsWith('SHOTGUN_')).length;
  byId('live-prewarm').textContent = [observer,lockdown,live?.prewarm && live.prewarm.width > 1 ? `Security prepares tier by tier, ${Math.round(live.prewarm.leadMs / 1000)} s ahead` : '',
    shotgunTotal?`Shotgun: ${sent}/${shotgunTotal} sent · ${suppressed} suppressed`:'',live?.tiers ?? ''].filter(Boolean).join(' · ');
  if (!live?.parents.length) host.replaceChildren(empty('Attempts appear here when a release run starts.'));
  else host.replaceChildren(...live.parents.map(parent => {
    const details = el('details', 'live-parent');
    details.open = parent.children.length === 1 || parent.children.some(child=>['UNKNOWN','QR_READY','VERIFIED','HOLD_VERIFIED','HOLD_VERIFIED_QR_ATTENTION'].includes(child.state));
    const shotgun=parent.wave==='WAVE_1'&&parent.children.some(child=>child.shotIndex!==undefined);
    const title = `${parent.court ? `Court ${parent.court}` : 'Target'} · ${hour(parent.startTime)}–${hour(parent.endTime)} · ${shotgun?`Shotgun · ${Math.max(...parent.children.map(child=>child.shotCount??parent.children.length))} attempts`:`${parent.workerId ? `Worker ${parent.workerId} · ` : ''}${waveLabel[parent.wave]}`}`;
    details.append(el('summary', '', `${title} — ${parentSummary(parent)}`));
    const chips = el('div', 'live-children');
    chips.append(...parent.children.map(child => {
      const chip = el('span', 'live-child', `${child.shotIndex!==undefined?`#${child.shotIndex+1}`:child.label} ${stateText(child.state)}${child.offsetMs!==undefined ? ` · ${child.offsetMs>=0?'+':''}${child.offsetMs} ms` : ''}${child.code?.startsWith('SHOTGUN_')?` · ${stateText(child.code)}`:''}`);
      chip.dataset.state = child.state; if (child.code) chip.title = child.code;
      return chip;
    }));
    details.append(chips);
    return details;
  }));
  const rescue = byId('live-rescue');
  if (!live) { rescue.replaceChildren(); return; }
  const parts: HTMLElement[] = [el('strong', '', live.rescueEnabled ? `Reopened-slot rescue: ready · up to ${live.rescueMax ?? '?'}` : live.rescueEnabled === false ? 'Reopened-slot rescue: off' : '')];
  if (live.predictions.length) {
    const list = el('ul', 'strategy-children');
    list.append(...live.predictions.map(prediction => el('li', '', `${prediction.court ? `Court ${prediction.court} · ${hour(prediction.startTime)}–${hour(prediction.endTime)}` : prediction.candidateId.slice(0, 8)}`
      + ` · may reopen ${seconds(prediction.predictedStartMs)}…${seconds(prediction.predictedEndMs)} (${prediction.confidence === 'LOW' ? 'low confidence' : 'hold-expiry pattern'})`
      + `${prediction.prewarm ? ` · security ${stateText(prediction.prewarm)}` : ''}${prediction.errorMs !== undefined ? ` · observed error ${(prediction.errorMs / 1000).toFixed(1)} s` : ''}`)));
    parts.push(el('p', 'small', 'Predictions only prepare a Rescue worker. A Rescue attempt still needs a fresh reopening in the released schedule.'), list);
  }
  if (live.notes.length) { const notes = el('ul', 'strategy-warnings'); notes.append(...live.notes.map(text => el('li', '', text))); parts.push(notes); }
  rescue.replaceChildren(...parts);
}
