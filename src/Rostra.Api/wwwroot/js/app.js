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
  // Hovering or focusing the action (e.g. Undo) holds the toast open.
  const action$ = $('button', el);
  action$?.addEventListener('pointerenter', () => clearTimeout(timer));
  action$?.addEventListener('pointerleave', () => { timer = setTimeout(dismiss, 2000); });
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
  '/app/home': () => viewHome(),
  '/app/dashboard': () => viewDashboard(),
  '/app/schedule': () => viewSchedule(),
  '/app/swaps': () => viewSwaps(),
  '/app/my-shifts': () => viewMyShifts(),
};
function navigate(url, { replace = false } = {}) {
  if (!replace) history.replaceState({ ...(history.state || {}), y: scrollY }, '');
  history[replace ? 'replaceState' : 'pushState']({ y: 0 }, '', url);
  route();
}
const defaultPath = () => '/app/home';
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
  // Staff don't see the full roster: they get their own shifts, swaps and Home.
  return html`
    <a href="/app/home" data-nav="/app/home">${icon('home')}<span>Home</span></a>
    ${isManager() ? html`
      <a href="/app/dashboard" data-nav="/app/dashboard">${icon('grid')}<span>Dashboard</span></a>
      <a href="/app/schedule${state.lastScheduleQuery}" data-nav="/app/schedule">${icon('calendar')}<span>Schedule</span></a>` : ''}
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
        <a class="brand" href="/app/home" data-logo title="Right-click for brand assets">
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
    } else if (state.view === 'dashboard') {
      await loadDashboard();
    } else if (state.view === 'home') {
      state.home = await api('/home');
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
  for (const type of ['clock', 'timeoff', 'revenue']) es.addEventListener(type, refresh);
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
  if (!isManager()) return navigate('/app/home', { replace: true });
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
    ${managerStats(m)}
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
                    <span class="person-meta">${p.role === 'Manager' ? 'Manager · ' : ''}${hrs(t.hours)}${manager ? ` · ${money(t.cost)}` : ` · ${p.title}`}</span>
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
          const now = new Date();
          const clockable = s.staffId === me && !s.clockOut
            && now >= new Date(start.getTime() - 2 * 36e5) && now <= new Date(parse(s.end).getTime() + 2 * 36e5);
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
                ${s.clockIn ? html`<span class="clock-state num">${icon('clock')}Clocked in ${fmt.time.format(parse(s.clockIn))}${s.clockOut ? ` · out ${fmt.time.format(parse(s.clockOut))}` : ''}</span>` : ''}
              </div>
              <div class="card-actions">
                ${clockable ? html`<button type="button" class="btn btn-primary" data-action="clock" data-id="${s.id}">${icon('clock')}${s.clockIn ? 'Clock Out' : 'Clock In'}</button>` : ''}
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
        <p>You’re not rostered on yet. New shifts appear here as soon as your manager adds them.</p>
        <a class="btn" href="/app/home">Go to Home</a>
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

  clock: async (el) => {
    await withLoading(el, async () => {
      try {
        const punch = await api('/clock', { method: 'POST' });
        toast(`Clocked ${punch.kind === 'In' ? 'in' : 'out'} at ${fmt.time.format(parse(punch.at))}.`);
        state.myShifts = await api('/my-shifts');
        renderMyShifts();
        $(`[data-action="clock"][data-id="${el.dataset.id}"]`)?.focus();
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
  },

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

/* --------------------------------------------------------------------------
   Dashboard (managers): tasks, who's in, time clock, wages, weekly planner
   -------------------------------------------------------------------------- */
const WIDGETS = {
  tasks: 'What Should I Work On?',
  who: 'Who’s In Today?',
  feed: 'Live Time Clock Feed',
  wages: 'Live Wage Tracker',
  planner: 'Weekly Planner',
};
const HIDDEN_KEY = 'rostra.dash.hidden';
const dash = { tasks: null, today: null, feed: null, wages: null, week: null, skew: 0, timer: null, observer: null };
const rtf = new Intl.RelativeTimeFormat(locales, { numeric: 'auto' });
const pct1 = new Intl.NumberFormat(locales, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const hourLabel = new Intl.DateTimeFormat(locales, { hour: 'numeric' });

let hiddenWidgets = (() => {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]').filter((k) => k in WIDGETS)); } catch { return new Set(); }
})();
const saveHidden = () => { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenWidgets])); } catch { /* ignore */ } };

/** Venue wall-clock time, from the server (venues can be in a different zone to this browser). */
const venueNow = () => new Date(Date.now() + dash.skew);
const syncClock = (serverNow) => { dash.skew = parse(serverNow) - Date.now(); };
const siteName = (id) => state.me.sites.find((s) => s.id === id)?.name ?? '';
const plural = (n, one, many) => `${fmt.int.format(n)} ${n === 1 ? one : many}`;
const minutesBetween = (a, b) => Math.round((b - a) / 60000);
function duration(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  return `${Math.floor(mins / 60)}h${NBSP}${pad(mins % 60)}m`;
}
function relativeTime(date) {
  const mins = minutesBetween(date, venueNow());
  if (Math.abs(mins) < 60) return rtf.format(-mins, 'minute');
  if (Math.abs(mins) < 60 * 24) return rtf.format(-Math.round(mins / 60), 'hour');
  return rtf.format(-Math.round(mins / 1440), 'day');
}
const dateSpan = (from, to) => from === to
  ? fmt.dayShort.format(parseDay(from))
  : fmt.range.formatRange(parseDay(from), parseDay(to));

/* URL-backed widget filters, so the dashboard deep-links and survives refresh. */
function dashParams() {
  const p = new URLSearchParams(location.search);
  const home = String(state.me.homeSiteId);
  return {
    who: p.get('who') || home,
    feed: p.get('feed') ?? '',
    kinds: (p.get('kinds') ?? 'In,Out').split(',').filter(Boolean),
    wsite: p.get('wsite') ?? home,
    wdate: p.get('wdate') || '',
    wst: p.get('wst') || '',
    psite: p.get('psite') ?? home,
    pweek: Number(p.get('pweek') || 0),
    pmetric: p.get('pmetric') === 'hours' ? 'hours' : 'wages',
    open: new Set((p.get('open') || '').split(',').filter(Boolean)),
  };
}
function setDashParam(key, value) {
  const p = new URLSearchParams(location.search);
  if (value == null) p.delete(key); else p.set(key, value);
  const qs = p.toString();
  history.replaceState(history.state, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
}

const siteOptions = (selected, allLabel) => html`
  ${allLabel ? html`<option value="" ${selected === '' ? raw('selected') : ''}>${allLabel}</option>` : ''}
  ${state.me.sites.map((s) => html`<option value="${s.id}" ${String(s.id) === selected ? raw('selected') : ''}>${s.name}</option>`)}`;
const miniSelect = (id, label, options, key) => html`
  <label class="mini-select" for="${id}"><span class="sr-only">${label}</span>
    <select class="select select-sm" id="${id}" name="${key}" data-dash="${key}">${options}</select>
  </label>`;

function widget(id, tools, body) {
  return html`
    <section class="widget" id="w-${id}" data-widget="${id}" aria-labelledby="w-${id}-title" ${hiddenWidgets.has(id) ? raw('hidden') : ''}>
      <header class="widget-head">
        <h2 id="w-${id}-title">${id === 'wages' ? html`<span class="live-dot is-live" aria-hidden="true"></span>` : ''}${WIDGETS[id]}</h2>
        <div class="widget-tools">
          ${tools}
          <button type="button" class="btn btn-ghost icon-btn btn-sm" data-action="hide-widget" data-widget="${id}" aria-label="Hide ${WIDGETS[id]}">${icon('eye-off')}</button>
        </div>
      </header>
      <div class="error-banner widget-error" id="w-${id}-error" role="alert" hidden></div>
      <div class="widget-body" id="w-${id}-body">${body}</div>
    </section>`;
}
const skeletonRows = (n) => html`<div class="widget-skeleton" aria-busy="true" aria-label="Loading">${[...Array(n)].map(() => html`<span class="skeleton line"></span>`)}</div>`;

async function viewDashboard() {
  if (!isManager()) return navigate('/app/my-shifts', { replace: true });
  state.view = 'dashboard';
  state.render = null;
  document.title = `Dashboard · ${state.me.company.name}`;
  const p = dashParams();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  $('#content').innerHTML = html`
    <header class="page-head">
      <div class="page-title">
        <h1>Dashboard</h1>
        <p class="page-sub">${greeting}, ${state.me.name.split(' ')[0]} · ${fmt.dayLong.format(new Date())}</p>
        <p class="hidden-note" id="hidden-note" aria-live="polite"></p>
      </div>
    </header>
    <div class="dash">
      ${widget('tasks', '', skeletonRows(4))}
      ${widget('who', html`
        ${miniSelect('who-site', 'Site', siteOptions(p.who), 'who')}
        <a class="btn btn-ghost btn-sm" id="who-roster" href="/app/schedule?site=${p.who}">View Roster</a>`,
        skeletonRows(8))}
      ${widget('feed', html`
        <button type="button" class="btn btn-sm" data-action="manual-punch">${icon('plus')}Add Punch…</button>
        ${miniSelect('feed-site', 'Site', siteOptions(p.feed, 'All Sites'), 'feed')}`, html`
        <div class="feed-filters">
          <label class="search" for="feed-search">
            <span class="sr-only">Search the time clock by name</span>${icon('search')}
            <input class="input" id="feed-search" type="search" name="q" placeholder="Search by name…" autocomplete="off" spellcheck="false">
          </label>
          <fieldset class="kind-filter">
            <legend class="sr-only">Show punches</legend>
            <label class="check"><input type="checkbox" name="kind" value="In" ${p.kinds.includes('In') ? raw('checked') : ''}> In</label>
            <label class="check"><input type="checkbox" name="kind" value="Out" ${p.kinds.includes('Out') ? raw('checked') : ''}> Out</label>
          </fieldset>
        </div>
        <ul class="feed" id="feed-list" aria-live="polite" aria-relevant="additions">${skeletonRows(5)}</ul>`)}
      ${widget('wages', html`
        ${miniSelect('wage-site', 'Site', siteOptions(p.wsite, 'All Sites'), 'wsite')}
        ${miniSelect('wage-station', 'Station', html`<option value="">All Stations</option>${STATIONS.map((s) => html`<option value="${s}" ${p.wst === s ? raw('selected') : ''}>${s}</option>`)}`, 'wst')}
        <label class="mini-select" for="wage-date"><span class="sr-only">Day</span>
          <input class="input input-sm num" type="date" id="wage-date" name="wdate" data-dash="wdate" value="${p.wdate}">
        </label>
        <button type="button" class="btn btn-sm" data-action="wage-today">Today</button>
        <button type="button" class="btn btn-ghost icon-btn btn-sm" data-action="fullscreen" aria-pressed="false" aria-label="Full screen">${icon('maximize')}</button>`, html`
        <div class="wt">
          <div class="wt-stats" id="wt-stats">${skeletonRows(6)}</div>
          <div class="wt-plot">
            <div class="wt-chart" id="wt-chart"></div>
            <details class="chart-table" id="wt-table"><summary>Show Data Table</summary><div id="wt-table-body"></div></details>
          </div>
        </div>`)}
      ${widget('planner', html`
        <button type="button" class="btn btn-sm" data-action="upload-revenue">${icon('upload')}Upload…</button>
        ${miniSelect('plan-site', 'Site', siteOptions(p.psite, 'All Sites'), 'psite')}
        ${miniSelect('plan-week', 'Week', html`${[[-1, 'Last Week'], [0, 'This Week'], [1, 'Next Week']].map(([v, l]) => html`<option value="${v}" ${p.pweek === v ? raw('selected') : ''}>${l}</option>`)}`, 'pweek')}
        ${miniSelect('plan-metric', 'Show', html`<option value="wages" ${p.pmetric === 'wages' ? raw('selected') : ''}>Wages</option><option value="hours" ${p.pmetric === 'hours' ? raw('selected') : ''}>Hours</option>`, 'pmetric')}`,
        skeletonRows(6))}
    </div>`.v;

  if (!p.wdate) $('#wage-date').value = ymd(new Date());
  updateHiddenNote();
  dash.observer?.disconnect();
  dash.observer = new ResizeObserver(() => requestAnimationFrame(() => dash.wages && drawWageChart()));
  dash.observer.observe($('#wt-chart'));

  clearInterval(dash.timer);
  dash.timer = setInterval(() => {
    if (state.view !== 'dashboard') return clearInterval(dash.timer);
    loadDashboard(['who', 'wages', 'tasks']);
    renderFeed();
  }, 60000);

  await loadDashboard();
}

const LOADERS = {
  tasks: async () => { dash.tasks = await api('/dashboard/tasks'); renderTasks(); },
  who: async () => {
    dash.today = await api(`/dashboard/today?siteId=${dashParams().who}`);
    syncClock(dash.today.now);
    renderToday();
  },
  feed: async () => {
    const p = dashParams();
    if (!p.kinds.length) { dash.feed = []; return renderFeed(); }
    const q = new URLSearchParams();
    if (p.feed) q.set('siteId', p.feed);
    if (p.kinds.length === 1) q.set('kind', p.kinds[0]);
    const term = $('#feed-search')?.value.trim();
    if (term) q.set('q', term);
    dash.feed = await api(`/clock/feed?${q}`);
    renderFeed();
  },
  wages: async () => {
    const p = dashParams();
    const q = new URLSearchParams({ date: $('#wage-date')?.value || ymd(new Date()) });
    if (p.wsite) q.set('siteId', p.wsite);
    if (p.wst) q.set('station', p.wst);
    $('#w-wages')?.classList.add('is-refreshing');
    dash.wages = await api(`/dashboard/wages?${q}`);
    syncClock(dash.wages.now);
    $('#w-wages')?.classList.remove('is-refreshing');
    renderWages();
  },
  planner: async () => {
    const p = dashParams();
    const week = ymd(addDays(startOfWeek(new Date()), p.pweek * 7));
    const q = new URLSearchParams({ week });
    if (p.psite) q.set('siteId', p.psite);
    dash.week = await api(`/dashboard/week?${q}`);
    renderWeek();
  },
};

async function loadDashboard(only = Object.keys(LOADERS)) {
  await Promise.all(only.filter((id) => !hiddenWidgets.has(id)).map(async (id) => {
    const error = $(`#w-${id}-error`);
    try {
      await LOADERS[id]();
      if (error) error.hidden = true;
    } catch (e) {
      if (e.status === 401 || !error) return;
      error.innerHTML = html`${icon('alert')}<p>${e.message}</p><button type="button" class="btn btn-sm" data-action="reload-widget" data-widget="${id}">Try Again</button>`.v;
      error.hidden = false;
    }
  }));
}

