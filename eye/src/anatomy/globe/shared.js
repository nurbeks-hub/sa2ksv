// Shared helpers for the globe module (cornea, conjunctiva, sclera).
// Geometry: ring-strip meshing with wrap-around topology (no UV seam, smooth normals),
// material patching (onBeforeCompile with explicit cache keys), GLSL helpers.
import * as THREE from 'three';
import { GLSL_NOISE, applyGhost, rng } from '../../lib/materials.js';

// ---------------------------------------------------------------------------------------------
// Corneal rim / limbus geometry, computed once so the cornea and the scleral lip mate exactly.
// Anterior cornea: sphere R = corneaAntRadius through the limbus (L.limbusZ, EYE.limbusR).
// Posterior cornea: conicoid with apical radius corneaPostRadius and asphericity Q solved so that the
// corneal thickness (normal to the anterior surface) is exactly corneaPeriphThick at the rim.
// The rim face is bevelled slightly outward (watch-glass in its bezel: the posterior corneal
// diameter is larger than the anterior one, the sclera overlaps the corneal edge externally).
export function corneaRim(EYE, L) {
  const lR = EYE.limbusR, Ra = EYE.corneaAntRadius, Rp = EYE.corneaPostRadius, cZ = L.corneaCenterZ;
  const bevel = 0.06;
  const rP = lR + bevel;
  const zP = cZ + Math.sqrt((Ra - EYE.corneaPeriphThick) ** 2 - rP * rP);
  const papex = L.corneaPostApexZ;
  const sag = papex - zP;
  const k = rP * rP / (Rp * sag) - 1;
  const Q = (1 - k * k) * Rp * Rp / (rP * rP) - 1;
  const zPost = r => papex - r * r / (Rp * (1 + Math.sqrt(Math.max(0, 1 - (1 + Q) * r * r / (Rp * Rp)))));
  const dzPost = r => r / Math.sqrt(Math.max(1e-6, Rp * Rp - (1 + Q) * r * r)); // d(sag)/dr
  const zAnt = r => cZ + Math.sqrt(Ra * Ra - r * r);
  return { lR, lZ: L.limbusZ, rP, zP, Q, zPost, dzPost, zAnt, cZ, Ra, Rp, papex };
}

