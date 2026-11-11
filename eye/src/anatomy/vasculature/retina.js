// Retinal arterial and venous trees, grown on the inner retinal surface from the optic disc.
// Main arcades are laid down from anatomical landmarks (superotemporal / inferotemporal arcing ~3.5–4 mm
// around the fovea, superonasal / inferonasal), then space colonization fills the retina out to the ora,
// confined to the superior or inferior hemifield (the temporal raphe is never crossed), with a
// vessel-free foveal avascular zone. Radii follow Murray's law. Arteries cross over veins at AV crossings.
import * as THREE from 'three';
import { EYE, L } from '../../config.js';
import * as am from '../../lib/anatomyMath.js';
import { colonize, poissonSphere, bandSampler, pruneLeaves, murray, extractChains, chainsToDense } from './sc.js';
import { Grid3, spline, smoothstep, lerp, mulberry, radiiArray } from './util.js';

export const RETINA_R = L.retinaInnerR - 0.03;

// Display calibres (mm radius). Real adult values: arcade artery ~55 µm, vein ~75 µm radius at the disc
// margin, visible terminal arterioles ~8–12 µm. Exaggeration ~1.45x on trunks, ~1.4x on twigs; inside ~1.5 mm
// of the fovea twigs taper to ~7 µm (real) so the macula stays quiet. Perifoveal capillaries 4.2 µm (real ~2.5–3).
export const RETINA_CAL = { art: 0.08, vein: 0.106, artFloor: 0.0135, veinFloor: 0.0158, macFloor: 0.0068, cap: 0.0042 };

// Optic nerve head cup and foveal pit of the posterior module (so the trunks lie ON its surfaces).
// Defaults replicate posterior/shaders.js DISC_GEOM and posterior.js foveaPit(); vasculature.js passes the live ones.
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const DEFAULT_SURF = {
  disc: { axes: { x: EYE.discDiameter.h * 0.5, y: EYE.discDiameter.v * 0.5 }, cupC: { x: -0.1, y: 0.05 }, cupAx: { x: 0.335, y: 0.31 } },
  pit: rho => 0.18 * 0.5 * (1 - Math.tanh((rho - 0.42) / 0.16)) - 0.015 * Math.exp(-(((rho - 1.05) / 0.42) ** 2)),
};
export function makeSurface(surf = DEFAULT_SURF) {
  const D = am.DISC_MAP, g = surf.disc || DEFAULT_SURF.disc, pit = surf.pit || DEFAULT_SURF.pit;
  // the posterior module's own height field when it exports one (posterior.js discDepth), else a replica
  const cup = typeof surf.cupDepth === 'function' ? surf.cupDepth : (mx, my) => {
    const ec = Math.hypot((mx - D.x - g.cupC.x) / g.cupAx.x, (my - D.y - g.cupC.y) / g.cupAx.y);
    return (g.depth ?? 0.4) * (1 - smooth(0.45, 1.3, ec));
  };
  const discE = (mx, my) => Math.hypot((mx - D.x) / g.axes.x, (my - D.y) / g.axes.y);
  // radius of a vessel centre of radius r at map (mx, my): the tube stands ~60% proud of the surface it lies on
  // (ILM on the retina, the floor / walls of the cup on the disc, the foveal pit near the fovea)
  const centreR = (mx, my, r) => {
    const w = 1 - smooth(1.0, 1.4, discE(mx, my));
    const rho = Math.hypot(mx, my);
    return L.retinaInnerR + (rho < 3.2 ? pit(rho) : 0) + cup(mx, my) - (lerp(0.62, 0.55, w) * r + 0.003);
  };
  return { cup, discE, centreR, pit };
}

