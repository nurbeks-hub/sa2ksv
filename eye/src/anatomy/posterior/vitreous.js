// Vitreous body: transparent gel shell (posterior cortex, vitreous base, anterior hyaloid with the
// patellar fossa for the lens), Cloquet's (hyaloid) canal from the disc to the back of the lens, and
// faint collagen fibril tracts. Additive, depthWrite off: it can never hide another part.
// All geometry is wound outward, so the gel can be drawn FrontSide from outside (BackSide from inside)
// and the pick proxy gives exactly one hit per ray from outside.
import * as THREE from 'three';
import { EYE, L, PALETTE } from '../../config.js';
import * as am from '../../lib/anatomyMath.js';
import { rng } from '../../lib/materials.js';
import { noiseTexture, GLSL_TNOISE } from './noiseTex.js';
import { dirPost } from './geometry.js';

const TAU = Math.PI * 2;

// Anterior boundary profile z(rho) of the vitreous (patellar fossa + anterior hyaloid), eye frame.
const LENS_BACK_C = L.lensPostZ + EYE.lensPostRadius; // centre of the posterior lens surface
const FOSSA_R = EYE.lensPostRadius + 0.08;           // Berger's space: a hair of clearance
export function vitreousProfile() {
  const Rv = L.retinaInnerR - 0.12;
  const pts = [];
  // posterior cortex: sphere from the posterior pole forward to the vitreous base (just anterior to the ora)
  const polEnd = Math.acos(7.05 / Rv);
  const nP = 56;
  for (let i = 0; i <= nP; i++) {
    const pol = Math.PI - (Math.PI - polEnd) * (i / nP);
    pts.push(new THREE.Vector2(Rv * Math.sin(pol), Rv * Math.cos(pol)));
  }
  // anterior hyaloid face: behind the ciliary processes and zonules, curving in to Wieger's ligament
  const start = pts[pts.length - 1];
  const fossaZ = r => LENS_BACK_C - Math.sqrt(FOSSA_R * FOSSA_R - r * r);
  const ctrl = [start, new THREE.Vector2(7.6, 7.22), new THREE.Vector2(6.6, 7.36), new THREE.Vector2(5.6, 7.42),
    new THREE.Vector2(4.8, 7.36), new THREE.Vector2(4.2, fossaZ(4.2))];
  const c = new THREE.SplineCurve(ctrl);
  const hy = c.getPoints(22);
  for (let i = 1; i < hy.length; i++) pts.push(hy[i]);
  // patellar fossa: concave seat matching the posterior lens surface
  const nF = 22;
  for (let i = 1; i <= nF; i++) {
    const r = 4.2 * (1 - i / nF);
    pts.push(new THREE.Vector2(r, fossaZ(r)));
  }
  return pts;
}

function lathe(profile, seg, typeVal, pos, typ, idx) {
  const base = pos.length / 3;
  for (const p of profile) {
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * TAU;
      pos.push(p.x * Math.cos(a), p.x * Math.sin(a), p.y);
      typ.push(typeVal);
    }
  }
  // the profile runs posterior pole -> anterior face (counter-clockwise in r,z), so (a, b, c) faces outward
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      const a = base + i * seg + j, b = base + i * seg + j1, c = base + (i + 1) * seg + j, d = base + (i + 1) * seg + j1;
      idx.push(a, b, c, b, d, c);
    }
  }
}

// Cloquet's canal centreline: from the area of Martegiani (disc) to the retrolental funnel. A straight
// channel with a gentle inferior sag (the canal hangs slightly in the upright eye), no lateral wiggle.
export function canalCurve() {
  const Rv = L.retinaInnerR - 0.12;
  const discDir = dirPost(am.DISC_MAP.length() / L.retinaInnerR, Math.atan2(am.DISC_MAP.y, am.DISC_MAP.x));
  const p0 = discDir.clone().multiplyScalar(Rv - 0.05);
  const p1 = new THREE.Vector3(0, 0, LENS_BACK_C - FOSSA_R - 0.04);
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const p = p0.clone().lerp(p1, t);
    p.y -= 1.1 * Math.sin(Math.PI * t) * (1 - 0.35 * t);
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

function canalTube(pos, typ, idx) {
  const curve = canalCurve();
  const NS = 72, NR = 20;
  const frames = curve.computeFrenetFrames(NS, false);
  const base = pos.length / 3;
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    const p = curve.getPointAt(t);
    // funnel at the disc (area of Martegiani), narrow waist, wide retrolental funnel
    const r = 0.55 + 0.4 * Math.exp(-Math.pow(t / 0.08, 2)) + 0.85 * Math.pow(Math.max(0, (t - 0.7) / 0.3), 2.0);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j < NR; j++) {
      const a = (j / NR) * TAU;
      pos.push(p.x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * r, p.y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * r, p.z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * r);
      typ.push(1 + t); // 1..2 along the canal
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) {
    const j1 = (j + 1) % NR;
    const a = base + i * NR + j, b = base + i * NR + j1, c = base + (i + 1) * NR + j, d = base + (i + 1) * NR + j1;
    idx.push(a, b, c, b, d, c); // outward: (b - a) x (c - a) = B x T = +N (away from the axis)
  }
}