/** Re-rendering a widget the user is tabbing through would steal focus; wait for the next tick instead. */
const busy = (el) => el?.contains(document.activeElement) && document.activeElement !== el && el.dataset.rendered;

function updateHiddenNote() {
  const note = $('#hidden-note');
  if (!note) return;
  note.innerHTML = hiddenWidgets.size
    ? html`${plural(hiddenWidgets.size, 'widget hidden', 'widgets hidden')} · <button type="button" class="link-btn" data-action="show-widgets">Show All</button>`.v
    : '';
}

/* ---------------------------- What should I work on? ---------------------------- */
function renderTasks() {
  const body = $('#w-tasks-body');
  if (!body || !dash.tasks) return;
  const t = dash.tasks;
  const open = dashParams().open;
  const items = [];

  if (t.timeOff.length) items.push({
    key: 'timeoff', icon: 'calendar-x', cta: 'Review Time-Off Requests',
    title: `${plural(t.timeOff.length, 'time-off request needs', 'time-off requests need')} approval.`,
    detail: t.timeOff.map((r) => html`
      <li class="task-row">
        <div class="task-row-text">
          <strong>${r.name}</strong>
          <span class="muted">${dateSpan(r.from, r.to)} · ${r.reason}</span>
          ${r.rosteredShifts ? html`<span class="status is-cost">${icon('alert')}Rostered on ${plural(r.rosteredShifts, 'shift', 'shifts')}</span>` : ''}
        </div>
        <div class="task-row-actions">
          <button type="button" class="btn btn-sm" data-action="timeoff" data-decision="decline" data-id="${r.id}">Decline</button>
          <button type="button" class="btn btn-sm btn-primary" data-action="timeoff" data-decision="approve" data-id="${r.id}">Approve</button>
        </div>
      </li>`),
  });
  if (t.swaps) items.push({
    key: 'swaps', icon: 'swap', href: '/app/swaps', cta: 'Review Swap Requests',
    title: `${plural(t.swaps, 'shift swap needs', 'shift swaps need')} approval.`,
  });
  if (t.late.length) items.push({
    key: 'late', icon: 'clock', cta: 'See Who',
    title: `${plural(t.late.length, 'person hasn’t', 'people haven’t')} clocked in for their shift.`,
    detail: t.late.map((l) => html`
      <li class="task-row"><div class="task-row-text">
        <strong>${l.name}</strong>
        <span class="muted">${siteName(l.siteId)} · due ${fmt.time.format(parse(l.start))}</span>
        <span class="status is-cost">${icon('alert')}${fmt.int.format(Math.max(0, minutesBetween(parse(l.start), venueNow())))}${NBSP}min late</span>
      </div></li>`),
  });
  for (const w of t.nextWeek) {
    const href = `/app/schedule?site=${w.siteId}&week=${t.nextWeekStart}`;
    if (!w.shifts) items.push({ key: `empty-${w.siteId}`, icon: 'calendar', href, cta: 'Start Next Week’s Roster', title: `Next week’s roster at ${w.site} has no shifts yet.` });
    else if (w.cost > w.budget) items.push({ key: `budget-${w.siteId}`, icon: 'dollar', href, cta: 'Open Next Week’s Roster', title: `Next week at ${w.site} is ${money(w.cost - w.budget)} over budget.` });
  }
  if (t.certifications.length) items.push({
    key: 'certs', icon: 'badge', cta: 'Check Certifications',
    title: `${plural(t.certifications.length, 'certification expires', 'certifications expire')} in the next month.`,
    detail: t.certifications.map((c) => {
      const days = Math.round((parseDay(c.expires) - parseDay(ymd(venueNow()))) / 864e5);
      return html`
        <li class="task-row"><div class="task-row-text">
          <strong>${c.name}</strong>
          <span class="muted">${c.certification} · ${c.site}</span>
          <span class="status ${days < 0 ? 'is-danger' : 'is-cost'}">${days < 0 ? 'Expired' : `Expires ${rtf.format(days, 'day')}`} · ${fmt.dayShort.format(parseDay(c.expires))}</span>
        </div></li>`;
    }),
  });

  body.dataset.rendered = '1';
  body.innerHTML = items.length
    ? html`<ul class="tasks">${items.map((it) => html`
        <li class="task">
          <span class="task-icon" aria-hidden="true">${icon(it.icon)}</span>
          <div class="task-body">
            <p class="task-title">${it.title}</p>
            ${it.href
              ? html`<a class="task-link" href="${it.href}">${it.cta}${icon('right')}</a>`
              : html`
                <button type="button" class="task-link" data-action="toggle-task" data-key="${it.key}" aria-expanded="${open.has(it.key)}" aria-controls="task-${it.key}">${it.cta}${icon('down')}</button>
                <ul class="task-detail" id="task-${it.key}" ${open.has(it.key) ? '' : raw('hidden')}>${it.detail}</ul>`}
          </div>
        </li>`)}</ul>`.v
    : html`<div class="widget-empty">${icon('check')}<p><strong>You’re all caught up.</strong> New requests appear here the moment they arrive.</p></div>`.v;
}

