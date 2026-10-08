// Rostra — single-page client. No build step: served as-is by ASP.NET Core.

/* --------------------------------------------------------------------------
   Templating: every interpolation is escaped unless wrapped in raw().
   -------------------------------------------------------------------------- */
class Raw { constructor(v) { this.v = v; } toString() { return this.v; } }
const raw = (v) => new Raw(v);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = (v) => v instanceof Raw ? v.v : Array.isArray(v) ? v.map(val).join('') : v == null || v === false ? '' : esc(v);
const html = (strings, ...values) => raw(strings.reduce((out, s, i) => out + s + (i < values.length ? val(values[i]) : ''), ''));
const icon = (name, cls = 'icon') => raw(`<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`);
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = document.documentElement;
const app = $('#root');
const dialog = $('#dialog');
const finePointer = matchMedia('(pointer: fine)');
const narrow = matchMedia('(max-width: 860px)');
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const NBSP = ' ';

/* --------------------------------------------------------------------------
   Locale-aware formatting (language settings, never location)
   -------------------------------------------------------------------------- */
const locales = navigator.languages?.length ? [...navigator.languages] : [navigator.language || 'en-AU'];
const uses12h = (() => {
  const hc = new Intl.DateTimeFormat(locales, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return hc ? hc.startsWith('h1') : true;
})();
const fmt = {
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
const moneyFormats = new Map();
// One rule for currency everywhere: whole dollars.
function money(n) {
  const currency = state.me?.company.currency || 'AUD';
  if (!moneyFormats.has(currency))
    moneyFormats.set(currency, new Intl.NumberFormat(locales, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }));
  return moneyFormats.get(currency).format(Math.round(n));
}
const hrs = (n) => `${fmt.hours.format(n)}${NBSP}h`;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoLocal = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const parse = (s) => new Date(s); // "2026-10-07T09:00:00" (no offset) parses as venue-local time
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7));
const sameDay = (a, b) => ymd(a) === ymd(b);
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
function hourShort(d) {
  const h = d.getHours(), m = d.getMinutes();
  const hh = uses12h ? (h % 12 || 12) : h;
  return m ? `${hh}:${pad(m)}` : `${hh}`;
}
/** "9–5" — how a roster reads on the back-of-house wall. */
const compact = (start, end) => `${hourShort(parse(start))}–${hourShort(parse(end))}`;
const fullRange = (start, end) => fmt.time.formatRange(parse(start), parse(end));
const initials = (name) => name.split(/\s+/).filter((w) => /\p{L}/u.test(w[0] || '')).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
function dayLabel(d) {
  const today = new Date();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, addDays(today, 1))) return 'Tomorrow';
  return fmt.dayLong.format(d);
}

/* --------------------------------------------------------------------------
   Labour cost
   -------------------------------------------------------------------------- */
const paidHours = (s) => Math.max(0, (parse(s.end) - parse(s.start)) / 36e5 - s.breakMinutes / 60);
function penaltyFor(s, pen) {
  const day = parse(s.start).getDay();
  return day === 6 ? pen.saturday : day === 0 ? pen.sunday : 1;
}
const shiftCost = (s, rate, pen) => paidHours(s) * (rate ?? 0) * penaltyFor(s, pen);
function swapDelta(swap, pen) {
  if (swap.cover.hourlyRate == null) return null;
  return paidHours(swap) * (swap.cover.hourlyRate - swap.from.hourlyRate) * penaltyFor(swap, pen);
}
function deltaPill(delta) {
  if (delta == null) return '';
  if (Math.abs(delta) < 0.5) return html`<span class="status">No cost change</span>`;
  return delta < 0
    ? html`<span class="status is-save num">Saves ${money(-delta)}</span>`
    : html`<span class="status is-cost num">Adds ${money(delta)}</span>`;
}

/* --------------------------------------------------------------------------
   Company accent: derive accessible variants from the brand colour
   -------------------------------------------------------------------------- */
const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbToHex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
function luminance([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mixRgb = (c, t, amt) => c.map((v, i) => Math.round(v + (t[i] - v) * amt));
function nudge(c, toward, against, min) {
  for (let i = 0; i <= 20; i++) { const m = mixRgb(c, toward, i * 0.05); if (contrast(m, against) >= min) return m; }
  return toward;
}
function accentVars(hex) {
  const base = hexToRgb(hex);
  return {
    '--accent': hex,
    '--accent-solid': rgbToHex(nudge(base, [0, 0, 0], [255, 255, 255], 4.6)),   // fills behind white text
    '--accent-bright': rgbToHex(nudge(base, [255, 255, 255], [19, 19, 23], 4.6)), // accent text on dark
  };
}
const ACCENT_KEY = 'rostra.accent';
function applyAccent(hex, { persist = true } = {}) {
  const vars = accentVars(hex);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  if (persist) try { localStorage.setItem(ACCENT_KEY, JSON.stringify(vars)); } catch { /* private mode */ }
}
function resetAccent({ forget = true } = {}) {
  ['--accent', '--accent-solid', '--accent-bright'].forEach((k) => root.style.removeProperty(k));
  if (forget) try { localStorage.removeItem(ACCENT_KEY); } catch { /* ignore */ }
}

/* --------------------------------------------------------------------------
   Theme: System / Light / Dark, remembered per device
   -------------------------------------------------------------------------- */
const THEME_KEY = 'rostra.theme';
let themeMemory = 'system';
function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return themeMemory; }
}
function setTheme(value) {
  themeMemory = value;
  try { value === 'system' ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, value); } catch { /* ignore */ }
  applyTheme();
}
function applyTheme() {
  const t = getTheme();
  if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  $$('.theme-select').forEach((s) => { s.value = t; });
  requestAnimationFrame(() => {
    $('meta[name="theme-color"]').content = getComputedStyle(document.body).backgroundColor;
  });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
const themePicker = (id) => html`
  <label class="theme-picker" for="${id}">
    <span class="sr-only">Theme</span>${icon('theme')}
    <select class="select theme-select" id="${id}" name="theme">
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
class ApiError extends Error {
  constructor(message, status, errors) { super(message); this.status = status; this.errors = errors; }
}
const uuid = () => crypto.randomUUID?.() ?? [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
function messageFrom(data, status) {
  if (typeof data === 'string' && data) return /[.!?]$/.test(data) ? data : `${data}.`;
  if (data?.error) return data.error;
  if (data?.errors) return Object.values(data.errors).flat()[0];
  if (status === 429) return 'Too many attempts. Wait a minute, then try again.';
  if (status === 403) return 'Your account can’t do that. Ask a manager if you think it should.';
  if (status === 404) return 'That shift no longer exists. The roster has been refreshed.';
  if (status === 0) return 'You’re offline. Check your connection and try again.';
  return 'Something went wrong on our side. Try again in a moment.';
}
async function api(path, { method = 'GET', body, quiet401 = false } = {}) {
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
    signedOut();
    navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
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
const state = {
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
const isManager = () => state.me?.role === 'Manager';
const recentlyMine = new Map();
const markMine = (shiftId) => recentlyMine.set(shiftId, Date.now());
const wasMine = (shiftId) => Date.now() - (recentlyMine.get(shiftId) || 0) < 5000;

/* --------------------------------------------------------------------------
   Toasts (polite live region) & loading helpers
   -------------------------------------------------------------------------- */
function toast(message, { action, onAction, tone, timeout = 5200 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${tone === 'error' ? ' is-error' : ''}`;
  el.innerHTML = html`${tone === 'error' ? icon('alert') : icon('check')}<p>${message}</p>${action ? html`<button type="button" class="btn">${action}</button>` : ''}`.v;
  const dismiss = () => el.remove();
  if (action) $('button', el).addEventListener('click', () => { dismiss(); onAction?.(); });
  $('#toasts').append(el);
  let timer = setTimeout(dismiss, timeout);
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => { timer = setTimeout(dismiss, 2000); });
  el.addEventListener('focusin', () => clearTimeout(timer));
}

