import { z } from 'zod';
import { emitUiEvent } from '../ui-events.js';
import { readAuditAvailability } from './block-audit-read.js';
import { prooflessCourtHourStatuses } from './proofless-checkout.js';
import { readPublicBookingRecords } from './public-bookings.js';
import { loadObservationConfig, releaseMsForTargetDate } from '../config.js';

import { verifiedAvailabilitySession } from './verified-availability-session.js';

const input = z.object({ date: z.iso.date() }).strict().parse(JSON.parse(process.argv[2] ?? '{}'));

async function main(): Promise<void> {
  // A missing date is "not yet published" only for Onda's empty response observed before its release instant.
  const releaseMs = releaseMsForTargetDate(loadObservationConfig(), input.date);
  const started=performance.now();let publicDurationMs=0;
  const session=await verifiedAvailabilitySession().catch(()=>undefined);
  try {
  const [read, publicRecords] = await Promise.all([
    readAuditAvailability(input.date,{},session?.provider()), readPublicBookingRecords(input.date).then(result=>{publicDurationMs=Math.round(performance.now()-started);return result;})]);
  const cells = prooflessCourtHourStatuses(read.snapshot, input.date, publicRecords.blocks, publicRecords.failedCourts,
    { releaseMs, observedAtMs: read.observedAtMs });
  emitUiEvent({ type: 'blockAudit', date: input.date, cells,diagnostics:{availability:read.diagnostics,publicBookings:{failedCourts:publicRecords.failedCourts,durationMs:publicDurationMs},durationMs:Math.round(performance.now()-started)} });
  }finally{await session?.close();}
}

main().catch(error => {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)
    ? error.message : 'BLOCK_AUDIT_FAILED';
  console.error(code); process.exitCode = 1;
});
