// Team: the people you roster. Managers add, edit and deactivate them here.
import { $, $$, actions, api, clearErrors, closeDialog, dialog, dialogHead, errorSlot, fmt, fromServer, hrs, html, icon, initials, isManager, money, openDialog, parseDay, plural, raw, showErrors, state, STATION_NAMES, toast, withLoading, withSkeleton } from './core.js';
import { errorState, listSkeleton, navigate } from './app.js';

const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
let team = [];

export async function viewTeam() {
  if (!isManager()) return navigate('/app/home', { replace: true });
  state.view = 'team';
  state.render = renderTeam;
  state.reload = async () => { team = await api('/team'); };
  document.title = `Team · ${state.me.company.name}`;
  const content = $('#content');
  try {
    team = await withSkeleton(content, listSkeleton('Team'), () => api('/team'));
    renderTeam();
  } catch (e) {
    if (e.status !== 401) content.innerHTML = errorState(e.message).v;
  }
}

function filters() {
  const p = new URLSearchParams(location.search);
  return { site: p.get('site') || '', q: p.get('q') || '', inactive: p.get('inactive') === '1' };
}
function setFilter(key, value) {
  const p = new URLSearchParams(location.search);
  if (value) p.set(key, value); else p.delete(key);
  history.replaceState(history.state, '', `${location.pathname}${p.toString() ? `?${p}` : ''}`);
}

function renderTeam() {
  if (state.view !== 'team') return;
  const f = filters();
  const active = team.filter((m) => m.isActive);
  const shown = team.filter((m) => (f.inactive || m.isActive)
    && (!f.site || String(m.homeSiteId) === f.site)
    && (!f.q || `${m.name} ${m.email} ${m.title}`.toLowerCase().includes(f.q.toLowerCase())));
  const today = new Date();
  const soon = (d) => d && (parseDay(d) - today) / 864e5 < 30;

  const shell = $('#team-root');
  if (!shell) {
    $('#content').innerHTML = html`
      <header class="page-head">
        <div class="page-title">
          <h1>Team</h1>
          <p class="page-sub" id="team-sub"></p>
        </div>
        <div class="toolbar">
          <button type="button" class="btn btn-primary" data-action="add-member">${icon('plus')}Add Team Member…</button>
        </div>
      </header>
      <div id="team-root">
        <div class="filter-row">
          <label class="search" for="team-q"><span class="sr-only">Search the team</span>${icon('search')}
            <input class="input" id="team-q" type="search" placeholder="Search by name, email or role…" autocomplete="off" spellcheck="false" value="${f.q}">
          </label>
          <label class="site-picker" for="team-site"><span class="sr-only">Site</span>${icon('pin')}
            <select class="select" id="team-site">
              <option value="">All Sites</option>
              ${state.me.sites.map((s) => html`<option value="${s.id}" ${String(s.id) === f.site ? raw('selected') : ''}>${s.name}</option>`)}
            </select>
          </label>
          <label class="check"><input type="checkbox" id="team-inactive" ${f.inactive ? raw('checked') : ''}> Show Inactive</label>
        </div>
        <div class="panel"><ul class="team-list" id="team-list"></ul></div>
      </div>`.v;
    $('#team-q').addEventListener('input', (e) => { setFilter('q', e.target.value.trim()); renderTeam(); });
    $('#team-site').addEventListener('change', (e) => { setFilter('site', e.target.value); renderTeam(); });
    $('#team-inactive').addEventListener('change', (e) => { setFilter('inactive', e.target.checked ? '1' : ''); renderTeam(); });
  }
  $('#team-sub').textContent = `${plural(active.length, 'person', 'people')} across ${plural(state.me.sites.length, 'site', 'sites')}${team.length > active.length ? ` · ${team.length - active.length} inactive` : ''}`;
  $('#team-list').innerHTML = shown.length ? shown.map((m) => html`
    <li class="team-row ${m.isActive ? '' : 'is-inactive'}">
      <span class="avatar ${m.id === state.me.id ? 'is-me' : ''}" aria-hidden="true">${initials(m.name)}</span>
      <div class="team-main">
        <p class="team-name"><strong>${m.name}</strong>${m.role === 'Manager' ? html` <span class="status">Manager</span>` : ''}${m.isActive ? '' : html` <span class="status">Inactive</span>`}</p>
        <p class="muted">${m.title} · ${m.site} · <span translate="no">${m.email}</span></p>
      </div>
      <div class="team-meta">
        <span class="team-stations">${m.stations.split(', ').map((st) => html`<span class="station-chip" data-station="${st}"><span class="station-dot" aria-hidden="true"></span>${st}</span>`)}</span>
        <span class="num muted">${money(m.hourlyRate)}/h · ${hrs(m.hoursThisWeek)} this week</span>
        ${m.certification ? html`<span class="status ${soon(m.certificationExpires) ? 'is-cost' : ''}">${m.certification}${m.certificationExpires ? ` · ${soon(m.certificationExpires) ? 'expires' : 'until'} ${fmt.dayShort.format(parseDay(m.certificationExpires))}` : ''}</span>` : ''}
      </div>
      <button type="button" class="btn btn-sm" data-action="edit-member" data-id="${m.id}" aria-label="Edit ${m.name}">Edit…</button>
    </li>`.v).join('') : html`<li class="nothing team-empty">No one matches. Try another site or search.</li>`.v;
}

