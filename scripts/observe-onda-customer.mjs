import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseEnv } from 'dotenv';

const worker = process.argv[2];
const writeBinding = process.argv.includes('--write-binding');
if (!['B', 'E', 'F', 'G', 'H'].includes(worker)) throw Error('WORKER_INVALID');
const root = resolve('..');
const peoplePath = worker === 'B' ? resolve('.env.local') : resolve(root, '.local/private/players-e-h.env');
const peopleSource = readFileSync(peoplePath, 'utf8');
const people = parseEnv(peopleSource);
const person = { fullName: people[`PLAYER_${worker}_FULL_NAME`],
  phone: people[`PLAYER_${worker}_PHONE`], email: people[`PLAYER_${worker}_EMAIL`] };
if (Object.values(person).some(value => !value)) throw Error('PLAYER_MISSING');
let port = 19444 + 'ABCDEFGH'.indexOf(worker);
try {
  const endpoints = JSON.parse(readFileSync(resolve('.local/browser-endpoints.json'), 'utf8'));
  const saved = endpoints?.version === 1 ? endpoints[worker] : undefined;
  if (Number.isInteger(saved) && saved >= 1024 && saved <= 65535) port = saved;
} catch { /* The API-installation default remains authoritative when no saved map exists. */ }
const profile = resolve(root, `.local/api-first-chrome-profile-${worker.toLowerCase()}`);
const phone = value => String(value ?? '').replace(/\D/g, '').slice(-10);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clientId = '532c276d-fa48-48d2-9c16-91e0ad0125fa';
const [firstName, ...lastNames] = person.fullName.trim().split(/\s+/);
const lastName = lastNames.join(' ');
const binding = createHash('sha256').update(JSON.stringify([clientId,
  person.fullName.trim(), phone(person.phone), person.email.trim().toLowerCase()])).digest('hex');
