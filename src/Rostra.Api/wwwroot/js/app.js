import './palette.js';
import { $, $$, actions, addDays, api, app, appearance, appearanceFor, applyAppearance, applyTheme, clearErrors, closeDialog, compact, dayLabel, DEFAULT_APPEARANCE, deltaPill, dialog, dialogHead, downloadText, errorSlot, finePointer, fmt, fromServer, fullRange, hooks, hrs, html, icon, initials, isMac, isManager, isoLocal, isoWeek, leavePage, markMine, money, NBSP, openDialog, pad, paidHours, parse, parseDay, plural, raw, reducedMotion, sameDay, SCHEMES, shiftCost, showErrors, startOfWeek, state, swapDelta, themePicker, toast, withLoading, withSkeleton, ymd } from './core.js';
import { loadDashboard, viewDashboard } from './dashboard.js';
import { refreshHome, viewHome } from './home.js';
import { countUp, drawVine, introLogin, revealList, revealPage } from './motion.js';
import { closeNotifications, openNotifications, refreshNotificationsIfOpen, updateBell } from './notifications.js';
import { viewSettings } from './settings.js';
import { viewTeam } from './team.js';
import { viewTimesheets } from './timesheets.js';

/* --------------------------------------------------------------------------
   Router: real URLs so share, refresh, and Back/Forward all work
   -------------------------------------------------------------------------- */
history.scrollRestoration = 'manual';
hooks.onUnauthorized = () => {
  signedOut();
  navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
};
export const ROUTES = {
  '/app/home': () => viewHome(),
  '/app/dashboard': () => viewDashboard(),
  '/app/schedule': () => viewSchedule(),
  '/app/swaps': () => viewSwaps(),
  '/app/my-shifts': () => viewMyShifts(),
  '/app/timesheets': () => viewTimesheets(),
  '/app/team': () => viewTeam(),
  '/app/settings': () => viewSettings(),
};
export const PAGE_TITLES = {
  '/app/home': 'Home', '/app/dashboard': 'Dashboard', '/app/schedule': 'Schedule', '/app/swaps': 'Swaps',
  '/app/my-shifts': 'My Shifts', '/app/timesheets': 'Timesheets', '/app/team': 'Team', '/app/settings': 'Settings',
};
export function navigate(url, { replace = false } = {}) {
  if (!replace) history.replaceState({ ...(history.state || {}), y: scrollY }, '');
  history[replace ? 'replaceState' : 'pushState']({ y: 0 }, '', url);
  route();
}
export const defaultPath = () => '/app/home';
export async function route() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  try {
    if (path === '/login') {
      if (await ensureMe({ redirect: false })) return navigate(nextPath() || defaultPath(), { replace: true });
      return viewLogin();
    }
    leaveLogin();
    if (!(await ensureMe({ redirect: true }))) return;
    if (!ROUTES[path]) return navigate(defaultPath(), { replace: true });
    ensureShell();
    updateNav(path);
    closeNotifications();
    const changedPage = state.path !== path;
    state.path = path;
    if (changedPage) leavePage();
    await ROUTES[path]();
    scrollTo(0, history.state?.y ?? 0);
    if (changedPage) revealPage($('#content'));
  } catch (e) {
    if (e.status === 401) return;
    app.innerHTML = html`<main class="main" id="main" tabindex="-1"><div class="content">${errorState(e.message)}</div></main>`.v;
  } finally {
    app.removeAttribute('aria-busy');
  }
}
addEventListener('popstate', route);
export const nextPath = () => {
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

export async function ensureMe({ redirect }) {
  if (state.me) return true;
  state.me = await api('/me', { quiet401: true });
  if (!state.me) {
    if (redirect) navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    return false;
  }
  applyAppearance(appearanceFor(state.me));
  state.names.set(state.me.id, state.me.name);
  state.unread = state.me.unreadNotifications ?? 0;
  connectEvents();
  startActivityHeartbeat();
  loadSwaps().then(updateBadges).catch(() => {});
  return true;
}
export function signedOut() {
  state.me = null; state.schedule = null; state.swaps = []; state.myShifts = null; state.lastScheduleQuery = ''; state.home = null;
  state.events?.close(); state.events = null;
  stopActivityHeartbeat();
  closeNotifications();
  if (dialog.open) closeDialog({ force: true });
  // The next person on this device starts from the default scheme, but keeps the device's mode and motion.
  applyAppearance({ ...DEFAULT_APPEARANCE, mode: appearance.mode, motion: appearance.motion }, { brand: null });
}

/* Time spent in the app grows the tree on Home. Counted only while the tab is visible and in use. */
let heartbeat = null;
let lastInteraction = Date.now();
for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(type, () => { lastInteraction = Date.now(); }, { passive: true });
export function startActivityHeartbeat() {
  if (heartbeat) return;
  heartbeat = setInterval(async () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastInteraction > 120000 || !state.me) return;
    try {
      const { activeSeconds } = await api('/me/activity', { method: 'POST', body: { seconds: 60 } });
      document.dispatchEvent(new CustomEvent('grove:grow', { detail: { activeSeconds } }));
    } catch { /* offline: the next beat catches up */ }
  }, 60000);
}
function stopActivityHeartbeat() { clearInterval(heartbeat); heartbeat = null; }

/* --------------------------------------------------------------------------
   App shell
   -------------------------------------------------------------------------- */
function navItems() {
  const manager = isManager();
  return [
    { path: '/app/home', icon: 'home', label: 'Home' },
    manager && { path: '/app/dashboard', icon: 'grid', label: 'Dashboard' },
    manager && { path: '/app/schedule', icon: 'calendar', label: 'Schedule', href: `/app/schedule${state.lastScheduleQuery}` },
    { path: '/app/swaps', icon: 'swap', label: 'Swaps', badge: true },
    { path: '/app/my-shifts', icon: 'clock', label: 'My Shifts' },
    manager && { section: 'Manage' },
    manager && { path: '/app/timesheets', icon: 'sheet', label: 'Timesheets' },
    manager && { path: '/app/team', icon: 'users', label: 'Team' },
  ].filter(Boolean);
}
const swapBadge = () => (state.swaps.length
  ? html`<span class="badge" data-badge><span class="sr-only">, </span>${state.swaps.length}<span class="sr-only"> pending</span></span>`
  : '');
