// Ciliary arteries of the sclera.
//  - Anterior ciliary arteries: 7 (2 superior, 2 medial, 2 inferior, 1 lateral rectus) leave the rectus insertions,
//    run forward in the episclera, give the episcleral arterial circle and the limbal arcades, and perforate the
//    sclera 2–4 mm behind the limbus towards the major arterial circle of the iris.
//  - Posterior ciliary arteries: the medial and lateral trunks divide beside the nerve into ~15 short PCAs that
//    pierce the sclera in a ring around the nerve (paraoptic ones forming the circle of Zinn–Haller), and the two
//    long PCAs that pierce nasal and temporal of the nerve and run forward in the suprachoroidal space along the
//    horizontal meridian to the ciliary body, where each divides to join the major arterial circle.
import * as THREE from 'three';
import { EYE, L } from '../../config.js';
import * as am from '../../lib/anatomyMath.js';
import { nerveFrame, discFrame, scleralForamina } from './landmarks.js';
import { PathSet, spline, radiiArray, lerp, smoothstep, meander, polyLength } from './util.js';

const Rs = L.scleraOuterR;
const S = (d, az, r) => am.behindLimbus(d, az, r);
const rhoAt = d => Rs * Math.sin(am.LIMBUS_POLAR + d / Rs); // circumferential radius at d mm behind the limbus
const nearestIndex = (pts, q) => { let bi = 0, bd = 1e9; pts.forEach((p, i) => { const d = p.distanceToSquared(q); if (d < bd) { bd = d; bi = i; } }); return bi; };

// A vessel described in (d behind limbus, azimuth offset in mm) with tortuosity.
function dazPath({ d0, d1, az0, driftMM = 0, wig = 0.22, wl = 1.8, seed, r = () => Rs + 0.05, step = 0.07, azOf = null }) {
  const n = Math.max(2, Math.ceil(Math.abs(d1 - d0) / step));
  const m = meander(seed), m2 = meander(seed + 17);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, d = lerp(d0, d1, t);
    const s = Math.abs(d - d0);
    const lateral = driftMM * t + wig * (m(s * 6.28 / wl) - m(0) + 0.35 * (m2(s * 6.28 / (wl * 0.37)) - m2(0)));
    const az = azOf ? azOf(t, d) : az0 + lateral / rhoAt(d);
    pts.push(S(d, az, r(t, d)));
  }
  return pts;
}
// A vessel running circumferentially at roughly constant depth behind the limbus.
function arcPath({ d0, d1, az0, az1, wig = 0.15, wl = 1.6, seed, r = () => Rs + 0.05, step = 0.07, pin = false }) {
  const len = Math.abs(az1 - az0) * rhoAt((d0 + d1) / 2);
  const n = Math.max(2, Math.ceil(len / step));
  const m = meander(seed), m2 = meander(seed + 5);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = t * len;
    const d = lerp(d0, d1, smoothstep(0, 1, t)) + wig * (m(s * 6.28 / wl) - m(0) + 0.3 * (m2(s * 6.28 / (wl * 0.41)) - m2(0))) * (pin ? 1 - smoothstep(0.65, 1, t) : 1);
    pts.push(S(d, lerp(az0, az1, t), r(t, d)));
  }
  return pts;
}

