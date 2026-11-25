import { formatBoth, formatCm, parseLength, parseOffset } from '../model/units';

type Attrs = Record<string, unknown> | null;
type Child = Node | string | number | null | undefined | false;

// Makes an HTML element: h('button', { onclick }, 'Label')
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...kids: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

let toastEl: HTMLElement | null = null, toastTimer: ReturnType<typeof setTimeout> | undefined;
// Short message at the top of the screen
export function toast(msg: string, host: HTMLElement = document.body) {
  if (!toastEl || !host.contains(toastEl)) { toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }); host.append(toastEl); }
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl?.classList.remove('show'), 2600);
}

// Bottom sheet; returns a close function
export function sheet(title: string, body: Node[], opts: { onClose?: () => void } = {}): () => void {
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title }, h('h2', null, title), ...body);
  const bd = h('div', { class: 'backdrop' }, panel);
  const close = () => { bd.remove(); document.removeEventListener('keydown', esc); opts.onClose?.(); };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  bd.addEventListener('pointerdown', e => { if (e.target === bd) close(); });
  document.addEventListener('keydown', esc);
  document.body.append(bd);
  setTimeout(() => (panel.querySelector('input,select') as HTMLElement | null)?.focus(), 50);
  return close;
}

// Yes/no question
export function confirmDialog(text: string, okLabel: string, danger = true): Promise<boolean> {
  return new Promise(res => {
    let done = false;
    const finish = (v: boolean) => { if (!done) { done = true; close(); res(v); } };
    const close = sheet(text, [h('div', { class: 'row' },
      h('button', { type: 'button', class: danger ? 'warn' : 'primary', onclick: () => finish(true) }, okLabel),
      h('button', { type: 'button', onclick: () => finish(false) }, 'Cancel'))], { onClose: () => finish(false) });
  });
}

// One-line text question
export function promptDialog(title: string, label: string, value: string, okLabel: string): Promise<string | null> {
  return new Promise(res => {
    let done = false;
    const input = h('input', { value, maxlength: 80, 'aria-label': label });
    const err = h('div', { class: 'err' });
    const finish = (v: string | null) => { if (done) return; if (v !== null && !v.trim()) { err.textContent = 'Enter a name'; return; } done = true; close(); res(v?.trim() ?? null); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(input.value); });
    const close = sheet(title, [h('div', { class: 'field' }, h('label', null, label), input, err), h('div', { class: 'row' },
      h('button', { type: 'button', class: 'primary', onclick: () => finish(input.value) }, okLabel),
      h('button', { type: 'button', onclick: () => finish(null) }, 'Cancel'))], { onClose: () => finish(null) });
  });
}

export type Unit = 'cm' | 'sq';
export interface LengthField { el: HTMLElement; value: () => number | null; ok: () => boolean; set: (cm: number) => void; setUnit: (u: Unit, sq: number) => void; refresh: () => void }

// A length box that accepts cm or squares, shows errors under it, and the other unit live
export function lengthField(label: string, initialCm: number | null, unit: Unit, squareCm: number, onInput: () => void, opts: { allowZero?: boolean; placeholder?: string; optional?: boolean; plain?: boolean } = {}): LengthField {
  let u = unit, sq = squareCm, cm: number | null = initialCm;
  const fmt = (v: number) => (u === 'cm' ? String(Math.round(v * 100) / 100) : sqText(v / sq));
  const input = h('input', { inputmode: 'decimal', autocomplete: 'off', value: initialCm == null ? '' : fmt(initialCm), placeholder: opts.placeholder ?? '' });
  const unitEl = h('span', { class: 'muted' });
  const hint = h('div', { class: 'hint num' });
  const err = h('div', { class: 'err' });
  let valid = true;
  const parse = () => {
    if (opts.optional && !input.value.trim()) { cm = null; valid = true; err.textContent = ''; hint.textContent = ''; input.setAttribute('aria-invalid', 'false'); return; }
    const r = (opts.allowZero ? parseOffset : parseLength)(input.value, u, sq);
    valid = r.ok;
    cm = r.ok ? r.cm : null;
    err.textContent = r.ok || !input.value.trim() && initialCm == null && !touched ? '' : (r as { error: string }).error;
    input.setAttribute('aria-invalid', String(!r.ok && touched));
    hint.textContent = r.ok && !opts.plain ? (u === 'cm' ? formatBoth(r.cm, sq) : formatCm(r.cm) + ' · ' + formatBoth(r.cm, sq).split(' · ')[1]) : '';
  };
  let touched = initialCm != null;
  input.addEventListener('input', () => { touched = true; parse(); onInput(); });
  const el = h('div', { class: 'field' }, h('label', null, label, ' ', unitEl), input, hint, err);
  const showUnit = () => { unitEl.textContent = u === 'cm' ? '(cm)' : `(squares of ${formatCm(sq)})`; };
  showUnit(); parse();
  return {
    el,
    value: () => { touched = true; parse(); return cm; },
    ok: () => { touched = true; parse(); return valid; },
    set: (v: number) => { input.value = fmt(v); touched = true; parse(); },
    setUnit: (nu, nsq) => { const keep = cm; u = nu; sq = nsq; showUnit(); if (keep != null) input.value = fmt(keep); parse(); },
    refresh: parse,
  };
}

// 13.5 -> "13½"
export function sqText(s: number): string {
  const halves = Math.round(s * 2);
  if (Math.abs(s * 2 - halves) > 1e-6) return String(Math.round(s * 100) / 100);
  const w = Math.floor(halves / 2);
  return halves % 2 ? (w ? w + '½' : '½') : String(w);
}

// "cm | squares" switch
export function unitSwitch(unit: Unit, onChange: (u: Unit) => void): HTMLElement {
  const cmB = h('button', { type: 'button', 'aria-pressed': String(unit === 'cm') }, 'cm');
  const sqB = h('button', { type: 'button', 'aria-pressed': String(unit === 'sq') }, 'squares');
  const pick = (u: Unit) => { cmB.setAttribute('aria-pressed', String(u === 'cm')); sqB.setAttribute('aria-pressed', String(u === 'sq')); onChange(u); };
  cmB.onclick = () => pick('cm'); sqB.onclick = () => pick('sq');
  return h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Measure in'), h('div', { class: 'seg' }, cmB, sqB));
}

// "2 days ago"
export function relTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  const units: [number, string][] = [[60, 'minute'], [3600, 'hour'], [86400, 'day'], [604800, 'week'], [2592000, 'month'], [31536000, 'year']];
  let best = units[0];
  for (const u of units) if (s >= u[0]) best = u;
  const n = Math.floor(s / best[0]);
  return `${n} ${best[1]}${n === 1 ? '' : 's'} ago`;
}