/** Spinner + original label; disabled only once the submission actually starts. */
async function withLoading(button, task) {
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
async function withSkeleton(container, skeleton, load) {
  let shownAt = 0;
  const timer = setTimeout(() => { container.innerHTML = skeleton.v; shownAt = performance.now(); }, 150);
  try { return await load(); }
  finally {
    clearTimeout(timer);
    if (shownAt) { const left = 400 - (performance.now() - shownAt); if (left > 0) await sleep(left); }
  }
}

function showErrors(form, errors) {
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
function clearErrors(form) {
  $$('[data-error-for]', form).forEach((s) => { s.hidden = true; s.textContent = ''; });
  $$('[aria-invalid]', form).forEach((i) => { i.removeAttribute('aria-invalid'); i.removeAttribute('aria-describedby'); });
}
const errorSlot = (name, id) => html`<p class="field-error" id="${id}" data-error-for="${name}" hidden></p>`;
const fromServer = (errors) => Object.fromEntries(Object.entries(errors || {}).map(([k, v]) => [k, v[0]]));

/* --------------------------------------------------------------------------
   Dialog: native <dialog> for focus trapping, Escape, and return focus
   -------------------------------------------------------------------------- */
let dialogDirty = false;
let dialogReturn = null;
function openDialog(markup, { onOpen, returnTo } = {}) {
  dialogReturn = returnTo ?? null;
  dialog.innerHTML = markup.v;
  dialogDirty = false;
  if (!dialog.open) dialog.showModal();
  const auto = finePointer.matches && $('[data-autofocus]', dialog);
  (auto || $('h2', dialog))?.focus?.({ preventScroll: true });
  onOpen?.(dialog);
}
function closeDialog({ force = false } = {}) {
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
const dialogHead = (title, sub) => html`
  <div class="dialog-head">
    <div><h2 id="dialog-title" tabindex="-1">${title}</h2>${sub ? html`<p>${sub}</p>` : ''}</div>
    <button type="button" class="btn btn-ghost icon-btn" data-close aria-label="Close">${icon('x')}</button>
  </div>`;

/* --------------------------------------------------------------------------
   Router: real URLs so share, refresh, and Back/Forward all work
   -------------------------------------------------------------------------- */
history.scrollRestoration = 'manual';
const ROUTES = {
  '/app/schedule': () => viewSchedule(),
  '/app/swaps': () => viewSwaps(),
  '/app/my-shifts': () => viewMyShifts(),
};
function navigate(url, { replace = false } = {}) {
  if (!replace) history.replaceState({ ...(history.state || {}), y: scrollY }, '');
  history[replace ? 'replaceState' : 'pushState']({ y: 0 }, '', url);
  route();
}
const defaultPath = () => (isManager() || !narrow.matches ? '/app/schedule' : '/app/my-shifts');
async function route() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  try {
    if (path === '/login') {
      if (await ensureMe({ redirect: false })) return navigate(nextPath() || defaultPath(), { replace: true });
      return viewLogin();
    }
    if (!(await ensureMe({ redirect: true }))) return;
    if (!ROUTES[path]) return navigate(defaultPath(), { replace: true });
    ensureShell();
    updateNav(path);
    await ROUTES[path]();
    scrollTo(0, history.state?.y ?? 0);
  } catch (e) {
    if (e.status === 401) return;
    app.innerHTML = html`<main class="main" id="main" tabindex="-1"><div class="content">${errorState(e.message)}</div></main>`.v;
  } finally {
    app.removeAttribute('aria-busy');
  }
}
addEventListener('popstate', route);
const nextPath = () => {
  const next = new URLSearchParams(location.search).get('next');
  return next && next.startsWith('/app/') ? next : null;
};

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || !(url.pathname.startsWith('/app/') || url.pathname === '/login')) return;
  e.preventDefault();
  if (url.pathname + url.search !== location.pathname + location.search) navigate(url.pathname + url.search);
});

async function ensureMe({ redirect }) {
  if (state.me) return true;
  state.me = await api('/me', { quiet401: true });
  if (!state.me) {
    if (redirect) navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    return false;
  }
  applyAccent(state.me.company.accent);
  state.names.set(state.me.id, state.me.name);
  connectEvents();
  loadSwaps().then(updateBadges).catch(() => {});
  return true;
}
function signedOut() {
  state.me = null; state.schedule = null; state.swaps = []; state.myShifts = null; state.lastScheduleQuery = '';
  state.events?.close(); state.events = null;
  if (dialog.open) closeDialog({ force: true });
  resetAccent();
}

/* --------------------------------------------------------------------------
   App shell
   -------------------------------------------------------------------------- */
function navLinks() {
  const count = state.swaps.length;
  const badge = count ? html`<span class="badge" data-badge><span class="sr-only">, </span>${count}<span class="sr-only"> pending</span></span>` : '';
  return html`
    <a href="/app/schedule${state.lastScheduleQuery}" data-nav="/app/schedule">${icon('calendar')}<span>Schedule</span></a>
    <a href="/app/swaps" data-nav="/app/swaps">${icon('swap')}<span>Swaps</span>${badge}</a>
    <a href="/app/my-shifts" data-nav="/app/my-shifts">${icon('clock')}<span>My Shifts</span></a>`;
}
function ensureShell() {
  if ($('#content') && app.dataset.company === String(state.me.company.id)) return;
  const { me } = state;
  const c = me.company;
  app.dataset.company = c.id;
  app.innerHTML = html`
    <div class="app">
      <aside class="sidebar" aria-label="Sidebar">
        <a class="brand" href="/app/schedule" data-logo title="Right-click for brand assets">
          <span class="brand-mark" aria-hidden="true">${initials(c.name)}</span>
          <span class="brand-text">
            <span class="brand-company" translate="no">${c.name}</span>
            <span class="brand-product">Rostering by <span translate="no">rostra</span></span>
          </span>
        </a>
        <nav class="nav" aria-label="Primary">${navLinks()}</nav>
        <div class="sidebar-foot">
          <div class="me">
            <span class="avatar is-me" aria-hidden="true">${initials(me.name)}</span>
            <span class="me-text"><span class="me-name">${me.name}</span><span class="me-role">${me.title} · ${me.role}</span></span>
          </div>
          <div class="sidebar-row">
            ${themePicker('theme-desktop')}
            <button type="button" class="btn btn-ghost btn-sm" data-action="logout">${icon('logout')}Sign Out</button>
          </div>
        </div>
      </aside>
      <header class="mobile-bar">
        <span class="brand-mark" aria-hidden="true" data-logo>${initials(c.name)}</span>
        <span class="brand-company" translate="no">${c.name}</span>
        ${themePicker('theme-mobile')}
        <button type="button" class="btn btn-ghost icon-btn" data-action="logout" aria-label="Sign out">${icon('logout')}</button>
      </header>
      <main class="main" id="main" tabindex="-1"><div class="content" id="content"></div></main>
      <nav class="tabbar" aria-label="Primary, mobile">${navLinks()}</nav>
    </div>`.v;
  applyTheme();
}
function updateNav(path) {
  $$('[data-nav]').forEach((a) => {
    if (a.dataset.nav === path) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    if (a.dataset.nav === '/app/schedule') a.setAttribute('href', `/app/schedule${state.lastScheduleQuery}`);
  });
}
function updateBadges() {
  const count = state.swaps.length;
  $$('[data-nav="/app/swaps"]').forEach((a) => {
    $('[data-badge]', a)?.remove();
    if (count) a.insertAdjacentHTML('beforeend', html`<span class="badge" data-badge><span class="sr-only">, </span>${count}<span class="sr-only"> pending</span></span>`.v);
  });
}
const errorState = (message, retry = true) => html`
  <div class="error-banner" role="alert">
    ${icon('alert')}<p>${message}</p>
    ${retry ? html`<button type="button" class="btn btn-sm" data-action="retry">Try Again</button>` : ''}
  </div>`;

/* --------------------------------------------------------------------------
   Data loading
   -------------------------------------------------------------------------- */
async function loadSwaps() {
  const data = await api('/swaps');
  state.swaps = data.swaps;
  state.penalties = data.penalties;
  for (const s of data.swaps) { state.names.set(s.from.id, s.from.name); state.names.set(s.cover.id, s.cover.name); }
  return data.swaps;
}
async function refreshQuietly() {
  try {
    await loadSwaps();
    if (state.view === 'schedule' && state.schedule) {
      state.schedule = await api(`/schedule?siteId=${state.schedule.site.id}&week=${state.schedule.weekStart}`);
      rememberNames(state.schedule.staff);
    } else if (state.view === 'my-shifts') {
      state.myShifts = await api('/my-shifts');
    }
    updateBadges();
    state.render?.();
  } catch { /* the next event or navigation retries */ }
}
const rememberNames = (people) => people.forEach((p) => state.names.set(p.id, p.name));
const nameOf = (id) => state.names.get(id) ?? 'a teammate';

/* --------------------------------------------------------------------------
   Live updates over Server-Sent Events
   -------------------------------------------------------------------------- */
