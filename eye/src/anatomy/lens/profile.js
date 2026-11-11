// Shared geometry for the lens module: the lens profile (so the raymarcher, the mesh and the zonule
// insertions agree) and the meridional profile of the ciliary body (so the ring mesh, its section caps
// and the zonule origins agree). Eye frame: +Z anterior, +Y superior, +X nasal. Units: mm.
import * as THREE from 'three';
import { EYE, L } from '../../config.js';
import { LIMBUS_POLAR, oraPolar } from '../../lib/anatomyMath.js';
import { rng } from '../../lib/materials.js';

const RS = L.scleraOuterR;
const TAU = Math.PI * 2;
export const clamp01 = x => Math.min(1, Math.max(0, x));
export const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const wrapPI = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

// ------------------------------------------------------------------------------------------------
// LENS. Local frame: origin on the optical axis in the equatorial plane (world z = L.lensEquatorZ).
// Each face is z = ±sag * sqrt(1 - x²) * (1 + c x²), x = rho / Re. The sqrt gives a vertical, rounded
// equator; c is solved so the apical radius of curvature is exactly EYE.lensAntRadius / lensPostRadius.
// Sags: anterior pole L.lensAntZ, posterior pole L.lensPostZ, equator at L.lensEquatorZ (42 % back).
// ------------------------------------------------------------------------------------------------
export const LENS = (() => {
  const Re = EYE.lensEquatorR;
  const a = L.lensAntZ - L.lensEquatorZ;   // 1.68 mm
  const p = L.lensEquatorZ - L.lensPostZ;  // 2.32 mm
  const ca = 0.5 - (Re * Re) / (2 * a * EYE.lensAntRadius);
  const cp = 0.5 - (Re * Re) / (2 * p * EYE.lensPostRadius);
  return { Re, a, p, ca, cp, z0: L.lensEquatorZ };
})();

// Raw analytic faces (before equatorial rounding) for a raw equatorial radius Rr; the c terms are re-solved
// for Rr so the apical radii stay exactly EYE.lensAntRadius / lensPostRadius.
function rawProfile(Rr) {
  const ca = 0.5 - (Rr * Rr) / (2 * LENS.a * EYE.lensAntRadius);
  const cp = 0.5 - (Rr * Rr) / (2 * LENS.p * EYE.lensPostRadius);
  const surf = (rho, anterior) => {
    const x = Math.min(1, rho / Rr), x2 = x * x, r = Math.sqrt(Math.max(0, 1 - x2));
    return anterior ? LENS.a * r * (1 + ca * x2) : -LENS.p * r * (1 + cp * x2);
  };
  const inside = (rho, z) => rho < Rr && z <= surf(rho, true) && z >= surf(rho, false);
  return phi => {
    const s = Math.sin(phi), c = Math.cos(phi);
    let lo = 0, hi = 7;
    for (let i = 0; i < 48; i++) { const m = 0.5 * (lo + hi); if (inside(m * s, m * c)) lo = m; else hi = m; }
    return 0.5 * (lo + hi);
  };
}
// Final outline: the polar radius B(phi) is smoothed around the equator (the living lens has a rounded
// equator, radius of curvature ~1 mm). The raw equator is enlarged beforehand so that after smoothing
// it lands on EYE.lensEquatorR again; poles, sags and apical radii are untouched.
const LENS_TAB = (() => {
  const N = 2048;
  const smoothTab = Rr => {
    const rawB = rawProfile(Rr);
    const B0 = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) B0[i] = rawB((i / N) * Math.PI);
    const B1 = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const phi = (i / N) * Math.PI;
      const sig = 0.11 * Math.exp(-(((phi - Math.PI / 2) / 0.42) ** 2));
      if (sig < 0.002) { B1[i] = B0[i]; continue; }
      const k = Math.ceil((3 * sig) / (Math.PI / N));
      let sw = 0, sv = 0;
      for (let j = -k; j <= k; j++) {
        const ii = Math.min(N, Math.max(0, i + j));
        const w = Math.exp(-0.5 * ((j * Math.PI / N) / sig) ** 2);
        sw += w; sv += w * B0[ii];
      }
      B1[i] = sv / sw;
    }
    let maxR = 0;
    for (let i = 0; i <= N; i++) maxR = Math.max(maxR, B1[i] * Math.sin((i / N) * Math.PI));
    return { B1, maxR };
  };
  let Rr = LENS.Re, res = smoothTab(Rr);
  for (let it = 0; it < 2; it++) { Rr *= LENS.Re / res.maxR; res = smoothTab(Rr); }
  const { B1, maxR } = res;
  const pts = [];
  for (let i = 0; i <= N; i++) { const phi = (i / N) * Math.PI; pts.push([B1[i] * Math.sin(phi), B1[i] * Math.cos(phi)]); }
  const sc = LENS.Re / maxR;               // residual (~1e-4)
  for (const p of pts) p[0] *= sc;
  // back to a polar table (monotonic in angle for a convex outline)
  const ang = pts.map(([r, z]) => Math.atan2(r, z)), rad = pts.map(([r, z]) => Math.hypot(r, z));
  const B = new Float64Array(N + 1);
  let k = 0;
  for (let i = 0; i <= N; i++) {
    const phi = (i / N) * Math.PI;
    while (k < N - 1 && ang[k + 1] < phi) k++;
    const f = Math.min(1, Math.max(0, (phi - ang[k]) / Math.max(1e-12, ang[k + 1] - ang[k])));
    B[i] = rad[k] + (rad[k + 1] - rad[k]) * f;
  }
  let iEq = 0; for (let i = 0; i <= N; i++) if (pts[i][0] > pts[iEq][0]) iEq = i;
  return { N, B, pts, iEq };
})();

