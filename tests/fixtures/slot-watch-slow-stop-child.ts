/** Offline-only observer fixture: real SlotWatch and IPC protocol, with deliberately slow synchronous finalization. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SlotWatch, type SlotWatchSummary } from '../../src/slot-watch.js';
import { SLOT_WATCH_OBSERVER_PROTOCOL, type ObserverCommand, type ObserverEvent } from '../../src/slot-watch-observer-protocol.js';

let watch: SlotWatch | undefined, activeId = '', seq = 0;
const send = (event: { type: ObserverEvent['type']; [key: string]: unknown }) =>
  process.send?.({ protocol: SLOT_WATCH_OBSERVER_PROTOCOL, id: activeId, seq: ++seq, ...event });
const pendingRead = <T>(signal: AbortSignal): Promise<T> => new Promise((_, fail) => {
  if (signal.aborted) { fail(Error('ABORTED')); return; }
  signal.addEventListener('abort', () => fail(Error('ABORTED')), { once: true });
});
process.on('message', (command: ObserverCommand) => {
  if (command.protocol !== SLOT_WATCH_OBSERVER_PROTOCOL) return;
  if (command.type === 'stop' && command.id === activeId) { void watch?.stop(command.reason); return; }
  if (command.type !== 'start' || watch) return;
  activeId = command.id;
  watch = new SlotWatch({ date: command.date, releaseMs: command.releaseMs, directory: command.directory,
    schedule: { availability: [-200, 0, 100], bookings: [] },
    // Both readers are supplied explicitly: no default provider reader or browser can run in this fixture.
    readAvailability: (_date, signal) => pendingRead(signal), readBookings: (_date, signal) => pendingRead(signal),
    onUpdate: view => send({ type: 'view', view }) });
  const finalizer = watch as unknown as { finish: () => SlotWatchSummary }, finish = finalizer.finish.bind(watch);
  finalizer.finish = () => {
    const started = performance.now();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    const summary = finish(), durationMs = performance.now() - started;
    writeFileSync(join(command.directory, 'synthetic-stop-duration.json'), JSON.stringify({ durationMs, pid: process.pid,
      parentPid: process.ppid, offlineOnly: true, status: summary.status, reason: summary.reason }));
    return summary;
  };
  // Explicit started handshake is sent only after the slow-finalization control and both offline readers are installed.
  send({ type: 'started' });
  void watch.done.then(summary => { send({ type: 'complete', summary }); process.disconnect?.(); });
});
process.on('disconnect', () => { void watch?.stop('observer parent disconnected'); });
