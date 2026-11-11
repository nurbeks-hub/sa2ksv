// Small geometry toolkit for the vasculature module: spatial hash, sphere-surface walking,
// path bookkeeping (continuous flow distance), geometry merging, end caps, pick proxies and
// a guarded enhancement of the shared vessel shader.
import * as THREE from 'three';

export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

// ---------------------------------------------------------------- spatial hash (3D)
export class Grid3 {
  constructor(cell) { this.inv = 1 / cell; this.map = new Map(); }
  static key(ix, iy, iz) { return ((ix + 1024) * 2048 + (iy + 1024)) * 2048 + (iz + 1024); }
  add(id, x, y, z) {
    const k = Grid3.key(Math.floor(x * this.inv), Math.floor(y * this.inv), Math.floor(z * this.inv));
    let a = this.map.get(k); if (!a) { a = []; this.map.set(k, a); } a.push(id);
  }
  each(x, y, z, r, fn) {
    const inv = this.inv;
    const x0 = Math.floor((x - r) * inv), x1 = Math.floor((x + r) * inv);
    const y0 = Math.floor((y - r) * inv), y1 = Math.floor((y + r) * inv);
    const z0 = Math.floor((z - r) * inv), z1 = Math.floor((z + r) * inv);
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) for (let iz = z0; iz <= z1; iz++) {
      const a = this.map.get(Grid3.key(ix, iy, iz));
      if (a) for (let i = 0; i < a.length; i++) fn(a[i]);
    }
  }
}

// ---------------------------------------------------------------- tangent-plane helpers
export function tangentize(v, nUnit) { return v.addScaledVector(nUnit, -v.dot(nUnit)); }
// Signed angle from heading h to direction d around the surface normal n (all unit-ish).
export function signedAngle(h, d, n) {
  _a.crossVectors(h, d);
  return Math.atan2(_a.dot(n), h.dot(d));
}

// Walk over a sphere like a turtle. Positions are kept on the unit sphere; radius(u, pUnit) maps to mm.
// turn(u, pUnit, heading) returns a turning angle (rad) for this step. ds is the step (mm) at radius Rref.
export function sphereWalk({ start, heading, Rref, radius, ds, n, turn }) {
  const p = start.clone().normalize();
  const h = tangentize(heading.clone(), p).normalize();
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const r = typeof radius === 'function' ? radius(u, p) : radius;
    pts.push(p.clone().multiplyScalar(r));
    if (i === n) break;
    const a = turn ? turn(u, p, h) : 0;
    if (a) h.applyAxisAngle(p, a);
    p.addScaledVector(h, ds / Rref).normalize();
    tangentize(h, p).normalize();
  }
  return pts;
}

// Direction on the sphere surface at point p (unit) towards target t (any radius).
export function towards(p, t) {
  return tangentize(_b.copy(t).normalize().sub(p), p).normalize().clone();
}

// ---------------------------------------------------------------- polylines
export function polyLength(pts, i0 = 0, i1 = pts.length - 1) {
  let s = 0; for (let i = i0 + 1; i <= i1; i++) s += pts[i].distanceTo(pts[i - 1]); return s;
}
export function cumLengths(pts) {
  const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + pts[i].distanceTo(pts[i - 1])); return c;
}
// Arc-length-uniform Catmull-Rom through control points.
export function spline(ctrl, spacing = 0.1, type = 'centripetal') {
  if (ctrl.length < 2) return ctrl.map(p => p.clone());
  if (ctrl.length === 2) {
    const L = ctrl[0].distanceTo(ctrl[1]); const n = Math.max(1, Math.ceil(L / spacing));
    const out = []; for (let i = 0; i <= n; i++) out.push(new THREE.Vector3().lerpVectors(ctrl[0], ctrl[1], i / n)); return out;
  }
  const c = new THREE.CatmullRomCurve3(ctrl, false, type, 0.5);
  c.arcLengthDivisions = Math.max(200, ctrl.length * 12);
  const n = Math.max(2, Math.ceil(c.getLength() / spacing));
  return c.getSpacedPoints(n);
}
// Radii array sampled uniformly over arc length (what buildTubes expects).
export function radiiArray(fn, n = 24) { const a = []; for (let i = 0; i < n; i++) a.push(fn(i / (n - 1))); return a; }
export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

