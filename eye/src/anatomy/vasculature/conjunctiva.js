// Bulbar conjunctival vessels: posterior conjunctival arteries and the (more numerous, wider) conjunctival veins
// enter from the fornix and branch towards the limbus in a fine tortuous net, denser near the fornix and thinning
// towards the cornea; at the limbus a ring of radial capillary loops (palisades of Vogt, most marked above and below).
import * as THREE from 'three';
import { L } from '../../config.js';
import * as am from '../../lib/anatomyMath.js';
import { colonize, poissonSphere, bandSampler, pruneLeaves, murray, extractChains, chainsToDense } from './sc.js';
import { PathSet, spline, radiiArray, lerp, smoothstep, meander, tangentize, cumLengths, Grid3 } from './util.js';

export const CONJ_R = L.scleraOuterR + 0.08;
// display calibres (mm radius); real: posterior conjunctival arteries ~15–25 µm, veins ~20–40 µm, palisade loops ~2.5–4 µm
export const CONJ_CAL = { art: 0.03, vein: 0.042, artFloor: 0.0115, veinFloor: 0.0125, pal: 0.0056 };

export function buildConjunctival({ rng, dist0 = 40, arcade = [] }) {
  const Rs = L.scleraOuterR;
  const R = CONJ_R;
  const D = 0.16;
  const LP = am.LIMBUS_POLAR;
  const dOf = pU => (Math.acos(THREE.MathUtils.clamp(pU.z, -1, 1)) - LP) * Rs;   // mm behind the limbus
  const S = (d, az, r = R) => am.behindLimbus(d, az, r);
  const dFornix = 12.4;
  // posterior extent of the conjunctiva, per azimuth (same law as the globe module's membrane: shorter nasally)
  const lenAt = az => 12.0 - 1.1 * Math.cos(az) + 0.25 * Math.sin(3 * az + 1.3);
  // exposure: the interpalpebral (nasal / temporal) bulbar conjunctiva carries the visible vessels; the sectors
  // under the lids (vertical meridian) are sparser and finer
  const horizOf = az => Math.pow(Math.abs(Math.cos(az)), 1.2);

  const seeds = [];
  // dominant vessels: a few long, gently wavy radial trunks in the nasal and temporal interpalpebral zones
  const dom = [];
  for (const side of [0, Math.PI]) {
    const n = 4;
    for (let k = 0, tries = 0; k < n && tries < 60; tries++) {
      const az = side + (rng() - 0.5) * 1.3;                      // within ~±37° of the horizontal meridian
      if (dom.some(v => Math.abs(Math.atan2(Math.sin(v.az - az), Math.cos(v.az - az))) < 0.13)) continue;
      dom.push({ az, tree: rng() < 0.35 ? 0 : 1 }); k++;
    }
  }
  for (const v of dom) {
    const e = lenAt(v.az) - 0.12, d1 = 2.2 + 2.2 * rng();
    const m = meander(8000 + Math.round(v.az * 100)), m2 = meander(8100 + Math.round(v.az * 100));
    const wl = 2.4 + 1.8 * rng(), amp = 0.28 + 0.2 * rng(), drift = (rng() - 0.5) * 1.6;
    const pts = [];
    for (let d = e; d > d1; d -= D) {
      const s = e - d, u = s / Math.max(1, e - d1);
      const lat = (amp * (m(s * 6.28 / wl) - m(0) + 0.35 * (m2(s * 6.28 / (wl * 0.45)) - m2(0))) + drift * u * u) * smoothstep(0, 1.2, s);
      pts.push(S(d, v.az + lat / (Rs * Math.sin(LP + d / Rs)), R));
    }
    seeds.push({ pts, tree: v.tree, group: 0, noBranch: k => k < 3, az: v.az, boost: 1.9 + 0.6 * rng(), dominant: true });
  }
  // ordinary roots at the fornix, arteries and veins interleaved around the circumference
  const nA = 14, nV = 12;
  for (const [tree, n] of [[0, nA], [1, nV]]) {
    for (let i = 0; i < n; i++) {
      const az = (i + (tree ? 0.5 : 0) + (rng() - 0.5) * 0.7) / n * Math.PI * 2;
      if (dom.some(v => Math.abs(Math.atan2(Math.sin(v.az - az), Math.cos(v.az - az))) < 0.12)) continue;
      const e = lenAt(az) - 0.12;   // vessels are cut with the membrane at its free (fornix) edge
      const pts = [S(e, az, R), S(e - 0.3, az, R), S(e - 0.6, az, R)];
      // heavy-tailed calibre: a few are much larger than the rest
      const boost = tree ? 0.7 + 1.2 * Math.pow(rng(), 3) : 0.75 + 0.8 * Math.pow(rng(), 3);
      seeds.push({ pts, tree, group: 0, noBranch: () => true, az, boost });
    }
  }
  // attractors: denser towards the fornix, sparse near the limbus, none in the clear limbal band, sparser under the lids
  const spacing = scale => pU => {
    const d = dOf(pU), az = Math.atan2(pU.y, pU.x);
    if (d < 2.0 || d > lenAt(az) - 0.5) return 0;
    const lid = 1 + 0.6 * (1 - horizOf(az));
    return scale * lid * (d > 6.5 ? lerp(0.7, 0.6, smoothstep(6.5, 11, d)) : lerp(1.4, 0.7, smoothstep(2.0, 6.5, d)));
  };
  const band = bandSampler(LP + 1.5 / Rs, LP + (dFornix - 0.1) / Rs);
  const attractors = [];
  for (const tree of [0, 1]) {
    const pts = poissonSphere({ R, count: 5200, tries: 10, rand: rng, sample: band, spacing: spacing(tree ? 1.2 : 1.12), cell: 1.0 });
    for (const a of pts) attractors.push({ p: a.p, tree, group: 0 });
  }
  const kSp = spacing(1.0);
  const tmp = new THREE.Vector3();
  const sc = colonize({
    R, seeds, attractors, rand: rng, di: 1.9, dk: p => 0.8 * (kSp(tmp.copy(p).normalize()) || 0.6), dkCross: 0.16, D,
    inertia: 1.35, splitAngle: 0.95, sideAngle: 0.55, minSpacing: 0.55, maxTurn: 0.22, maxIter: 400,
    sideLean: 0.6, sideBack: -0.3,
    spanOf: (n, r) => 0.8 + 1.4 * r(),
    allow: p => { const q = tmp.copy(p).normalize(); const d = dOf(q); return d > 1.5 && d < lenAt(Math.atan2(q.y, q.x)) - 0.1; },
  });
  const nodes = sc.nodes;
  pruneLeaves(nodes, 0.6);
  murray(nodes, 3);
  const roots = seeds.map(s => s.first);
  const rootOf = new Int32Array(nodes.length);
  for (const n of nodes) rootOf[n.i] = n.parent < 0 ? n.i : rootOf[n.parent];
  const seedOf = new Map(seeds.map(s => [s.first, s]));
  let mxA = 0, mxV = 0;
  for (const s of seeds) { const n = nodes[s.first]; if (n.tree) mxV = Math.max(mxV, n.rm); else mxA = Math.max(mxA, n.rm); }
  const rOf = n => {
    const top = n.tree ? mxV : mxA, cal = n.tree ? CONJ_CAL.vein : CONJ_CAL.art, fl = n.tree ? CONJ_CAL.veinFloor : CONJ_CAL.artFloor;
    return Math.max(fl, cal * Math.pow(n.rm / top, 0.95) * seedOf.get(rootOf[n.i]).boost);
  };
  const chains = extractChains(nodes, roots);
  const dense = chainsToDense(nodes, chains, { rOf, every: 4, spacing: 0.05, tailMaxTurn: 0.6 });

  const set = new PathSet();
  let seed = 3000;
  const nodeDisp = new Map();   // node id -> displacement applied to the chain that owns it (forks inherit it)
  for (const d of dense) {
    const inherit = d.fork ? nodeDisp.get(d.ids[0]) : null;
    const sd = seedOf.get(rootOf[d.ids[1]]);
    // tortuosity: fine vessels meander more; displacement in the tangent plane, perpendicular to the course
    const m = meander(seed++), m2 = meander(seed++);
    const cl = cumLengths(d.pts);
    const wl = (sd.dominant ? 1.2 : 0.6) + rng() * 0.5;
    const n = d.pts.length;
    const moved = d.pts.map((p, i) => {
      const a = d.pts[Math.max(0, i - 1)], b = d.pts[Math.min(n - 1, i + 1)];
      const nrm = p.clone().normalize();
      const t = tangentize(b.clone().sub(a), nrm).normalize();
      const side = new THREE.Vector3().crossVectors(nrm, t);
      const thin = 1 - smoothstep(0.012, 0.04, d.rads[i]);
      const amp = (0.022 + 0.055 * thin) * smoothstep(0, 0.4, cl[i]) * smoothstep(0, 0.3, cl[n - 1] - cl[i] + (d.ids && nodes[d.ids[d.ids.length - 1]].kids.length ? 0 : 0.3));
      const s = cl[i];
      const off = amp * (m(s * 6.28 / wl) - m(0) + 0.35 * (m2(s * 6.28 / (wl * 0.43)) - m2(0)));
      const q = p.clone().addScaledVector(side, off);
      if (inherit) q.addScaledVector(inherit, 1 - smoothstep(0, 0.45, s));
      const depth = d.tree ? -0.012 : 0;         // veins sit a touch deeper in the stroma
      return q.normalize().multiplyScalar(R + depth);
    });
    // remember where this chain's nodes ended up so that its side branches start exactly on it
    let j = 0;
    for (const id of d.ids) {
      const np = nodes[id].p;
      let bd = np.distanceToSquared(d.pts[j]);
      while (j < n - 1 && np.distanceToSquared(d.pts[j + 1]) <= bd) { j++; bd = np.distanceToSquared(d.pts[j]); }
      if (!nodeDisp.has(id)) nodeDisp.set(id, moved[j].clone().normalize().multiplyScalar(R).sub(d.pts[j].clone().normalize().multiplyScalar(R)));
    }
    const mid = moved[Math.floor(n / 2)], az = Math.atan2(mid.y, mid.x);
    const horiz = horizOf(az);
    const r = Array.from(d.rads).map(x => x * (0.5 + 0.5 * horiz));
    const nn = r.length, k = Math.min(nn - 1, 6);
    for (let i = 0; i < k; i++) r[nn - 1 - i] *= 0.6 + 0.4 * (i / k);
    // heavy-tailed visibility: the few large vessels read clearly, most fine twigs sit deep in the membrane (30–50%)
    const big = smoothstep(0.012, 0.035, r[0]);
    // (fine twigs are drawn a little wider but much paler: a soft pink trace in the membrane, not a crisp crack)
    let fade = sd.dominant && !d.fork ? 0.05 + 0.1 * rng() : lerp(0.72 + 0.26 * rng(), 0.2 + 0.25 * rng(), big);
    fade = THREE.MathUtils.clamp(fade + 0.32 * (1 - horiz), 0, 1);
    set.add(moved, r, d.tree + 0.45 * fade, { dist0: dist0 + d.dist0, cap0: !d.fork });
  }

  // anastomoses: a minority (~18%) of terminal twigs merge into a near-parallel neighbour at a shallow angle
  {
    const vessels = set.paths.slice();
    const grid = new Grid3(0.5);
    vessels.forEach((v, vi) => v.points.forEach((p, si) => { if (si % 2 === 0) grid.add(vi * 65536 + si, p.x, p.y, p.z); }));
    vessels.forEach((v, vi) => {
      if (rng() > 0.18) return;
      const pts = v.points, n = pts.length;
      if (n < 8) return;
      const tip = pts[n - 1], dir = tip.clone().sub(pts[n - 6]).normalize();
      if (dOf(tip.clone().normalize()) < 2.2) return;
      let best = null, bd = 0.55, bIdx = -1, bOwner = -1;
      grid.each(tip.x, tip.y, tip.z, 0.55, id => {
        const qi = Math.floor(id / 65536), qs = id % 65536;
        if (qi === vi) return;
        const qp = vessels[qi].points;
        const q = qp[qs];
        const dv = q.clone().sub(tip); const d = dv.length();
        if (d < 0.1 || d > bd) return;
        const qt = qp[Math.min(qp.length - 1, qs + 2)].clone().sub(qp[Math.max(0, qs - 2)]).normalize();
        if (Math.abs(qt.dot(dir)) < 0.72) return;            // only near-parallel neighbours
        if (dv.dot(dir) / d < 0.5) return;                    // ahead of the tip
        best = q; bd = d; bIdx = qs; bOwner = qi;
      });
      if (!best) return;
      const qp = vessels[bOwner].points;
      const qt = qp[Math.min(qp.length - 1, bIdx + 2)].clone().sub(qp[Math.max(0, bIdx - 2)]).normalize();
      if (qt.dot(dir) < 0) qt.negate();
      const c1 = tip.clone().addScaledVector(dir, bd * 0.4), c2 = best.clone().addScaledVector(qt, -bd * 0.4);
      const bez = new THREE.CubicBezierCurve3(tip, c1, c2, best);
      const ext = bez.getSpacedPoints(Math.max(3, Math.ceil(bez.getLength() / 0.05))).slice(1).map(p => p.normalize().multiplyScalar(R + (v.kind >= 1 && v.kind < 2 ? -0.012 : 0)));
      const r = v.radii, rt = r[r.length - 1];
      v.points = pts.concat(ext);
      const k = Math.round(r.length * ext.length / n) + 1;
      v.radii = r.concat(Array(k).fill(rt));
    });
  }

  // palisades of Vogt: short radial hairpin capillary loops fed by the limbal arterial arcade (anterior ciliary part)
  // and draining into a patchy limbal venous ring just behind it. Irregular spacing with gaps; most marked above
  // and below. They are an inspect-scale detail (kind 2: the shader collapses them beyond close camera range).
  const rhoAt = d => Rs * Math.sin(LP + d / Rs);
  const loops = [];
  for (const arc of arcade) {
    const pts = arc.points;
    let acc = rng() * 0.2;
    for (let i = 1; i < pts.length; i++) {
      acc -= pts[i].distanceTo(pts[i - 1]);
      if (acc > 0) continue;
      acc = 0.08 + 0.4 * rng() * rng();                          // irregular spacing
      const A = pts[i], azA = Math.atan2(A.y, A.x), dA = dOf(A.clone().normalize());
      const vert = Math.abs(Math.sin(azA));
      if (rng() > 0.22 + 0.45 * vert) continue;
      if (loops.some(l => Math.abs(Math.atan2(Math.sin(l.az - azA), Math.cos(l.az - azA))) * rhoAt(dA) < 0.09)) continue;
      loops.push({ A: A.clone(), az: azA, dA, i });
    }
  }
  const ringPts = [];
  for (const [li, l] of loops.entries()) {
    const Lp = 0.22 + 0.4 * rng() * (0.6 + 0.4 * rng());
    const dT = Math.max(0.1, l.dA - Lp);
    const rho = rhoAt(l.dA);
    const half = (0.01 + 0.016 * rng()) / rho, lean = (rng() - 0.5) * 0.26 / rho, sgn = rng() < 0.5 ? -1 : 1;
    const dV = l.dA + 0.12 + 0.18 * rng();
    const azV = l.az + sgn * (0.06 + 0.12 * rng()) / rho;
    const m = meander(9000 + li), wig = (0.004 + 0.006 * rng()) / rho;
    const ctrl = [
      l.A,
      S(lerp(l.dA, dT, 0.45), l.az + lean * 0.4 + wig * m(1.3), R + 0.004),
      S(dT + 0.03, l.az + lean, R + 0.004),
      S(dT, l.az + lean + sgn * half, R + 0.004),
      S(dT + 0.035, l.az + lean + sgn * 2 * half, R + 0.004),
      S(lerp(dT, dV, 0.55), lerp(l.az + lean + sgn * 2 * half, azV, 0.5) + wig * m(3.1), R),
      S(dV, azV, R - 0.006),
    ];
    const p = spline(ctrl, 0.02);
    set.add(p, CONJ_CAL.pal * (0.75 + 0.45 * rng()), 2 + 0.45 * (0.4 + 0.45 * rng()), { dist0: dist0 + 26 + rng() * 2, noPick: true });
    ringPts.push({ az: azV, d: dV });
  }
  // limbal venous ring segments through consecutive loop drains (gaps where the palisades are absent)
  ringPts.sort((a, b) => a.az - b.az);
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const ext = 0.04 + 0.04 * rng();
      const c = [{ az: run[0].az - ext, d: run[0].d + 0.05 }, ...run, { az: run[run.length - 1].az + ext, d: run[run.length - 1].d + 0.05 }];
      const p = spline(c.map(q => S(q.d, q.az, R - 0.006)), 0.03);
      set.add(p, CONJ_CAL.pal * 1.25, 2 + 0.45 * 0.45, { dist0: dist0 + 30, noPick: true });
    }
    run = [];
  };
  for (const q of ringPts) {
    if (run.length && (q.az - run[run.length - 1].az) * rhoAt(q.d) > 0.6) flush();
    run.push(q);
  }
  flush();
  return { paths: set.paths, stats: { nodes: nodes.length, chains: chains.length, it: sc.iterations, loops: loops.length } };
}
