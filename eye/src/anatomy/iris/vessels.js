// Iris vasculature (shared vessel toolkit: buildTubes + vesselMaterial).
//  - Major arterial circle (circulus arteriosus iridis major) in the ciliary body just behind the root, fed by the two
//    long posterior ciliary arteries at the horizontal meridian (azimuth 0 nasal, PI temporal) and by the anterior
//    ciliary arteries (built by the vasculature module).
//  - Radial iris arteries leaving the circle obliquely (downstream), coiled (so they tolerate pupil movement),
//    running in the mid stroma towards the collarette, some branching dichotomously.
//  - Minor arterial circle (circulus arteriosus iridis minor): incomplete anastomotic arcades under the collarette; each
//    radial artery divides at its tip into the arcs, which bow slightly towards the pupil.
//  - Pupillary-zone capillary loops leaving the minor circle; radial veins (irregular spacing, tortuous, some
//    confluent) returning to the root and diving into the ciliary body under the major circle.
// Geometry is authored for the resting pupil; the vertex shader re-maps every tube centre into the live iris slab
// (same (s, depth) coordinates), so vessels follow the pupil exactly like the stroma they run in.
// Flow distance (dist0) is continuous from the LPCA entries along the circle into every branch, so the pulses of the
// vessel-glow mode never jump at a branch point.
import * as THREE from 'three';
import { GLSL_NOISE } from '../../lib/materials.js';
import { P0, R1, TAU, MAC, rad, front, thick, collaretteSmooth as collaretteS, inSlab, pth } from './profile.js';
import { GLSL_PROFILE } from './profile.js';
import { SHARED } from './shading.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const wrap = a => a - TAU * Math.round(a / TAU);
const pathLen = pts => { let d = 0; for (let i = 1; i < pts.length; i++) d += pts[i].distanceTo(pts[i - 1]); return d; };
const sOfPt = p => { const th = Math.atan2(p.y, p.x), q = pth(th, P0); return (Math.hypot(p.x, p.y) - q) / (R1 - q); };

