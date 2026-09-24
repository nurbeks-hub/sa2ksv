// Strand hair for АДАМ БАСЫ — self-contained module (three.js 0.186, WebGL2).
//
//   import { createHair } from './fx/hair.js';
//   const hair = await createHair(renderer, scene, { parent: rig, base: 'assets/' });
//   hair.setSex(sexEased); hair.setOpacity(1); hair.setVisible(true); hair.update(dt, camera) // every frame
//
// Data: assets/hair_male.bin, hair_female.bin, hair_brows.bin (built by tools/hair_gen.py). Each file = one strand set
// grown on its native head shape (male on the base Skin, female on the 'female' morph). Every strand point follows
// the skin morph: p = P + a·(F(P) + D_i), F = smooth delta field (3D texture), D_i = exact root delta − F(root).
// Rendering: instanced camera-facing ribbons (one instance per strand), control points Catmull-Rom-upsampled on the
// CPU into an RGBA32F texture, alpha-to-coverage (needs an MSAA target; stage.js renders into a 4× MSAA HDR target),
// sub-pixel strands widened to ≥ 1 px with coverage = true width / drawn width. Shading: Kajiya-Kay diffuse blended
// with a volume normal, two shifted specular lobes (R white toward the root, TRT tinted), transmission for rim/back
// light, per-point depth-in-volume occlusion and root darkening. A dark scalp cap under each set hides skin gaps.
import * as THREE from 'three';

const HEAD_MAGIC = 0x52494148; // 'HAIR'

function half2float(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}

async function loadSet(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== HEAD_MAGIC) throw new Error('hair: bad file ' + url);
  const hlen = dv.getUint32(4, true);
  const H = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hlen)));
  const base = 8 + hlen + ((4 - (hlen % 4)) % 4);
  const sec = (name, Type) => { const [o, n] = H.sections[name]; return new Type(buf, base + o, n / Type.BYTES_PER_ELEMENT); };
  return { H, sec };
}

// Catmull-Rom ×2 upsampling of fixed-length strands (P control points → 2P−1 render points)
function upsample(P, N, pos, box, ao) {
  const R = 2 * P - 1;
  const out = new Float32Array(N * R * 4);
  const c = box.c, e = box.e, k = 1 / 32767;
  const q = new Float32Array(P * 3);
  for (let s = 0; s < N; s++) {
    const b = s * P * 3;
    for (let i = 0; i < P * 3; i++) q[i] = c[i % 3] + pos[b + i] * k * e[i % 3];
    const o = s * R * 4;
    for (let i = 0; i < P; i++) {
      const j = o + 2 * i * 4;
      out[j] = q[i * 3]; out[j + 1] = q[i * 3 + 1]; out[j + 2] = q[i * 3 + 2]; out[j + 3] = ao[s * P + i] / 255;
      if (i < P - 1) {
        const i0 = Math.max(i - 1, 0), i3 = Math.min(i + 2, P - 1), m = j + 4;
        for (let a = 0; a < 3; a++) {
          const p0 = i === 0 ? 2 * q[a] - q[3 + a] : q[i0 * 3 + a];
          const p3 = i + 2 > P - 1 ? 2 * q[(P - 1) * 3 + a] - q[(P - 2) * 3 + a] : q[i3 * 3 + a];
          out[m + a] = (-p0 + 9 * q[i * 3 + a] + 9 * q[(i + 1) * 3 + a] - p3) / 16;
        }
        out[m + 3] = (ao[s * P + i] + ao[s * P + i + 1]) / 510;
      }
    }
  }
  return { R, data: out };
}

function makeField(H, sec, name) {
  const g = H.grid; const [nx, ny, nz] = g.dims;
  const raw = sec(name, Uint16Array);                       // RGBA half floats
  const tex = new THREE.Data3DTexture(raw, nx, ny, nz);
  tex.format = THREE.RGBAFormat; tex.type = THREE.HalfFloatType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1; tex.needsUpdate = true;
  return { tex, raw, dims: g.dims, lo: g.lo, hi: g.hi };
}

