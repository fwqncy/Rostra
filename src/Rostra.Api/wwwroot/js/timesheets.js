// Timesheets: clocked hours against the roster, fixed where needed, approved, and exported for payroll.
import { $, actions, addDays, api, clearErrors, closeDialog, dialog, dialogHead, errorSlot, fmt, fromServer, hrs, html, icon, isManager, isoLocal, money, openDialog, pad, parse, parseDay, plural, raw, showErrors, startOfWeek, state, toast, withLoading, withSkeleton, ymd } from './core.js';
import { errorState, listSkeleton, navigate } from './app.js';

let sheet = null;

const params = () => {
  const p = new URLSearchParams(location.search);
  const lastWeek = ymd(addDays(startOfWeek(new Date()), -7));
  return { site: p.get('site') || String(state.me.homeSiteId), week: p.get('week') || lastWeek };
};

export async function viewTimesheets() {
  if (!isManager()) return navigate('/app/home', { replace: true });
  state.view = 'timesheets';
  state.render = renderTimesheets;
  const p = params();
  state.reload = async () => { sheet = await api(`/timesheets?siteId=${p.site}&week=${p.week}`); };
  const content = $('#content');
  try {
    sheet = await withSkeleton(content, listSkeleton('Timesheets'), () => api(`/timesheets?siteId=${p.site}&week=${p.week}`));
    renderTimesheets();
  } catch (e) {
    if (e.status !== 401) content.innerHTML = errorState(e.message).v;
  }
}

const weekHref = (offset) => {
  const p = params();
  return `/app/timesheets?site=${p.site}&week=${ymd(addDays(parseDay(p.week), offset * 7))}`;
};
const time = (s) => (s ? fmt.time.format(parse(s)) : '—');