function memberForm(m) {
  const stations = m ? m.stations.split(', ') : ['Floor'];
  const days = m?.availableDays === 'All' || !m ? DAY_KEYS : m.availableDays.split(', ');
  return html`
    <div class="dialog-body">
      <div class="row-2">
        <div class="field"><label for="tm-name">Full Name</label>
          <input class="input" id="tm-name" name="name" autocomplete="off" value="${m?.name ?? ''}" data-field="name" data-autofocus>${errorSlot('name', 'tm-name-error')}</div>
        <div class="field"><label for="tm-email">Work Email</label>
          <input class="input" id="tm-email" name="email" type="email" inputmode="email" autocomplete="off" spellcheck="false" value="${m?.email ?? ''}" placeholder="name@venue.com…" data-field="email">${errorSlot('email', 'tm-email-error')}</div>
      </div>
      <div class="row-2">
        <div class="field"><label for="tm-title">Job Title</label>
          <input class="input" id="tm-title" name="title" autocomplete="off" value="${m?.title ?? ''}" placeholder="e.g. Chef de Partie…" data-field="title">${errorSlot('title', 'tm-title-error')}</div>
        <div class="field"><label for="tm-role">Access</label>
          <select class="select" id="tm-role" name="role" data-field="role">
            <option value="Staff" ${m?.role !== 'Manager' ? raw('selected') : ''}>Staff: own shifts, swaps and leave</option>
            <option value="Manager" ${m?.role === 'Manager' ? raw('selected') : ''}>Manager: rosters, team and pay</option>
          </select>${errorSlot('role', 'tm-role-error')}</div>
      </div>
      <div class="row-2">
        <div class="field"><label for="tm-site">Home Site</label>
          <select class="select" id="tm-site" name="homeSiteId" data-field="homeSiteId">
            ${state.me.sites.map((s) => html`<option value="${s.id}" ${s.id === (m?.homeSiteId ?? state.me.homeSiteId) ? raw('selected') : ''}>${s.name}</option>`)}
          </select>${errorSlot('homeSiteId', 'tm-site-error')}</div>
        <div class="field"><label for="tm-rate">Hourly Rate</label>
          <input class="input num" id="tm-rate" name="hourlyRate" type="number" inputmode="decimal" min="15" max="500" step="0.05" value="${m?.hourlyRate ?? 28}" data-field="hourlyRate">${errorSlot('hourlyRate', 'tm-rate-error')}</div>
      </div>
      <fieldset class="options">
        <legend>Trained Stations</legend>
        <div class="chip-checks">${STATION_NAMES.map((st) => html`<label class="chip-check"><input type="checkbox" name="stations" value="${st}" data-field="stations" ${stations.includes(st) ? raw('checked') : ''}><span>${st}</span></label>`)}</div>
        ${errorSlot('stations', 'tm-stations-error')}
      </fieldset>
      <div class="row-2">
        <div class="field"><label for="tm-primary">Main Station</label>
          <select class="select" id="tm-primary" name="primaryStation" data-field="primaryStation">
            ${STATION_NAMES.map((st) => html`<option value="${st}" ${st === (m?.primaryStation ?? 'Floor') ? raw('selected') : ''}>${st}</option>`)}
          </select>${errorSlot('primaryStation', 'tm-primary-error')}</div>
        <div class="field"><label for="tm-cert">Certification <span class="muted">(optional)</span></label>
          <input class="input" id="tm-cert" name="certification" autocomplete="off" value="${m?.certification ?? ''}" placeholder="e.g. RSA…"></div>
      </div>
      <div class="field"><label for="tm-cert-exp">Certification Expires <span class="muted">(optional)</span></label>
        <input class="input num" id="tm-cert-exp" name="certificationExpires" type="date" value="${m?.certificationExpires ?? ''}"></div>
      ${m ? html`<p class="field-hint">Availability: ${days.join(', ')}. People set their own availability on Home.</p>` : ''}
      <p class="form-error" data-error-for="_" role="alert" hidden tabindex="-1"></p>
    </div>`;
}

function readMember(form) {
  return {
    name: form.name.value.trim(), email: form.email.value.trim(), title: form.title.value.trim(), role: form.role.value,
    homeSiteId: Number(form.homeSiteId.value), hourlyRate: Number(form.hourlyRate.value),
    stations: $$('input[name="stations"]:checked', form).map((i) => i.value), primaryStation: form.primaryStation.value,
    certification: form.certification.value.trim() || null, certificationExpires: form.certificationExpires.value || null,
  };
}