/* ---------------------------- Who's in today? ---------------------------- */
function renderToday() {
  const body = $('#w-who-body');
  if (!body || !dash.today || busy(body)) return;
  const d = dash.today;
  const now = parse(d.now);
  const groups = { coming: [], atWork: [], finished: [], missed: [] };
  for (const s of d.shifts) {
    if (s.clockOut) groups.finished.push(s);
    else if (s.clockIn) groups.atWork.push(s);
    else if (parse(s.end) <= now) groups.missed.push(s);
    else groups.coming.push(s);
  }
  groups.atWork.sort((a, b) => parse(a.clockIn) - parse(b.clockIn));
  groups.finished.sort((a, b) => parse(b.clockOut) - parse(a.clockOut));
  const open = dashParams().open;
  const section = (key, title, list, empty) => {
    if (!list.length && !empty) return '';
    const all = open.has(`who-${key}`);
    const shown = all ? list : list.slice(0, 6);
    return html`
      <section class="who-section" aria-labelledby="who-${key}">
        <h3 class="who-head" id="who-${key}"><span class="num">${fmt.int.format(list.length)}</span> ${title}</h3>
        ${list.length ? html`<ol class="who-list">${shown.map((s) => whoRow(s, now))}</ol>` : html`<p class="who-empty">${empty}</p>`}
        ${list.length > 6 ? html`<button type="button" class="link-btn who-more" data-action="toggle-task" data-key="who-${key}" aria-expanded="${all}">${all ? 'Show Fewer' : `Show All ${fmt.int.format(list.length)}`}</button>` : ''}
      </section>`;
  };

  $('#who-roster')?.setAttribute('href', `/app/schedule?site=${d.site.id}`);
  body.dataset.rendered = '1';
  body.innerHTML = d.shifts.length || d.onLeave.length ? html`
    ${section('coming', 'Coming Up', groups.coming, 'Everyone due has started their shift.')}
    ${section('atwork', 'At Work', groups.atWork, 'No one is clocked in right now.')}
    ${section('finished', 'Finished', groups.finished)}
    ${section('missed', 'Didn’t Clock In', groups.missed)}
    <section class="who-section" aria-labelledby="who-leave">
      <h3 class="who-head" id="who-leave"><span class="num">${fmt.int.format(d.onLeave.length)}</span> On Leave</h3>
      ${d.onLeave.length ? html`<ul class="leave-list">${d.onLeave.map((l) => html`<li><span class="avatar" aria-hidden="true">${initials(l.name)}</span><span><strong>${l.name}</strong><span class="muted"> · ${l.reason}, back after ${fmt.dayShort.format(parseDay(l.to))}</span></span></li>`)}</ul>` : html`<p class="who-empty">No one is on leave today.</p>`}
    </section>` : html`
    <div class="widget-empty">${icon('calendar')}<p><strong>No one is rostered at ${d.site.name} today.</strong></p>
      <a class="btn btn-sm" href="/app/schedule?site=${d.site.id}">Open the Roster</a></div>`;
}

function whoRow(s, now) {
  const start = parse(s.start);
  const end = parse(s.end);
  let state, time, meta, pill = '';
  if (s.clockOut) {
    state = 'finished';
    time = duration(parse(s.clockOut) - parse(s.clockIn));
    meta = `${fmt.time.format(parse(s.clockIn))} – ${fmt.time.format(parse(s.clockOut))}`;
  } else if (s.clockIn) {
    state = 'atwork';
    time = fmt.time.format(parse(s.clockIn));
    meta = `${s.station} · until ${fmt.time.format(end)}`;
    pill = html`<span class="status is-save">On for ${duration(now - parse(s.clockIn))}</span>`;
  } else if (end <= now) {
    state = 'missed';
    time = fmt.time.format(start);
    meta = `Rostered ${compact(s.start, s.end)}`;
    pill = html`<span class="status is-danger">${icon('alert')}No punch</span>`;
  } else if (start <= now) {
    state = 'late';
    time = fmt.time.format(start);
    meta = `${s.station} · ${compact(s.start, s.end)}`;
    pill = html`<span class="status is-cost">${icon('alert')}${fmt.int.format(minutesBetween(start, now))}${NBSP}min late</span>`;
  } else {
    state = 'upcoming';
    time = fmt.time.format(start);
    meta = `${s.station} · ${compact(s.start, s.end)}`;
  }
  return html`
    <li class="who-row is-${state}">
      <span class="who-time num">${time}</span>
      <span class="who-node" aria-hidden="true"></span>
      <div class="who-card" data-station="${s.station}">
        <span class="station-dot" aria-hidden="true"></span>
        <span class="who-text"><span class="who-name">${s.name}</span><span class="who-meta num">${meta}</span></span>
        ${pill}
      </div>
    </li>`;
}

/* ---------------------------- Live time clock feed ---------------------------- */
function renderFeed() {
  const list = $('#feed-list');
  if (!list || !dash.feed || busy(list)) return;
  const p = dashParams();
  const term = $('#feed-search')?.value.trim();
  list.dataset.rendered = '1';
  if (!p.kinds.length) {
    list.innerHTML = html`<li class="widget-empty"><p>Tick <strong>In</strong> or <strong>Out</strong> to see punches.</p></li>`.v;
    return;
  }
  if (!dash.feed.length) {
    list.innerHTML = html`<li class="widget-empty">${icon('clock')}<p>${term ? `No punches match “${term}”.` : 'No punches yet. They appear here as staff clock in.'}</p></li>`.v;
    return;
  }
  list.innerHTML = dash.feed.map((e) => {
    const at = parse(e.at);
    let note = '';
    if (e.kind === 'In' && e.shiftStart) {
      const late = minutesBetween(parse(e.shiftStart), at);
      note = late > 5 ? html`<span class="status is-cost">${fmt.int.format(late)}${NBSP}min late</span>` : html`<span class="muted">On time</span>`;
    } else if (e.kind === 'Out' && e.shiftEnd) {
      const over = minutesBetween(parse(e.shiftEnd), at);
      note = over > 5 ? html`<span class="muted">${fmt.int.format(over)}${NBSP}min over</span>` : '';
    }
    return html`
      <li class="feed-item">
        <span class="avatar" aria-hidden="true">${initials(e.name)}</span>
        <div class="feed-text">
          <p class="feed-who"><strong>${e.name}</strong> <span class="muted">${e.site}</span></p>
          <p class="feed-when">
            <span class="status ${e.kind === 'In' ? 'is-save' : ''}">${e.kind === 'In' ? 'In' : 'Out'}</span>
            <time class="feed-clock num" datetime="${e.at}">${fmt.time.format(at)}</time>
            <span class="muted">${relativeTime(at)}</span>
            ${note}
          </p>
          ${e.source === 'Manager' ? html`<p class="muted feed-source">Added by a manager</p>` : ''}
        </div>
      </li>`.v;
  }).join('');
}

