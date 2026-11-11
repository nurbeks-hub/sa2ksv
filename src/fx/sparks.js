// Light-particle transitions ("built from light"): every structural change in the atlas happens through lime
// (#D1FE17) particles, matching the opening film (src/hero). One GPU point cloud, sampled once over every
// renderable surface (area-weighted, with a minimum per structure so small organs can still be rebuilt), is
// driven entirely by the SAME state the surface shaders read (core/shader.js) — no per-particle simulation:
//   · dissolve (layer peel, system toggle, inspect / deep-dive isolation): a particle's age is how far the
//     dissolve front has passed its spot, age = (front − field) / H_DW. Going out, particles leave the seam and
//     drift up and outward, lime in flight; coming back, the same path runs in reverse and they land on the
//     surface in its own colour just as it re-forms;
//   · glass hand-off (solid → ghost) the same way, fainter;
//   · ♂/♀ textured skins: the wipe front is a band of particles — one skin breaks up behind it, the other
//     converges ahead of it; the anatomy (when peeled) gets a lime scan band while it morphs;
//   · the layer under a peeling one sparkles where it has just been uncovered (it is being "constructed");
//   · section plane: the removed tissue next to the moving plane disintegrates (or re-forms on the way out).
// Cost: nothing is drawn while no transition runs; during one, a vertex shader decides each particle
// (invisible ones are culled before the sex-field loop) and only the live band reaches the fragment stage.
import * as THREE from 'three';
import { U, NOISE, VERT_HEAD, TEXW, LIME_LINEAR } from '../core/shader.js';

