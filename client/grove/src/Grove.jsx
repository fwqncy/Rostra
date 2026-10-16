// A low-poly cherry blossom: tapered trunk, chunky icosahedron canopy in blossom pinks,
// petals drifting off the branches and settling on the grass. It grows with time spent in Rostra.
import * as THREE from 'three';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { FRUITING } from '/js/growth.js';

const PINKS = ['#f48fb1', '#f7a1c0', '#ec7fa9', '#f9b4cc', '#e8739f', '#f6a8c3', '#f08cb2'];
const PETALS = ['#f8b7cd', '#f49ab9', '#fcd3e1', '#f08cb2'];
const smooth = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Mulberry32: a small seeded RNG, so each person's tree keeps its own shape. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A curved, tapering, few-sided tube: the faceted trunk and branches in the reference. */
function taperedTube(curve, segments, radial, r0, r1) {
  const frames = curve.computeFrenetFrames(segments, false);
  const positions = [];
  const index = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    const n = frames.normals[i];
    const b = frames.binormals[i];
    const radius = r0 + (r1 - r0) * t;
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      positions.push(
        p.x + (n.x * Math.cos(a) + b.x * Math.sin(a)) * radius,
        p.y + (n.y * Math.cos(a) + b.y * Math.sin(a)) * radius,
        p.z + (n.z * Math.cos(a) + b.z * Math.sin(a)) * radius,
      );
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** The person's tree: trunk curve, canopy puffs, branches, and where fruit can hang. */
function useTreeShape(seed) {
  return useMemo(() => {
    const r = rng(seed);
    const lean = (r() - 0.5) * 0.5;
    const top = V(lean, 2.3, (r() - 0.5) * 0.2);
    const trunk = new THREE.CatmullRomCurve3([
      V(0, -0.05, 0), V((r() - 0.5) * 0.14, 0.75, (r() - 0.5) * 0.08), V(lean * 0.65, 1.6, (r() - 0.5) * 0.12), top,
    ]);

    // A crown puff on top, then a dome of puffs around it, each with its own moment to appear.
    const puffs = [{ center: top.clone().add(V(0, 1.0, 0)), radius: 0.95, birth: 0.02, colour: PINKS[0], phase: r() * 6 }];
    const count = 8;
    const order = Array.from({ length: count }, (_, i) => i).sort(() => r() - 0.5);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + r() * 0.5;
      const ring = 0.85 + r() * 0.4;
      puffs.push({
        center: top.clone().add(V(Math.cos(angle) * ring, 0.3 + r() * 0.8, Math.sin(angle) * ring)),
        radius: 0.5 + r() * 0.32,
        birth: 0.1 + order[i] * 0.07,
        colour: PINKS[(i + 1) % PINKS.length],
        phase: r() * 6,
      });
    }

    // Branches fork off the upper trunk toward some of the lower puffs, like the reference.
    const branches = puffs.slice(1).filter((p) => p.center.y < top.y + 0.75).slice(0, 4).map((p) => {
      const from = trunk.getPointAt(0.62 + r() * 0.3);
      const to = p.center.clone().lerp(top, 0.2);
      const mid = from.clone().lerp(to, 0.5).add(V(0, 0.15, 0));
      return { curve: new THREE.QuadraticBezierCurve3(from, mid, to), puff: p };
    });

    // Fruit hangs from the underside of the puffs.
    const spots = [];
    puffs.forEach((p, pi) => {
      for (let k = 0; k < 4; k++) {
        const dir = V((r() - 0.5) * 1.6, -0.2 - r() * 0.6, (r() - 0.5) * 1.6).normalize();
        spots.push({ puff: pi, offset: dir.multiplyScalar(p.radius * 1.04) });
      }
    });
    spots.sort(() => r() - 0.5);
    return { trunk, top, puffs, branches, spots };
  }, [seed]);
}

