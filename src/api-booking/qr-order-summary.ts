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
  if (JSON.stringify(shown) !== JSON.stringify(expected) || !body.includes(displayDate) ||
      !body.includes(`${displayTime(plan.startTime)} - ${displayTime(plan.endTime)}`) ||
      !body.includes('Pending') || !body.includes('QRPH') ||
      !body.replaceAll(',', '').includes(plan.totalPrice.toFixed(2))) throw Error('OFFICIAL_CHECKOUT_STATE_MISMATCH');
}