const VERT = /* glsl */`
${VERT_HEAD}
${NOISE}
attribute vec3 aNrm;
attribute float aSeed;
uniform float uTime, uSize, uViewH, uMotion, uSkinMix, uSecFx, uCalm;
uniform float uCover[8];
uniform float uGrpOn[8];   // group is drawn at all at this depth (buried layers stay dark: no light from inside)
uniform vec4 uSecPlane;
uniform vec4 uBust;
varying vec3 vCol;
varying float vA;
varying float vHot;
float hEaseOut(float t) { return 1.0 - (1.0 - t) * (1.0 - t); }
void main() {
  int hSid = int(aSid + 0.5);
  ivec2 hSt = ivec2(hSid % ${TEXW}, hSid / ${TEXW});
  vec4 hS = texelFetch(uState, hSt, 0);
  vec4 hT0 = texelFetch(uStatic, ivec2(hSt.x, hSt.y * 2), 0);
  float hLd = uLayerDis[int(hT0.a + 0.5)];
  float z = mix(max(hLd, hS.b), hS.b, hS.a);      // total dissolve (as in the surface shader)
  float gh = hS.r;                                  // glass (ghost) amount
  int grp = int(hT0.a + 0.5);
  float skinV = abs(aSid - uSkinSidM) < 0.5 ? 1.0 : abs(aSid - uSkinSidF) < 0.5 ? 2.0 : 0.0;
  float r1 = fract(aSeed * 17.31), r2 = fract(aSeed * 71.97), r3 = fract(aSeed * 3.917);

  if (uGrpOn[grp] < 0.5 && hS.a < 0.001) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; vCol = vec3(0.0); vHot = 0.0; return; }
  float n = hDisField(position);
  float Fz = hDisF(z);
  bool solid = n >= Fz;                             // the surface is present here
  // ♂/♀ wipe (same field as the textured skins' fragment shader)
  float hW = clamp((1.768 - position.y) / 0.34, 0.0, 1.0) * 0.84 + 0.16 * hNoise(position * 60.0);
  float hDw = hW - (uSkinMix * 1.2 - 0.1);
  bool sexMoving = uSkinMix > 0.0005 && uSkinMix < 0.9995;
  bool variantShown = skinV < 0.5 || ((skinV < 1.5) != (hDw < 0.0));

  // --- pick the channel that owns this particle this frame
  int kind = 0;           // 1 flight (dissolve / glass / sex / section), 2 sparkle on the surface
  float age = 2.0, w = 1.0;
  vec3 away = vec3(0.0);  // extra flight direction (section: toward the removed side)
  float dS = dot(uSecPlane.xyz, position) + uSecPlane.w;
  if (dS < 0.0) {
    // removed by the section: only the band next to the moving plane is alive
    float a = -dS / 0.018;
    if (uSecFx > 0.003 && solid && variantShown && gh < 0.5 && a < 1.0 && r2 < 0.55) { kind = 1; age = a; w = uSecFx * 0.3; away = -uSecPlane.xyz; }
  } else {
    float a1 = (Fz - n) / H_DW;
    if (a1 > 0.0 && a1 < 1.0 && variantShown) { kind = 1; age = a1; }
    else if (skinV > 0.5 && solid && sexMoving) {
      float a3 = (skinV < 1.5 ? -hDw : hDw) / 0.1;
      if (a3 > 0.0 && a3 < 1.0) { kind = 1; age = a3; w = 0.9; }
    }
    if (kind == 0 && solid && gh > 0.0 && gh < 1.0) {
      float a2 = (hDisF(gh) - n) / H_DW;
      if (a2 > 0.0 && a2 < 1.0) { kind = 1; age = a2; w = 0.45; }
    }
    if (kind == 0 && solid && gh < 0.5 && skinV < 0.5) {
      float cv = uCover[grp];
      if (cv > 0.0 && cv < 1.0 && r2 < 0.55) {
        float a5 = (hDisF(cv) - n) / 0.24;
        if (a5 > 0.0 && a5 < 1.0) { kind = 2; age = a5; w = 0.75; }
      }
      if (kind == 0 && sexMoving && r2 < 0.4) {
        float a4 = abs(hDw) / 0.05;
        if (a4 < 1.0) { kind = 2; age = a4; w = 0.5; }
      }
    }
  }
  // a section is open: the cut face is the information — keep light effects faint and sparse there
  if (uCalm > 0.5) { if (kind == 2) kind = 0; else w *= 0.35; if (fract(aSeed * 7.13) > 0.45) kind = 0; } else w *= 0.8;
  // museum bust cut below the neck
  { float ax = abs(position.x); float yb = uBust.x + max(0.0, ax - uBust.y) * uBust.z + max(0.0, position.z + 0.005) * uBust.w; if (position.y < yb) kind = 0; }
  if (kind == 0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; vCol = vec3(0.0); vHot = 0.0; return; }

  // --- place it (sex morph field + deep-dive rigid offsets, as the surfaces)
  vec4 hT1 = texelFetch(uStatic, ivec2(hSt.x, hSt.y * 2 + 1), 0);
  vec3 p = position, nrm = aNrm;
  if (uSex > 0.0001 && hT1.w > -0.5 && (uSFCount > 0 || uSFA[0][0] != 0.0 || uSFA[1][1] != 0.0 || uSFA[2][2] != 0.0 || dot(uSFT, uSFT) > 0.0)) {
    vec3 hD; mat3 hJ; hField(position, hD, hJ); p += uSex * hD;
  }
  vec4 hOT = texelFetch(uOffset, ivec2(hSt.x, hSt.y * 3), 0);
  if (hOT.w > 0.5) {
    vec4 hOQ = texelFetch(uOffset, ivec2(hSt.x, hSt.y * 3 + 1), 0);
    vec4 hOP = texelFetch(uOffset, ivec2(hSt.x, hSt.y * 3 + 2), 0);
    p = hOP.xyz + hQrot(hOQ, p - hOP.xyz) + hOT.xyz; nrm = hQrot(hOQ, nrm);
  }
  p += nrm * 0.0004;   // just off its own surface (no z-fighting when it lands)
  float hot;
  if (kind == 1) {
    // flight: lift off the surface fast, then drift up and swirl round the head's axis (reversed = assembly)
    float e = hEaseOut(age), m = uMotion;
    vec3 dir = normalize(nrm + vec3(0.0, 0.35, 0.0));
    p += dir * (0.003 + 0.02 * r1) * e * m;
    p += away * (0.012 + 0.04 * r2) * e * m;
    p.y += (0.006 + 0.03 * r2) * age * age * m;
    float ang = age * age * (0.35 + 0.5 * r3) * m * (r1 > 0.5 ? 1.0 : -1.0);
    vec2 q = p.xz - vec2(0.0, -0.005); float cs = cos(ang), sn = sin(ang);
    p.xz = vec2(0.0, -0.005) + vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
    p += (vec3(hNoise(p * 90.0 + uTime * 0.7), hNoise(p * 90.0 + 17.0 + uTime * 0.7), hNoise(p * 90.0 + 41.0 - uTime * 0.7)) - 0.5) * 0.008 * age * m;
    vA = w * smoothstep(0.0, 0.035, age) * (1.0 - smoothstep(0.45, 1.0, age));
    hot = smoothstep(0.0, 0.22, age);   // own colour at the seam, lime once airborne
  } else {
    // sparkle: light grains sitting on the freshly built surface, flaring then settling into it
    p += nrm * 0.0012 * (1.0 - age) * uMotion;
    vA = w * (1.0 - smoothstep(0.15, 1.0, age)) * smoothstep(0.0, 0.06, age) * (0.4 + 0.6 * step(0.5, fract(aSeed * 5.3 + uTime * 1.7)));
    hot = 1.0;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float big = step(0.9, r3);
  float sz = uSize * (1.0 + 1.3 * big) * (kind == 1 ? (1.0 + 0.5 * sin(3.14159 * age)) : 0.8);
  gl_PointSize = clamp(sz * projectionMatrix[1][1] * 0.5 * uViewH / max(0.02, -mv.z), 1.0, 7.0);
  vec3 tint = skinV > 0.5 ? vec3(0.62, 0.4, 0.3) : hT0.rgb;
  vec3 lime = ${LIME_LINEAR};
  vCol = mix(tint * 0.9, lime * (1.35 + 1.1 * big), hot);
  vHot = hot;
  // fade sub-pixel points by their coverage instead of flickering
  vA *= clamp(sz * projectionMatrix[1][1] * 0.5 * uViewH / max(0.02, -mv.z), 0.25, 1.0);
}
`;