function renderTimesheets() {
  if (state.view !== 'timesheets' || !sheet) return;
  const p = params();
  const weekStart = parseDay(sheet.weekStart);
  document.title = `Timesheets · ${sheet.site.name} · Week ${sheet.weekNumber} · ${state.me.company.name}`;
  const ready = sheet.people.filter((x) => !x.approved && x.issues === 0);
  const open = new Set((new URLSearchParams(location.search).get('open') || '').split(',').filter(Boolean));

  $('#content').innerHTML = html`
    <header class="page-head">
      <div class="page-title">
        <h1>Timesheets</h1>
        <p class="page-sub"><span class="pill num">Week ${sheet.weekNumber} · ${sheet.site.name}</span><span class="num">${fmt.range.formatRange(weekStart, addDays(weekStart, 6))}</span></p>
      </div>
      <div class="toolbar">
        <label class="site-picker" for="ts-site"><span class="sr-only">Site</span>${icon('pin')}
          <select class="select" id="ts-site">${state.me.sites.map((s) => html`<option value="${s.id}" ${String(s.id) === p.site ? raw('selected') : ''}>${s.name}</option>`)}</select>
        </label>
        <nav class="segmented" aria-label="Change week">
          <a class="btn icon-btn" href="${weekHref(-1)}" aria-label="Previous week">${icon('left')}</a>
          <a class="btn" href="/app/timesheets?site=${p.site}&week=${ymd(addDays(startOfWeek(new Date()), -7))}">Last Week</a>
          <a class="btn icon-btn" href="${weekHref(1)}" aria-label="Next week">${icon('right')}</a>
        </nav>
        <a class="btn" href="/timesheets/export?siteId=${p.site}&week=${p.week}" download>${icon('download')}Export CSV</a>
        <button type="button" class="btn btn-primary" data-action="approve-ready" ${ready.length ? '' : raw('aria-disabled="true"')}>${icon('check')}Approve ${ready.length ? plural(ready.length, 'Timesheet', 'Timesheets') : 'All'}</button>
      </div>
    </header>
    <section class="stats" aria-label="This week’s timesheets">
      <div class="stat"><span class="stat-label">Worked Hours</span><span class="stat-value">${hrs(sheet.totals.workedHours)}</span><span class="stat-foot">${plural(sheet.totals.people, 'person', 'people')}</span></div>
      <div class="stat"><span class="stat-label">Gross Pay</span><span class="stat-value">${money(sheet.totals.pay)}</span><span class="stat-foot">Incl. weekend penalty rates</span></div>
      <div class="stat"><span class="stat-label">Approved</span><span class="stat-value">${sheet.totals.approved} / ${sheet.totals.people}</span><span class="stat-foot">${sheet.totals.approved === sheet.totals.people && sheet.totals.people ? 'Ready for payroll' : 'Approve to include in payroll'}</span></div>
      <div class="stat"><span class="stat-label">Missing Punches</span><span class="stat-value">${sheet.people.reduce((n, x) => n + x.issues, 0)}</span><span class="stat-foot">Fix these before approving</span></div>
    </section>
    ${sheet.people.length ? html`<div class="ts-list">${sheet.people.map((person) => html`
      <details class="ts-person panel" data-staff="${person.staffId}" ${open.has(String(person.staffId)) || person.issues ? raw('open') : ''}>
        <summary>
          <span class="ts-name"><strong>${person.name}</strong><span class="muted">${plural(person.lines.length, 'shift', 'shifts')} · ${money(person.rate)}/h</span></span>
          <span class="ts-hours num">${hrs(person.workedHours)} <span class="muted">of ${hrs(person.rosteredHours)} rostered</span></span>
          <span class="num">${money(person.pay)}</span>
          ${person.approved ? html`<span class="status is-save">${icon('check')}Approved</span>`
            : person.issues ? html`<span class="status is-danger">${icon('alert')}${plural(person.issues, 'missing punch', 'missing punches')}</span>`
            : html`<span class="status is-pending">Ready to approve</span>`}
        </summary>
        <div class="ts-table-wrap">
          <table class="ts-table">
            <thead><tr><th scope="col">Day</th><th scope="col">Rostered</th><th scope="col">Clock In</th><th scope="col">Clock Out</th><th scope="col">Paid</th><th scope="col">Pay</th><th scope="col"><span class="sr-only">Notes and actions</span></th></tr></thead>
            <tbody>${person.lines.map((l) => html`
              <tr>
                <th scope="row">${fmt.dayShort.format(parse(l.start))}</th>
                <td class="num">${fmt.time.formatRange(parse(l.start), parse(l.end))}</td>
                <td class="num">${time(l.clockIn)}</td>
                <td class="num">${time(l.clockOut)}</td>
                <td class="num">${hrs(l.hours)}</td>
                <td class="num">${money(l.pay)}</td>
                <td class="ts-flags">${l.flags.map((f) => html`<span class="status ${/No /.test(f) ? 'is-danger' : 'is-cost'}">${f}</span>`)}
                  ${person.approved ? '' : html`<button type="button" class="btn btn-ghost btn-sm" data-action="fix-punch" data-shift="${l.shiftId}" data-staff="${person.staffId}">Fix Times…</button>`}</td>
              </tr>`)}</tbody>
          </table>
        </div>
        <div class="ts-foot">
          ${person.approved
            ? html`<span class="muted">Approved${person.approvedBy ? ` by ${person.approvedBy}` : ''}${person.approvedAt ? ` · ${fmt.dayShort.format(parse(person.approvedAt))}` : ''}</span>
                   <button type="button" class="btn btn-ghost btn-sm" data-action="unapprove-timesheet" data-staff="${person.staffId}">Unapprove</button>`
            : html`<button type="button" class="btn btn-sm btn-primary" data-action="approve-timesheet" data-staff="${person.staffId}">${icon('check')}Approve ${person.name.split(' ')[0]}’s Timesheet</button>`}
        </div>
      </details>`)}</div>` : html`
      <div class="empty">${icon('sheet')}<h2>No Worked Shifts Yet</h2><p>Timesheets fill in as people clock in and out. Try last week.</p>
        <a class="btn" href="/app/timesheets?site=${p.site}&week=${ymd(addDays(startOfWeek(new Date()), -7))}">Go to Last Week</a></div>`}`.v;

  $('#ts-site').addEventListener('change', (e) => navigate(`/app/timesheets?site=${e.target.value}&week=${p.week}`));
}

