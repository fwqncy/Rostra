// Rostra — single-page client. No build step: served as-is by ASP.NET Core.

/* --------------------------------------------------------------------------
   Templating: every interpolation is escaped unless wrapped in raw().
   -------------------------------------------------------------------------- */
export class Raw { constructor(v) { this.v = v; } toString() { return this.v; } }
export const raw = (v) => new Raw(v);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const val = (v) => v instanceof Raw ? v.v : Array.isArray(v) ? v.map(val).join('') : v == null || v === false ? '' : esc(v);
export const html = (strings, ...values) => raw(strings.reduce((out, s, i) => out + s + (i < values.length ? val(values[i]) : ''), ''));
export const icon = (name, cls = 'icon') => raw(`<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`);
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const root = document.documentElement;
export const app = $('#root');
export const dialog = $('#dialog');
export const finePointer = matchMedia('(pointer: fine)');
export const narrow = matchMedia('(max-width: 860px)');
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const NBSP = ' ';

/* --------------------------------------------------------------------------
   Locale-aware formatting (language settings, never location)
   -------------------------------------------------------------------------- */
export const locales = navigator.languages?.length ? [...navigator.languages] : [navigator.language || 'en-AU'];
export const uses12h = (() => {
  const hc = new Intl.DateTimeFormat(locales, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return hc ? hc.startsWith('h1') : true;
})();
export const fmt = {
  time: new Intl.DateTimeFormat(locales, { hour: 'numeric', minute: '2-digit' }),
  dow: new Intl.DateTimeFormat(locales, { weekday: 'short' }),
  dayNum: new Intl.DateTimeFormat(locales, { day: 'numeric' }),
  dayLong: new Intl.DateTimeFormat(locales, { weekday: 'long', day: 'numeric', month: 'long' }),
  dayShort: new Intl.DateTimeFormat(locales, { weekday: 'short', day: 'numeric', month: 'short' }),
  range: new Intl.DateTimeFormat(locales, { day: 'numeric', month: 'short', year: 'numeric' }),
  hours: new Intl.NumberFormat(locales, { maximumFractionDigits: 1 }),
  pct: new Intl.NumberFormat(locales, { style: 'percent', maximumFractionDigits: 0 }),
  int: new Intl.NumberFormat(locales),
};
export const moneyFormats = new Map();
// One rule for currency everywhere: whole dollars.
export function money(n) {
  const currency = state.me?.company.currency || 'AUD';
  if (!moneyFormats.has(currency))
    moneyFormats.set(currency, new Intl.NumberFormat(locales, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }));
  return moneyFormats.get(currency).format(Math.round(n));
}
export const hrs = (n) => `${fmt.hours.format(n)}${NBSP}h`;
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isoLocal = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
export const parse = (s) => new Date(s); // "2026-10-07T09:00:00" (no offset) parses as venue-local time
export const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7));
export const sameDay = (a, b) => ymd(a) === ymd(b);
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
export function hourShort(d) {
  const h = d.getHours(), m = d.getMinutes();
  const hh = uses12h ? (h % 12 || 12) : h;
  return m ? `${hh}:${pad(m)}` : `${hh}`;
}
/** "9–5" — how a roster reads on the back-of-house wall. */
export const compact = (start, end) => `${hourShort(parse(start))}–${hourShort(parse(end))}`;
export const fullRange = (start, end) => fmt.time.formatRange(parse(start), parse(end));
export const initials = (name) => name.split(/\s+/).filter((w) => /\p{L}/u.test(w[0] || '')).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
export function dayLabel(d) {
  const today = new Date();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, addDays(today, 1))) return 'Tomorrow';
  return fmt.dayLong.format(d);
}

/* --------------------------------------------------------------------------
   Labour cost
   -------------------------------------------------------------------------- */