function sampleField(f, p) {  // CPU trilinear sample of the RGB of a half-float field
  const [nx, ny, nz] = f.dims; const r = [0, 0, 0];
  const u = [0, 1, 2].map(a => Math.min(Math.max((p[a] - f.lo[a]) / (f.hi[a] - f.lo[a]), 0), 1));
  // grid nodes at lo + i·(hi−lo)/(n−1) (the shader maps them onto texel centres)
  const x = u[0] * (nx - 1), y = u[1] * (ny - 1), z = u[2] * (nz - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const xi = Math.min(Math.max(x0 + dx, 0), nx - 1), yi = Math.min(Math.max(y0 + dy, 0), ny - 1), zi = Math.min(Math.max(z0 + dz, 0), nz - 1);
    const w = (dx ? x - x0 : 1 - (x - x0)) * (dy ? y - y0 : 1 - (y - y0)) * (dz ? z - z0 : 1 - (z - z0));
    const o = ((zi * ny + yi) * nx + xi) * 4;
    for (let a = 0; a < 3; a++) r[a] += w * half2float(f.raw[o + a]);
  }
  return r;
}

const MAX_L = 4;
const COMMON = /* glsl */`
  uniform vec3 uLDir[${MAX_L}]; uniform vec3 uLCol[${MAX_L}]; uniform int uNL;
  uniform vec3 uSky; uniform vec3 uGround;
`;

const STRAND_VS = /* glsl */`
  precision highp float; precision highp int; precision highp sampler2D; precision highp sampler3D;
  #include <common>
  #include <clipping_planes_pars_vertex>
  uniform sampler2D uPts; uniform int uTexW; uniform int uR;
  uniform sampler3D uField; uniform sampler3D uNorm; uniform vec3 uGLo; uniform vec3 uGHi; uniform vec3 uGDim;
  vec3 guv(vec3 p) { return ((p - uGLo) / (uGHi - uGLo) * (uGDim - 1.0) + 0.5) / uGDim; }
  uniform float uMorph, uWidth, uTip, uTaper0, uPx, uMinPx, uFrac, uOpacity, uFemKeep, uDist, uSkinOffset, uShrink;
  float hashI(int i) { uint x = uint(i) * 747796405u + 2891336453u; x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u; x = (x >> 22u) ^ x; return float(x) / 4294967295.0; }
  attribute vec2 aT;            // x: render point index, y: side (−1 / +1)
  attribute vec3 aD;            // root delta − field(root)
  attribute vec4 aS;            // rand, width scale, kind, female keep
  varying vec3 vT; varying vec3 vN; varying vec3 vW; varying float vAO; varying float vCov; varying float vT01; varying vec4 vS;
  vec4 pt(int k) { int i = gl_InstanceID * uR + k; return texelFetch(uPts, ivec2(i % uTexW, i / uTexW), 0); }
  vec3 morph(vec3 p) { return p + uMorph * (texture(uField, guv(p)).xyz + aD); }
  void main() {
    // Sub-pixel strands: stochastic per-strand thinning (keep probability = true width / min drawable width, from the
    // head distance so the whole strand decides alike) + width compensation. Kept strands are drawn opaque, so
    // overlapping strands accumulate through MSAA geometric coverage (alpha-to-coverage masks would not).
    float w0 = uWidth * (0.55 + 0.9 * aS.y);
    float minPx = uMinPx * clamp(0.55 / uDist, 1.0, 1.7);   // close-ups: fewer, slightly wider strands (fill-rate bound)
    float keepP = clamp(w0 / (uDist * uPx * minPx), 0.0, 1.0);
    // crossfade / quality (uFrac) and dissolve (uOpacity) also thin per strand, so every drawn strand stays opaque:
    // no blending, no alpha-to-coverage, no discard → hidden-surface removal / early-z absorb the heavy overdraw
    bool femDrop = uFemKeep > 0.5 && aS.w < 0.5;
    if (hashI(gl_InstanceID) > keepP || hashI(gl_InstanceID + 7919) >= uFrac || hashI(gl_InstanceID * 3 + 104729) >= uOpacity || femDrop) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    int k = int(aT.x + 0.5);
    vec4 c = pt(k);
    vec3 nb = pt(k < uR - 1 ? k + 1 : k - 1).xyz;
    if (uShrink > 0.0) { vec3 r0 = pt(0).xyz; c.xyz = mix(c.xyz, r0, uShrink); nb = mix(nb, r0, uShrink); }   // finer female brows
    vec3 T = normalize((k < uR - 1 ? nb - c.xyz : c.xyz - nb) + 1e-7);
    vec3 p = uMorph > 0.0 ? morph(c.xyz) : c.xyz;
    vec3 N = texture(uNorm, guv(c.xyz)).xyz;
    p += normalize(N + 1e-5) * uSkinOffset;          // the site's skin is rendered 1.2 mm off its mesh
    vec3 W = (modelMatrix * vec4(p, 1.0)).xyz;
    vec3 Tw = normalize(mat3(modelMatrix) * T);
    vec3 Nw = normalize(mat3(modelMatrix) * (N + 1e-5));
    vec3 V = cameraPosition - W; float dist = length(V); V /= dist;
    vec3 side = cross(Tw, V); float sl = length(side);
    side = sl > 1e-4 ? side / sl : normalize(cross(Tw, vec3(0.0, 1.0, 0.0)));
    float t = aT.x / float(uR - 1);
    float w = w0 / max(keepP, 1e-3) * mix(1.0, uTip, smoothstep(uTaper0, 1.0, t));
    float wd = max(w, dist * uPx * minPx);
    vCov = w / wd;
    W += side * aT.y * wd * 0.5;
    vT = Tw; vN = Nw; vW = W; vAO = c.w; vT01 = t; vS = aS;
    vec4 mvPosition = viewMatrix * vec4(W, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <clipping_planes_vertex>
  }
`;

