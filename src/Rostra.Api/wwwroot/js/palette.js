// Command palette: ⌘K / Ctrl K (and the phone Menu button). Jump anywhere or run an action by typing.
import { $, actions, api, appearance, dialog, html, icon, isMac, isManager, SCHEMES, state, toast, updateAppearance } from './core.js';
import { navigate } from './app.js';

let dialogEl = null;
let commands = [];
let filtered = [];
let active = 0;

function buildCommands() {
  const manager = isManager();
  const go = (label, path, iconName, keywords = '') => ({ group: 'Go to', label, icon: iconName, keywords, run: () => navigate(path) });
  const list = [
    go('Home', '/app/home', 'home', 'next shift pay tree grove'),
    manager && go('Dashboard', '/app/dashboard', 'grid', 'wages labour live clock'),
    manager && go('Schedule', `/app/schedule${state.lastScheduleQuery}`, 'calendar', 'roster week publish'),
    go('Swaps', '/app/swaps', 'swap', 'requests cover open shifts'),
    go('My Shifts', '/app/my-shifts', 'clock', 'clock in out'),
    manager && go('Timesheets', '/app/timesheets', 'sheet', 'payroll approve export hours'),
    manager && go('Team', '/app/team', 'users', 'staff people add employee'),
    go('Settings', '/app/settings', 'settings', 'colour theme password calendar appearance'),
    manager && { group: 'Actions', label: 'Add a Shift…', icon: 'plus', keywords: 'new create roster', run: () => { navigate(`/app/schedule${state.lastScheduleQuery}`); setTimeout(() => actions['new-shift']?.($('[data-action="new-shift"]')), 500); } },
    manager && { group: 'Actions', label: 'Publish This Week’s Roster…', icon: 'send', keywords: 'publish roster notify', run: () => { navigate(`/app/schedule${state.lastScheduleQuery}`); setTimeout(() => actions['publish-week']?.($('[data-action="publish-week"]')), 600); } },
    manager && { group: 'Actions', label: 'Post an Announcement…', icon: 'megaphone', keywords: 'news message team', run: () => { navigate('/app/home'); setTimeout(() => actions['new-announcement']?.($('[data-action="new-announcement"]')), 600); } },
    { group: 'Actions', label: 'Request Leave…', icon: 'calendar-x', keywords: 'holiday time off sick', run: () => { navigate('/app/home#leave'); setTimeout(() => $('#lv-from')?.focus(), 600); } },
    { group: 'Actions', label: 'Give Kudos…', icon: 'heart', keywords: 'thanks firefly', run: () => { navigate('/app/home#kudos'); setTimeout(() => $('#kd-to')?.focus(), 600); } },
    { group: 'Actions', label: 'Notifications', icon: 'bell', keywords: 'alerts inbox', run: () => actions['open-notifications']?.() },
    { group: 'Actions', label: 'Copy My Calendar Link', icon: 'link', keywords: 'ical webcal google outlook subscribe', run: copyCalendarLink },
    { group: 'Appearance', label: appearance.mode === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode', icon: 'theme', keywords: 'theme dark light', run: () => updateAppearance({ mode: appearance.mode === 'light' ? 'dark' : 'light' }) },
    ...SCHEMES.filter((s) => s.id !== 'custom').map((s) => ({
      group: 'Appearance', label: `Colour Scheme: ${s.name}`, icon: 'palette', keywords: 'colour color theme scheme',
      run: () => updateAppearance({ scheme: s.id }),
    })),
    { group: 'Appearance', label: 'Pick a Custom Colour…', icon: 'palette', keywords: 'colour wheel custom', run: () => navigate('/app/settings#appearance') },
    { group: 'Account', label: 'Sign Out', icon: 'logout', keywords: 'log out exit', run: () => actions.logout?.() },
  ];
  return list.filter(Boolean);
}

async function copyCalendarLink() {
  try {
    const { calendarPath } = await api('/me/settings');
    const url = `webcal://${location.host}${calendarPath}`;
    await navigator.clipboard.writeText(url);
    toast('Calendar link copied. Paste it into Google Calendar, Outlook or Apple Calendar to subscribe.');
  } catch (e) { toast(e.message || 'Couldn’t copy the link. Open Settings to copy it by hand.', { tone: 'error' }); }
}

/** Every typed letter must appear in order; matches at word starts score higher. */
function score(text, query) {
  if (!query) return 1;
  const t = text.toLowerCase();
  let i = 0;
  let s = 0;
  for (const ch of query.toLowerCase()) {
    const at = t.indexOf(ch, i);
    if (at < 0) return 0;
    s += at === 0 || t[at - 1] === ' ' ? 3 : at === i ? 2 : 1;
    i = at + 1;
  }
  return s / t.length + (t.startsWith(query.toLowerCase()) ? 5 : 0);
}

export function openPalette() {
  if (!state.me) return;
  if (!dialogEl) {
    dialogEl = document.createElement('dialog');
    dialogEl.className = 'palette';
    dialogEl.setAttribute('aria-label', 'Command menu');
    document.body.append(dialogEl);
    dialogEl.addEventListener('close', () => { dialogEl.innerHTML = ''; });
    dialogEl.addEventListener('click', (e) => { if (e.target === dialogEl) dialogEl.close(); });
  }
  commands = buildCommands();
  const shortcut = isMac ? '⌘K' : 'Ctrl K';
  dialogEl.innerHTML = html`
    <div class="palette-box">
      <div class="palette-input">
        ${icon('search')}
        <input id="palette-q" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list"
               autocomplete="off" spellcheck="false" placeholder="Search pages and actions…" aria-label="Search pages and actions">
        <kbd>${shortcut}</kbd>
      </div>
      <ul class="palette-list" id="palette-list" role="listbox" aria-label="Results"></ul>
      <p class="palette-foot muted"><kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Enter</kbd> to choose · <kbd>Esc</kbd> to close</p>
    </div>`.v;
  dialogEl.showModal();
  const input = $('#palette-q', dialogEl);
  input.addEventListener('input', () => { active = 0; renderList(input.value.trim()); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(filtered[active]); }
  });
  renderList('');
  input.focus();
}

