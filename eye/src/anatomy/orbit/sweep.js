// Geometry toolkit for the extraocular muscles: globe-wrapping paths, profiled sweeps with a
// closed superelliptic cross-section, conforming to the globe, and "drape" lifting of one muscle
// over another (height fields). All units mm, eye frame (+Z anterior, +Y superior, +X nasal).
import * as THREE from 'three';

const V3 = THREE.Vector3;

// Cubic Hermite through [x, y] keys (sorted by x) with Catmull-Rom tangents; clamped outside.
export function keys(k) {
  const n = k.length;
  const m = k.map((_, i) => {
    const a = k[Math.max(0, i - 1)], b = k[Math.min(n - 1, i + 1)];
    return (b[1] - a[1]) / ((b[0] - a[0]) || 1);
  });
  return x => {
    if (x <= k[0][0]) return k[0][1];
    if (x >= k[n - 1][0]) return k[n - 1][1];
    let i = 0; while (x > k[i + 1][0]) i++;
    const [x0, y0] = k[i], [x1, y1] = k[i + 1];
    const h = x1 - x0, t = (x - x0) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m[i + 1];
  };
}

export const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Uniform arc-length resampling of a polyline.
export function resamplePolyline(pts, step) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = L[L.length - 1];
  const n = Math.max(2, Math.ceil(total / step) + 1);
  const out = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = total * i / (n - 1);
    while (k < pts.length - 2 && L[k + 1] < s) k++;
    const t = (s - L[k]) / ((L[k + 1] - L[k]) || 1);
    out.push(pts[k].clone().lerp(pts[k + 1], Math.min(1, Math.max(0, t))));
  }
  return out;
}

// Straight line from `origin` to its tangent point on the sphere of radius rg (in the plane through
// the globe centre, origin and end), then the great-circle arc to `end` (lifted to rg).
export function wrapPath(origin, end, rg, step = 0.2) {
  const e1 = end.clone().normalize();
  const n = new V3().crossVectors(origin, end).normalize();
  const e2 = new V3().crossVectors(n, e1);
  const rO = origin.length();
  const thO = Math.atan2(origin.dot(e2), origin.dot(e1));
  const sg = Math.sign(thO) || 1;
  let thT = thO - sg * Math.acos(Math.min(1, rg / rO));
  if (Math.sign(thT) !== sg) thT = 0;
  const at = th => e1.clone().multiplyScalar(rg * Math.cos(th)).addScaledVector(e2, rg * Math.sin(th));
  const T = at(thT);
  const lineLen = origin.distanceTo(T), arcLen = Math.abs(thT) * rg;
  const pts = [];
  const nl = Math.max(2, Math.ceil(lineLen / step));
  for (let i = 0; i < nl; i++) pts.push(origin.clone().lerp(T, i / nl));
  const na = Math.max(1, Math.ceil(arcLen / step));
  for (let i = 0; i <= na; i++) pts.push(at(thT * (1 - i / na)));
  return { points: pts, tangentS: lineLen, length: lineLen + arcLen, normal: n, tangentPoint: T, arcLen };
}