export function buildAnteriorCiliary({ rng, dist0 = 60 }) {
  const set = new PathSet();
  const acas = [];
  const F = scleralForamina();
  const dOfP = p => (Math.acos(p.z / p.length()) - am.LIMBUS_POLAR) * Rs;
  let seed = 100;
  for (const pit of F.aca) {
    const { name } = pit;
    const ins = am.rectusInsertion(name), m = EYE.recti[name];
    const o = pit.off === 0 ? 0.06 : Math.sign(pit.off) * 0.27;   // across the tendon, converging on its pit
    const across = o * m.width;
    const dIns = m.fromLimbus + 1.1 * (2 * o) ** 2;              // tendon edge (the chord lies further back at the sides)
    const az0 = ins.azimuth + across / rhoAt(dIns);
    const dPerf = pit.d, azP = pit.az;                           // perforates through the globe module's foramen
    const dStart = dIns + 4.5;
    // gentle, low-frequency meander (wl 3.5–5 mm, ~0.07 mm), zero at both ends so the course lands in the pit
    const wl = 3.5 + 1.5 * rng(), wig = 0.1 + 0.05 * rng();
    const mA = meander(seed++), mB = meander(seed++);
    const n = Math.max(2, Math.ceil((dStart - dPerf) / 0.06));
    const main = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, d = lerp(dStart, dPerf, t), s = dStart - d;
      const w = wig * (mA(s * 6.28 / wl) - mA(0) + 0.15 * (mB(s * 6.28 / (wl * 0.45)) - mB(0))) * Math.sin(Math.PI * t);
      const az = lerp(az0, azP, smoothstep(0.1, 0.92, t)) + w / rhoAt(d);
      const rr = lerp(0.075, 0.055, t);
      // under the tendon, then surfacing in the episclera just ahead of the tendon's leading edge
      // on the scleral surface (episclera), so it stays under the tendon however thin its leading edge is
      main.push(S(d, az, Rs + 0.015 + 0.4 * rr));
    }
    // perforating branch: dives through the foramen towards the ciliary body (major arterial circle)
    const P = main[main.length - 1];
    const perf = spline([P, S(dPerf - 0.08, azP, Rs - 0.12), S(dPerf - 0.4, azP, Rs - 0.5), S(dPerf - 0.8, azP, Rs - 0.95), S(dPerf - 0.9, azP, Rs - 1.25)], 0.06);
    const pts = main.concat(perf.slice(1));
    const Lmain = polyLength(main), Ltot = polyLength(pts);
    const aca = set.add(pts, radiiArray(u => { const s = u * Ltot; return s < Lmain ? lerp(0.075, 0.055, s / Lmain) : lerp(0.055, 0.045, (s - Lmain) / (Ltot - Lmain)); }, 24), 0.45 * 0.3,
      {
        dist0: dist0 + rng() * 2, tag: `aca-${name}-${pit.c}`,
        // emerges from under the tendon: fully sunk (faded) under it, clearing over the first ~0.5 mm in the open
        fadeFn: (c, s, base) => lerp(base, 0.8, smoothstep(dIns - 0.55, dIns + 0.35, dOfP(c))),
      });
    acas.push({ path: aca, perfIdx: main.length - 1, az: azP, dPerf, name, dIns });

    // a few recurrent episcleral twigs off the main trunk, running back over the insertion zone
    for (let j = 0; j < 2; j++) {
      const at = Math.floor(main.length * (0.5 + 0.22 * j + rng() * 0.1));
      const Q = main[at], qAz = Math.atan2(Q.y, Q.x), dq = dOfP(Q);
      const side = j === 0 ? -1 : 1;
      const tw = dazPath({ d0: dq, d1: dq + 1.4 + rng() * 1.8, az0: qAz, driftMM: side * (1.0 + rng()), wig: 0.07, wl: 2.4, seed: seed++, r: () => Rs + 0.022 });
      tw[0] = Q.clone();
      set.add(tw, radiiArray(u => lerp(0.022, 0.013, u), 6), 0.45 * 0.55, { parent: aca, at });
    }
  }

  // episcleral arterial circle + forward twigs to the limbal arcade
  acas.sort((a, b) => ((a.az + 2 * Math.PI) % (2 * Math.PI)) - ((b.az + 2 * Math.PI) % (2 * Math.PI)));
  const arcadeFeeds = [];
  const wrap = x => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // one meeting point per gap between neighbouring ACAs; ~25% of the gaps stay open (the circle is incomplete)
  const meet = acas.map((a, i) => {
    const next = acas[(i + 1) % acas.length], gap = wrap(next.az - a.az);
    return { az: a.az + gap * (0.38 + 0.24 * rng()), d: 2.4 + 1.8 * rng(), open: rng() < 0.35, gap };
  });
  acas.forEach((a, i) => {
    const at = Math.max(1, a.perfIdx - 3);
    const Q = a.path.points[at];
    const dQ = (Math.acos(Q.z / Q.length()) - am.LIMBUS_POLAR) * Rs;
    for (const sgn of [1, -1]) {
      const M = sgn > 0 ? meet[i] : meet[(i + acas.length - 1) % acas.length];
      const azTo = sgn > 0 ? M.az : M.az - 2 * Math.PI * (M.az > a.az + 1e-6 ? 1 : 0);
      let span = wrap(sgn * (azTo - a.az));
      if (span > Math.PI) span -= 2 * Math.PI;
      const reach = M.open ? 0.55 + 0.25 * rng() : 1.0;
      const circ = arcPath({ d0: dQ, d1: lerp(dQ, M.d, reach), az0: a.az, az1: a.az + sgn * Math.abs(span) * reach, wig: 0.3, wl: 2.2 + rng() * 1.6, seed: 400 + i * 7 + (sgn > 0 ? 1 : 0), r: () => Rs + 0.045, pin: !M.open });
      circ[0] = Q.clone();
      const c = set.add(circ, radiiArray(u => lerp(0.03, 0.017, u), 10), 0.45 * (0.6 + 0.3 * rng()), { parent: a.path, at });
      // forward twigs to the limbus (feeding the limbal arcade) and back twigs (anterior conjunctival arteries)
      const nF = 1 + Math.floor(rng() * 2.2);
      for (let j = 0; j < nF; j++) {
        const u = (j + 0.25 + rng() * 0.6) / nF;
        const ci = Math.floor(u * (circ.length - 1));
        const C = circ[ci], cAz = Math.atan2(C.y, C.x), cD = (Math.acos(C.z / C.length()) - am.LIMBUS_POLAR) * Rs;
        const fwd = dazPath({ d0: cD, d1: 0.75 + rng() * 0.25, az0: cAz, driftMM: (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 1.1), wig: 0.06, wl: 1.7, seed: 700 + i * 31 + j * 3 + (sgn > 0 ? 1 : 0), r: () => Rs + 0.06 });
        const f = set.add(fwd, radiiArray(u2 => lerp(0.018, 0.011, u2), 6), 0.45 * (0.6 + 0.35 * rng()), { parent: c, at: ci });
        arcadeFeeds.push({ path: f, az: Math.atan2(fwd[fwd.length - 1].y, fwd[fwd.length - 1].x) });
        if (rng() < 0.35) {
          const back = dazPath({ d0: cD, d1: cD + 2.5 + rng() * 3.5, az0: cAz, driftMM: (rng() - 0.5) * 2.0, wig: 0.08, wl: 2.2, seed: 900 + i * 31 + j * 3 + (sgn > 0 ? 1 : 0), r: () => Rs + 0.065 });
          set.add(back, radiiArray(u2 => lerp(0.017, 0.01, u2), 6), 0.45 * (0.6 + 0.35 * rng()), { parent: c, at: ci });
        }
      }
    }
    // direct forward twigs from the ACA just before it perforates
    for (let j = 0; j < 1; j++) {
      const at2 = Math.max(1, a.perfIdx - 1 - j * 5);
      const C = a.path.points[at2], cAz = Math.atan2(C.y, C.x), cD = (Math.acos(C.z / C.length()) - am.LIMBUS_POLAR) * Rs;
      const fwd = dazPath({ d0: cD, d1: 0.8 + rng() * 0.2, az0: cAz, driftMM: (j ? 1 : -1) * (0.4 + rng() * 0.6), wig: 0.05, wl: 1.6, seed: 1300 + i * 5 + j, r: () => Rs + 0.06 });
      const f = set.add(fwd, radiiArray(u2 => lerp(0.022, 0.012, u2), 6), 0.45 * (0.5 + 0.3 * rng()), { parent: a.path, at: at2 });
      arcadeFeeds.push({ path: f, az: Math.atan2(fwd[fwd.length - 1].y, fwd[fwd.length - 1].x) });
    }
  });

  // limbal arcade: overlapping arcs fed by the forward twigs, ~0.8 mm behind the limbus, all the way round
  const arcade = [];
  for (const [i, f] of arcadeFeeds.entries()) {
    const end = f.path.points[f.path.points.length - 1];
    const dE = (Math.acos(end.z / end.length()) - am.LIMBUS_POLAR) * Rs;
    for (const sgn of [-1, 1]) {
      if (rng() < 0.3) continue;   // the arcade is patchy, not a drawn circle
      const span = (0.1 + rng() * 0.1) * sgn;
      const arc = arcPath({ d0: dE, d1: 0.7 + rng() * 0.35, az0: f.az, az1: f.az + span, wig: 0.06, wl: 0.8, seed: 2000 + i * 2 + (sgn > 0 ? 1 : 0), r: () => Rs + 0.06 });
      arc[0] = end.clone();
      const ap = set.add(arc, radiiArray(u => lerp(0.011, 0.0075, u), 4), 0.45 * (0.5 + 0.4 * rng()), { parent: f.path, at: f.path.points.length - 1 });
      arcade.push(ap);
    }
  }
  return { paths: set.paths, acas, arcade };
}

