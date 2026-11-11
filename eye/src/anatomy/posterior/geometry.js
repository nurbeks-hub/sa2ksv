// Mesh construction helpers for the posterior segment (retina, macula, disc, choroid).
// Everything lives on concentric spheres about the globe centre; surfaces are built as polar grids
// so that the anatomy (fovea pit, dentate ora, disc hole) is placed exactly, not approximated by a UV sphere.
import * as THREE from 'three';

const TAU = Math.PI * 2;

// Unit direction from a polar angle measured from the POSTERIOR pole (-Z) and an azimuth
// (0 = +X nasal, PI/2 = +Y superior) — the same convention as am.retinaMap.
export function dirPost(p, az, out = new THREE.Vector3()) {
  const s = Math.sin(p);
  return out.set(s * Math.cos(az), s * Math.sin(az), -Math.cos(p));
}

export class Builder {
  constructor() { this.pos = []; this.attr = []; this.idx = []; }
  v(x, y, z, a = 0) { this.pos.push(x, y, z); this.attr.push(a); return this.pos.length / 3 - 1; }
  vv(v, a = 0) { return this.v(v.x, v.y, v.z, a); }
  t(a, b, c) { this.idx.push(a, b, c); }
  mark() { return this.idx.length; }
  // Make every triangle in [from, to) face along expected(cx, cy, cz) -> [ex, ey, ez].
  orient(from, to, expected) {
    const P = this.pos, I = this.idx;
    for (let k = from; k < to; k += 3) {
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const e = expected((P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3);
      if (nx * e[0] + ny * e[1] + nz * e[2] < 0) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
    }
  }
  geometry(attrName = 'aSide') {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    if (attrName) g.setAttribute(attrName, new THREE.Float32BufferAttribute(this.attr, 1));
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// Closed band between two rings of equal length.
export function band(B, r0, r1) {
  const n = r0.length;
  for (let j = 0; j < n; j++) {
    const j1 = (j + 1) % n;
    B.t(r0[j], r1[j], r0[j1]);
    B.t(r0[j1], r1[j], r1[j1]);
  }
}
export function fan(B, c, ring) {
  const n = ring.length;
  for (let j = 0; j < n; j++) B.t(c, ring[j], ring[(j + 1) % n]);
}
// Stitch two closed rings with different sample counts by azimuth (angles ascending in [0, TAU), both starting at 0).
export function stitch(B, rA, angA, rB, angB) {
  const nA = rA.length, nB = rB.length;
  let i = 0, j = 0;
  while (i < nA || j < nB) {
    const na = i + 1 < nA ? angA[i + 1] : TAU;
    const nb = j + 1 < nB ? angB[j + 1] : TAU;
    if (j >= nB || (i < nA && na <= nb)) { B.t(rA[i % nA], rA[(i + 1) % nA], rB[j % nB]); i++; }
    else { B.t(rA[i % nA], rB[(j + 1) % nB], rB[j % nB]); j++; }
  }
}

// Spherical cap about the posterior pole: a uniform central disk (for the macula / fovea pit)
// stitched to an annulus whose azimuth samples follow the dentate ora serrata.
//   R        : radius used for the map (polar = rho / R)
//   radius   : (rho) -> actual radius (pit displacement)
//   rhoM     : radius (mm, along the surface) of the central disk
//   KC, AZC  : rings / azimuth samples of the central disk
//   azA, rhoEdge : azimuth samples of the annulus and the edge rho at each
//   KA       : rings of the annulus
// Returns { centralRings (arrays of vertex ids), edgeRing (vertex ids) }.
export function capGrid(B, { R, radius, rhoM, KC, AZC, KC_pow = 1.6, azA, rhoEdge, KA, side = 0 }) {
  const tmp = new THREE.Vector3();
  const place = (rho, az) => dirPost(rho / R, az, tmp).multiplyScalar(radius(rho));
  const angC = Array.from({ length: AZC }, (_, j) => (j / AZC) * TAU);
  const center = B.vv(place(0, 0), side);
  let prev = null;
  for (let k = 1; k <= KC; k++) {
    const rho = rhoM * Math.pow(k / KC, KC_pow);
    const ring = angC.map(az => B.vv(place(rho, az), side));
    if (k === 1) fan(B, center, ring); else band(B, prev, ring);
    prev = ring;
  }
  if (!azA) return { edgeRing: prev };
  let ringA = azA.map(az => B.vv(place(rhoM, az), side));
  stitch(B, prev, angC, ringA, azA);
  for (let m = 1; m <= KA; m++) {
    const t = m / KA;
    const ring = azA.map((az, j) => B.vv(place(rhoM + (rhoEdge[j] - rhoM) * t, az), side));
    band(B, ringA, ring);
    ringA = ring;
  }
  return { edgeRing: ringA };
}

// Rim strip between two rings of equal count (a cut face). attr goes from a0 (ring0) to a1 (ring1).
export function rimStrip(B, pts0, pts1, a0, a1) {
  const r0 = pts0.map(p => B.vv(p, a0));
  const r1 = pts1.map(p => B.vv(p, a1));
  band(B, r0, r1);
}
