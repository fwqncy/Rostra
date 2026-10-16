import { $, $$, actions, addDays, api, clearErrors, closeDialog, compact, dateSpan, dialog, dialogHead, errorSlot, fmt, fromServer, hrs, html, icon, initials, isManager, isoLocal, locales, money, NBSP, openDialog, pad, parse, parseDay, plural, raw, rtf, showErrors, startOfWeek, state, toast, withLoading, ymd } from './core.js';
import { navigate, STATIONS, timeValue } from './app.js';

/* --------------------------------------------------------------------------
   Dashboard (managers): tasks, who's in, time clock, wages, weekly planner
   -------------------------------------------------------------------------- */
export const WIDGETS = {
  tasks: 'What Should I Work On?',
  who: 'Who’s In Today?',
  feed: 'Live Time Clock Feed',
  wages: 'Live Wage Tracker',
  planner: 'Weekly Planner',
};
export const HIDDEN_KEY = 'rostra.dash.hidden';
export const dash = { tasks: null, today: null, feed: null, wages: null, week: null, skew: 0, timer: null, observer: null };
export const pct1 = new Intl.NumberFormat(locales, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const hourLabel = new Intl.DateTimeFormat(locales, { hour: 'numeric' });

export let hiddenWidgets = (() => {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]').filter((k) => k in WIDGETS)); } catch { return new Set(); }
})();
export const saveHidden = () => { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenWidgets])); } catch { /* ignore */ } };

/** Venue wall-clock time, from the server (venues can be in a different zone to this browser). */
export const venueNow = () => new Date(Date.now() + dash.skew);
export const syncClock = (serverNow) => { dash.skew = parse(serverNow) - Date.now(); };
export const siteName = (id) => state.me.sites.find((s) => s.id === id)?.name ?? '';
export const minutesBetween = (a, b) => Math.round((b - a) / 60000);
export function duration(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  return `${Math.floor(mins / 60)}h${NBSP}${pad(mins % 60)}m`;
}
export function relativeTime(date) {
  const mins = minutesBetween(date, venueNow());
  if (Math.abs(mins) < 60) return rtf.format(-mins, 'minute');
  if (Math.abs(mins) < 60 * 24) return rtf.format(-Math.round(mins / 60), 'hour');
  return rtf.format(-Math.round(mins / 1440), 'day');
}

/* URL-backed widget filters, so the dashboard deep-links and survives refresh. */
export function dashParams() {
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
export function setDashParam(key, value) {
  const p = new URLSearchParams(location.search);
  if (value == null) p.delete(key); else p.set(key, value);
  const qs = p.toString();
  history.replaceState(history.state, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
}

export const siteOptions = (selected, allLabel) => html`
  ${allLabel ? html`<option value="" ${selected === '' ? raw('selected') : ''}>${allLabel}</option>` : ''}
  ${state.me.sites.map((s) => html`<option value="${s.id}" ${String(s.id) === selected ? raw('selected') : ''}>${s.name}</option>`)}`;
export const miniSelect = (id, label, options, key) => html`
  <label class="mini-select" for="${id}"><span class="sr-only">${label}</span>
    <select class="select select-sm" id="${id}" name="${key}" data-dash="${key}">${options}</select>
  </label>`;

export function widget(id, tools, body) {
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
export const skeletonRows = (n) => html`<div class="widget-skeleton" aria-busy="true" aria-label="Loading">${[...Array(n)].map(() => html`<span class="skeleton line"></span>`)}</div>`;

export async function viewDashboard() {
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

export const LOADERS = {
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

export async function loadDashboard(only = Object.keys(LOADERS)) {
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
export const busy = (el) => el?.contains(document.activeElement) && document.activeElement !== el && el.dataset.rendered;

export function updateHiddenNote() {
  const note = $('#hidden-note');
  if (!note) return;
  note.innerHTML = hiddenWidgets.size
    ? html`${plural(hiddenWidgets.size, 'widget hidden', 'widgets hidden')} · <button type="button" class="link-btn" data-action="show-widgets">Show All</button>`.v
    : '';
}

/* ---------------------------- What should I work on? ---------------------------- */
export function renderTasks() {
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
  for (const w of t.unpublished || []) items.push({
    key: `publish-${w.siteId}-${w.weekStart}`, icon: 'send', href: `/app/schedule?site=${w.siteId}&week=${w.weekStart}`, cta: 'Review & Publish',
    title: `Week ${w.weekNumber} at ${w.site} is still a draft. Staff can’t see it yet.`,
  });
  if (t.openShifts?.unclaimed) items.push({
    key: 'open-shifts', icon: 'hand', href: '/app/home#home-open', cta: 'See Open Shifts',
    title: `${plural(t.openShifts.unclaimed, 'open shift needs', 'open shifts need')} someone in the next two weeks.`,
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
export function renderToday() {
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

export function whoRow(s, now) {
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
  } else if (s.isOpen) {
    state = 'missed';
    time = fmt.time.format(start);
    meta = `${s.station} · ${compact(s.start, s.end)}`;
    pill = html`<span class="status is-danger">${icon('hand')}Unfilled</span>`;
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
export function renderFeed() {
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
export function renderWages() {
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

export function wagePoints() {
  return dash.wages.points.map((p) => ({ t: parse(p.t), r: p.rostered, a: p.actual }));
}

export function renderWageTable() {
  const el = $('#wt-table-body');
  if (!el) return;
  const pts = wagePoints().filter((p) => p.t.getMinutes() === 0);
  el.innerHTML = pts.length ? html`
    <table class="data-table">
      <thead><tr><th scope="col">Time</th><th scope="col">On shift</th><th scope="col">Rostered</th></tr></thead>
      <tbody>${pts.map((p) => html`<tr><th scope="row">${fmt.time.format(p.t)}</th><td class="num">${p.a ?? '—'}</td><td class="num">${p.r}</td></tr>`)}</tbody>
    </table>`.v : '';
}

export function drawWageChart() {
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
export function renderWeek() {
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
export function openManualPunch(returnTo) {
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

export function parseRevenueCsv(text) {
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

export function openRevenueUpload(returnTo) {
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
export const RELOAD_FOR = { who: ['who'], feed: ['feed'], wsite: ['wages'], wst: ['wages'], wdate: ['wages'], psite: ['planner'], pweek: ['planner'], pmetric: [] };
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
export let feedSearchTimer;
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

export function showWidgets(ids) {
  ids.forEach((id) => { hiddenWidgets.delete(id); const el = $(`#w-${id}`); if (el) el.hidden = false; });
  saveHidden();
  updateHiddenNote();
  loadDashboard(ids);
}

