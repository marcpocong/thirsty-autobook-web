import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const source = resolve('DiagnosticsLocal');
const destination = resolve('diagnostics-archive/2026-09-18');
const reviewedImages = new Set([
  'ui-aborted.png', 'ui-full-final.png', 'ui-observation.png',
  'ui-phase2-final.png', 'ui-phase2.png', 'ui-ready.png',
]);
const sensitiveKey = /^(?:hostname|pid|observerPid)$|password|secret|token|cookie|authorization|fingerprint|availabilityProof|email|phone|customer|sessionId/i;
const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const phone = /(?:\+?63|0)9\d{9}/g;
const localPath = /[A-Za-z]:\\Users\\[^\\\s"']+/g;
let redactions = 0;

function sanitize(value, key = '') {
  if (sensitiveKey.test(key)) { redactions++; return '[REDACTED]'; }
  if (Array.isArray(value)) return value.map(item => sanitize(item));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitize(item, name)]));
  if (typeof value === 'string') {
    const cleaned = value.replace(email, '[REDACTED_EMAIL]').replace(phone, '[REDACTED_PHONE]')
      .replace(localPath, '[REDACTED_LOCAL_PATH]');
    if (cleaned !== value) redactions++;
    return cleaned;
  }
  return value;
}

async function filesUnder(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

const manifest = [];
for (const path of await filesUnder(source)) {
  const name = relative(source, path).replaceAll('\\', '/');
  const target = join(destination, name);
  await mkdir(resolve(target, '..'), { recursive: true });
  if (name.endsWith('.json') || name.endsWith('.lock')) {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(target, JSON.stringify(sanitize(raw), null, 2) + '\n');
  } else if (reviewedImages.has(name)) {
    await copyFile(path, target);
  } else throw Error(`UNREVIEWED_DIAGNOSTIC_FILE: ${name}`);
  const bytes = await readFile(target);
  manifest.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
manifest.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(join(destination, 'manifest.json'), JSON.stringify({ sourceFileCount: manifest.length,
  redactionCount: redactions, files: manifest }, null, 2) + '\n');
console.log(JSON.stringify({ exported: manifest.length, redactions, destination: 'diagnostics-archive/2026-09-18' }));