const FRAG = /* glsl */`
varying vec3 vCol;
varying float vA;
varying float vHot;
void main() {
  vec2 q = gl_PointCoord - 0.5; float r = dot(q, q) * 4.0;
  if (r > 1.0 || vA < 0.004) discard;
  float core = exp(-r * 4.5);
  gl_FragColor = vec4(vCol * (0.6 + 0.8 * core), vA * core);
}
`;

// ---------------------------------------------------------------- sampling
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const SKIP = new Set(['cornea', 'hair', 'hairFine', 'csf', 'vitreous']);
// share of the budget per unit area, by depth group: the layers a visitor watches peel (skin, muscles, bones)
// get dense light; folded or buried surfaces (cortex, viscera, eyes) proportionally less
const GROUP_WEIGHT = [3.2, 1.7, 2.6, 5.0, 1.4, 0.5, 0.7, 0.5];
const tick = () => new Promise(r => setTimeout(r, 0));

// ranges of consecutive triangles that belong to one structure (merged meshes append parts contiguously)
function triRanges(geo) {
  const I = geo.index ? geo.index.array : null, S = geo.attributes.aSid.array;
  const T = (I ? I.length : geo.attributes.position.count) / 3, out = [];
  let cur = -1, t0 = 0;
  for (let t = 0; t < T; t++) { const s = S[I ? I[t * 3] : t * 3]; if (s !== cur) { if (cur >= 0) out.push([cur, t0, t]); cur = s; t0 = t; } }
  if (cur >= 0) out.push([cur, t0, T]);
  return out;
}
function triAreas(geo, cdf) {
  const P = geo.attributes.position.array, I = geo.index ? geo.index.array : null, T = cdf.length - 1;
  let acc = 0; cdf[0] = 0;
  for (let t = 0; t < T; t++) {
    const a = (I ? I[t * 3] : t * 3) * 3, b = (I ? I[t * 3 + 1] : t * 3 + 1) * 3, c = (I ? I[t * 3 + 2] : t * 3 + 2) * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    acc += Math.sqrt(x * x + y * y + z * z) * 0.5; cdf[t + 1] = acc;
  }
  return acc;
}

