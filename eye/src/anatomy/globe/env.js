// Studio environment for the wet surfaces (tear film on the cornea, conjunctiva).
// A procedural HDR equirect whose softboxes sit exactly where the stage lights are
// (key high-left-front, cool rim behind-right, warm fill low), so the catch-lights on the
// cornea agree with the direct lighting. Three converts it to PMREM on first use.
import * as THREE from 'three';

let cached = null;

export function studioEnv() {
  if (cached) return cached;
  const W = 1024, H = 512;
  const data = new Uint16Array(W * H * 4);
  const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
  // Softboxes: centre direction, up hint, gnomonic half-extents, corner radius, edge softness, radiance, colour.
  const boxes = [
    { c: V(-40, 55, 70), up: V(0, 1, 0), hw: 0.22, hh: 0.16, rad: 0.05, soft: 0.016, I: 36, col: [1.0, 0.95, 0.88], hot: 0.6, fall: 0.3 },   // key softbox (hot centre, darker edges)
    { c: V(60, 20, -80), up: V(0, 1, 0), hw: 0.07, hh: 0.62, rad: 0.05, soft: 0.02, I: 6, col: [0.78, 0.88, 1.0], hot: 0.1 },     // rim strip
    { c: V(10, -60, 20), up: V(0, 0, 1), hw: 0.55, hh: 0.2, rad: 0.12, soft: 0.1, I: 1.6, col: [1.0, 0.72, 0.6], hot: 0 },          // warm bounce
    { c: V(46, 30, 62), up: V(0, 1, 0), hw: 0.045, hh: 0.045, rad: 0.044, soft: 0.01, I: 60, col: [1.0, 0.98, 0.95], hot: 0 },     // small kicker (second catch-light)
    { c: V(-75, 8, -30), up: V(0, 1, 0), hw: 0.05, hh: 0.5, rad: 0.04, soft: 0.03, I: 3.5, col: [0.85, 0.9, 1.0], hot: 0 },        // faint left edge strip
  ];
  for (const b of boxes) {
    b.r = new THREE.Vector3().crossVectors(b.up, b.c).normalize();
    b.u = new THREE.Vector3().crossVectors(b.c, b.r).normalize();
  }
  const d = new THREE.Vector3();
  const toHalf = THREE.DataUtils.toHalfFloat;
  for (let y = 0; y < H; y++) {
    const lat = ((y + 0.5) / H - 0.5) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W - 0.5) * Math.PI * 2;
      d.set(cl * Math.cos(lon), sl, cl * Math.sin(lon));
      // dark studio: faint cool ceiling, near-black floor
      const up = Math.max(0, d.y);
      let r = 0.002 + 0.008 * up * up, g = 0.0023 + 0.009 * up * up, bl = 0.003 + 0.012 * up * up;
      const dn = Math.max(0, -d.y); r += 0.002 * dn; g += 0.0015 * dn; bl += 0.001 * dn;
      for (const b of boxes) {
        const z = d.dot(b.c); if (z <= 0.05) continue;
        const gx = d.dot(b.r) / z, gy = d.dot(b.u) / z;
        const qx = Math.abs(gx) - (b.hw - b.rad), qy = Math.abs(gy) - (b.hh - b.rad);
        const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - b.rad;
        if (sd > b.soft * 3) continue;
        let m = 1 - smooth((sd + b.soft) / (2 * b.soft));
        if (b.hot) m *= 1 + b.hot * Math.exp(-(gx * gx / (b.hw * b.hw) + gy * gy / (b.hh * b.hh)) * 1.6) - b.hot * 0.35;
        // internal falloff: a real diffuser is brightest in the middle and dims towards its frame
        if (b.fall) m *= 1 - b.fall * Math.pow(Math.min(1, Math.max(Math.abs(gx) / b.hw, Math.abs(gy) / b.hh)), 3);
        const I = b.I * m;
        r += I * b.col[0]; g += I * b.col[1]; bl += I * b.col[2];
      }
      const o = (y * W + x) * 4;
      data[o] = toHalf(r); data[o + 1] = toHalf(g); data[o + 2] = toHalf(bl); data[o + 3] = toHalf(1);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}

function smooth(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }
