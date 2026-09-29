import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Build provenance written by scripts/build-support.mjs into every dist (dist/build-info.json) and shown in
 * the app, so the operator can tell exactly which commit the running installation contains.
 */
export const BuildInfoSchema = z.object({
  schema: z.literal('thirsty-build-info/v1'),
  kind: z.enum(['source-build', 'installation']),
  gitSha: z.string().regex(/^(?:[a-f0-9]{40}|unknown)$/),
  branch: z.string().max(200),
  dirty: z.boolean().nullable(),
  builtAt: z.iso.datetime(),
  packageVersion: z.string().max(40),
  node: z.string().max(40),
  contentId: z.string().regex(/^[a-f0-9]{64}$/),
  buildId: z.string().regex(/^[A-Za-z0-9+_-]{1,80}$/),
}).strict();
export type BuildInfo = z.infer<typeof BuildInfoSchema>;

/** Reads and validates a build-info.json; null when absent or malformed (never throws). */
export function readBuildInfo(path: string): BuildInfo | null {
  try { return existsSync(path) ? BuildInfoSchema.parse(JSON.parse(readFileSync(path, 'utf8'))) : null; } catch { return null; }
}

/** Short operator label, e.g. "b8cbc16 · clean · built 2026-09-29 12:48". */
export function buildLabel(info: BuildInfo | null | undefined): string {
  if (!info) return 'Build info unavailable (development run without a clean build)';
  const state = info.dirty === null ? 'state unknown' : info.dirty ? 'UNCOMMITTED CHANGES' : 'clean';
  return `${info.gitSha.slice(0, 7)} · ${state} · built ${info.builtAt.slice(0, 16).replace('T', ' ')} UTC · ${info.buildId}`;
}