// Profiled sweep. spec:
//   points: Vector3[] (origin -> insertion, dense), Bend: width axis at the insertion end,
//   ring: vertices around the section,
//   profile(i, s, d) -> { w, hOut, hIn, ex, ey }   half-width, thickness above / below the base line,
//                                                  superellipse exponents (lateral / vertical)
//   wrap(i, s, d) -> k (0..1)        1 = cross-section conforms to the globe (concentric)
//   tendon(i, s, d, lat) -> signed mm (>0 inside tendinous tissue)
//   kind(i, s, d) -> 0 muscle/tendon, 2 cartilage
//   lift(P) -> radius of an obstacle's top surface under P (or -Infinity): the section is raised to clear it.
export function sweep(spec) {
  const P = spec.points, S = P.length, M = spec.ring || 40;
  const clearance = spec.clearance ?? 0.12, soft = spec.liftSoft ?? 0.22;
  const s = new Float32Array(S);
  for (let i = 1; i < S; i++) s[i] = s[i - 1] + P[i].distanceTo(P[i - 1]);
  const Ltot = s[S - 1];
  const T = P.map((p, i) => P[Math.min(S - 1, i + 1)].clone().sub(P[Math.max(0, i - 1)]).normalize());
  const B = new Array(S);
  B[S - 1] = spec.Bend.clone().addScaledVector(T[S - 1], -spec.Bend.dot(T[S - 1])).normalize();
  for (let i = S - 2; i >= 0; i--) {
    const b = B[i + 1].clone(); b.addScaledVector(T[i], -b.dot(T[i])).normalize(); B[i] = b;
  }
  const nEnd = new V3().crossVectors(T[S - 1], B[S - 1]);
  const flip = spec.outward ? (nEnd.dot(spec.outward) < 0 ? -1 : 1) : (nEnd.dot(P[S - 1]) < 0 ? -1 : 1);
  const N = T.map((t, i) => new V3().crossVectors(t, B[i]).multiplyScalar(flip));

  const pos = new Float32Array(S * M * 3), mu = new Float32Array(S * M * 3), sec = new Float32Array(S * M * 2);
  const ten = new Float32Array(S * M), knd = new Float32Array(S * M);
  const nsA = new Float32Array(S * M * 3), flatA = new Float32Array(S * M);
  const W = new Float32Array(S), topLat = [], topR = [];
  const cphi = [], sphi = [];
  for (let j = 0; j < M; j++) { const a = j / M * Math.PI * 2; cphi.push(Math.cos(a)); sphi.push(Math.sin(a)); }
  const Pl = new V3(), Pb = new V3(), Nr = new V3(), Ns = new V3(), out = new V3();
  let minR = Infinity;
  for (let i = 0; i < S; i++) {
    const d = Ltot - s[i];
    const pr = spec.profile(i, s[i], d);
    const k = spec.wrap ? spec.wrap(i, s[i], d) : 0;
    const kd = spec.kind ? spec.kind(i, s[i], d) : 0;
    W[i] = pr.w;
    const rC = P[i].length();
    const tl = [], tr = [];
    for (let j = 0; j < M; j++) {
      const c = cphi[j], sn = sphi[j];
      const cx = Math.sign(c) * Math.pow(Math.abs(c), pr.ex);
      const cy = Math.sign(sn) * Math.pow(Math.abs(sn), pr.ey);
      const lat = pr.w * cx;
      Pl.copy(P[i]).addScaledVector(B[i], lat);
      if (k > 0) { Pb.copy(Pl).multiplyScalar(rC / Pl.length()); Pb.lerpVectors(Pl, Pb, k); } else Pb.copy(Pl);
      Nr.copy(Pb).normalize();
      Ns.copy(N[i]).lerp(Nr, k).normalize();
      const y = cy >= 0 ? pr.hOut * cy : pr.hIn * cy;
      let lift = 0;
      if (spec.lift) {
        let H = spec.lift(Pb);
        if (H > -1e8) {
          // rays diverge: re-evaluate the obstacle at the lifted height and keep the higher estimate
          for (let it = 0; it < 2; it++) { Nr.copy(Pb).setLength(H + clearance); const H2 = spec.lift(Nr); if (H2 > H) H = H2; }
          const a = H + clearance - Pb.length() + pr.hIn * Math.abs(cy);
          lift = 0.5 * (a + Math.sqrt(a * a + soft * soft));
          if (lift < 0.004) lift = 0;
        }
      }
      out.copy(Pb).addScaledVector(Ns, y + lift);
      const o = (i * M + j);
      pos[o * 3] = out.x; pos[o * 3 + 1] = out.y; pos[o * 3 + 2] = out.z;
      mu[o * 3] = lat; mu[o * 3 + 1] = s[i]; mu[o * 3 + 2] = y + lift;
      sec[o * 2] = cy; sec[o * 2 + 1] = Math.abs(cx);
      ten[o] = spec.tendon ? spec.tendon(i, s[i], d, lat) : 0;
      knd[o] = kd;
      const sg = cy < 0 ? -1 : 1;
      nsA[o * 3] = Ns.x * sg; nsA[o * 3 + 1] = Ns.y * sg; nsA[o * 3 + 2] = Ns.z * sg;
      flatA[o] = 1 - sstep(0.3, 1.1, pr.hOut + pr.hIn);
      const r = out.length(); if (r < minR) minR = r;
      if (sn >= -1e-6 && j <= M / 2) { tl.push(lat); tr.push(r); }
    }
    topLat.push(tl); topR.push(tr);
  }
  const idx = [];
  for (let i = 0; i < S - 1; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = i * M + (j + 1) % M, c = (i + 1) * M + j, e = (i + 1) * M + (j + 1) % M;
    idx.push(a, b, c, b, e, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aMU', new THREE.BufferAttribute(mu, 3));
  g.setAttribute('aSec', new THREE.BufferAttribute(sec, 2));
  g.setAttribute('aTend', new THREE.BufferAttribute(ten, 1));
  g.setAttribute('aKind', new THREE.BufferAttribute(knd, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Orientation check: at mid-length the phi=0 vertex must have its normal along +B.
  const im = Math.floor(S / 2), nrm = g.attributes.normal;
  const test = new V3(nrm.getX(im * M), nrm.getY(im * M), nrm.getZ(im * M));
  if (test.dot(B[im]) < 0) {
    for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; }
    g.setIndex(idx); g.computeVertexNormals();
  }
  // Thin sheets (tendons): shade like the sheet they are, not like a rolled rim at the edges.
  {
    const na = g.attributes.normal.array;
    for (let o = 0; o < S * M; o++) {
      const f = flatA[o]; if (f <= 0) continue;
      let x = na[o * 3] + (nsA[o * 3] - na[o * 3]) * f, y = na[o * 3 + 1] + (nsA[o * 3 + 1] - na[o * 3 + 1]) * f, z = na[o * 3 + 2] + (nsA[o * 3 + 2] - na[o * 3 + 2]) * f;
      const l = Math.hypot(x, y, z) || 1; na[o * 3] = x / l; na[o * 3 + 1] = y / l; na[o * 3 + 2] = z / l;
    }
    g.attributes.normal.needsUpdate = true;
  }
  g.computeBoundingSphere();
  return { geometry: g, C: P, T, B, N, W, S, M, s, Ltot, topLat, topR, minR, positions: pos };
}

// Height field of a built sweep: radius of its top surface under a query point (or -Infinity).
// The top profile of every sample is morphologically dilated with a cone of the given slope, so a muscle
// draped over this one slopes off its edges like soft tissue instead of stepping down.
export function heightField(sw, i0 = 0, i1 = sw.S - 1, reach = 4, slope = 0.8) {
  const dv = new V3();
  const STEPL = 0.1, PAD = 3.5;
  const dil = new Array(sw.S);
  const dilated = i => {
    if (dil[i]) return dil[i];
    const tl = sw.topLat[i], tr = sw.topR[i];
    const lo = tl[tl.length - 1] - PAD, hi = tl[0] + PAD;
    const n = Math.ceil((hi - lo) / STEPL) + 1;
    // linear profile on the grid, then dilation with a cone of the given slope
    const g = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const x = lo + k * STEPL;
      if (x > tl[0] || x < tl[tl.length - 1]) { g[k] = -1e9; continue; }
      let j = 0; while (j < tl.length - 2 && tl[j + 1] > x) j++;
      const t = (tl[j] - x) / ((tl[j] - tl[j + 1]) || 1);
      g[k] = tr[j] + (tr[j + 1] - tr[j]) * t;
    }
    const v = new Float32Array(n);
    const win = Math.ceil(PAD / STEPL);
    for (let k = 0; k < n; k++) {
      let best = -1e9;
      for (let m = Math.max(0, k - win); m <= Math.min(n - 1, k + win); m++) { const h = g[m] - Math.abs(k - m) * STEPL * slope; if (h > best) best = h; }
      v[k] = best;
    }
    return (dil[i] = { lo, n, v });
  };
  return q => {
    let best = -1, bd = Infinity;
    for (let i = i0; i <= i1; i++) { const d = q.distanceToSquared(sw.C[i]); if (d < bd) { bd = d; best = i; } }
    const i = best, w = sw.W[i];
    if (bd > (w + reach) * (w + reach) + 16) return -Infinity;
    dv.subVectors(q, sw.C[i]);
    const along = dv.dot(sw.T[i]);
    let fall = 0;
    if (i === i0 && along < 0) fall = -along;
    if (i === i1 && along > 0) fall = along;
    const lat = dv.dot(sw.B[i]);
    const D = dilated(i);
    const f = (lat - D.lo) / STEPL;
    let r;
    if (f <= 0) r = D.v[0] + f * STEPL * slope;
    else if (f >= D.n - 1) r = D.v[D.n - 1] - (f - D.n + 1) * STEPL * slope;
    else { const k = Math.floor(f), t = f - k; r = D.v[k] * (1 - t) + D.v[k + 1] * t; }
    return r - fall * slope;
  };
}

// Sweep of a closed 2D profile (a[k] along the curve, r[k] radius) revolved around a framed curve.
// frames: { point(a) -> V3, N(a), B(a) }; returns positions + per-vertex (profile index, theta).
export function revolve(frames, prof, M, attrib) {
  const K = prof.length;
  const pos = new Float32Array(K * M * 3);
  const extra = attrib ? attrib.create(K * M) : null;
  const p = new V3(), n = new V3(), b = new V3();
  for (let k = 0; k < K; k++) {
    const { a, r } = prof[k];
    frames.at(a, p, n, b);
    for (let j = 0; j < M; j++) {
      const th = j / M * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      const o = k * M + j;
      let x = p.x + r * (c * n.x + sn * b.x), y = p.y + r * (c * n.y + sn * b.y), z = p.z + r * (c * n.z + sn * b.z);
      if (frames.warp) { const w = frames.warp(x, y, z, prof[k], th); x = w[0]; y = w[1]; z = w[2]; }
      pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;
      if (attrib) attrib.fill(extra, o, prof[k], k, th, r);
    }
  }
  const idx = [];
  for (let k = 0; k < K - 1; k++) for (let j = 0; j < M; j++) {
    const a0 = k * M + j, a1 = k * M + (j + 1) % M, b0 = (k + 1) * M + j, b1 = (k + 1) * M + (j + 1) % M;
    idx.push(a0, b0, a1, a1, b0, b1);
  }
  return { pos, idx, extra, K, M };
}