export function vesselPaths(rng) {
  const R = rng(777);
  const macPt = th => {
    const r = MAC.r + 0.04 * Math.sin(th * 5 + 0.4) + 0.025 * Math.sin(th * 11 + 1.2);
    return new THREE.Vector3(r * Math.cos(th), r * Math.sin(th), MAC.z + 0.035 * Math.sin(th * 4 + 0.8));
  };
  // blood runs along the circle away from the nearest LPCA entry
  const macFlow = th => {
    let best = null;
    for (const e of MAC.lpcaAz) { const d = wrap(th - e); if (!best || Math.abs(d) < Math.abs(best)) best = d; }
    return { sgn: best >= 0 ? 1 : -1, dist: 30 + Math.abs(best) * MAC.r };
  };
  const mac = [], arteries = [], minor = [], caps = [], veins = [];
  for (const start of MAC.lpcaAz) for (const dir of [1, -1]) {
    const pts = [], span = Math.PI / 2 + 0.05;
    for (let k = 0; k <= 72; k++) pts.push(macPt(start + dir * span * k / 72));
    mac.push({ points: pts, radii: [MAC.tube, MAC.tube * 0.95, MAC.tube * 0.9], kind: 0, dist0: 30 });
  }

  // coiled radial run inside the slab from s0 inward to s1 at depth fraction d
  function radialRun(th0, s0, s1, d, { amp, wav, ph, drift, dz = 0.02, step = 0.01, thEnd = null }) {
    const pts = [];
    const n = Math.max(2, Math.ceil(Math.abs(s0 - s1) / step));
    for (let k = 0; k <= n; k++) {
      const t = k / n, s = s0 + (s1 - s0) * t;
      const dist = Math.abs(s0 - s) * (R1 - P0);
      // irregular coiling: wavelength and amplitude drift along the vessel (not a clean sine)
      const phase = TAU * (dist / wav + 0.3 * Math.sin(dist * 1.7 + ph * 1.3)) + ph;
      const a = amp * (0.55 + 0.45 * Math.sin(dist * 1.1 + ph * 2.1)) * Math.min(1, t * 6);
      const lat = a * (Math.sin(phase) + 0.25 * Math.sin(2.3 * phase + ph));
      const th = (thEnd == null ? th0 + drift * t : th0 + (thEnd - th0) * t) + lat / rad(s, P0);
      const p = V(inSlab(th, s, d));
      p.z += dz * Math.cos(phase * 0.9 + 0.7) * Math.min(1, t * 6);
      pts.push(p);
    }
    return pts;
  }

  const ends = []; // artery tips under the collarette: { th, s, pt, dist, r }
  const NA = 26;
  for (let i = 0; i < NA; i++) {
    const th = TAU * (i + 0.2 * (R() - 0.5)) / NA + 0.05;
    const drift = (R() - 0.5) * 0.1;
    const thE = th + drift;
    const sEnd = collaretteS(thE) + 0.014;
    // oblique take-off: the branch leaves the circle pointing downstream, then turns forward into the root
    const fl = macFlow(th);
    const th0 = th - fl.sgn * (0.07 + 0.04 * R());
    const q0 = macPt(th0), q1 = macPt(th0 + (th - th0) * 0.55);
    q1.multiplyScalar(0.995).setZ(MAC.z + 0.07);
    const head = [q0, q1, V([6.02 * Math.cos(th), 6.02 * Math.sin(th), MAC.z + 0.17])];
    const run = radialRun(th, 0.985, sEnd, 0.56, { amp: 0.05 + R() * 0.05, wav: 0.42 + R() * 0.3, ph: R() * TAU, drift });
    const pts = head.concat(run);
    const dist0 = macFlow(th0).dist;
    arteries.push({ points: pts, radii: [0.052, 0.048, 0.044, 0.04, 0.036, 0.032], kind: 0, dist0 });
    ends.push({ th: thE, pt: pts[pts.length - 1], dist: dist0 + pathLen(pts), r: 0.032 });
    if (R() < 0.8) {                      // dichotomous branch towards the collarette
      const k = Math.floor(run.length * (0.3 + R() * 0.25));
      const bp = run[k];
      const sB = sOfPt(bp);
      const thB = Math.atan2(bp.y, bp.x);
      const thBE = thB + (R() < 0.5 ? -1 : 1) * (0.07 + R() * 0.07);
      const sBE = collaretteS(thBE) + 0.016;
      const bpts = [bp.clone()].concat(radialRun(thB, sB, sBE, 0.54, { amp: 0.04 + R() * 0.04, wav: 0.4 + R() * 0.3, ph: R() * TAU, drift: 0, thEnd: thBE }).slice(1));
      const d0 = dist0 + pathLen(head.concat(run.slice(0, k + 1)));
      arteries.push({ points: bpts, radii: [0.034, 0.03, 0.026], kind: 0, dist0: d0 });
      ends.push({ th: thBE, pt: bpts[bpts.length - 1], dist: d0 + pathLen(bpts), r: 0.026 });
    }
  }
  // minor arterial circle: arcades between neighbouring artery tips, many incomplete. Each arc starts exactly at a tip
  // with the tip's calibre (a bifurcation, not a T-junction) and bows a little towards the pupil.
  ends.sort((a, b) => a.th - b.th);
  const arcs = [];
  const minorArc = (A, thB, B, frac) => {
    // from tip A towards azimuth thB (tip B if complete); frac < 1 = incomplete arc that tapers out
    const thA = A.th, thEnd = thA + (thB - thA) * frac;
    const pts = [], n = Math.max(4, Math.ceil(Math.abs(thEnd - thA) * 70));
    const sA = sOfPt(A.pt), sB = B ? sOfPt(B.pt) : collaretteS(thB) + 0.014;
    for (let k = 0; k <= n; k++) {
      const t = k / n, th = thA + (thEnd - thA) * t, u = t * frac;
      const s = sA + (sB - sA) * u - 0.022 * Math.sin(Math.PI * u) + (collaretteS(th) - collaretteS(thA) * (1 - u) - collaretteS(thB) * u);
      const p = V(inSlab(th, s, 0.5 + 0.06 * (1 - Math.sin(Math.PI * u))));
      p.z += 0.01 * Math.sin(k * 0.9) * Math.sin(Math.PI * u);
      pts.push(p);
    }
    pts[0].copy(A.pt);
    if (B && frac >= 1) {
      // complete arcade: fed from both tips, the two streams meet near the middle (continuous pulses at both ends)
      pts[pts.length - 1].copy(B.pt);
      const m = Math.floor(pts.length / 2);
      const h1 = { points: pts.slice(0, m + 1), radii: [A.r * 0.92, 0.028, 0.026], kind: 0, dist0: A.dist };
      const h2 = { points: pts.slice(m).reverse(), radii: [B.r * 0.92, 0.028, 0.026], kind: 0, dist0: B.dist };
      minor.push(h1, h2); arcs.push(h1, h2);
    } else {
      const path = { points: pts, radii: [A.r * 0.92, 0.028, 0.026, 0.022, 0.012], kind: 0, dist0: A.dist };
      minor.push(path); arcs.push(path);
    }
  };
  for (let i = 0; i < ends.length; i++) {
    const a = ends[i], b = ends[(i + 1) % ends.length];
    let thB = b.th; if (thB < a.th) thB += TAU;
    const bb = { ...b, th: thB };
    if (R() < 0.6) minorArc(a, thB, bb, 1);
    else { minorArc(a, thB, null, 0.25 + R() * 0.2); minorArc(bb, a.th, null, 0.2 + R() * 0.2); }
  }
  // pupillary-zone capillary loops, each leaving a point of the minor circle (flow distance continues from it)
  for (let i = 0; i < 84; i++) {
    const arc = arcs[Math.floor(R() * arcs.length)];
    const k = Math.floor(arc.points.length * (0.15 + 0.7 * R()));
    const o = arc.points[k];
    const th = Math.atan2(o.y, o.x), sc = sOfPt(o);
    const pts = [o.clone()].concat(radialRun(th, sc, 0.035, 0.5, { amp: 0.012 + R() * 0.012, wav: 0.3 + R() * 0.2, ph: R() * TAU, drift: (R() - 0.5) * 0.06, dz: 0.008, step: 0.02 }).slice(1));
    // margin: capillary loop turning back into a venule
    const last = pts[pts.length - 1];
    const thL = Math.atan2(last.y, last.x), side = R() < 0.5 ? -1 : 1;
    for (let j = 1; j <= 6; j++) {
      const a = Math.PI * j / 6;
      const s = 0.035 - 0.012 * Math.sin(a) + (j > 3 ? 0.03 * (j - 3) / 3 : 0);
      pts.push(V(inSlab(thL + side * (0.05 * (1 - Math.cos(a)) / 2) / rad(s, P0), s, 0.42)));
    }
    caps.push({ points: pts, radii: [0.017, 0.014, 0.012, 0.011], kind: 2, dist0: arc.dist0 + pathLen(arc.points.slice(0, k + 1)) });
  }
  // radial veins: irregularly spaced, tortuous trunks from the pupillary zone to the root, a few confluent; each trunk
  // dives into the ciliary body under the major circle (towards the ciliary veins), tapering where it leaves the iris
  const NV = 22;
  for (let i = 0; i < NV; i++) {
    const th = TAU * (i + 0.5 + 0.7 * (R() - 0.5)) / NV + 0.05;
    // behind the root the trunk passes on the inner side of the major circle (clear of it) and dives posteriorly
    const m = macPt(th), rm = Math.hypot(m.x, m.y), c = Math.cos(th), sn = Math.sin(th);
    const at = (r, z) => new THREE.Vector3(r * c, r * sn, z);
    const dive = [at(rm - 0.1, m.z - 0.3), at(rm - 0.16, m.z - 0.18), at(rm - 0.19, m.z + 0.02), at(5.99, front(1, P0) - 0.45 * thick(1, P0))];
    const run = radialRun(th, 0.985, 0.07 + R() * 0.06, 0.44, { amp: 0.03 + R() * 0.045, wav: 0.5 + R() * 0.6, ph: R() * TAU, drift: (R() - 0.5) * 0.2, dz: 0.014, step: 0.012 });
    const pts = dive.concat(run);
    const w = 0.056 + R() * 0.014;
    const vr = [0.02, w * 0.85]; for (let j = 0; j < 18; j++) vr.push(w * (1 - 0.58 * j / 17));
    const vein = { points: pts, radii: vr, kind: 1, dist0: 20 };
    veins.push(vein);
    if (R() < 0.35) {                    // a tributary joining the trunk in the mid stroma
      const k = Math.floor(run.length * (0.25 + 0.3 * R()));
      const jp = run[k], thJ = Math.atan2(jp.y, jp.x), sJ = sOfPt(jp);
      const thT = thJ + (R() < 0.5 ? -1 : 1) * (0.08 + R() * 0.08);
      const tpts = [jp.clone()].concat(radialRun(thJ, sJ, Math.max(0.12, sJ - 0.25 - R() * 0.2), 0.46, { amp: 0.025 + R() * 0.03, wav: 0.45 + R() * 0.4, ph: R() * TAU, drift: 0, dz: 0.012, step: 0.014, thEnd: thT }).slice(1));
      veins.push({ points: tpts, radii: [w * 0.6, w * 0.5, w * 0.4], kind: 1, dist0: 20 + pathLen(dive.concat(run.slice(0, k + 1))) });
    }
  }
  return { mac, arteries, minor, caps, veins, macPt };
}

