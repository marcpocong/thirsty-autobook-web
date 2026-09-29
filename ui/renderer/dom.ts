/** Small DOM helpers shared by the renderer modules. The renderer never uses innerHTML for data. */
export const byId = (id: string) => document.getElementById(id)!;
export const inputById = (id: string) => byId(id) as HTMLInputElement;
export const selectById = (id: string) => byId(id) as HTMLSelectElement;
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
/** A list of plain text lines. */
export function lines(tag: 'ul' | 'ol', className: string, values: readonly string[]): HTMLElement {
  const list = el(tag, className);
  list.replaceChildren(...values.map(value => el('li', '', value)));
  return list;
}
/** A definition grid of label/value facts. */
export function facts(target: HTMLElement, rows: ReadonlyArray<readonly [string, string]>): void {
  target.replaceChildren(...rows.map(([label, value]) => { const row = el('div'); row.append(el('dt', '', label), el('dd', '', value)); return row; }));
}
/** A simple table; every cell is text. */
export function table(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string>>, className = 'insights-table'): HTMLTableElement {
  const result = el('table', className), head = el('thead'), body = el('tbody'), headRow = el('tr');
  headRow.append(...headers.map(header => el('th', '', header)));
  head.append(headRow);
  body.append(...rows.map(row => { const tr = el('tr'); tr.append(...row.map(cell => el('td', '', cell))); return tr; }));
  result.append(head, body);
  return result;
}
export const empty = (text: string) => el('p', 'empty', text);