// Collects vessel paths and keeps the flow distance continuous from parent to child.
export class PathSet {
  constructor() { this.paths = []; }
  // points: Vector3[] (dense), radii: number | number[] (uniform over arc length), kind 0/1/2
  // parent/at: the child starts at parent.points[at]; its dist0 is the parent's distance there.
  // fadeFn(centre, s, base) -> per-vertex fade 0..1; shape(centre, r, s) -> radial flattening; noPick: leave out of the proxy
  add(points, radii, kind, { parent = null, at = 0, dist0 = null, cap0 = false, cap1 = false, tag = '', fadeFn = null, shape = null, noPick = false } = {}) {
    let d0 = dist0;
    if (d0 == null) d0 = parent ? parent.dist0 + polyLength(parent.points, 0, Math.min(at, parent.points.length - 1)) : 0;
    // scalar radius = constant calibre (buildTubes would otherwise taper a scalar radius by 35%)
    const p = { points, radii: Array.isArray(radii) ? radii : [radii, radii], kind, dist0: d0, cap0, cap1, tag, fadeFn, shape, noPick };
    this.paths.push(p);
    return p;
  }
  get length() { return this.paths.length; }
}
export function endDist(path) { return path.dist0 + polyLength(path.points); }
export function radiusAt(path, u) {
  const r = path.radii; if (!Array.isArray(r)) return r * (1 - 0.35 * u);
  const f = u * (r.length - 1), i = Math.floor(f), t = f - i;
  return i >= r.length - 1 ? r[r.length - 1] : r[i] * (1 - t) + r[i + 1] * t;
}
// index into path.points closest to arc fraction u
export function indexAt(path, u) { return Math.round(u * (path.points.length - 1)); }

// ---------------------------------------------------------------- geometry
// lib/vessels.buildTubes currently emits triangles wound towards the tube axis (face normal = -vertex normal),
// so with FrontSide the near half of every tube is culled and one sees the inside of the far half.
// Detect the winding from the geometry itself (robust if the shared builder is fixed later) and flip if needed.
export function fixWinding(g) {
  if (!g.index || g.index.count < 3) return g;
  const P = g.attributes.position.array, N = g.attributes.normal.array, I = g.index.array;
  let vote = 0;
  const step = Math.max(3, Math.floor(I.length / 3 / 64) * 3);
  for (let t = 0; t + 2 < I.length; t += step) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    vote += Math.sign(fx * (N[a] + N[b] + N[c]) + fy * (N[a + 1] + N[b + 1] + N[c + 1]) + fz * (N[a + 2] + N[b + 2] + N[c + 2]));
  }
  if (vote < 0) for (let t = 0; t + 2 < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; }
  g.index.needsUpdate = true;
  return g;
}

