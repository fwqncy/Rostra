// Settings: appearance (scheme, custom colour wheel, mode, motion), company default, calendar sync, password.
import { $, $$, accentVars, actions, api, app, appearance, applyAppearance, clearErrors, contrast, errorSlot, fromServer, hexToRgb, html, icon, isManager, onLeavePage, raw, rgbToHex, SCHEMES, showErrors, state, toast, updateAppearance, val, withLoading } from './core.js';

const PRESETS = [
  ['Moss', '#4F7A3A'], ['Clay', '#B5562F'], ['Ochre', '#C48A1C'], ['Rust', '#9C3D1F'],
  ['Pine', '#2E5E4E'], ['Lake', '#2F6E8A'], ['Plum', '#6D3B6E'], ['Rose', '#B4506A'],
];

/* HSV ↔ hex: the wheel picks hue (angle) and saturation (distance from centre); brightness is a slider. */
function hsvToHex(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return rgbToHex([f(5), f(3), f(1)].map((x) => Math.round(x * 255))).toUpperCase();
}
function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(hex).map((x) => x / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round((h * 60 + 360) % 360), s: max ? d / max : 0, v: max };
}

let saved = null;   // appearance as of opening the page, to revert an unsaved preview
let picked = null;  // { h, s, v }

export async function viewSettings() {
  state.view = 'settings';
  state.render = null;
  document.title = `Settings · ${state.me.company.name}`;
  saved = { ...appearance };
  const startHex = (appearance.custom || state.me.company.accent || '#C2621D').toUpperCase();
  picked = { ...hexToHsv(startHex), exact: startHex };
  onLeavePage(() => {
    // Leaving with an unsaved custom colour on preview puts the saved look back.
    if (JSON.stringify({ ...appearance }) !== JSON.stringify(saved) && $('#wheel-save')?.dataset.dirty === '1') applyAppearance(saved);
  });
  const companyScheme = state.me.company.appearance?.scheme || 'overgrowth';

  $('#content').innerHTML = html`
    <header class="page-head">
      <div class="page-title">
        <h1>Settings</h1>
        <p class="page-sub">Make Rostra yours. Changes follow you to every device you sign in on.</p>
      </div>
    </header>

    <section class="settings-section" id="appearance" aria-labelledby="appearance-title">
      <div class="settings-intro">
        <h2 class="card-heading" id="appearance-title">${icon('palette')}Appearance</h2>
        <p class="muted">Pick a colour scheme, or mix your own on the wheel.</p>
      </div>
      <div class="settings-body">
        <fieldset class="segmented-field">
          <legend class="label">Mode</legend>
          <div class="seg-radio">
            ${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => html`
              <label><input type="radio" name="mode" value="${v}" ${appearance.mode === v ? raw('checked') : ''}><span>${l}</span></label>`)}
          </div>
        </fieldset>

        <fieldset class="scheme-grid">
          <legend class="label">Colour Scheme</legend>
          ${SCHEMES.map((s) => html`
            <label class="scheme-card" data-scheme-card="${s.id}">
              <input type="radio" name="scheme" value="${s.id}" ${appearance.scheme === s.id ? raw('checked') : ''}>
              <span class="scheme-preview" aria-hidden="true">${(s.id === 'brand' ? [state.me.company.accent] : s.id === 'custom' ? [] : s.swatches).map(() => html`<i></i>`)}</span>
              <span class="scheme-text"><strong>${s.name}${s.id === companyScheme ? html` <span class="status">Company default</span>` : ''}</strong><span class="muted">${s.blurb}</span></span>
            </label>`)}
        </fieldset>

        <div class="wheel-panel" id="wheel-panel" ${appearance.scheme === 'custom' ? '' : raw('hidden')}>
          <div class="wheel-wrap">
            <div class="wheel" id="wheel" aria-hidden="true">
              <div class="wheel-shade" id="wheel-shade"></div>
              <span class="wheel-thumb" id="wheel-thumb"></span>
            </div>
          </div>
          <div class="wheel-controls">
            <div class="field slider-field">
              <label for="hue">Hue <output id="hue-out" for="hue"></output></label>
              <input type="range" id="hue" min="0" max="359" step="1" class="range range-hue">
            </div>
            <div class="field slider-field">
              <label for="sat">Saturation <output id="sat-out" for="sat"></output></label>
              <input type="range" id="sat" min="0" max="100" step="1" class="range range-sat">
            </div>
            <div class="field slider-field">
              <label for="val">Brightness <output id="val-out" for="val"></output></label>
              <input type="range" id="val" min="15" max="100" step="1" class="range range-val">
            </div>
            <div class="field">
              <label for="hex">Hex Code</label>
              <input class="input mono" id="hex" name="hex" inputmode="text" autocomplete="off" spellcheck="false" maxlength="7" placeholder="#C2621D" data-field="custom">
              ${errorSlot('custom', 'hex-error')}
            </div>
            <div class="presets" role="group" aria-label="Earthy presets">
              ${PRESETS.map(([name, hex]) => html`<button type="button" class="preset" data-action="preset-colour" data-hex="${hex}" aria-label="${name}" title="${name}"></button>`)}
            </div>
            <div class="wheel-preview">
              <span class="btn btn-primary" aria-hidden="true">Button</span>
              <span class="accent-text" aria-hidden="true">Accent text</span>
              <p class="muted" id="contrast-note"></p>
            </div>
            <button type="button" class="btn btn-primary" id="wheel-save" data-action="save-colour">${icon('check')}Save Colour</button>
          </div>
        </div>

        <fieldset class="segmented-field">
          <legend class="label">Motion</legend>
          <div class="seg-radio">
            ${[['auto', 'Match My Device'], ['reduced', 'Reduced'], ['full', 'Full']].map(([v, l]) => html`
              <label><input type="radio" name="motion" value="${v}" ${appearance.motion === v ? raw('checked') : ''}><span>${l}</span></label>`)}
          </div>
          <p class="field-hint">Reduced turns off page animations, the growing-tree animation and drifting particles.</p>
        </fieldset>
      </div>
    </section>

    ${isManager() ? html`
    <section class="settings-section" aria-labelledby="company-title">
      <div class="settings-intro">
        <h2 class="card-heading" id="company-title">${icon('users')}Company Default</h2>
        <p class="muted">What everyone at ${state.me.company.name} sees until they choose their own.</p>
      </div>
      <form class="settings-body" id="company-form">
        <div class="field">
          <label for="company-scheme">Default Colour Scheme</label>
          <select class="select" id="company-scheme" name="scheme">
            ${SCHEMES.filter((s) => s.id !== 'custom').map((s) => html`<option value="${s.id}" ${s.id === companyScheme ? raw('selected') : ''}>${s.name}</option>`)}
            <option value="custom" ${companyScheme === 'custom' ? raw('selected') : ''}>My custom colour</option>
          </select>
          <p class="field-hint">“My custom colour” uses the colour you’ve saved on the wheel above.</p>
        </div>
        <button type="submit" class="btn">Save Company Default</button>
      </form>
    </section>` : ''}

    <section class="settings-section" aria-labelledby="calendar-title">
      <div class="settings-intro">
        <h2 class="card-heading" id="calendar-title">${icon('calendar')}Calendar Sync</h2>
        <p class="muted">Your published shifts in Google Calendar, Outlook or Apple Calendar. They update by themselves.</p>
      </div>
      <div class="settings-body">
        <div class="field">
          <label for="cal-url">Subscription Link</label>
          <div class="copy-row">
            <input class="input mono" id="cal-url" readonly value="Loading…">
            <button type="button" class="btn" data-action="copy-calendar">${icon('copy')}Copy Link</button>
          </div>
          <p class="field-hint">Treat this link like a password: anyone with it can see your shifts.</p>
        </div>
        <div class="settings-actions">
          <a class="btn btn-ghost" id="cal-download" href="#" download="rostra-shifts.ics">${icon('download')}Download .ics</a>
          <button type="button" class="btn btn-ghost" data-action="reset-calendar">Reset Link…</button>
        </div>
      </div>
    </section>

    <section class="settings-section" aria-labelledby="password-title">
      <div class="settings-intro">
        <h2 class="card-heading" id="password-title">${icon('lock')}Password</h2>
        <p class="muted">Use at least 10 characters. A short phrase works well.</p>
      </div>
      <form class="settings-body" id="password-form" novalidate>
        <input type="text" name="username" autocomplete="username" value="${state.me.email}" hidden>
        <div class="field">
          <label for="pw-current">Current Password</label>
          <input class="input" id="pw-current" name="current" type="password" autocomplete="current-password" data-field="current">
          ${errorSlot('current', 'pw-current-error')}
        </div>
        <div class="field">
          <label for="pw-next">New Password</label>
          <input class="input" id="pw-next" name="next" type="password" autocomplete="new-password" minlength="10" data-field="next">
          ${errorSlot('next', 'pw-next-error')}
        </div>
        <button type="submit" class="btn">Change Password</button>
      </form>
    </section>`.v;

  // Swatch colours go in through CSSOM (the CSP blocks inline style attributes).
  for (const s of SCHEMES) {
    const colours = s.id === 'brand' ? [state.me.company.accent] : s.swatches;
    $$(`[data-scheme-card="${s.id}"] .scheme-preview i`).forEach((el, i) => el.style.setProperty('background', colours[i]));
  }
  $$('.preset').forEach((el) => el.style.setProperty('background', el.dataset.hex));
  wireWheel();
  syncWheel();
  wireForms();
  loadCalendar();
  if (location.hash) $(location.hash)?.scrollIntoView({ block: 'start' });
}

