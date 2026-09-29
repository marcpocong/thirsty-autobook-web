import type { Dashboard, LiveParentView } from '../types.js';
import { byId, el, empty } from './dom.js';

/**
 * LIVE: the current run summarized by logical target. Each target shows one line; its attempts (fan-out children) are
 * expanded on demand, so 28 attempts never become 28 undifferentiated rows.
 */
const hour = (time?: string) => { if (!time) return '?'; const value = Number(time.slice(0, 2)); return value === 24 ? '12 MN' : `${value % 12 || 12} ${value < 12 ? 'AM' : 'PM'}`; };
const waveLabel = { WAVE_1: 'Immediate', WAVE_2: 'Backup (Wave 2)', RESCUE: 'Rescue' } as const;
const stateText = (state: string) => state.replaceAll('_', ' ').toLowerCase();
const seconds = (ms: number) => `${ms < 0 ? '−' : '+'}${Math.floor(Math.abs(ms) / 60_000)}:${String(Math.floor(Math.abs(ms) % 60_000 / 1000)).padStart(2, '0')}`;

function parentSummary(parent: LiveParentView): string {
  const counts = new Map<string, number>();
  for (const child of parent.children) counts.set(child.state, (counts.get(child.state) ?? 0) + 1);
  return [...counts].map(([state, count]) => `${count} ${stateText(state)}`).join(', ');
}

export function renderLive(state: Dashboard): void {
  const live = state.live, host = byId('live-attempts');
  byId('live-run-state').textContent = live?.outcome ? live.outcome.replaceAll('_', ' ').toLowerCase()
    : state.operation !== 'idle' && state.operation !== 'scheduled' ? 'Running' : live?.parents.length ? 'Finished' : 'No run';
  byId('live-prewarm').textContent = [live?.prewarm && live.prewarm.width > 1 ? `Security prepares tier by tier, ${Math.round(live.prewarm.leadMs / 1000)} s ahead` : '',
    live?.tiers ?? ''].filter(Boolean).join(' · ');
  if (!live?.parents.length) host.replaceChildren(empty('Attempts appear here when a release run starts.'));
  else host.replaceChildren(...live.parents.map(parent => {
    const details = el('details', 'live-parent');
    const busy = parent.children.some(child => ['IN_FLIGHT', 'UNKNOWN', 'QR_READY', 'VERIFIED', 'HOLD_VERIFIED'].includes(child.state));
    details.open = busy || parent.children.length === 1;
    const title = `${parent.court ? `Court ${parent.court}` : 'Target'} · ${hour(parent.startTime)}–${hour(parent.endTime)} · ${parent.workerId ? `Worker ${parent.workerId} · ` : ''}${waveLabel[parent.wave]}`;
    details.append(el('summary', '', `${title} — ${parentSummary(parent)}`));
    const chips = el('div', 'live-children');
    chips.append(...parent.children.map(child => {
      const chip = el('span', 'live-child', `${child.label} ${stateText(child.state)}${child.offsetMs ? ` · ${child.offsetMs} ms` : ''}`);
      chip.dataset.state = child.state; if (child.code) chip.title = child.code;
      return chip;
    }));
    details.append(chips);
    return details;
  }));
  const rescue = byId('live-rescue');
  if (!live) { rescue.replaceChildren(); return; }
  const parts: HTMLElement[] = [el('strong', '', live.rescueEnabled ? `Rescue: armed · up to ${live.rescueMax ?? '?'}` : live.rescueEnabled === false ? 'Rescue: off' : '')];
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
