import { createHash } from 'node:crypto';
import { sanitizeContentType, sanitizeHeader, sanitizeServerTiming, type ServerTimingEntry } from './checkout-provider-trace.js';

/**
 * Sanitized, structure-first evidence about one HTTP response (usually a rejected checkout).
 *
 * Why: the 2026-09-25 release produced two HTTP 409 body-size populations (~220 B and ~400 B)
 * that cannot be explained because only a coarse hint was kept. This module keeps enough to
 * tell different server paths apart next time, without storing anything sensitive:
 *
 * - the body is never stored. Only its byte length, its JSON shape (key paths, value types,
 *   string/array lengths) and a small allowlist of scalar fields (success, error, message,
 *   code, ...) survive, and those strings pass through redaction first;
 * - exact values the caller knows are private (customer name/email/phone/IDs, Turnstile token,
 *   fingerprint) are removed before any pattern rule runs;
 * - generic rules then remove e-mail addresses, phone-like numbers, UUIDs, JWT/base64 tokens,
 *   long hex, mixed letter+digit identifiers, long digit runs, URLs and likely person names;
 * - headers are copied only from a fixed allowlist, each value validated by a strict pattern.
 *
 * Fingerprints are SHA-256 over the SANITIZED shape/fields only (never over raw text), so two
 * responses with the same structure can be grouped without keeping or confirming their content.
 */
export const RESPONSE_EVIDENCE_VERSION = 1;
const MAX_BODY_BYTES = 1_000_000;
const MAX_SHAPE_ENTRIES = 64;
const MAX_DEPTH = 5;
const MAX_FIELD_TEXT = 300;

export type ShapeType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
export interface ShapeEntry { path: string; type: ShapeType; /** String length (chars) or array length. */ length?: number }
export interface ResponseBodyEvidence {
  version: typeof RESPONSE_EVIDENCE_VERSION;
  byteLength: number;
  contentKind: 'json' | 'html' | 'text' | 'empty' | 'other';
  jsonType?: ShapeType;
  shape?: ShapeEntry[];
  shapeTruncated?: boolean;
  /** Allowlisted scalar fields after redaction (strings are capped at 300 characters). */
  fields?: Record<string, string | number | boolean | null>;
  /** How many substitutions each redaction rule made (counts only). */
  redactions?: Record<string, number>;
  /** SHA-256 of the sorted shape (paths and types, not lengths). */
  shapeFingerprint?: string;
  /** SHA-256 of the shape with lengths plus the sanitized fields. */
  sanitizedFingerprint?: string;
}

/** Top-level (or `error.`-nested) scalar keys whose sanitized values are kept. */
const FIELD_ALLOWLIST = new Set(['success', 'ok', 'error', 'message', 'code', 'errorCode', 'error_code', 'hint', 'reason', 'type',
  'status', 'statusCode', 'category', 'detail', 'title', 'conflict', 'conflictType', 'retryable', 'retryAfter']);
const NESTED_FIELD_PARENTS = new Set(['error', 'errors', 'details', 'detail', 'data']);

