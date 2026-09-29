/**
 * Counterfactual Strategy V2 replay over recorded Slot Watch logs (offline; nothing is sent).
 * Usage: npx tsx scripts/replay-strategy-v2.ts <slot-watch.ndjson> [more logs...] [--preset BALANCED|RELEASE_FOCUSED|RESCUE_FOCUSED] [--width 1-4]
 */
import { readObserverLog } from '../src/release-forensics.js';
import { replayStrategyV2, strategyReplayText } from '../src/strategy-replay-v2.js';

const args = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
const paths = args.filter((value, index) => !value.startsWith('--') && !(index > 0 && args[index - 1]!.startsWith('--')));
if (!paths.length) throw Error('REPLAY_LOG_REQUIRED');
for (const path of paths) {
  const log = readObserverLog(path);
  if (!log) { process.stdout.write(`${path}: not a readable Slot Watch log\n`); continue; }
  const result = replayStrategyV2(log, { key: `${log.date}@${log.releaseMs}`, origin: 'HISTORICAL_PRE_PHASE3', quality: { label: 'FAIR' } as never, attempts: [] },
    { preset: (option('preset') ?? 'BALANCED') as 'BALANCED', fanOutWidth: Number(option('width') ?? 2) });
  process.stdout.write(`${strategyReplayText(result)}\n`);
}