export function navLinks() {
  return html`${navItems().map((item) => item.section
    ? html`<p class="nav-section eyebrow" aria-hidden="true">${item.section}</p>`
    : html`<a href="${item.href || item.path}" data-nav="${item.path}">${icon(item.icon)}<span>${item.label}</span>${item.badge ? swapBadge() : ''}</a>`)}`;
}
/** Phones get the four places people go most, plus a Menu that opens the command palette. */
function tabLinks() {
  const second = isManager()
    ? { path: '/app/schedule', icon: 'calendar', label: 'Schedule', href: `/app/schedule${state.lastScheduleQuery}` }
    : { path: '/app/my-shifts', icon: 'clock', label: 'My Shifts' };
  return html`
    ${[{ path: '/app/home', icon: 'home', label: 'Home' }, second, { path: '/app/swaps', icon: 'swap', label: 'Swaps', badge: true }]
      .map((item) => html`<a href="${item.href || item.path}" data-nav="${item.path}">${icon(item.icon)}<span>${item.label}</span>${item.badge ? swapBadge() : ''}</a>`)}
    <button type="button" class="tab-menu" data-action="open-palette" aria-haspopup="dialog">${icon('menu')}<span>Menu</span></button>`;
}
const bellButton = (id) => html`
  <button type="button" class="btn btn-ghost icon-btn bell" id="${id}" data-action="open-notifications" aria-haspopup="dialog" aria-expanded="false" aria-label="Notifications">
    ${icon('bell')}<span class="bell-count" data-bell-count hidden></span>
  </button>`;
export function ensureShell() {
  if ($('#content') && app.dataset.company === String(state.me.company.id)) return;
  const { me } = state;
  const c = me.company;
  app.dataset.company = c.id;
  const shortcut = isMac ? `⌘${NBSP}K` : `Ctrl${NBSP}K`;
  app.innerHTML = html`
    <div class="app">
      <aside class="sidebar" aria-label="Sidebar">
        <div class="brand-row">
          <a class="brand" href="/app/home" data-logo title="Right-click for brand assets">
            <span class="brand-mark" aria-hidden="true">${initials(c.name)}</span>
            <span class="brand-text">
              <span class="brand-company" translate="no">${c.name}</span>
              <span class="brand-product">Rostering by <span translate="no">rostra</span></span>
            </span>
          </a>
          ${bellButton('bell-desktop')}
        </div>
        <button type="button" class="search-trigger" data-action="open-palette" aria-haspopup="dialog">
          ${icon('search')}<span>Search or jump to…</span><kbd>${shortcut}</kbd>
        </button>
        <nav class="nav" aria-label="Primary">${navLinks()}</nav>
        <svg class="vine" viewBox="0 0 220 120" aria-hidden="true" focusable="false">
          <path class="vine-stem" d="M4 116 C 40 96, 52 70, 88 64 S 150 70, 168 40 S 200 12, 216 6"/>
          <path class="vine-leaf" d="M58 76 c -10 -14 -2 -24 10 -22 c 2 12 -2 18 -10 22z"/>
          <path class="vine-leaf" d="M104 64 c 4 -16 16 -18 24 -10 c -8 10 -14 12 -24 10z"/>
          <path class="vine-leaf" d="M150 54 c -12 -10 -8 -22 4 -24 c 4 10 2 18 -4 24z"/>
          <path class="vine-leaf" d="M188 22 c 2 -12 12 -16 20 -10 c -6 8 -12 10 -20 10z"/>
        </svg>
        <div class="sidebar-foot">
          <a class="nav-link-settings" href="/app/settings" data-nav="/app/settings">${icon('settings')}<span>Settings</span></a>
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
        ${bellButton('bell-mobile')}
        <a class="btn btn-ghost icon-btn" href="/app/settings" aria-label="Settings">${icon('settings')}</a>
      </header>
      <main class="main" id="main" tabindex="-1"><div class="content" id="content"></div></main>
      <nav class="tabbar" aria-label="Primary, mobile">${tabLinks()}</nav>
    </div>`.v;
  applyTheme();
  updateBell();
  drawVine($('.vine'));
}
export function updateNav(path) {
  $$('[data-nav]').forEach((a) => {
    if (a.dataset.nav === path) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    if (a.dataset.nav === '/app/schedule') a.setAttribute('href', `/app/schedule${state.lastScheduleQuery}`);
  });
}
export function updateBadges() {
  const count = state.swaps.length;
  $$('[data-nav="/app/swaps"]').forEach((a) => {
    $('[data-badge]', a)?.remove();
    if (count) a.insertAdjacentHTML('beforeend', html`<span class="badge" data-badge><span class="sr-only">, </span>${count}<span class="sr-only"> pending</span></span>`.v);
  });
}
export const errorState = (message, retry = true) => html`
  <div class="error-banner" role="alert">
    ${icon('alert')}<p>${message}</p>
    ${retry ? html`<button type="button" class="btn btn-sm" data-action="retry">Try Again</button>` : ''}
  </div>`;

/* --------------------------------------------------------------------------
   Data loading
   -------------------------------------------------------------------------- */
export async function loadSwaps() {
  const data = await api('/swaps');
  state.swaps = data.swaps;
  state.penalties = data.penalties;
  for (const s of data.swaps) { if (s.from) state.names.set(s.from.id, s.from.name); state.names.set(s.cover.id, s.cover.name); }
  return data.swaps;
}
export async function refreshQuietly() {
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
      await refreshHome();
    } else if (state.view === 'timesheets' || state.view === 'team') {
      await state.reload?.();
    }
    updateBadges();
    state.render?.();
  } catch { /* the next event or navigation retries */ }
}
export const rememberNames = (people) => people.forEach((p) => state.names.set(p.id, p.name));
export const nameOf = (id) => state.names.get(id) ?? 'a teammate';

/* --------------------------------------------------------------------------
   Live updates over Server-Sent Events
   -------------------------------------------------------------------------- */
