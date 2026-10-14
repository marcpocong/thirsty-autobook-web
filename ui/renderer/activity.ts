import { el, fill, dateText, manilaTime, onPane, wingName } from './navigation.js';

/**
 * Activity → Records & archive. Historical UNKNOWN records can be archived out of active screens. Archiving never
 * moves, rewrites, retries or reclassifies a journal; duplicate protection stays active and every action is audited.
 */
interface RecordRow { key: string; path: string; targetDate: string; wing?: string; courtIds: number[]; lastWriteAt: string; httpStatus?: number; failureCode?: string; eligible: boolean; reason?: string }
interface ArchivedRow { key: string; path: string; targetDate: string; wing?: string; courtIds: number[]; archivedAt: string; sha256: string; note: string }
let overview: { counts: Record<string, number>; activeUnknown: RecordRow[]; archived: ArchivedRow[]; eligible: string[]; checkedAt: string } | null = null;
let verify: Map<string, string> | null = null, busy = false, message = '';
const byId = (id: string) => document.getElementById(id)!;
async function refresh() {
  try { overview = await window.thirsty.journalArchive({ action: 'overview' }); message = ''; } catch (e) { message = `Records could not be read: ${e instanceof Error ? e.message : e}`; }
  render();
}
async function act(action: 'archive' | 'restore' | 'verify', keys: string[] = []) {
  busy = true; render();
  try {
    if (action === 'verify') { const results = await window.thirsty.journalArchive({ action: 'verify' }) as Array<{ key: string; status: string }>; verify = new Map(results.map(r => [r.key, r.status]));
      message = `Verified ${results.length} archived record(s): ${results.filter(r => r.status === 'MATCH').length} match their original bytes.`; }
    else if (action === 'archive') { const result = await window.thirsty.journalArchive({ action: 'archive', keys, note: 'Owner-approved archival of historical UNKNOWN records (Activity)' }) as { archived: unknown[]; refused: Array<{ reason: string }>; cancelled?: boolean };
      message = result.cancelled ? 'Archival cancelled.' : `Archived ${result.archived.length} record(s)${result.refused.length ? `; ${result.refused.length} refused (${[...new Set(result.refused.map(r => r.reason))].join(', ')})` : ''}. Their targets remain blocked against duplicate submission.`; }
    else { const result = await window.thirsty.journalArchive({ action: 'restore', keys }) as { restored: string[] }; message = `Restored ${result.restored.length} record(s) to the active list.`; }
  } catch (e) { message = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '') : String(e); }
  busy = false; await refresh();
}
export function initActivity() { onPane(pane => { if (pane === 'records') void refresh(); }); }
function render() {
  const host = byId('records-panel');
  if (!overview) { fill(host, el('h2', { text: 'Records & archive' }), el('p', { class: 'small', text: message || 'Loading submission records…' })); return; }
  const c = overview.counts, eligible = overview.eligible;
  const archiveAll = el('button', { type: 'button', class: 'secondary', id: 'archive-eligible', text: `Archive eligible historical UNKNOWN (${eligible.length})` }) as HTMLButtonElement;
  archiveAll.disabled = busy || !eligible.length; archiveAll.onclick = () => void act('archive', eligible);
  const verifyButton = el('button', { type: 'button', class: 'secondary', id: 'verify-archive', text: 'Verify archive' }) as HTMLButtonElement;
  verifyButton.disabled = busy || !overview.archived.length; verifyButton.onclick = () => void act('verify');
  const byDate = new Map<string, RecordRow[]>(); for (const r of overview.activeUnknown) byDate.set(r.targetDate, [...(byDate.get(r.targetDate) ?? []), r]);
  const active = overview.activeUnknown.length ? el('div', { class: 'records-groups' }, ...[...byDate.entries()].map(([date, rows]) => el('details', { class: 'tool-details' },
    el('summary', { text: `${dateText(date)} · ${rows.length} UNKNOWN record(s)${rows.every(r => r.eligible) ? ' · all historical' : ''}` }),
    el('ul', { class: 'plain-list small' }, ...rows.map(r => el('li', { 'data-eligible': String(r.eligible), text: `${wingName(r.wing ?? 'MANGO')} Court ${r.courtIds.join('+') || '?'} · last write ${manilaTime(Date.parse(r.lastWriteAt))}${r.httpStatus ? ` · HTTP ${r.httpStatus}` : ''}${r.failureCode ? ` · ${r.failureCode}` : ''} · ${r.eligible ? 'historical (eligible to archive)' : `not eligible: ${r.reason}`}` }))))))
    : el('p', { class: 'small good-text', text: '✓ No active UNKNOWN records.' });
  const archived = overview.archived.length ? el('div', { class: 'table-scroll' }, el('table', { class: 'attempt-table', id: 'archived-records' }, el('thead', {}, el('tr', {}, ...['Target date', 'Wing · court', 'Archived', 'Original SHA-256', 'Verify', ''].map(h => el('th', { text: h })))),
    el('tbody', {}, ...overview.archived.map(a => { const restore = el('button', { type: 'button', class: 'secondary compact', text: 'Restore' }) as HTMLButtonElement; restore.disabled = busy; restore.onclick = () => void act('restore', [a.key]);
      return el('tr', {}, el('td', { text: dateText(a.targetDate) }), el('td', { text: `${wingName(a.wing ?? 'MANGO')} ${a.courtIds.join('+')}` }), el('td', { text: manilaTime(Date.parse(a.archivedAt)) }), el('td', { class: 'small mono', text: `${a.sha256.slice(0, 16)}…` }),
        el('td', { 'data-tone': verify?.get(a.key) === 'MATCH' ? 'good' : verify?.has(a.key) ? 'bad' : 'muted', text: verify?.get(a.key) ?? '—' }), el('td', {}, restore)); }))))
    : el('p', { class: 'small', text: 'No archived records.' });
  fill(host, el('div', { class: 'section-title' }, el('div', {}, el('p', { class: 'eyebrow', text: 'Durable submission evidence' }), el('h2', { text: 'Records & archive' })), el('div', { class: 'button-row' }, archiveAll, verifyButton)),
    el('p', { class: 'small', text: `${c.journals ?? 0} submission journals: ${c.verified ?? 0} verified, ${c.rejected ?? 0} rejected, ${c.unknown ?? 0} UNKNOWN (${c.archived ?? 0} archived), ${c.armedOrDispatching ?? 0} armed or dispatching.` }),
    el('p', { class: 'small', text: 'Archiving keeps each original journal file exactly where it is, byte for byte and still UNKNOWN, so its target stays blocked against duplicate submission. The archive is a separate SHA-256 index with an append-only audit log. Nothing is deleted, retried, reclassified or cancelled. Armed, dispatching and recent records, and anything with a possibly active hold, cannot be archived.' }),
    message ? el('p', { class: 'notice', role: 'status', text: message }) : null,
    el('h3', { text: 'Active UNKNOWN records' }), active, el('h3', { text: 'Archived historical records' }), archived);
}