/* ---------------------------- Live wage tracker ---------------------------- */
function renderWages() {
  const stats = $('#wt-stats');
  const w = dash.wages;
  if (!stats || !w) return;
  const v = w.soFar;
  const variance = (actual, planned, format) => {
    const diff = actual - planned;
    const ratio = planned ? Math.abs(diff) / planned : 0;
    if (Math.abs(diff) < 0.005 * Math.max(planned, 1)) return html`<dd class="num">On plan</dd>`;
    return html`<dd class="num ${diff > 0 ? 'is-over' : 'is-under'}">${diff > 0 ? '+' : '−'}${format(Math.abs(diff))} (${pct1.format(ratio)}) ${diff > 0 ? 'over' : 'under'}</dd>`;
  };
  const date = parseDay(w.date);
  stats.innerHTML = html`
    <p class="wt-label">${w.isToday ? 'Day So Far' : w.isFuture ? `Rostered · ${fmt.dayShort.format(date)}` : fmt.dayShort.format(date)}</p>
    ${w.isFuture ? html`
      <dl class="wt-group">
        <div class="wt-big"><dt>Rostered Cost</dt><dd class="num">${money(w.day.rosteredCost)}</dd></div>
        <div class="wt-row"><dt>Rostered Hours</dt><dd class="num">${hrs(w.day.rosteredHours)}</dd></div>
        <div class="wt-row"><dt>Shifts</dt><dd class="num">${fmt.int.format(w.day.shifts)}</dd></div>
      </dl>` : html`
      <dl class="wt-group">
        <div class="wt-big"><dt>Wage Cost</dt><dd class="num">${money(v.actualCost)}</dd></div>
        <div class="wt-row"><dt>Rostered</dt><dd class="num">${money(v.rosteredCost)}</dd></div>
        <div class="wt-row"><dt>Variance</dt>${variance(v.actualCost, v.rosteredCost, money)}</div>
      </dl>
      <dl class="wt-group">
        <div class="wt-big"><dt>Worked Hours</dt><dd class="num">${hrs(v.actualHours)}</dd></div>
        <div class="wt-row"><dt>Rostered</dt><dd class="num">${hrs(v.rosteredHours)}</dd></div>
        <div class="wt-row"><dt>Variance</dt>${variance(v.actualHours, v.rosteredHours, hrs)}</div>
      </dl>
      <p class="muted wt-foot">Whole day rostered: <span class="num">${money(w.day.rosteredCost)} · ${hrs(w.day.rosteredHours)}</span></p>`}
    <ul class="wt-legend" aria-label="Chart legend">
      ${w.isFuture ? '' : html`<li><span class="key key-actual" aria-hidden="true"></span>Staff on shift</li>`}
      <li><span class="key key-rostered" aria-hidden="true"></span>Rostered</li>
    </ul>`.v;
  drawWageChart();
  renderWageTable();
}

function wagePoints() {
  return dash.wages.points.map((p) => ({ t: parse(p.t), r: p.rostered, a: p.actual }));
}

function renderWageTable() {
  const el = $('#wt-table-body');
  if (!el) return;
  const pts = wagePoints().filter((p) => p.t.getMinutes() === 0);
  el.innerHTML = pts.length ? html`
    <table class="data-table">
      <thead><tr><th scope="col">Time</th><th scope="col">On shift</th><th scope="col">Rostered</th></tr></thead>
      <tbody>${pts.map((p) => html`<tr><th scope="row">${fmt.time.format(p.t)}</th><td class="num">${p.a ?? '—'}</td><td class="num">${p.r}</td></tr>`)}</tbody>
    </table>`.v : '';
}

function drawWageChart() {
  const el = $('#wt-chart');
  const w = dash.wages;
  if (!el || !w) return;
  const pts = wagePoints();
  if (!pts.length) {
    el.innerHTML = html`<div class="widget-empty">${icon('calendar')}<p>No shifts are rostered${$('#wage-station')?.value ? ' for this station' : ''} on this day.</p></div>`.v;
    return;
  }
  const width = Math.max(260, el.clientWidth);
  const height = Math.max(200, el.clientHeight || 250);
  const m = { l: 34, r: 18, t: 26, b: 26 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const t0 = pts[0].t.getTime();
  const t1 = pts.at(-1).t.getTime();
  const x = (t) => m.l + ((t - t0) / (t1 - t0 || 1)) * iw;
  const peak = Math.max(1, ...pts.map((p) => Math.max(p.r, p.a ?? 0)));
  const step = peak <= 6 ? 1 : peak <= 12 ? 2 : peak <= 30 ? 5 : 10;
  const yMax = Math.ceil(peak / step) * step;
  const y = (v) => m.t + ih - (v / yMax) * ih;
  const cutoff = parse(w.cutoff).getTime();

  const stepPath = (key) => {
    let d = '';
    let lastX = null;
    for (const p of pts) {
      const v = p[key];
      if (v == null) break;
      const px = x(p.t.getTime()).toFixed(1);
      const py = y(v).toFixed(1);
      d += d ? `H${px}V${py}` : `M${px},${py}`;
      lastX = px;
    }
    // Hold the live line flat up to "now" rather than stopping at the last 15-minute sample.
    if (key === 'a' && d && w.isToday && cutoff > t0 && cutoff < t1) d += `H${x(cutoff).toFixed(1)}`;
    return { d, lastX };
  };
  const rostered = stepPath('r');
  const actual = w.isFuture ? { d: '' } : stepPath('a');

  const yTicks = [];
  for (let v = 0; v <= yMax; v += step) yTicks.push(v);
  const spanHours = (t1 - t0) / 36e5;
  const every = spanHours > 12 ? 3 : spanHours > 6 ? 2 : 1;
  const xTicks = [];
  for (let t = new Date(t0); t.getTime() <= t1; t = new Date(t.getTime() + 36e5)) {
    if (t.getMinutes() === 0 && t.getHours() % every === 0) xTicks.push(new Date(t));
  }
  const lastActual = [...pts].reverse().find((p) => p.a != null);
  const showNow = w.isToday && cutoff >= t0 && cutoff <= t1;
  const peakActual = Math.max(0, ...pts.map((p) => p.a ?? 0));

  el.innerHTML = html`
    <svg class="wt-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"
         aria-label="Staff on shift compared with rostered, ${fmt.dayLong.format(parseDay(w.date))}. Peak ${peakActual} on shift, ${Math.max(...pts.map((p) => p.r))} rostered.">
      <text class="axis-title" x="${m.l - 26}" y="12">Staff</text>
      ${yTicks.map((v) => html`
        <line class="grid-line" x1="${m.l}" x2="${width - m.r}" y1="${y(v)}" y2="${y(v)}"></line>
        <text class="axis-label" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`)}
      ${xTicks.map((t) => html`<text class="axis-label" x="${x(t.getTime())}" y="${height - 6}" text-anchor="middle">${hourLabel.format(t)}</text>`)}
      <path class="line-rostered" d="${rostered.d}"></path>
      ${actual.d ? html`<path class="line-actual" d="${actual.d}"></path>` : ''}
      ${showNow ? html`
        <line class="now-line" x1="${x(cutoff)}" x2="${x(cutoff)}" y1="${m.t - 6}" y2="${m.t + ih}"></line>
        <text class="now-label" x="${Math.min(x(cutoff), width - m.r - 4)}" y="${m.t - 10}" text-anchor="${x(cutoff) > width - 90 ? 'end' : 'middle'}">Now ${fmt.time.format(new Date(cutoff))}</text>` : ''}
      ${lastActual && !w.isFuture ? html`<text class="direct-label" x="${Math.min(x(showNow ? cutoff : lastActual.t.getTime()) + 6, width - m.r)}" y="${y(lastActual.a) - 6}" text-anchor="${(showNow ? x(cutoff) : x(lastActual.t.getTime())) > width - 70 ? 'end' : 'start'}">${lastActual.a} on shift</text>` : ''}
      <g class="hover-layer" hidden>
        <line class="crosshair" y1="${m.t}" y2="${m.t + ih}"></line>
        <circle class="dot-rostered" r="4"></circle>
        <circle class="dot-actual" r="4"></circle>
      </g>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" tabindex="0" focusable="true"
            aria-label="Explore the chart. Use the left and right arrow keys to move through the day."></rect>
    </svg>
    <div class="chart-tip" role="status" hidden></div>`.v;

  const svg = $('svg', el);
  const layer = $('.hover-layer', svg);
  const tip = $('.chart-tip', el);
  const hit = $('.hit', svg);
  let index = lastActual ? pts.indexOf(lastActual) : 0;
  const show = (i) => {
    index = Math.max(0, Math.min(pts.length - 1, i));
    const p = pts[index];
    const px = x(p.t.getTime());
    layer.hidden = false;
    $('.crosshair', layer).setAttribute('x1', px);
    $('.crosshair', layer).setAttribute('x2', px);
    const dr = $('.dot-rostered', layer);
    dr.setAttribute('cx', px); dr.setAttribute('cy', y(p.r));
    const da = $('.dot-actual', layer);
    da.style.setProperty('display', p.a == null ? 'none' : '');
    if (p.a != null) { da.setAttribute('cx', px); da.setAttribute('cy', y(p.a)); }
    tip.innerHTML = html`
      <p class="tip-time">${fmt.time.format(p.t)}</p>
      ${p.a != null ? html`<p class="tip-row"><span class="key key-actual" aria-hidden="true"></span><strong class="num">${p.a}</strong><span>on shift</span></p>` : ''}
      <p class="tip-row"><span class="key key-rostered" aria-hidden="true"></span><strong class="num">${p.r}</strong><span>rostered</span></p>`.v;
    tip.hidden = false;
    const tipWidth = tip.offsetWidth;
    tip.style.setProperty('left', `${Math.max(4, px + 12 + tipWidth > width ? px - tipWidth - 12 : px + 12)}px`);
    tip.style.setProperty('top', `${m.t}px`);
  };
  const hide = () => { layer.hidden = true; tip.hidden = true; };
  hit.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect();
    const t = t0 + ((e.clientX - box.left - m.l) / iw) * (t1 - t0);
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(p.t - t) < Math.abs(pts[best].t - t)) best = i; });
    show(best);
  });
  hit.addEventListener('pointerleave', () => { if (document.activeElement !== hit) hide(); });
  hit.addEventListener('focus', () => show(index));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(index + (e.key === 'ArrowRight' ? 1 : -1)); }
    else if (e.key === 'Home') { e.preventDefault(); show(0); }
    else if (e.key === 'End') { e.preventDefault(); show(pts.length - 1); }
    else if (e.key === 'Escape') hide();
  });
}