export function buildPosteriorCiliary({ rng, lat, med }) {
  const nf = nerveFrame();
  const set = new PathSet();
  const disc = discFrame(Rs);
  const sh = nf.sheathR;
  const out = { zhPoints: [] };

  // trunks from the seams to their division points beside the nerve, ~3 mm behind the globe
  const trunks = [
    { side: -1, seam: lat, from: lat.point, div: nf.off(3.0, -(sh + 0.55), 0.15), ctrl: [nf.off(6.0, -(sh + 0.45), 0.35), nf.off(4.4, -(sh + 0.5), 0.2)] },
    { side: 1, seam: med, from: med.point, div: nf.off(3.2, sh + 0.55, 0.3), ctrl: [nf.off(6.4, sh + 0.45, 0.35), nf.off(4.6, sh + 0.5, 0.3)] },
  ];
  for (const T of trunks) {
    const pts = spline([T.from, ...T.ctrl, T.div], 0.08);
    T.path = set.add(pts, radiiArray(u => lerp(0.2, 0.17, u), 8), 0, { dist0: T.seam.dist, tag: T.side < 0 ? 'lpca-trunk' : 'mpca-trunk' });
  }

  // Zinn–Haller ring: intrascleral, around the nerve at the level of the lamina
  const zhR = { h: 1.45, v: 1.58 }, zhDepth = Rs - 0.55;
  const zhAt = a => disc.c.clone().addScaledVector(disc.tx, Math.cos(a) * zhR.h).addScaledVector(disc.ty, Math.sin(a) * zhR.v).normalize().multiplyScalar(zhDepth);

  // short posterior ciliary arteries: one through each of the 16 foramina the globe module draws around the canal
  const F = scleralForamina();
  const spcas = [];
  const mk = (T, pit, para) => {
    const { a, dist } = pit;
    // short, tortuous: forward along the sheath from the division point, then out over the sclera to its foramen,
    // straight down the foramen, then obliquely through the inner sclera into the choroid
    const entry = F.around(a, dist, Rs + 0.13);
    const hole = F.around(a, dist, Rs - 0.12);
    const inS = F.around(a, dist + 0.28, Rs - 0.36);
    const deep = F.around(a, dist + 0.5, Rs - 0.6);
    const bSheath = 0.9 + 1.2 * rng();
    const hug = nf.ring(bSheath, a, sh + 0.16 + 0.1 * rng());           // beside the sheath (both frames: 0 = nasal, PI/2 = superior)
    const hug2 = F.around(a, sh + 0.35, Rs + 0.28 + 0.12 * rng());
    const mid = hug2.clone().lerp(entry, 0.5).normalize().multiplyScalar(Rs + 0.22 + 0.1 * rng());
    mid.add(new THREE.Vector3().crossVectors(mid.clone().normalize(), entry.clone().sub(hug2)).normalize().multiplyScalar((rng() - 0.5) * 0.35));
    const ctrl = [T.div.clone(), T.div.clone().lerp(hug, 0.55), hug, hug2, mid, entry, hole, inS, deep];
    const pts = spline(ctrl, 0.05);
    const p = set.add(pts, radiiArray(u => lerp(0.08, 0.058, u) * (1 - 0.5 * smoothstep(0.88, 1, u)), 14), 0, { parent: T.path, at: T.path.points.length - 1, tag: 'spca' });
    spcas.push({ path: p, a, para, inIdx: nearestIndex(pts, inS), entry: F.around(a, dist, Rs + 0.1) });
    return p;
  };
  for (const pit of F.spca) mk(Math.cos(pit.a) > 0 ? trunks[1] : trunks[0], pit, pit.dist < 3.45);
  out.spcaEntries = spcas.map(s => s.entry);
  // paraoptic SPCAs send an intrascleral branch to the Zinn–Haller ring
  const para = spcas.filter(s => s.para);
  for (const s of para) {
    const start = s.path.points[s.inIdx];
    const ctrl = [start, start.clone().lerp(zhAt(s.a), 0.5).normalize().multiplyScalar(zhDepth + 0.05), zhAt(s.a)];
    set.add(spline(ctrl, 0.05), radiiArray(u => lerp(0.05, 0.036, u), 4), 0, { parent: s.path, at: s.inIdx });
  }
  // the ring itself (closed), starting at the first paraoptic junction; slightly wavy
  {
    const a0 = para[0].a, pts = [];
    const n = 160;
    const m = meander(77);
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      const w = 1 + 0.09 * m(a * 3) + 0.04 * Math.sin(a * 7 + 1.1);
      pts.push(disc.c.clone().addScaledVector(disc.tx, Math.cos(a) * zhR.h * w).addScaledVector(disc.ty, Math.sin(a) * zhR.v * w).normalize().multiplyScalar(zhDepth));
    }
    set.add(pts, 0.034, 0, { dist0: polyLength(para[0].path.points) + para[0].path.dist0, tag: 'zinn-haller' });
  }

  // long posterior ciliary arteries (nasal from the medial trunk, temporal from the lateral trunk)
  const dEnd = 3.3;
  const omegaEnd = Math.PI - (am.LIMBUS_POLAR + dEnd / Rs);
  const toMap = p => { const n = p.clone().normalize(); const w = Math.acos(THREE.MathUtils.clamp(-n.z, -1, 1)); const a = Math.atan2(n.y, n.x); return new THREE.Vector2(Math.cos(a) * w, Math.sin(a) * w); };
  const fromMap = (v, r) => { const w = v.length(), a = Math.atan2(v.y, v.x); return am.fromAnterior(Math.PI - w, a, r); };
  for (const [T, pit, sign] of [[trunks[1], F.lpca[0], 1], [trunks[0], F.lpca[1], -1]]) {
    const pierce = pit.dir.clone().multiplyScalar(Rs + 0.12);        // the globe module's oval LPCA foramen
    const q = toMap(pierce);
    const end = new THREE.Vector2(sign * omegaEnd, sign > 0 ? 0.004 : -0.002);
    const n = 260;
    const m = meander(sign > 0 ? 501 : 502);
    const path = [];
    // approach from the division point to the pierce site
    const approach = spline([T.div.clone(), T.div.clone().lerp(pierce, 0.5).normalize().multiplyScalar(Rs + 0.9), pierce], 0.08);
    let travelled = 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const v = new THREE.Vector2().lerpVectors(q, end, t);
      v.y += 0.036 * (m(t * 6.5) - m(0) * (1 - t)) * Math.sin(Math.PI * Math.min(1, t * 1.15));   // ~0.4 mm, low-frequency
      const s = t * (end.clone().sub(q).length() * Rs);
      const r = s < 3.2 ? lerp(Rs + 0.12, L.scleraInnerR - 0.06, smoothstep(0, 3.2, s)) : L.scleraInnerR - 0.06 - 0.25 * smoothstep(0.93, 1, t);
      path.push(fromMap(v, r));
    }
    const pts = approach.concat(path);
    const Lt = polyLength(pts);
    // (fract(kind) only lowers its glow: the LPCA lies deep, in the suprachoroidal space; its colour is unchanged)
    const lp = set.add(pts, radiiArray(u => lerp(0.115, 0.085, u), 12), 0.45 * 0.9, { parent: T.path, at: T.path.points.length - 1, tag: sign > 0 ? 'lpca-nasal' : 'lpca-temporal' });
    // terminal division towards the major arterial circle of the iris (in the ciliary body)
    const E = pts[pts.length - 1];
    const eAz = Math.atan2(E.y, E.x);
    for (const s2 of [-1, 1]) {
      const arc = arcPath({ d0: dEnd, d1: 2.3, az0: eAz, az1: eAz + s2 * 0.95, wig: 0.08, wl: 2.2, seed: 600 + (sign > 0 ? 0 : 2) + (s2 > 0 ? 1 : 0), r: () => L.scleraInnerR - 0.32 });
      arc[0] = E.clone();
      set.add(arc, radiiArray(u => lerp(0.07, 0.045, u), 8), 0.45 * 0.9, { parent: lp, at: pts.length - 1 });
    }
  }
  return { paths: set.paths, spcaEntries: out.spcaEntries };
}