function connectEvents() {
  if (state.events || !window.EventSource) return;
  const es = new EventSource('/events');
  state.events = es;
  let timer;
  const refresh = () => { clearTimeout(timer); timer = setTimeout(refreshQuietly, 250); };
  es.addEventListener('schedule.changed', refresh);
  es.addEventListener('swap.requested', (e) => {
    const d = JSON.parse(e.data);
    refresh();
    if (wasMine(d.shiftId) || !isManager()) return;
    toast(`${d.from} asked ${d.cover} to cover ${fmt.dow.format(parse(d.start))} ${compact(d.start, d.end)}.`, {
      action: 'Review', onAction: () => navigate('/app/swaps'),
    });
  });
  es.addEventListener('swap.resolved', (e) => {
    const d = JSON.parse(e.data);
    refresh();
    if (wasMine(d.shiftId) || isManager() || d.cancelled || d.from !== state.me?.name) return;
    toast(d.approved ? `Your swap was approved. ${d.cover} is covering your shift.` : 'Your manager declined your swap request. You’re still on this shift.');
  });
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) state.events = null; };
}

/* --------------------------------------------------------------------------
   Sign in
   -------------------------------------------------------------------------- */
async function viewLogin() {
  state.view = 'login';
  state.render = null;
  app.dataset.company = '';
  document.title = 'Sign In · Rostra';
  app.innerHTML = html`
    <div class="auth">
      <header class="auth-top">
        <a class="wordmark" href="/login" data-logo translate="no"><img src="/brand/rostra-mark.svg" alt="" width="24" height="24">rostra</a>
        ${themePicker('theme-login')}
      </header>
      <main class="auth-main" id="main" tabindex="-1">
        <section class="auth-card" aria-labelledby="signin-title">
          <div>
            <h1 id="signin-title">Sign In to Your Roster</h1>
            <p class="muted">Swap shifts from your phone. Managers approve in one tap and see labour cost live.</p>
          </div>
          <form id="login-form" novalidate>
            <div class="field">
              <label for="email">Work Email</label>
              <input class="input" id="email" name="email" type="email" inputmode="email" autocomplete="username"
                     autocapitalize="off" spellcheck="false" placeholder="name@venue.com…" data-field="email" data-autofocus>
              ${errorSlot('email', 'email-error')}
            </div>
            <div class="field">
              <label for="password">Password</label>
              <input class="input" id="password" name="password" type="password" autocomplete="current-password" data-field="password">
              ${errorSlot('password', 'password-error')}
            </div>
            <label class="check"><input type="checkbox" name="remember" checked> Keep Me Signed In</label>
            <p class="form-error" data-error-for="_" role="alert" hidden tabindex="-1"></p>
            <button class="btn btn-primary btn-block" type="submit">Sign In</button>
          </form>
        </section>
        <section class="demo" aria-labelledby="demo-title">
          <div>
            <h2 id="demo-title">Try a Demo Company</h2>
            <p class="demo-note">Each company re-themes Rostra with its own brand accent. Hover a card to preview it.</p>
          </div>
          <ul class="demo-list" id="demo-list">${[0, 1, 2].map(() => html`<li class="demo-card"><div class="skeleton line"></div><div class="skeleton shift-sk"></div></li>`)}</ul>
        </section>
      </main>
    </div>`.v;
  applyTheme();
  resetAccent({ forget: false });
  if (finePointer.matches) $('#email').focus();

  const form = $('#login-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    signIn(form.email.value, form.password.value, form.remember.checked, e.submitter || $('[type="submit"]', form));
  });

  try {
    const demo = await api('/auth/demo');
    renderDemoAccounts(demo);
  } catch {
    $('#demo-list').closest('.demo').hidden = true;
  }
}

function renderDemoAccounts(demo) {
  const list = $('#demo-list');
  list.innerHTML = demo.accounts.map((a) => html`
    <li class="demo-card" data-accent="${a.accent}">
      <div class="demo-head">
        <span class="brand-mark" aria-hidden="true">${initials(a.company)}</span>
        <div><h3 translate="no">${a.company}</h3><p>${a.tagline}</p></div>
        <span class="demo-swatch" translate="no"><i aria-hidden="true"></i>${a.accent}</span>
      </div>
      <div class="demo-logins">
        <button type="button" class="btn" data-action="demo-login" data-email="${a.managerEmail}">
          <span>Sign In as ${a.managerName.split(' ')[0]} (Manager)<small translate="no">${a.managerEmail}</small></span>${icon('right')}
        </button>
        <button type="button" class="btn" data-action="demo-login" data-email="${a.staffEmail}">
          <span>Sign In as ${a.staffName} (Staff)<small translate="no">${a.staffEmail}</small></span>${icon('right')}
        </button>
      </div>
    </li>`.v).join('') + html`<li class="demo-note">Every demo account uses the password <code translate="no">${demo.password}</code>.</li>`.v;
  list.dataset.password = demo.password;

  for (const card of $$('.demo-card[data-accent]', list)) {
    const vars = accentVars(card.dataset.accent);
    card.style.setProperty('--demo-accent', vars['--accent']);
    card.style.setProperty('--demo-solid', vars['--accent-solid']);
    const preview = () => applyAccent(card.dataset.accent, { persist: false });
    const unpreview = (e) => { if (!card.contains(e.relatedTarget)) resetAccent({ forget: false }); };
    card.addEventListener('pointerenter', preview);
    card.addEventListener('pointerleave', unpreview);
    card.addEventListener('focusin', preview);
    card.addEventListener('focusout', unpreview);
  }
}

async function signIn(email, password, remember, button) {
  const form = $('#login-form');
  clearErrors(form);
  email = email.trim();
  const errors = {};
  if (!email) errors.email = 'Enter your work email.';
  else if (!email.includes('@')) errors.email = 'Enter a full email address, like name@venue.com.';
  if (!password) errors.password = 'Enter your password.';
  if (Object.keys(errors).length) return showErrors(form, errors);

  await withLoading(button, async () => {
    try {
      await api('/auth/login', { method: 'POST', body: { email, password, remember } });
      state.me = null;
      await ensureMe({ redirect: false });
      navigate(nextPath() || defaultPath(), { replace: true });
    } catch (e) {
      if (e.errors) return showErrors(form, fromServer(e.errors));
      const general = $('[data-error-for="_"]', form);
      general.innerHTML = html`${icon('alert')}<span>${e.message}</span>`.v;
      general.hidden = false;
      general.focus();
    }
  });
}

/* --------------------------------------------------------------------------
   Schedule
   -------------------------------------------------------------------------- */
async function viewSchedule() {
  state.view = 'schedule';
  state.render = renderSchedule;
  const params = new URLSearchParams(location.search);
  const siteId = Number(params.get('site')) || state.me.homeSiteId;
  const week = ymd(startOfWeek(params.get('week') ? parseDay(params.get('week')) : new Date()));
  state.lastScheduleQuery = location.search;
  updateNav('/app/schedule');

  const content = $('#content');
  const cached = state.schedule && state.schedule.site.id === siteId && state.schedule.weekStart === week;
  if (cached) renderSchedule();
  try {
    const load = () => Promise.all([api(`/schedule?siteId=${siteId}&week=${week}`), loadSwaps()]);
    const [schedule] = cached ? await load() : await withSkeleton(content, scheduleSkeleton(), load);
    if (state.view !== 'schedule') return;
    state.schedule = schedule;
    rememberNames(schedule.staff);
    updateBadges();
    renderSchedule();
  } catch (e) {
    if (e.status !== 401) content.innerHTML = errorState(e.message).v;
  }
}