// A preset or typed hex is kept exactly; moving the wheel or a slider switches back to the HSV value.
function currentHex() { return picked.exact || hsvToHex(picked.h, picked.s, picked.v); }

function syncWheel({ preview = false } = {}) {
  const hex = currentHex();
  const wheel = $('#wheel');
  if (!wheel) return;
  const angle = (picked.h * Math.PI) / 180;
  const r = wheel.clientWidth / 2 || 110;
  $('#wheel-thumb').style.setProperty('transform', `translate(${Math.sin(angle) * picked.s * r}px, ${-Math.cos(angle) * picked.s * r}px)`);
  $('#wheel-thumb').style.setProperty('background', hex);
  $('#wheel-shade').style.setProperty('opacity', String(1 - picked.v));
  $('#hue').value = String(picked.h);
  $('#sat').value = String(Math.round(picked.s * 100));
  $('#val').value = String(Math.round(picked.v * 100));
  $('#hue-out').textContent = `${picked.h}°`;
  $('#sat-out').textContent = `${Math.round(picked.s * 100)}%`;
  $('#val-out').textContent = `${Math.round(picked.v * 100)}%`;
  $('#sat').style.setProperty('--track', `linear-gradient(90deg, ${hsvToHex(picked.h, 0, picked.v)}, ${hsvToHex(picked.h, 1, picked.v)})`);
  $('#val').style.setProperty('--track', `linear-gradient(90deg, #000, ${hsvToHex(picked.h, picked.s, 1)})`);
  if (document.activeElement !== $('#hex')) $('#hex').value = hex;
  const vars = accentVars(hex, document.documentElement.dataset.mode);
  const ratio = contrast(hexToRgb(vars['--accent-solid']), [255, 255, 255]);
  $('#contrast-note').textContent = vars['--accent-solid'].toUpperCase() === hex
    ? `White text on this colour reads at ${ratio.toFixed(1)}:1. Good to go.`
    : `Buttons use a deeper ${vars['--accent-solid'].toUpperCase()} so white text stays readable (${ratio.toFixed(1)}:1).`;
  if (preview) {
    updateAppearance({ scheme: 'custom', custom: hex }, { save: false });
    $('#wheel-save').dataset.dirty = '1';
  }
}