// ---------------------------------------------------------------------------------------------
// Mesh assembly. A "grid" is a list of rings; every ring has the same number of points (seg) and
// wraps around. Consecutive rings are stitched into quads. Each grid carries per-vertex attributes.
export class Mesher {
  constructor(attrSizes) { this.attrSizes = attrSizes; this.chunks = []; }
  // rings: Vector3[][]; attrs: { name: (ringIndex, j) => number | number[] }; opts: { normals?: (ri, j, p) => Vector3, expect?: (p) => Vector3 }
  addGrid(rings, attrs, opts = {}) {
    const seg = rings[0].length, nr = rings.length;
    const pos = new Float32Array(nr * seg * 3);
    const out = {};
    for (const [name, size] of Object.entries(this.attrSizes)) out[name] = new Float32Array(nr * seg * size);
    for (let i = 0; i < nr; i++) for (let j = 0; j < seg; j++) {
      const v = (i * seg + j), p = rings[i][j];
      pos[v * 3] = p.x; pos[v * 3 + 1] = p.y; pos[v * 3 + 2] = p.z;
      for (const [name, size] of Object.entries(this.attrSizes)) {
        const f = attrs[name];
        const val = f ? f(i, j, p) : 0;
        if (size === 1) out[name][v] = val; else for (let k = 0; k < size; k++) out[name][v * size + k] = val[k];
      }
    }
    const idx = [];
    for (let i = 0; i < nr - 1; i++) for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      const a = i * seg + j, b = i * seg + j1, c = (i + 1) * seg + j, d = (i + 1) * seg + j1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    if (opts.normals) {
      const nor = new Float32Array(nr * seg * 3);
      for (let i = 0; i < nr; i++) for (let j = 0; j < seg; j++) {
        const n = opts.normals(i, j, rings[i][j]); const v = i * seg + j;
        nor[v * 3] = n.x; nor[v * 3 + 1] = n.y; nor[v * 3 + 2] = n.z;
      }
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    } else g.computeVertexNormals();
    // Orient the winding so that faces are front-facing along the (expected / provided) normal.
    const ia = g.index.array, P = g.attributes.position.array, N = g.attributes.normal.array;
    const mid = Math.floor((nr - 1) / 2) * seg * 6 + Math.floor(seg / 3) * 6; // a triangle in the middle
    const t0 = ia[mid], t1 = ia[mid + 1], t2 = ia[mid + 2];
    const A = new THREE.Vector3(P[t0 * 3], P[t0 * 3 + 1], P[t0 * 3 + 2]);
    const B = new THREE.Vector3(P[t1 * 3], P[t1 * 3 + 1], P[t1 * 3 + 2]);
    const C = new THREE.Vector3(P[t2 * 3], P[t2 * 3 + 1], P[t2 * 3 + 2]);
    const fn = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
    const want = opts.expect ? opts.expect(A) : new THREE.Vector3(N[t0 * 3], N[t0 * 3 + 1], N[t0 * 3 + 2]);
    if (fn.dot(want) < 0) {
      for (let t = 0; t < ia.length; t += 3) { const s = ia[t + 1]; ia[t + 1] = ia[t + 2]; ia[t + 2] = s; }
      if (!opts.normals) g.computeVertexNormals();
    }
    // computeVertexNormals follows the winding; if an expectation was given make sure normals agree.
    if (opts.expect && !opts.normals) {
      const Nn = g.attributes.normal.array;
      const n0 = new THREE.Vector3(Nn[t0 * 3], Nn[t0 * 3 + 1], Nn[t0 * 3 + 2]);
      if (n0.dot(want) < 0) for (let k = 0; k < Nn.length; k++) Nn[k] = -Nn[k];
    }
    this.chunks.push({ g, attrs: out, count: nr * seg });
    return this;
  }
  build() {
    let nv = 0, ni = 0;
    for (const c of this.chunks) { nv += c.count; ni += c.g.index.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
    const attrs = {}; for (const [n, s] of Object.entries(this.attrSizes)) attrs[n] = new Float32Array(nv * s);
    const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const c of this.chunks) {
      pos.set(c.g.attributes.position.array, vo * 3);
      nor.set(c.g.attributes.normal.array, vo * 3);
      for (const [n, s] of Object.entries(this.attrSizes)) attrs[n].set(c.attrs[n], vo * s);
      const ia = c.g.index.array; for (let k = 0; k < ia.length; k++) index[io + k] = ia[k] + vo;
      vo += c.count; io += ia.length;
      c.g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    for (const [n, s] of Object.entries(this.attrSizes)) g.setAttribute(n, new THREE.BufferAttribute(attrs[n], s));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// Spherical point around +Z: polar from +Z, azimuth from +X towards +Y.
export function sph(polar, az, r = 1, out = new THREE.Vector3()) {
  const s = Math.sin(polar);
  return out.set(s * Math.cos(az) * r, s * Math.sin(az) * r, Math.cos(polar) * r);
}
export const smooth01 = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
export const smoothstep = (a, b, x) => smooth01((x - a) / (b - a));

// Build a monotone list of values from a to b whose spacing is step(v) (in the same units).
export function stepList(a, b, step) {
  const out = [a]; let v = a;
  while (v < b) { v += step(v); out.push(Math.min(v, b)); if (b - v < step(v) * 0.35) { out[out.length - 1] = b; break; } }
  if (out[out.length - 1] !== b) out.push(b);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tileable 32^3 lattice of random values (4 independent channels). Sampled with a smoothstepped
// fractional coordinate it yields C1-smooth value noise from ONE trilinear fetch (4 noises at once),
// replacing ~4 procedural hash-noise evaluations per fetch.
let _noiseTex = null;
export function noiseTexture() {
  if (_noiseTex) return _noiseTex;
  const N = 32, R = rng(90210), data = new Uint8Array(N * N * N * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(R() * 256);
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.unpackAlignment = 1; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  _noiseTex = t;
  return t;
}

// ---------------------------------------------------------------------------------------------
// GLSL shared by every patched material of this module.
export const GLSL_COMMON = /* glsl */`
uniform float uGhost;
uniform float uHighlight;
uniform float uTime;
uniform float uVessels;
uniform float uInspect;
varying vec3 vLocal;
uniform highp sampler3D uNoiseTex;
${GLSL_NOISE}
// (input rotated off the lattice axes so value-noise grid artefacts never align with the eye's axes)
const mat3 G_ROT = mat3(0.8, 0.36, -0.48, -0.6, 0.48, -0.64, 0.0, 0.8, 0.6);
vec4 tn(vec3 x) { x = G_ROT * x; vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f); return textureLod(uNoiseTex, (i + f + 0.5) / 32.0, 0.0); }
float gN3(vec3 p) { return vnoise(p) * 0.57 + vnoise(p * 2.07 + 13.1) * 0.29 + vnoise(p * 4.13 + 5.7) * 0.14; }
// Bump mapping from a procedural height h (mm, view-space units) using screen derivatives.
// Only for fine, footprint-faded micro detail: dFdx is constant over each 2x2 pixel quad, so any broad,
// strong term routed through here quantises the normal and gives highlights stair-stepped edges.
vec3 gBump(vec3 sp, vec3 n, float h, float fd) {
  vec3 sx = dFdx(sp), sy = dFdy(sp);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * fd;
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * n - grad);
}
// Lattice noise with an exact analytic gradient: the same field as tn() (same lattice, same smoothstep
// fade), but built from 8 texelFetches so value and gradient are continuous per pixel (no hardware filter
// weight quantisation, no screen-space derivative). v = 4 channels; gx/gy/gz = d v / d p (per channel),
// taken w.r.t. the caller's p (G_ROT undone).
void tnG4(vec3 p, out vec4 v, out vec4 gx, out vec4 gy, out vec4 gz) {
  vec3 x = G_ROT * p; vec3 fi = floor(x); vec3 f = x - fi;
  vec3 u = f * f * (3.0 - 2.0 * f); vec3 du = 6.0 * f * (1.0 - f);
  ivec3 i0 = ivec3(fi) & 31; ivec3 i1 = (i0 + 1) & 31;
  vec4 a = texelFetch(uNoiseTex, i0, 0);
  vec4 b = texelFetch(uNoiseTex, ivec3(i1.x, i0.y, i0.z), 0);
  vec4 c = texelFetch(uNoiseTex, ivec3(i0.x, i1.y, i0.z), 0);
  vec4 d = texelFetch(uNoiseTex, ivec3(i1.x, i1.y, i0.z), 0);
  vec4 e = texelFetch(uNoiseTex, ivec3(i0.x, i0.y, i1.z), 0);
  vec4 f1 = texelFetch(uNoiseTex, ivec3(i1.x, i0.y, i1.z), 0);
  vec4 g = texelFetch(uNoiseTex, ivec3(i0.x, i1.y, i1.z), 0);
  vec4 h = texelFetch(uNoiseTex, i1, 0);
  vec4 k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + g, k6 = a - b - e + f1;
  vec4 k7 = -a + b + c - d + e - f1 - g + h;
  v = a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z;
  vec4 dx = du.x * (k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z);
  vec4 dy = du.y * (k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x);
  vec4 dz = du.z * (k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y);
  gx = G_ROT[0][0] * dx + G_ROT[0][1] * dy + G_ROT[0][2] * dz;
  gy = G_ROT[1][0] * dx + G_ROT[1][1] * dy + G_ROT[1][2] * dz;
  gz = G_ROT[2][0] * dx + G_ROT[2][1] * dy + G_ROT[2][2] * dz;
}
vec3 gGrad(vec4 gx, vec4 gy, vec4 gz, vec4 w) { return vec3(dot(gx, w), dot(gy, w), dot(gz, w)); }
const vec3 G_LIME = vec3(0.85, 1.0, 0.24);
`;

// Perturb the (view-space) shading normal by the gradient of a height field given in the eye frame
// (mm per mm). Needs uViewToLocal (see trackViewToLocal); v * M == transpose(M) * v = local -> view.
export const GLSL_GRADBUMP = /* glsl */`
#ifndef G_VIEW2LOCAL
#define G_VIEW2LOCAL
uniform mat3 uViewToLocal;
#endif
vec3 gGradBump(vec3 n, vec3 gLocal) {
  vec3 g = gLocal * uViewToLocal;
  g -= n * dot(n, g);
  return normalize(n - g);
}
`;

// Interior light visibility for surfaces that live inside the globe (inner scleral wall, canal,
// lamina cribrosa): a directional light reaches them only through the corneal opening (limbus
// aperture) or through the scleral canal. Analytic, no shadow maps.
export const GLSL_INTERIOR = /* glsl */`
#ifndef G_VIEW2LOCAL
#define G_VIEW2LOCAL
uniform mat3 uViewToLocal;
#endif
uniform vec3 uCanalAxis;
uniform float uOpenCos;
float gInterior = 0.0;
float gAmb = 1.0;
float gSSS = 0.0;
float gVisAnterior(vec3 P, vec3 Ld) {
  float R = 11.95;
  float b = dot(P, Ld);
  float c = dot(P, P) - R * R;
  if (c > 0.0) return 1.0;
  float t = -b + sqrt(max(b * b - c, 0.0));
  vec3 E = P + Ld * t;
  return smoothstep(uOpenCos - 0.035, uOpenCos + 0.02, E.z / R);
}
float gVisCanal(vec3 P, vec3 Ld) {
  float ld = dot(Ld, uCanalAxis);
  if (ld <= 0.02) return 0.0;
  float pd = dot(P, uCanalAxis);
  float tOut = max(12.3 - pd, 0.0) / ld;
  vec3 Q = (P - uCanalAxis * pd) + (Ld - uCanalAxis * ld) * tOut;
  return smoothstep(1.7, 1.15, length(Q));
}
float gLightVis(vec3 dirView) {
  if (gInterior < 0.5) return 1.0;
  vec3 Ld = normalize(uViewToLocal * dirView);
  return max(gVisAnterior(vLocal, Ld), gVisCanal(vLocal, Ld));
}
float gWrap(float nl) { return max(0.0, (nl + 0.5) / 1.5) - max(0.0, nl); }
`;

export const LIGHTS_BEGIN_INTERIOR = THREE.ShaderChunk.lights_fragment_begin
  .replace('IncidentLight directLight;', 'IncidentLight directLight;\nvec3 gWrapAcc = vec3( 0.0 );')
  .replace('getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= gLightVis( directLight.direction );\n\t\tgWrapAcc += directLight.color * gWrap( dot( geometryNormal, directLight.direction ) );')
  .replace('getPointLightInfo( pointLight, geometryPosition, directLight );',
    'getPointLightInfo( pointLight, geometryPosition, directLight );\n\t\tdirectLight.color *= gLightVis( directLight.direction );');

// Patch a built-in material. `frag` is a list of [find, replace] applied to the fragment source
// (before includes are resolved, so hooks are #include lines). An explicit cache key keeps
// variants apart (three keys programs by onBeforeCompile.toString() otherwise).
export function patchMaterial(mat, key, { uniforms = {}, vertPars = '', vertMain = '', fragPars = '', frag = [], vert = [] }) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLocal;\n${vertPars}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvLocal = position;\n${vertMain}`);
    for (const [find, repl] of vert) {
      if (!sh.vertexShader.includes(find)) { console.warn('[globe] vertex hook missing:', find); continue; }
      sh.vertexShader = sh.vertexShader.replace(find, repl);
    }
    let fs = sh.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n${fragPars}`);
    for (const [find, repl] of frag) {
      if (!fs.includes(find)) { console.warn('[globe] shader hook missing:', find); continue; }
      fs = fs.replace(find, repl);
    }
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'eye-globe-' + key;
  mat.userData.globeUniforms = uniforms;
  return mat;
}

export function baseUniforms(extra = {}) {
  return {
    uNoiseTex: { value: noiseTexture() },
    uGhost: { value: 0 }, uHighlight: { value: 0 }, uTime: { value: 0 }, uVessels: { value: 0 }, uInspect: { value: 0 },
    ...extra,
  };
}

// Ghosting: the shared applyGhost fades opacity; highlight is rendered by our own subtle lime rim
// (uHighlight) instead of the full emissive wash, so we pass highlight 0 to applyGhost.
export function makeSetGhost(object, uniformSets) {
  return (ghost, highlight = 0) => {
    applyGhost(object, ghost, 0);
    for (const u of uniformSets) { u.uGhost.value = ghost; u.uHighlight.value = highlight; }
  };
}

// Keep uViewToLocal (view-space -> eye-frame rotation) current for a mesh, for every render
// (including the transmission pre-pass).
// Also flags the transmission pre-pass (three renders it into a mip-mapped target) so the shader can
// skip micro-detail there: that image is only ever seen blurred/refracted through the cornea.
const _m4 = new THREE.Matrix4();
export function trackViewToLocal(mesh, uniform, cheapUniform = null) {
  mesh.onBeforeRender = (renderer, scene, camera) => {
    _m4.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
    uniform.value.setFromMatrix4(_m4).invert();
    if (cheapUniform) { const rt = renderer.getRenderTarget(); cheapUniform.value = rt && rt.texture && rt.texture.generateMipmaps ? 1 : 0; }
  };
}

export function proxyMaterial() {
  return new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
}