function mergeTubes(geos) {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const names = ['position', 'normal', 'aDist', 'aKind', 'aRadius'];
  const arrs = Object.fromEntries(names.map(n => [n, new Float32Array(nv * geos[0].attributes[n].itemSize)]));
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    for (const n of names) arrs[n].set(g.attributes[n].array, vo * g.attributes[n].itemSize);
    const ia = g.index.array; for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo;
    vo += g.attributes.position.count; io += ia.length;
  }
  const out = new THREE.BufferGeometry();
  for (const n of names) out.setAttribute(n, new THREE.BufferAttribute(arrs[n], geos[0].attributes[n].itemSize));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// rest (s, depth) of a tube centre -> the same (s, depth) in the live slab (local margin radius at its azimuth)
export const GLSL_REMAP = /* glsl */`
vec3 irRemap(vec3 c) {
  float r = length(c.xy);
  if (r < 1e-4) return c;
  float th = atan(c.y, c.x);
  float q0 = irPth(th, IR_P0), q = irPth(th, uPupil);
  float s = (r - q0) / (IR_R1 - q0);
  if (s >= 1.0) return c;
  s = max(s, 0.0);
  float d = (irFront(s, q0) - c.z) / irThick(s, q0);
  float r2 = irRad(s, q);
  return vec3(c.xy * (r2 / r), irFront(s, q) - d * irThick(s, q));
}`;