export function mergeGeometries(geoms) {
  geoms = geoms.filter(g => g && g.attributes.position && g.attributes.position.count > 0);
  let nv = 0, ni = 0;
  for (const g of geoms) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
  const dist = new Float32Array(nv), kind = new Float32Array(nv), rad = new Float32Array(nv);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let ov = 0, oi = 0;
  for (const g of geoms) {
    const a = g.attributes, c = a.position.count;
    pos.set(a.position.array, ov * 3); nor.set(a.normal.array, ov * 3);
    dist.set(a.aDist.array, ov); kind.set(a.aKind.array, ov); rad.set(a.aRadius.array, ov);
    const gi = g.index.array; for (let i = 0; i < gi.length; i++) idx[oi + i] = gi[i] + ov;
    ov += c; oi += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('aDist', new THREE.BufferAttribute(dist, 1));
  out.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  out.setAttribute('aRadius', new THREE.BufferAttribute(rad, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// Flat end caps for cut vessels. aRadius is written NEGATIVE (-(rho/r)) so the enhanced shader can draw
// the cut section (wall + lumen) instead of the tube skin.
export function capGeometry(paths, segs = 16) {
  const pos = [], nor = [], dist = [], kind = [], rad = [], idx = [];
  let base = 0;
  const up = new THREE.Vector3(0, 1, 0), t = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
  for (const p of paths) {
    for (const end of [0, 1]) {
      if (!(end ? p.cap1 : p.cap0)) continue;
      const pts = p.points; if (pts.length < 2) continue;
      const P = end ? pts[pts.length - 1] : pts[0];
      const Q = end ? pts[pts.length - 2] : pts[1];
      t.subVectors(P, Q).normalize(); // outward
      const r = radiusAt(p, end ? 1 : 0) * 1.0;
      n1.copy(Math.abs(t.dot(up)) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).cross(t).normalize();
      n2.crossVectors(t, n1).normalize();
      const d = end ? endDist(p) : p.dist0;
      // centre + two rings (so the lumen edge interpolates cleanly)
      pos.push(P.x, P.y, P.z); nor.push(t.x, t.y, t.z); dist.push(d); kind.push(p.kind); rad.push(-1e-4);
      for (let ring = 1; ring <= 2; ring++) {
        const rr = ring === 1 ? 0.5 : 1.0;
        for (let j = 0; j < segs; j++) {
          const a = (j / segs) * Math.PI * 2;
          const x = Math.cos(a) * r * rr, y = Math.sin(a) * r * rr;
          pos.push(P.x + n1.x * x + n2.x * y, P.y + n1.y * x + n2.y * y, P.z + n1.z * x + n2.z * y);
          nor.push(t.x, t.y, t.z); dist.push(d); kind.push(p.kind); rad.push(-rr);
        }
      }
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        const a0 = base + 1 + j, a1 = base + 1 + j1, b0 = base + 1 + segs + j, b1 = base + 1 + segs + j1;
        // CCW around +t (t always points out of the vessel), so the cap faces outwards at both ends
        idx.push(base, a0, a1, a0, b0, b1, a0, b1, a1);
      }
      base += 1 + segs * 2;
    }
  }
  const g = new THREE.BufferGeometry();
  if (!base) { g.setAttribute('position', new THREE.Float32BufferAttribute([], 3)); return g; }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setAttribute('aRadius', new THREE.Float32BufferAttribute(rad, 1));
  g.setIndex(new THREE.Uint16BufferAttribute(idx, 1));
  return g;
}

// Build a vessel mesh from paths split into calibre tiers (fine tessellation only where it shows).
// buildTubes is called with each path's INDEX as its kind, so every vertex can be traced back to its path;
// the real kind is then written back, optionally with a per-vertex fade (path.fadeFn(centre, s, base) -> 0..1)
// and a per-vertex cross-section flattening along the local sphere normal (path.shape(centre, r, s) -> k in (0,1]),
// which lets wide veins sit as oval lenses inside a thin coat instead of punching through it.
const _c = new THREE.Vector3(), _nr = new THREE.Vector3();
function postTubes(g, paths) {
  const P = g.attributes.position.array, N = g.attributes.normal.array, K = g.attributes.aKind.array;
  const Dd = g.attributes.aDist.array, Rr = g.attributes.aRadius.array;
  for (let v = 0, n = K.length; v < n; v++) {
    const p = paths[Math.round(K[v])];
    const kind = p.kind, cat = Math.floor(kind + 1e-6), base = (kind - cat) / 0.45;
    if (!p.fadeFn && !p.shape) { K[v] = kind; continue; }
    const o = v * 3, r = Rr[v];
    _c.set(P[o] - N[o] * r, P[o + 1] - N[o + 1] * r, P[o + 2] - N[o + 2] * r);
    const s = Dd[v] - p.dist0;
    let f = base;
    if (p.fadeFn) f = Math.min(1, Math.max(0, p.fadeFn(_c, s, base)));
    K[v] = cat + 0.45 * f;
    if (p.shape) {
      const k = Math.min(1, Math.max(0.05, p.shape(_c, r, s)));
      if (k < 0.999) {
        _nr.copy(_c).normalize();
        const a = N[o] * _nr.x + N[o + 1] * _nr.y + N[o + 2] * _nr.z;
        P[o] = _c.x + (N[o] - _nr.x * a * (1 - k)) * r;
        P[o + 1] = _c.y + (N[o + 1] - _nr.y * a * (1 - k)) * r;
        P[o + 2] = _c.z + (N[o + 2] - _nr.z * a * (1 - k)) * r;
        let nx = N[o] + _nr.x * a * (1 / k - 1), ny = N[o + 1] + _nr.y * a * (1 / k - 1), nz = N[o + 2] + _nr.z * a * (1 / k - 1);
        const l = Math.hypot(nx, ny, nz) || 1;
        N[o] = nx / l; N[o + 1] = ny / l; N[o + 2] = nz / l;
      }
    }
  }
  return g;
}
const maxRadius = p => (Array.isArray(p.radii) ? Math.max(...p.radii) : p.radii);
export function tubeGeometry(vessels, paths, tiers) {
  const geoms = [];
  for (const t of tiers) {
    const sel = [];
    paths.forEach((p, i) => { const r0 = maxRadius(p); if (r0 >= t.min && r0 < (t.max ?? Infinity)) sel.push({ points: p.points, radii: p.radii, kind: i, dist0: p.dist0 }); });
    if (sel.length) geoms.push(postTubes(fixWinding(vessels.buildTubes(sel, t.opts)), paths));
  }
  geoms.push(capGeometry(paths));
  return mergeGeometries(geoms);
}
export function tubeMesh(vessels, paths, material, tiers) {
  const mesh = new THREE.Mesh(tubeGeometry(vessels, paths, tiers), material);
  mesh.frustumCulled = true;
  return mesh;
}

// Invisible, coarse, fattened tubes used only for raycasting (the real meshes are far too dense to pick).
export const PROXY_MAT = new THREE.MeshBasicMaterial({ visible: false });
export function pickProxyGeometry(vessels, paths, { minR = 0, scale = 2.5, add = 0.12, maxR = 1.2 } = {}) {
  const sel = paths.filter(p => maxRadius(p) >= minR && !p.noPick).map(p => ({
    points: p.points, kind: p.kind, dist0: 0,
    radii: Array.isArray(p.radii) ? p.radii.map(r => Math.min(maxR, r * scale + add)) : Math.min(maxR, p.radii * scale + add),
  }));
  return fixWinding(vessels.buildTubes(sel, { radial: 4, minRadial: 3, lengthStep: 0.9 }));
}
export function pickProxy(vessels, paths, opts) {
  const m = new THREE.Mesh(pickProxyGeometry(vessels, paths, opts), PROXY_MAT);
  m.name = 'pick-proxy';
  return m;
}

// ---------------------------------------------------------------- shader enhancement
// Guarded patch of the shared vessel shader (only if its code matches what we expect; otherwise untouched):
//  vertex:   - capillaries (kind >= 1.5) collapse to nothing beyond a camera distance (they are an inspect-scale
//              detail: perifoveal net, palisades of Vogt), so they never alias into wireframe at hero distance
//            - vFacing: which hemisphere of the globe a fragment is on, seen from the camera (depth cue in glow mode)
//  fragment: - calibre tint, slow tone variation, optional adventitial mottling and darker blood core
//            - per-vessel / per-vertex fade towards the tissue it lies in (fract(aKind)), edge dissolve
//            - narrow soft arteriolar light reflex on the crest, spec and rim control
//            - cut sections for end caps (pale wall ring + dark clotted lumen, object-space grain)
//            - vessels mode: per-part glow gain, far-hemisphere attenuation, desaturated darker vein glow and a
//              hot arterial pulse core so the travelling pulses reach the bloom threshold.
export function enhanceVesselMaterial(mat, opts = {}) {
  const o = {
    thinTint: 0.5, reflex: 0.12, reflexPow: 30, pulseHeat: 0.6, thinGlow: 0.55, wallColor: 0xbf8a80, lumenColor: 0x3a080c,
    fade: 0.0, fadeColor: 0xd8b4ac, rim: 1.0, glowGain: 1.0, spec: 1.0, edge: 0.0, edgeColor: null,
    facingSign: 1, farGlow: 0.35, capNear: 1e5, capFar: 2e5, veinGlow: 0.62, fadeGlow: 0.35, mottle: 0.0, core: 0.0,
    ...opts,
  };
  const vs = mat.vertexShader, fs = mat.fragmentShader;
  const VA = 'vec4 mv = modelViewMatrix * vec4(position, 1.0);';
  const VD = 'varying vec3 vN; varying vec3 vV; varying float vDist; varying float vKind; varying float vRad;';
  const A = 'vec3 base = mix(mix(uArtery, uVein, isVein), uCap, isCap);';
  const B = 'vec3 col = base * diff + spec + base * fres * 0.6;';
  const C = 'col = mix(col, glowC * (0.55 + 1.6 * pulse) + glowC * fres * 0.9, uGlow);';
  const U = 'uniform float uTime, uGlow, uGhost, uHighlight, uOpacity, uPulse;';
  const G = 'float a = uOpacity * (1.0 - 0.96 * uGhost);';
  if (![A, B, C, U, VD].every(s => fs.includes(s)) || ![VA, VD].every(s => vs.includes(s))) return mat;
  const u = mat.uniforms;
  u.uThinTint = { value: o.thinTint }; u.uReflex = { value: o.reflex }; u.uReflexPow = { value: o.reflexPow };
  u.uPulseHeat = { value: o.pulseHeat }; u.uThinGlow = { value: o.thinGlow };
  u.uWall = { value: new THREE.Color(o.wallColor) }; u.uLumen = { value: new THREE.Color(o.lumenColor) };
  u.uFade = { value: o.fade }; u.uFadeCol = { value: new THREE.Color(o.fadeColor) };
  u.uRim = { value: o.rim }; u.uGlowGain = { value: o.glowGain }; u.uSpec = { value: o.spec };
  u.uEdge = { value: o.edge }; u.uEdgeCol = { value: new THREE.Color(o.edgeColor ?? o.fadeColor) };
  u.uFacingSign = { value: o.facingSign }; u.uFarGlow = { value: o.farGlow };
  u.uCapNear = { value: o.capNear }; u.uCapFar = { value: o.capFar };
  u.uVeinGlowK = { value: o.veinGlow }; u.uFadeGlow = { value: o.fadeGlow }; u.uMottle = { value: o.mottle }; u.uCore = { value: o.core };
  const VAR = '\n      varying float vFacing; varying vec3 vLocal; varying vec3 vGN;';
  mat.vertexShader = vs
    .replace(VD, VD + VAR + '\n      uniform float uCapNear, uCapFar;')
    .replace(VA, `vec3 pos = position;
        vec4 wp0 = modelMatrix * vec4(position, 1.0);
        float capK = step(1.5, aKind) * step(0.0, aRadius);
        float vis = 1.0 - capK * smoothstep(uCapNear, uCapFar, distance(cameraPosition, wp0.xyz));
        pos -= normal * aRadius * (1.0 - vis);
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vec3 wc = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vFacing = dot(normalize(wp0.xyz - wc), normalize(cameraPosition - wc));
        vLocal = position;
        vGN = normalize(normalMatrix * normalize(position));`);
  let f = fs
    .replace(VD, VD + VAR)
    .replace(U, U + `
      uniform float uThinTint, uReflex, uReflexPow, uPulseHeat, uThinGlow, uFade, uRim, uGlowGain, uSpec, uEdge;
      uniform float uFacingSign, uFarGlow, uVeinGlowK, uFadeGlow, uMottle, uCore;
      uniform vec3 uWall, uLumen, uFadeCol, uEdgeCol;
      float vhash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float vnoise(vec3 x) {
        vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(vhash(i), vhash(i + vec3(1,0,0)), f.x), mix(vhash(i + vec3(0,1,0)), vhash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(vhash(i + vec3(0,0,1)), vhash(i + vec3(1,0,1)), f.x), mix(vhash(i + vec3(0,1,1)), vhash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }`)
    .replace(A, A + `
        float rr = abs(vRad);
        float thin = 1.0 - smoothstep(0.012, 0.07, rr);
        base = mix(base, base * 1.45 + vec3(0.05, 0.006, 0.012), thin * uThinTint);
        base *= mix(1.0, 0.82, smoothstep(0.12, 0.5, rr));
        float tv = 0.5 + 0.5 * sin(vDist * 0.83 + vKind * 2.1) * sin(vDist * 0.29 + 1.3);
        base *= 0.86 + 0.28 * tv;
        if (uMottle > 0.0) base *= 1.0 - uMottle * (vnoise(vLocal * 2.3) * 0.7 + vnoise(vLocal * 7.1) * 0.3 - 0.5);
        // per-vessel depth / translucency, encoded in the fractional part of aKind (0..0.45)
        float fadeK = clamp(fract(vKind) / 0.45, 0.0, 1.0);
        base = mix(base, uFadeCol, fadeK * uFade);`)
    .replace(B, B + `
        col -= base * fres * 0.6 * (1.0 - uRim);
        col -= vec3(spec * (1.0 - uSpec));
        float ndv = max(dot(n, normalize(vV)), 0.0);
        float isArt = (1.0 - isVein) * (1.0 - isCap);
        col *= 1.0 - uCore * pow(ndv, 2.0);
        col += isArt * uReflex * vec3(1.0, 0.92, 0.84) * pow(ndv, uReflexPow) * (0.55 + 0.45 * diff);
        // the tissue the vessel lies in, lit by the GLOBE surface normal (so dissolves match the sclera / fundus shading)
        vec3 gN = normalize(vGN) * uFacingSign;
        float diffS = max(dot(gN, keyV), 0.0) * 0.75 + 0.25;
        float graze = mix(0.7, 1.0, smoothstep(0.0, 0.6, abs(dot(gN, normalize(vV)))));
        col = mix(col, uFadeCol * diffS * graze, fadeK * uFade * 0.45);
        float edgeK = clamp(pow(1.0 - ndv, 1.6) * uEdge * (0.6 + 0.4 * thin + 0.5 * fadeK), 0.0, 1.0);
        col = mix(col, uEdgeCol * diffS * graze, edgeK);
        if (vRad < 0.0) {
          float rho = -vRad;
          float lumenR = mix(0.7, 0.86, isVein);
          float wall = smoothstep(lumenR - 0.06, lumenR + 0.04, rho);
          float grain = vnoise(vLocal * 60.0) * 0.6 + vnoise(vLocal * 160.0) * 0.4;
          vec3 cut = mix(uLumen * (0.75 + 0.5 * grain), uWall * (0.75 + 0.25 * diff) * (0.92 + 0.16 * grain), wall);
          col = mix(cut, cut * 0.8, smoothstep(0.92, 1.0, rho));
        }`)
    .replace(C, `
        float gThin = mix(uThinGlow, 1.0, smoothstep(0.012, 0.06, abs(vRad))) * (1.0 - uFadeGlow * fadeK * max(uFade, 0.5));
        float face = mix(uFarGlow, 1.0, smoothstep(-0.35, 0.3, vFacing * uFacingSign));
        vec3 gc = mix(glowC, vec3(dot(glowC, vec3(0.3, 0.55, 0.15))), 0.35 * isVein) * mix(1.0, uVeinGlowK, isVein);
        vec3 glowCol = (gc * (0.5 + 1.6 * pulse) + gc * fres * 0.6) * gThin
                     + vec3(1.0, 0.78, 0.84) * pulse * pulse * uPulseHeat * gThin * (1.0 - 0.75 * isVein);
        col = mix(col, glowCol * uGlowGain * face, uGlow);`);
  if (f.includes(G)) f = f.replace(G, 'float a = uOpacity * (1.0 - 0.94 * uGhost);');
  mat.fragmentShader = f;
  mat.needsUpdate = true;
  return mat;
}

// A tiny deterministic 1D smooth noise (sum of incommensurate sines) — enough for meander.
export function meander(seed) {
  const r = mulberry(seed);
  const f = [r() * 0.6 + 0.35, r() * 1.1 + 0.9, r() * 2.3 + 2.1], ph = [r() * 6.28, r() * 6.28, r() * 6.28];
  return x => 0.55 * Math.sin(x * f[0] + ph[0]) + 0.3 * Math.sin(x * f[1] + ph[1]) + 0.15 * Math.sin(x * f[2] + ph[2]);
}
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