function arcadeCtrl(tree) {
  // map coordinates (mm): +x nasal, +y superior; fovea at (0,0), disc at (4.4, 0.25), cup centre (4.3, 0.3)
  if (tree === 0) return {
    root: [4.47, 0.31],
    papS: [[4.47, 0.31], [4.62, 0.66], [4.58, 1.06]],
    ST: [[4.58, 1.06], [4.22, 1.56], [3.46, 2.36], [2.36, 3.06], [0.9, 3.55], [-0.9, 3.86], [-2.8, 4.06], [-4.9, 4.46], [-7.2, 5.12], [-9.6, 6.02]],
    SN: [[4.58, 1.06], [5.02, 1.6], [5.96, 2.5], [7.36, 3.7], [9.06, 5.0]],
    papI: [[4.47, 0.31], [4.66, -0.1], [4.57, -0.56]],
    IT: [[4.57, -0.56], [4.16, -1.1], [3.4, -1.95], [2.3, -2.65], [0.85, -3.2], [-0.95, -3.5], [-2.85, -3.72], [-4.95, -4.1], [-7.3, -4.8], [-9.8, -5.8]],
    IN: [[4.57, -0.56], [5.02, -1.1], [6.02, -1.95], [7.42, -3.1], [9.12, -4.3]],
    // small nasal horizontal arteriole (from the inferior papillary branch) and a papillomacular twig (from ST)
    NH: { from: 'papI', ctrl: [[4.57, -0.56], [5.25, -0.26], [6.3, 0.02], [7.9, 0.2], [9.9, 0.34], [12.2, 0.3]] },
    PM: { from: 'ST', at: 1, ctrl: [[4.22, 1.56], [3.72, 1.18], [2.9, 0.82], [2.05, 0.58]] },
  };
  return {
    root: [4.2, 0.26],
    papS: [[4.2, 0.26], [4.08, 0.72], [4.16, 1.16]],
    ST: [[4.16, 1.16], [3.5, 1.5], [2.5, 2.05], [1.2, 2.75], [-0.2, 3.2], [-1.7, 3.62], [-3.1, 4.45], [-5.0, 5.0], [-6.5, 5.22], [-8.0, 5.26], [-9.8, 5.72]],
    SN: [[4.16, 1.16], [4.52, 1.92], [5.32, 2.92], [6.62, 4.16], [8.22, 5.6]],
    papI: [[4.2, 0.26], [4.08, -0.24], [4.18, -0.72]],
    IT: [[4.18, -0.72], [3.55, -1.22], [2.65, -1.86], [1.55, -2.5], [0.45, -3.2], [-0.8, -3.95], [-2.5, -4.35], [-4.4, -4.55], [-6.0, -4.33], [-7.6, -4.72], [-9.7, -5.4]],
    IN: [[4.18, -0.72], [4.62, -1.42], [5.47, -2.36], [6.77, -3.5], [8.37, -4.82]],
    NH: { from: 'papS', ctrl: [[4.16, 1.16], [4.95, 0.86], [6.05, 0.62], [7.8, 0.5], [9.8, 0.36], [12.3, 0.42]] },
    PM: { from: 'papI', ctrl: [[4.18, -0.72], [3.45, -0.56], [2.6, -0.42], [1.85, -0.36]] },
  };
}

