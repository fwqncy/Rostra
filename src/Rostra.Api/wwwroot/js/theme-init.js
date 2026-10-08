// Blocking on purpose: applies the saved theme and last company accent before first paint.
(function () {
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem('rostra.theme');
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    var accent = JSON.parse(localStorage.getItem('rostra.accent') || 'null');
    if (accent) for (var key in accent) root.style.setProperty(key, accent[key]);
  } catch (e) { /* storage blocked: defaults are fine */ }
})();
