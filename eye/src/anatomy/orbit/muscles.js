// The six extraocular muscles in the assembled pose.
//  - Four recti: annulus of Zinn -> straight course to the tangent point on the globe -> great-circle wrap
//    (arc of contact) -> straight insertion at the spiral of Tillaux distance. Each rectus carries its
//    quarter of the annulus of Zinn, so the ring reads whole when assembled.
//  - Superior oblique: sphenoid origin superomedial to the optic canal -> along the superomedial orbital
//    wall -> round tendon through the trochlea (cartilage pulley, part of this part) -> reflected tendon
//    runs posterolaterally UNDER the superior rectus and fans onto the posterosuperotemporal globe.
//  - Inferior oblique: anteromedial orbital floor -> posterolaterally BELOW the inferior rectus -> wraps
//    the inferolateral globe -> inserts under the lateral rectus near the macula.
// Draping: the superior rectus is lifted over the SO tendon, the IO over the IR, the LR over the IO,
// using height fields of the already-built sweeps, so nothing interpenetrates and nothing enters the globe.
import * as THREE from 'three';
import { sweep, wrapPath, resamplePolyline, keys, sstep, heightField } from './sweep.js';

const V3 = THREE.Vector3;
const STEP = 0.2;

function mergeGeoms(list) {
  const names = Object.keys(list[0].attributes);
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = list[0].attributes[n].itemSize;
    const total = list.reduce((a, g) => a + g.attributes[n].count, 0);
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of list) { arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  const idx = []; let base = 0;
  for (const g of list) { const ix = g.index.array; for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base); base += g.attributes.position.count; }
  out.setIndex(base > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// Rounded ends: thickness goes to 0 over `e` mm so the closed section caps itself.
const endRound = (x, e) => (x >= e ? 1 : Math.sqrt(Math.max(0, x / e)));

// Quarter of the annulus of Zinn owned by one rectus.
function annulusSegment(apex, R, az, halfSpan) {
  const pts = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const a = az - halfSpan + 2 * halfSpan * i / n;
    pts.push(new V3(apex.x + Math.cos(a) * R, apex.y + Math.sin(a) * R, apex.z + 0.2));
  }
  const dense = resamplePolyline(pts, 0.16);
  const aEnd = az + halfSpan;
  return sweep({
    points: dense, ring: 20,
    Bend: new V3(Math.cos(aEnd), Math.sin(aEnd), 0), outward: new V3(0, 0, 1),
    profile: (i, s, d) => {
      const e = sstep(0, 1.6, Math.min(s, d));
      const r = endRound(Math.min(s, d), 0.45);
      return { w: 0.82 * (0.75 + 0.25 * e), hOut: 0.34 * (0.6 + 0.4 * e) * r, hIn: 0.3 * (0.6 + 0.4 * e) * r, ex: 0.9, ey: 1.0 };
    },
    tendon: () => 10, kind: () => 0,
  });
}

const RECTI = {
  superior: { id: 'superior-rectus', tendon: 5.8, hMax: 2.55, hIn: 0.95, seed: 11 },
  inferior: { id: 'inferior-rectus', tendon: 5.5, hMax: 2.8, hIn: 1.05, seed: 23 },
  medial:   { id: 'medial-rectus',   tendon: 3.7, hMax: 3.0, hIn: 1.05, seed: 37 },
  lateral:  { id: 'lateral-rectus',  tendon: 8.8, hMax: 2.6, hIn: 0.95, seed: 51 },
};

