import { COURT_REGISTRY } from '../court-registry.js';
import type { BookingPlan } from './types.js';

/** Used after the exact provider hold has been validated. Visible QR branding
 * alone cannot establish that the handoff represents the intended reservation.
 */
export function assertQrOrderSummary(body: string, plan: BookingPlan): void {
  const expected = plan.courts.map(c => c.spaceId).sort();
  const shown = COURT_REGISTRY.filter(c => body.includes(c.displayName) ||
    (c.wing === 'MANGO' && body.includes(`Court ${c.number}: Mango Wing`))).map(c => c.spaceId).sort();
  const displayTime = (value: string) => {
    const hour = Number(value.slice(0,2)) % 24;
    return `${hour % 12 || 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
  };
  const date = new Date(`${plan.targetDate}T12:00:00+08:00`);
  const displayDate = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Manila',year:'numeric',month:'long',day:'numeric'}).format(date);
  // Onda may render one row per reserved hour instead of one aggregate range.
  // Match the complete multiset of (time range, registered court), never just the
  // presence of some expected hours somewhere in a multi-court checkout.
  const lines = body.split('\n').map(line => line.trim()).filter(Boolean);
  const range = /^\d{1,2}:\d{2} (?:AM|PM) - \d{1,2}:\d{2} (?:AM|PM)$/;
  const rows = lines.flatMap((line, i) => {
    if (!range.test(line)) return [];
    const court = COURT_REGISTRY.find(c => lines[i + 1] === c.displayName ||
      c.wing === 'MANGO' && lines[i + 1] === `Court ${c.number}: Mango Wing`);
    return [court ? `${court.spaceId}|${line}` : `UNRECOGNIZED|${line}`];
  }).sort();
  const hourly = plan.courts.flatMap(c => c.slots.map(slot =>
    `${c.spaceId}|${displayTime(slot.startTime)} - ${displayTime(slot.endTime)}`)).sort();
  const aggregate = plan.courts.map(c => `${c.spaceId}|${displayTime(c.startTime)} - ${displayTime(c.endTime)}`).sort();
  const timesMatch = rows.length > 0
    ? JSON.stringify(rows) === JSON.stringify(hourly) || JSON.stringify(rows) === JSON.stringify(aggregate)
    : body.includes(`${displayTime(plan.startTime)} - ${displayTime(plan.endTime)}`);
  const money=(text:string)=>{const match=text.match(/^(?:₱|PHP\s*)?\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})$/i);return match?Number(match[1]!.replaceAll(',','')):null;};
  const labelledTotals=lines.flatMap((line,i)=>{
    if(/^(?:Grand\s+)?Total\s*:?$/i.test(line))return [money(lines[i+1]??'')];
    const inline=line.match(/^(?:Grand\s+)?Total\s*:?\s+(.+)$/i);return inline?[money(inline[1]!)]:[];
  });
  const moneyTokens=[...body.matchAll(/(?<![\d.,])(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?!\d)/g)].map(m=>Number(m[0].replaceAll(',','')));
  const amountMatches=labelledTotals.length?labelledTotals.every(n=>n!==null&&Math.round(n*100)===Math.round(plan.totalPrice*100)):
    moneyTokens.some(n=>Math.round(n*100)===Math.round(plan.totalPrice*100));
  if (JSON.stringify(shown) !== JSON.stringify(expected) || !body.includes(displayDate) ||
      !timesMatch ||
      !body.includes('Pending') || !body.includes('QRPH') ||
      !amountMatches) throw Error('OFFICIAL_CHECKOUT_STATE_MISMATCH');
}