function replaceExactlyOnce(source, key, value) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (!pattern.test(source)) throw Error('CUSTOMER_BINDING_KEY_MISSING');
  return source.replace(pattern, `${key}=${value}`);
}
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
if (!context) throw Error('DEDICATED_CONTEXT_MISSING');
const pages = context.pages();
const page = pages.find(p => p.url() === 'https://app.onda.fit/book/thirsty-pickle');
if (!page || pages.length !== 1) throw Error('DEDICATED_EXACT_TAB_MISSING');
if (!profile.toLowerCase().endsWith(`api-first-chrome-profile-${worker.toLowerCase()}`)) throw Error('PROFILE_INVALID');
const checkoutGuard = async route => route.request().method() === 'POST' ? route.abort() : route.continue();
await page.route('**/api/bookings/public-checkout', checkoutGuard);
await page.route('**/api/public/bookings', checkoutGuard);
let observed = null;
const customerActivity = [];
const onRequest = request => {
  try {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/public/customers')) customerActivity.push(`${request.method()} ${path}`);
  } catch { /* Diagnostics never affect the customer flow. */ }
};
const onResponse = response => {
  if (response.request().method() !== 'POST' || !new URL(response.url()).pathname.startsWith('/api/public/customers')) return;
  void (async () => {
    const request = response.request().postDataJSON();
    if (request?.clientId !== clientId || String(request?.email ?? '').toLowerCase() !== person.email.toLowerCase() ||
      phone(request?.phone) !== phone(person.phone) || request?.firstName !== firstName || request?.lastName !== lastName)
      throw Error('CUSTOMER_REQUEST_CONTACT_MISMATCH');
    const body = await response.json();
    if (response.status() !== 200 || body?.success !== true) throw Error('CUSTOMER_RESPONSE_REJECTED');
    const id = body?.data?.customer?.id ?? body?.data?.id ?? body?.customer?.id ?? body?.customerId;
    if (typeof id !== 'string' || !uuid.test(id) || id === clientId) throw Error('CUSTOMER_ID_UNVERIFIED');
    observed = id;
  })().catch(error => { observed = error; });
};
page.on('request', onRequest);
page.on('response', onResponse);
try {
  await page.goto('https://app.onda.fit/book/thirsty-pickle', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Next day' }).click();
  const slot = page.getByRole('button', { name: /^Court \d+:.*\d+ (?:AM|PM) to \d+ (?:AM|PM) available$/ }).first();
  await slot.waitFor({ state: 'visible', timeout: 15000 });
  await slot.click();
  await page.getByRole('button', { name: 'Proceed', exact: true }).click();
  await page.getByRole('heading', { name: 'Player Information' }).waitFor({ state: 'visible' });
  await page.getByRole('textbox', { name: 'Full Name' }).fill(person.fullName);
  await page.getByRole('textbox', { name: 'Phone Number' }).fill(phone(person.phone));
  await page.getByRole('textbox', { name: 'Email Address' }).fill(person.email);
  await page.getByRole('button', { name: 'Proceed', exact: true }).click();
  const responseDeadline = Date.now() + 30000;
  while (observed === null && Date.now() < responseDeadline)
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  if (observed instanceof Error) throw observed;
  if (!observed) {
    const alerts = await page.locator('[role="alert"]').allTextContents().catch(() => []);
    process.stderr.write(`${JSON.stringify({ customerActivity: [...new Set(customerActivity)], alertCount: alerts.length,
      turnstileFrames: page.frames().filter(frame => frame.url().includes('challenges.cloudflare.com')).length })}\n`);
    throw Error('CUSTOMER_RESPONSE_NOT_OBSERVED');
  }
  const terms = page.getByRole('checkbox', { name: /I agree to the Terms/ });
  if (await terms.count() && await terms.isChecked()) throw Error('TERMS_UNEXPECTEDLY_ACCEPTED');
  if (writeBinding) {
    if (worker !== 'B') throw Error('CUSTOMER_BINDING_WRITE_UNSUPPORTED');
    const installedPath = resolve(root, '.local/private/.env.local');
    const paths = [peoplePath, ...(existsSync(installedPath) ? [installedPath] : [])];
    const updates = paths.map(path => {
      const source = readFileSync(path, 'utf8'), values = parseEnv(source);
      if (values.PLAYER_B_FULL_NAME?.trim() !== person.fullName.trim() ||
        phone(values.PLAYER_B_PHONE) !== phone(person.phone) ||
        values.PLAYER_B_EMAIL?.trim().toLowerCase() !== person.email.trim().toLowerCase())
        throw Error('CUSTOMER_BINDING_CONTACT_MISMATCH');
      const otherIds = ['ONDA_CUSTOMER_ID', 'ONDA_CUSTOMER_C_ID', 'ONDA_CUSTOMER_D_ID', 'ONDA_CUSTOMER_E_ID',
        'ONDA_CUSTOMER_F_ID', 'ONDA_CUSTOMER_G_ID', 'ONDA_CUSTOMER_H_ID'].map(key => values[key]?.trim().toLowerCase()).filter(Boolean);
      if (otherIds.includes(observed.toLowerCase())) throw Error('CUSTOMER_ID_DUPLICATE_LOCAL');
      return { path, source: replaceExactlyOnce(replaceExactlyOnce(source, 'ONDA_CUSTOMER_B_ID', observed),
        'ONDA_CUSTOMER_B_CONTACT_SHA256', binding) };
    });
    for (const update of updates)
      writeFileSync(`${update.path}.${process.pid}.tmp`, update.source, { encoding: 'utf8', mode: 0o600 });
    for (const update of updates) renameSync(`${update.path}.${process.pid}.tmp`, update.path);
    process.stdout.write(JSON.stringify({ worker, bindingUpdated: true, installedUpdated: paths.includes(installedPath) }));
  } else process.stdout.write(JSON.stringify({ worker, customerId: observed }));
} finally {
  page.off('request', onRequest);
  page.off('response', onResponse);
  await page.goto('https://app.onda.fit/book/thirsty-pickle', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await browser.close();
}
