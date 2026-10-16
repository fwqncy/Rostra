// Entry point bundled to wwwroot/js/scenes/grove.js. Keeps the same small API Home already uses:
// mountGrove(canvas, { seed, data, reduced, onHover }) → { growTo, update, destroy }.
import * as THREE from 'three';
import { createRoot, events, extend } from '@react-three/fiber';
import { growthFor } from '/js/growth.js';
import { Grove } from './Grove.jsx';

extend(THREE);

/** Resolves a CSS colour token (including oklch from the Custom scheme) to a hex string. */
const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function cssColour(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = fallback;
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
const mix = (a, b, t) => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
const readColours = () => ({
  // Golden-hour haze: the card colour warmed a little by the scheme's sun. The far woods fade into it.
  fog: mix(cssColour('--surface', '#171b13'), cssColour('--sun', '#ffc77a'), 0.14),
  // Sunlit lawn green, nudged toward the scheme's moss so it sits with the palette.
  grass: mix('#9cc45a', cssColour('--moss', '#8aa65a'), 0.25),
});

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

export function mountGrove(canvas, { seed = 1, data, reduced = false, onHover } = {}) {
  if (!webglAvailable()) throw new Error('WebGL unavailable');
  const host = canvas.parentElement;
  const root = createRoot(canvas);
  let visible = true;
  let props = {
    seed, reduced, onHover,
    apples: data?.apples ?? [],
    fireflies: data?.fireflies ?? 0,
    growth: growthFor(data?.activeSeconds ?? 0),
    colours: readColours(),
  };

  const configure = () => root.configure({
    events,
    shadows: 'soft',
    dpr: [1, 2],
    // Reduced motion draws only when something changes; off-screen it stops drawing altogether.
    frameloop: reduced ? 'demand' : visible ? 'always' : 'never',
    gl: { antialias: true, alpha: true, powerPreference: 'low-power' },
    camera: { fov: 32, near: 0.1, far: 60, position: [0, 2.5, 10.5] },
    size: { width: host.clientWidth || 600, height: host.clientHeight || 360, top: 0, left: 0 },
    onCreated: ({ gl }) => {
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = 1.05;
      gl.setClearColor(0x000000, 0);
    },
  });
  const render = () => root.render(<Grove {...props} />);

  configure();
  render();

  const ro = new ResizeObserver(() => configure());
  ro.observe(host);
  const io = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting === visible) return;
    visible = entry.isIntersecting;
    configure();
  }, { threshold: 0.02 });
  io.observe(host);
  const onAppearance = () => { props = { ...props, colours: readColours() }; render(); };
  document.addEventListener('appearancechange', onAppearance);

  return {
    growTo(seconds) {
      props = { ...props, growth: growthFor(seconds) };
      render();
    },
    update(next) {
      props = { ...props, apples: next.apples ?? [], fireflies: next.fireflies ?? 0, growth: growthFor(next.activeSeconds ?? 0) };
      render();
    },
    destroy() {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('appearancechange', onAppearance);
      root.unmount();
    },
  };
}
