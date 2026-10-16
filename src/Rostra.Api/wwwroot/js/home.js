import { $, $$, actions, addDays, api, clearErrors, closeDialog, compact, dateSpan, dayLabel, dialog, dialogHead, errorSlot, fmt, fromServer, fullRange, hrs, html, icon, isMac, isManager, locales, NBSP, onLeavePage, openDialog, parse, parseDay, plural, raw, reducedMotion, rtf, showErrors, startOfWeek, state, timeAgo, toast, withLoading, withSkeleton, ymd } from './core.js';
import { errorState, loadSwaps, updateBadges } from './app.js';
import { FRUITING, growthFor, nextStage, secondsForGrowth, stageFor } from './growth.js';

/* --------------------------------------------------------------------------
   Home: next shift, this week's pay, notifications, availability & leave
   -------------------------------------------------------------------------- */
export const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const payFormats = new Map();
// Pay is personal, so it shows cents, and does so everywhere on this page.
export function formatPay(n) {
  const currency = state.me?.company.currency || 'AUD';
  if (!payFormats.has(currency))
    payFormats.set(currency, new Intl.NumberFormat(locales, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  return payFormats.get(currency).format(n);
}
export const monthShort = new Intl.DateTimeFormat(locales, { month: 'short' });
export const dayName = (key) => fmt.dow.format(addDays(new Date(2024, 0, 1), DAY_KEYS.indexOf(key))); // 1 Jan 2024 was a Monday

export async function viewHome() {
  state.view = 'home';
  state.render = renderHome;
  document.title = `Home · ${state.me.company.name}`;
  const content = $('#content');
  try {
    await withSkeleton(content, homeSkeleton(), () => Promise.all([fetchHome(), loadSwaps()]));
    if (state.view !== 'home') return;
    updateBadges();
    renderHome();
  } catch (e) {
    if (e.status !== 401) content.innerHTML = errorState(e.message).v;
  }
}

export const homeSkeleton = () => html`
  <div class="home" aria-busy="true" aria-label="Loading">
    <div class="home-main">
      <section class="home-hero"><span class="skeleton line w-40"></span></section>
      <section class="home-card"><span class="skeleton shift-sk"></span></section>
      <section class="home-card"><span class="skeleton shift-sk"></span><span class="skeleton line"></span></section>
    </div>
    <div class="home-side"><section class="home-card"><span class="skeleton line"></span><span class="skeleton line w-60"></span></section></div>
  </div>`;

/** Everything Home shows, fetched together. Parts that fail just show their own error. */
export async function fetchHome() {
  const [home, grove, open, announcements, kudos] = await Promise.all([
    api('/home'), api('/me/grove').catch(() => null), api('/open-shifts').catch(() => []),
    api('/announcements').catch(() => []), api('/kudos').catch(() => null),
  ]);
  state.home = { ...home, grove, open, announcements, kudos };
}
export async function refreshHome() {
  await fetchHome();
}

/** Builds the page once; later refreshes only repaint the live parts so half-filled forms survive. */
export function renderHome() {
  if (state.view !== 'home' || !state.home) return;
  if (!$('#home-root')) {
    const h = state.home;
    const today = ymd(new Date());
    $('#content').innerHTML = html`
      <div class="home" id="home-root">
        <div class="home-main">
          <header class="home-hero">
            <p class="eyebrow home-eyebrow">${fmt.dayLong.format(new Date())}</p>
            <h1 class="home-brand"><img src="/brand/rostra-mark.svg" alt="" width="40" height="40"><span class="display weathered" translate="no">rostra</span><span class="sr-only"> Home</span></h1>
            <p class="home-company display" translate="no">${state.me.company.name}</p>
            <p class="home-greeting">Hi ${state.me.name.split(' ')[0]}. Here’s your week.</p>
            <svg class="home-fern" viewBox="0 0 160 200" aria-hidden="true" focusable="false">
              <path d="M150 200 C 120 150, 95 110, 40 20"/>
              ${[0, 1, 2, 3, 4, 5, 6].map((i) => raw(`<path d="M${138 - i * 15} ${178 - i * 24} q -${26 - i * 2} -6 -${38 - i * 3} -${16 - i}"/><path d="M${138 - i * 15} ${178 - i * 24} q ${8 + i} -${18 - i} ${4 + i} -${32 - i * 2}"/>`))}
            </svg>
          </header>
          <section class="home-card next-card" id="home-next" aria-label="Next shift"></section>
          <section class="home-card" id="home-earn" aria-labelledby="earn-title"></section>
          <section class="home-card grove-card" id="grove" aria-labelledby="grove-title"></section>
        </div>
        <div class="home-side">
          <section class="home-card" aria-labelledby="notes-title">
            <h2 class="card-heading" id="notes-title">${icon('bell')}Notifications</h2>
            <div id="home-notes" aria-live="polite"></div>
          </section>
          <section class="home-card" id="home-open" aria-labelledby="open-title"></section>
          <section class="home-card" id="home-news" aria-labelledby="news-title"></section>
          <section class="home-card" id="kudos" aria-labelledby="kudos-title">
            <h2 class="card-heading" id="kudos-title">${icon('heart')}Kudos</h2>
            <form id="kudos-form" novalidate>
              <div class="field">
                <label for="kd-to">Thank a Teammate</label>
                <select class="select" id="kd-to" name="toStaffId" data-field="toStaffId"><option value="">Choose someone…</option></select>
                ${errorSlot('toStaffId', 'kd-to-error')}
              </div>
              <div class="field">
                <label for="kd-message">What For?</label>
                <input class="input" id="kd-message" name="message" type="text" maxlength="140" autocomplete="off" placeholder="e.g. Thanks for covering Saturday…" data-field="message">
                ${errorSlot('message', 'kd-message-error')}
              </div>
              <button type="submit" class="btn">${icon('heart')}Send Kudos</button>
            </form>
            <div id="kudos-wall"></div>
          </section>
          <section class="home-card" id="leave" aria-labelledby="avail-title">
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
              <div class="row-2">
                <div class="field">
                  <label for="lv-type">Type</label>
                  <select class="select" id="lv-type" name="type" data-field="type">
                    ${['Annual', 'Sick', 'Personal', 'Unpaid', 'Other'].map((t) => html`<option value="${t}">${t === 'Annual' ? 'Annual leave' : t === 'Sick' ? 'Sick or carer’s' : t}</option>`)}
                  </select>
                </div>
                <div class="field">
                  <label for="lv-reason">Reason</label>
                  <input class="input" id="lv-reason" name="reason" type="text" maxlength="200" autocomplete="off" placeholder="e.g. Family wedding…" data-field="reason">
                </div>
              </div>
              ${errorSlot('reason', 'lv-reason-error')}
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
  renderGrove();
  renderOpenShifts();
  renderAnnouncements();
  renderKudos();
  if (location.hash && !state.homeScrolled) {
    state.homeScrolled = true;
    $(location.hash)?.scrollIntoView({ block: 'start' });
  }
}

export function renderNextShift() {
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

export function renderEarnings() {
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
             aria-valuenow="${w.completed.pay.toFixed(2)}" aria-valuetext="${formatPay(w.completed.pay)} of ${formatPay(total.pay)}">
          <svg viewBox="0 0 120 120" width="132" height="132" aria-hidden="true">
            <circle class="gauge-track" cx="60" cy="60" r="${r}"></circle>
            <circle class="gauge-fill" cx="60" cy="60" r="${r}" stroke-dasharray="${(share * circumference).toFixed(1)} ${circumference.toFixed(1)}"></circle>
          </svg>
          <div class="gauge-label"><strong class="num">${formatPay(w.completed.pay)}</strong><span class="num">of ${formatPay(total.pay)}</span></div>
        </div>
        <table class="earn-table">
          <thead><tr><th scope="col"><span class="sr-only">Status</span></th><th scope="col">Hours</th><th scope="col">Est. Pay</th></tr></thead>
          <tbody>
            <tr><th scope="row">Pending <small>${plural(w.pending.count, 'shift', 'shifts')}</small></th><td class="num">${fmt.hours.format(w.pending.hours)}</td><td class="num">${formatPay(w.pending.pay)}</td></tr>
            <tr><th scope="row">Completed <small>${plural(w.completed.count, 'shift', 'shifts')}</small></th><td class="num">${fmt.hours.format(w.completed.hours)}</td><td class="num">${formatPay(w.completed.pay)}</td></tr>
          </tbody>
          <tfoot><tr><th scope="row">Total</th><td class="num">${fmt.hours.format(total.hours)}</td><td class="num">${formatPay(total.pay)}</td></tr></tfoot>
        </table>
      </div>
      <p class="earn-note muted">Estimated before tax, at your hourly rate with weekend penalty rates. Completed shifts use your clocked hours. Updated ${fmt.time.format(new Date())}.</p>`
    : html`<p class="nothing">No shifts this week, so nothing earned yet.</p>`}`.v;
}

export function renderNotifications() {
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
    const [title, sub] = !s.from
      ? (isManager() ? [`${s.cover.name} wants to pick up ${when}`, 'Open shift · needs your approval'] : [`You asked to pick up ${when}`, 'Open shift · waiting for your manager'])
      : isManager()
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

export function renderLeaveList() {
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
          <span class="muted">${t.type && t.type !== 'Annual' ? `${t.type} · ` : ''}${t.reason}</span>
        </div>
        <span class="status ${t.status === 'Approved' ? 'is-save' : t.status === 'Declined' ? 'is-danger' : 'is-pending'}">${t.status}</span>
        ${t.from > today && t.status !== 'Declined' ? html`<button type="button" class="btn btn-ghost btn-sm" data-action="cancel-leave" data-id="${t.id}" aria-label="Cancel leave on ${dateSpan(t.from, t.to)}">Cancel</button>` : ''}
      </li>`)}</ul>` .v : '';
}

export function wireHomeForms() {
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
    const body = { from: leave.from.value || null, to: leave.to.value || null, reason: leave.reason.value.trim(), type: leave.type.value };
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


/* --------------------------------------------------------------------------
   The Grove: your tree grows with time spent in Rostra; apples are roster weeks
   -------------------------------------------------------------------------- */
let grove = null;
let groveFallback = false;

function groveCopy(g) {
  const manager = isManager();
  const apples = state.home.grove?.apples ?? [];
  const ripe = apples.filter((a) => a.status === 'published' || a.status === 'completed').length;
  const unripe = apples.length - ripe;
  const stage = stageFor(g);
  const next = nextStage(g);
  const hoursTo = next ? Math.max(0, (secondsForGrowth(next.at) - (state.home.grove?.activeSeconds ?? 0)) / 3600) : 0;
  return { manager, apples, ripe, unripe, stage, next, hoursTo };
}

function renderGrove() {
  const el = $('#grove');
  const data = state.home.grove;
  if (!el || !data) { if (el) el.hidden = true; return; }
  const g = growthFor(data.activeSeconds);
  const c = groveCopy(g);
  const progress = c.next ? (g - c.stage.at) / (c.next.at - c.stage.at) : 1;
  const firstRender = !el.dataset.ready;
  if (firstRender) {
    el.dataset.ready = '1';
    el.innerHTML = html`
      <header class="grove-head">
        <div>
          <h2 class="card-heading" id="grove-title">${icon('tree')}Your Grove</h2>
          <p class="muted grove-sub">Your cherry tree grows the longer you use Rostra. Drag to turn it. Each apple is a ${c.manager ? 'site’s roster week' : 'week you’re rostered'}.</p>
        </div>
        <span class="status grove-season">${icon('tree')}Cherry blossom</span>
      </header>
      <div class="grove-stage" id="grove-stage">
        <canvas class="grove-canvas" id="grove-canvas" role="img" aria-describedby="grove-summary"></canvas>
        <div class="grove-tip" id="grove-tip" role="status" hidden></div>
        <noscript><p>Your tree needs JavaScript.</p></noscript>
      </div>
      <div class="grove-foot">
        <div class="grove-progress">
          <p><strong id="grove-stage-name"></strong> <span class="muted" id="grove-next"></span></p>
          <div class="meter" role="meter" aria-label="Growth to the next stage" aria-valuemin="0" aria-valuemax="100" id="grove-meter"><span class="meter-fill" id="grove-fill"></span></div>
        </div>
        <ul class="grove-legend" aria-label="What the tree shows">
          <li><span class="apple-dot is-red" aria-hidden="true"></span><span id="legend-red"></span></li>
          <li><span class="apple-dot is-green" aria-hidden="true"></span><span id="legend-green"></span></li>
          <li><span class="firefly-dot" aria-hidden="true"></span><span id="legend-fireflies"></span></li>
        </ul>
      </div>
      <p class="sr-only" id="grove-summary"></p>
      <details class="grove-list">
        <summary>Show All Apples</summary>
        <ul id="grove-apples"></ul>
      </details>`.v;
    mountGroveScene();
  }
  $('#grove-stage-name').textContent = c.stage.name;
  $('#grove-next').textContent = c.next
    ? `· ${hrs(c.hoursTo)} more to ${c.next.name}${g < FRUITING ? ' (apples start growing then)' : ''}`
    : '· Fully grown. Every week still adds fruit.';
  $('#grove-meter').setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  $('#grove-fill').style.setProperty('--fill', String(Math.min(1, Math.max(0, progress))));
  $('#legend-red').textContent = c.manager ? `${c.ripe} published ${c.ripe === 1 ? 'roster' : 'rosters'}` : `${c.ripe} ${c.ripe === 1 ? 'week' : 'weeks'} worked`;
  $('#legend-green').textContent = c.manager ? `${c.unripe} ${c.unripe === 1 ? 'draft' : 'drafts'} not yet published` : `${c.unripe} ${c.unripe === 1 ? 'week' : 'weeks'} coming up`;
  $('#legend-fireflies').textContent = `${data.fireflies} ${data.fireflies === 1 ? 'firefly' : 'fireflies'} from kudos this month`;
  $('#grove-summary').textContent = `Your tree is a ${c.stage.name.toLowerCase()} with ${c.ripe} red and ${c.unripe} green apples${g < FRUITING ? ' still to come' : ''}, and ${data.fireflies} fireflies.`;
  $('#grove-apples').innerHTML = c.apples.length
    ? [...c.apples].reverse().map((a) => html`<li><span class="apple-dot ${a.status === 'published' || a.status === 'completed' ? 'is-red' : 'is-green'}" aria-hidden="true"></span>${a.label} <span class="muted">· ${{ published: 'Published', draft: 'Draft', completed: 'Worked', upcoming: 'Coming up' }[a.status]}</span></li>`.v).join('')
    : html`<li class="nothing">No roster weeks yet.</li>`.v;
  if (!firstRender) grove?.update(data);
  if (groveFallback) renderGroveFallback(g, c);
}

async function mountGroveScene() {
  const canvas = $('#grove-canvas');
  const tip = $('#grove-tip');
  try {
    const scene = await import('./scenes/grove.js');
    if (!canvas.isConnected) return;
    grove = scene.mountGrove(canvas, {
      seed: state.me.id * 2654435761 % 4294967296,
      data: state.home.grove,
      reduced: reducedMotion(),
      onHover: (apple) => {
        if (!apple) { tip.hidden = true; return; }
        tip.textContent = `${apple.label} · ${{ published: 'Published roster', draft: 'Draft roster', completed: 'Week worked', upcoming: 'Week coming up' }[apple.status]}`;
        tip.hidden = false;
        tip.style.setProperty('left', `${apple.x + 14}px`);
        tip.style.setProperty('top', `${apple.y - 10}px`);
      },
    });
    onLeavePage(() => { grove?.destroy(); grove = null; });
  } catch {
    groveFallback = true;
    renderGroveFallback(growthFor(state.home.grove.activeSeconds), groveCopy(growthFor(state.home.grove.activeSeconds)));
  }
}

/** No WebGL: a flat illustration with the same meaning. */
function renderGroveFallback(g, c) {
  const stage = $('#grove-stage');
  if (!stage) return;
  const h = 40 + g * 120;
  stage.classList.add('is-fallback');
  stage.innerHTML = html`<svg viewBox="0 0 300 220" class="grove-svg" aria-hidden="true">
    <ellipse cx="150" cy="205" rx="120" ry="14" class="grove-svg-ground"/>
    <path d="M150 205 C 148 ${205 - h * 0.5}, 152 ${205 - h * 0.8}, 150 ${205 - h}" class="grove-svg-trunk" stroke-width="${4 + g * 10}"/>
    <circle cx="150" cy="${205 - h}" r="${12 + g * 60}" class="grove-svg-canopy"/>
    ${g >= 0.3 ? c.apples.slice(-12).map((a, i) => raw(`<circle cx="${150 + Math.cos(i * 2.4) * (8 + g * 45)}" cy="${205 - h + Math.sin(i * 2.4) * (6 + g * 35)}" r="6" class="${a.status === 'published' || a.status === 'completed' ? 'grove-svg-red' : 'grove-svg-green'}"/>`)) : ''}
  </svg>`.v;
}

document.addEventListener('grove:grow', (e) => {
  if (!state.home?.grove) return;
  state.home.grove.activeSeconds = e.detail.activeSeconds;
  grove?.growTo(e.detail.activeSeconds);
  if (state.view === 'home') renderGrove();
});

/* --------------------------------------------------------------------------
   Open shifts, announcements and kudos
   -------------------------------------------------------------------------- */
function renderOpenShifts() {
  const el = $('#home-open');
  if (!el) return;
  const list = state.home.open || [];
  const manager = isManager();
  el.innerHTML = html`
    <h2 class="card-heading" id="open-title">${icon('hand')}Open Shifts</h2>
    ${list.length ? html`<ul class="open-list">${list.slice(0, 6).map((o) => {
      const start = parse(o.start);
      return html`<li class="open-item" data-station="${o.station}">
        <div class="card-date" aria-hidden="true"><small>${fmt.dow.format(start)}</small><strong>${fmt.dayNum.format(start)}</strong></div>
        <div class="open-text">
          <strong class="num">${compact(o.start, o.end)} · ${o.station}</strong>
          <span class="muted">${o.site}${o.notes ? ` · ${o.notes}` : ''}</span>
          ${o.claimedByMe ? html`<span class="status is-pending">You asked for it</span>`
            : o.claimedBy ? html`<span class="status">${manager ? `${o.claimedBy} asked for it` : 'Someone asked for it'}</span>`
            : !manager && o.reason ? html`<span class="muted open-reason">${o.reason}</span>` : ''}
        </div>
        ${manager ? html`<a class="btn btn-sm" href="/app/schedule?site=${o.siteId}&week=${ymd(startOfWeek(start))}">View</a>`
          : o.claimedByMe ? html`<button type="button" class="btn btn-sm" data-action="decline" data-id="${o.id}">Withdraw</button>`
          : !o.reason ? html`<button type="button" class="btn btn-sm btn-primary" data-action="claim-open" data-id="${o.id}">Ask for It</button>` : ''}
      </li>`;
    })}</ul>` : html`<p class="nothing">Nothing up for grabs right now.</p>`}`.v;
}

function renderAnnouncements() {
  const el = $('#home-news');
  if (!el) return;
  const list = state.home.announcements || [];
  const manager = isManager();
  el.innerHTML = html`
    <div class="card-heading-row">
      <h2 class="card-heading" id="news-title">${icon('megaphone')}Announcements</h2>
      ${manager ? html`<button type="button" class="btn btn-sm" data-action="new-announcement">${icon('plus')}Post…</button>` : ''}
    </div>
    ${list.length ? html`<ul class="news-list">${list.slice(0, 4).map((a) => html`
      <li class="news-item ${a.requiresAck && !a.readByMe ? 'needs-ack' : ''}">
        <div class="news-head">
          <strong>${a.title}</strong>
          <span class="muted">${a.author} · ${timeAgo(parse(a.createdAt))}${a.site ? ` · ${a.site}` : ' · Everyone'}</span>
        </div>
        <p class="news-body">${a.body}</p>
        <div class="news-foot">
          ${manager && a.reads != null ? html`<span class="status">${icon('check')}${a.reads} of ${a.audience} read</span>` : ''}
          ${a.readByMe ? html`<span class="status is-save">${icon('check')}You’ve read this</span>`
            : html`<button type="button" class="btn btn-sm ${a.requiresAck ? 'btn-primary' : ''}" data-action="ack-announcement" data-id="${a.id}">${a.requiresAck ? 'Got It' : 'Mark as Read'}</button>`}
          ${a.canDelete ? html`<button type="button" class="btn btn-ghost btn-sm" data-action="delete-announcement" data-id="${a.id}" aria-label="Delete announcement: ${a.title}">Delete</button>` : ''}
        </div>
      </li>`)}</ul>` : html`<p class="nothing">No announcements yet.</p>`}`.v;
}

// The team list is fetched once, but Home's markup is rebuilt on every visit,
// so fill whichever dropdown is on screen whenever it's still empty.
let directory = null;
async function renderKudos() {
  const wall = $('#kudos-wall');
  if (!wall) return;
  const select = $('#kd-to');
  if (select && select.options.length <= 1) {
    try {
      if (directory?.company !== state.me.company.id) directory = { company: state.me.company.id, people: await api('/team/directory') };
      if (select.isConnected && select.options.length <= 1)
        directory.people.filter((p) => p.id !== state.me.id).forEach((p) => select.add(new Option(`${p.name} · ${p.title}`, p.id)));
    } catch { /* the next refresh retries */ }
  }
  const k = state.home.kudos;
  if (!k) { wall.innerHTML = ''; return; }
  wall.innerHTML = html`
    <p class="kudos-count"><span class="firefly-dot" aria-hidden="true"></span>${plural(k.receivedLast30Days, 'kudos', 'kudos')} received this month · ${plural(k.givenLast30Days, 'sent', 'sent')}</p>
    <ul class="kudos-list">${k.wall.slice(0, 5).map((x) => html`
      <li><strong>${x.from}</strong> <span class="muted">to</span> <strong>${x.to}</strong> <span class="muted">· ${timeAgo(parse(x.createdAt))}</span><q>${x.message}</q></li>`)}</ul>`.v;
}

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'kudos-form') return;
  e.preventDefault();
  const form = e.target;
  clearErrors(form);
  const toStaffId = Number(form.toStaffId.value);
  const message = form.message.value.trim();
  const errors = {};
  if (!toStaffId) errors.toStaffId = 'Choose who you’re thanking.';
  if (!message) errors.message = 'Say what you’re thanking them for.';
  if (Object.keys(errors).length) return showErrors(form, errors);
  await withLoading(e.submitter, async () => {
    try {
      const result = await api('/kudos', { method: 'POST', body: { toStaffId, message } });
      form.reset();
      toast(`Kudos sent to ${result.name}. A firefly is glowing in their tree.`);
      state.home.kudos = await api('/kudos');
      renderKudos();
    } catch (err) {
      if (err.errors) return showErrors(form, fromServer(err.errors));
      toast(err.message, { tone: 'error' });
    }
  });
});

function openAnnouncementDialog(returnTo) {
  openDialog(html`
    <form class="dialog-form" id="news-form" novalidate data-track-changes>
      ${dialogHead('Post an Announcement', 'Everyone you choose gets it in their bell and on Home.')}
      <div class="dialog-body">
        <div class="field">
          <label for="an-title">Title</label>
          <input class="input" id="an-title" name="title" maxlength="120" autocomplete="off" placeholder="e.g. Fire drill on Friday…" data-field="title" data-autofocus>
          ${errorSlot('title', 'an-title-error')}
        </div>
        <div class="field">
          <label for="an-body">Message</label>
          <textarea class="textarea" id="an-body" name="body" maxlength="2000" rows="5" placeholder="What does the team need to know?…" data-field="body"></textarea>
          <p class="field-hint">Press ${isMac ? '⌘' : 'Ctrl'}${NBSP}Enter to post.</p>
          ${errorSlot('body', 'an-body-error')}
        </div>
        <div class="field">
          <label for="an-site">Who Sees It</label>
          <select class="select" id="an-site" name="siteId">
            <option value="">Everyone at ${state.me.company.name}</option>
            ${state.me.sites.map((site) => html`<option value="${site.id}">${site.name} only</option>`)}
          </select>
        </div>
        <label class="check"><input type="checkbox" name="requiresAck"> Ask people to confirm they’ve read it</label>
      </div>
      <div class="dialog-foot"><span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">${icon('send')}Post Announcement</button>
      </div>
    </form>`, { returnTo });
  const form = $('#news-form', dialog);
  form.body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const body = { title: form.title.value.trim(), body: form.body.value.trim(), siteId: form.siteId.value ? Number(form.siteId.value) : null, requiresAck: form.requiresAck.checked };
    const errors = {};
    if (!body.title) errors.title = 'Give the announcement a title.';
    if (!body.body) errors.body = 'Write the announcement.';
    if (Object.keys(errors).length) return showErrors(form, errors);
    await withLoading(e.submitter, async () => {
      try {
        await api('/announcements', { method: 'POST', body });
        closeDialog({ force: true });
        toast('Announcement posted.');
        state.home.announcements = await api('/announcements');
        renderAnnouncements();
      } catch (err) {
        if (err.errors) return showErrors(form, fromServer(err.errors));
        toast(err.message, { tone: 'error' });
      }
    });
  });
}

Object.assign(actions, {
  'claim-open': async (el) => {
    await withLoading(el, async () => {
      try {
        await api(`/shifts/${el.dataset.id}/claim`, { method: 'POST' });
        toast('Asked for the shift. Your manager will confirm it.');
        await refreshHome();
        renderHome();
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
  },
  'ack-announcement': async (el) => {
    const id = Number(el.dataset.id);
    const item = state.home.announcements.find((a) => a.id === id);
    if (item) { item.readByMe = true; if (item.reads != null) item.reads += 1; }
    renderAnnouncements();
    try { await api(`/announcements/${id}/ack`, { method: 'POST' }); } catch (e) { toast(e.message, { tone: 'error' }); }
  },
  'new-announcement': (el) => openAnnouncementDialog(el),
  'delete-announcement': async (el) => {
    const id = Number(el.dataset.id);
    const item = state.home.announcements.find((a) => a.id === id);
    if (!item || !confirm(`Delete “${item.title}”? People who haven’t read it won’t see it.`)) return;
    try {
      await api(`/announcements/${id}`, { method: 'DELETE' });
      state.home.announcements = state.home.announcements.filter((a) => a.id !== id);
      renderAnnouncements();
      toast('Announcement deleted.');
    } catch (e) { toast(e.message, { tone: 'error' }); }
  },
});