/** Words that are never treated as a person's name by the capitalised-pair rule. */
const NAME_RULE_ALLOWLIST = new Set(['Court', 'Courts', 'Mango', 'Wing', 'Thirsty', 'Pickle', 'SM', 'Seaside', 'Onda', 'Fit', 'This', 'The', 'That',
  'These', 'Those', 'Please', 'Sorry', 'Your', 'You', 'We', 'Our', 'Slot', 'Slots', 'Booking', 'Bookings', 'Date', 'Time', 'Payment', 'Checkout',
  'Invalid', 'Unable', 'Cannot', 'Could', 'Not', 'No', 'Some', 'One', 'Selected', 'Requested', 'Facility', 'Space', 'Session', 'Availability',
  'Available', 'Unavailable', 'Error', 'Conflict', 'Try', 'Again', 'Pending', 'Confirmed', 'Hold', 'Held', 'Reserved', 'Already', 'Booked',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December', 'AM', 'PM', 'PHP', 'QRPH', 'API', 'ID', 'OK', 'Online', 'Guest', 'Customer', 'Member']);

interface RedactionRule { name: string; pattern: RegExp; replace: (match: string) => string | null }
const always = (replacement: string) => () => replacement;
const RULES: RedactionRule[] = [
  { name: 'url', pattern: /\bhttps?:\/\/[^\s"'<>]+/gi, replace: always('[url]') },
  { name: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replace: always('[email]') },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{4,})?/g, replace: always('[token]') },
  { name: 'uuid', pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, replace: always('[uuid]') },
  // Phone-like: 10-15 digits with optional separators. An ISO date (optionally followed by an hour) is not a phone.
  { name: 'phone', pattern: /\+?\d[\d\s().-]{8,}\d/g, replace: match => {
    const digits = match.replace(/\D/g, '').length;
    return digits < 10 || digits > 15 || /^\d{4}-\d{2}-\d{2}/.test(match) ? null : '[phone]';
  } },
  { name: 'hex', pattern: /\b[0-9a-f]{16,}\b/gi, replace: always('[hex]') },
  { name: 'token', pattern: /\b[A-Za-z0-9_-]{24,}\b/g, replace: always('[token]') },
  { name: 'id', pattern: /\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{8,}\b/g, replace: always('[id]') },
  { name: 'digits', pattern: /\d{7,}/g, replace: always('[digits]') },
];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const count = (counts: Record<string, number>, name: string, by: number) => { if (by > 0) counts[name] = (counts[name] ?? 0) + by; };

/**
 * Redacts one free-text value. `known` holds exact private values (and their obvious variants are the
 * caller's job); they are removed first, case-insensitively, then the generic rules run in order.
 */
export function redactText(value: string, known: readonly string[] = [], counts: Record<string, number> = {}): string {
  let text = value.normalize('NFKC');
  for (const secret of [...new Set(known.filter(item => typeof item === 'string' && item.trim().length >= 3))].sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(escapeRegExp(secret.trim()), 'gi');
    const matches = text.match(pattern)?.length ?? 0;
    if (matches) { text = text.replace(pattern, '[redacted]'); count(counts, 'known', matches); }
  }
  for (const rule of RULES) {
    let replaced = 0;
    text = text.replace(rule.pattern, match => { const value = rule.replace(match); if (value === null) return match; replaced++; return value; });
    count(counts, rule.name, replaced);
  }
  // Two or three consecutive capitalised words that are not venue/common words: likely a person's name.
  text = text.replace(/\b([A-Z][a-z]{1,20})(\s+[A-Z][a-z]{1,20}){1,2}\b/g, match => {
    const words = match.split(/\s+/);
    if (words.every(word => NAME_RULE_ALLOWLIST.has(word)) || words.filter(word => !NAME_RULE_ALLOWLIST.has(word)).length < 2) return match;
    count(counts, 'name', 1);
    return '[name]';
  });
  text = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > MAX_FIELD_TEXT ? `${text.slice(0, MAX_FIELD_TEXT)}…` : text;
}

const typeOf = (value: unknown): ShapeType => value === null ? 'null' : Array.isArray(value) ? 'array' :
  typeof value === 'object' ? 'object' : typeof value === 'string' ? 'string' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'null';
/** Object keys become path segments only if they look like identifiers; anything else is a placeholder. */
const segment = (key: string) => /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(key) ? key : '<key>';

function describeShape(value: unknown): { shape: ShapeEntry[]; truncated: boolean } {
  const shape: ShapeEntry[] = [];
  let truncated = false;
  const visit = (node: unknown, path: string, depth: number) => {
    if (shape.length >= MAX_SHAPE_ENTRIES) { truncated = true; return; }
    const type = typeOf(node);
    const entry: ShapeEntry = { path: path || '$', type };
    if (type === 'string') entry.length = (node as string).length;
    if (type === 'array') entry.length = (node as unknown[]).length;
    shape.push(entry);
    if (depth >= MAX_DEPTH) { if (type === 'object' || type === 'array') truncated = true; return; }
    if (type === 'array') {
      // Arrays are summarised by their first element (types of later elements are usually identical).
      const items = node as unknown[];
      if (items.length) visit(items[0], `${path}[]`, depth + 1);
    } else if (type === 'object') {
      for (const key of Object.keys(node as Record<string, unknown>).sort()) visit((node as Record<string, unknown>)[key], path ? `${path}.${segment(key)}` : segment(key), depth + 1);
    }
  };
  visit(value, '', 0);
  return { shape, truncated };
}

function collectFields(root: Record<string, unknown>, known: readonly string[], counts: Record<string, number>): Record<string, string | number | boolean | null> {
  const fields: Record<string, string | number | boolean | null> = {};
  const take = (key: string, value: unknown, prefix = '') => {
    if (!FIELD_ALLOWLIST.has(key)) return;
    const name = `${prefix}${key}`;
    if (typeof value === 'string') fields[name] = redactText(value, known, counts);
    else if (typeof value === 'number' && Number.isFinite(value)) fields[name] = value;
    else if (typeof value === 'boolean' || value === null) fields[name] = value;
  };
  for (const [key, value] of Object.entries(root)) {
    take(key, value);
    if (NESTED_FIELD_PARENTS.has(key)) {
      const nested = Array.isArray(value) ? value[0] : value;
      if (nested && typeof nested === 'object' && !Array.isArray(nested))
        for (const [inner, innerValue] of Object.entries(nested as Record<string, unknown>)) take(inner, innerValue, `${segment(key)}${Array.isArray(value) ? '[]' : ''}.`);
    }
  }
  return fields;
}

const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Structure-first evidence for one response body. Never throws; never returns raw body text. */
export function responseBodyEvidence(body: string, contentType: string, known: readonly string[] = []): ResponseBodyEvidence {
  const text = typeof body === 'string' ? body : '';
  const byteLength = Buffer.byteLength(text, 'utf8');
  const type = (contentType ?? '').toLowerCase();
  const contentKind: ResponseBodyEvidence['contentKind'] = !text ? 'empty' : type.includes('json') ? 'json' : type.includes('html') ? 'html' : type.startsWith('text/') ? 'text' : 'other';
  const evidence: ResponseBodyEvidence = { version: RESPONSE_EVIDENCE_VERSION, byteLength, contentKind };
  if (contentKind !== 'json' || byteLength > MAX_BODY_BYTES) return evidence;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return evidence; }
  const counts: Record<string, number> = {};
  const { shape, truncated } = describeShape(parsed);
  evidence.jsonType = typeOf(parsed);
  evidence.shape = shape;
  if (truncated) evidence.shapeTruncated = true;
  if (evidence.jsonType === 'object') evidence.fields = collectFields(parsed as Record<string, unknown>, known, counts);
  if (Object.keys(counts).length) evidence.redactions = counts;
  evidence.shapeFingerprint = sha256(shape.map(entry => `${entry.path}:${entry.type}`).sort());
  evidence.sanitizedFingerprint = sha256({ shape, fields: evidence.fields ?? null });
  return evidence;
}

/** Response headers kept for provider diagnostics; each value must match its pattern exactly or it is dropped. */
export const RESPONSE_HEADER_ALLOWLIST = ['content-type', 'content-length', 'server', 'date', 'age', 'cache-control', 'x-vercel-id', 'x-vercel-cache',
  'x-matched-path', 'x-request-id', 'server-timing', 'retry-after', 'cf-ray', 'cf-mitigated', 'x-ratelimit-limit', 'x-ratelimit-remaining',
  'x-ratelimit-reset', 'ratelimit', 'ratelimit-policy', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'x-powered-by', 'via'] as const;
export type AllowedResponseHeader = typeof RESPONSE_HEADER_ALLOWLIST[number];
const EXTRA_HEADER_RULES: Partial<Record<AllowedResponseHeader, RegExp>> = {
  'content-length': /^\d{1,9}$/,
  date: /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/,
  'cache-control': /^[a-z0-9=, -]{1,120}$/i,
  'x-matched-path': /^\/[A-Za-z0-9/_\-[\].]{0,120}$/,
  'retry-after': /^(?:\d{1,6}|[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT)$/,
  'x-ratelimit-limit': /^\d{1,9}$/, 'x-ratelimit-remaining': /^\d{1,9}$/, 'x-ratelimit-reset': /^\d{1,13}$/,
  ratelimit: /^[A-Za-z0-9=;,. "_-]{1,160}$/, 'ratelimit-policy': /^[A-Za-z0-9=;,. "_-]{1,160}$/,
  'ratelimit-limit': /^\d{1,9}$/, 'ratelimit-remaining': /^\d{1,9}$/, 'ratelimit-reset': /^\d{1,13}$/,
  'x-powered-by': /^[A-Za-z0-9 ._/-]{1,40}$/,
  via: /^[A-Za-z0-9 ._/:,()-]{1,120}$/,
};
/** Allowlisted, validated headers. Unknown names are ignored; invalid values are dropped, never truncated. */
export function sanitizeResponseHeaders(headers: Readonly<Record<string, string | null | undefined>>): Partial<Record<AllowedResponseHeader, string>> {
  const lookup = new Map(Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value] as const));
  const kept: Partial<Record<AllowedResponseHeader, string>> = {};
  for (const name of RESPONSE_HEADER_ALLOWLIST) {
    const raw = lookup.get(name);
    if (typeof raw !== 'string' || !raw.trim()) continue;
    let value: string | null = null;
    if (name === 'content-type') value = sanitizeContentType(raw);
    else if (name === 'server-timing') {
      // Names and durations only; free-text descriptions are dropped.
      const entries = sanitizeServerTiming(raw);
      value = entries ? entries.map(entry => entry.durMs !== undefined ? `${entry.name};dur=${entry.durMs}` : entry.name).join(', ') : null;
    } else if (EXTRA_HEADER_RULES[name]) value = EXTRA_HEADER_RULES[name]!.test(raw.trim()) ? raw.trim() : null;
    else value = sanitizeHeader(name, raw);
    if (value !== null) kept[name] = value;
  }
  return kept;
}

