import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';

const workspace = resolve(import.meta.dirname, '..');
const repo = join(workspace, 'Source');
const runId = 'e69098a8-b8b2-444e-b0ea-2b1170f1420f';
const destination = join(repo, 'diagnostics-archive/2026-09-26');
const sensitiveKey = /password|secret|token|cookie|email|phone|customer(?:id)?|sessionid|availabilityproof|credential|hostname|observerpid/i;
const patterns = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]'],
  [/(?:\+?63|0)9\d{9}/g, '[REDACTED_PHONE]'],
  [/[REDACTED_LOCAL_PATH]\\\s"']+/gi, '[REDACTED_LOCAL_PATH]'],
];
let redactions = 0;
function sanitize(value, key = '') {
  if (sensitiveKey.test(key)) { redactions++; return '[REDACTED]'; }
  if (Array.isArray(value)) return value.map(v => sanitize(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,sanitize(v,k)]));
  if (typeof value === 'string') {
    for (const [pattern,replacement] of patterns) value=value.replace(pattern,()=>{redactions++;return replacement;});
  }
  return value;
}
async function sanitizedFile(source, target) {
  const raw = await readFile(source, 'utf8');
  const content = source.endsWith('.ndjson')
    ? raw.split(/\r?\n/).filter(Boolean).map(line=>JSON.stringify(sanitize(JSON.parse(line)))).join('\n')+'\n'
    : source.endsWith('.json') ? JSON.stringify(sanitize(JSON.parse(raw)),null,2)+'\n' : raw.trimEnd()+'\n';
  await mkdir(resolve(target,'..'),{recursive:true});
  await writeFile(target,content,'utf8');
  return {path:relative(destination,target).replaceAll('\\','/'),bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')};
}

const evidence=join(workspace,'.local');
const files=[
  [join(workspace,'DiagnosticsLocal/final-forensics-2026-09-26/REPORT.md'),'codex/REPORT.md'],
  [join(workspace,'DiagnosticsLocal/final-forensics-2026-09-26/PRELIMINARY_REPORT_0806.md'),'codex/PRELIMINARY_REPORT_0806.md'],
  [join(workspace,'DiagnosticsLocal/final-forensics-2026-09-26/report.txt'),'codex/engine-report.txt'],
  [join(workspace,'DiagnosticsLocal/final-forensics-2026-09-26/summary.json'),'codex/engine-summary.json'],
  [join(workspace,'DiagnosticsLocal/final-forensics-2026-09-26/analysis.json'),'codex/analysis.json'],
  [join(evidence,`api-booking/run-progress/${runId}.ndjson`),'logs/run-progress.ndjson'],
  [join(evidence,'slot-watch/2026-09-28_3ca6d99a-c914-4d25-ac93-7ccd75bda270.ndjson'),'logs/slot-watch.ndjson'],
  [join(evidence,`release-forensics/${runId}/provider-trace.ndjson`),'logs/provider-trace.ndjson'],
  [join(evidence,`release-forensics/${runId}/critical-path.ndjson`),'logs/critical-path.ndjson'],
  [join(evidence,`api-booking/precision-races/${runId}-phase3-freeze.json`),'logs/phase3-freeze.json'],
  [join(repo,'SERVER_ARBITRATION_INVESTIGATION.md'),'claude/SERVER_ARBITRATION_INVESTIGATION.md'],
];
const manifest=[];
for(const [source,name] of files)manifest.push(await sanitizedFile(source,join(destination,name)));
const note=`# September 26 release evidence archive\n\nThis archive separates two reports by author. \`codex/REPORT.md\` and its supporting logs are OpenAI Codex's analysis of the September 26 run. \`claude/SERVER_ARBITRATION_INVESTIGATION.md\` is Claude's separate investigation of the September 25 release; it is not a report about the September 26 run. Claude's supporting September 25 evidence remains in [diagnostics-archive/2026-09-25](../2026-09-25/).\n\nLogs are sanitized for publication. Raw private checkout response bodies, journals, profiles, credentials, customer/contact fields, local user paths, locks, and runtime state are excluded. JSON and NDJSON fields matching the exporter's sensitive-key rules are redacted.\n`;
await writeFile(join(destination,'README.md'),note,'utf8');
manifest.push({path:'README.md',bytes:Buffer.byteLength(note),sha256:createHash('sha256').update(note).digest('hex')});
manifest.sort((a,b)=>a.path.localeCompare(b.path));
await writeFile(join(destination,'manifest.json'),JSON.stringify({schema:'release-evidence-archive/v1',runId,targetDate:'2026-09-28',exportedAt:new Date().toISOString(),fileCount:manifest.length,redactionCount:redactions,files:manifest},null,2)+'\n');
console.log(JSON.stringify({destination:relative(repo,destination),fileCount:manifest.length,redactions,files:manifest.map(x=>x.path)},null,2));
