import { z } from 'zod';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { checkAvailability } from './availability-observer.js';
import { emitUiEvent } from '../ui-events.js';

/** One-click read-only availability for both wings. Needs no prepared checkout browser and performs no booking POST. */
const { date } = z.object({ date: z.iso.date() }).strict().parse(JSON.parse(process.argv[2] ?? '{}'));
let aborted = false;
process.on('message', message => { if ((message as { type?: string })?.type === 'abort') aborted = true; });
const directory = resolve('.local/availability-check');
await mkdir(directory, { recursive: true });
try {
  const check = await checkAvailability(date, { directory, isAborted: () => aborted, onPhase: phase => process.stdout.write(`${phase}\n`) });
  emitUiEvent({ type: 'courtBrowser', ...check });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'AVAILABILITY_READ_FAILED'}\n`);
  process.exitCode = 1;
} finally { if (process.connected) process.disconnect(); }