/* ---------------------------- Weekly planner ---------------------------- */
function renderWeek() {
  const body = $('#w-planner-body');
  if (!body || !dash.week) return;
  const hoursMode = dashParams().pmetric === 'hours';
  const days = dash.week.days;
  const done = (d) => d.actualCost != null && !d.isToday;
  const planned = (d) => (hoursMode ? d.rosteredHours : d.rosteredCost);
  const actual = (d) => (hoursMode ? d.actualHours : d.actualCost);
  const show = (n) => (hoursMode ? hrs(n) : money(n));
  const signed = (n) => `${n > 0.004 ? '+' : n < -0.004 ? '−' : ''}${show(Math.abs(n))}`;
  const ratio = (cost, hours, revenue) => {
    if (hoursMode) return hours ? money(revenue / hours) : '—';
    return revenue ? pct1.format(cost / revenue) : '—';
  };
  const sum = (list, f) => list.reduce((s, d) => s + (f(d) ?? 0), 0);
  const completed = days.filter(done);
  const started = days.filter((d) => d.actualCost != null);
  const withRevenue = days.filter((d) => d.actualRevenue != null && done(d));
  const totalVariance = sum(completed, actual) - sum(completed, planned);
  const today = days.find((d) => d.isToday);

  body.innerHTML = html`
    <div class="planner-scroll" role="region" aria-label="Weekly planner, week of ${fmt.dayLong.format(parseDay(dash.week.weekStart))}" tabindex="0">
      <table class="planner">
        <thead><tr>
          <th scope="col"><span class="sr-only">Measure</span></th>
          ${days.map((d) => html`<th scope="col" class="${d.isToday ? 'is-today' : ''}" ${d.isToday ? raw('aria-current="date"') : ''} aria-label="${fmt.dayLong.format(parseDay(d.date))}">${fmt.dow.format(parseDay(d.date))}<small>${fmt.dayNum.format(parseDay(d.date))}</small></th>`)}
          <th scope="col" class="total">Total</th>
        </tr></thead>
        <tbody>
          <tr><th scope="row">Roster</th>
            ${days.map((d) => html`<td class="num ${d.isToday ? 'is-today' : ''}">${show(planned(d))}</td>`)}
            <td class="num total">${show(sum(days, planned))}</td></tr>
          <tr><th scope="row">Actual</th>
            ${days.map((d) => html`<td class="num ${d.isToday ? 'is-today' : ''}">${actual(d) == null ? html`<span class="muted">—</span>` : html`${show(actual(d))}${d.isToday ? html`<span aria-hidden="true">*</span><span class="sr-only"> so far</span>` : ''}`}</td>`)}
            <td class="num total">${started.length ? html`${show(sum(started, actual))}${today?.actualCost != null ? raw('<span aria-hidden="true">*</span>') : ''}` : '—'}</td></tr>
          <tr class="group-end"><th scope="row">Variance</th>
            ${days.map((d) => {
              if (!done(d)) return html`<td class="num ${d.isToday ? 'is-today' : ''}"><span class="muted">—</span></td>`;
              const diff = actual(d) - planned(d);
              return html`<td class="num ${diff > 0 ? 'is-over' : 'is-under'}">${signed(diff)}</td>`;
            })}
            <td class="num total ${completed.length ? (totalVariance > 0 ? 'is-over' : 'is-under') : ''}">${completed.length ? signed(totalVariance) : '—'}</td></tr>
          <tr><th scope="row">Revenue</th>
            ${days.map((d) => html`<td class="num ${d.isToday ? 'is-today' : ''}">${d.actualRevenue != null ? money(d.actualRevenue) : html`<span class="muted">—</span>`}</td>`)}
            <td class="num total">${withRevenue.length ? money(sum(withRevenue, (d) => d.actualRevenue)) : '—'}</td></tr>
          <tr class="is-forecast group-end"><th scope="row">Forecast</th>
            ${days.map((d) => html`<td class="num ${d.isToday ? 'is-today' : ''}">${money(d.forecastRevenue)}</td>`)}
            <td class="num total">${money(sum(days, (d) => d.forecastRevenue))}</td></tr>
          <tr><th scope="row">${hoursMode ? 'Sales per Labour Hour' : 'Wage % of Revenue'}</th>
            ${days.map((d) => html`<td class="num ${d.isToday ? 'is-today' : ''}">${done(d) && d.actualRevenue != null ? ratio(d.actualCost, d.actualHours, d.actualRevenue) : html`<span class="muted">—</span>`}</td>`)}
            <td class="num total">${withRevenue.length ? ratio(sum(withRevenue, (d) => d.actualCost), sum(withRevenue, (d) => d.actualHours), sum(withRevenue, (d) => d.actualRevenue)) : '—'}</td></tr>
          <tr class="is-forecast"><th scope="row">Forecast</th>
            ${days.map((d) => html`<td class="num ${d.isToday ? 'is-today' : ''}">${ratio(d.rosteredCost, d.rosteredHours, d.forecastRevenue)}</td>`)}
            <td class="num total">${ratio(sum(days, (d) => d.rosteredCost), sum(days, (d) => d.rosteredHours), sum(days, (d) => d.forecastRevenue))}</td></tr>
        </tbody>
      </table>
    </div>
    <p class="planner-note muted">${today ? '* Today so far. ' : ''}Variance and actual ratios cover completed days. Weekend rates (Sat ×${state.penalties.saturday}, Sun ×${state.penalties.sunday}) are included.</p>`.v;
}

