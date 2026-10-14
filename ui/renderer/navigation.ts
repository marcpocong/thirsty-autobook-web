import type { Dashboard } from '../types.js';

/**
 * Four destinations (Home, Booking Setup, Activity, Settings) over the existing panes. app.ts keeps owning pane
 * switching and every booking action; the new modules call these hooks instead of duplicating that logic.
 */
export type Destination = 'home' | 'setup' | 'activity' | 'settings';
export type Pane = 'home' | 'setup' | 'release' | 'strategy' | 'tests' | 'live' | 'history' | 'records' | 'tools';
export const PANE_DESTINATION: Readonly<Record<Pane, Destination>> = Object.freeze({
  home: 'home', setup: 'setup', release: 'setup', strategy: 'setup', tests: 'setup', live: 'activity', history: 'activity', records: 'activity', tools: 'settings' });
export interface TestRequestOverride { method: 'browser' | 'hybrid' | 'api-first' | 'proofless'; request: Record<string, unknown> }
export const hooks: {
  showView: (pane: Pane) => void;
  /** Booking Setup decides the workflow while its own sections are shown. */
  desiredWorkflow: (() => 'test' | 'release' | null) | null;
  /** When Booking Setup owns the plan, Prepare uses exactly its compiled setup / checkout step. */
  releaseSetup: (() => Record<string, unknown> | null) | null;
  testRequest: (() => TestRequestOverride | null) | null;
  prepare: () => Promise<void>;
  labRunning: boolean;
  setLabRunning: (running: boolean) => void;
  renderers: Array<(state: Dashboard) => void>;
  paneListeners: Array<(pane: Pane) => void>;
  latest: () => Dashboard | undefined;
} = {
  showView: () => undefined, desiredWorkflow: null, releaseSetup: null, testRequest: null, prepare: async () => undefined,
  labRunning: false, setLabRunning: () => undefined, renderers: [], paneListeners: [], latest: () => undefined,
};
export const onRender = (callback: (state: Dashboard) => void) => { hooks.renderers.push(callback); };
export const onPane = (callback: (pane: Pane) => void) => { hooks.paneListeners.push(callback); };
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, ...children: Array<Node | string | null | undefined | false>): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    // Inline style attributes are refused by the renderer CSP; the CSSOM is allowed.
    if (key === 'class') node.className = value; else if (key === 'text') node.textContent = value; else if (key === 'style') node.style.cssText = value; else node.setAttribute(key, value);
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}
/** replaceChildren that skips null/false entries (optional sections). */
export function fill(host: Element, ...children: Array<Node | string | null | undefined | false>) { host.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false)); }
export const manilaTime = (epochMs: number, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', ...options }).format(new Date(epochMs));
export const dateText = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)) : date;
export const peso = (amount: number) => `₱${amount.toLocaleString('en-US')}`;
export const hourText = (start: string) => { const h = Number(start.slice(0, 2)); return h === 24 ? '12:00 MN' : `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`; };
export const rangeText = (start: string, hours: number) => `${hourText(start)}–${hourText(`${String(Number(start.slice(0, 2)) + hours).padStart(2, '0')}:00`)}`;
export const wingName = (wing: string) => wing === 'MANGO' ? 'Mango' : wing === 'BUKO' ? 'Buko' : wing;
