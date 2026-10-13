import type { Wing } from './court-registry.js';

/** Current Buko support is exact-date, proof-based Normal only. This boundary
 * never converts a release, proofless or multi-target plan into a Normal test.
 */
export function assertWingNormalRequest(input: { wing?: Wing; method: string; mode: string; strategy: string;
  courtCount: number; exact?: number[][]; fallbackStarts: readonly string[] }) {
  if (input.wing === undefined || input.wing === 'MANGO') return;
  if (input.wing !== 'BUKO' || input.method !== 'api-first' || !['prepare','dry','live-now'].includes(input.mode) ||
      input.strategy !== 'standard' || input.courtCount !== 1 || input.fallbackStarts.length ||
      input.exact?.length !== 1 || input.exact[0]?.length !== 1 ||
      !Number.isInteger(input.exact[0][0]) || input.exact[0][0]! < 1 || input.exact[0][0]! > 7)
    throw Error('BUKO_EXACT_NORMAL_PLAN_REQUIRED');
}