const STRAND_FS = /* glsl */`
  precision highp float;
  #include <common>
  #include <clipping_planes_pars_fragment>
  ${COMMON}
  uniform vec3 uAlbedo; uniform vec3 uAlbedo2; uniform int uDebug; uniform vec3 uTRT; uniform float uSpec1, uExp1, uExp2, uShift1, uShift2, uTT, uRootDark, uAmb;
  varying vec3 vT; varying vec3 vN; varying vec3 vW; varying float vAO; varying float vCov; varying float vT01; varying vec4 vS;
  float hsh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float kk(vec3 T, vec3 H, float e) { float d = dot(T, H); return smoothstep(-1.0, 0.0, d) * pow(sqrt(max(1.0 - d * d, 0.0)), e); }
  void main() {
    vec4 diffuseColor = vec4(1.0);          // the A2C clipping chunk writes diffuseColor.a
    #include <clipping_planes_fragment>
    vec3 T = normalize(vT); vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
    // per-strand albedo: black with a few dark-chestnut strands
    vec3 alb = mix(uAlbedo, uAlbedo2, vS.x * vS.x * vS.x) * (0.85 + 0.3 * fract(vS.x * 7.31));
    float occ = mix(0.12, 1.0, vAO) * mix(1.0 - uRootDark, 1.0, smoothstep(0.0, 0.35, vT01));
    vec3 col = alb * uAmb * mix(uGround, uSky, N.y * 0.5 + 0.5) * occ;
    float sp = 0.7 + 0.6 * fract(vS.x * 13.7);                   // per-strand cuticle variation
    for (int i = 0; i < ${MAX_L}; i++) {
      if (i >= uNL) break;
      vec3 L = uLDir[i]; vec3 Lc = uLCol[i];
      float dTL = dot(T, L);
      float kd = sqrt(max(1.0 - dTL * dTL, 0.0));
      float nl = dot(N, L);
      float vol = clamp((nl + 0.3) / 1.3, 0.0, 1.0);
      float sh = smoothstep(-0.2, 0.45, nl) * occ;               // head / volume self-shadow
      vec3 H = normalize(L + V);
      float s1 = kk(normalize(T + N * uShift1), H, uExp1);      // R: near-white, shifted toward the root
      float s2 = kk(normalize(T + N * uShift2), H, uExp2);      // TRT: warm, broader
      float tt = pow(clamp(dot(-V, L), 0.0, 1.0), 8.0) * kd;     // TT: forward scattering at the silhouette (rim)
      vec3 c = alb * RECIPROCAL_PI * mix(kd, vol, 0.6) * sh
             + vec3(uSpec1) * s1 * sh * sp
             + uTRT * s2 * sh
             + uTRT * uTT * tt * (0.4 + 0.6 * vAO);
      col += Lc * c;
    }
    if (uDebug == 1) col = (N * 0.5 + 0.5) * 0.3; else if (uDebug == 2) col = vec3(vAO * 0.3); else if (uDebug == 3) col = (T * 0.5 + 0.5) * 0.3;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const CAP_VS = /* glsl */`
  #include <common>
  #include <clipping_planes_pars_vertex>
  uniform float uMorph, uSkinOffset;
  attribute vec3 aDelta; attribute vec2 aA;
  varying vec3 vN; varying vec3 vW; varying vec2 vA;
  void main() {
    vec3 p = position + uMorph * aDelta + normalize(normal) * uSkinOffset;
    vec3 W = (modelMatrix * vec4(p, 1.0)).xyz;
    vN = normalize(mat3(modelMatrix) * normal); vW = W; vA = aA * 4.0 - 2.0;
    vec4 mvPosition = viewMatrix * vec4(W, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <clipping_planes_vertex>
  }
`;
const CAP_FS = /* glsl */`
  #include <common>
  #include <clipping_planes_pars_fragment>
  ${COMMON}
  uniform vec3 uCapCol; uniform float uOpacity, uCapA, uAmb;
  varying vec3 vN; varying vec3 vW; varying vec2 vA;
  float hsh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  void main() {
    vec4 diffuseColor = vec4(1.0);          // the A2C clipping chunk writes diffuseColor.a
    #include <clipping_planes_fragment>
    float a = smoothstep(0.1, 1.5, vA.x) * smoothstep(0.0, 1.0, vA.y) * uCapA * uOpacity * diffuseColor.a;
    if (a <= 0.004) discard;
    vec3 N = normalize(vN);
    vec3 col = uCapCol * uAmb * mix(uGround, uSky, N.y * 0.5 + 0.5);
    for (int i = 0; i < ${MAX_L}; i++) { if (i >= uNL) break; col += uLCol[i] * uCapCol * RECIPROCAL_PI * clamp((dot(N, uLDir[i]) + 0.2) / 1.2, 0.0, 1.0); }
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }
`;

// look presets per set kind (linear albedo; black Central-Asian hair)
const LOOK = {
  hair: { width: 0.00009, tip: 0.45, taper0: 0.7, albedo: [0.010, 0.0085, 0.0075], albedo2: [0.030, 0.019, 0.012], spec1: 0.22, trt: [0.020, 0.013, 0.009], exp1: 170, exp2: 40, shift1: -0.07, shift2: 0.12, tt: 5.0, rootDark: 0.5, amb: 1.0, cap: [0.012, 0.010, 0.009], capA: 0.92 },
  brows: { width: 0.0001, tip: 0.2, taper0: 0.4, albedo: [0.009, 0.007, 0.006], albedo2: [0.02, 0.013, 0.009], spec1: 0.035, trt: [0.008, 0.005, 0.004], exp1: 120, exp2: 30, shift1: -0.06, shift2: 0.1, tt: 1.0, rootDark: 0.2, amb: 1.0, cap: [0.03, 0.02, 0.016], capA: 0.0 },
};

export async function createHair(renderer, scene, opts = {}) {
  const base = opts.base ?? 'assets/';
  const names = opts.sets ?? ['male', 'female', 'brows'];
  let quality = opts.quality ?? 1;
  const clip = opts.clippingPlanes ?? null;
  const root = new THREE.Group(); root.name = 'hair';
  (opts.parent ?? scene).add(root);
  const shared = {
    uLDir: { value: Array.from({ length: MAX_L }, () => new THREE.Vector3(0, 1, 0)) },
    uLCol: { value: Array.from({ length: MAX_L }, () => new THREE.Vector3()) },
    uNL: { value: 0 }, uSky: { value: new THREE.Vector3(0.1, 0.1, 0.12) }, uGround: { value: new THREE.Vector3(0.02, 0.02, 0.02) },
    uPx: { value: 0.001 }, uOpacity: { value: 1 }, uSkinOffset: { value: opts.skinOffset ?? 0.0012 },
  };
  const maxTex = renderer.capabilities.maxTextureSize || 4096;
  const sets = {};
  const loaded = await Promise.all(names.map(n => loadSet(base + 'hair_' + n + '.bin').then(d => [n, d]).catch(e => { console.warn('hair: ' + n + ' missing', e); return null; })));
  for (const item of loaded) {
    if (!item) continue;
    const [name, { H, sec }] = item;
    const look = { ...LOOK[H.look || 'hair'], ...(H.lookOverride || {}) };
    const N = H.N, P = H.P;
    const up = upsample(P, N, sec('pos', Int16Array), H.box, sec('ao', Uint8Array));
    const R = up.R, total = N * R;
    const texW = Math.min(maxTex, 4096), texH = Math.ceil(total / texW);
    const data = new Float32Array(texW * texH * 4); data.set(up.data);
    const ptsTex = new THREE.DataTexture(data, texW, texH, THREE.RGBAFormat, THREE.FloatType);
    ptsTex.minFilter = ptsTex.magFilter = THREE.NearestFilter; ptsTex.needsUpdate = true;
    const field = makeField(H, sec, 'field'), norm = makeField(H, sec, 'nfield');
    // per-strand attributes
    const rd = sec('rootDelta', Int16Array), st = sec('strand', Uint8Array);
    const aD = new Float32Array(N * 3), aS = new Float32Array(N * 4);
    const dmax = H.dmax;
    for (let s = 0; s < N; s++) {
      const o = s * R * 4;
      const f = sampleField(field, [up.data[o], up.data[o + 1], up.data[o + 2]]);
      for (let a = 0; a < 3; a++) aD[s * 3 + a] = rd[s * 3 + a] / 32767 * dmax - f[a];
      for (let a = 0; a < 4; a++) aS[s * 4 + a] = st[s * 4 + a] / 255;
    }
    const geo = new THREE.InstancedBufferGeometry();
    const aT = new Float32Array(R * 2 * 2), idx = [];
    for (let k = 0; k < R; k++) {
      aT.set([k, -1, k, 1], k * 4);
      if (k < R - 1) { const a = 2 * k; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    geo.setAttribute('aT', new THREE.BufferAttribute(aT, 2));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(R * 2 * 3), 3));
    geo.setIndex(idx);
    geo.setAttribute('aD', new THREE.InstancedBufferAttribute(aD, 3));
    geo.setAttribute('aS', new THREE.InstancedBufferAttribute(aS, 4));
    geo.instanceCount = N;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(...H.box.c), Math.hypot(...H.box.e) + 0.05);
    const uniforms = {
      ...shared,
      uPts: { value: ptsTex }, uTexW: { value: texW }, uR: { value: R },
      uField: { value: field.tex }, uNorm: { value: norm.tex },
      uGLo: { value: new THREE.Vector3(...H.grid.lo) }, uGHi: { value: new THREE.Vector3(...H.grid.hi) }, uGDim: { value: new THREE.Vector3(...H.grid.dims) },
      uMorph: { value: 0 }, uWidth: { value: look.width }, uTip: { value: look.tip }, uTaper0: { value: look.taper0 },
      uDebug: { value: opts.debug | 0 }, uMinPx: { value: opts.minPx ?? 0.9 }, uDist: { value: 1 }, uFrac: { value: 1 }, uFemKeep: { value: 0 }, uShrink: { value: 0 },
      uAlbedo: { value: new THREE.Vector3(...look.albedo) }, uAlbedo2: { value: new THREE.Vector3(...look.albedo2) },
      uSpec1: { value: look.spec1 }, uTRT: { value: new THREE.Vector3(...look.trt) }, uExp1: { value: look.exp1 }, uExp2: { value: look.exp2 },
      uShift1: { value: look.shift1 }, uShift2: { value: look.shift2 }, uTT: { value: look.tt }, uRootDark: { value: look.rootDark }, uAmb: { value: look.amb },
    };
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: STRAND_VS, fragmentShader: STRAND_FS, side: THREE.DoubleSide, clipping: true });
    if (clip) mat.clippingPlanes = clip;
    const mesh = new THREE.Mesh(geo, mat); mesh.name = 'hair-' + name; mesh.frustumCulled = false; mesh.renderOrder = 5;
    root.add(mesh);
    // scalp cap
    let cap = null;
    if (H.cap && H.cap.V && look.capA > 0) {
      const cp = sec('capPos', Int16Array), cd = sec('capDelta', Int16Array), ca = sec('capA', Uint8Array), ci = sec('capIdx', Uint32Array);
      const V = H.cap.V, pos = new Float32Array(V * 3), del = new Float32Array(V * 3), aa = new Float32Array(V * 2);
      for (let i = 0; i < V * 3; i++) { pos[i] = H.box.c[i % 3] + cp[i] / 32767 * H.box.e[i % 3]; del[i] = cd[i] / 32767 * dmax; }
      for (let i = 0; i < V * 2; i++) aa[i] = ca[i] / 255;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aDelta', new THREE.BufferAttribute(del, 3));
      g.setAttribute('aA', new THREE.BufferAttribute(aa, 2));
      g.setIndex(new THREE.BufferAttribute(ci, 1));
      g.computeVertexNormals();
      const cu = { ...shared, uMorph: uniforms.uMorph, uCapCol: { value: new THREE.Vector3(...look.cap) }, uCapA: { value: look.capA }, uAmb: { value: look.amb } };
      const cm = new THREE.ShaderMaterial({ uniforms: cu, vertexShader: CAP_VS, fragmentShader: CAP_FS, transparent: true, depthWrite: false, clipping: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      if (clip) cm.clippingPlanes = clip;
      cap = new THREE.Mesh(g, cm); cap.name = 'hair-cap-' + name; cap.renderOrder = 4; cap.frustumCulled = false;
      root.add(cap);
    }
    sets[name] = { H, mesh, cap, uniforms, N, native: H.native, kind: H.kind, center: new THREE.Vector3(...H.box.c) };
  }

  let sex = 0, opacity = 1, visible = true;
  const sm = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  function apply() {
    const c = sm(0.12, 0.88, sex);        // crossfade (per-strand thinning, random order)
    for (const s of Object.values(sets)) {
      const u = s.uniforms;
      u.uMorph.value = s.native === 'f' ? 1 - sex : sex;
      let frac = 1;
      if (s.kind === 'male') frac = 1 - c; else if (s.kind === 'female') frac = c;
      else { u.uFemKeep.value = sex; u.uShrink.value = 0.28 * sex; }   // brows: female keeps a subset, shorter hairs
      u.uFrac.value = frac * quality;
      s.mesh.visible = visible && opacity > 0.002 && frac * quality > 0.001;
      if (s.cap) { s.cap.visible = s.mesh.visible; s.cap.material.uniforms.uCapA.value = LOOK.hair.capA * sm(0.0, 0.7, frac); }
    }
    shared.uOpacity.value = opacity;
  }
  apply();

  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  function update(dt, camera) {
    // lights from the scene (directional + hemisphere), world space
    let nl = 0;
    shared.uSky.value.set(0, 0, 0); shared.uGround.value.set(0, 0, 0);
    scene.traverseVisible(o => {
      if (o.isDirectionalLight && nl < MAX_L && o.intensity > 0) {
        o.getWorldPosition(tmpA); o.target.getWorldPosition(tmpB);
        shared.uLDir.value[nl].copy(tmpA.sub(tmpB).normalize());
        shared.uLCol.value[nl].set(o.color.r, o.color.g, o.color.b).multiplyScalar(o.intensity);
        nl++;
      } else if (o.isHemisphereLight) {
        shared.uSky.value.add(tmpA.set(o.color.r, o.color.g, o.color.b).multiplyScalar(o.intensity));
        shared.uGround.value.add(tmpA.set(o.groundColor.r, o.groundColor.g, o.groundColor.b).multiplyScalar(o.intensity));
      }
    });
    const env = scene.environment ? (scene.environmentIntensity ?? 1) * 0.35 : 0;   // faint studio ambient
    shared.uSky.value.addScalar(env); shared.uGround.value.addScalar(env * 0.3);
    shared.uNL.value = nl;
    if (camera) {
      camera.getWorldPosition(tmpB);
      for (const st of Object.values(sets)) { tmpA.copy(st.center).applyMatrix4(st.mesh.matrixWorld); st.uniforms.uDist.value = Math.max(0.05, tmpA.distanceTo(tmpB) - 0.06); }
    }
    if (camera && camera.isPerspectiveCamera) {
      const vh = renderer.getRenderTarget()?.height || renderer.getDrawingBufferSize(tmpA).y;
      const h = renderer.getDrawingBufferSize(tmpA).y || vh;
      shared.uPx.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / (camera.zoom || 1) / h;
    }
  }

  return {
    object3d: root,
    sets,
    setSex(v) { sex = Math.min(Math.max(+v || 0, 0), 1); apply(); },
    setOpacity(v) { opacity = Math.min(Math.max(+v || 0, 0), 1); apply(); },
    setVisible(b) { visible = !!b; root.visible = visible; apply(); },
    setQuality(q) { quality = Math.min(Math.max(+q || 0, 0), 1); apply(); },
    update,
    stats() { return Object.fromEntries(Object.entries(sets).map(([k, s]) => [k, { strands: s.N, visible: s.mesh.visible ? +(s.uniforms.uFrac.value).toFixed(3) : 0, points: s.uniforms.uR.value }])); },
    dispose() { root.removeFromParent(); root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { for (const k in o.material.uniforms) { const v = o.material.uniforms[k].value; if (v && v.isTexture) v.dispose(); } o.material.dispose(); } }); },
  };
}