function Trunk({ shape, thickness }) {
  // Rebuilt in coarse steps as the trunk thickens; a few hundred vertices, so it's cheap.
  const step = Math.round(thickness * 25) / 25;
  const trunk = useMemo(() => taperedTube(shape.trunk, 6, 7, 0.33 * step, 0.15 * step), [shape, step]);
  const branches = useMemo(() => shape.branches.map((b) => taperedTube(b.curve, 3, 5, 0.1 * step, 0.05 * step)), [shape, step]);
  useEffect(() => () => { trunk.dispose(); branches.forEach((g) => g.dispose()); }, [trunk, branches]);
  return (
    <group>
      <mesh geometry={trunk} castShadow receiveShadow>
        <meshStandardMaterial color="#8a4b2d" roughness={0.9} flatShading />
      </mesh>
      {branches.map((geo, i) => (
        <mesh key={i} geometry={geo} castShadow userData={{ puff: shape.branches[i].puff }} name="branch">
          <meshStandardMaterial color="#8f4f30" roughness={0.9} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function Ground({ colour }) {
  return (
    <group>
      {/* A raised round of sunlit lawn; its rim sits just proud of the meadow. */}
      <mesh position={[0, -0.15, 0]} receiveShadow>
        <cylinderGeometry args={[3.5, 3.8, 0.3, 11]} />
        <meshStandardMaterial color={colour} roughness={1} flatShading />
      </mesh>
      {/* Knolls in the grass catch the light like the reference's sunlit lawn. */}
      {[[-1.9, 0.9, 0.42], [2.1, -0.6, 0.36], [0.6, 2.2, 0.3], [-1.2, -1.9, 0.34]].map(([x, z, s], i) => (
        <mesh key={i} position={[x, -0.02, z]} scale={[s * 2.2, s * 0.55, s * 2.2]} receiveShadow>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={colour} roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/** Height of the meadow: flat around the lawn, rolling further out, climbing toward the far woods. */
function terrain(x, z) {
  const out = smooth(clamp01((Math.hypot(x, z) - 4.6) / 5)) * smooth(clamp01((2 - z) / 6));
  const rolling = Math.sin(x * 0.42 + 1.3) * Math.cos(z * 0.36 - 0.4) * 0.35 + Math.sin(x * 0.95 + z * 0.7) * 0.12;
  const rise = z < -9 ? (-z - 9) * 0.07 : 0;
  return -0.12 + (rolling + rise) * out;
}

function Meadow({ colour }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(72, 60, 36, 30);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -12);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, terrain(p.getX(i), p.getZ(i)) - 0.002);
    g.computeVertexNormals();
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial color={colour} roughness={1} flatShading />
    </mesh>
  );
}

const BARK = '#6b4026';
const PINE = ['#2f6a35', '#3a7a3c', '#467f3a', '#2c5f38', '#3f8a46'];
const LEAF = [['#5b9a45', '#6fae52', '#4d8a3d'], ['#7aae4f', '#8bbd5c', '#6a9e44'], ['#4f8f4a', '#62a356', '#43803f']];
const BLOSSOM = ['#f29bbb', '#f7b3cb', '#ea86ab'];
const BUSH = ['#4f8c3d', '#5f9d48', '#437e38'];
const ROCK = ['#8f8e86', '#a3a197', '#7e7d75'];
const HILL = ['#4f8a42', '#5d9649', '#46803c'];
const FLOWER = ['#fff6e8', '#ffd84d', '#f7a8c4', '#ffffff'];

/**
 * Everything behind the lawn, baked into one geometry: framing trees either side of the clearing,
 * a mixed row of pines, broadleaves and small cherries, a far tree line and hills that fade into the
 * fog, and bushes, rocks, tufts and flowers on the meadow. Each facet gets its own shade, and aSway
 * says how far a vertex moves in the breeze (more toward the treetops).
 */
function buildScenery() {
  const r = rng(4127);
  const base = {
    cone: new THREE.ConeGeometry(1, 1, 7, 1).toNonIndexed(),
    tuft: new THREE.ConeGeometry(1, 1, 3, 1).toNonIndexed(),
    trunk: new THREE.CylinderGeometry(0.75, 1, 1, 5, 1).toNonIndexed(),
    blob: new THREE.IcosahedronGeometry(1, 0),
    hill: new THREE.IcosahedronGeometry(1, 1),
    rock: new THREE.DodecahedronGeometry(1, 0),
  };
  const positions = [];
  const colours = [];
  const sway = [];
  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const put = (geo, [x, y, z], [sx, sy, sz], colour, { bend = 0, foot = y, tilt = 0 } = {}) => {
    euler.set((r() - 0.5) * tilt, r() * Math.PI * 2, (r() - 0.5) * tilt);
    matrix.compose(p.set(x, y, z), turn.setFromEuler(euler), new THREE.Vector3(sx, sy, sz));
    const a = geo.attributes.position;
    c.set(colour);
    let shade = 1;
    for (let i = 0; i < a.count; i++) {
      if (i % 3 === 0) shade = 0.88 + r() * 0.2;
      p.fromBufferAttribute(a, i).applyMatrix4(matrix);
      positions.push(p.x, p.y, p.z);
      colours.push(c.r * shade, c.g * shade, c.b * shade);
      sway.push(bend * Math.max(0, p.y - foot));
    }
  };
  const pick = (list) => list[Math.floor(r() * list.length)];

  const pine = (x, z, h, w) => {
    const y = terrain(x, z) - 0.05;
    const colour = pick(PINE);
    put(base.trunk, [x, y + 0.3, z], [0.16 * w, 0.7, 0.16 * w], BARK);
    for (let i = 0; i < 3; i++) {
      const tier = 1 - i * 0.26;
      c.set(colour).multiplyScalar(0.86 + i * 0.08);
      put(base.cone, [x, y + 0.55 + h * (0.2 + i * 0.25), z], [w * tier, h * 0.42, w * tier], `#${c.getHexString()}`, { bend: 0.008, foot: y, tilt: 0.06 });
    }
  };
  const broadleaf = (x, z, h, w, palette = pick(LEAF)) => {
    const y = terrain(x, z) - 0.05;
    put(base.trunk, [x, y + h * 0.3, z], [0.13 * w, h * 0.6, 0.13 * w], BARK);
    const sideways = r() * Math.PI * 2;
    put(base.blob, [x, y + h * 0.75, z], [w, w * 0.9, w], palette[0], { bend: 0.012, foot: y });
    put(base.blob, [x + Math.cos(sideways) * w * 0.6, y + h * 0.6, z + Math.sin(sideways) * w * 0.45], [w * 0.72, w * 0.66, w * 0.72], palette[1], { bend: 0.012, foot: y });
    put(base.blob, [x - Math.cos(sideways) * w * 0.55, y + h * 0.63, z - Math.sin(sideways) * w * 0.4], [w * 0.64, w * 0.6, w * 0.64], palette[2], { bend: 0.012, foot: y });
  };

  // Framing trees either side of the clearing, close enough to read clearly.
  [[-6.3, -1.1], [-5.3, -3.9], [-7.9, -3.1], [-9.2, -0.4], [6.1, -1.5], [5.4, -4.3], [8.0, -2.7], [9.3, 0.1]].forEach(([x, z], i) => {
    if (i % 3 === 1) broadleaf(x, z, 3.6 + r() * 1.2, 1.15 + r() * 0.3);
    else pine(x, z, 4.6 + r() * 1.8, 1.25 + r() * 0.35);
  });
  // A few young cherries in the woods echo yours.
  [[-4.3, -6.4], [4.9, -6.9], [-10.2, -7.6], [10.6, -8.2]].forEach(([x, z]) => broadleaf(x, z, 2.4 + r() * 0.6, 0.85 + r() * 0.15, BLOSSOM));
  // The woods behind: a looser mixed row, with a gap behind the cherry so its silhouette reads.
  for (let x = -12.5; x <= 12.5; x += 1.2 + r() * 0.6) {
    if (Math.abs(x) < 1.6 && r() < 0.6) continue;
    const z = -5.8 - r() * 3.2;
    const kind = r();
    if (kind < 0.35) broadleaf(x, z, 2.8 + r() * 1.2, 0.95 + r() * 0.3);
    else pine(x, z, 3.4 + r() * 2.4, 1 + r() * 0.35);
  }
  // A dense far tree line, mostly lost in the haze.
  for (let x = -19; x <= 19; x += 0.85 + r() * 0.5) pine(x, -10.5 - r() * 4.5, 4 + r() * 3.2, 1.1 + r() * 0.4);
  // Rolling hills on the horizon.
  for (let i = 0; i < 8; i++) {
    const x = -21 + i * 6 + (r() - 0.5) * 2.5;
    const z = -16.5 - r() * 3;
    put(base.hill, [x, terrain(x, z) - 0.9, z], [5 + r() * 3, 2.2 + r() * 1.6, 3.6], pick(HILL));
  }
  // Bushes, rocks, tufts and flowers around the lawn, mostly on the far side and the flanks.
  const around = (inner, outer) => {
    const a = Math.PI * (0.9 + r() * 1.2);
    const d = inner + r() * (outer - inner);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    return [x, terrain(x, z), z];
  };
  for (let i = 0; i < 26; i++) {
    const [x, y, z] = around(4.1, 7.5);
    const w = 0.4 + r() * 0.35;
    put(base.blob, [x, y + w * 0.35, z], [w, w * 0.7, w], pick(BUSH), { bend: 0.03, foot: y });
  }
  for (let i = 0; i < 8; i++) {
    const [x, y, z] = around(4.2, 8);
    const w = 0.2 + r() * 0.25;
    put(base.rock, [x, y + w * 0.25, z], [w, w * 0.65, w * 0.9], pick(ROCK), { tilt: 0.5 });
  }
  for (let i = 0; i < 110; i++) {
    const [x, y, z] = around(3.75, 9);
    put(base.tuft, [x, y + 0.1, z], [0.07, 0.24 + r() * 0.12, 0.07], pick(BUSH), { bend: 0.25, foot: y, tilt: 0.5 });
  }
  for (let i = 0; i < 90; i++) {
    const [x, y, z] = around(3.75, 8.5);
    put(base.blob, [x, y + 0.08, z], [0.055, 0.045, 0.055], pick(FLOWER));
  }

  Object.values(base).forEach((g) => g.dispose());
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geo.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Haze behind the far tree line: solid fog colour at the horizon, thinning to nothing overhead,
 * so the fogged meadow and woods melt into the card instead of ending at a hard edge.
 */
function Haze({ colour }) {
  const texture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const g = c.getContext('2d');
    const [r, gr, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
    const at = (a) => `rgba(${r},${gr},${b},${a})`;
    const grad = g.createLinearGradient(0, 256, 0, 0);
    // The plane runs from y −2 to 16; the frame's top edge is near y 11, so the haze is gone by y 8.
    grad.addColorStop(0, at(1));
    grad.addColorStop(0.17, at(1));
    grad.addColorStop(0.3, at(0.55));
    grad.addColorStop(0.45, at(0.14));
    grad.addColorStop(0.56, at(0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [colour]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={[0, 7, -24]}>
      <planeGeometry args={[100, 18]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} fog={false} toneMapped={false} />
    </mesh>
  );
}

/** The scenery sways in the same breeze as the canopy; under reduced motion it holds still. */
function Scenery({ reduced }) {
  const geo = useMemo(buildScenery, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const time = useMemo(() => ({ value: 0 }), []);
  const onBeforeCompile = useMemo(() => (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aSway;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.x += sin(uTime * 0.8 + position.x * 0.31 + position.z * 0.17) * aSway;
        transformed.z += sin(uTime * 0.6 + position.x * 0.23) * aSway * 0.4;`);
  }, [time]);
  useFrame(({ clock }) => { if (!reduced) time.value = clock.elapsedTime; });
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial vertexColors roughness={0.92} flatShading onBeforeCompile={onBeforeCompile} />
    </mesh>
  );
}

function Canopy({ shape, growth }) {
  const refs = useRef([]);
  useFrame(({ clock }) => {
    const g = growth.current;
    const t = clock.elapsedTime;
    shape.puffs.forEach((p, i) => {
      const mesh = refs.current[i];
      if (!mesh) return;
      const s = smooth(clamp01((g - p.birth) / 0.12)) * p.radius;
      mesh.scale.setScalar(Math.max(0.0001, s));
      // A breeze: each puff bobs on its own rhythm.
      mesh.position.set(p.center.x + Math.sin(t * 0.6 + p.phase) * 0.02, p.center.y + Math.sin(t * 0.9 + p.phase) * 0.025, p.center.z);
      mesh.rotation.y = Math.sin(t * 0.3 + p.phase) * 0.05;
    });
  });
  return shape.puffs.map((p, i) => (
    <mesh key={i} ref={(m) => { refs.current[i] = m; }} position={p.center} castShadow receiveShadow>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color={p.colour} roughness={0.7} flatShading emissive={p.colour} emissiveIntensity={0.12} />
    </mesh>
  ));
}

function Apples({ shape, growth, apples, reduced, onHover }) {
  const shown = useMemo(() => apples.slice(-Math.min(apples.length, 24)), [apples]);
  const refs = useRef([]);
  useFrame((_, dt) => {
    const g = growth.current;
    shown.forEach((a, i) => {
      const mesh = refs.current[i];
      if (!mesh) return;
      const spot = shape.spots[i % shape.spots.length];
      const puff = shape.puffs[spot.puff];
      const puffScale = smooth(clamp01((g - puff.birth) / 0.12));
      const target = g >= FRUITING && puffScale > 0.6 ? 1 : 0;
      // Springy pop-in once the tree is old enough to fruit; a still frame shows them fully grown.
      const s = mesh.userData.s ?? 0;
      const next = reduced ? target : s + (target - s) * (1 - Math.exp(-dt * 6));
      mesh.userData.s = next;
      mesh.scale.setScalar(Math.max(0.0001, next * (1 + 0.15 * Math.sin(next * Math.PI))));
      mesh.position.copy(puff.center).addScaledVector(spot.offset, puffScale);
    });
  });
  return shown.map((a, i) => {
    const ripe = a.status === 'published' || a.status === 'completed';
    return (
      <mesh
        key={`${a.weekStart}-${a.label}`}
        ref={(m) => { refs.current[i] = m; }}
        castShadow
        onPointerOver={(e) => { e.stopPropagation(); onHover?.({ ...a, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }); }}
        onPointerMove={(e) => { e.stopPropagation(); onHover?.({ ...a, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }); }}
        onPointerOut={() => onHover?.(null)}
      >
        <icosahedronGeometry args={[0.15, 1]} />
        <meshStandardMaterial color={ripe ? '#c62828' : '#7cb342'} roughness={0.35} flatShading emissive={ripe ? '#3a0806' : '#1a2a08'} emissiveIntensity={0.3} />
        <mesh position={[0, 0.16, 0]}>
          <cylinderGeometry args={[0.012, 0.016, 0.09, 4]} />
          <meshStandardMaterial color="#4a3524" />
        </mesh>
      </mesh>
    );
  });
}

/**
 * Petals drift off the canopy, tumble on the breeze, settle on the grass for a while,
 * then lift back into the canopy's petal pool. More blossom, more petals.
 */
function Petals({ shape, growth, scale, reduced }) {
  const COUNT = 160;
  const mesh = useRef();
  const sim = useMemo(() => {
    const r = rng(9);
    return Array.from({ length: COUNT }, () => ({
      pos: V(0, -10, 0), vel: V(0, 0, 0), rot: new THREE.Euler(r() * 6, r() * 6, r() * 6), spin: V(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(4),
      phase: r() * 10, rest: 0, state: 'idle', delay: r() * 8, size: 0.7 + r() * 0.6, colour: PETALS[Math.floor(r() * PETALS.length)],
    }));
  }, []);
  const geo = useMemo(() => {
    const g = new THREE.CircleGeometry(0.075, 5);
    g.scale(1, 0.62, 1);
    return g;
  }, []);
  useEffect(() => {
    const colour = new THREE.Color();
    sim.forEach((p, i) => mesh.current.setColorAt(i, colour.set(p.colour)));
    mesh.current.instanceColor.needsUpdate = true;
  }, [sim]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const spawn = (p, g) => {
    const live = shape.puffs.filter((q) => g > q.birth + 0.05);
    if (!live.length) { p.state = 'idle'; p.delay = 1 + Math.random() * 3; return; }
    const puff = live[Math.floor(Math.random() * live.length)];
    const dir = V(Math.random() - 0.5, Math.random() - 0.6, Math.random() - 0.5).normalize();
    p.pos.copy(puff.center).addScaledVector(dir, puff.radius * 0.95).multiplyScalar(scale.current);
    p.vel.set((Math.random() - 0.5) * 0.12, -0.18 - Math.random() * 0.18, (Math.random() - 0.5) * 0.12);
    p.state = 'falling';
  };

  useFrame(({ clock }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const g = growth.current;
    const t = clock.elapsedTime;
    const active = Math.floor(COUNT * smooth(clamp01((g - 0.08) / 0.55)));
    sim.forEach((p, i) => {
      if (i >= active) { dummy.scale.setScalar(0.0001); dummy.updateMatrix(); mesh.current.setMatrixAt(i, dummy.matrix); return; }
      if (reduced) {
        // Still frame: a carpet of fallen petals and a few caught mid-air.
        if (p.state === 'idle') {
          const a = (i * 2.4) % (Math.PI * 2); const d = (0.4 + ((i * 0.37) % 2.4)) * Math.max(0.45, scale.current);
          p.pos.set(Math.cos(a) * d, 0.01, Math.sin(a) * d); p.rot.set(-Math.PI / 2, 0, i); p.state = 'resting'; p.rest = Infinity;
        }
      } else if (p.state === 'idle') {
        p.delay -= dt;
        if (p.delay <= 0) spawn(p, g);
      } else if (p.state === 'falling') {
        // Light petals: slow fall, side-to-side flutter, a little drift on the breeze.
        p.vel.y = Math.max(p.vel.y - 0.05 * dt, -0.42);
        p.pos.x += (p.vel.x + Math.sin(t * 1.7 + p.phase) * 0.22 + 0.06) * dt;
        p.pos.z += (p.vel.z + Math.cos(t * 1.3 + p.phase) * 0.18) * dt;
        p.pos.y += p.vel.y * dt;
        p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt;
        const ground = Math.hypot(p.pos.x, p.pos.z) < 3.45 ? 0.012 : -0.105;
        if (p.pos.y <= ground) {
          p.pos.y = ground; p.rot.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.4, 0, Math.random() * 6);
          p.state = 'resting'; p.rest = 5 + Math.random() * 9;
        }
      } else if (p.state === 'resting' && p.rest !== Infinity) {
        p.rest -= dt;
        if (p.rest <= 0) { p.state = 'idle'; p.delay = Math.random() * 2; }
      }
      const fade = p.state === 'resting' && p.rest !== Infinity ? Math.min(1, p.rest / 1.5) : 1;
      dummy.position.copy(p.pos);
      dummy.rotation.copy(p.rot);
      dummy.scale.setScalar(p.state === 'idle' ? 0.0001 : p.size * fade * Math.max(0.55, scale.current));
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[geo, undefined, COUNT]} castShadow>
      <meshStandardMaterial side={THREE.DoubleSide} roughness={0.6} emissive="#f6b0c8" emissiveIntensity={0.15} />
    </instancedMesh>
  );
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,250,200,1)');
  grad.addColorStop(0.35, 'rgba(255,250,200,0.45)');
  grad.addColorStop(1, 'rgba(255,250,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** One firefly per kudos received this month. */
function Fireflies({ count, reduced }) {
  const texture = useMemo(glowTexture, []);
  const flies = useMemo(() => {
    const r = rng(31 + count);
    return Array.from({ length: count }, () => ({ a: r() * 6.28, rad: 1.4 + r() * 1.8, h: 1.2 + r() * 2.8, speed: 0.15 + r() * 0.25, phase: r() * 10 }));
  }, [count]);
  const refs = useRef([]);
  useFrame(({ clock }) => {
    const t0 = reduced ? 0 : clock.elapsedTime;
    flies.forEach((f, i) => {
      const s = refs.current[i];
      if (!s) return;
      const t = t0 * f.speed + f.phase;
      s.position.set(Math.cos(f.a + t) * f.rad, f.h + Math.sin(t * 1.7) * 0.35, Math.sin(f.a + t) * f.rad * 0.7);
      s.material.opacity = 0.45 + 0.55 * Math.max(0, Math.sin(t * 3.1));
    });
  });
  return flies.map((_, i) => (
    <sprite key={i} ref={(s) => { refs.current[i] = s; }} scale={0.34}>
      <spriteMaterial map={texture} color="#f7ef9a" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </sprite>
  ));
}

/** Drag to turn the tree; it eases back into a slow drift. */
function useSpin(group, reduced) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const state = useRef({ spin: 0, velocity: 0, dragging: false, lastX: 0 });
  useEffect(() => {
    const el = gl.domElement;
    const down = (e) => { state.current.dragging = true; state.current.lastX = e.clientX; el.setPointerCapture?.(e.pointerId); };
    const move = (e) => {
      const s = state.current;
      if (!s.dragging) return;
      s.velocity = (e.clientX - s.lastX) * 0.006; s.lastX = e.clientX; s.spin += s.velocity;
      invalidate();
    };
    const up = (e) => { state.current.dragging = false; el.releasePointerCapture?.(e.pointerId); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
  }, [gl, invalidate]);
  useFrame((_, dt) => {
    const s = state.current;
    if (!s.dragging) { s.velocity *= 0.94; s.spin += s.velocity + (reduced ? 0 : Math.min(dt, 0.05) * 0.05); }
    if (group.current) group.current.rotation.y = s.spin;
  });
}

/** Frames the tree: pulls back on tall, narrow cards so the whole canopy fits. */
function Framing({ distance }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    camera.position.set(0, 2.4, distance);
    camera.lookAt(0, 2.05, 0);
    camera.updateProjectionMatrix();
  }, [camera, distance]);
  return null;
}

export function Grove({ seed, growth: target, apples, fireflies, reduced, onHover, colours }) {
  const shape = useTreeShape(seed);
  const turntable = useRef();
  const tree = useRef();
  const size = useThree((s) => s.size);
  const distance = size.width / Math.max(1, size.height) < 1 ? 14.5 : 11;
  // Growth eases toward its target: the first visit grows the tree from a seed.
  const growth = useRef(reduced ? target : 0.02);
  // The lawn and scenery stay put; only the tree grows from a sapling's size.
  const scaleFor = (g) => 0.32 + 0.68 * smooth(clamp01(g / 0.9));
  const scale = useRef(scaleFor(growth.current));
  const [thickness, setThickness] = useState(0.4 + 0.6 * growth.current);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { if (reduced) { growth.current = target; setThickness(0.4 + 0.6 * target); invalidate(); } }, [target, reduced, invalidate]);
  useSpin(turntable, reduced);
  useFrame((_, dt) => {
    if (reduced) return;
    const g = growth.current + (target - growth.current) * (1 - Math.exp(-Math.min(dt, 0.05) * 1.1));
    growth.current = g;
    const thick = 0.4 + 0.6 * g;
    if (Math.abs(thick - thickness) > 0.04) setThickness(thick);
    scale.current = scaleFor(g);
    if (tree.current) tree.current.scale.setScalar(scale.current);
  });
  useEffect(() => {
    if (!reduced) return;
    scale.current = scaleFor(target);
    if (tree.current) tree.current.scale.setScalar(scale.current);
  }, [reduced, target]);

  // The wider meadow is a deeper green than the sunlit lawn.
  const meadow = useMemo(() => `#${new THREE.Color(colours.grass).lerp(new THREE.Color('#3e6b2b'), 0.42).getHexString()}`, [colours.grass]);

  return (
    <>
      <Framing distance={distance} />
      <fog attach="fog" args={[colours.fog, distance + 1, distance + 18]} />
      <hemisphereLight args={['#fff1dc', colours.grass, 1.15]} />
      <directionalLight
        position={[5, 9, 4]} intensity={2.7} color="#ffe4c2" castShadow
        shadow-mapSize={[1024, 1024]} shadow-bias={-0.0006}
        shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={6} shadow-camera-bottom={-3}
      />
      <ambientLight intensity={0.2} />
      <Haze colour={colours.fog} />
      <Meadow colour={meadow} />
      <Scenery reduced={reduced} />
      <group ref={turntable}>
        <Ground colour={colours.grass} />
        <group ref={tree} scale={scale.current}>
          <Trunk shape={shape} thickness={thickness} />
          <Canopy shape={shape} growth={growth} />
          <Apples shape={shape} growth={growth} apples={apples} reduced={reduced} onHover={onHover} />
        </group>
        <Petals shape={shape} growth={growth} scale={scale} reduced={reduced} />
      </group>
      <Fireflies count={fireflies} reduced={reduced} />
    </>
  );
}