export function lensB(phi) {
  const f = Math.min(LENS_TAB.N - 1e-6, Math.max(0, (phi / Math.PI) * LENS_TAB.N));
  const i = Math.floor(f), t = f - i;
  return LENS_TAB.B[i] * (1 - t) + LENS_TAB.B[i + 1] * t;
}
// z of the anterior / posterior face at radius rho (local lens frame).
export function lensSurfZ(rho, anterior) {
  const { pts, iEq, N } = LENS_TAB;
  rho = Math.min(rho, LENS.Re);
  if (anterior) {
    for (let i = 1; i <= iEq; i++) if (pts[i][0] >= rho) { const [r0, z0] = pts[i - 1], [r1, z1] = pts[i]; return z0 + (z1 - z0) * ((rho - r0) / Math.max(1e-9, r1 - r0)); }
    return pts[iEq][1];
  }
  for (let i = N - 1; i >= iEq; i--) if (pts[i][0] >= rho) { const [r0, z0] = pts[i + 1], [r1, z1] = pts[i]; return z0 + (z1 - z0) * ((rho - r0) / Math.max(1e-9, r1 - r0)); }
  return pts[iEq][1];
}
// Table for the shader, indexed by u = (1 - cos(phi)) / 2 (no trig on the GPU): B and dB/dcos(phi).
export function lensBTable(n = 256) {
  const out = new Float32Array((n + 1) * 2);
  const Bc = c => lensB(Math.acos(Math.max(-1, Math.min(1, c))));
  for (let i = 0; i <= n; i++) {
    const c = 1 - 2 * (i / n), e = 2e-3;
    const c0 = Math.max(-1, c - e), c1 = Math.min(1, c + e);
    out[i * 2] = Bc(c);
    out[i * 2 + 1] = (Bc(c1) - Bc(c0)) / (c1 - c0);
  }
  return out;
}
// Lens outline resampled at equal arc length: [{rho, z, nr, nz}] from anterior to posterior pole.
export function lensOutline(rows = 128) {
  const dense = [];
  const N = 4096;
  for (let i = 0; i <= N; i++) {
    const phi = (i / N) * Math.PI, b = lensB(phi);
    dense.push([b * Math.sin(phi), b * Math.cos(phi)]);
  }
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = cum[N];
  const out = [];
  let k = 0;
  for (let j = 0; j <= rows; j++) {
    const target = (j / rows) * total;
    while (k < N - 1 && cum[k + 1] < target) k++;
    const f = (target - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]);
    out.push({ rho: dense[k][0] + (dense[k + 1][0] - dense[k][0]) * f, z: dense[k][1] + (dense[k + 1][1] - dense[k][1]) * f });
  }
  out[0].rho = 0; out[rows].rho = 0;
  for (let j = 0; j <= rows; j++) {
    const a = out[Math.max(0, j - 1)], b = out[Math.min(rows, j + 1)];
    let tr = b.rho - a.rho, tz = b.z - a.z; const l = Math.hypot(tr, tz) || 1; tr /= l; tz /= l;
    out[j].nr = -tz; out[j].nz = tr;       // outward normal (curve runs clockwise in the (rho, z) plane)
  }
  out[0].nr = 0; out[0].nz = 1; out[rows].nr = 0; out[rows].nz = -1;
  return out;
}
// Point on the lens surface (world/eye frame) at radius rho on the anterior or posterior face.
export function lensSurfacePoint(rho, anterior, az, lift = 0) {
  const z = lensSurfZ(rho, anterior);
  // outward normal of the face: gradient of the implicit form
  const e = 1e-3;
  const dz = (lensSurfZ(rho + e, anterior) - lensSurfZ(rho - e, anterior)) / (2 * e);
  let nr = anterior ? -dz : dz, nz = anterior ? 1 : -1; const l = Math.hypot(nr, nz); nr /= l; nz /= l;
  const r = rho + nr * lift, zz = z + nz * lift;
  return new THREE.Vector3(r * Math.cos(az), r * Math.sin(az), LENS.z0 + zz);
}
export function lensPolarPoint(phi, az, lift = 0) {
  const b = lensB(phi) + lift;
  return new THREE.Vector3(b * Math.sin(phi) * Math.cos(az), b * Math.sin(phi) * Math.sin(az), LENS.z0 + b * Math.cos(phi));
}