export async function createSparks({ M, renderables, parent, renderer, camera, scene, count = 160000, minPer = 40, reducedMotion = false }) {
  const rnd = mulberry(20260928);
  // pass 1: surface area per structure
  const items = [];
  const areaBySid = new Float64Array(M.nodes.length);
  for (const r of renderables) {
    if (SKIP.has(r.cls)) continue;
    const geo = r.mesh.geometry; if (!geo.attributes.aSid) continue;
    const T = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    const cdf = new Float64Array(T + 1); triAreas(geo, cdf);
    const ranges = triRanges(geo).filter(([sid]) => !M.nodes[sid].hidden);
    for (const [sid, a, b] of ranges) areaBySid[sid] += cdf[b] - cdf[a];
    items.push({ geo, ranges, T });
    await tick();
  }
  const wArea = (s) => areaBySid[s] * (GROUP_WEIGHT[M.nodes[s].group] ?? 1);
  let total = 0; for (let s = 0; s < areaBySid.length; s++) total += wArea(s);
  const alloc = new Int32Array(M.nodes.length);
  let want = 0; const byGroup = new Array(8).fill(0);
  for (let s = 0; s < alloc.length; s++) if (areaBySid[s] > 0) { alloc[s] = Math.max(minPer, Math.round(count * 0.8 * wArea(s) / total)); want += alloc[s]; byGroup[M.nodes[s].group] += alloc[s]; }
  const N = want;
  const pos = new Float32Array(N * 3), nrm = new Int8Array(N * 3), sidA = new Float32Array(N), seed = new Float32Array(N);
  let o = 0;
  const sidLeft = Int32Array.from(alloc);
  // pass 2: sample each structure's triangles by area
  for (const it of items) {
    const { geo, ranges, T } = it;
    const P = geo.attributes.position.array, Nn = geo.attributes.normal.array, I = geo.index ? geo.index.array : null;
    const cdf = new Float64Array(T + 1); triAreas(geo, cdf);
    for (const [sid, t0, t1] of ranges) {
      const A0 = cdf[t0], A1 = cdf[t1];
      if (A1 <= A0) continue;
      // one structure may be split over several ranges: share its allocation by area
      const k = Math.min(sidLeft[sid], Math.round(alloc[sid] * (A1 - A0) / areaBySid[sid] + rnd() * 0.999));
      sidLeft[sid] -= k;
      for (let j = 0; j < k && o < N; j++) {
        const u = A0 + rnd() * (A1 - A0);
        let lo = t0, hi = t1 - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid + 1] < u) lo = mid + 1; else hi = mid; }
        const t = lo;
        const ia = I ? I[t * 3] : t * 3, ib = I ? I[t * 3 + 1] : t * 3 + 1, ic = I ? I[t * 3 + 2] : t * 3 + 2;
        let b1 = rnd(), b2 = rnd(); if (b1 + b2 > 1) { b1 = 1 - b1; b2 = 1 - b2; } const b0 = 1 - b1 - b2;
        for (let c = 0; c < 3; c++) pos[o * 3 + c] = P[ia * 3 + c] * b0 + P[ib * 3 + c] * b1 + P[ic * 3 + c] * b2;
        let nx = Nn[ia * 3] * b0 + Nn[ib * 3] * b1 + Nn[ic * 3] * b2, ny = Nn[ia * 3 + 1] * b0 + Nn[ib * 3 + 1] * b1 + Nn[ic * 3 + 1] * b2, nz = Nn[ia * 3 + 2] * b0 + Nn[ib * 3 + 2] * b1 + Nn[ic * 3 + 2] * b2;
        const l = Math.hypot(nx, ny, nz) || 1; nrm[o * 3] = Math.round(nx / l * 127); nrm[o * 3 + 1] = Math.round(ny / l * 127); nrm[o * 3 + 2] = Math.round(nz / l * 127);
        sidA[o] = sid; seed[o] = rnd();
        o++;
      }
    }
    await tick();
  }
  const n = o;
  // shuffle so any prefix (draw range) is a uniform subset: phones / low resolution draw fewer
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    for (let c = 0; c < 3; c++) { let t = pos[i * 3 + c]; pos[i * 3 + c] = pos[j * 3 + c]; pos[j * 3 + c] = t; t = nrm[i * 3 + c]; nrm[i * 3 + c] = nrm[j * 3 + c]; nrm[j * 3 + c] = t; }
    let t = sidA[i]; sidA[i] = sidA[j]; sidA[j] = t; t = seed[i]; seed[i] = seed[j]; seed[j] = t;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, n * 3), 3));
  geo.setAttribute('aNrm', new THREE.BufferAttribute(nrm.subarray(0, n * 3), 3, true));
  geo.setAttribute('aSid', new THREE.BufferAttribute(sidA.subarray(0, n), 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed.subarray(0, n), 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.58, 0), 0.4);

  const own = { uSize: { value: 0.00055 }, uViewH: { value: 1080 }, uMotion: { value: reducedMotion ? 0.15 : 1 }, uGrpOn: { value: new Float32Array(8).fill(1) }, uCalm: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, ...own },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  mat.name = 'sparks';
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.renderOrder = 50; points.visible = false; points.name = 'sparks';
  parent.add(points);
  try { if (renderer && renderer.compileAsync) await renderer.compileAsync(points, camera, scene); } catch (e) { /* compiled on first use */ }

  let tail = 0;
  const _v = new THREE.Vector2();
  return {
    points, count: n, byGroup,
    // active: a transition is running this frame; fraction: share of the particles to draw (resolution budget)
    // groupOn(g): whether depth group g is drawn at all right now
    update(active, fraction = 1, groupOn = null, calm = false) {
      own.uCalm.value = calm ? 1 : 0;
      tail = active ? 3 : Math.max(0, tail - 1);
      points.visible = tail > 0;
      if (!points.visible) return;
      renderer.getDrawingBufferSize(_v); own.uViewH.value = _v.y;
      if (groupOn) for (let g = 0; g < 8; g++) own.uGrpOn.value[g] = groupOn(g) ? 1 : 0;
      geo.setDrawRange(0, Math.max(1, Math.floor(n * Math.min(1, fraction))));
    },
  };
}
