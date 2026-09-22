import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseEnv } from 'dotenv';

const worker = process.argv[2];
if (!['E', 'F', 'G', 'H'].includes(worker)) throw Error('WORKER_INVALID');
const root = resolve('..');
const people = parseEnv(readFileSync(resolve(root, '.local/private/players-e-h.env')));
const person = { fullName: people[`PLAYER_${worker}_FULL_NAME`],
  phone: people[`PLAYER_${worker}_PHONE`], email: people[`PLAYER_${worker}_EMAIL`] };
if (Object.values(person).some(value => !value)) throw Error('PLAYER_MISSING');
const port = 19444 + 'ABCDEFGH'.indexOf(worker);
const profile = resolve(root, `.local/api-first-chrome-profile-${worker.toLowerCase()}`);
const phone = value => String(value ?? '').replace(/\D/g, '').slice(-10);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clientId = '532c276d-fa48-48d2-9c16-91e0ad0125fa';
const [firstName, ...lastNames] = person.fullName.trim().split(/\s+/);
const lastName = lastNames.join(' ');
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
const onResponse = response => {
  if (response.request().method() !== 'POST' || !new URL(response.url()).pathname.endsWith('/api/public/customers')) return;
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
  await page.getByRole('heading', { name: 'Payment Summary' }).waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => false, undefined, { timeout: 1000 }).catch(() => {});
  if (observed instanceof Error) throw observed;
  if (!observed) throw Error('CUSTOMER_RESPONSE_NOT_OBSERVED');
  if (await page.getByRole('checkbox', { name: /I agree to the Terms/ }).isChecked()) throw Error('TERMS_UNEXPECTEDLY_ACCEPTED');
  process.stdout.write(JSON.stringify({ worker, customerId: observed }));
} finally {
  page.off('response', onResponse);
  await page.goto('https://app.onda.fit/book/thirsty-pickle', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await browser.close();
}