const SHELL_VERT = /* glsl */`
  attribute float aType;
  varying vec3 vNw; varying vec3 vWorld; varying vec3 vLocal; varying float vType;
  void main() {
    vLocal = position; vType = aType;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz; vNw = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const SHELL_FRAG = /* glsl */`
  uniform float uGhost, uHighlight, uTime, uStrength, uFocus, uEncl;
  uniform vec3 uAccent, uKeyDir;
  uniform sampler2D uNoise;
  varying vec3 vNw; varying vec3 vWorld; varying vec3 vLocal; varying float vType;
  ${GLSL_TNOISE}
  void main() {
    vec3 N = normalize(vNw);
    vec3 V = normalize(cameraPosition - vWorld);
    // clamped: |N.V| can round a hair above 1, and pow() of a negative base is NaN (bloom spreads it)
    float gz = 1.0 - clamp(abs(dot(N, V)), 0.0, 1.0);
    float fres = pow(gz, 4.5);
    float fr5 = pow(gz, 9.0);
    vec2 dr = vec2(uTime * 0.02, -uTime * 0.013);
    float wisp = 0.65 * tn4(vLocal.xy * 0.55 + vLocal.z * 0.21 + dr).r + 0.35 * tn4(vLocal.zx * 1.2 + vLocal.y * 0.3 - dr + 5.0).g;
    vec3 col;
    if (vType < 0.5) {
      // gel surface: soft fresnel haze, denser cortex at the vitreous base (no glassy lip)
      float baseBand = smoothstep(4.0, 6.8, vLocal.z);
      float k = 0.0012 + 0.065 * fres * (0.45 + 0.9 * wisp) + 0.012 * fr5 + baseBand * 0.016 * (0.3 + fres);
      float fwd = pow(max(dot(-V, uKeyDir), 0.0), 3.0);        // forward scatter when looking into the light
      col = vec3(0.60, 0.70, 0.84) * k * (1.0 + 0.8 * fwd);
    } else {
      // Cloquet's canal: condensed wall of the hyaloid channel. Only its limb shows; faint unless the
      // vitreous is inspected, and it fades as the camera comes close so it never veils the disc.
      float t = vType - 1.0;
      float fc = pow(gz, 3.0);
      float k = 0.075 * fc * (0.35 + 1.1 * wisp) + 0.02 * fr5;
      k *= smoothstep(0.03, 0.22, t) * (1.0 - smoothstep(0.62, 0.97, t)) * (0.6 + 0.8 * tn4(vLocal.xy * 2.2 + vLocal.z * 0.7 + 3.0).b);
      k *= mix(0.25, 1.0, uFocus) * smoothstep(4.0, 14.0, distance(cameraPosition, vWorld));
      col = vec3(0.66, 0.78, 0.92) * k;
    }
    col *= uStrength * uEncl * (1.0 - 0.94 * uGhost);
    col += uAccent * uHighlight * (0.05 + 0.5 * fres);
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  }`;

const FIB_VERT = /* glsl */`
  attribute vec3 aTan; attribute float aOff; attribute float aU; attribute float aSeed; attribute float aWidth; attribute float aBun;
  uniform float uTime;
  varying float vU; varying float vOff; varying float vSeed; varying float vFace;
  void main() {
    vec3 p = position;
    float sw = sin(3.14159 * aU);
    // the whole tract sways together (slow gel motion), each fibril adds a little of its own
    p += vec3(sin(uTime * 0.31 + aBun * 6.28 + aU * 2.2), cos(uTime * 0.23 + aBun * 4.1 + aU * 1.7), sin(uTime * 0.19 + aBun * 2.3)) * 0.06 * sw;
    p += vec3(sin(uTime * 0.5 + aSeed * 9.0 + aU * 4.0), cos(uTime * 0.43 + aSeed * 7.0), 0.0) * 0.012 * sw;
    vec4 w = modelMatrix * vec4(p, 1.0);
    vec3 t = normalize(mat3(modelMatrix) * aTan);
    vec3 v = normalize(cameraPosition - w.xyz);
    vec3 s = cross(t, v);
    float sl = length(s);
    s = sl > 1e-4 ? s / sl : vec3(0.0, 1.0, 0.0);
    w.xyz += s * aOff * aWidth;
    vU = aU; vOff = aOff; vSeed = aSeed; vFace = sl;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const FIB_FRAG = /* glsl */`
  uniform float uGhost, uHighlight, uStrength, uEncl;
  uniform vec3 uAccent;
  uniform sampler2D uNoise;
  varying float vU; varying float vOff; varying float vSeed; varying float vFace;
  ${GLSL_TNOISE}
  void main() {
    float across = exp(-vOff * vOff * 3.5);
    float ends = smoothstep(0.0, 0.16, vU) * smoothstep(1.0, 0.72, vU);
    float bead = 0.4 + 0.8 * smoothstep(0.35, 0.8, tn4(vec2(vU * 22.0, vSeed * 91.0)).r);
    float k = across * ends * bead * (0.35 + 0.65 * vFace) * (0.55 + 0.9 * vSeed);
    vec3 col = vec3(0.70, 0.80, 0.95) * k * 0.017 * uStrength * uEncl * (1.0 - 0.94 * uGhost);
    col += uAccent * uHighlight * across * ends * 0.04;
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  }`;

// Collagen fibril tracts. Central vitreous: bundles of near-parallel fibrils that arise at the vitreous base
// and run antero-posteriorly, roughly parallel to Cloquet's canal, fanning out toward the posterior cortex
// (Eisner's tracts). Plus a thin preretinal tract of long fibrils just inside the posterior hyaloid.
function buildFibrils(seed) {
  const R = rng(seed);
  const Rv = L.retinaInnerR - 0.12;
  const fossaZ = r => LENS_BACK_C - Math.sqrt(FOSSA_R * FOSSA_R - Math.min(r, 4.2) ** 2);
  const anteriorZ = r => (r < 4.2 ? fossaZ(r) : r < 8.2 ? 7.3 - (r - 4.2) * 0.04 : 7.0);
  const clampInside = p => {
    const len = p.length();
    if (len > Rv - 0.35) p.multiplyScalar((Rv - 0.35) / len);
    const r = Math.hypot(p.x, p.y);
    const za = anteriorZ(r) - 0.25;
    if (p.z > za) p.z = za;
    return p;
  };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const strands = [];
  const NSEG = 36;
  const NB = 30;
  for (let b = 0; b < NB; b++) {
    const a = (b / NB) * TAU + R.range(-0.1, 0.1);
    const rs = R.range(5.0, 8.3);
    const S = V3(rs * Math.cos(a), rs * Math.sin(a), anteriorZ(rs) - 0.45);
    const re = rs * R.range(0.32, 0.72), ae = a + R.range(-0.22, 0.22);
    const E = V3(re * Math.cos(ae), re * Math.sin(ae) - R.range(0.3, 1.0), -R.range(4.5, 9.0));
    const C1 = S.clone().lerp(E, 0.35).add(V3(R.normal() * 0.35, R.normal() * 0.35 - 0.15, R.normal() * 0.2));
    const C2 = S.clone().lerp(E, 0.7).add(V3(R.normal() * 0.45, R.normal() * 0.45 - 0.35, R.normal() * 0.2));
    const centre = new THREE.CatmullRomCurve3([S, C1, C2, E], false, 'centripetal');
    const ax = E.clone().sub(S).normalize();
    const u1 = new THREE.Vector3().crossVectors(ax, Math.abs(ax.z) < 0.9 ? V3(0, 0, 1) : V3(0, 1, 0)).normalize();
    const u2 = new THREE.Vector3().crossVectors(ax, u1).normalize();
    const ns = 5 + Math.floor(R() * 5);
    const sp0 = R.range(0.08, 0.16), sp1 = R.range(0.55, 1.2);
    const bun = R();
    for (let k = 0; k < ns; k++) {
      const ox = R.normal(), oy = R.normal();
      const t0 = R.range(0, 0.12), t1 = R.range(0.7, 1.0);
      const ph = R() * TAU, amp = R.range(0.015, 0.05);
      const pts = [];
      for (let i = 0; i <= NSEG; i++) {
        const t = t0 + (t1 - t0) * (i / NSEG);
        const P = centre.getPoint(t);
        const sp = sp0 + (sp1 - sp0) * Math.pow(t, 1.4);
        P.addScaledVector(u1, ox * sp + amp * Math.sin(t * 9 + ph)).addScaledVector(u2, oy * sp + amp * Math.cos(t * 7 + ph));
        pts.push(clampInside(P));
      }
      strands.push({ pts, w: R.range(0.018, 0.034), bun, seed: R() });
    }
  }
  // preretinal tract: long fibrils in small groups sweeping back just inside the posterior hyaloid
  for (let g = 0; g < 7; g++) {
    const az = R() * TAU, twist = R.range(-0.35, 0.35), dep = R.range(0.5, 1.3);
    const p0 = R.range(0.95, 1.1), p1 = R.range(1.9, 2.4);
    const bun = R();
    const n = 2 + Math.floor(R() * 2);
    for (let k = 0; k < n; k++) {
      const dz = R.range(-0.06, 0.06), dd = R.range(-0.12, 0.12);
      const pts = [];
      for (let i = 0; i <= NSEG; i++) {
        const t = i / NSEG;
        const pol = p0 + (p1 - p0) * t;
        const azt = az + twist * t + dz;
        pts.push(clampInside(V3(Math.sin(pol) * Math.cos(azt), Math.sin(pol) * Math.sin(azt), Math.cos(pol)).multiplyScalar(Rv - dep - dd)));
      }
      strands.push({ pts, w: R.range(0.016, 0.028), bun, seed: R() });
    }
  }
  const pos = [], tan = [], off = [], uu = [], sd = [], wd = [], bn = [], idx = [];
  const tg = new THREE.Vector3();
  for (const c of strands) {
    const base = pos.length / 3;
    const n = c.pts.length;
    for (let i = 0; i < n; i++) {
      const p = c.pts[i];
      tg.copy(c.pts[Math.min(n - 1, i + 1)]).sub(c.pts[Math.max(0, i - 1)]).normalize();
      for (const o of [-1, 1]) {
        pos.push(p.x, p.y, p.z); tan.push(tg.x, tg.y, tg.z); off.push(o); uu.push(i / (n - 1)); sd.push(c.seed); wd.push(c.w); bn.push(c.bun);
      }
      if (i > 0) { const a = base + (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 3));
  g.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 1));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(uu, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(sd, 1));
  g.setAttribute('aWidth', new THREE.Float32BufferAttribute(wd, 1));
  g.setAttribute('aBun', new THREE.Float32BufferAttribute(bn, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.boundingSphere.radius += 0.3;
  return { geometry: g, count: strands.length };
}

export function buildVitreous(lights) {
  const profile = vitreousProfile();
  const pos = [], typ = [], idx = [];
  lathe(profile, 112, 0, pos, typ, idx);
  canalTube(pos, typ, idx);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aType', new THREE.Float32BufferAttribute(typ, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const accent = new THREE.Color(PALETTE.accent);
  const noise = noiseTexture();
  const shellMat = new THREE.ShaderMaterial({
    uniforms: {
      uGhost: { value: 0 }, uHighlight: { value: 0 }, uTime: { value: 0 }, uStrength: { value: 0.55 }, uFocus: { value: 0 }, uEncl: { value: 1 },
      uAccent: { value: accent }, uKeyDir: lights.uKeyDir, uNoise: { value: noise },
    },
    vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  });
  const shell = new THREE.Mesh(g, shellMat);
  shell.name = 'vitreous-gel';
  shell.renderOrder = 2;

  const fibMat = new THREE.ShaderMaterial({
    uniforms: {
      uGhost: { value: 0 }, uHighlight: { value: 0 }, uTime: { value: 0 }, uStrength: { value: 0.55 }, uEncl: { value: 1 },
      uAccent: { value: accent }, uNoise: { value: noise },
    },
    vertexShader: FIB_VERT, fragmentShader: FIB_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const fib = buildFibrils(77);
  const fibrils = new THREE.Mesh(fib.geometry, fibMat);
  fibrils.name = 'vitreous-fibrils';
  fibrils.renderOrder = 3;

  // Pick proxy: coarse gel envelope, FrontSide with outward normals, so a ray from outside gets exactly one
  // hit (the core picks the vitreous only when it is the sole hit, i.e. it never steals the fundus).
  const pp = [], pt = [], pi = [];
  const coarse = profile.filter((_, i) => i % 4 === 0);
  coarse.push(profile[profile.length - 1]);
  lathe(coarse, 40, 0, pp, pt, pi);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
  pg.setIndex(pi);
  pg.computeVertexNormals();
  pg.computeBoundingSphere();
  const proxy = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ visible: false, side: THREE.FrontSide }));
  proxy.name = 'vitreous-pick';

  // Camera inside the gel -> draw its inner (back) faces instead of the front ones.
  const Rv = L.retinaInnerR - 0.12;
  const fossaZ = r => LENS_BACK_C - Math.sqrt(FOSSA_R * FOSSA_R - Math.min(r, 4.2) ** 2);
  const camL = new THREE.Vector3();
  function updateSide(camera) {
    camL.setFromMatrixPosition(camera.matrixWorld);
    shell.worldToLocal(camL);
    const r = Math.hypot(camL.x, camL.y);
    const inside = camL.length() < Rv && camL.z < (r < 4.2 ? fossaZ(r) : 7.2);
    shellMat.side = inside ? THREE.BackSide : THREE.FrontSide;
  }
  return { shell, fibrils, proxy, materials: [shellMat, fibMat], shellMat, updateSide, fibrilCount: fib.count };
}