function buildRectus(ctx, name, rg, lift, clearance = 0.12) {
  const { am, EYE } = ctx;
  const cfg = RECTI[name];
  const ins = am.rectusInsertion(name);
  const O = am.annulusPoint(ins.azimuth);
  const wp = wrapPath(O, ins.centre, rg, 0.1);
  const pts = resamplePolyline(wp.points, STEP);
  const ten = cfg.tendon, wI = ins.width / 2, hM = cfg.hMax;
  const Lt = wp.length, Ls = wp.tangentS;
  const wK = keys([[0, wI], [0.7, wI * 0.995], [ten * 0.5, wI * 0.935], [ten, wI * 0.935], [ten + 5, wI * 0.9], [ten + 14, wI * 0.84], [Lt * 0.72, wI * 0.64], [Lt - 6, 2.6], [Lt - 1.2, 2.0], [Lt, 1.75]]);
  const hK = keys([[0, 0.05], [1.2, 0.17], [ten * 0.6, 0.3], [ten, 0.46], [ten + 3, hM * 0.55], [ten + 10, hM * 0.92], [ten + 17, hM], [Lt * 0.7, hM * 0.86], [Lt - 7, 1.1], [Lt - 2, 0.75], [Lt, 0.55]]);
  const iK = keys([[0, 0.3], [1.5, 0.42], [Ls * 0.35, cfg.hIn], [Ls * 0.75, cfg.hIn * 0.5], [Ls, 0]]);
  const sw = sweep({
    points: pts, ring: 44, Bend: wp.normal, lift, clearance, liftSoft: 0.3,
    profile: (i, s, d) => {
      const r = endRound(d, 0.28) * endRound(s, 0.7);
      let hIn = s < Ls ? Math.max(0, iK(s)) : 0;
      const clear = pts[i].length() - rg;
      hIn = Math.min(hIn, Math.max(0, clear * 0.7));
      const t = sstep(ten - 1.5, ten + 3, d);
      const corner = d < 0.9 ? 1 - 0.06 * (1 - d / 0.9) ** 2 : 1;
      return { w: wK(d) * corner * (s < 0.7 ? 0.7 + 0.3 * Math.sqrt(s / 0.7) : 1), hOut: Math.max(0.02, hK(d)) * r, hIn: hIn * r, ex: 1 - 0.28 * t, ey: 2.1 - 1.25 * t };
    },
    wrap: (i, s) => (s >= Ls ? 1 : sstep(Ls - 5, Ls, s)),
    tendon: (i, s, d, lat) => {
      const u = lat / Math.max(0.5, wK(d));
      return Math.max(ten + 2.2 * u * u - d, 2.2 + 0.9 * u * u - s);
    },
  });
  const ring = annulusSegment(new V3(...EYE.nerveApex), EYE.annulusR, ins.azimuth, THREE.MathUtils.degToRad(46.5));
  return { cfg, sw, geometry: mergeGeoms([sw.geometry, ring.geometry]), wp, ins };
}