function scheduleModel() {
  const s = state.schedule;
  const weekStart = parseDay(s.weekStart);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const keys = days.map(ymd);
  const people = new Map(s.staff.map((p) => [p.id, p]));
  const cells = new Map();
  const perPerson = new Map(s.staff.map((p) => [p.id, { hours: 0, cost: 0, shifts: 0 }]));
  const perDay = days.map(() => ({ hours: 0, cost: 0, shifts: 0 }));
  const total = { hours: 0, cost: 0, shifts: 0 };
  for (const shift of s.shifts) {
    const i = keys.indexOf(ymd(parse(shift.start)));
    if (i < 0) continue;
    const key = `${shift.staffId}|${i}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(shift);
    const h = paidHours(shift);
    const c = shiftCost(shift, people.get(shift.staffId)?.hourlyRate, s.penalties);
    for (const bucket of [perPerson.get(shift.staffId), perDay[i], total]) {
      if (!bucket) continue;
      bucket.hours += h; bucket.cost += c; bucket.shifts += 1;
    }
  }
  return { s, weekStart, days, people, cells, perPerson, perDay, total };
}

function weekHref(offset) {
  const s = state.schedule;
  const target = offset === 0 ? startOfWeek(new Date()) : addDays(parseDay(s.weekStart), offset * 7);
  return `/app/schedule?site=${s.site.id}&week=${ymd(target)}`;
}

function renderSchedule() {
  if (!state.schedule || state.view !== 'schedule') return;
  const m = scheduleModel();
  const { s, weekStart, days } = m;
  const manager = isManager();
  const week = isoWeek(weekStart);
  const isThisWeek = sameDay(weekStart, startOfWeek(new Date()));
  document.title = `Schedule · ${s.site.name} · Week ${week} · ${state.me.company.name}`;

  $('#content').innerHTML = html`
    <header class="page-head">
      <div class="page-title">
        <h1>Schedule</h1>
        <p class="page-sub">
          <span class="pill num">Week ${week} · ${s.site.name}</span>
          <span class="num">${fmt.range.formatRange(weekStart, days[6])}</span>
        </p>
      </div>
      <div class="toolbar">
        <label class="site-picker" for="site-select">
          <span class="sr-only">Site</span>${icon('pin')}
          <select class="select" id="site-select" name="site">
            ${state.me.sites.map((site) => html`<option value="${site.id}" ${site.id === s.site.id ? raw('selected') : ''}>${site.name}</option>`)}
          </select>
        </label>
        <nav class="segmented" aria-label="Change week">
          <a class="btn icon-btn" href="${weekHref(-1)}" aria-label="Previous week">${icon('left')}</a>
          <a class="btn" href="${weekHref(0)}" ${isThisWeek ? raw('aria-current="date"') : ''}>This Week</a>
          <a class="btn icon-btn" href="${weekHref(1)}" aria-label="Next week">${icon('right')}</a>
        </nav>
        ${manager ? html`<button type="button" class="btn btn-primary" data-action="new-shift">${icon('plus')}Add Shift…</button>` : ''}
      </div>
    </header>
    ${manager ? managerStats(m) : staffStats(m)}
    <section class="panel" aria-labelledby="roster-title">
      <h2 id="roster-title" class="sr-only">Roster for ${s.site.name}, week of ${fmt.dayLong.format(weekStart)}</h2>
      ${s.staff.length ? rosterTable(m) : html`
        <div class="empty">
          ${icon('calendar')}<h2>No One Is Rostered Here Yet</h2>
          <p>${manager ? 'Add a shift to start this week’s roster.' : 'Your manager hasn’t published this week yet. Check another week or site.'}</p>
          ${manager ? html`<button type="button" class="btn btn-primary" data-action="new-shift">${icon('plus')}Add Shift…</button>` : html`<a class="btn" href="${weekHref(0)}">Go to This Week</a>`}
        </div>`}
      <div class="legend" aria-label="Legend">
        ${['Floor', 'Kitchen', 'Bar', 'Barista'].map((st) => html`<span data-station="${st}"><i aria-hidden="true"></i>${st}</span>`)}
        <span class="legend-pending"><i aria-hidden="true"></i>Swap pending</span>
      </div>
    </section>
    ${manager ? approvalBar() : ''}`.v;

  const meter = $('[data-meter]');
  if (meter) meter.style.setProperty('--fill', meter.dataset.meter);
}

function managerStats({ s, total, perDay }) {
  const budget = s.site.weeklyBudget || 0;
  const ratio = budget ? total.cost / budget : 0;
  const over = total.cost - budget;
  const pending = state.swaps.length;
  const busiest = perDay.reduce((best, d, i) => (d.cost > best.cost ? { ...d, i } : best), { cost: 0, i: -1 });
  return html`
    <section class="stats" aria-label="This week at a glance">
      <div class="stat">
        <span class="stat-label">Labour Cost</span>
        <span class="stat-value">${money(total.cost)}</span>
        <div class="meter ${over > 0 ? 'is-over' : ''}" role="meter" aria-label="Labour cost against budget"
             aria-valuemin="0" aria-valuemax="${Math.round(budget)}" aria-valuenow="${Math.round(total.cost)}"
             aria-valuetext="${money(total.cost)} of ${money(budget)}">
          <span class="meter-fill" data-meter="${Math.min(1, ratio).toFixed(3)}"></span>
        </div>
        <span class="stat-foot ${over > 0 ? 'is-over' : ''}">
          ${over > 0 ? html`${icon('alert')}Over budget by ${money(over)}` : html`<span class="live-dot" aria-hidden="true"></span>Live · ${fmt.pct.format(ratio)} of ${money(budget)} budget`}
        </span>
      </div>
      <div class="stat">
        <span class="stat-label">Paid Hours</span>
        <span class="stat-value">${hrs(total.hours)}</span>
        <span class="stat-foot">${fmt.int.format(total.shifts)} shifts · ${fmt.int.format(s.staff.length)} people</span>
      </div>
      <div class="stat">
        <span class="stat-label">Average Cost per Hour</span>
        <span class="stat-value">${money(total.hours ? total.cost / total.hours : 0)}</span>
        <span class="stat-foot">Incl. Sat ×${s.penalties.saturday} & Sun ×${s.penalties.sunday} rates</span>
      </div>
      <div class="stat">
        <span class="stat-label">Swap Requests</span>
        <span class="stat-value">${fmt.int.format(pending)}</span>
        <span class="stat-foot">${pending ? html`<a href="/app/swaps">Review ${pending === 1 ? 'Request' : 'Requests'}</a>` : busiest.i >= 0 ? `Busiest: ${fmt.dow.format(weekDays(s)[busiest.i])}, ${money(busiest.cost)}` : 'All caught up'}</span>
      </div>
    </section>`;
}
const weekDays = (s) => Array.from({ length: 7 }, (_, i) => addDays(parseDay(s.weekStart), i));

function staffStats({ s, perPerson, total }) {
  const me = state.me.id;
  const mine = s.shifts.filter((x) => x.staffId === me).sort((a, b) => parse(a.start) - parse(b.start));
  const next = mine.find((x) => parse(x.end) > new Date());
  const myHours = perPerson.get(me)?.hours ?? mine.reduce((sum, x) => sum + paidHours(x), 0);
  const requests = state.swaps.length;
  return html`
    <section class="stats" aria-label="Your week at a glance">
      <div class="stat"><span class="stat-label">Your Hours</span><span class="stat-value">${hrs(myHours)}</span><span class="stat-foot">${fmt.int.format(mine.length)} shifts this week</span></div>
      <div class="stat"><span class="stat-label">Next Shift</span><span class="stat-value">${next ? `${fmt.dow.format(parse(next.start))} ${compact(next.start, next.end)}` : '—'}</span><span class="stat-foot">${next ? `${next.station} · ${s.site.name}` : 'Nothing else this week'}</span></div>
      <div class="stat"><span class="stat-label">Team on Roster</span><span class="stat-value">${fmt.int.format(s.staff.length)}</span><span class="stat-foot">${fmt.int.format(total.shifts)} shifts at ${s.site.name}</span></div>
      <div class="stat"><span class="stat-label">Swap Requests</span><span class="stat-value">${fmt.int.format(requests)}</span><span class="stat-foot">${requests ? html`<a href="/app/swaps">View Requests</a>` : 'Tap one of your shifts to ask for cover'}</span></div>
    </section>`;
}

function rosterTable({ s, days, cells, perPerson, perDay, total, people }) {
  const manager = isManager();
  const me = state.me.id;
  const today = new Date();
  return html`
    <div class="grid-scroll" role="region" aria-labelledby="roster-title" tabindex="0">
      <table class="roster">
        <colgroup><col class="col-person">${days.map(() => html`<col>`)}</colgroup>
        <thead>
          <tr>
            <th scope="col" class="corner"><span class="sr-only">Team member</span><span aria-hidden="true">Team</span></th>
            ${days.map((d) => {
              const isToday = sameDay(d, today);
              return html`<th scope="col" class="${isToday ? 'is-today' : ''}" ${isToday ? raw('aria-current="date"') : ''}>
                <span class="day-head"><span>${fmt.dow.format(d)}</span><span class="day-num">${fmt.dayNum.format(d)}</span>${isToday ? html`<span class="today-label">Today</span>` : ''}</span>
              </th>`;
            })}
          </tr>
        </thead>
        <tbody>
          ${s.staff.map((p) => {
            const t = perPerson.get(p.id);
            const isMe = p.id === me;
            return html`<tr class="${isMe ? 'is-me' : ''}">
              <th scope="row">
                <div class="person">
                  <span class="avatar ${isMe ? 'is-me' : ''}" aria-hidden="true">${initials(p.name)}</span>
                  <span class="person-text">
                    <span class="person-name">${p.name}${isMe ? html`<span class="you-tag">You</span>` : ''}</span>
                    <span class="person-meta">${hrs(t.hours)}${manager ? ` · ${money(t.cost)}` : ` · ${p.title}`}</span>
                  </span>
                </div>
              </th>
              ${days.map((d, i) => {
                const list = cells.get(`${p.id}|${i}`) || [];
                return html`<td class="${sameDay(d, today) ? 'is-today' : ''}"><div class="cell">
                  ${list.map((shift) => shiftChip(shift, p, people))}
                  ${manager ? html`<button type="button" class="add-slot" data-action="add-shift" data-staff="${p.id}" data-day="${i}"
                    aria-label="Add shift for ${p.name} on ${fmt.dayLong.format(d)}">${icon('plus')}</button>` : ''}
                </div></td>`;
              })}
            </tr>`;
          })}
        </tbody>
        ${manager ? html`<tfoot>
          <tr>
            <th scope="row">Daily Labour<br><span class="num">${money(total.cost)}</span></th>
            ${perDay.map((d) => html`<td><span class="day-total"><strong>${money(d.cost)}</strong><span>${hrs(d.hours)} · ${d.shifts}</span></span></td>`)}
          </tr>
        </tfoot>` : ''}
      </table>
    </div>`;
}

function shiftChip(shift, person, people) {
  const manager = isManager();
  const me = state.me.id;
  const pending = shift.pendingCoverId != null;
  const coverName = pending ? (people.get(shift.pendingCoverId)?.name ?? nameOf(shift.pendingCoverId)) : null;
  const mine = shift.staffId === me;
  const askedMe = shift.pendingCoverId === me;
  const interactive = manager || mine || askedMe;
  const start = parse(shift.start);
  const meta = pending ? `Swap → ${coverName}` : shift.notes ? `${shift.station} · ${shift.notes}` : shift.station;
  const label = `${person.name}, ${fmt.dayLong.format(start)}, ${fullRange(shift.start, shift.end)}, ${shift.station}`
    + (pending ? `, swap pending: ${coverName} asked to cover` : '')
    + (manager ? '. Edit shift' : mine ? '. Ask for cover' : '');
  const cls = `shift${pending ? ' is-pending' : ''}${mine && !manager ? ' is-mine' : ''}${shift.id === justAdded ? ' is-new' : ''}`;
  const inner = html`<span class="shift-time">${compact(shift.start, shift.end)}</span><span class="shift-meta">${meta}</span>`;
  return interactive
    ? html`<button type="button" class="${cls}" data-station="${shift.station}" data-action="open-shift" data-id="${shift.id}" aria-label="${label}">${inner}</button>`
    : html`<div class="${cls}" data-station="${shift.station}">${inner}<span class="sr-only">, ${fullRange(shift.start, shift.end)}</span></div>`;
}
let justAdded = null;

function approvalBar() {
  const swaps = [...state.swaps].sort((a, b) => parse(a.start) - parse(b.start));
  if (!swaps.length) return '';
  const first = swaps[0];
  const start = parse(first.start);
  const onScreen = state.schedule.site.id === first.siteId && sameDay(startOfWeek(start), parseDay(state.schedule.weekStart));
  const rest = swaps.length - 1;
  return html`
    <section class="approval" aria-label="Swap request awaiting approval">
      <span class="approval-dot" aria-hidden="true"></span>
      <div class="approval-text">
        <p><strong>${first.from.name}</strong> asked <strong>${first.cover.name}</strong> to cover <strong class="num">${fmt.dow.format(start)} ${compact(first.start, first.end)}</strong></p>
        <p class="muted">${first.site} · ${fmt.dayShort.format(start)} ${deltaPill(swapDelta(first, state.penalties))}
          ${onScreen ? '' : html` · <a href="/app/schedule?site=${first.siteId}&week=${ymd(startOfWeek(start))}">View on Roster</a>`}
          ${rest > 0 ? html` · <a href="/app/swaps">${rest} more</a>` : ''}</p>
      </div>
      <div class="approval-actions">
        <button type="button" class="btn btn-ghost" data-action="decline" data-id="${first.shiftId}">Decline</button>
        <button type="button" class="btn btn-primary" data-action="approve" data-id="${first.shiftId}">${icon('check')}Approve</button>
      </div>
    </section>`;
}

const scheduleSkeleton = () => html`
  <header class="page-head"><div class="page-title"><h1>Schedule</h1><p class="page-sub"><span class="skeleton line w-180"></span></p></div></header>
  <section class="stats" aria-hidden="true">${[0, 1, 2, 3].map(() => html`<div class="stat"><span class="skeleton line"></span><span class="skeleton line"></span><span class="skeleton line"></span></div>`)}</section>
  <section class="panel" aria-busy="true" aria-label="Loading roster">
    <div class="grid-scroll"><table class="roster"><colgroup><col class="col-person">${[...Array(7)].map(() => html`<col>`)}</colgroup>
      <thead><tr><th class="corner">Team</th>${[...Array(7)].map(() => html`<th><span class="skeleton line"></span></th>`)}</tr></thead>
      <tbody>${[...Array(6)].map((_, r) => html`<tr><th><span class="skeleton line"></span></th>${[...Array(7)].map((__, c) => html`<td><div class="cell">${(r + c) % 3 ? html`<div class="skeleton shift-sk"></div>` : ''}</div></td>`)}</tr>`)}</tbody>
    </table></div>
  </section>`;

/* --------------------------------------------------------------------------
   Shift editor (managers)
   -------------------------------------------------------------------------- */
const STATIONS = ['Floor', 'Kitchen', 'Bar', 'Barista'];
const timeValue = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function openShiftEditor({ shift, staffId, dayIndex, returnTo }) {
  const s = state.schedule;
  const days = weekDays(s);
  const editing = Boolean(shift);
  const start = shift ? parse(shift.start) : null;
  const end = shift ? parse(shift.end) : null;
  const person = s.staff.find((p) => p.id === (shift?.staffId ?? staffId)) ?? s.staff[0];
  const day = shift ? days.findIndex((d) => sameDay(d, start)) : dayIndex ?? Math.max(0, days.findIndex((d) => sameDay(d, new Date())));
  const shortcut = isMac ? `⌘${NBSP}Enter` : `Ctrl${NBSP}Enter`;
  const pendingSwap = shift?.pendingCoverId != null && state.swaps.find((x) => x.shiftId === shift.id);

  openDialog(html`
    <form class="dialog-form" id="shift-form" novalidate data-track-changes>
      ${dialogHead(editing ? 'Edit Shift' : 'Add Shift', `${s.site.name} · Week ${isoWeek(days[0])}`)}
      <div class="dialog-body">
        ${pendingSwap ? html`
          <div class="callout">
            <p><strong>${pendingSwap.from.name}</strong> asked <strong>${pendingSwap.cover.name}</strong> to cover this shift. ${deltaPill(swapDelta(pendingSwap, state.penalties))}</p>
            <div class="callout-actions">
              <button type="button" class="btn btn-sm" data-action="decline" data-id="${shift.id}">Decline</button>
              <button type="button" class="btn btn-sm btn-primary" data-action="approve" data-id="${shift.id}">${icon('check')}Approve Swap</button>
            </div>
          </div>` : ''}
        <div class="field">
          <label for="f-staff">Team Member</label>
          <select class="select" id="f-staff" name="staffId" data-field="staffId" data-autofocus>
            ${s.staff.map((p) => html`<option value="${p.id}" ${p.id === person?.id ? raw('selected') : ''}>${p.name} — ${p.title}</option>`)}
          </select>
          ${errorSlot('staffId', 'f-staff-error')}
        </div>
        <div class="field">
          <label for="f-day">Day</label>
          <select class="select" id="f-day" name="day" data-field="day">
            ${days.map((d, i) => html`<option value="${i}" ${i === day ? raw('selected') : ''}>${fmt.dayLong.format(d)}</option>`)}
          </select>
        </div>
        <div class="row-3">
          <div class="field">
            <label for="f-start">Start</label>
            <input class="input num" id="f-start" name="start" type="time" step="900" value="${start ? timeValue(start) : '09:00'}" data-field="start">
          </div>
          <div class="field">
            <label for="f-end">End</label>
            <input class="input num" id="f-end" name="end" type="time" step="900" value="${end ? timeValue(end) : '17:00'}" data-field="end">
          </div>
          <div class="field">
            <label for="f-break">Unpaid Break</label>
            <select class="select" id="f-break" name="breakMinutes" data-field="breakMinutes">
              ${[0, 15, 30, 45, 60].map((n) => html`<option value="${n}" ${n === (shift?.breakMinutes ?? 30) ? raw('selected') : ''}>${n ? `${n}${NBSP}min` : 'None'}</option>`)}
            </select>
          </div>
        </div>
        ${errorSlot('start', 'f-start-error')}${errorSlot('end', 'f-end-error')}${errorSlot('breakMinutes', 'f-break-error')}
        <p class="field-hint" id="overnight-hint" hidden>Ends the next morning.</p>
        <div class="field">
          <label for="f-station">Station</label>
          <select class="select" id="f-station" name="station" data-field="station">
            ${STATIONS.map((st) => html`<option value="${st}" ${st === (shift?.station ?? person?.primaryStation) ? raw('selected') : ''}>${st}</option>`)}
          </select>
          <p class="field-hint" id="station-hint" hidden></p>
          ${errorSlot('station', 'f-station-error')}
        </div>
        <div class="field">
          <label for="f-notes">Notes <span class="muted">(optional)</span></label>
          <textarea class="textarea" id="f-notes" name="notes" maxlength="280" data-field="notes" placeholder="e.g. Training Ella on close…">${shift?.notes ?? ''}</textarea>
          <p class="field-hint">Press ${shortcut} to save.</p>
          ${errorSlot('notes', 'f-notes-error')}
        </div>
        <p class="form-error" data-error-for="_" role="alert" hidden tabindex="-1"></p>
      </div>
      <div class="dialog-foot">
        ${editing ? html`<button type="button" class="btn btn-danger" data-action="delete-shift" data-id="${shift.id}">Delete</button>` : ''}
        <span class="cost-preview" id="cost-preview" aria-live="polite"></span>
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">${editing ? 'Save Shift' : 'Add Shift'}</button>
      </div>
    </form>`, { returnTo, onOpen: (dlg) => wireShiftForm($('#shift-form', dlg), shift) });
}

function readShiftForm(form) {
  const day = weekDays(state.schedule)[Number(form.day.value)];
  const [sh, sm] = (form.start.value || '').split(':').map(Number);
  const [eh, em] = (form.end.value || '').split(':').map(Number);
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), sh, sm);
  let end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), eh, em);
  const overnight = form.start.value && form.end.value && end <= start;
  if (overnight) end = addDays(end, 1);
  return {
    hasTimes: Boolean(form.start.value && form.end.value),
    overnight,
    body: {
      staffId: Number(form.staffId.value),
      siteId: state.schedule.site.id,
      start: isoLocal(start),
      end: isoLocal(end),
      breakMinutes: Number(form.breakMinutes.value),
      station: form.station.value,
      notes: form.notes.value.trim() || null,
    },
  };
}

function wireShiftForm(form, shift) {
  const update = () => {
    const { body, hasTimes, overnight } = readShiftForm(form);
    const person = state.schedule.staff.find((p) => p.id === body.staffId);
    $('#overnight-hint', form).hidden = !overnight;
    const hint = $('#station-hint', form);
    const trained = person?.stations.split(', ').includes(body.station);
    hint.hidden = trained !== false;
    hint.textContent = trained === false ? `${person.name} isn’t trained on ${body.station} yet. You can still roster them.` : '';
    $('#cost-preview', form).textContent = hasTimes && person
      ? `${hrs(paidHours(body))} · ${money(shiftCost(body, person.hourlyRate, state.schedule.penalties))}`
      : '';
  };
  form.addEventListener('input', update);
  form.staffId.addEventListener('change', () => {
    const person = state.schedule.staff.find((p) => p.id === Number(form.staffId.value));
    if (!shift && person) form.station.value = person.primaryStation;
    update();
  });
  update();

  form.notes.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const { body, hasTimes } = readShiftForm(form);
    if (!hasTimes) return showErrors(form, { [form.start.value ? 'end' : 'start']: 'Enter both a start and an end time.' });

    await withLoading(e.submitter || $('[type="submit"]', form), async () => {
      try {
        const saved = shift
          ? await api(`/shifts/${shift.id}`, { method: 'PUT', body })
          : await api('/shifts', { method: 'POST', body });
        const list = state.schedule.shifts.filter((x) => x.id !== saved.id);
        if (saved.siteId === state.schedule.site.id) list.push(saved);
        state.schedule.shifts = list;
        justAdded = shift ? null : saved.id;
        closeDialog({ force: true });
        renderSchedule();
        justAdded = null;
        const name = state.schedule.staff.find((p) => p.id === saved.staffId)?.name ?? 'them';
        toast(shift ? 'Shift saved.' : `Shift added for ${name}: ${fmt.dow.format(parse(saved.start))} ${compact(saved.start, saved.end)}.`);
        $(`[data-id="${saved.id}"]`)?.focus({ preventScroll: true });
      } catch (err) {
        if (err.errors) return showErrors(form, fromServer(err.errors));
        const general = $('[data-error-for="_"]', form);
        general.innerHTML = html`${icon('alert')}<span>${err.message}</span>`.v;
        general.hidden = false;
        general.focus();
      }
    });
  });
}

/* --------------------------------------------------------------------------
   Swap request (staff) & swap response (asked cover)
   -------------------------------------------------------------------------- */
async function openSwapRequest(shift, returnTo) {
  const start = parse(shift.start);
  const summary = html`
    <div class="summary" data-station="${shift.station}">
      <span class="station-dot" aria-hidden="true"></span>
      <div><strong class="num">${dayLabel(start)} · ${fullRange(shift.start, shift.end)}</strong>
      <p class="muted">${shift.station}${shift.site ? ` · ${shift.site}` : ''} · ${hrs(paidHours(shift))} paid</p></div>
    </div>`;

  if (shift.pendingCoverId === state.me.id && shift.staffId !== state.me.id) {
    const from = shift.staffName ?? nameOf(shift.staffId);
    return openDialog(html`
      <div class="dialog-form">
        ${dialogHead(`${from} Asked You to Cover`, 'Your manager approves swaps before they’re final.')}
        <div class="dialog-body">${summary}<p class="muted">If you can’t make it, decline so ${from} can ask someone else.</p></div>
        <div class="dialog-foot"><span class="spacer"></span>
          <button type="button" class="btn" data-close>Close</button>
          <button type="button" class="btn btn-danger" data-action="decline" data-id="${shift.id}">Decline</button>
        </div>
      </div>`, { returnTo });
  }

  if (shift.pendingCoverId != null) {
    const cover = shift.pendingCoverName ?? nameOf(shift.pendingCoverId);
    return openDialog(html`
      <div class="dialog-form">
        ${dialogHead(`Waiting on ${cover}`, 'Your manager will approve or decline the swap.')}
        <div class="dialog-body">${summary}<p class="muted">You’re still on this shift until it’s approved.</p></div>
        <div class="dialog-foot"><span class="spacer"></span>
          <button type="button" class="btn" data-close>Close</button>
          <button type="button" class="btn btn-danger" data-action="decline" data-id="${shift.id}">Cancel Request</button>
        </div>
      </div>`, { returnTo });
  }

  openDialog(html`
    <form class="dialog-form" id="swap-form" novalidate>
      ${dialogHead('Ask for Cover', 'Choose a teammate. Your manager approves the swap.')}
      <div class="dialog-body">
        ${summary}
        <fieldset class="options" id="cover-options" aria-describedby="cover-error" aria-busy="true">
          <legend>Who can cover?</legend>
          ${[0, 1, 2, 3].map(() => html`<div class="option"><span class="skeleton line w-60"></span></div>`)}
        </fieldset>
        ${errorSlot('coverId', 'cover-error')}
        <p class="form-error" data-error-for="_" role="alert" hidden tabindex="-1"></p>
      </div>
      <div class="dialog-foot"><span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">Send Request</button>
      </div>
    </form>`, { returnTo });

  const form = $('#swap-form', dialog);
  let options = [];
  try {
    options = await api(`/shifts/${shift.id}/cover-options`);
  } catch (e) {
    $('#cover-options', form).innerHTML = html`<legend>Who can cover?</legend>${errorState(e.message, false)}`.v;
    return;
  }
  if (!form.isConnected) return;
  options.forEach((o) => state.names.set(o.id, o.name));
  const fieldset = $('#cover-options', form);
  fieldset.removeAttribute('aria-busy');
  const available = options.filter((o) => o.available);
  fieldset.innerHTML = html`
    <legend>Who can cover? <span class="muted">${fmt.int.format(available.length)} available</span></legend>
    ${options.length ? options.slice(0, 14).map((o, i) => html`
      <label class="option">
        <input type="radio" name="coverId" value="${o.id}" data-field="coverId" ${o.available ? '' : raw('disabled')} ${i === 0 && o.available && finePointer.matches ? raw('data-autofocus') : ''}>
        <span class="option-text"><strong>${o.name}</strong><span>${o.title} · ${o.site}</span></span>
        ${o.available ? html`<span class="status is-save">Available</span>` : html`<span class="status">${o.reason}</span>`}
      </label>`) : html`<p class="muted">No one else is on the team yet.</p>`}`.v;
  if (!available.length && options.length)
    fieldset.insertAdjacentHTML('beforeend', html`<p class="muted">No one can take this shift right now. Talk to your manager about other options.</p>`.v);
  if (finePointer.matches) $('[data-autofocus]', fieldset)?.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const coverId = Number(form.querySelector('input[name="coverId"]:checked')?.value);
    if (!coverId) return showErrors(form, { coverId: 'Choose who you’d like to cover this shift.' });
    await withLoading(e.submitter || $('[type="submit"]', form), async () => {
      try {
        markMine(shift.id);
        await api(`/shifts/${shift.id}/swap`, { method: 'POST', body: { coverId } });
        setPending(shift.id, coverId);
        closeDialog({ force: true });
        toast(`Request sent to ${nameOf(coverId)}. Your manager will approve it.`);
        refreshQuietly();
      } catch (err) {
        if (err.status === 409) refreshQuietly();
        const general = $('[data-error-for="_"]', form);
        general.innerHTML = html`${icon('alert')}<span>${err.status === 409 ? `${nameOf(coverId)} can’t take this shift any more. Choose someone else.` : err.message}</span>`.v;
        general.hidden = false;
        general.focus();
      }
    });
  });
}

function setPending(shiftId, coverId) {
  for (const list of [state.schedule?.shifts, state.myShifts]) {
    const s = list?.find((x) => x.id === shiftId);
    if (s) { s.pendingCoverId = coverId; s.pendingCoverName = coverId ? nameOf(coverId) : null; }
  }
  state.render?.();
}

/* --------------------------------------------------------------------------
   Swaps list
   -------------------------------------------------------------------------- */
async function viewSwaps() {
  state.view = 'swaps';
  state.render = renderSwaps;
  document.title = `Swap Requests · ${state.me.company.name}`;
  const content = $('#content');
  try {
    await withSkeleton(content, listSkeleton('Swap Requests'), loadSwaps);
    updateBadges();
    renderSwaps();
  } catch (e) {
    if (e.status !== 401) content.innerHTML = errorState(e.message).v;
  }
}

function renderSwaps() {
  if (state.view !== 'swaps') return;
  const manager = isManager();
  const me = state.me.id;
  const swaps = [...state.swaps].sort((a, b) => parse(a.start) - parse(b.start));
  const totalDelta = manager ? swaps.reduce((sum, s) => sum + (swapDelta(s, state.penalties) ?? 0), 0) : 0;
  $('#content').innerHTML = html`
    <header class="page-head">
      <div class="page-title">
        <h1>Swap Requests</h1>
        <p class="page-sub">${manager
          ? html`Approve in one tap. ${swaps.length ? html`Approving all changes labour cost by <strong class="num">${totalDelta < 0 ? '−' : '+'}${money(Math.abs(totalDelta))}</strong>.` : ''}`
          : 'Requests you’ve sent, and shifts you’ve been asked to cover.'}</p>
      </div>
    </header>
    ${swaps.length ? html`<div class="list">${swaps.map((s) => {
      const start = parse(s.start);
      const mineToCancel = s.from.id === me;
      const askedMe = s.cover.id === me;
      const title = manager ? html`${s.from.name} → ${s.cover.name}` : mineToCancel ? `You asked ${s.cover.name}` : `${s.from.name} asked you`;
      return html`
        <article class="card is-pending" aria-label="${s.from.name} asked ${s.cover.name} to cover ${fmt.dayLong.format(start)}">
          <div class="card-date" aria-hidden="true"><small>${fmt.dow.format(start)}</small><strong>${fmt.dayNum.format(start)}</strong></div>
          <div class="card-body">
            <span class="card-title">${title}</span>
            <span class="card-meta">
              <span class="num">${icon('clock')}${fmt.dayShort.format(start)}, ${fullRange(s.start, s.end)}</span>
              <span>${icon('pin')}${s.site}</span>
              <span data-station="${s.station}"><span class="station-dot" aria-hidden="true"></span>${s.station}</span>
              ${manager ? deltaPill(swapDelta(s, state.penalties)) : html`<span class="status is-pending">Waiting for approval</span>`}
            </span>
          </div>
          <div class="card-actions">
            ${manager ? html`
              <button type="button" class="btn" data-action="decline" data-id="${s.shiftId}">Decline</button>
              <button type="button" class="btn btn-primary" data-action="approve" data-id="${s.shiftId}">${icon('check')}Approve</button>`
            : mineToCancel ? html`<button type="button" class="btn btn-danger" data-action="decline" data-id="${s.shiftId}">Cancel Request</button>`
            : askedMe ? html`<button type="button" class="btn btn-danger" data-action="decline" data-id="${s.shiftId}">Decline</button>` : ''}
          </div>
        </article>`;
    })}</div>` : html`
      <div class="empty">
        ${icon('swap')}
        <h2>No Swap Requests</h2>
        <p>${manager ? 'You’re all caught up. New requests appear here the moment someone asks for cover.' : 'Need a shift covered? Open it from My Shifts and choose a teammate.'}</p>
        <a class="btn" href="${manager ? `/app/schedule${state.lastScheduleQuery}` : '/app/my-shifts'}">${manager ? 'Go to Schedule' : 'Go to My Shifts'}</a>
      </div>`}`.v;
}

const listSkeleton = (title) => html`
  <header class="page-head"><div class="page-title"><h1>${title}</h1><p class="page-sub"><span class="skeleton line w-240"></span></p></div></header>
  <div class="list" aria-busy="true" aria-label="Loading">${[0, 1, 2].map(() => html`<div class="card"><div class="card-date skeleton"></div><div class="card-body"><span class="skeleton line w-40"></span><span class="skeleton line w-70"></span></div></div>`)}</div>`;

/* --------------------------------------------------------------------------
   My shifts (phone-first)
   -------------------------------------------------------------------------- */
async function viewMyShifts() {
  state.view = 'my-shifts';
  state.render = renderMyShifts;
  document.title = `My Shifts · ${state.me.company.name}`;
  const content = $('#content');
  try {
    state.myShifts = await withSkeleton(content, listSkeleton('My Shifts'), () => api('/my-shifts'));
    renderMyShifts();
  } catch (e) {
    if (e.status !== 401) content.innerHTML = errorState(e.message).v;
  }
}

function renderMyShifts() {
  if (state.view !== 'my-shifts' || !state.myShifts) return;
  const me = state.me.id;
  const mine = state.myShifts.filter((s) => s.staffId === me);
  const hours = mine.reduce((sum, s) => sum + paidHours(s), 0);
  const groups = new Map();
  for (const s of state.myShifts) {
    const key = ymd(parse(s.start));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  $('#content').innerHTML = html`
    <header class="page-head">
      <div class="page-title">
        <h1>My Shifts</h1>
        <p class="page-sub num">${fmt.int.format(mine.length)} upcoming · ${hrs(hours)} paid</p>
      </div>
    </header>
    ${state.myShifts.length ? html`<div class="list">${[...groups].map(([key, list]) => html`
      <section class="list-group" aria-labelledby="day-${key}">
        <h2 id="day-${key}">${dayLabel(parseDay(key))}</h2>
        ${list.map((s) => {
          const start = parse(s.start);
          const askedMe = s.pendingCoverId === me && s.staffId !== me;
          const pending = s.pendingCoverId != null;
          return html`
            <article class="card ${pending ? 'is-pending' : ''}">
              <div class="card-date" aria-hidden="true"><small>${fmt.dow.format(start)}</small><strong>${fmt.dayNum.format(start)}</strong></div>
              <div class="card-body">
                <span class="card-title">${fullRange(s.start, s.end)}</span>
                <span class="card-meta">
                  <span>${icon('pin')}${s.site}</span>
                  <span data-station="${s.station}"><span class="station-dot" aria-hidden="true"></span>${s.station}</span>
                  <span class="num">${hrs(paidHours(s))} paid</span>
                  ${askedMe ? html`<span class="status is-pending">${s.staffName} asked you to cover</span>`
                    : pending ? html`<span class="status is-pending">Waiting on ${s.pendingCoverName}</span>` : ''}
                </span>
                ${s.notes ? html`<span class="muted">${s.notes}</span>` : ''}
              </div>
              <div class="card-actions">
                ${askedMe ? html`<button type="button" class="btn btn-danger" data-action="decline" data-id="${s.id}">Decline</button>`
                  : pending ? html`<button type="button" class="btn" data-action="decline" data-id="${s.id}">Cancel Request</button>`
                  : html`<button type="button" class="btn" data-action="request-swap" data-id="${s.id}">${icon('swap')}Ask for Cover…</button>`}
              </div>
            </article>`;
        })}
      </section>`)}</div>` : html`
      <div class="empty">
        ${icon('calendar')}
        <h2>No Upcoming Shifts</h2>
        <p>You’re not rostered on yet. Check the schedule to see what’s published.</p>
        <a class="btn" href="/app/schedule">Go to Schedule</a>
      </div>`}`.v;
}

/* --------------------------------------------------------------------------
   Actions (event delegation)
   -------------------------------------------------------------------------- */
const findShift = (id) => state.schedule?.shifts.find((s) => s.id === id) ?? state.myShifts?.find((s) => s.id === id);
const snapshot = () => ({ schedule: structuredClone(state.schedule), swaps: structuredClone(state.swaps), myShifts: structuredClone(state.myShifts) });
const restore = (snap) => { Object.assign(state, snap); updateBadges(); state.render?.(); };

const actions = {
  retry: () => route(),

  logout: async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* signed out locally regardless */ }
    signedOut();
    navigate('/login', { replace: true });
  },

  'demo-login': (el) => {
    const form = $('#login-form');
    form.email.value = el.dataset.email;
    form.password.value = $('#demo-list').dataset.password;
    const card = el.closest('[data-accent]');
    if (card) applyAccent(card.dataset.accent, { persist: false });
    signIn(form.email.value, form.password.value, form.remember.checked, el);
  },

  'new-shift': (el) => openShiftEditor({ returnTo: el }),

  'add-shift': (el) => openShiftEditor({
    staffId: Number(el.dataset.staff), dayIndex: Number(el.dataset.day),
    returnTo: `[data-action="add-shift"][data-staff="${el.dataset.staff}"][data-day="${el.dataset.day}"]`,
  }),

  'open-shift': (el) => {
    const shift = findShift(Number(el.dataset.id));
    if (!shift) return;
    const returnTo = `[data-id="${shift.id}"][data-action="open-shift"]`;
    if (isManager()) openShiftEditor({ shift, returnTo });
    else openSwapRequest({ ...shift, site: state.schedule?.site.name }, returnTo);
  },

  'request-swap': (el) => {
    const shift = findShift(Number(el.dataset.id));
    if (shift) openSwapRequest(shift, `[data-action="request-swap"][data-id="${shift.id}"]`);
  },

  'delete-shift': async (el) => {
    const id = Number(el.dataset.id);
    const shift = state.schedule.shifts.find((s) => s.id === id);
    if (!shift || !closeDialog({ force: true })) return;
    const snap = snapshot();
    state.schedule.shifts = state.schedule.shifts.filter((s) => s.id !== id);
    state.swaps = state.swaps.filter((s) => s.shiftId !== id);
    renderSchedule(); updateBadges();
    try {
      await api(`/shifts/${id}`, { method: 'DELETE' });
      const who = state.schedule.staff.find((p) => p.id === shift.staffId)?.name ?? 'Shift';
      toast(`Deleted ${who}’s ${fmt.dow.format(parse(shift.start))} ${compact(shift.start, shift.end)} shift.`, {
        action: 'Undo', timeout: 8000,
        onAction: async () => {
          try {
            const { id: _, pendingCoverId: __, ...body } = shift;
            const again = await api('/shifts', { method: 'POST', body });
            state.schedule.shifts.push(again);
            renderSchedule();
            toast('Shift restored.');
          } catch (e) { toast(e.message, { tone: 'error' }); }
        },
      });
    } catch (e) {
      restore(snap);
      toast(e.message, { tone: 'error' });
    }
  },

  approve: async (el) => {
    const id = Number(el.dataset.id);
    const swap = state.swaps.find((s) => s.shiftId === id);
    if (!swap) return;
    if (dialog.open) closeDialog({ force: true });
    const snap = snapshot();
    markMine(id);
    state.swaps = state.swaps.filter((s) => s.shiftId !== id);
    const shift = state.schedule?.shifts.find((s) => s.id === id);
    if (shift) { shift.staffId = swap.cover.id; shift.pendingCoverId = null; }
    updateBadges(); state.render?.();
    try {
      await api(`/shifts/${id}/swap/approve`, { method: 'POST' });
      toast(`Approved. ${swap.cover.name} is now on ${fmt.dow.format(parse(swap.start))} ${compact(swap.start, swap.end)}.`);
      refreshQuietly();
    } catch (e) {
      restore(snap);
      toast(e.message, { tone: 'error' });
      if (e.status === 409) refreshQuietly();
    }
  },

  decline: async (el) => {
    const id = Number(el.dataset.id);
    const shift = findShift(id);
    const swap = state.swaps.find((s) => s.shiftId === id);
    const coverId = swap?.cover.id ?? shift?.pendingCoverId;
    if (dialog.open) closeDialog({ force: true });
    const snap = snapshot();
    const cancelling = (swap?.from.id ?? shift?.staffId) === state.me.id;
    markMine(id);
    state.swaps = state.swaps.filter((s) => s.shiftId !== id);
    setPending(id, null);
    updateBadges();
    try {
      await api(`/shifts/${id}/swap/decline`, { method: 'POST' });
      const undo = isManager() && coverId
        ? { action: 'Undo', onAction: async () => {
            try { markMine(id); await api(`/shifts/${id}/swap`, { method: 'POST', body: { coverId } }); refreshQuietly(); }
            catch (e) { toast(e.message, { tone: 'error' }); }
          } }
        : {};
      toast(cancelling ? 'Request cancelled. You’re still on this shift.' : isManager() ? 'Swap declined.' : 'Declined. They’ll be able to ask someone else.', undo);
      refreshQuietly();
    } catch (e) {
      restore(snap);
      toast(e.message, { tone: 'error' });
    }
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const handler = actions[el.dataset.action];
  if (handler) { e.preventDefault(); handler(el, e); }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'site-select' && state.schedule) {
    navigate(`/app/schedule?site=${e.target.value}&week=${state.schedule.weekStart}`);
  }
});

/* Arrow keys move between roster cells (WAI-ARIA grid-style navigation). */
document.addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || e.altKey || e.metaKey || e.ctrlKey) return;
  const cell = e.target.closest?.('.roster td');
  if (!cell || e.target.matches('input, select, textarea')) return;
  const row = cell.parentElement;
  const col = [...row.children].indexOf(cell);
  const inCell = $$('button', cell);
  const at = inCell.indexOf(e.target);
  let target = null;
  if (e.key === 'ArrowDown' && at < inCell.length - 1) target = inCell[at + 1];
  else if (e.key === 'ArrowUp' && at > 0) target = inCell[at - 1];
  else {
    let next = cell;
    const rows = [...row.parentElement.children];
    const r = rows.indexOf(row);
    for (let step = 1; step < 8 && !target; step++) {
      if (e.key === 'ArrowRight') next = row.children[col + step];
      else if (e.key === 'ArrowLeft') next = col - step >= 1 ? row.children[col - step] : null;
      else if (e.key === 'ArrowDown') next = rows[r + step]?.children[col];
      else next = rows[r - step]?.children[col];
      if (!next) break;
      target = $('button', next);
    }
  }
  if (target) { e.preventDefault(); target.focus(); }
});

/* Right-click the logo for brand assets. */
document.addEventListener('contextmenu', (e) => {
  const logo = e.target.closest('[data-logo]');
  if (!logo) return;
  e.preventDefault();
  $('.ctx-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = html`
    <a role="menuitem" href="/brand/rostra-wordmark.svg" download="rostra-wordmark.svg">Download Rostra Wordmark (SVG)</a>
    <a role="menuitem" href="/brand/rostra-mark.svg" download="rostra-mark.svg">Download Rostra Icon (SVG)</a>`.v;
  document.body.append(menu);
  const { innerWidth: w, innerHeight: h } = window;
  menu.style.setProperty('left', `${Math.min(e.clientX, w - menu.offsetWidth - 8)}px`);
  menu.style.setProperty('top', `${Math.min(e.clientY, h - menu.offsetHeight - 8)}px`);
  $('a', menu).focus();
  const close = (ev) => {
    if (ev.type === 'keydown' && ev.key !== 'Escape') return;
    if (ev.type === 'pointerdown' && menu.contains(ev.target)) return;
    menu.remove();
    document.removeEventListener('pointerdown', close);
    document.removeEventListener('keydown', close);
    if (ev.type === 'keydown') logo.focus?.();
  };
  setTimeout(() => { document.addEventListener('pointerdown', close); document.addEventListener('keydown', close); });
  menu.addEventListener('click', () => setTimeout(() => menu.remove()));
});

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */
applyTheme();
route();