let frameRequested = false;
function previewSoon() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => { frameRequested = false; syncWheel({ preview: true }); });
}

function wireWheel() {
  const wheel = $('#wheel');
  const pick = (e) => {
    const box = wheel.getBoundingClientRect();
    const dx = e.clientX - (box.left + box.width / 2);
    const dy = e.clientY - (box.top + box.height / 2);
    picked.h = Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360);
    picked.s = Math.min(1, Math.hypot(dx, dy) / (box.width / 2));
    picked.exact = null;
    previewSoon();
  };
  wheel.addEventListener('pointerdown', (e) => { wheel.setPointerCapture(e.pointerId); pick(e); });
  wheel.addEventListener('pointermove', (e) => { if (wheel.hasPointerCapture(e.pointerId)) pick(e); });
  $('#hue').addEventListener('input', (e) => { picked.h = Number(e.target.value); picked.exact = null; previewSoon(); });
  $('#sat').addEventListener('input', (e) => { picked.s = Number(e.target.value) / 100; picked.exact = null; previewSoon(); });
  $('#val').addEventListener('input', (e) => { picked.v = Number(e.target.value) / 100; picked.exact = null; previewSoon(); });
  const hexInput = $('#hex');
  const commitHex = () => {
    const form = $('#wheel-panel');
    clearErrors(form);
    let v = hexInput.value.trim();
    if (!v.startsWith('#')) v = `#${v}`;
    if (/^#[0-9a-f]{3}$/i.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
    if (!/^#[0-9a-f]{6}$/i.test(v)) return showErrors(form, { custom: 'Use a 6-digit hex code, like #C2621D.' });
    picked = { ...hexToHsv(v.toUpperCase()), exact: v.toUpperCase() };
    syncWheel({ preview: true });
  };
  hexInput.addEventListener('change', commitHex);
  hexInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitHex(); } });
}