export function connectEvents() {
  if (state.events || !window.EventSource) return;
  const es = new EventSource('/events');
  state.events = es;
  let timer;
  const refresh = () => { clearTimeout(timer); timer = setTimeout(refreshQuietly, 250); };
  for (const type of ['schedule.changed', 'swap.requested', 'swap.resolved', 'clock', 'timeoff', 'revenue', 'announcement', 'kudos']) {
    es.addEventListener(type, refresh);
  }
  // Personal notifications arrive only on this person's stream: update the bell and say it once.
  es.addEventListener('notification', (e) => {
    const d = JSON.parse(e.data);
    state.unread = (state.unread || 0) + 1;
    updateBell();
    refreshNotificationsIfOpen();
    toast(d.title, { action: 'View', onAction: () => openNotifications() });
  });
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) state.events = null; };
}

/* --------------------------------------------------------------------------
   Sign in
   -------------------------------------------------------------------------- */
let loginScene = null;
export function leaveLogin() { loginScene?.destroy(); loginScene = null; }

export async function viewLogin() {
  state.view = 'login';
  state.render = null;
  app.dataset.company = '';
  document.title = 'Sign In · Rostra';
  app.innerHTML = html`
    <div class="auth">
      <canvas class="forest-canvas" id="forest" aria-hidden="true"></canvas>
      <div class="auth-veil" aria-hidden="true"></div>
      <header class="auth-top">
        <a class="wordmark" href="/login" data-logo translate="no"><img src="/brand/rostra-mark.svg" alt="" width="24" height="24">rostra</a>
        ${themePicker('theme-login')}
      </header>
      <main class="auth-main" id="main" tabindex="-1">
        <section class="auth-hero" aria-labelledby="hero-title">
          <p class="hero-names" aria-hidden="true"><span class="eyebrow">Managers</span><span class="eyebrow">Their crew</span></p>
          <h1 id="hero-title" class="hero-title display weathered" translate="no">
            <span class="hero-the">The</span>
            <span class="hero-word">Rostra</span>
            <span class="sr-only">: staff rostering and shift swaps for restaurants</span>
          </h1>
          <p class="hero-tagline eyebrow">Tasked with rostering a crew across every site, a manager joins hands with their team to keep each shift covered, unscathed.</p>
          <svg class="hero-stamp" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
            <defs><path id="stamp-ring" d="M60 60 m -44 0 a 44 44 0 1 1 88 0 a 44 44 0 1 1 -88 0"/></defs>
            <circle cx="60" cy="60" r="56" /><circle cx="60" cy="60" r="34" />
            <text><textPath href="#stamp-ring">ROSTRA · FIELD TESTED · EST. 2024 ·</textPath></text>
            <text class="stamp-core" x="60" y="66" text-anchor="middle">ORIGINAL</text>
          </svg>
        </section>
        <div class="auth-side">
          <section class="auth-card" aria-labelledby="signin-title">
            <div>
              <h2 id="signin-title" class="display">Sign In</h2>
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
              <h2 id="demo-title" class="eyebrow">Try a Demo Company</h2>
              <p class="demo-note">Each company opens in its own colour scheme. You can change yours any time in Settings.</p>
            </div>
            <ul class="demo-list" id="demo-list">${[0, 1, 2].map(() => html`<li class="demo-card"><div class="skeleton line"></div><div class="skeleton shift-sk"></div></li>`)}</ul>
          </section>
        </div>
      </main>
    </div>`.v;
  applyTheme();
  if (finePointer.matches) $('#email').focus();

  const form = $('#login-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    signIn(form.email.value, form.password.value, form.remember.checked, e.submitter || $('[type="submit"]', form));
  });

  introLogin();
  import('./scenes/forest.js')
    .then(({ mountForest }) => { if (state.view === 'login') loginScene = mountForest($('#forest')); })
    .catch(() => { /* no WebGL: the CSS backdrop stands in */ });

  try {
    const demo = await api('/auth/demo');
    renderDemoAccounts(demo);
  } catch {
    $('#demo-list').closest('.demo').hidden = true;
  }
}

const schemeLabel = (id) => SCHEMES.find((x) => x.id === id)?.name ?? 'Overgrowth';
export function renderDemoAccounts(demo) {
  const list = $('#demo-list');
  list.innerHTML = demo.accounts.map((a) => {
    const swatches = a.scheme === 'brand' ? [a.accent] : SCHEMES.find((x) => x.id === a.scheme)?.swatches.slice(1, 5) ?? [];
    return html`
    <li class="demo-card">
      <div class="demo-head">
        <span class="brand-mark" aria-hidden="true">${initials(a.company)}</span>
        <div><h3 translate="no">${a.company}</h3><p>${a.tagline}</p></div>
        <span class="demo-scheme"><span class="demo-swatches" aria-hidden="true">${swatches.map(() => html`<i></i>`)}</span>${schemeLabel(a.scheme)}</span>
      </div>
      <div class="demo-logins">
        <button type="button" class="btn" data-action="demo-login" data-email="${a.managerEmail}">
          <span>Sign In as ${a.managerName.split(' ')[0]} (Manager)<small translate="no">${a.managerEmail}</small></span>${icon('right')}
        </button>
        <button type="button" class="btn" data-action="demo-login" data-email="${a.staffEmail}">
          <span>Sign In as ${a.staffName} (Staff)<small translate="no">${a.staffEmail}</small></span>${icon('right')}
        </button>
      </div>
    </li>`.v;
  }).join('') + html`<li class="demo-note">Every demo account uses the password <code translate="no">${demo.password}</code>.</li>`.v;
  list.dataset.password = demo.password;
  // Swatch colours go in through CSSOM (the CSP blocks inline style attributes).
  demo.accounts.forEach((a, i) => {
    const swatches = a.scheme === 'brand' ? [a.accent] : SCHEMES.find((x) => x.id === a.scheme)?.swatches.slice(1, 5) ?? [];
    $$('.demo-swatches i', list.children[i]).forEach((el, j) => el.style.setProperty('background', swatches[j]));
  });
  revealList(list.children);
}