function renderList(query) {
  filtered = commands.map((c) => ({ c, s: score(`${c.label} ${c.group} ${c.keywords}`, query) * (score(c.label, query) ? 2 : 1) }))
    .filter((x) => x.s > 0).sort((a, b) => (query ? b.s - a.s : 0)).map((x) => x.c);
  const list = $('#palette-list', dialogEl);
  if (!filtered.length) {
    list.innerHTML = html`<li class="palette-empty nothing" role="option" aria-disabled="true">No matches for “${query}”.</li>`.v;
    $('#palette-q', dialogEl).removeAttribute('aria-activedescendant');
    return;
  }
  let lastGroup = null;
  list.innerHTML = filtered.map((c, i) => {
    const heading = !query && c.group !== lastGroup ? html`<li class="palette-group eyebrow" role="presentation">${c.group}</li>` : '';
    lastGroup = c.group;
    return html`${heading}<li class="palette-item" role="option" id="pal-${i}" data-index="${i}" aria-selected="${i === active}">${icon(c.icon)}<span>${c.label}</span></li>`.v;
  }).join('');
  syncActive();
}

function move(delta) {
  if (!filtered.length) return;
  active = (active + delta + filtered.length) % filtered.length;
  syncActive();
}
function syncActive() {
  const input = $('#palette-q', dialogEl);
  dialogEl.querySelectorAll('.palette-item').forEach((el) => el.setAttribute('aria-selected', String(Number(el.dataset.index) === active)));
  const el = $(`#pal-${active}`, dialogEl);
  if (el) { input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
}
function run(command) {
  if (!command) return;
  dialogEl.close();
  command.run();
}

document.addEventListener('click', (e) => {
  const item = e.target.closest('.palette-item');
  if (item && dialogEl?.contains(item)) run(filtered[Number(item.dataset.index)]);
});
document.addEventListener('pointermove', (e) => {
  const item = e.target.closest?.('.palette-item');
  if (item && dialogEl?.contains(item) && Number(item.dataset.index) !== active) { active = Number(item.dataset.index); syncActive(); }
});
// ⌘K / Ctrl K anywhere. Uses the typed key (not the physical key) so it works on non-QWERTY layouts.
document.addEventListener('keydown', (e) => {
  if (e.key?.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && state.me) {
    e.preventDefault();
    if (dialogEl?.open) dialogEl.close(); else openPalette();
  }
});

Object.assign(actions, { 'open-palette': () => openPalette() });