export const paidHours = (s) => Math.max(0, (parse(s.end) - parse(s.start)) / 36e5 - s.breakMinutes / 60);
export function penaltyFor(s, pen) {
  const day = parse(s.start).getDay();
  return day === 6 ? pen.saturday : day === 0 ? pen.sunday : 1;
}
export const shiftCost = (s, rate, pen) => paidHours(s) * (rate ?? 0) * penaltyFor(s, pen);
export function swapDelta(swap, pen) {
  if (swap.cover.hourlyRate == null || !swap.from) return null; // open-shift pick-ups have no "before" cost
  return paidHours(swap) * (swap.cover.hourlyRate - swap.from.hourlyRate) * penaltyFor(swap, pen);
}
export function deltaPill(delta) {
  if (delta == null) return '';
  if (Math.abs(delta) < 0.5) return html`<span class="status">No cost change</span>`;
  return delta < 0
    ? html`<span class="status is-save num">Saves ${money(-delta)}</span>`
    : html`<span class="status is-cost num">Adds ${money(delta)}</span>`;
}

/* --------------------------------------------------------------------------
   Colour maths: derive accessible accent variants from any colour
   -------------------------------------------------------------------------- */
export const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const rgbToHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
export function luminance([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export const mixRgb = (c, t, amt) => c.map((v, i) => Math.round(v + (t[i] - v) * amt));
export function nudge(c, toward, against, min) {
  for (let i = 0; i <= 40; i++) { const m = mixRgb(c, toward, i * 0.025); if (contrast(m, against) >= min) return m; }
  return toward;
}
/** OKLCH hue (0–360) of a hex colour; surfaces in the Custom scheme are tinted toward it. */
export function hueOf(hex) {
  const lin = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const l = Math.cbrt(0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2]);
  const m = Math.cbrt(0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2]);
  const s = Math.cbrt(0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2]);
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
}
/** A picked colour, plus a darker fill for white text and a text-safe ink for the current mode (both ≥ 4.6:1). */
export function accentVars(hex, mode = 'dark') {
  const base = hexToRgb(hex);
  return {
    '--accent': hex,
    '--accent-solid': rgbToHex(nudge(base, [0, 0, 0], [255, 255, 255], 4.6)),
    '--accent-bright': mode === 'dark'
      ? rgbToHex(nudge(base, [255, 255, 255], [24, 24, 28], 4.6))
      : rgbToHex(nudge(base, [0, 0, 0], [250, 248, 242], 4.6)),
  };
}

/* --------------------------------------------------------------------------
   Appearance: colour scheme × light/dark × motion, synced to the account
   -------------------------------------------------------------------------- */
export const SCHEMES = [
  { id: 'overgrowth', name: 'Overgrowth', blurb: 'Forest green, bark brown and burnt orange. The default.', swatches: ['#10130d', '#283020', '#7a5638', '#e07b2e', '#8aa65a'] },
  { id: 'burgundy-navy', name: 'Burgundy & Navy', blurb: 'Deep navy with burgundy and brass.', swatches: ['#0b1020', '#202b4d', '#b4324f', '#d9b38c', '#7f9bd6'] },
  { id: 'brand', name: 'Company Brand', blurb: 'Your company’s own colour on quiet greys.', swatches: [] },
  { id: 'custom', name: 'Custom', blurb: 'Any colour you like, from the colour wheel.', swatches: [] },
];
const APPEARANCE_KEY = 'rostra.appearance';
export const DEFAULT_APPEARANCE = Object.freeze({ scheme: 'overgrowth', custom: null, mode: 'dark', motion: 'auto' });
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');

function loadLocalAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || 'null');
    const legacyMode = localStorage.getItem('rostra.theme'); // v1/v2 stored only the mode
    return { ...DEFAULT_APPEARANCE, ...(legacyMode ? { mode: legacyMode } : {}), ...(saved || {}) };
  } catch { return { ...DEFAULT_APPEARANCE }; }
}
export let appearance = loadLocalAppearance();
export const resolvedMode = (a = appearance) => (a.mode === 'system' ? (darkQuery.matches ? 'dark' : 'light') : a.mode);
export const reducedMotion = () => appearance.motion === 'reduced' || (appearance.motion !== 'full' && motionQuery.matches);