export async function signIn(email, password, remember, button) {
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
export async function viewSchedule() {
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

export function scheduleModel() {
  const s = state.schedule;
  const weekStart = parseDay(s.weekStart);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const keys = days.map(ymd);
  const people = new Map(s.staff.map((p) => [p.id, p]));
  const cells = new Map();
  const perPerson = new Map(s.staff.map((p) => [p.id, { hours: 0, cost: 0, shifts: 0 }]));
  const perDay = days.map(() => ({ hours: 0, cost: 0, shifts: 0 }));
  const total = { hours: 0, cost: 0, shifts: 0, open: 0 };
  const warnings = new Map();
  for (const w of s.warnings || []) {
    if (!warnings.has(w.shiftId)) warnings.set(w.shiftId, []);
    warnings.get(w.shiftId).push(w);
  }
  for (const shift of s.shifts) {
    const i = keys.indexOf(ymd(parse(shift.start)));
    if (i < 0) continue;
    const key = `${shift.staffId ?? 'open'}|${i}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(shift);
    const h = paidHours(shift);
    // Open shifts are costed at the team's average rate until someone takes them.
    const rate = shift.staffId == null ? s.estimatedRate : people.get(shift.staffId)?.hourlyRate;
    const c = shiftCost(shift, rate, s.penalties);
    if (shift.staffId == null) total.open += 1;
    for (const bucket of [perPerson.get(shift.staffId), perDay[i], total]) {
      if (!bucket) continue;
      bucket.hours += h; bucket.cost += c; bucket.shifts += 1;
    }
  }
  return { s, weekStart, days, people, cells, perPerson, perDay, total, warnings };
}

export function weekHref(offset) {
  const s = state.schedule;
  const target = offset === 0 ? startOfWeek(new Date()) : addDays(parseDay(s.weekStart), offset * 7);
  return `/app/schedule?site=${s.site.id}&week=${ymd(target)}`;
}

function weekStatus(s) {
  const published = s.week.status === 'Published';
  const when = s.week.publishedAt ? fmt.dayShort.format(parse(s.week.publishedAt)) : null;
  return published
    ? html`<span class="status is-save" title="${when ? `Published ${when}${s.week.publishedBy ? ` by ${s.week.publishedBy}` : ''}` : 'Published'}">${icon('check')}Published${when ? ` ${when}` : ''}</span>`
    : html`<span class="status is-draft">${icon('pencil')}Draft</span>`;
}

export function renderSchedule() {
  if (!state.schedule || state.view !== 'schedule') return;
  const m = scheduleModel();
  const { s, weekStart, days, total } = m;
  const week = s.week.number ?? isoWeek(weekStart);
  const isThisWeek = sameDay(weekStart, startOfWeek(new Date()));
  const published = s.week.status === 'Published';
  const hasShifts = s.shifts.length > 0;
  const startsInFuture = weekStart > new Date();
  const warnings = s.warnings || [];
  document.title = `Schedule · ${s.site.name} · Week ${week}${published ? '' : ' (Draft)'} · ${state.me.company.name}`;

  $('#content').innerHTML = html`
    <header class="page-head">
      <div class="page-title">
        <h1>Schedule</h1>
        <p class="page-sub">
          <span class="pill num">Week ${week} · ${s.site.name}</span>
          <span class="num">${fmt.range.formatRange(weekStart, days[6])}</span>
          ${weekStatus(s)}
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
        <span class="toolbar-group">
          <button type="button" class="btn icon-btn" data-action="export-roster" aria-label="Export roster as CSV" title="Export CSV">${icon('download')}</button>
          <button type="button" class="btn icon-btn" data-action="print-roster" aria-label="Print roster" title="Print">${icon('printer')}</button>
        </span>
        <button type="button" class="btn" data-action="new-shift">${icon('plus')}Add Shift…</button>
        ${!published && hasShifts ? html`<button type="button" class="btn btn-primary" data-action="publish-week">${icon('send')}Publish Week…</button>` : ''}
        ${published && startsInFuture ? html`<button type="button" class="btn btn-ghost" data-action="unpublish-week">Back to Draft</button>` : ''}
      </div>
    </header>
    ${!published && hasShifts ? html`
      <div class="draft-banner" role="note">
        ${icon('pencil')}
        <p><strong>This week is a draft.</strong> Only managers can see it. Publish it to share the roster and notify ${plural(new Set(s.shifts.filter((x) => x.staffId != null).map((x) => x.staffId)).size, 'person', 'people')}.</p>
      </div>` : ''}
    ${managerStats(m)}
    ${warnings.length ? html`
      <details class="checks" ${warnings.length <= 4 ? raw('open') : ''}>
        <summary>${icon('alert')}<span>${plural(warnings.length, 'roster check', 'roster checks')} to look at</span><span class="muted">Warnings only. You can still publish.</span></summary>
        <ul>${warnings.map((w) => {
          const shift = s.shifts.find((x) => x.id === w.shiftId);
          const who = m.people.get(w.staffId)?.name ?? 'Someone';
          return html`<li><button type="button" class="link-btn" data-action="focus-shift" data-id="${w.shiftId}">${who} · ${shift ? `${fmt.dow.format(parse(shift.start))} ${compact(shift.start, shift.end)}` : ''}</button> <span>${w.message}</span></li>`;
        })}</ul>
      </details>` : ''}
    <section class="panel" aria-labelledby="roster-title">
      <h2 id="roster-title" class="sr-only">Roster for ${s.site.name}, week of ${fmt.dayLong.format(weekStart)}</h2>
      ${hasShifts || s.staff.length ? rosterTable(m) : ''}
      ${!hasShifts ? html`
        <div class="empty">
          ${icon('calendar')}<h2>Week ${week} Is Empty</h2>
          <p>Start from last week’s roster, or add shifts one at a time. Copied shifts that clash with leave or availability become open shifts.</p>
          <div class="empty-actions">
            <button type="button" class="btn btn-primary" data-action="copy-week">${icon('copy')}Copy Last Week</button>
            <button type="button" class="btn" data-action="new-shift">${icon('plus')}Add Shift…</button>
          </div>
        </div>` : ''}
      <div class="legend" aria-label="Legend">
        ${['Floor', 'Kitchen', 'Bar', 'Barista'].map((st) => html`<span data-station="${st}"><i aria-hidden="true"></i>${st}</span>`)}
        <span class="legend-open"><i aria-hidden="true"></i>Open shift</span>
        <span class="legend-pending"><i aria-hidden="true"></i>Swap or pick-up pending</span>
        <span class="legend-warn">${icon('alert')}Roster check</span>
      </div>
    </section>
    ${approvalBar()}`.v;

  const meter = $('[data-meter]');
  if (meter) meter.style.setProperty('--fill', meter.dataset.meter);
  if (total.cost && state.countedSchedule !== `${s.site.id}|${s.weekStart}`) {
    state.countedSchedule = `${s.site.id}|${s.weekStart}`;
    countUp($('.stat-value'), total.cost, money);
  }
}

export function managerStats({ s, total, perDay }) {
  const budget = s.site.weeklyBudget || 0;
  const ratio = budget ? total.cost / budget : 0;
  const over = total.cost - budget;
  const pending = state.swaps.length;
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
        <span class="stat-label">Open Shifts</span>
        <span class="stat-value">${fmt.int.format(total.open)}</span>
        <span class="stat-foot">${total.open ? `Costed at ${money(s.estimatedRate)}/h until filled` : 'Every shift has someone'}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Requests</span>
        <span class="stat-value">${fmt.int.format(pending)}</span>
        <span class="stat-foot">${pending ? html`<a href="/app/swaps">Review ${pending === 1 ? 'Request' : 'Requests'}</a>` : 'All caught up'}</span>
      </div>
    </section>`;
}
export const weekDays = (s) => Array.from({ length: 7 }, (_, i) => addDays(parseDay(s.weekStart), i));

export function rosterTable({ s, days, cells, perPerson, perDay, total, people, warnings }) {
  const me = state.me.id;
  const today = new Date();
  const dayCells = (key, label) => days.map((d, i) => {
    const list = cells.get(`${key}|${i}`) || [];
    return html`<td class="${sameDay(d, today) ? 'is-today' : ''}"><div class="cell">
      ${list.map((shift) => shiftChip(shift, people, warnings))}
      <button type="button" class="add-slot" data-action="add-shift" data-staff="${key === 'open' ? '' : key}" data-day="${i}"
        aria-label="Add ${key === 'open' ? 'an open shift' : `shift for ${label}`} on ${fmt.dayLong.format(d)}">${icon('plus')}</button>
    </div></td>`;
  });
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
          <tr class="open-row">
            <th scope="row">
              <div class="person">
                <span class="avatar open-avatar" aria-hidden="true">${icon('hand')}</span>
                <span class="person-text">
                  <span class="person-name">Open Shifts</span>
                  <span class="person-meta">${total.open ? `${plural(total.open, 'shift', 'shifts')} to fill` : 'Anyone suitable can ask'}</span>
                </span>
              </div>
            </th>
            ${dayCells('open', 'open')}
          </tr>
          ${s.staff.map((p) => {
            const t = perPerson.get(p.id);
            const isMe = p.id === me;
            return html`<tr class="${isMe ? 'is-me' : ''}">
              <th scope="row">
                <div class="person">
                  <span class="avatar ${isMe ? 'is-me' : ''}" aria-hidden="true">${initials(p.name)}</span>
                  <span class="person-text">
                    <span class="person-name">${p.name}${isMe ? html`<span class="you-tag">You</span>` : ''}</span>
                    <span class="person-meta">${p.role === 'Manager' ? 'Manager · ' : ''}${hrs(t.hours)} · ${money(t.cost)}</span>
                  </span>
                </div>
              </th>
              ${dayCells(p.id, p.name)}
            </tr>`;
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Daily Labour<br><span class="num">${money(total.cost)}</span></th>
            ${perDay.map((d) => html`<td><span class="day-total"><strong>${money(d.cost)}</strong><span>${hrs(d.hours)} · ${d.shifts}</span></span></td>`)}
          </tr>
        </tfoot>
      </table>
    </div>`;
}

export function shiftChip(shift, people, warnings = new Map()) {
  const open = shift.staffId == null;
  const person = open ? null : people.get(shift.staffId);
  const pending = shift.pendingCoverId != null;
  const coverName = pending ? (people.get(shift.pendingCoverId)?.name ?? nameOf(shift.pendingCoverId)) : null;
  const issues = warnings.get(shift.id) || [];
  const start = parse(shift.start);
  const meta = open
    ? (pending ? `${coverName} asked for it` : `Open · ${shift.station}`)
    : pending ? `Swap → ${coverName}` : shift.notes ? `${shift.station} · ${shift.notes}` : shift.station;
  const label = `${open ? 'Open shift' : person?.name ?? 'Shift'}, ${fmt.dayLong.format(start)}, ${fullRange(shift.start, shift.end)}, ${shift.station}`
    + (pending ? (open ? `, ${coverName} asked to pick it up` : `, swap pending: ${coverName} asked to cover`) : '')
    + (issues.length ? `. Check: ${issues.map((w) => w.message).join(' ')}` : '')
    + '. Edit shift';
  const cls = `shift${open ? ' is-open' : ''}${pending ? ' is-pending' : ''}${issues.length ? ' has-warning' : ''}${shift.id === justAdded ? ' is-new' : ''}`;
  return html`<button type="button" class="${cls}" data-station="${shift.station}" data-action="open-shift" data-id="${shift.id}" aria-label="${label}">
    <span class="shift-time">${compact(shift.start, shift.end)}${issues.length ? icon('alert', 'icon shift-warn') : ''}</span><span class="shift-meta">${meta}</span>
  </button>`;
}
export let justAdded = null;

/** The one request most worth acting on, pinned to the bottom of the roster. */
export function approvalBar() {
  const swaps = [...state.swaps].sort((a, b) => parse(a.start) - parse(b.start));
  if (!swaps.length) return '';
  const first = swaps[0];
  const start = parse(first.start);
  const onScreen = state.schedule.site.id === first.siteId && sameDay(startOfWeek(start), parseDay(state.schedule.weekStart));
  const rest = swaps.length - 1;
  const when = html`<strong class="num">${fmt.dow.format(start)} ${compact(first.start, first.end)}</strong>`;
  return html`
    <section class="approval" aria-label="Request awaiting approval">
      <span class="approval-dot" aria-hidden="true"></span>
      <div class="approval-text">
        <p>${first.from
          ? html`<strong>${first.from.name}</strong> asked <strong>${first.cover.name}</strong> to cover ${when}`
          : html`<strong>${first.cover.name}</strong> wants to pick up ${when} <span class="muted">(open shift)</span>`}</p>
        <p class="muted">${first.site} · ${fmt.dayShort.format(start)} ${first.from ? deltaPill(swapDelta(first, state.penalties)) : html`<span class="status">Fills an open shift</span>`}
          ${onScreen ? '' : html` · <a href="/app/schedule?site=${first.siteId}&week=${ymd(startOfWeek(start))}">View on Roster</a>`}
          ${rest > 0 ? html` · <a href="/app/swaps">${rest} more</a>` : ''}</p>
      </div>
      <div class="approval-actions">
        <button type="button" class="btn btn-ghost" data-action="decline" data-id="${first.shiftId}">Decline</button>
        <button type="button" class="btn btn-primary" data-action="approve" data-id="${first.shiftId}">${icon('check')}Approve</button>
      </div>
    </section>`;
}

export const scheduleSkeleton = () => html`
  <header class="page-head"><div class="page-title"><h1>Schedule</h1><p class="page-sub"><span class="skeleton line w-180"></span></p></div></header>
  <section class="stats" aria-hidden="true">${[0, 1, 2, 3].map(() => html`<div class="stat"><span class="skeleton line"></span><span class="skeleton line"></span><span class="skeleton line"></span></div>`)}</section>
  <section class="panel" aria-busy="true" aria-label="Loading roster">
    <div class="grid-scroll"><table class="roster"><colgroup><col class="col-person">${[...Array(7)].map(() => html`<col>`)}</colgroup>
      <thead><tr><th class="corner">Team</th>${[...Array(7)].map(() => html`<th><span class="skeleton line"></span></th>`)}</tr></thead>
      <tbody>${[...Array(6)].map((_, r) => html`<tr><th><span class="skeleton line"></span></th>${[...Array(7)].map((__, c) => html`<td><div class="cell">${(r + c) % 3 ? html`<div class="skeleton shift-sk"></div>` : ''}</div></td>`)}</tr>`)}</tbody>
    </table></div>
  </section>`;

/* --------------------------------------------------------------------------
   Publishing & export
   -------------------------------------------------------------------------- */
function openPublishDialog(returnTo) {
  const m = scheduleModel();
  const { s, total } = m;
  const people = new Set(s.shifts.filter((x) => x.staffId != null).map((x) => x.staffId)).size;
  const budget = s.site.weeklyBudget || 0;
  const warnings = s.warnings || [];
  openDialog(html`
    <form class="dialog-form" id="publish-form">
      ${dialogHead(`Publish Week ${s.week.number}?`, `${s.site.name} · ${fmt.range.formatRange(m.days[0], m.days[6])}`)}
      <div class="dialog-body">
        <ul class="publish-summary">
          <li>${icon('users')}<span><strong>${plural(people, 'person', 'people')}</strong> will get their shifts by notification and in their calendar feed.</span></li>
          <li>${icon('clock')}<span><strong>${plural(total.shifts, 'shift', 'shifts')}</strong>, ${hrs(total.hours)} paid.</span></li>
          <li>${icon('dollar')}<span><strong>${money(total.cost)}</strong> labour against a ${money(budget)} budget${total.cost > budget ? html` <span class="status is-danger">${money(total.cost - budget)} over</span>` : ''}.</span></li>
          ${total.open ? html`<li>${icon('hand')}<span><strong>${plural(total.open, 'open shift', 'open shifts')}</strong> will be offered to staff who can take them.</span></li>` : ''}
        </ul>
        ${warnings.length ? html`
          <div class="callout is-warn">
            <p><strong>${plural(warnings.length, 'roster check', 'roster checks')}</strong> to look at first. You can still publish.</p>
            <ul class="publish-checks">${warnings.slice(0, 6).map((w) => html`<li>${m.people.get(w.staffId)?.name ?? ''}: ${w.message}</li>`)}</ul>
            ${warnings.length > 6 ? html`<p class="muted">…and ${warnings.length - 6} more on the roster.</p>` : ''}
          </div>` : html`<p class="muted">${icon('check')} No roster checks: rest breaks, hours and availability all look fine.</p>`}
      </div>
      <div class="dialog-foot"><span class="spacer"></span>
        <button type="button" class="btn" data-close>Not Yet</button>
        <button type="submit" class="btn btn-primary">${icon('send')}Publish & Notify Team</button>
      </div>
    </form>`, { returnTo });
  $('#publish-form', dialog).addEventListener('submit', async (e) => {
    e.preventDefault();
    await withLoading(e.submitter, async () => {
      try {
        const result = await api('/schedule/publish', { method: 'POST', body: { siteId: s.site.id, week: s.weekStart } });
        closeDialog({ force: true });
        toast(`Week ${s.week.number} published. ${plural(result.notified, 'person was', 'people were')} notified.`);
        await refreshQuietly();
      } catch (err) { toast(err.message, { tone: 'error' }); }
    });
  });
}

/** CSV of the week on screen, for spreadsheets or the back-office printer. */
function exportRosterCsv() {
  const m = scheduleModel();
  const { s, people } = m;
  const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  const rows = [['Date', 'Day', 'Team Member', 'Station', 'Start', 'End', 'Unpaid Break (min)', 'Paid Hours', 'Est. Cost', 'Status', 'Notes']];
  for (const shift of [...s.shifts].sort((a, b) => parse(a.start) - parse(b.start))) {
    const start = parse(shift.start);
    const end = parse(shift.end);
    const person = people.get(shift.staffId);
    const rate = shift.staffId == null ? s.estimatedRate : person?.hourlyRate;
    rows.push([
      ymd(start), fmt.dow.format(start), person?.name ?? 'Open shift', shift.station,
      `${pad(start.getHours())}:${pad(start.getMinutes())}`, `${pad(end.getHours())}:${pad(end.getMinutes())}`,
      shift.breakMinutes, paidHours(shift).toFixed(2), shiftCost(shift, rate, s.penalties).toFixed(2),
      shift.staffId == null ? 'Open' : shift.pendingCoverId != null ? 'Swap pending' : 'Rostered', shift.notes ?? '',
    ]);
  }
  downloadText(`rostra-${s.site.name.toLowerCase().replace(/\s+/g, '-')}-week-${s.week.number}.csv`, rows.map((r) => r.map(cell).join(',')).join('\n') + '\n');
  toast(`Exported ${plural(s.shifts.length, 'shift', 'shifts')} to CSV.`);
}

/* --------------------------------------------------------------------------
   Shift editor (managers)
   -------------------------------------------------------------------------- */
export const STATIONS = ['Floor', 'Kitchen', 'Bar', 'Barista'];
export const timeValue = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function openShiftEditor({ shift, staffId, dayIndex, returnTo }) {
  const s = state.schedule;
  const days = weekDays(s);
  const editing = Boolean(shift);
  const start = shift ? parse(shift.start) : null;
  const end = shift ? parse(shift.end) : null;
  const openShift = shift ? shift.staffId == null : staffId === null;
  const person = openShift ? null : s.staff.find((p) => p.id === (shift?.staffId ?? staffId)) ?? s.staff[0];
  const day = shift ? days.findIndex((d) => sameDay(d, start)) : dayIndex ?? Math.max(0, days.findIndex((d) => sameDay(d, new Date())));
  const shortcut = isMac ? `⌘${NBSP}Enter` : `Ctrl${NBSP}Enter`;
  const pendingSwap = shift?.pendingCoverId != null && state.swaps.find((x) => x.shiftId === shift.id);

  openDialog(html`
    <form class="dialog-form" id="shift-form" novalidate data-track-changes>
      ${dialogHead(editing ? 'Edit Shift' : 'Add Shift', `${s.site.name} · Week ${isoWeek(days[0])}`)}
      <div class="dialog-body">
        ${pendingSwap ? html`
          <div class="callout">
            <p>${pendingSwap.from
              ? html`<strong>${pendingSwap.from.name}</strong> asked <strong>${pendingSwap.cover.name}</strong> to cover this shift. ${deltaPill(swapDelta(pendingSwap, state.penalties))}`
              : html`<strong>${pendingSwap.cover.name}</strong> wants to pick up this open shift.`}</p>
            <div class="callout-actions">
              <button type="button" class="btn btn-sm" data-action="decline" data-id="${shift.id}">Decline</button>
              <button type="button" class="btn btn-sm btn-primary" data-action="approve" data-id="${shift.id}">${icon('check')}${pendingSwap.from ? 'Approve Swap' : 'Give It to Them'}</button>
            </div>
          </div>` : ''}
        <div class="field">
          <label for="f-staff">Team Member</label>
          <select class="select" id="f-staff" name="staffId" data-field="staffId" data-autofocus>
            <option value="" ${openShift ? raw('selected') : ''}>Open shift (anyone suitable can ask for it)</option>
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

export function readShiftForm(form) {
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
      staffId: form.staffId.value === '' ? null : Number(form.staffId.value),
      siteId: state.schedule.site.id,
      start: isoLocal(start),
      end: isoLocal(end),
      breakMinutes: Number(form.breakMinutes.value),
      station: form.station.value,
      notes: form.notes.value.trim() || null,
    },
  };
}

export function wireShiftForm(form, shift) {
  const update = () => {
    const { body, hasTimes, overnight } = readShiftForm(form);
    const person = state.schedule.staff.find((p) => p.id === body.staffId);
    $('#overnight-hint', form).hidden = !overnight;
    const hint = $('#station-hint', form);
    const trained = person ? person.stations.split(', ').includes(body.station) : null;
    hint.hidden = Boolean(person) && trained !== false;
    hint.textContent = !person
      ? 'Staff at this site who are free and trained for this station can ask for it once the week is published.'
      : trained === false ? `${person.name} isn’t trained on ${body.station} yet. You can still roster them.` : '';
    const rate = person ? person.hourlyRate : state.schedule.estimatedRate;
    $('#cost-preview', form).textContent = hasTimes
      ? `${hrs(paidHours(body))} · ${money(shiftCost(body, rate, state.schedule.penalties))}${person ? '' : ' est.'}`
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
        const name = state.schedule.staff.find((p) => p.id === saved.staffId)?.name;
        const when = `${fmt.dow.format(parse(saved.start))} ${compact(saved.start, saved.end)}`;
        toast(shift ? 'Shift saved.' : name ? `Shift added for ${name}: ${when}.` : `Open shift added: ${when}.`);
        $(`[data-id="${saved.id}"]`)?.focus({ preventScroll: true });
        refreshQuietly(); // picks up fresh roster checks from the server
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
export async function openSwapRequest(shift, returnTo) {
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

export function setPending(shiftId, coverId) {
  for (const list of [state.schedule?.shifts, state.myShifts]) {
    const s = list?.find((x) => x.id === shiftId);
    if (s) { s.pendingCoverId = coverId; s.pendingCoverName = coverId ? nameOf(coverId) : null; }
  }
  state.render?.();
}

/* --------------------------------------------------------------------------
   Swaps list
   -------------------------------------------------------------------------- */
export async function viewSwaps() {
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

export function renderSwaps() {
  if (state.view !== 'swaps') return;
  const manager = isManager();
  const me = state.me.id;
  const swaps = [...state.swaps].sort((a, b) => parse(a.start) - parse(b.start));
  const totalDelta = manager ? swaps.filter((s) => s.from).reduce((sum, s) => sum + (swapDelta(s, state.penalties) ?? 0), 0) : 0;
  $('#content').innerHTML = html`
    <header class="page-head">
      <div class="page-title">
        <h1>Swaps & Requests</h1>
        <p class="page-sub">${manager
          ? html`Swaps and open-shift pick-ups, approved in one tap. ${swaps.some((s) => s.from) ? html`Approving every swap changes labour cost by <strong class="num">${totalDelta < 0 ? '−' : '+'}${money(Math.abs(totalDelta))}</strong>.` : ''}`
          : 'Swaps you’ve asked for, shifts you’ve been asked to cover, and open shifts you’ve asked to pick up.'}</p>
      </div>
    </header>
    ${swaps.length ? html`<div class="list">${swaps.map((s) => {
      const start = parse(s.start);
      const mineToCancel = s.from?.id === me;
      const askedMe = s.cover.id === me;
      const title = !s.from
        ? (askedMe && !manager ? 'You asked to pick up this open shift' : html`${s.cover.name} wants to pick up an open shift`)
        : manager ? html`${s.from.name} → ${s.cover.name}` : mineToCancel ? `You asked ${s.cover.name}` : `${s.from.name} asked you`;
      const label = s.from ? `${s.from.name} asked ${s.cover.name} to cover ${fmt.dayLong.format(start)}` : `${s.cover.name} asked to pick up the open shift on ${fmt.dayLong.format(start)}`;
      return html`
        <article class="card is-pending" aria-label="${label}">
          <div class="card-date" aria-hidden="true"><small>${fmt.dow.format(start)}</small><strong>${fmt.dayNum.format(start)}</strong></div>
          <div class="card-body">
            <span class="card-title">${title}</span>
            <span class="card-meta">
              <span class="num">${icon('clock')}${fmt.dayShort.format(start)}, ${fullRange(s.start, s.end)}</span>
              <span>${icon('pin')}${s.site}</span>
              <span data-station="${s.station}"><span class="station-dot" aria-hidden="true"></span>${s.station}</span>
              ${!s.from ? html`<span class="status is-open">${icon('hand')}Open shift</span>` : ''}
              ${manager ? (s.from ? deltaPill(swapDelta(s, state.penalties)) : '') : html`<span class="status is-pending">Waiting for approval</span>`}
            </span>
          </div>
          <div class="card-actions">
            ${manager ? html`
              <button type="button" class="btn" data-action="decline" data-id="${s.shiftId}">Decline</button>
              <button type="button" class="btn btn-primary" data-action="approve" data-id="${s.shiftId}">${icon('check')}Approve</button>`
            : mineToCancel || (!s.from && askedMe) ? html`<button type="button" class="btn btn-danger" data-action="decline" data-id="${s.shiftId}">Cancel Request</button>`
            : askedMe ? html`<button type="button" class="btn btn-danger" data-action="decline" data-id="${s.shiftId}">Decline</button>` : ''}
          </div>
        </article>`;
    })}</div>` : html`
      <div class="empty">
        ${icon('swap')}
        <h2>No Requests</h2>
        <p>${manager ? 'You’re all caught up. New requests appear here the moment someone asks for cover.' : 'Need a shift covered? Open it from My Shifts and choose a teammate.'}</p>
        <a class="btn" href="${manager ? `/app/schedule${state.lastScheduleQuery}` : '/app/my-shifts'}">${manager ? 'Go to Schedule' : 'Go to My Shifts'}</a>
      </div>`}`.v;
}

export const listSkeleton = (title) => html`
  <header class="page-head"><div class="page-title"><h1>${title}</h1><p class="page-sub"><span class="skeleton line w-240"></span></p></div></header>
  <div class="list" aria-busy="true" aria-label="Loading">${[0, 1, 2].map(() => html`<div class="card"><div class="card-date skeleton"></div><div class="card-body"><span class="skeleton line w-40"></span><span class="skeleton line w-70"></span></div></div>`)}</div>`;

/* --------------------------------------------------------------------------
   My shifts (phone-first)
   -------------------------------------------------------------------------- */
export async function viewMyShifts() {
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

export function renderMyShifts() {
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
export const findShift = (id) => state.schedule?.shifts.find((s) => s.id === id) ?? state.myShifts?.find((s) => s.id === id);
export const snapshot = () => ({ schedule: structuredClone(state.schedule), swaps: structuredClone(state.swaps), myShifts: structuredClone(state.myShifts) });
export const restore = (snap) => { Object.assign(state, snap); updateBadges(); state.render?.(); };

Object.assign(actions, {
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
    staffId: el.dataset.staff === '' ? null : Number(el.dataset.staff), dayIndex: Number(el.dataset.day),
    returnTo: `[data-action="add-shift"][data-staff="${el.dataset.staff}"][data-day="${el.dataset.day}"]`,
  }),

  'publish-week': (el) => openPublishDialog(el),

  'unpublish-week': async (el) => {
    const s = state.schedule;
    if (!confirm(`Move Week ${s.week.number} at ${s.site.name} back to draft? Staff won’t see it until you publish again.`)) return;
    await withLoading(el, async () => {
      try {
        await api('/schedule/unpublish', { method: 'POST', body: { siteId: s.site.id, week: s.weekStart } });
        toast(`Week ${s.week.number} is a draft again.`);
        await refreshQuietly();
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
  },

  'copy-week': async (el) => {
    const s = state.schedule;
    await withLoading(el, async () => {
      try {
        const result = await api('/schedule/copy', { method: 'POST', body: { siteId: s.site.id, week: s.weekStart } });
        const opened = result.opened.length;
        toast(`Copied ${plural(result.copied, 'shift', 'shifts')} from last week.${opened ? ` ${plural(opened, 'shift became an open shift', 'shifts became open shifts')} because of leave or availability.` : ''}`);
        await refreshQuietly();
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
  },

  'export-roster': () => exportRosterCsv(),
  'print-roster': () => print(),

  'focus-shift': (el) => {
    const chip = $(`[data-action="open-shift"][data-id="${el.dataset.id}"]`);
    if (!chip) return;
    chip.scrollIntoView({ block: 'center', inline: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    chip.focus({ preventScroll: true });
    chip.classList.remove('is-flash');
    void chip.offsetWidth;
    chip.classList.add('is-flash');
  },

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
    const cancelling = (swap ? (swap.from?.id ?? swap.cover.id) : shift?.staffId) === state.me.id;
    markMine(id);
    state.swaps = state.swaps.filter((s) => s.shiftId !== id);
    setPending(id, null);
    updateBadges();
    try {
      await api(`/shifts/${id}/swap/decline`, { method: 'POST' });
      const undo = isManager() && coverId && swap?.from
        ? { action: 'Undo', onAction: async () => {
            try { markMine(id); await api(`/shifts/${id}/swap`, { method: 'POST', body: { coverId } }); refreshQuietly(); }
            catch (e) { toast(e.message, { tone: 'error' }); }
          } }
        : {};
      const openShift = swap ? !swap.from : shift?.staffId == null;
      toast(openShift
        ? (cancelling ? 'Request withdrawn. The shift stays open for others.' : 'Request declined. The shift stays open.')
        : cancelling ? 'Request cancelled. You’re still on this shift.' : isManager() ? 'Swap declined.' : 'Declined. They’ll be able to ask someone else.', undo);
      refreshQuietly();
    } catch (e) {
      restore(snap);
      toast(e.message, { tone: 'error' });
    }
  },
});

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

