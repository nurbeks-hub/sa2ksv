// Space colonization on a sphere (Runions et al. 2007), adapted for vascular trees:
//  - growth happens on the sphere surface (steps are taken in the tangent plane and re-projected),
//  - tips split dichotomously when their attractors pull apart, side branches need a minimum spacing,
//  - several trees (e.g. artery + vein) grow at once, each with its own attractor set, and repel each other,
//  - attractor "groups" confine trees to territories (retinal hemifields, vortex quadrants),
//  - radii come afterwards from Murray's law (r^3 of the parent = sum of r^3 of the children).
import * as THREE from 'three';
import { Grid3, tangentize, spline, cumLengths } from './util.js';

const _t = new THREE.Vector3(), _n = new THREE.Vector3();

// Poisson-disk attractors on a sphere region. accept(pUnit) -> radius (mm) or 0 to reject.
export function poissonSphere({ R, count, tries = 30, rand, sample, spacing, cell = 1.0 }) {
  const out = [];
  const grid = new Grid3(cell);
  const cand = new THREE.Vector3();
  for (let k = 0; k < count * tries && out.length < count; k++) {
    sample(cand, rand);
    const r = spacing(cand);
    if (!(r > 0)) continue;
    const p = cand.clone().normalize().multiplyScalar(R);
    let ok = true;
    grid.each(p.x, p.y, p.z, r, id => { if (ok && out[id].p.distanceToSquared(p) < r * r) ok = false; });
    if (!ok) continue;
    grid.add(out.length, p.x, p.y, p.z);
    out.push({ p, r });
  }
  return out;
}

// Uniform random direction inside a polar band (polar angle from +Z in [p0, p1]).
export function bandSampler(p0, p1) {
  const c0 = Math.cos(p0), c1 = Math.cos(p1);
  return (v, rand) => {
    const z = c1 + (c0 - c1) * rand(), a = rand() * Math.PI * 2, s = Math.sqrt(Math.max(0, 1 - z * z));
    return v.set(Math.cos(a) * s, Math.sin(a) * s, z);
  };
}