/** Applies a full appearance to <html>. Other parts of the app listen for `appearancechange` (e.g. the 3D scenes). */
export function applyAppearance(next = appearance, { brand = state.me?.company.accent, persist = true } = {}) {
  appearance = { ...DEFAULT_APPEARANCE, ...next };
  const mode = resolvedMode();
  root.dataset.scheme = appearance.scheme;
  root.dataset.mode = mode;
  root.dataset.motion = reducedMotion() ? 'reduced' : 'full';
  ['--accent', '--accent-solid', '--accent-bright', '--tint-h'].forEach((k) => root.style.removeProperty(k));
  const vars = {};
  if (appearance.scheme === 'brand' && brand) Object.assign(vars, accentVars(brand, mode));
  if (appearance.scheme === 'custom' && /^#[0-9a-f]{6}$/i.test(appearance.custom || '')) {
    Object.assign(vars, accentVars(appearance.custom, mode));
    vars['--tint-h'] = String(Math.round(hueOf(appearance.custom)));
  }
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  if (persist) try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ ...appearance, vars })); localStorage.removeItem('rostra.theme'); } catch { /* private mode */ }
  $$('.theme-select').forEach((s) => { s.value = appearance.mode; });
  requestAnimationFrame(() => {
    $('meta[name="theme-color"]').content = getComputedStyle(document.body).backgroundColor;
    document.dispatchEvent(new CustomEvent('appearancechange', { detail: { ...appearance, mode } }));
  });
}
darkQuery.addEventListener('change', () => applyAppearance());
motionQuery.addEventListener('change', () => applyAppearance());

/** The scheme a user sees: their own choice, else their company's default, else Overgrowth. */
export function appearanceFor(me) {
  const local = loadLocalAppearance();
  const mine = me?.appearance || {};
  const company = me?.company?.appearance || {};
  return {
    scheme: mine.scheme || company.scheme || DEFAULT_APPEARANCE.scheme,
    custom: mine.scheme ? mine.custom : company.custom,
    mode: mine.mode || local.mode || DEFAULT_APPEARANCE.mode,
    motion: mine.motion || local.motion || DEFAULT_APPEARANCE.motion,
  };
}

let saveTimer;
/** Applies a change now and saves it to the account shortly after (so dragging a slider doesn't spam the server). */
export function updateAppearance(patch, { save = true } = {}) {
  applyAppearance({ ...appearance, ...patch });
  if (!save || !state.me) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { state.me.appearance = await api('/me/appearance', { method: 'PUT', body: appearance }); }
    catch (e) { toast(e.message, { tone: 'error' }); }
  }, 400);
}

// Back-compat names used around the app.
export const applyTheme = () => applyAppearance();
export const setTheme = (mode) => updateAppearance({ mode });
export const themePicker = (id) => html`
  <label class="theme-picker" for="${id}">
    <span class="sr-only">Light or dark mode</span>${icon('theme')}
    <select class="select theme-select" id="${id}" name="mode">
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>`;
document.addEventListener('change', (e) => {
  if (e.target.matches('.theme-select')) setTheme(e.target.value);
});

/* --------------------------------------------------------------------------
   API
   -------------------------------------------------------------------------- */