// ------------------------------------------------------------------------------------------------
// CILIARY BODY. Meridional coordinate t = mm along the globe wall behind the scleral spur (measured on
// the outer scleral surface, like anatomyMath.behindLimbus / oraPolar). Depth = mm from the inner scleral
// wall towards the eye's interior, along a direction that leans radially inwards over the pars plicata
// (processes point at the lens equator) and follows the wall normal over the pars plana.
// ------------------------------------------------------------------------------------------------
export const CB = {
  N: EYE.ciliaryProcesses,             // 72 major processes
  theta0: LIMBUS_POLAR + 0.8 / RS,     // scleral spur: the ciliary body's anterior border, iris root in front
  tPlicata: EYE.parsPlicata,           // 2 mm pars plicata (corona ciliaris)
  tNose: 0.35,                         // rounding of the anterior face
};
CB.P = TAU / CB.N;

// Inner scleral wall (sclera thins from 0.8 mm at the limbus towards 0.5 mm at the equator), with a hair of clearance.
export function wallR(theta) {
  const k = clamp01((theta - LIMBUS_POLAR) / (Math.PI / 2 - LIMBUS_POLAR));
  return RS - (EYE.scleraThick.limbus + (EYE.scleraThick.equator - EYE.scleraThick.limbus) * k) - 0.04;
}
export const thetaAt = t => CB.theta0 + t / RS;
export function tOra(az) { return (oraPolar(az) - CB.theta0) * RS; }
export function tEndOuter(az) { return tOra(az) + 0.22; }
// Posterior border of the pars plana: the ora serrata, ~48 rounded bays of pars plana between the retinal teeth.
export function tEnd(az) {
  const x = az * 24 + 0.55 * Math.sin(az * 5 + 1.3) + 0.25 * Math.sin(az * 13 + 0.4);
  const bay = Math.pow(Math.abs(Math.sin(x)), 0.55);
  return tOra(az) - 0.1 + 0.28 * bay;
}