export function buildIrisVessels(ctx, quality) {
  const { vessels, rng } = ctx;
  const P = vesselPaths(rng);
  const lo = quality === 'low';
  const geo = mergeTubes([
    vessels.buildTubes(P.mac, { radial: 7, minRadial: 5, lengthStep: 0.14 }),
    vessels.buildTubes(P.arteries.concat(P.minor), { radial: lo ? 4 : 5, minRadial: 4, lengthStep: lo ? 0.1 : 0.06 }),
    vessels.buildTubes(P.caps, { radial: 4, minRadial: 3, lengthStep: lo ? 0.12 : 0.07 }),
    vessels.buildTubes(P.veins, { radial: lo ? 4 : 5, minRadial: 4, lengthStep: lo ? 0.12 : 0.08 }),
  ]);
  const mat = vessels.vesselMaterial();
  mat.uniforms.uPupil = SHARED.uPupil;
  const vs0 = mat.vertexShader;
  mat.vertexShader = vs0
    .replace('void main() {', `uniform float uPupil;\n${GLSL_NOISE}\n${GLSL_PROFILE}\n${GLSL_REMAP}\nvoid main() {`)
    .replace('vec4 mv = modelViewMatrix * vec4(position, 1.0);',
      'vec3 irC = position - normal * aRadius; vec4 mv = modelViewMatrix * vec4(irRemap(irC) + (position - irC), 1.0);');
  if (mat.vertexShader === vs0 || !mat.vertexShader.includes('irRemap(irC)')) console.warn('iris vessels: pupil remap not applied');
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'iris-vessels';
  // pickable proxy: fat, low-res tubes around the main trunks (remapped on the CPU when the pupil moves)
  const fat = arr => arr.map(p => ({ ...p, radii: 0.16 }));
  const proxyGeo = vessels.buildTubes(fat(P.mac).concat(fat(P.arteries), fat(P.veins)), { radial: 4, minRadial: 4, lengthStep: 0.45 });
  return { mesh, mat, proxyGeo, paths: P };
}