async function approve(staffIds, button) {
  const p = params();
  await withLoading(button, async () => {
    try {
      const { approved } = await api('/timesheets/approve', { method: 'POST', body: { staffIds, week: p.week } });
      toast(`Approved ${plural(approved, 'timesheet', 'timesheets')}. ${approved === 1 ? 'They’ve' : 'Everyone’s'} been notified.`);
      await state.reload();
      renderTimesheets();
    } catch (e) { toast(e.message, { tone: 'error' }); }
  });
}

function openFixDialog(line, person, returnTo) {
  const day = parse(line.start);
  const value = (s) => (s ? `${pad(parse(s).getHours())}:${pad(parse(s).getMinutes())}` : '');
  openDialog(html`
    <form class="dialog-form" id="fix-form" novalidate data-track-changes>
      ${dialogHead(`Fix ${person.name.split(' ')[0]}’s Times`, `${fmt.dayLong.format(day)} · rostered ${fmt.time.formatRange(parse(line.start), parse(line.end))}`)}
      <div class="dialog-body">
        <div class="row-2">
          <div class="field"><label for="fx-in">Clock In</label><input class="input num" id="fx-in" name="clockIn" type="time" value="${value(line.clockIn)}" data-field="clockIn" data-autofocus>${errorSlot('clockIn', 'fx-in-error')}</div>
          <div class="field"><label for="fx-out">Clock Out</label><input class="input num" id="fx-out" name="clockOut" type="time" value="${value(line.clockOut)}" data-field="clockOut">${errorSlot('clockOut', 'fx-out-error')}</div>
        </div>
        <p class="field-hint">Leave Clock Out empty if they’re still on shift. Your change is recorded as a manager entry.</p>
      </div>
      <div class="dialog-foot"><span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">Save Times</button>
      </div>
    </form>`, { returnTo });
  const form = $('#fix-form', dialog);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const at = (v, after) => {
      if (!v) return null;
      const [h, m] = v.split(':').map(Number);
      let d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
      if (after && d <= after) d = addDays(d, 1); // past midnight
      return d;
    };
    const clockIn = at(form.clockIn.value);
    const clockOut = at(form.clockOut.value, clockIn);
    if (!clockIn && clockOut) return showErrors(form, { clockIn: 'Add a clock-in time too.' });
    await withLoading(e.submitter, async () => {
      try {
        await api(`/shifts/${line.shiftId}/punches`, { method: 'PUT', body: { clockIn: clockIn && isoLocal(clockIn), clockOut: clockOut && isoLocal(clockOut) } });
        closeDialog({ force: true });
        toast('Times saved.');
        await state.reload();
        renderTimesheets();
      } catch (err) {
        if (err.errors) return showErrors(form, fromServer(err.errors));
        toast(err.message, { tone: 'error' });
      }
    });
  });
}

Object.assign(actions, {
  'approve-timesheet': (el) => approve([Number(el.dataset.staff)], el),
  'approve-ready': (el) => {
    const ready = sheet.people.filter((x) => !x.approved && x.issues === 0).map((x) => x.staffId);
    if (!ready.length) { toast('Nothing ready to approve. Fix missing punches first, or everyone’s already approved.'); return; }
    approve(ready, el);
  },
  'unapprove-timesheet': async (el) => {
    const p = params();
    try {
      await api('/timesheets/unapprove', { method: 'POST', body: { staffId: Number(el.dataset.staff), week: p.week } });
      toast('Timesheet unapproved. You can fix times now.');
      await state.reload();
      renderTimesheets();
    } catch (e) { toast(e.message, { tone: 'error' }); }
  },
  'fix-punch': (el) => {
    const person = sheet.people.find((x) => x.staffId === Number(el.dataset.staff));
    const line = person?.lines.find((l) => l.shiftId === Number(el.dataset.shift));
    if (line) openFixDialog(line, person, `[data-action="fix-punch"][data-shift="${line.shiftId}"]`);
  },
});
