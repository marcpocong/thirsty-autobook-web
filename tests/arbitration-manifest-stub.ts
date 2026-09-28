import { buildExperimentManifest, type EnsureManifestResult } from '../src/arbitration/experiment-manifest.js';

/** Controller dependency for tests that arm an API release: preregistration always succeeds and writes nothing. */
export const preregistered = (input: { targetDate: string; releaseMs: number }): EnsureManifestResult =>
  ({ status: 'CREATED', path: 'fixture/experiment-manifest.json', manifest: buildExperimentManifest(input, Date.now(), 'DESKTOP_ARM') });