/**
 * `x-vercel-id` looks like `sin1::sin1::p8z7w-1790294400030-a73f748bcd1f`: region hops, then a
 * request token whose middle part reads as epoch milliseconds. Vercel documents the regions, not
 * the number. `embeddedMs` is therefore an UNDOCUMENTED value, stored for comparison only: it is
 * consistent with an edge-receipt time in the 2026-09-25 evidence but is never used as ground truth.
 */
export interface VercelIdParts { regions: string[]; edgeRegion: string; functionRegion: string | null; embeddedMs: number | null; embeddedInterpretation: 'UNDOCUMENTED' }
export function parseVercelId(value: unknown): VercelIdParts | null {
  if (typeof value !== 'string') return null;
  const match = /^((?:[a-z0-9]{2,8}::){1,4})([a-z0-9]{3,12})-(\d{10,16})-([a-f0-9]{6,20})$/.exec(value.trim());
  if (!match) return null;
  const regions = match[1]!.split('::').filter(Boolean);
  const number = Number(match[3]);
  // Only a 13-digit number in a plausible epoch-ms range is surfaced; anything else stays null.
  const embeddedMs = match[3]!.length === 13 && number > 1_500_000_000_000 && number < 4_000_000_000_000 ? number : null;
  return { regions, edgeRegion: regions[0]!, functionRegion: regions.length > 1 ? regions.at(-1)! : null, embeddedMs, embeddedInterpretation: 'UNDOCUMENTED' };
}