const R = rng(4417);
export const PROC = Array.from({ length: CB.N }, (_, i) => ({
  az: (i + 0.5) * CB.P + (R() - 0.5) * 0.16 * CB.P,
  h: 0.72 + 0.48 * R(),     // height variation between processes
  w: 0.9 + 0.2 * R(),       // width variation
  len: 0.85 + 0.3 * R(),    // how far back each ridge runs
  ph: R() * TAU, ph2: R() * TAU,
  rand: R(),
}));
export function procAz(i, t) { const p = PROC[((i % CB.N) + CB.N) % CB.N]; return p.az + 0.004 * Math.sin(t * 1.9 + p.ph) + (i >= CB.N ? TAU : i < 0 ? -TAU : 0); }
// Centre of the valley between process i and i+1 (where the zonules run).
export function valleyAz(i, t) { return 0.5 * (procAz(i, t) + procAz(i + 1, t)); }

// Base (valley-floor) thickness of the ciliary body, mm.
export function baseDepth(t, tE) {
  if (t <= 2.2) return 0.85 - 0.40 * sstep(0.2, 2.2, t);
  return 0.12 + 0.33 * (1 - sstep(2.2, tE, t));
}
// Height of the ciliary processes above the valley floor (heads anterior, fading into the pars plana).
export function procHeight(t, lenScale = 1) {
  return 0.54 * sstep(-0.25, 0.4, t) * Math.pow(1 - sstep(0.55, 0.55 + 1.8 * lenScale, t), 1.1);
}
// Thickness of the ciliary muscle wedge (outer part, against the sclera; tendon at the scleral spur).
export function muscleDepth(t) { return 0.74 * sstep(-0.12, 0.75, t) * Math.pow(1 - sstep(0.5, 4.6, t), 0.9); }

// Ridge field at (t, az): nearest process, its crest value m (0..1), minor plica value mn, and depth.
// Planform: a broad, clubbed head (widest ~0.5 mm behind the spur), a narrower body and a tapering tail.
// Cross-section: a super-ellipse, flat-topped and blunt on the head, a narrower rounded crest on the body.
// wScale narrows the planform (used on the anterior face so each head ends in a rounded dome).
const tmpRidge = { i: 0, u: 0, m: 0, mn: 0, depth: 0, crest: 0, head: 0 };
export function ridge(t, az, out = tmpRidge, wScale = 1) {
  const a = ((az % TAU) + TAU) % TAU;
  const i0 = Math.floor(a / CB.P);
  let best = 1e9, bi = 0;
  for (let di = -1; di <= 1; di++) {
    const i = (i0 + di + CB.N) % CB.N;
    const d = wrapPI(a - procAz(i, t)) / CB.P;
    if (Math.abs(d) < Math.abs(best)) { best = d; bi = i; }
  }
  const p = PROC[bi];
  const head = Math.exp(-(((t - 0.5) / 0.42) ** 2));
  const tail = sstep(0.9, 2.3, t);
  const u = best + 0.035 * Math.sin(t * 4 + p.ph) + 0.012 * Math.sin(t * 11 + p.ph2);
  const halfw = p.w * (0.29 + 0.17 * head - 0.07 * tail) * wScale;
  const x = Math.abs(u) / halfw;
  const q = 1.7 + 1.3 * head;
  // blunt super-elliptic crest with 2–3 low secondary folds across it (the plicae of each process)
  const m = x < 1 ? Math.pow(1 - Math.pow(x, q), 1.25) * (1 + 0.06 * Math.cos(Math.PI * 3 * (u / halfw) + t * 5 + p.ph)) : 0;
  const v = Math.abs(0.5 - Math.abs(best));
  const mn = v < 0.1 ? Math.cos((Math.PI / 2) * (v / 0.1)) * (1 - sstep(0.4, 1.5, t)) * (1 - 0.6 * head) : 0;
  const frill = 1 + 0.07 * Math.sin(t * 9 + p.ph) + 0.028 * Math.sin(t * 23 + p.ph2);
  const hp = procHeight(t, p.len) * (1 + 0.15 * head);
  out.i = bi; out.u = u; out.m = m; out.mn = mn; out.head = head;
  out.depth = hp * (p.h * m * frill + 0.28 * mn);
  out.crest = hp > 0.02 ? Math.min(1, m) * Math.min(1, hp / 0.3) : 0;
  return out;
}