export class ApiError extends Error {
  constructor(message, status, errors) { super(message); this.status = status; this.errors = errors; }
}
export const uuid = () => crypto.randomUUID?.() ?? [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
export function messageFrom(data, status) {
  if (typeof data === 'string' && data) return /[.!?]$/.test(data) ? data : `${data}.`;
  if (data?.error) return data.error;
  if (data?.errors) return Object.values(data.errors).flat()[0];
  if (status === 429) return 'Too many attempts. Wait a minute, then try again.';
  if (status === 403) return 'Your account can’t do that. Ask a manager if you think it should.';
  if (status === 404) return 'That shift no longer exists. The roster has been refreshed.';
  if (status === 0) return 'You’re offline. Check your connection and try again.';
  return 'Something went wrong on our side. Try again in a moment.';
}
export async function api(path, { method = 'GET', body, quiet401 = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method === 'POST') headers['Idempotency-Key'] = uuid();
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError(messageFrom(null, 0), 0);
  }
  if (res.status === 401 && !quiet401 && !path.startsWith('/auth')) {
    hooks.onUnauthorized();
    throw new ApiError('Your session ended. Sign in again to continue.', 401);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ApiError(messageFrom(data, res.status), res.status, data?.errors);
  return data;
}

/* --------------------------------------------------------------------------
   State
   -------------------------------------------------------------------------- */
export const state = {
  me: null,
  view: '',
  schedule: null,
  swaps: [],
  myShifts: null,
  penalties: { saturday: 1.25, sunday: 1.5 },
  names: new Map(),       // staff names seen anywhere, for cross-site covers
  lastScheduleQuery: '',
  events: null,
  render: null,           // re-renders the current view from state
};
export const isManager = () => state.me?.role === 'Manager';
export const recentlyMine = new Map();
export const markMine = (shiftId) => recentlyMine.set(shiftId, Date.now());
export const wasMine = (shiftId) => Date.now() - (recentlyMine.get(shiftId) || 0) < 5000;

/* --------------------------------------------------------------------------
   Toasts (polite live region) & loading helpers
   -------------------------------------------------------------------------- */
export function toast(message, { action, onAction, tone, timeout = 5200 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${tone === 'error' ? ' is-error' : ''}`;
  el.innerHTML = html`${tone === 'error' ? icon('alert') : icon('check')}<p>${message}</p>${action ? html`<button type="button" class="btn">${action}</button>` : ''}`.v;
  const dismiss = () => el.remove();
  if (action) $('button', el).addEventListener('click', () => { dismiss(); onAction?.(); });
  $('#toasts').append(el);
  let timer = setTimeout(dismiss, timeout);
  // Hovering or focusing the action (e.g. Undo) holds the toast open.
  const action$ = $('button', el);
  action$?.addEventListener('pointerenter', () => clearTimeout(timer));
  action$?.addEventListener('pointerleave', () => { timer = setTimeout(dismiss, 2000); });
  el.addEventListener('focusin', () => clearTimeout(timer));
}

/** Spinner + original label; disabled only once the submission actually starts. */
export async function withLoading(button, task) {
  if (!button || button.disabled) return task();
  const label = button.innerHTML;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  const show = setTimeout(() => { button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${label}`; }, 120);
  const started = performance.now();
  try { return await task(); }
  finally {
    clearTimeout(show);
    const elapsed = performance.now() - started;
    if (elapsed > 120 && elapsed < 420) await sleep(420 - elapsed); // no spinner flicker
    if (button.isConnected) { button.innerHTML = label; button.disabled = false; button.removeAttribute('aria-busy'); }
  }
}

/** Show a skeleton only if loading takes >150 ms, and then for at least 400 ms. */
export async function withSkeleton(container, skeleton, load) {
  let shownAt = 0;
  const timer = setTimeout(() => { container.innerHTML = skeleton.v; shownAt = performance.now(); }, 150);
  try { return await load(); }
  finally {
    clearTimeout(timer);
    if (shownAt) { const left = 400 - (performance.now() - shownAt); if (left > 0) await sleep(left); }
  }
}

export function showErrors(form, errors) {
  let first = null;
  for (const [name, message] of Object.entries(errors)) {
    const input = form.querySelector(`[data-field="${name}"]`);
    const slot = form.querySelector(`[data-error-for="${name}"]`);
    if (!slot) continue;
    slot.innerHTML = html`${icon('alert')}<span>${message}</span>`.v;
    slot.hidden = false;
    if (input) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', slot.id); first ??= input; }
  }
  const general = errors._ && form.querySelector('[data-error-for="_"]');
  if (general) general.hidden = false;
  (first || general)?.focus?.();
}
export function clearErrors(form) {
  $$('[data-error-for]', form).forEach((s) => { s.hidden = true; s.textContent = ''; });
  $$('[aria-invalid]', form).forEach((i) => { i.removeAttribute('aria-invalid'); i.removeAttribute('aria-describedby'); });
}
export const errorSlot = (name, id) => html`<p class="field-error" id="${id}" data-error-for="${name}" hidden></p>`;
export const fromServer = (errors) => Object.fromEntries(Object.entries(errors || {}).map(([k, v]) => [k, v[0]]));