function wireForms() {
  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => { updateAppearance({ mode: r.value }); saved = { ...appearance }; }));
  document.querySelectorAll('input[name="motion"]').forEach((r) => r.addEventListener('change', () => { updateAppearance({ motion: r.value }); saved = { ...appearance }; }));
  document.querySelectorAll('input[name="scheme"]').forEach((r) => r.addEventListener('change', () => {
    $('#wheel-panel').hidden = r.value !== 'custom';
    if (r.value === 'custom') { syncWheel({ preview: true }); return; }
    updateAppearance({ scheme: r.value });
    saved = { ...appearance };
    toast(`Colour scheme set to ${SCHEMES.find((s) => s.id === r.value).name}.`);
  }));

  $('#company-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const scheme = e.target.scheme.value;
    const custom = scheme === 'custom' ? (appearance.custom || currentHex()) : null;
    await withLoading(e.submitter, async () => {
      try {
        state.me.company.appearance = await api('/company/appearance', { method: 'PUT', body: { scheme, custom } });
        toast(`${state.me.company.name} now defaults to ${scheme === 'custom' ? `your custom colour (${custom})` : SCHEMES.find((s) => s.id === scheme).name}.`);
      } catch (err) { toast(err.message, { tone: 'error' }); }
    });
  });

  $('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    clearErrors(form);
    const body = { current: form.current.value, next: form.next.value };
    const errors = {};
    if (!body.current) errors.current = 'Enter your current password.';
    if (body.next.length < 10) errors.next = 'Use at least 10 characters. A short phrase works well.';
    if (Object.keys(errors).length) return showErrors(form, errors);
    await withLoading(e.submitter, async () => {
      try {
        await api('/me/password', { method: 'POST', body });
        form.reset();
        toast('Password changed. Use it next time you sign in.');
      } catch (err) {
        if (err.errors) return showErrors(form, fromServer(err.errors));
        toast(err.message, { tone: 'error' });
      }
    });
  });
}

async function loadCalendar() {
  try {
    const { calendarPath } = await api('/me/settings');
    $('#cal-url').value = `webcal://${location.host}${calendarPath}`;
    $('#cal-download').setAttribute('href', calendarPath);
  } catch (e) { $('#cal-url').value = e.message; }
}

Object.assign(actions, {
  'preset-colour': (el) => { picked = { ...hexToHsv(el.dataset.hex), exact: el.dataset.hex.toUpperCase() }; syncWheel({ preview: true }); },
  'save-colour': async (el) => {
    await withLoading(el, async () => {
      updateAppearance({ scheme: 'custom', custom: currentHex() });
      saved = { ...appearance };
      el.dataset.dirty = '0';
      toast(`Custom colour ${currentHex()} saved.`);
    });
  },
  'copy-calendar': async () => {
    try {
      await navigator.clipboard.writeText($('#cal-url').value);
      toast('Link copied. Paste it into your calendar app’s “Subscribe” or “Add by URL”.');
    } catch {
      $('#cal-url').select();
      toast('Press Ctrl C (or ⌘ C) to copy the selected link.', { tone: 'error' });
    }
  },
  'reset-calendar': async (el) => {
    if (!confirm('Reset your calendar link? Calendars using the old link stop updating until you add the new one.')) return;
    await withLoading(el, async () => {
      try {
        const { calendarPath } = await api('/me/calendar/reset', { method: 'POST' });
        $('#cal-url').value = `webcal://${location.host}${calendarPath}`;
        $('#cal-download').setAttribute('href', calendarPath);
        toast('New calendar link ready. The old one no longer works.');
      } catch (e) { toast(e.message, { tone: 'error' }); }
    });
  },
});