/* ---------------------------- Dialogs ---------------------------- */
function openManualPunch(returnTo) {
  const d = dash.today;
  const shifts = (d?.shifts ?? []).filter((s) => !s.clockOut);
  const now = venueNow();
  const nextKind = (s) => (s?.clockIn ? 'Out' : 'In');
  openDialog(html`
    <form class="dialog-form" id="punch-form" novalidate data-track-changes>
      ${dialogHead('Add a Punch', d ? `For someone at ${d.site.name} who couldn’t use the clock.` : '')}
      <div class="dialog-body">
        ${shifts.length ? html`
          <div class="field">
            <label for="p-staff">Team Member</label>
            <select class="select" id="p-staff" name="staffId" data-field="staffId" data-autofocus>
              ${shifts.map((s) => html`<option value="${s.staffId}" data-kind="${nextKind(s)}">${s.name} — ${compact(s.start, s.end)}${s.clockIn ? ' (clocked in)' : ''}</option>`)}
            </select>
            ${errorSlot('staffId', 'p-staff-error')}
          </div>
          <fieldset class="options">
            <legend>Punch</legend>
            <div class="row-2">
              <label class="option"><input type="radio" name="kind" value="In" data-field="kind" ${nextKind(shifts[0]) === 'In' ? raw('checked') : ''}><span class="option-text"><strong>Clock In</strong></span></label>
              <label class="option"><input type="radio" name="kind" value="Out" ${nextKind(shifts[0]) === 'Out' ? raw('checked') : ''}><span class="option-text"><strong>Clock Out</strong></span></label>
            </div>
            ${errorSlot('kind', 'p-kind-error')}
          </fieldset>
          <div class="field">
            <label for="p-time">Time</label>
            <input class="input num" id="p-time" name="time" type="time" step="60" value="${timeValue(now)}" data-field="at">
            <p class="field-hint">Today, ${fmt.dayLong.format(now)}.</p>
            ${errorSlot('at', 'p-time-error')}
          </div>
          <p class="form-error" data-error-for="_" role="alert" hidden tabindex="-1"></p>` : html`
          <p class="muted">Everyone rostered at ${d?.site.name ?? 'this site'} today has already clocked out, or no one is rostered. Add their shift on the schedule first.</p>`}
      </div>
      <div class="dialog-foot"><span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        ${shifts.length ? html`<button type="submit" class="btn btn-primary">Save Punch</button>` : ''}
      </div>
    </form>`, { returnTo });

  const form = $('#punch-form', dialog);
  if (!shifts.length) return;
  form.staffId.addEventListener('change', () => {
    const kind = form.staffId.selectedOptions[0].dataset.kind;
    form.querySelector(`input[name="kind"][value="${kind}"]`).checked = true;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    if (!form.time.value) return showErrors(form, { at: 'Enter the time they started or finished.' });
    const [hh, mm] = form.time.value.split(':').map(Number);
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm);
    const kind = form.querySelector('input[name="kind"]:checked').value;
    await withLoading(e.submitter, async () => {
      try {
        await api('/clock/manual', { method: 'POST', body: { staffId: Number(form.staffId.value), kind, at: isoLocal(at) } });
        const name = shifts.find((s) => s.staffId === Number(form.staffId.value))?.name;
        closeDialog({ force: true });
        toast(`${name} clocked ${kind === 'In' ? 'in' : 'out'} at ${fmt.time.format(at)}.`);
        loadDashboard(['who', 'feed', 'wages', 'planner', 'tasks']);
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

function parseRevenueCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors = [];
  if (!lines.length) return { rows: [], errors: ['The file is empty. Export a CSV with a date column and a forecast or actual column.'] };
  const cells = (line) => line.split(',').map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
  let header = cells(lines[0]).map((h) => h.toLowerCase());
  let first = 1;
  if (!header.includes('date')) { header = ['date', 'forecast', 'actual']; first = 0; }
  const col = {
    date: header.indexOf('date'),
    forecast: header.findIndex((h) => h.startsWith('forecast')),
    actual: header.findIndex((h) => h.startsWith('actual') || h === 'revenue' || h === 'sales'),
  };
  if (col.forecast < 0 && col.actual < 0) return { rows: [], errors: ['Add a “forecast” or “actual” column next to “date”.'] };
  const toDate = (s) => {
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // DD/MM/YYYY, as Australian POS exports write it
    return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : null;
  };
  const toNumber = (s) => {
    const clean = (s ?? '').replace(/[$\s,]/g, '');
    if (!clean) return null;
    const n = Number(clean);
    return Number.isFinite(n) ? n : NaN;
  };
  const rows = [];
  lines.slice(first).forEach((line, i) => {
    const c = cells(line);
    const lineNo = i + first + 1;
    const date = toDate(c[col.date] ?? '');
    if (!date) return errors.push(`Line ${lineNo}: “${c[col.date] ?? ''}” isn’t a date. Use 2026-10-05 or 05/10/2026.`);
    const forecast = col.forecast >= 0 ? toNumber(c[col.forecast]) : null;
    const actual = col.actual >= 0 ? toNumber(c[col.actual]) : null;
    if (Number.isNaN(forecast) || Number.isNaN(actual)) return errors.push(`Line ${lineNo}: amounts must be plain numbers, like 4520.50.`);
    if (forecast == null && actual == null) return;
    rows.push({ date, forecast, actual });
  });
  return { rows, errors };
}

function openRevenueUpload(returnTo) {
  const p = dashParams();
  const siteId = p.psite || String(state.me.homeSiteId);
  openDialog(html`
    <form class="dialog-form" id="revenue-form" novalidate data-track-changes>
      ${dialogHead('Upload Revenue', 'Add forecast or actual takings from your POS export.')}
      <div class="dialog-body">
        <div class="field">
          <label for="rv-site">Site</label>
          <select class="select" id="rv-site" name="siteId" data-field="siteId">${siteOptions(siteId)}</select>
          ${errorSlot('siteId', 'rv-site-error')}
        </div>
        <div class="field">
          <label for="rv-file">CSV File</label>
          <input class="input" id="rv-file" name="file" type="file" accept=".csv,text/csv" data-field="file" data-autofocus>
          <p class="field-hint">Columns: <code translate="no">date,forecast,actual</code>. Dates like <code translate="no">2026-10-05</code> or <code translate="no">05/10/2026</code>. Leave a cell empty to keep what’s there.</p>
          ${errorSlot('file', 'rv-file-error')}
        </div>
        <p class="muted" id="rv-summary" aria-live="polite"></p>
        <a class="task-link" id="rv-template" href="#" download="rostra-revenue-template.csv">${icon('down')}Download a Template for This Week</a>
        <p class="form-error" data-error-for="_" role="alert" hidden tabindex="-1"></p>
      </div>
      <div class="dialog-foot"><span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">${icon('upload')}Upload Revenue</button>
      </div>
    </form>`, { returnTo });

  const form = $('#revenue-form', dialog);
  const days = dash.week?.days ?? [];
  const template = ['date,forecast,actual', ...days.map((d) => `${d.date},${d.forecastRevenue.toFixed(2)},${d.actualRevenue != null ? d.actualRevenue.toFixed(2) : ''}`)].join('\n');
  const url = URL.createObjectURL(new Blob([template + '\n'], { type: 'text/csv' }));
  $('#rv-template', form).href = url;
  dialog.addEventListener('close', () => URL.revokeObjectURL(url), { once: true });

  let parsed = null;
  form.file.addEventListener('change', async () => {
    clearErrors(form);
    const file = form.file.files[0];
    parsed = file ? parseRevenueCsv(await file.text()) : null;
    $('#rv-summary', form).textContent = parsed
      ? `${plural(parsed.rows.length, 'day', 'days')} ready to upload${parsed.errors.length ? `, ${plural(parsed.errors.length, 'line', 'lines')} skipped` : ''}.`
      : '';
    if (parsed?.errors.length) showErrors(form, { file: parsed.errors.slice(0, 3).join(' ') });
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    if (!parsed) return showErrors(form, { file: 'Choose a CSV file to upload.' });
    if (!parsed.rows.length) return showErrors(form, { file: parsed.errors[0] || 'No rows with amounts were found in that file.' });
    await withLoading(e.submitter, async () => {
      try {
        const site = Number(form.siteId.value);
        await api('/revenue', { method: 'POST', body: { siteId: site, rows: parsed.rows } });
        closeDialog({ force: true });
        toast(`Updated revenue for ${plural(parsed.rows.length, 'day', 'days')} at ${siteName(site)}.`);
        loadDashboard(['planner']);
      } catch (err) {
        if (err.errors) return showErrors(form, fromServer({ ...err.errors, file: err.errors.rows }));
        const general = $('[data-error-for="_"]', form);
        general.innerHTML = html`${icon('alert')}<span>${err.message}</span>`.v;
        general.hidden = false;
        general.focus();
      }
    });
  });
}

/* ---------------------------- Dashboard controls ---------------------------- */
const RELOAD_FOR = { who: ['who'], feed: ['feed'], wsite: ['wages'], wst: ['wages'], wdate: ['wages'], psite: ['planner'], pweek: ['planner'], pmetric: [] };
document.addEventListener('change', (e) => {
  if (state.view !== 'dashboard') return;
  const key = e.target.dataset.dash;
  if (key) {
    const value = e.target.value;
    setDashParam(key, key === 'wdate' && value === ymd(new Date()) ? null : value);
    if (key === 'pmetric') return renderWeek();
    loadDashboard(RELOAD_FOR[key]);
  } else if (e.target.name === 'kind' && e.target.closest('.kind-filter')) {
    const kinds = $$('.kind-filter input:checked').map((i) => i.value);
    setDashParam('kinds', kinds.join(','));
    loadDashboard(['feed']);
  }
});
let feedSearchTimer;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'feed-search') return;
  clearTimeout(feedSearchTimer);
  feedSearchTimer = setTimeout(() => loadDashboard(['feed']), 220);
});
document.addEventListener('fullscreenchange', () => {
  const button = $('[data-action="fullscreen"]');
  if (!button) return;
  const on = document.fullscreenElement?.id === 'w-wages';
  button.setAttribute('aria-pressed', String(on));
  button.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
});

Object.assign(actions, {
  'reload-widget': (el) => loadDashboard([el.dataset.widget]),
  'manual-punch': (el) => openManualPunch(el),
  'upload-revenue': (el) => openRevenueUpload(el),
  'wage-today': () => {
    $('#wage-date').value = ymd(new Date());
    setDashParam('wdate', null);
    loadDashboard(['wages']);
  },
  fullscreen: () => {
    const el = $('#w-wages');
    if (document.fullscreenElement) document.exitFullscreen();
    else el?.requestFullscreen?.().catch(() => toast('Full screen isn’t available in this browser.', { tone: 'error' }));
  },
  'toggle-task': (el) => {
    const open = dashParams().open;
    const key = el.dataset.key;
    if (open.has(key)) open.delete(key); else open.add(key);
    setDashParam('open', open.size ? [...open].join(',') : null);
    if (key.startsWith('who-')) {
      delete $('#w-who-body').dataset.rendered;
      renderToday();
      $(`[data-key="${key}"]`)?.focus();
      return;
    }
    el.setAttribute('aria-expanded', String(open.has(key)));
    $(`#task-${key}`).hidden = !open.has(key);
  },
  'hide-widget': (el) => {
    const id = el.dataset.widget;
    hiddenWidgets.add(id);
    saveHidden();
    $(`#w-${id}`).hidden = true;
    updateHiddenNote();
    $('#main').focus({ preventScroll: true });
    toast(`${WIDGETS[id]} hidden.`, { action: 'Undo', onAction: () => showWidgets([id]) });
  },
  'show-widgets': () => showWidgets([...hiddenWidgets]),
  timeoff: async (el) => {
    const id = Number(el.dataset.id);
    const approve = el.dataset.decision === 'approve';
    const request = dash.tasks.timeOff.find((r) => r.id === id);
    if (!request) return;
    const before = structuredClone(dash.tasks);
    dash.tasks.timeOff = dash.tasks.timeOff.filter((r) => r.id !== id);
    renderTasks();
    ($('[data-action="timeoff"]') || $('#w-tasks-title'))?.focus?.();
    try {
      await api(`/time-off/${id}/${approve ? 'approve' : 'decline'}`, { method: 'POST' });
      toast(approve
        ? `Approved ${request.name}’s time off, ${dateSpan(request.from, request.to)}.${request.rosteredShifts ? ' Their rostered shifts still need cover.' : ''}`
        : `Declined ${request.name}’s time-off request.`);
    } catch (e) {
      dash.tasks = before;
      renderTasks();
      toast(e.message, { tone: 'error' });
    }
  },
});

function showWidgets(ids) {
  ids.forEach((id) => { hiddenWidgets.delete(id); const el = $(`#w-${id}`); if (el) el.hidden = false; });
  saveHidden();
  updateHiddenNote();
  loadDashboard(ids);
}

/* --------------------------------------------------------------------------
   Home: next shift, this week's pay, notifications, availability & leave
   -------------------------------------------------------------------------- */
const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const payFormats = new Map();
// Pay is personal, so it shows cents, and does so everywhere on this page.
function pay(n) {
  const currency = state.me?.company.currency || 'AUD';
  if (!payFormats.has(currency))
    payFormats.set(currency, new Intl.NumberFormat(locales, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  return payFormats.get(currency).format(n);
}
const monthShort = new Intl.DateTimeFormat(locales, { month: 'short' });
const dayName = (key) => fmt.dow.format(addDays(new Date(2024, 0, 1), DAY_KEYS.indexOf(key))); // 1 Jan 2024 was a Monday

async function viewHome() {
  state.view = 'home';
  state.render = renderHome;
  document.title = `Home · ${state.me.company.name}`;
  const content = $('#content');
  try {
    const [home] = await withSkeleton(content, homeSkeleton(), () => Promise.all([api('/home'), loadSwaps()]));
    if (state.view !== 'home') return;
    state.home = home;
    updateBadges();
    renderHome();
  } catch (e) {
    if (e.status !== 401) content.innerHTML = errorState(e.message).v;
  }
}

const homeSkeleton = () => html`
  <div class="home" aria-busy="true" aria-label="Loading">
    <div class="home-main">
      <section class="home-hero"><span class="skeleton line w-40"></span></section>
      <section class="home-card"><span class="skeleton shift-sk"></span></section>
      <section class="home-card"><span class="skeleton shift-sk"></span><span class="skeleton line"></span></section>
    </div>
    <div class="home-side"><section class="home-card"><span class="skeleton line"></span><span class="skeleton line w-60"></span></section></div>
  </div>`;

/** Builds the page once; later refreshes only repaint the live parts so half-filled forms survive. */
function renderHome() {
  if (state.view !== 'home' || !state.home) return;
  if (!$('#home-root')) {
    const h = state.home;
    const today = ymd(new Date());
    $('#content').innerHTML = html`
      <div class="home" id="home-root">
        <div class="home-main">
          <header class="home-hero">
            <h1 class="home-brand"><img src="/brand/rostra-mark.svg" alt="" width="32" height="32"><span translate="no">rostra</span><span class="sr-only"> Home</span></h1>
            <p class="home-company" translate="no">${state.me.company.name}</p>
            <p class="home-greeting">Hi ${state.me.name.split(' ')[0]} · ${fmt.dayLong.format(new Date())}</p>
          </header>
          <section class="home-card next-card" id="home-next" aria-label="Next shift"></section>
          <section class="home-card" id="home-earn" aria-labelledby="earn-title"></section>
        </div>
        <div class="home-side">
          <section class="home-card" aria-labelledby="notes-title">
            <h2 class="card-heading" id="notes-title">${icon('bell')}Notifications</h2>
            <div id="home-notes" aria-live="polite"></div>
          </section>
          <section class="home-card" aria-labelledby="avail-title">
            <h2 class="card-heading" id="avail-title">${icon('calendar-x')}Availability & Leave</h2>
            <form id="avail-form" novalidate>
              <fieldset class="day-toggles" aria-describedby="avail-hint">
                <legend class="label">Days You Can Work</legend>
                <div class="day-toggle-row">
                  ${DAY_KEYS.map((d) => html`
                    <label class="day-toggle">
                      <input type="checkbox" name="day" value="${d}" data-field="days" ${h.availability.includes(d) ? raw('checked') : ''}>
                      <span>${dayName(d)}</span>
                    </label>`)}
                </div>
              </fieldset>
              <p class="field-hint" id="avail-hint">You won’t be rostered, or offered as cover, on days you switch off.</p>
              ${errorSlot('days', 'avail-error')}
              <button type="submit" class="btn btn-primary">Save Availability</button>
            </form>
            <hr class="divider">
            <form id="leave-form" novalidate>
              <p class="label">${isManager() ? 'Add Leave' : 'Request Leave'}</p>
              <div class="row-2">
                <div class="field">
                  <label for="lv-from">First Day</label>
                  <input class="input num" id="lv-from" name="from" type="date" min="${today}" data-field="from">
                  ${errorSlot('from', 'lv-from-error')}
                </div>
                <div class="field">
                  <label for="lv-to">Last Day</label>
                  <input class="input num" id="lv-to" name="to" type="date" min="${today}" data-field="to">
                  ${errorSlot('to', 'lv-to-error')}
                </div>
              </div>
              <div class="field">
                <label for="lv-reason">Reason</label>
                <input class="input" id="lv-reason" name="reason" type="text" maxlength="200" autocomplete="off" placeholder="e.g. Family wedding…" data-field="reason">
                ${errorSlot('reason', 'lv-reason-error')}
              </div>
              <p class="field-hint">${isManager() ? 'As a manager, your leave is approved straight away.' : 'Your manager approves leave. You’ll see the status below.'}</p>
              <p class="form-error" data-error-for="_" role="alert" hidden tabindex="-1"></p>
              <button type="submit" class="btn btn-primary">${isManager() ? 'Add Leave' : 'Request Leave'}</button>
            </form>
            <div id="home-leave"></div>
          </section>
        </div>
      </div>`.v;
    wireHomeForms();
  }
  renderNextShift();
  renderEarnings();
  renderNotifications();
  renderLeaveList();
}

function renderNextShift() {
  const el = $('#home-next');
  const s = state.home.nextShift;
  if (!el) return;
  if (!s) {
    el.innerHTML = html`
      <div class="next-row">
        <div class="date-tile is-empty" aria-hidden="true">${icon('calendar')}</div>
        <div class="next-text"><p class="next-label">Next Shift</p><p class="nothing">${isManager() ? 'You’re not rostered on for any upcoming shifts.' : 'No upcoming shifts yet.'}</p></div>
      </div>
      <footer class="next-foot"><span class="muted">Rostered Shift</span><a class="task-link" href="/app/my-shifts">See All Shifts${icon('right')}</a></footer>`.v;
    return;
  }
  const start = parse(s.start);
  const now = new Date();
  const days = Math.round((parseDay(ymd(start)) - parseDay(ymd(now))) / 864e5);
  const status = s.pendingCoverId != null
    ? html`<span class="status is-pending">Swap pending</span>`
    : s.clockIn ? html`<span class="status is-save">Clocked in</span>` : html`<span class="status">Confirmed</span>`;
  el.innerHTML = html`
    <div class="next-row">
      <div class="date-tile" aria-hidden="true"><small>${monthShort.format(start)}</small><strong>${fmt.dayNum.format(start)}</strong></div>
      <div class="next-text">
        <p class="next-label">Next Shift ${status}</p>
        <p class="next-time num">${dayLabel(start)} · ${fullRange(s.start, s.end)}</p>
        <p class="muted" data-station="${s.station}"><span class="station-dot" aria-hidden="true"></span> ${s.station} | ${s.site}${days > 1 ? ` · ${rtf.format(days, 'day')}` : ''}</p>
        ${s.pendingCoverName ? html`<p class="muted">Waiting on ${s.pendingCoverName} to cover.</p>` : ''}
      </div>
    </div>
    <footer class="next-foot"><span class="muted">Rostered Shift</span><a class="task-link" href="/app/my-shifts">See All Shifts${icon('right')}</a></footer>`.v;
}

function renderEarnings() {
  const el = $('#home-earn');
  if (!el) return;
  const w = state.home.week;
  const total = { count: w.pending.count + w.completed.count, hours: w.pending.hours + w.completed.hours, pay: w.pending.pay + w.completed.pay };
  const share = total.pay ? w.completed.pay / total.pay : 0;
  const r = 50;
  const circumference = 2 * Math.PI * r;
  const range = fmt.range.formatRange(parseDay(w.start), parseDay(w.end));
  el.innerHTML = html`
    <header class="earn-head">
      <h2 class="card-heading" id="earn-title">${plural(w.shifts, 'Confirmed Shift', 'Confirmed Shifts')}</h2>
      <p class="muted num">${range}</p>
    </header>
    ${w.shifts ? html`
      <div class="earn-grid">
        <div class="gauge" role="meter" aria-label="Pay earned so far this week" aria-valuemin="0" aria-valuemax="${total.pay.toFixed(2)}"
             aria-valuenow="${w.completed.pay.toFixed(2)}" aria-valuetext="${pay(w.completed.pay)} of ${pay(total.pay)}">
          <svg viewBox="0 0 120 120" width="132" height="132" aria-hidden="true">
            <circle class="gauge-track" cx="60" cy="60" r="${r}"></circle>
            <circle class="gauge-fill" cx="60" cy="60" r="${r}" stroke-dasharray="${(share * circumference).toFixed(1)} ${circumference.toFixed(1)}"></circle>
          </svg>
          <div class="gauge-label"><strong class="num">${pay(w.completed.pay)}</strong><span class="num">of ${pay(total.pay)}</span></div>
        </div>
        <table class="earn-table">
          <thead><tr><th scope="col"><span class="sr-only">Status</span></th><th scope="col">Hours</th><th scope="col">Est. Pay</th></tr></thead>
          <tbody>
            <tr><th scope="row">Pending <small>${plural(w.pending.count, 'shift', 'shifts')}</small></th><td class="num">${fmt.hours.format(w.pending.hours)}</td><td class="num">${pay(w.pending.pay)}</td></tr>
            <tr><th scope="row">Completed <small>${plural(w.completed.count, 'shift', 'shifts')}</small></th><td class="num">${fmt.hours.format(w.completed.hours)}</td><td class="num">${pay(w.completed.pay)}</td></tr>
          </tbody>
          <tfoot><tr><th scope="row">Total</th><td class="num">${fmt.hours.format(total.hours)}</td><td class="num">${pay(total.pay)}</td></tr></tfoot>
        </table>
      </div>
      <p class="earn-note muted">Estimated before tax, at your hourly rate with weekend penalty rates. Completed shifts use your clocked hours. Updated ${fmt.time.format(new Date())}.</p>`
    : html`<p class="nothing">No shifts this week, so nothing earned yet.</p>`}`.v;
}

function renderNotifications() {
  const el = $('#home-notes');
  if (!el) return;
  const me = state.me.id;
  const swaps = [...state.swaps].sort((a, b) => parse(a.start) - parse(b.start));
  if (!swaps.length) {
    el.innerHTML = html`<p class="nothing">Nothing yet</p>`.v;
    return;
  }
  el.innerHTML = html`<ul class="notes">${swaps.map((s) => {
    const when = `${fmt.dow.format(parse(s.start))} ${fmt.dayNum.format(parse(s.start))} ${monthShort.format(parse(s.start))}, ${compact(s.start, s.end)}`;
    const [title, sub] = isManager()
      ? [`${s.from.name} asked ${s.cover.name} to cover ${when}`, 'Needs your approval']
      : s.from.id === me
        ? [`You asked ${s.cover.name} to cover ${when}`, 'Waiting for your manager to approve']
        : [`${s.from.name} asked you to cover ${when}`, 'Your manager will confirm it'];
    return html`
      <li>
        <a class="note" href="/app/swaps">
          <span class="note-icon" aria-hidden="true">${icon('swap')}</span>
          <span class="note-text"><strong>${title}</strong><span class="muted">${s.site} · ${sub}</span></span>
          ${icon('right')}
        </a>
      </li>`;
  })}</ul>`.v;
}

function renderLeaveList() {
  const el = $('#home-leave');
  if (!el) return;
  const today = ymd(new Date());
  const list = state.home.timeOff;
  el.innerHTML = list.length ? html`
    <h3 class="label leave-heading">Your Leave</h3>
    <ul class="leave-items">${list.map((t) => html`
      <li class="leave-item">
        <div class="leave-text">
          <strong class="num">${dateSpan(t.from, t.to)}</strong>
          <span class="muted">${t.reason}</span>
        </div>
        <span class="status ${t.status === 'Approved' ? 'is-save' : t.status === 'Declined' ? 'is-danger' : 'is-pending'}">${t.status}</span>
        ${t.from > today && t.status !== 'Declined' ? html`<button type="button" class="btn btn-ghost btn-sm" data-action="cancel-leave" data-id="${t.id}" aria-label="Cancel leave on ${dateSpan(t.from, t.to)}">Cancel</button>` : ''}
      </li>`)}</ul>` .v : '';
}

function wireHomeForms() {
  const avail = $('#avail-form');
  avail.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(avail);
    const days = $$('input[name="day"]:checked', avail).map((i) => i.value);
    if (!days.length) return showErrors(avail, { days: 'Choose at least one day you can work. For time away, request leave instead.' });
    await withLoading(e.submitter, async () => {
      try {
        const result = await api('/me/availability', { method: 'PUT', body: { days } });
        state.home.availability = result.availability;
        toast(`Availability saved: ${result.availability.map(dayName).join(', ')}.`);
      } catch (err) {
        if (err.errors) return showErrors(avail, fromServer(err.errors));
        toast(err.message, { tone: 'error' });
      }
    });
  });

  const leave = $('#leave-form');
  leave.from.addEventListener('change', () => {
    leave.to.min = leave.from.value || ymd(new Date());
    if (!leave.to.value || leave.to.value < leave.from.value) leave.to.value = leave.from.value;
  });
  leave.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(leave);
    const body = { from: leave.from.value || null, to: leave.to.value || null, reason: leave.reason.value.trim() };
    const errors = {};
    if (!body.from) errors.from = 'Choose your first day off.';
    if (!body.to) errors.to = 'Choose your last day off.';
    else if (body.from && body.to < body.from) errors.to = 'The last day must be on or after the first day.';
    if (!body.reason) errors.reason = 'Add a short reason, like “Family wedding”.';
    if (Object.keys(errors).length) return showErrors(leave, errors);
    await withLoading(e.submitter, async () => {
      try {
        const created = await api('/me/time-off', { method: 'POST', body });
        state.home.timeOff = [...state.home.timeOff, created].sort((a, b) => a.from.localeCompare(b.from));
        leave.reset();
        renderLeaveList();
        const clash = created.rosteredShifts ? ` You’re rostered on ${plural(created.rosteredShifts, 'shift', 'shifts')} then, so ${isManager() ? 'arrange cover' : 'your manager will arrange cover'}.` : '';
        toast(`${created.status === 'Approved' ? 'Leave added' : 'Leave requested'} for ${dateSpan(created.from, created.to)}.${clash}`);
      } catch (err) {
        if (err.errors) return showErrors(leave, fromServer(err.errors));
        const general = $('[data-error-for="_"]', leave);
        general.innerHTML = html`${icon('alert')}<span>${err.message}</span>`.v;
        general.hidden = false;
        general.focus();
      }
    });
  });
}

Object.assign(actions, {
  'cancel-leave': async (el) => {
    const id = Number(el.dataset.id);
    const item = state.home.timeOff.find((t) => t.id === id);
    if (!item || !confirm(`Cancel your leave on ${dateSpan(item.from, item.to)}?`)) return;
    await withLoading(el, async () => {
      try {
        await api(`/me/time-off/${id}`, { method: 'DELETE' });
        state.home.timeOff = state.home.timeOff.filter((t) => t.id !== id);
        renderLeaveList();
        $('#leave-form')?.from.focus();
        toast('Leave cancelled.');
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
  },
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
