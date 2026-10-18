/** Dependency-free (renderer-safe) provenance wording. */
/** Source Updated / Installed comparison in plain terms. CI status is never inferred from a local checkout. */
export function provenanceStatus(installedSha: string | null | undefined, source: { headSha: string | null; branch: string | null } | null | undefined): { label: string; detail: string; tone: 'good' | 'warn' | 'muted' } {
  if (!installedSha) return { label: 'Installed build unknown', detail: 'The running build has no build metadata.', tone: 'warn' };
  if (!source?.headSha) return { label: 'Installed', detail: `Installed ${installedSha.slice(0, 7)}. No local source checkout was found to compare with.`, tone: 'muted' };
  if (source.headSha === installedSha) return { label: 'Installed matches source', detail: `Installed ${installedSha.slice(0, 7)} is the local source ${source.branch ?? 'HEAD'} commit.`, tone: 'good' };
  return { label: 'Source updated · not installed', detail: `Local source ${source.branch ?? 'HEAD'} is at ${source.headSha.slice(0, 7)}, but this app runs ${installedSha.slice(0, 7)}. A newer source is not installed until the canonical updater (npm run app:update) builds, verifies and installs it.`, tone: 'warn' };
}
