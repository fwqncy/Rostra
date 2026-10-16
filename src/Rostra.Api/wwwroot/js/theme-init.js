// Blocking on purpose: applies the saved colour scheme, mode and motion before first paint.
(function () {
  var root = document.documentElement;
  var a = { scheme: 'overgrowth', mode: 'dark', motion: 'auto', vars: null };
  try {
    var legacy = localStorage.getItem('rostra.theme');
    if (legacy) a.mode = legacy;
    var saved = JSON.parse(localStorage.getItem('rostra.appearance') || 'null');
    if (saved) for (var k in saved) a[k] = saved[k];
  } catch (e) { /* storage blocked: defaults are fine */ }
  var mode = a.mode === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : (a.mode === 'light' ? 'light' : 'dark');
  var reduced = a.motion === 'reduced' || (a.motion !== 'full' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  root.setAttribute('data-scheme', a.scheme || 'overgrowth');
  root.setAttribute('data-mode', mode);
  root.setAttribute('data-motion', reduced ? 'reduced' : 'full');
  if (a.vars) for (var v in a.vars) root.style.setProperty(v, a.vars[v]);
})();
