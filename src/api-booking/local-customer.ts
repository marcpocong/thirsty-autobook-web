import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parse as parseEnv } from 'dotenv';
import { bookingPlayers, loadConfig } from '../config.js';
import type { CheckoutCustomer } from './two-hour-reservation.js';

export const THIRSTY_PICKLE_CLIENT_ID = '532c276d-fa48-48d2-9c16-91e0ad0125fa';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class LocalCustomerError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'LocalCustomerError'; }
}

/** Binds the observed official customer ID to the configured person's contact fields. */
export function contactBinding(fullName: string, phone: string, email: string): string {
  return createHash('sha256').update(JSON.stringify([THIRSTY_PICKLE_CLIENT_ID,
    fullName.trim(), phone.replace(/\D/g, '').slice(-10), email.trim().toLowerCase()])).digest('hex');
}

export function loadLocalCheckoutCustomer(worker: 'A' | 'B' = 'A'): CheckoutCustomer {
  const config = loadConfig();
  const person = worker === 'A' ? bookingPlayers(config, 'standard').A : bookingPlayers(config, 'extended').B!;
  const privatePath = process.env.THIRSTY_API_INSTALLATION === '1' || process.env.THIRSTY_API_TEST_INSTALLATION === '1' ? '.local/private/.env.local' : '.env.local';
  const local = existsSync(privatePath) ? parseEnv(readFileSync(privatePath)) : {};
  const customerId = local[worker === 'A' ? 'ONDA_CUSTOMER_ID' : 'ONDA_CUSTOMER_B_ID'] ??
    process.env[worker === 'A' ? 'ONDA_CUSTOMER_ID' : 'ONDA_CUSTOMER_B_ID'];
  const binding = local[worker === 'A' ? 'ONDA_CUSTOMER_CONTACT_SHA256' : 'ONDA_CUSTOMER_B_CONTACT_SHA256'] ??
    process.env[worker === 'A' ? 'ONDA_CUSTOMER_CONTACT_SHA256' : 'ONDA_CUSTOMER_B_CONTACT_SHA256'];
  if (typeof customerId !== 'string' || !uuid.test(customerId) ||
    customerId === THIRSTY_PICKLE_CLIENT_ID ||
    typeof binding !== 'string' || binding !== contactBinding(person.fullName, person.phone, person.email))
    throw new LocalCustomerError(worker === 'A' ? 'LOCAL_CUSTOMER_ID_UNVERIFIED' : 'LOCAL_EXTENDED_CUSTOMER_ID_UNVERIFIED');
  const [customerFirstName, ...last] = person.fullName.trim().split(/\s+/);
  return { clientId: THIRSTY_PICKLE_CLIENT_ID, customerId, customerFirstName: customerFirstName!,
    customerLastName: last.join(' '), customerEmail: person.email, customerPhone: person.phone };
}