/** Epoch ms of an HTTP `Date` header (1-second resolution), or null. */
export function parseHttpDate(value: unknown): number | null {
  if (typeof value !== 'string' || !EXTRA_HEADER_RULES.date!.test(value.trim())) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface ResponseEvidence {
  version: typeof RESPONSE_EVIDENCE_VERSION;
  status: number;
  headers: Partial<Record<AllowedResponseHeader, string>>;
  vercel: VercelIdParts | null;
  /** `Date` header in epoch ms (1 s resolution): bounds the provider clock, never ground truth. */
  serverDateMs: number | null;
  serverTiming: ServerTimingEntry[] | null;
  body: ResponseBodyEvidence;
}

/** Everything a rejected (or unexpected) response can safely contribute to diagnostics. Never throws. */
export function responseEvidence(input: { status: number; contentType: string; body: string; headers?: Readonly<Record<string, string | null | undefined>> },
  known: readonly string[] = []): ResponseEvidence {
  try {
    const headers = sanitizeResponseHeaders({ 'content-type': input.contentType, ...(input.headers ?? {}) });
    return { version: RESPONSE_EVIDENCE_VERSION, status: Number.isInteger(input.status) ? input.status : 0, headers,
      vercel: parseVercelId(headers['x-vercel-id']), serverDateMs: parseHttpDate(headers.date),
      serverTiming: headers['server-timing'] ? sanitizeServerTiming(headers['server-timing']) : null,
      body: responseBodyEvidence(input.body, input.contentType, known) };
  } catch {
    return { version: RESPONSE_EVIDENCE_VERSION, status: 0, headers: {}, vercel: null, serverDateMs: null, serverTiming: null,
      body: { version: RESPONSE_EVIDENCE_VERSION, byteLength: 0, contentKind: 'other' } };
  }
}
