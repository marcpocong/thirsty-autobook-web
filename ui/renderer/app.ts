import type { Bridge, Dashboard } from '../types.js';
declare global { interface Window { thirsty: Bridge } }
const byId = (id: string) => document.getElementById(id)!;
let latest: Dashboard | undefined;
let renderedLogs = '';
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
function status(id: string, text: string, tone: string) { const el = byId(id); el.textContent = text; el.dataset.tone = tone; }
function render(state: Dashboard) {
  latest = state;
  byId('headline').textContent = state.headline; byId('detail').textContent = state.detail;
  const busy = state.operation !== 'idle';
  for (const id of ['chrome', 'inspect', 'prepare', 'arm']) (byId(id) as HTMLButtonElement).disabled = busy;
  (byId('arm') as HTMLButtonElement).disabled = busy || state.lock || !state.cdp || !state.clock?.canArmToday;
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
    byId('target-date').textContent = dateLabel(activePlan?.targetDate ?? state.clock.targetDate);
    byId('safe-config').textContent = `Horizon ${state.clock.horizon} days · lead ${state.clock.leadMs} ms · max ${state.clock.maxReloads} reloads`;
    byId('prepare').firstChild!.textContent = `Prepare for ${state.clock.releaseTime.slice(0, 5)} `;
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
  const release = latest.operation === 'observe' && latest.plan ? latest.plan.releaseMs : latest.clock.releaseMs;
  const seconds = Math.max(0, Math.ceil((release - Date.now()) / 1000));
  byId('countdown').textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(v => String(v).padStart(2, '0')).join(':');
  byId('countdown-label').textContent = latest.operation === 'observe' ? 'SCHEDULED RELEASE IN' : 'NEXT RELEASE IN';
}
for (const [id, action] of Object.entries({ chrome: () => window.thirsty.startChrome(), inspect: () => window.thirsty.inspectOnda(), prepare: () => window.thirsty.prepare(), arm: () => window.thirsty.armObservation(), stop: () => window.thirsty.abortAutomation() })) {
  byId(id).addEventListener('click', () => { void action().catch(() => { byId('detail').textContent = 'Command refused or unavailable. Check activity and the current process status.'; }); });
}
window.thirsty.onStatus(render);
void window.thirsty.getStatus().then(render);
setInterval(tick, 1000);