function buildSuperiorOblique(ctx, rg) {
  const { EYE, am } = ctx;
  const Q = new V3(...EYE.trochlea);
  const O = new V3(12.4, 7.9, -38.4);              // body of sphenoid, superomedial to the optic canal
  const P1 = new V3(14.3, 10.0, -24.0);
  const P2 = new V3(15.1, 11.2, -9.0);
  const I = am.SUPERIOR_OBLIQUE_INSERTION.clone();
  const dirIn = Q.clone().sub(P2).normalize();
  const E = Q.clone().addScaledVector(dirIn, 1.7);  // bend starts at the anterior lip of the trochlea
  const rb = 1.55;
  // Reflected tendon: leaves the trochlea posterolaterally, curves down onto the globe just nasal to the
  // superior rectus (held there by Tenon's capsule and the SR), then follows the great circle to the insertion.
  const e1 = I.clone().normalize();
  const TOUCH = THREE.MathUtils.degToRad(64);          // touchdown, measured along the great circle from the insertion
  let dirOut = wrapPath(Q, I, rg).tangentPoint.clone().sub(Q).normalize();
  let X, nb, th, P1c, P2c, Td, thD, e2, sg;
  const at = t => e1.clone().multiplyScalar(rg * Math.cos(t)).addScaledVector(e2, rg * Math.sin(t));
  for (let it = 0; it < 10; it++) {
    nb = dirOut.clone().addScaledVector(dirIn, -dirOut.dot(dirIn)).normalize();
    th = Math.acos(THREE.MathUtils.clamp(dirIn.dot(dirOut), -1, 1));
    const Cb0 = E.clone().addScaledVector(nb, rb);
    X = Cb0.clone().addScaledVector(nb, -rb * Math.cos(th)).addScaledVector(dirIn, rb * Math.sin(th));
    const nP = new V3().crossVectors(X, I).normalize();
    e2 = new V3().crossVectors(nP, e1);
    sg = Math.sign(Math.atan2(X.dot(e2), X.dot(e1))) || 1;
    thD = sg * TOUCH;
    Td = at(thD);
    const tTd = e1.clone().multiplyScalar(-Math.sin(thD)).addScaledVector(e2, Math.cos(thD)).multiplyScalar(-sg).normalize();
    const D = X.distanceTo(Td);
    P2c = Td.clone().addScaledVector(tTd, -0.45 * D);
    P1c = X.clone().addScaledVector(P2c.clone().sub(X).normalize(), 0.38 * D);
    dirOut = P1c.clone().sub(X).normalize();
  }
  const Cb = E.clone().addScaledVector(nb, rb);
  const approach = new THREE.CatmullRomCurve3([O, P1, P2, Q.clone().addScaledVector(dirIn, -2.4), E], false, 'centripetal').getPoints(200);
  const bend = [];
  const nbend = 24;
  for (let k = 1; k <= nbend; k++) {
    const a = th * k / nbend;
    bend.push(Cb.clone().addScaledVector(nb, -rb * Math.cos(a)).addScaledVector(dirIn, rb * Math.sin(a)));
  }
  const descent = new THREE.CubicBezierCurve3(X.clone(), P1c, P2c, Td.clone()).getPoints(120);
  const arc = [];
  const na = Math.ceil(Math.abs(thD) * rg / 0.1);
  for (let k = 1; k <= na; k++) arc.push(at(thD * (1 - k / na)));
  const refl = { points: [...descent, ...arc], normal: new V3().crossVectors(X, I).normalize(), tangentPoint: Td };
  const all = [...approach, ...bend, ...refl.points.slice(1)];
  const pts = resamplePolyline(all, STEP);
  // arc-length landmarks
  const sAt = p => { let best = 0, bd = Infinity, acc = 0, sB = 0; for (let i = 0; i < pts.length; i++) { if (i) acc += pts[i].distanceTo(pts[i - 1]); const d = pts[i].distanceToSquared(p); if (d < bd) { bd = d; best = i; sB = acc; } } return { i: best, s: sB }; };
  const eL = sAt(E), xL = sAt(X), tL = sAt(refl.tangentPoint);
  let Lt = 0; for (let i = 1; i < pts.length; i++) Lt += pts[i].distanceTo(pts[i - 1]);
  const sE = eL.s, sX = xL.s, sT = tL.s, sJ = sE - 10.5;
  const bellyW = keys([[0, 1.05], [2.5, 1.45], [sJ * 0.45, 2.15], [sJ * 0.8, 1.9], [sJ - 2.5, 1.3], [sJ + 1.5, 0.95], [sX + 1, 0.92]]);
  const dR = Lt - sX;   // reflected tendon length: flattens into a ribbon soon after the trochlea
  const fanW = keys(dR > 17.5
    ? [[0, 5.35], [3, 4.8], [6.5, 3.4], [9.5, 1.95], [12.5, 1.5], [dR - 4.5, 1.42], [dR - 2.0, 1.1], [dR, 0.95]]
    : [[0, 5.35], [3, 4.8], [6.5, 3.4], [9.5, 1.95], [12.5, 1.3], [dR - 2.5, 1.02], [dR, 0.95]]);
  const fanH = keys([[0, 0.1], [0.6, 0.2], [4, 0.26], [Math.max(5, Lt - sT), 0.34], [Lt - sX - 4, 0.5], [Lt - sX - 1.5, 0.7], [Lt - sX, 0.72]]);
  const sw = sweep({
    points: pts, ring: 36, Bend: refl.normal,
    profile: (i, s, d) => {
      const r = endRound(d, 0.25) * endRound(s, 0.8);
      if (s <= sX + 1) {
        const w = bellyW(s) * (0.5 + 0.5 * Math.sqrt(Math.min(1, s / 2.0)));
        const flat = 0.82 - 0.06 * sstep(sJ - 4, sJ, s);
        return { w, hOut: w * flat * r, hIn: w * flat * r, ex: 1, ey: 1 };
      }
      const t = sstep(sX + 1, sT, s);
      const w = fanW(d);
      const h = fanH(d) * r;
      const hIn = (1 - t) * fanH(d);
      return { w, hOut: h, hIn: hIn * r, ex: 1, ey: 1 + 0.8 * sstep(sX + 1, Math.min(sT, sX + 6), s) };
    },
    wrap: (i, s) => (s >= sT ? 1 : sstep(sT - 2.5, sT, s)),
    tendon: (i, s, d, lat) => {
      const w = s <= sX + 1 ? bellyW(s) : fanW(d);
      const u = lat / Math.max(0.4, w);
      return Math.max(s - sJ + 0.6 * u * u, 1.8 + 0.5 * u * u - s);
    },
  });
  // Trochlea: short cartilage sleeve with a flared anterior lip, revolved around the tendon path.
  const trochlea = trochleaGeometry(sw, sE - 4.3, sE + 0.35);
  return { sw, geometry: mergeGeoms([sw.geometry, trochlea]), Q, marks: { sE, sX, sT, sJ, iX: xL.i, Lt } };
}

