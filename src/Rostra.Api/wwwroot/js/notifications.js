// The bell: personal notifications (roster published, swaps, leave, kudos…), newest first.
import { $, $$, actions, api, dialog, html, icon, narrow, parse, state, timeAgo, toast } from './core.js';

const KIND_ICONS = {
  roster: 'calendar', shift: 'clock', swap: 'swap', 'open-shift': 'hand', leave: 'calendar-x',
  announcement: 'megaphone', kudos: 'heart', timesheet: 'sheet',
};

let panel = null;
let opener = null;

export function updateBell() {
  const n = state.unread || 0;
  $$('[data-bell-count]').forEach((el) => { el.hidden = n === 0; el.textContent = n > 9 ? '9+' : String(n); });
  $$('.bell').forEach((b) => b.setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications'));
}

export async function openNotifications(trigger) {
  if (panel) return closeNotifications();
  opener = trigger?.closest?.('.bell') || $$('.bell').find((b) => b.offsetParent !== null) || null;
  panel = document.createElement('section');
  panel.className = 'notif-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'notif-title');
  panel.innerHTML = html`
    <header class="notif-head">
      <h2 id="notif-title" class="eyebrow" tabindex="-1">Notifications</h2>
      <button type="button" class="btn btn-ghost btn-sm" data-action="read-all-notifications">Mark All Read</button>
      <button type="button" class="btn btn-ghost icon-btn btn-sm" data-action="close-notifications" aria-label="Close notifications">${icon('x')}</button>
    </header>
    <div class="notif-body" id="notif-body"><div class="widget-skeleton"><span class="skeleton line"></span><span class="skeleton line"></span><span class="skeleton line"></span></div></div>`.v;
  document.body.append(panel);
  position();
  $$('.bell').forEach((b) => b.setAttribute('aria-expanded', 'true'));
  $('#notif-title', panel).focus({ preventScroll: true });
  setTimeout(() => {
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', onKey);
  });
  addEventListener('resize', position);
  await refresh();
}

export function closeNotifications({ restoreFocus = false } = {}) {
  if (!panel) return;
  panel.remove();
  panel = null;
  document.removeEventListener('pointerdown', outside);
  document.removeEventListener('keydown', onKey);
  removeEventListener('resize', position);
  $$('.bell').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  if (restoreFocus) opener?.focus({ preventScroll: true });
}

export function refreshNotificationsIfOpen() { if (panel) refresh(); }

function position() {
  if (!panel) return;
  if (narrow.matches || !opener) { panel.classList.add('is-sheet'); return; }
  panel.classList.remove('is-sheet');
  const r = opener.getBoundingClientRect();
  panel.style.setProperty('left', `${Math.min(r.right + 10, innerWidth - panel.offsetWidth - 12)}px`);
  panel.style.setProperty('top', `${Math.max(12, r.top - 6)}px`);
}

function outside(e) {
  if (panel?.contains(e.target) || e.target.closest?.('.bell')) return;
  closeNotifications();
}
function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); closeNotifications({ restoreFocus: true }); } }

async function refresh() {
  try {
    const data = await api('/notifications');
    state.unread = data.unread;
    updateBell();
    render(data.items);
  } catch (e) {
    const body = $('#notif-body');
    if (body) body.innerHTML = html`<p class="nothing notif-empty">${e.message}</p>`.v;
  }
}

function render(items) {
  const body = $('#notif-body');
  if (!body) return;
  if (!items.length) {
    body.innerHTML = html`<div class="notif-empty">${icon('bell')}<p class="nothing">Nothing yet</p><p class="muted">Roster updates, swap news and kudos land here.</p></div>`.v;
    return;
  }
  const now = new Date();
  body.innerHTML = html`<ul class="notif-list">${items.map((n) => html`
    <li class="${n.read ? '' : 'is-unread'}">
      <a class="notif-item" href="${n.link || '#'}" data-notif="${n.id}">
        <span class="notif-icon" aria-hidden="true">${icon(KIND_ICONS[n.kind] || 'bell')}</span>
        <span class="notif-text">
          <strong>${n.title}</strong>
          ${n.body ? html`<span class="muted">${n.body}</span>` : ''}
          <time class="notif-time" datetime="${n.createdAt}">${timeAgo(parse(n.createdAt), now)}</time>
        </span>
        ${n.read ? '' : html`<span class="notif-dot"><span class="sr-only">Unread</span></span>`}
      </a>
    </li>`)}</ul>`.v;
}

document.addEventListener('click', async (e) => {
  const item = e.target.closest('[data-notif]');
  if (!item) return;
  const li = item.closest('li');
  if (li?.classList.contains('is-unread')) {
    li.classList.remove('is-unread');
    state.unread = Math.max(0, (state.unread || 0) - 1);
    updateBell();
    api(`/notifications/${item.dataset.notif}/read`, { method: 'POST' }).catch(() => {});
  }
  if (item.getAttribute('href') === '#') e.preventDefault();
  closeNotifications();
});

Object.assign(actions, {
  'open-notifications': (el) => openNotifications(el),
  'close-notifications': () => closeNotifications({ restoreFocus: true }),
  'read-all-notifications': async () => {
    try {
      await api('/notifications/read', { method: 'POST' });
      state.unread = 0;
      updateBell();
      $$('.notif-list li.is-unread').forEach((li) => li.classList.remove('is-unread'));
      $$('.notif-dot').forEach((d) => d.remove());
    } catch (err) { toast(err.message, { tone: 'error' }); }
  },
});