/* --------------------------------------------------------------------------
   Dialog: native <dialog> for focus trapping, Escape, and return focus
   -------------------------------------------------------------------------- */
export let dialogDirty = false;
export let dialogReturn = null;
export function openDialog(markup, { onOpen, returnTo } = {}) {
  dialogReturn = returnTo ?? null;
  dialog.innerHTML = markup.v;
  dialogDirty = false;
  if (!dialog.open) dialog.showModal();
  const auto = finePointer.matches && $('[data-autofocus]', dialog);
  (auto || $('h2', dialog))?.focus?.({ preventScroll: true });
  onOpen?.(dialog);
}
export function closeDialog({ force = false } = {}) {
  if (!force && dialogDirty && !confirm('Discard your changes to this shift?')) return false;
  dialogDirty = false;
  dialog.close();
  return true;
}
dialog.addEventListener('close', () => {
  dialog.innerHTML = '';
  const target = dialogReturn && (typeof dialogReturn === 'string' ? $(dialogReturn) : dialogReturn);
  if (target?.isConnected) target.focus({ preventScroll: true }); else $('#main')?.focus({ preventScroll: true });
  dialogReturn = null;
});
dialog.addEventListener('cancel', (e) => { if (dialogDirty && !confirm('Discard your changes to this shift?')) e.preventDefault(); });
dialog.addEventListener('click', (e) => {
  if (e.target === dialog || e.target.closest('[data-close]')) closeDialog();
});
dialog.addEventListener('input', (e) => { if (e.target.closest('form[data-track-changes]')) dialogDirty = true; });
addEventListener('beforeunload', (e) => { if (dialog.open && dialogDirty) { e.preventDefault(); e.returnValue = ''; } });
export const dialogHead = (title, sub) => html`
  <div class="dialog-head">
    <div><h2 id="dialog-title" tabindex="-1">${title}</h2>${sub ? html`<p>${sub}</p>` : ''}</div>
    <button type="button" class="btn btn-ghost icon-btn" data-close aria-label="Close">${icon('x')}</button>
  </div>`;


/** Set by the app shell; lets the API layer react to an expired session without importing the router. */
export const hooks = { onUnauthorized() {} };

/** One registry for every `data-action` button, filled in by each feature module. */
export const actions = {};


/* --------------------------------------------------------------------------
   Page lifecycle: pages with live resources (3D scenes, timers) clean up here
   -------------------------------------------------------------------------- */
const pageCleanups = [];
export function onLeavePage(fn) { pageCleanups.push(fn); }
export function leavePage() {
  while (pageCleanups.length) {
    try { pageCleanups.pop()(); } catch { /* keep going */ }
  }
}

/* Shared formatting helpers used by several pages. */
export const rtf = new Intl.RelativeTimeFormat(locales, { numeric: 'auto' });
export const plural = (n, one, many) => `${fmt.int.format(n)} ${n === 1 ? one : many}`;
export const dateSpan = (from, to) => from === to
  ? fmt.dayShort.format(parseDay(from))
  : fmt.range.formatRange(parseDay(from), parseDay(to));
export function timeAgo(date, now = new Date()) {
  const mins = Math.round((now - date) / 60000);
  if (Math.abs(mins) < 60) return rtf.format(-mins, 'minute');
  if (Math.abs(mins) < 60 * 24) return rtf.format(-Math.round(mins / 60), 'hour');
  return rtf.format(-Math.round(mins / 1440), 'day');
}
export function downloadText(filename, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const STATION_NAMES = ['Floor', 'Kitchen', 'Bar', 'Barista'];