export function buildRetinalTrees({ rng, surf }) {
  const R = RETINA_R;
  const S = makeSurface(surf);
  const D = 0.14;
  const M = (x, y) => am.retinaMap(x, y, R);
  const fovea = M(0, 0);
  const discC = M(am.DISC_MAP.x, am.DISC_MAP.y);
  const rand = rng;

  // ---------------------------------------------------------------- seeds (main arcades)
  const seeds = [];
  const jit = (c, amt) => c.map((p, i) => (i === 0 ? p : [p[0] + (rand() - 0.5) * amt, p[1] + (rand() - 0.5) * amt]));
  const chainWorld = ctrl => spline(ctrl.map(p => new THREE.Vector3(p[0], p[1], 0)), D).map(v => M(v.x, v.y));
  const nearDisc = p => p.distanceTo(discC) < 1.15;
  const seedIndex = {};
  for (const tree of [0, 1]) {
    const c = arcadeCtrl(tree);
    const base = seeds.length;
    seedIndex[tree] = base;
    seeds.push({ pts: [M(...c.root)], tree, group: -1, noBranch: () => true, maxKids: () => 2 });
    const papS = jit(c.papS, 0.0), papI = jit(c.papI, 0.0);
    const ST = jit(c.ST, 0.12), SN = jit(c.SN, 0.12), IT = jit(c.IT, 0.12), IN = jit(c.IN, 0.12);
    ST[0] = SN[0] = papS[papS.length - 1]; IT[0] = IN[0] = papI[papI.length - 1];
    seeds.push({ pts: chainWorld(papS), tree, group: 0, parentSeed: base, noBranch: () => true });
    seeds.push({ pts: chainWorld(ST), tree, group: 0, parentSeed: base + 1, noBranch: (k, p) => nearDisc(p) });
    seeds.push({ pts: chainWorld(SN), tree, group: 0, parentSeed: base + 1, noBranch: (k, p) => nearDisc(p) });
    seeds.push({ pts: chainWorld(papI), tree, group: 1, parentSeed: base, noBranch: () => true });
    seeds.push({ pts: chainWorld(IT), tree, group: 1, parentSeed: base + 4, noBranch: (k, p) => nearDisc(p) });
    seeds.push({ pts: chainWorld(IN), tree, group: 1, parentSeed: base + 4, noBranch: (k, p) => nearDisc(p) });
    // nasal horizontal vessel: occupies the nasal horizontal meridian so SN and IN twigs interdigitate across it
    // instead of leaving an empty corridor; papillomacular twig towards the macula
    const key = { papS: base + 1, ST: base + 2, SN: base + 3, papI: base + 4, IT: base + 5, IN: base + 6 };
    for (const extra of [c.NH, c.PM]) {
      const ctrl = extra.ctrl.map((p, i) => (i === 0 ? p : [p[0] + (rand() - 0.5) * 0.08, p[1] + (rand() - 0.5) * 0.08]));
      const pts = chainWorld(ctrl);
      const par = key[extra.from];
      const s = { pts, tree, group: ctrl[ctrl.length - 1][1] >= 0 ? 0 : 1, noBranch: (k, p) => nearDisc(p) };
      if (extra.at == null) s.parentSeed = par;
      else {
        // attach to the node of the parent seed nearest to the first point
        s.parentNode = nodes => { let bi = seeds[par].first, bd = 1e9; for (let i = seeds[par].first; i <= seeds[par].last; i++) { const d = nodes[i].p.distanceTo(pts[0]); if (d < bd) { bd = d; bi = i; } } pts[0] = nodes[bi].p.clone(); return bi; };
      }
      seeds.push(s);
    }
  }

  // ---------------------------------------------------------------- attractors
  const oraMargin = 0.9 / R;
  const inRetina = (pU, margin) => Math.acos(THREE.MathUtils.clamp(pU.z, -1, 1)) > am.oraPolar(Math.atan2(pU.y, pU.x)) + margin;
  // hemifield divide: the disc–fovea line, continued temporally as the (slightly tilted, gently wavy) raphe
  const divY = x => (x > am.DISC_MAP.x ? am.DISC_MAP.y : am.DISC_MAP.y * x / am.DISC_MAP.x + (x < -0.3 ? (0.1 * Math.sin(x * 0.62 + 0.6) + 0.045 * Math.sin(x * 1.9 + 2.1)) * smoothstep(-0.3, -2.5, x) : 0));
  const hemi = p => { const m = am.worldToRetinaMap(p, R); return m.y >= divY(m.x) ? 0 : 1; };
  const tmp = new THREE.Vector3();
  const spacing = (scale) => pU => {
    if (!inRetina(pU, oraMargin)) return 0;
    tmp.copy(pU).multiplyScalar(R);
    const dF = tmp.distanceTo(fovea), dD = tmp.distanceTo(discC);
    if (dF < 0.46 || dD < 1.0) return 0;
    let s = lerp(0.56, 0.82, smoothstep(5, 19, dF)) * lerp(1, 1.27, smoothstep(10, 15, dF));
    s = Math.min(s, lerp(0.32, 0.56, smoothstep(1.0, 3.6, dF)));
    return s * scale;
  };
  const band = bandSampler(0.93, Math.PI);
  const attractors = [];
  for (const tree of [0, 1]) {
    const pts = poissonSphere({ R, count: 6000, tries: 14, rand, sample: band, spacing: spacing(tree ? 1.12 : 1.18), cell: 0.9 });
    for (const a of pts) {
      const m = am.worldToRetinaMap(a.p, R);
      attractors.push({ p: a.p, tree, mask: m.x < -0.3 ? (1 << hemi(a.p)) : 3, r: a.r });
    }
  }
  // a sparse line of attractors either side of the temporal raphe so tips run up to it (a meeting line, not a gap)
  for (let x = -1.6; x > -16; x -= 0.62 + 0.25 * rand()) {
    for (const sy of [1, -1]) {
      const xx = x + (rand() - 0.5) * 0.3;
      const p = M(xx, divY(xx) + sy * (0.08 + 0.08 * rand()));
      if (!inRetina(tmp.copy(p).normalize(), oraMargin)) continue;
      for (const tree of [0, 1]) attractors.push({ p: p.clone(), tree, mask: 1 << (sy > 0 ? 0 : 1) });
    }
  }
  const kSpacing = spacing(1.0);
  const nearRaphe = p => { const m = am.worldToRetinaMap(p, R); return m.x < -0.3 ? smoothstep(0.08, 0.9, Math.abs(m.y - divY(m.x))) : 1; };

  // ---------------------------------------------------------------- growth
  const allow = (p, n) => {
    const pU = tmp.copy(p).normalize();
    if (!inRetina(pU, 0.55 / R)) return false;
    if (p.distanceTo(fovea) < 0.3) return false;
    const m = am.worldToRetinaMap(p, R);
    if (m.x < -0.3) { const dy = m.y - divY(m.x); if (n.group === 0 && dy < 0.03) return false; if (n.group === 1 && dy > -0.03) return false; }
    return true;
  };
  const sc = colonize({
    R, seeds, attractors, rand,
    di: 1.55, dk: p => 0.82 * (kSpacing(tmp.copy(p).normalize()) || 0.45) * lerp(0.3, 1, nearRaphe(p)), dkCross: 0.2, D,
    inertia: 1.2, splitAngle: 1.0, sideAngle: 0.62, minSpacing: 0.6, maxTurn: 0.28, allow, maxIter: 700,
    sideLean: 0.5, sideBack: -0.2,
    spanOf: (n, r) => (n.seed ? 0.8 + 1.4 * r() : 0.45 + 0.8 * r()),
  });
  const nodes = sc.nodes;
  pruneLeaves(nodes, 0.32);
  pruneLeaves(nodes, 0.2);
  murray(nodes, 3);

  // ---------------------------------------------------------------- calibres
  const rootA = seeds[seedIndex[0]].first, rootV = seeds[seedIndex[1]].first;
  const arcadeFirst = tree => [2, 3, 5, 6].map(k => seeds[seedIndex[tree] + k].first);
  const scale = {};
  for (const tree of [0, 1]) {
    const mx = Math.max(...arcadeFirst(tree).map(i => nodes[i].rm));
    scale[tree] = (tree ? RETINA_CAL.vein : RETINA_CAL.art) / mx;
  }
  const floorAt = (n) => lerp(RETINA_CAL.macFloor, n.tree ? RETINA_CAL.veinFloor : RETINA_CAL.artFloor, smoothstep(0.9, 2.0, n.p.distanceTo(fovea)));
  const rOf = n => Math.max(floorAt(n), n.rm * scale[n.tree] * lerp(0.55, 1, smoothstep(0.8, 1.6, n.p.distanceTo(fovea))));
  const rootR = { art: rOf(nodes[rootA]), vein: rOf(nodes[rootV]) };

  // ---------------------------------------------------------------- dense paths
  const chains = extractChains(nodes, [rootA, rootV]);
  const dense = chainsToDense(nodes, chains, { rOf, every: 3, spacing: 0.07, tailMaxTurn: 0.6 });
  // temporal raphe: terminal twigs heading for the raphe run on until they almost touch it (0.05–0.1 mm)
  for (const d of dense) {
    const last = nodes[d.ids[d.ids.length - 1]];
    if (last.kids.some(k => !nodes[k].dead) || d.pts.length < 5) continue;
    const n = d.pts.length, tipM = am.worldToRetinaMap(d.pts[n - 1], R), prevM = am.worldToRetinaMap(d.pts[n - 4], R);
    const off0 = tipM.y - divY(tipM.x);
    if (tipM.x > -0.8 || Math.abs(off0) > 0.75) continue;
    const dir = tipM.clone().sub(prevM).normalize();
    const sgn = Math.sign(off0) || 1;
    if (-dir.y * sgn < 0.25) continue;                           // not heading for the raphe
    if (rand() < 0.12) continue;                                 // a few stop short
    const stand = 0.04 + 0.11 * rand() * rand();                 // how close it gets (0.04–0.15 mm)
    const ext = [];
    let q = tipM.clone(), h = dir.clone();
    for (let k = 0; k < 16 && (q.y - divY(q.x)) * sgn > stand; k++) {
      h.lerp(new THREE.Vector2(h.x * 0.6, -sgn), 0.12).normalize();
      q = q.clone().addScaledVector(h, 0.05);
      if ((q.y - divY(q.x)) * sgn < stand) q.y = divY(q.x) + sgn * stand;
      ext.push(q);
    }
    if (!ext.length) continue;
    const rt = d.rads[n - 1];
    const pts = d.pts.concat(ext.map(v => M(v.x, v.y)));
    const rads = new Float32Array(pts.length); rads.set(d.rads); for (let i = n; i < pts.length; i++) rads[i] = rt;
    d.pts = pts; d.rads = rads;
  }
  // taper the last 0.35 mm of terminal twigs so they fade instead of stopping
  for (const d of dense) {
    const n = d.pts.length; const k = Math.min(n - 1, 5);
    for (let i = 0; i < k; i++) d.rads[n - 1 - i] *= 0.62 + 0.38 * (i / k);
  }

  // ---------------------------------------------------------------- AV crossings: artery over vein (~75%), smooth lift
  const off = dense.map(d => new Float32Array(d.pts.length));
  const grids = [new Grid3(0.35), new Grid3(0.35)];
  dense.forEach((d, pi) => d.pts.forEach((p, si) => grids[d.tree].add(pi * 65536 + si, p.x, p.y, p.z)));
  const hash = (a, b) => { const r = mulberry((a * 7919 + b * 104729) >>> 0); r(); return r(); };
  dense.forEach((d, pi) => {
    const other = grids[1 - d.tree];
    for (let si = 0; si < d.pts.length; si++) {
      const p = d.pts[si], r0 = d.rads[si];
      let bestD = 1e9, bestR = 0, bestP = -1;
      other.each(p.x, p.y, p.z, 0.36, id => {
        const qi = Math.floor(id / 65536), qs = id % 65536;
        const q = dense[qi].pts[qs];
        const dd = p.distanceTo(q);
        if (dd < bestD) { bestD = dd; bestR = dense[qi].rads[qs]; bestP = qi; }
      });
      if (bestP < 0) continue;
      const reach = r0 + bestR + 0.16;
      if (bestD > reach) continue;
      const w = smoothstep(reach, (r0 + bestR) * 0.35, bestD);
      const artPath = d.tree === 0 ? pi : bestP, veinPath = d.tree === 0 ? bestP : pi;
      const arteryOver = hash(artPath, veinPath) < 0.76;
      const iAmOver = (d.tree === 0) === arteryOver;
      const v = iAmOver ? -(bestR + 0.55 * r0) * w : 0.45 * bestR * w;
      if (Math.abs(v) > Math.abs(off[pi][si])) off[pi][si] = v;
    }
  });
  // smooth the offsets along each path and project onto the retina
  dense.forEach((d, pi) => {
    const o = off[pi], n = o.length, s = new Float32Array(n);
    for (let i = 0; i < n; i++) { let a = 0, w = 0; for (let k = -4; k <= 4; k++) { const j = i + k; if (j < 0 || j >= n) continue; const ww = 5 - Math.abs(k); a += o[j] * ww; w += ww; } s[i] = a / w; }
    // lie on the real surfaces: ILM, the cup floor and walls of the disc, the foveal pit
    for (let i = 0; i < n; i++) {
      const m = am.worldToRetinaMap(d.pts[i], R);
      d.pts[i].normalize().multiplyScalar(S.centreR(m.x, m.y, d.rads[i]) + s[i]);
    }
  });

  // ---------------------------------------------------------------- emergence from the cup
  // The central artery / vein come up the nerve axis and bend onto the cup floor: each root chain starts
  // 0.34 mm below the floor heading straight up (-normal) and swings into its course with a ~0.3 mm fillet.
  const rootIds = { 0: seeds[seedIndex[0]].first, 1: seeds[seedIndex[1]].first };
  const lead = {};
  for (const tree of [0, 1]) {
    const own = dense.filter(d => d.ids[0] === rootIds[tree]);
    if (!own.length) continue;
    const P0 = own[0].pts[0].clone(), nrm = P0.clone().normalize();
    const E = P0.clone().addScaledVector(nrm, 0.34);                 // on the nerve axis, under the cup floor
    const F = P0.clone().addScaledVector(nrm, 0.85 * own[0].rads[0]);       // fork: its crest just breaks the floor
    lead[tree] = { E, len: 0 };
    for (const d of own) {
      const cl = [0]; for (let i = 1; i < d.pts.length; i++) cl.push(cl[i - 1] + d.pts[i].distanceTo(d.pts[i - 1]));
      let k = cl.findIndex(x => x > 0.28); if (k < 2) k = Math.min(d.pts.length - 1, 4);
      const Q = d.pts[k], tQ = d.pts[Math.min(d.pts.length - 1, k + 1)].clone().sub(d.pts[k - 1]).normalize();
      const c1 = F.clone().addScaledVector(nrm, -0.13).addScaledVector(tQ, 0.06), c2 = Q.clone().addScaledVector(tQ, -0.15);
      const bez = new THREE.CubicBezierCurve3(F, c1, c2, Q);
      const stem = spline([E, F], 0.04);
      const m = Math.max(6, Math.ceil(bez.getLength() / 0.04));
      const head = stem.concat(bez.getSpacedPoints(m).slice(1));
      const r0 = d.rads[0];
      const pts = head.concat(d.pts.slice(k + 1));
      const rads = new Float32Array(pts.length);
      for (let i = 0; i < pts.length; i++) rads[i] = i < head.length ? r0 : d.rads[i - head.length + k + 1];
      lead[tree].len = Math.max(lead[tree].len, E.distanceTo(F) + bez.getLength() - cl[k]);
      d.pts = pts; d.rads = rads; d.lead = true;
    }
  }
  for (const d of dense) if (!d.lead && lead[d.tree]) d.dist0 += lead[d.tree].len;

  // ---------------------------------------------------------------- perifoveal capillaries (inspect-scale detail)
  // Terminal loops: every macular arteriole tip is joined to a nearby venule tip, and the innermost tips run on
  // into an irregular capillary ring that bounds the FAZ. Calibre fades to nothing by ~1.1 mm from the fovea and
  // the shader collapses them entirely beyond close camera range, so they never read as a wireframe.
  const caps = [];
  const fazR = EYE.fazDiameter / 2;
  const mapOf = p => am.worldToRetinaMap(p, R);
  const capRad = m => RETINA_CAL.cap * (1 - smoothstep(0.72, 1.12, m.length())) + 0.0004;
  const capPath = (ctrlMap, seedK) => {
    const pts = spline(ctrlMap.map(v => new THREE.Vector3(v.x, v.y, 0)), 0.025);
    const mp = pts.map(v => new THREE.Vector2(v.x, v.y));
    return { pts: mp.map(v => { const w = M(v.x, v.y); return w.normalize().multiplyScalar(S.centreR(v.x, v.y, 0.004) - 0.004); }), rads: mp.map(capRad) };
  };
  const tips = [[], []];
  for (const d of dense) {
    const last = nodes[d.ids[d.ids.length - 1]];
    if (last.kids.some(k => !nodes[k].dead)) continue;
    const n = d.pts.length, t = mapOf(d.pts[n - 1]);
    if (t.length() > 1.3 || n < 3) continue;
    tips[d.tree].push({ m: t, dir: t.clone().sub(mapOf(d.pts[n - 3])).normalize(), used: 0 });
  }
  // FAZ boundary ring: irregular, closed
  const ringM = [];
  { const ph = [rand() * 6.3, rand() * 6.3, rand() * 6.3];
    for (let i = 0; i <= 64; i++) {
      const a = i / 64 * Math.PI * 2;
      const r = fazR + 0.045 + 0.03 * Math.sin(2 * a + ph[0]) + 0.018 * Math.sin(5 * a + ph[1]) + 0.01 * Math.sin(9 * a + ph[2]);
      ringM.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
    } }
  { const c = capPath(ringM, 0); caps.push({ pts: c.pts, rads: c.rads, kind: 2 + 0.45 * 0.35 }); }
  const jitter = (a, b, amt) => { const d = b.clone().sub(a); const nrm2 = new THREE.Vector2(-d.y, d.x).normalize(); return nrm2.multiplyScalar((rand() - 0.5) * amt * d.length()); };
  // inner tips -> ring
  for (const tree of [0, 1]) for (const t of tips[tree]) {
    if (t.m.length() > 0.95) continue;
    let bi = 0, bd = 1e9;
    ringM.forEach((q, i) => { const dd = q.distanceTo(t.m) - 0.35 * q.clone().sub(t.m).normalize().dot(t.dir); if (dd < bd) { bd = dd; bi = i; } });
    const Q = ringM[bi];
    const m1 = t.m.clone().addScaledVector(t.dir, 0.08).add(jitter(t.m, Q, 0.25));
    const m2 = t.m.clone().lerp(Q, 0.66).add(jitter(t.m, Q, 0.3));
    const c = capPath([t.m, m1, m2, Q]);
    caps.push({ pts: c.pts, rads: c.rads, kind: 2 + 0.45 * (0.3 + 0.3 * rand()) });
    t.used++;
  }
  // arteriole tip -> nearest venule tip (terminal loops)
  for (const a of tips[0]) {
    const cand = tips[1].filter(v => v.used < 2 && v.m.distanceTo(a.m) < 0.85 && v.m.distanceTo(a.m) > 0.08).sort((x, y) => x.m.distanceTo(a.m) - y.m.distanceTo(a.m));
    for (const v of cand.slice(0, a.m.length() < 0.9 ? 1 : 2)) {
      const m1 = a.m.clone().addScaledVector(a.dir, 0.07).lerp(v.m, 0.33).add(jitter(a.m, v.m, 0.4));
      const m2 = a.m.clone().lerp(v.m, 0.7).add(jitter(a.m, v.m, 0.35));
      const c = capPath([a.m, m1, m2, v.m]);
      caps.push({ pts: c.pts, rads: c.rads, kind: 2 + 0.45 * (0.3 + 0.3 * rand()) });
      v.used++;
    }
  }

  const rootPt = tree => (lead[tree] ? lead[tree].E.clone() : nodes[rootIds[tree]].p.clone());
  return { R, dense, caps, rootA: rootPt(0), rootV: rootPt(1), rootR, nodes, surface: S, stats: { nodes: nodes.length, iterations: sc.iterations, attractors: attractors.length, chains: chains.length } };
}