function trochleaGeometry(sw, s0, s1) {
  const frameAt = (s, p, t, n, b) => {
    let i = 0; while (i < sw.S - 2 && sw.s[i + 1] < s) i++;
    const f = THREE.MathUtils.clamp((s - sw.s[i]) / ((sw.s[i + 1] - sw.s[i]) || 1), 0, 1);
    p.lerpVectors(sw.C[i], sw.C[i + 1], f);
    t.lerpVectors(sw.T[i], sw.T[i + 1], f).normalize();
    b.lerpVectors(sw.B[i], sw.B[i + 1], f).normalize();
    n.crossVectors(t, b).normalize();
  };
  // closed profile in (s, r): inner wall -> anterior flared lip -> outer wall -> posterior lip
  const len = s1 - s0, ri = 1.0, ro = 1.5, flare = 0.08;
  const prof = [];
  const lipR = (ro - ri) / 2;
  const radAt = u => ri + flare * Math.pow(sstep(0.55, 1, u), 1.6);
  const outAt = u => ro + flare * 0.8 * Math.pow(sstep(0.5, 1, u), 1.5) - 0.12 * Math.sin(Math.PI * u);
  const NI = 22;
  for (let k = 0; k <= NI; k++) { const u = k / NI; prof.push({ s: s0 + lipR + u * (len - 2 * lipR), r: radAt(u) }); }
  for (let k = 1; k < 10; k++) { const a = -Math.PI / 2 + Math.PI * k / 10; const c = (radAt(1) + outAt(1)) / 2, rr = (outAt(1) - radAt(1)) / 2; prof.push({ s: s1 - lipR + Math.cos(a) * rr * 0.9, r: c + Math.sin(a) * rr }); }
  for (let k = NI; k >= 0; k--) { const u = k / NI; prof.push({ s: s0 + lipR + u * (len - 2 * lipR), r: outAt(u) }); }
  for (let k = 1; k < 10; k++) { const a = Math.PI / 2 + Math.PI * k / 10; const c = (radAt(0) + outAt(0)) / 2, rr = (outAt(0) - radAt(0)) / 2; prof.push({ s: s0 + lipR + Math.cos(a) * rr * 0.9, r: c + Math.sin(a) * rr }); }
  const M = 30, K = prof.length;
  const pos = new Float32Array(K * M * 3), mu = new Float32Array(K * M * 3), sec = new Float32Array(K * M * 2);
  const ten = new Float32Array(K * M).fill(10), knd = new Float32Array(K * M).fill(2);
  const p = new V3(), t = new V3(), n = new V3(), b = new V3();
  for (let k = 0; k < K; k++) {
    frameAt(prof[k].s, p, t, n, b);
    for (let j = 0; j < M; j++) {
      const a = j / M * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const outer = sstep(ri + 0.12, ri + 0.3, prof[k].r);
      const nod = outer * (0.05 * Math.sin(5 * a + prof[k].s * 2.1) + 0.04 * Math.sin(7 * a - prof[k].s * 3.3 + 1.1) + 0.1 * Math.max(0, Math.cos(a - 0.8)) ** 2);
      const r = prof[k].r * (1 + 0.035 * Math.sin(2 * a + 0.7) + 0.02 * Math.sin(3 * a + prof[k].s * 1.3) + nod);
      const o = k * M + j;
      pos[o * 3] = p.x + r * (c * b.x + sn * n.x); pos[o * 3 + 1] = p.y + r * (c * b.y + sn * n.y); pos[o * 3 + 2] = p.z + r * (c * b.z + sn * n.z);
      mu[o * 3] = r * c * 1.3; mu[o * 3 + 1] = prof[k].s + r * sn * 1.3; mu[o * 3 + 2] = r;
      sec[o * 2] = 0.6; sec[o * 2 + 1] = 0.2;
    }
  }
  const idx = [];
  for (let k = 0; k < K; k++) for (let j = 0; j < M; j++) {
    const k1 = (k + 1) % K;
    const a0 = k * M + j, a1 = k * M + (j + 1) % M, b0 = k1 * M + j, b1 = k1 * M + (j + 1) % M;
    idx.push(a0, b0, a1, a1, b0, b1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aMU', new THREE.BufferAttribute(mu, 3));
  g.setAttribute('aSec', new THREE.BufferAttribute(sec, 2));
  g.setAttribute('aTend', new THREE.BufferAttribute(ten, 1));
  g.setAttribute('aKind', new THREE.BufferAttribute(knd, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // orientation: a vertex on the outer wall must face away from the axis
  const kOut = NI + 10 + Math.floor(NI / 2);
  frameAt(prof[kOut].s, p, t, n, b);
  const v = new V3().fromBufferAttribute(g.attributes.position, kOut * M).sub(p);
  const nn = new V3().fromBufferAttribute(g.attributes.normal, kOut * M);
  if (nn.dot(v) < 0) { for (let i = 0; i < idx.length; i += 3) { const x = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = x; } g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

function buildInferiorOblique(ctx, rg, lift) {
  const { EYE, am } = ctx;
  const O = new V3(...EYE.ioOrigin);
  const I = am.INFERIOR_OBLIQUE_INSERTION.clone();
  const wp = wrapPath(O, I, rg, 0.1);
  const pts = resamplePolyline(wp.points, STEP);
  const Lt = wp.length, Ls = wp.tangentS;
  const wK = keys([[0, 4.7], [1.5, 4.45], [6, 4.0], [14, 3.4], [20, 2.6], [Lt - 5, 1.9], [Lt - 1.5, 1.5], [Lt, 1.2]]);
  const hK = keys([[0, 0.05], [0.8, 0.25], [2.0, 0.85], [5, 1.75], [12, 2.05], [20, 1.85], [Lt - 5, 1.45], [Lt - 1.5, 1.0], [Lt, 0.7]]);
  const iK = keys([[0, 0.35], [2, 0.45], [Ls * 0.5, 0.55], [Ls, 0]]);
  const sw = sweep({
    points: pts, ring: 40, Bend: wp.normal, lift, clearance: 0.14,
    profile: (i, s, d) => {
      const r = endRound(d, 0.25) * endRound(s, 1.1);
      let hIn = s < Ls ? Math.max(0, iK(s)) : 0;
      hIn = Math.min(hIn, Math.max(0, (pts[i].length() - rg) * 0.7));
      const t = sstep(0.3, 3, d);                 // 0: thin lens at the insertion, 1: fleshy belly
      const round = 1 - sstep(3, 11, s);            // rounder, cord-like near the origin
      const tip = 0.42 + 0.58 * Math.sqrt(Math.min(1, s / 2.4));
      return { w: wK(d) * tip, hOut: Math.max(0.02, hK(d)) * r, hIn: hIn * r, ex: (1 - 0.25 * t) * (1 - round) + round, ey: (1.6 - 0.75 * t) * (1 - round) + round };
    },
    wrap: (i, s) => (s >= Ls ? 1 : sstep(Ls - 5, Ls, s)),
    tendon: (i, s, d, lat) => {
      const u = lat / Math.max(0.5, wK(d));
      return Math.max(1.3 + 0.7 * u * u - d, 1.5 + 0.6 * u * u - s);
    },
  });
  return { sw, geometry: sw.geometry, wp };
}

export function buildMuscleGeometry(ctx) {
  const Rs = ctx.L.scleraOuterR;
  const rg = Rs + 0.06;
  const so = buildSuperiorOblique(ctx, rg);
  const soField = heightField(so.sw, so.marks.iX, so.sw.S - 1, 4, 0.4);
  const sr = buildRectus(ctx, 'superior', rg, soField, 0.07);
  const ir = buildRectus(ctx, 'inferior', rg);
  const io = buildInferiorOblique(ctx, rg, heightField(ir.sw, 0, ir.sw.S - 1, 4, 0.5));
  const lr = buildRectus(ctx, 'lateral', rg, heightField(io.sw, 0, io.sw.S - 1, 4, 0.5));
  const mr = buildRectus(ctx, 'medial', rg);
  return { so, sr, ir, io, lr, mr };
}