export function colonize(opt) {
  const {
    R, seeds, attractors, rand,
    di = 1.5, dk = () => 0.5, dkCross = 0.22, D = 0.14,
    inertia = 0.8, maxIter = 800, splitAngle = 1.05, sideAngle = 0.55, minSpacing = 0.5,
    maxTurn = 0.5, allow = null, bias = null, maxNodes = 60000,
    spanOf = null, sideLean = 0.0, sideBack = -0.3,
  } = opt;
  const nodes = [];
  const NA = attractors.length;
  const ax = new Float32Array(NA), ay = new Float32Array(NA), az = new Float32Array(NA);
  const ag = new Int32Array(NA), at = new Int8Array(NA), alive = new Uint8Array(NA), best = new Int32Array(NA), bestD = new Float32Array(NA), akill = new Float32Array(NA);
  const agrid = new Grid3(di);
  for (let i = 0; i < NA; i++) {
    const a = attractors[i];
    ax[i] = a.p.x; ay[i] = a.p.y; az[i] = a.p.z; ag[i] = a.mask ?? (1 << (a.group ?? 0)); at[i] = a.tree ?? 0;
    alive[i] = 1; best[i] = -1; bestD[i] = 1e9; akill[i] = dk(a.p);
    agrid.add(i, ax[i], ay[i], az[i]);
  }
  const reach = Math.max(di, dkCross);

  function addNode(p, parent, tree, group, dir, flags = {}) {
    const i = nodes.length;
    const par = parent >= 0 ? nodes[parent] : null;
    const step = par ? p.distanceTo(par.p) : 0;
    const n = {
      i, p, parent, kids: [], tree, group, dir: dir.clone(),
      dist: par ? par.dist + step : (flags.dist || 0),
      noBranch: !!flags.noBranch, maxKids: flags.maxKids ?? 2, seed: !!flags.seed, dead: false,
    };
    n.span = spanOf ? spanOf(n, rand) : minSpacing * (0.7 + 0.8 * rand());
    nodes.push(n);
    if (par) par.kids.push(i);
    agrid.each(p.x, p.y, p.z, reach, a => {
      if (!alive[a]) return;
      const dx = ax[a] - p.x, dy = ay[a] - p.y, dz = az[a] - p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (at[a] !== tree) { if (d < dkCross) alive[a] = 0; return; }
      if (d < akill[a]) { alive[a] = 0; return; }
      if (group >= 0 && ((ag[a] >> group) & 1) && d < di && d < bestD[a]) { bestD[a] = d; best[a] = i; }
    });
    return i;
  }

  // seeds: [{ pts: Vector3[], tree, group, parent: nodeIndex|-1|'prev:<k>', noBranch(i,p)->bool, maxKids(i)->n, dist }]
  const seedEnds = [];
  for (const s of seeds) {
    let parent = typeof s.parent === 'number' ? s.parent : -1;
    if (typeof s.parentSeed === 'number') parent = seedEnds[s.parentSeed];
    if (typeof s.parentNode === 'function') parent = s.parentNode(nodes);
    const first = nodes.length;
    for (let k = 0; k < s.pts.length; k++) {
      if (k === 0 && parent >= 0 && nodes[parent].p.distanceTo(s.pts[0]) < 1e-4) continue; // shared split point
      const p = s.pts[k];
      const q = s.pts[Math.min(s.pts.length - 1, k + 1)], q0 = s.pts[Math.max(0, k - 1)];
      _n.copy(p).normalize();
      let dir = tangentize(new THREE.Vector3().subVectors(q, q0), _n);
      if (dir.lengthSq() < 1e-12) dir = parent >= 0 ? nodes[parent].dir.clone() : tangentize(new THREE.Vector3(0.3, 1, 0.1), _n);
      dir.normalize();
      parent = addNode(p, parent, s.tree, s.group, dir, {
        noBranch: s.noBranch ? s.noBranch(k, p) : false, maxKids: s.maxKids ? s.maxKids(k, p) : 2, seed: true, dist: s.dist || 0,
      });
    }
    seedEnds.push(parent);
    s.first = first; s.last = parent;
  }

  const nearBranch = (n, span) => {
    let d = 0, c = n;
    while (c.parent >= 0 && d < span) { const p = nodes[c.parent]; d += c.p.distanceTo(p.p); if (p.kids.length >= 2) return true; c = p; }
    d = 0; c = n;
    while (c.kids.length && d < span) { const k = nodes[c.kids[0]]; d += c.p.distanceTo(k.p); if (k.kids.length >= 2) return true; c = k; }
    return false;
  };

  const tmp = new THREE.Vector3(), nrm = new THREE.Vector3(), m1 = new THREE.Vector3(), m2 = new THREE.Vector3(), perp = new THREE.Vector3();
  const grow = (n, dirIn) => {
    nrm.copy(n.p).normalize();
    const dir = tangentize(dirIn.clone(), nrm).normalize();
    if (bias) { const b = bias(n, dir); if (b) { dir.add(b); tangentize(dir, nrm).normalize(); } }
    const p = n.p.clone().addScaledVector(dir, D).normalize().multiplyScalar(R);
    if (allow && !allow(p, n)) return false;
    addNode(p, n.i, n.tree, n.group, dir);
    return true;
  };
  const limitTurn = (from, to, maxA, nUnit) => {
    const ang = Math.acos(Math.min(1, Math.max(-1, from.dot(to))));
    if (ang <= maxA) return to;
    _t.crossVectors(from, to); const s = Math.sign(_t.dot(nUnit)) || 1;
    return from.clone().applyAxisAngle(nUnit, s * maxA);
  };

  let it = 0;
  for (; it < maxIter && nodes.length < maxNodes; it++) {
    const acc = new Map();
    for (let a = 0; a < NA; a++) {
      if (!alive[a] || best[a] < 0) continue;
      let e = acc.get(best[a]); if (!e) { e = []; acc.set(best[a], e); } e.push(a);
    }
    if (!acc.size) break;
    let grown = 0;
    for (const [ni, list] of acc) {
      const n = nodes[ni];
      if (n.dead) continue;
      nrm.copy(n.p).normalize();
      const dirs = list.map(a => tangentize(tmp.set(ax[a] - n.p.x, ay[a] - n.p.y, az[a] - n.p.z), nrm).normalize().clone());
      const mean = dirs.reduce((s, d) => s.add(d), new THREE.Vector3());
      if (mean.lengthSq() < 1e-8) continue;
      mean.normalize();
      const kill = () => { for (const a of list) alive[a] = 0; };
      if (n.kids.length >= n.maxKids) { kill(); continue; }
      if (n.kids.length === 0) {
        // tip: dichotomous split when the attractors form two clusters far apart
        perp.crossVectors(nrm, mean);
        m1.set(0, 0, 0); m2.set(0, 0, 0); let c1 = 0, c2 = 0;
        for (const d of dirs) { if (d.dot(perp) >= 0) { m1.add(d); c1++; } else { m2.add(d); c2++; } }
        let didSplit = false;
        if (c1 >= 2 && c2 >= 2 && !n.noBranch && !nearBranch(n, n.span)) {
          m1.normalize(); m2.normalize();
          if (Math.acos(Math.min(1, m1.dot(m2))) > splitAngle) {
            const a1 = limitTurn(n.dir, m1.clone(), 0.75, nrm), a2 = limitTurn(n.dir, m2.clone(), 0.75, nrm);
            if (grow(n, a1)) grown++;
            if (grow(n, a2)) grown++;
            didSplit = true;
          }
        }
        if (!didSplit) {
          const back = Math.acos(Math.min(1, Math.max(-1, mean.dot(n.dir))));
          if (back > 2.0) { kill(); continue; }
          const d = mean.clone().addScaledVector(n.dir, inertia).normalize();
          if (grow(n, limitTurn(n.dir, d, maxTurn, nrm))) grown++; else kill();
        }
      } else {
        if (n.noBranch || nearBranch(n, n.span)) continue;
        if (mean.dot(n.dir) < sideBack) continue;
        let minAng = 9;
        for (const k of n.kids) minAng = Math.min(minAng, Math.acos(Math.min(1, Math.max(-1, nodes[k].dir.dot(mean)))));
        if (minAng < sideAngle) continue;
        if (grow(n, sideLean ? mean.clone().addScaledVector(n.dir, sideLean).normalize() : mean)) grown++; else kill();
      }
    }
    if (!grown) break;
  }
  return { nodes, iterations: it, seeds };
}