// ------------------------------------------------------------------------------------------------
// Circumlental space. DMAX[t] is the largest depth at wall parameter t that still keeps CIRCUMLENTAL mm
// (exact meridional distance, which for a body of revolution is the 3-D distance) between the ciliary
// surface and the lens capsule. Every depth goes through clampDepth(), a polynomial smooth-min that is
// always <= min(d, DMAX), so no process can come closer to the lens than CIRCUMLENTAL, and the tallest
// heads are rounded off into blunt clubs instead of being truncated.
// ------------------------------------------------------------------------------------------------
export const CIRCUMLENTAL = 0.5;
const DM = (() => {
  const ol = lensOutline(384).map(p => [p.rho, p.z + LENS.z0]).filter(p => p[0] > 2.2);
  const dist = (rho, z) => {
    let best = 1e9;
    for (let i = 0; i < ol.length - 1; i++) {
      const [a0, b0] = ol[i], [a1, b1] = ol[i + 1];
      const dx = a1 - a0, dz = b1 - b0, l2 = dx * dx + dz * dz;
      let u = ((rho - a0) * dx + (z - b0) * dz) / l2; u = u < 0 ? 0 : u > 1 ? 1 : u;
      const ex = a0 + dx * u - rho, ez = b0 + dz * u - z, d = ex * ex + ez * ez;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const t0 = -0.3, dtT = 0.02, n = 166, tab = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const t = t0 + k * dtT;
    let lo = 0, hi = -1;
    for (let d = 0; d <= 3.6; d += 0.03) { if (dist(...merPoint(t, d)) < CIRCUMLENTAL) { hi = d; break; } lo = d; }
    if (hi < 0) { tab[k] = 9; continue; }
    for (let it = 0; it < 10; it++) { const m = 0.5 * (lo + hi); if (dist(...merPoint(t, m)) < CIRCUMLENTAL) hi = m; else lo = m; }
    tab[k] = lo;
  }
  return { t0, dtT, n, tab };
})();
export function dMaxAt(t) {
  const f = (t - DM.t0) / DM.dtT;
  if (f <= 0) return DM.tab[0];
  if (f >= DM.n - 1) return DM.tab[DM.n - 1];
  const i = Math.floor(f), w = f - i;
  return DM.tab[i] * (1 - w) + DM.tab[i + 1] * w;
}
export function clampDepth(t, d, k = 0.12) {
  const m = dMaxAt(t);
  const h = Math.max(k - Math.abs(d - m), 0) / k;
  return Math.min(d, m) - h * h * k * 0.25;
}
export function surfaceDepth(t, az, tE = tEnd(az)) { return clampDepth(t, baseDepth(t, tE) + ridge(t, az).depth); }

// Meridional point: returns [rho, z] for wall parameter t and depth d.
export function merPoint(t, d) {
  const th = thetaAt(t), r = wallR(th);
  const s = Math.sin(th), c = Math.cos(th);
  const w = 0.75 * (1 - sstep(0, 2.8, t));
  let dr = -s - w, dz = -c; const l = Math.hypot(dr, dz); dr /= l; dz /= l;
  return [r * s + dr * d, r * c + dz * d];
}
export function cbPoint(t, d, az, out = new THREE.Vector3()) {
  const [rho, z] = merPoint(t, d);
  return out.set(rho * Math.cos(az), rho * Math.sin(az), z);
}

// Rows of the closed meridional loop used by the ring mesh (and, minus the outer rows, the section caps).
// kind: 'nose' (anterior face), 'pl' (pars plicata), 'pp' (pars plana), 'end' (ora edge), 'out' (outer, on the sclera).
// band A (nose + pl) is meshed at high azimuthal resolution (process heads), band B at low resolution.
export function ciliaryRows() {
  const rows = [];
  const NN = 8, NI1 = 30, NI2 = 14, NE = 3, NO = 10;
  for (let k = 0; k < NN; k++) rows.push({ kind: 'nose', f: k / (NN - 1), band: 0 });
  for (let k = 1; k <= NI1; k++) rows.push({ kind: 'pl', f: k / NI1, band: 0 });
  for (let k = 1; k <= NI2; k++) rows.push({ kind: 'pp', f: k / NI2, band: 1 });
  for (let k = 1; k <= NE; k++) rows.push({ kind: 'end', f: k / NE, band: 1 });
  for (let k = 1; k <= NO; k++) rows.push({ kind: 'out', f: k / NO, band: 1 });
  return rows;
}
// Evaluate one loop row at azimuth az -> { t, d, side (0 outer .. 1 inner), crest, tE }
const rgTmp = { i: 0, u: 0, m: 0, mn: 0, depth: 0, crest: 0, head: 0 };
export function evalRow(row, az) {
  const tE = tEnd(az);
  let t, d, side = 1, crest = 0;
  if (row.kind === 'nose') {
    const psi = row.f * Math.PI / 2;
    const tc = CB.tNose;
    t = tc * (1 - Math.cos(psi));
    const sp = Math.sin(psi);
    const rg = ridge(tc, az, rgTmp, 0.55 + 0.45 * Math.pow(sp, 0.7));   // heads end in rounded domes
    d = clampDepth(t, (baseDepth(tc, tE) + rg.depth) * Math.pow(sp, 0.8));
    crest = rg.crest * sp;
    side = 1;
  } else if (row.kind === 'pl') {
    t = CB.tNose + (2.4 - CB.tNose) * Math.pow(row.f, 1.15);
    const rg = ridge(t, az, rgTmp);
    d = clampDepth(t, baseDepth(t, tE) + rg.depth); crest = rg.crest;
  } else if (row.kind === 'pp') {
    t = 2.4 + (tE - 2.4) * row.f;
    const rg = ridge(t, az, rgTmp);
    d = baseDepth(t, tE) + rg.depth; crest = rg.crest;
  } else if (row.kind === 'end') {
    // from the serrated inner border (ora bays) to a smooth outer border where the choroid takes over
    const e = row.f * Math.PI / 2;
    const dE = baseDepth(tE, tE);
    t = tE + (tEndOuter(az) - tE) * Math.sin(e);
    d = dE * Math.cos(e);
    side = 1 - row.f * 0.6;
  } else {
    t = tEndOuter(az) * (1 - row.f);
    d = 0; side = 0;
  }
  return { t, d, side, crest, tE };
}

// Invert merPoint: (rho, z) -> { t, d } (used to place landmarks such as the major arterial circle in the section).
export function merInverse(rho, z) {
  let bt = 0, bd = 0, be = 1e9;
  for (let t = -0.4; t <= 3; t += 0.02) for (let d = 0; d <= 2.5; d += 0.02) {
    const [r, zz] = merPoint(t, d); const e = (r - rho) ** 2 + (zz - z) ** 2;
    if (e < be) { be = e; bt = t; bd = d; }
  }
  for (let s = 0.01; s > 1e-4; s *= 0.5) for (let it = 0; it < 6; it++) for (const [a, b] of [[s, 0], [-s, 0], [0, s], [0, -s]]) {
    const [r, zz] = merPoint(bt + a, bd + b); const e = (r - rho) ** 2 + (zz - z) ** 2;
    if (e < be) { be = e; bt += a; bd += b; }
  }
  return { t: bt, d: bd, err: Math.sqrt(be) };
}
