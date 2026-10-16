// Sign-in backdrop: an overgrown forest at golden hour. Tall trunks recede into fog, light shafts
// cut through the canopy and spores drift in the air. Colours come from the active colour scheme.
import * as THREE from '/vendor/three/three.module.min.js';

const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function cssColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = fallback;
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function texture(draw, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function mountForest(canvas) {
  const reduced = document.documentElement.dataset.motion === 'reduced';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
  camera.position.set(0, 1.7, 9);
  const look = new THREE.Vector3(0, 3.2, -12);
  const r = seeded(42);
  const disposables = [];
  const keep = (o) => { disposables.push(o); return o; };

  scene.fog = new THREE.FogExp2(0x10130d, 0.055);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x223311, 0.9);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(14, 22, -8);
  scene.add(hemi, sun);

  // Ground
  const groundMat = keep(new THREE.MeshStandardMaterial({ roughness: 1, color: 0x2a3a1e }));
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(140, 140)), groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Trunks: tall, slightly leaning, mossy at the base (vertex colours).
  const trunkGeo = keep(new THREE.CylinderGeometry(0.75, 1, 1, 9, 6));
  trunkGeo.translate(0, 0.5, 0);
  const colours = [];
  const pos = trunkGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const moss = Math.max(0, 1 - y * 3.2);
    colours.push(0.22 + moss * 0.06, 0.16 + moss * 0.2, 0.11 + moss * 0.02);
  }
  trunkGeo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  const trunkMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  const trunkCount = 80;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trunkCount);
  const m = new THREE.Matrix4();
  for (let i = 0; i < trunkCount; i++) {
    let x = (r() - 0.5) * 34;
    const z = -r() * 42 + 4;
    if (Math.abs(x) < 2.2 && z > -10) x += Math.sign(x || 1) * 3; // keep a clearing in the middle
    const radius = 0.25 + r() * 0.55;
    const height = 18 + r() * 14;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.08, r() * Math.PI, (r() - 0.5) * 0.1));
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(radius, height, radius));
    trunks.setMatrixAt(i, m);
  }
  scene.add(trunks);

  // Ferns: low-poly fronds scattered over the forest floor.
  const fernGeo = keep(new THREE.ConeGeometry(0.5, 0.9, 5, 1, true));
  fernGeo.translate(0, 0.35, 0);
  const fernMat = keep(new THREE.MeshStandardMaterial({ color: 0x3f5f2a, roughness: 0.9, side: THREE.DoubleSide, flatShading: true }));
  const fernCount = 260;
  const ferns = new THREE.InstancedMesh(fernGeo, fernMat, fernCount);
  for (let i = 0; i < fernCount; i++) {
    const x = (r() - 0.5) * 30;
    const z = -r() * 30 + 6;
    const s = 0.5 + r() * 1.3;
    m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 0.3, r() * 6, r() * 0.3)), new THREE.Vector3(s * 1.4, s * (0.6 + r() * 0.6), s * 1.4));
    ferns.setMatrixAt(i, m);
  }
  scene.add(ferns);

  // Light shafts slanting down from the canopy.
  const rayTex = keep(texture((g, w, h) => {
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, 'rgba(255,255,255,0.85)');
    v.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    v.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-out';
    const s = g.createLinearGradient(0, 0, w, 0);
    s.addColorStop(0, 'rgba(0,0,0,1)'); s.addColorStop(0.5, 'rgba(0,0,0,0)'); s.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = s; g.fillRect(0, 0, w, h);
  }, 32, 256));
  const shafts = [];
  for (let i = 0; i < 7; i++) {
    const mat = keep(new THREE.MeshBasicMaterial({ map: rayTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.1, side: THREE.DoubleSide, fog: false }));
    const shaft = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.2 + r() * 2.2, 34)), mat);
    shaft.position.set(-4 + i * 2.1 + r(), 12, -6 - r() * 18);
    shaft.rotation.set(0, (r() - 0.5) * 0.4, 0.5 + r() * 0.12);
    shaft.userData.phase = r() * 10;
    scene.add(shaft);
    shafts.push(shaft);
  }

  // Spores drifting through the light.
  const sporeCount = 900;
  const sporeGeo = keep(new THREE.BufferGeometry());
  const sp = new Float32Array(sporeCount * 3);
  for (let i = 0; i < sporeCount; i++) { sp[i * 3] = (r() - 0.5) * 26; sp[i * 3 + 1] = r() * 10; sp[i * 3 + 2] = -r() * 30 + 7; }
  sporeGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const sporeTex = keep(texture((g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  }, 32, 32));
  const sporeMat = keep(new THREE.PointsMaterial({ size: 0.07, map: sporeTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
  const spores = new THREE.Points(sporeGeo, sporeMat);
  scene.add(spores);

  function recolour() {
    const bg = cssColor('--bg', '#10130d');
    const sunColour = cssColor('--sun', '#ffc77a');
    const moss = cssColor('--moss', '#8aa65a');
    const light = document.documentElement.dataset.mode === 'light';
    renderer.setClearColor(bg);
    scene.fog.color.copy(bg);
    scene.fog.density = light ? 0.04 : 0.055;
    sun.color.copy(sunColour);
    hemi.color.copy(sunColour);
    hemi.groundColor.copy(moss).multiplyScalar(0.3);
    groundMat.color.copy(moss).multiplyScalar(light ? 0.6 : 0.3);
    fernMat.color.copy(moss).multiplyScalar(light ? 0.8 : 0.45);
    sporeMat.color.copy(sunColour);
    shafts.forEach((s) => s.material.color.copy(sunColour));
    renderer.toneMappingExposure = light ? 1.25 : 1;
  }

  let pointerX = 0;
  let pointerY = 0;
  const onPointer = (e) => { pointerX = e.clientX / innerWidth - 0.5; pointerY = e.clientY / innerHeight - 0.5; };
  addEventListener('pointermove', onPointer, { passive: true });

  function resize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 68 : 52;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(() => { resize(); if (reduced) render(); });
  ro.observe(canvas);

  let frame = 0;
  let t = 0;
  let last = performance.now();
  const render = () => { camera.lookAt(look); renderer.render(scene, camera); };
  function loop(now) {
    frame = requestAnimationFrame(loop);
    if (document.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    camera.position.x += ((Math.sin(t * 0.08) * 0.6 + pointerX * 0.8) - camera.position.x) * 0.03;
    camera.position.y += ((1.7 + Math.sin(t * 0.11) * 0.12 - pointerY * 0.3) - camera.position.y) * 0.03;
    shafts.forEach((s) => { s.material.opacity = 0.07 + 0.06 * (0.5 + 0.5 * Math.sin(t * 0.35 + s.userData.phase)); });
    const p = sporeGeo.attributes.position;
    for (let i = 0; i < sporeCount; i++) {
      let y = p.getY(i) + (0.05 + (i % 7) * 0.01) * dt;
      const x = p.getX(i) + Math.sin(t * 0.3 + i) * 0.05 * dt;
      if (y > 10) y = 0;
      p.setXY(i, x, y);
    }
    p.needsUpdate = true;
    render();
  }
  const onAppearance = () => { recolour(); if (reduced) render(); };
  document.addEventListener('appearancechange', onAppearance);

  resize();
  recolour();
  canvas.classList.add('is-ready');
  if (reduced) render(); else frame = requestAnimationFrame(loop);

  return {
    destroy() {
      cancelAnimationFrame(frame);
      ro.disconnect();
      removeEventListener('pointermove', onPointer);
      document.removeEventListener('appearancechange', onAppearance);
      disposables.forEach((d) => d.dispose?.());
      trunks.dispose(); ferns.dispose();
      renderer.dispose();
    },
  };
}