// Remove short leaf stubs (thorns) that are not seeds.
export function pruneLeaves(nodes, minLen) {
  let removed = 0;
  for (const n of nodes) {
    if (n.dead || n.kids.length || n.seed) continue;
    const chain = [n]; let len = 0, c = n;
    while (c.parent >= 0) {
      const p = nodes[c.parent];
      len += c.p.distanceTo(p.p);
      if (p.kids.length !== 1 || p.seed) break;
      chain.push(p); c = p;
    }
    if (len < minLen) {
      for (const x of chain) x.dead = true;
      const top = chain[chain.length - 1];
      const par = nodes[top.parent];
      if (par) par.kids = par.kids.filter(k => k !== top.i);
      removed += chain.length;
    }
  }
  return removed;
}

// Murray's law radii, per tree: leaves carry unit flow; r ~ Q^(1/gamma).
export function murray(nodes, gamma = 3) {
  const Q = new Float32Array(nodes.length);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]; if (n.dead) continue;
    let q = 0; for (const k of n.kids) q += Q[k];
    Q[i] = q > 0 ? q : 1;
  }
  for (const n of nodes) { n.Q = Q[n.i]; n.rm = Math.pow(Q[n.i], 1 / gamma); }
  return Q;
}

// Decompose trees into continuous paths: at each fork the child with the larger flow continues the path.
// Returns [{ ids: nodeIndex[], fork: bool }] — fork chains start at the (shared) fork node.
export function extractChains(nodes, roots) {
  const chains = [];
  const stack = roots.map(r => ({ start: r, from: -1 }));
  while (stack.length) {
    const { start, from } = stack.pop();
    const ids = from >= 0 ? [from, start] : [start];
    let cur = start;
    for (;;) {
      const kids = nodes[cur].kids.filter(k => !nodes[k].dead);
      if (!kids.length) break;
      kids.sort((a, b) => nodes[b].Q - nodes[a].Q);
      for (let j = 1; j < kids.length; j++) stack.push({ start: kids[j], from: cur });
      ids.push(kids[0]); cur = kids[0];
    }
    chains.push({ ids, fork: from >= 0 });
  }
  return chains;
}