function showPassword(name, email, password) {
  openDialog(html`
    <div class="dialog-form">
      ${dialogHead(`Temporary Password for ${name}`, 'Shown once. Share it with them privately.')}
      <div class="dialog-body">
        <div class="field"><label for="tp-email">Email</label><input class="input mono" id="tp-email" readonly value="${email}"></div>
        <div class="field"><label for="tp-pass">Temporary Password</label>
          <div class="copy-row"><input class="input mono" id="tp-pass" readonly value="${password}" translate="no">
          <button type="button" class="btn" data-action="copy-temp-password">${icon('copy')}Copy</button></div>
        </div>
        <p class="muted">They can change it in Settings after signing in.</p>
      </div>
      <div class="dialog-foot"><span class="spacer"></span><button type="button" class="btn btn-primary" data-close>Done</button></div>
    </div>`);
}

function openMemberDialog(m, returnTo) {
  openDialog(html`
    <form class="dialog-form" id="member-form" novalidate data-track-changes>
      ${dialogHead(m ? `Edit ${m.name}` : 'Add Team Member', m ? m.title : 'They’ll get a temporary password to sign in with.')}
      ${memberForm(m)}
      <div class="dialog-foot">
        ${m && m.id !== state.me.id ? html`
          ${m.isActive
            ? html`<button type="button" class="btn btn-danger" data-action="deactivate-member" data-id="${m.id}">Deactivate…</button>`
            : html`<button type="button" class="btn" data-action="reactivate-member" data-id="${m.id}">Reactivate</button>`}
          <button type="button" class="btn btn-ghost" data-action="reset-member-password" data-id="${m.id}">Reset Password…</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">${m ? 'Save Changes' : 'Add to Team'}</button>
      </div>
    </form>`, { returnTo });
  const form = $('#member-form', dialog);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const body = readMember(form);
    const errors = {};
    if (!body.name) errors.name = 'Enter their name.';
    if (!body.email.includes('@')) errors.email = 'Enter a work email, like name@venue.com.';
    if (!body.title) errors.title = 'Add a job title, like Chef or Floor Staff.';
    if (!body.stations.length) errors.stations = 'Choose at least one station they can work.';
    else if (!body.stations.includes(body.primaryStation)) errors.primaryStation = 'Their main station must be one they’re trained on.';
    if (Object.keys(errors).length) return showErrors(form, errors);
    await withLoading(e.submitter, async () => {
      try {
        if (m) {
          await api(`/team/${m.id}`, { method: 'PUT', body });
          closeDialog({ force: true });
          toast(`Saved ${body.name}.`);
        } else {
          const created = await api('/team', { method: 'POST', body });
          closeDialog({ force: true });
          showPassword(created.name, created.email, created.temporaryPassword);
        }
        team = await api('/team');
        renderTeam();
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

Object.assign(actions, {
  'add-member': (el) => openMemberDialog(null, el),
  'edit-member': (el) => {
    const m = team.find((x) => x.id === Number(el.dataset.id));
    if (m) openMemberDialog(m, `[data-action="edit-member"][data-id="${m.id}"]`);
  },
  'deactivate-member': async (el) => {
    const m = team.find((x) => x.id === Number(el.dataset.id));
    if (!m || !confirm(`Deactivate ${m.name}? They can’t sign in, and their future shifts become open shifts. Past shifts and timesheets are kept.`)) return;
    await withLoading(el, async () => {
      try {
        const result = await api(`/team/${m.id}/deactivate`, { method: 'POST' });
        closeDialog({ force: true });
        toast(`${m.name} deactivated.${result.openedShifts ? ` ${plural(result.openedShifts, 'shift is', 'shifts are')} now open.` : ''}`);
        team = await api('/team');
        renderTeam();
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
  },
  'reactivate-member': async (el) => {
    const m = team.find((x) => x.id === Number(el.dataset.id));
    await withLoading(el, async () => {
      try {
        await api(`/team/${m.id}/reactivate`, { method: 'POST' });
        closeDialog({ force: true });
        toast(`${m.name} can sign in again.`);
        team = await api('/team');
        renderTeam();
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
  },
  'reset-member-password': async (el) => {
    const m = team.find((x) => x.id === Number(el.dataset.id));
    if (!m || !confirm(`Reset ${m.name}’s password? Their current password stops working.`)) return;
    try {
      const { temporaryPassword } = await api(`/team/${m.id}/reset-password`, { method: 'POST' });
      closeDialog({ force: true });
      showPassword(m.name, m.email, temporaryPassword);
    } catch (e) { toast(e.message, { tone: 'error' }); }
  },
  'copy-temp-password': async () => {
    try { await navigator.clipboard.writeText($('#tp-pass').value); toast('Password copied.'); }
    catch { $('#tp-pass').select(); }
  },
});