// Chains -> dense smooth polylines with per-sample radii. rOf(node) gives the display radius.
// tailMaxTurn (rad): terminal twigs may not hook in their last control segments (a procedural tell);
// sharper turns are relaxed to this angle by swinging the rest of the tail about the bend.
export function chainsToDense(nodes, chains, { rOf, every = 2, spacing = 0.07, project, tailMaxTurn = 0 }) {
  const out = [];
  const d1 = new THREE.Vector3(), d2 = new THREE.Vector3(), nd = new THREE.Vector3();
  for (const ch of chains) {
    const ids = ch.ids;
    if (ids.length < 2) continue;
    const sel = [];
    for (let k = 0; k < ids.length; k++) if (k === 0 || k === 1 || k === ids.length - 1 || k % every === 0) sel.push(k);
    let ctrl = sel.map(k => nodes[ids[k]].p);
    const terminal = !nodes[ids[ids.length - 1]].kids.some(k => !nodes[k].dead);
    if (tailMaxTurn > 0 && terminal && ctrl.length >= 3) {
      ctrl = ctrl.map(p => p.clone());
      const n = ctrl.length;
      for (let i = Math.max(1, n - 3); i < n - 1; i++) {
        const a = ctrl[i - 1], b = ctrl[i], c = ctrl[i + 1];
        d1.subVectors(b, a).normalize(); d2.subVectors(c, b);
        const len = d2.length(); d2.divideScalar(len || 1);
        const ang = Math.acos(Math.min(1, Math.max(-1, d1.dot(d2))));
        if (ang <= tailMaxTurn) continue;
        const t = tailMaxTurn / ang;
        nd.copy(d1).multiplyScalar(1 - t).addScaledVector(d2, t).normalize();
        const Rb = b.length();
        const newC = b.clone().addScaledVector(nd, len).normalize().multiplyScalar(Rb);
        const shift = newC.sub(c);
        for (let j = i + 1; j < n; j++) ctrl[j].add(shift).normalize().multiplyScalar(Rb);
      }
    }
    const crad = sel.map(k => rOf(nodes[ids[(ch.fork && k === 0) ? 1 : k]]));
    const cl = cumLengths(ctrl), total = cl[cl.length - 1] || 1;
    const pts = spline(ctrl, spacing);
    const dl = cumLengths(pts), dtot = dl[dl.length - 1] || 1;
    const rads = new Float32Array(pts.length);
    let j = 0;
    for (let i = 0; i < pts.length; i++) {
      const s = dl[i] / dtot * total;
      while (j < cl.length - 2 && cl[j + 1] < s) j++;
      const t = Math.min(1, Math.max(0, (s - cl[j]) / Math.max(1e-6, cl[j + 1] - cl[j])));
      rads[i] = crad[j] * (1 - t) + crad[j + 1] * t;
      if (project) project(pts[i], i, pts.length);
    }
    out.push({ pts, rads, tree: nodes[ids[1]].tree, group: nodes[ids[1]].group, dist0: nodes[ids[0]].dist, ids, fork: ch.fork });
  }
  return out;
}
