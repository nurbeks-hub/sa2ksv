// Landmarks shared by the vessel builders of this module: the optic-nerve frame (arc length measured from
// the scleral exit), seam points where one part hands a vessel to the next, and muscle targets.
import * as THREE from 'three';
import { EYE, L } from '../../config.js';
import * as am from '../../lib/anatomyMath.js';
import { rng } from '../../lib/materials.js';

let cache = null;
export function nerveFrame() {
  if (cache) return cache;
  const curve = am.nerveCurve();
  curve.arcLengthDivisions = 800;
  const total = curve.getLength();
  const exit = am.retinaMap(am.DISC_MAP.x, am.DISC_MAP.y, L.scleraOuterR + 0.2);
  // arc length of the scleral exit point along the curve
  let sExit = 0, best = 1e9;
  for (let i = 0; i <= 400; i++) {
    const u = i / 400 * 0.2; const p = curve.getPointAt(u); const d = p.distanceTo(exit);
    if (d < best) { best = d; sExit = u * total; }
  }
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
  // Position / frame at b mm behind the scleral exit (b may be negative = inside the globe, or beyond the apex).
  function at(b) {
    const s = sExit + b;
    let p, T;
    if (s <= 0) { p = curve.getPointAt(0); T = curve.getTangentAt(0); p = p.clone().addScaledVector(T, s); }
    else if (s >= total) { p = curve.getPointAt(1); T = curve.getTangentAt(1); p = p.clone().addScaledVector(T, s - total); }
    else { p = curve.getPointAt(s / total); T = curve.getTangentAt(s / total); }
    T = T.clone().normalize();                                        // points from the globe towards the apex
    const N = Y.clone().addScaledVector(T, -Y.dot(T)).normalize();    // superior
    const M = X.clone().addScaledVector(T, -X.dot(T)).addScaledVector(N, -X.dot(N)).normalize(); // medial (nasal)
    return { p, T, N, M };
  }
  // point at b behind the exit, offset in the nerve cross-section: (m = medial mm, n = superior mm)
  function off(b, m, n) { const f = at(b); return f.p.clone().addScaledVector(f.M, m).addScaledVector(f.N, n); }
  // same, by angle (0 = medial, PI/2 = superior) and radius
  function ring(b, ang, rad) { return off(b, Math.cos(ang) * rad, Math.sin(ang) * rad); }
  const lengthToApex = total - sExit;
  cache = { curve, total, sExit, at, off, ring, lengthToApex, sheathR: EYE.sheathDiameter / 2, nerveR: EYE.nerveDiameter / 2 };
  return cache;
}

// Disc frame on a sphere of radius r: centre, nasal (x) and superior (y) tangents.
export function discFrame(r) {
  const c = am.retinaMap(am.DISC_MAP.x, am.DISC_MAP.y, r);
  const n = c.clone().normalize();
  const tx = new THREE.Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize();
  const ty = new THREE.Vector3().crossVectors(tx, n).normalize();
  if (ty.y < 0) ty.negate();
  // point around the disc at angle a (0 = nasal, PI/2 = superior) and tangential distance rho, projected to radius rr
  const around = (a, rho, rr = r) => c.clone().addScaledVector(tx, Math.cos(a) * rho).addScaledVector(ty, Math.sin(a) * rho).normalize().multiplyScalar(rr);
  return { c, n, tx, ty, around };
}

// Where the ophthalmic artery hands over to the posterior ciliary part (mm behind the globe along the nerve).
export const PCA_SEAM_B = 8.0;
export function pcaSeams() {
  const nf = nerveFrame();
  const r = nf.sheathR + 0.35;
  return {
    lateral: nf.off(PCA_SEAM_B, -r, 0.35),
    medial: nf.off(PCA_SEAM_B + 0.4, r, 0.2),
  };
}

// Point where the central retinal artery pierces the nerve sheath (inferomedial), and where the vein leaves it.
export function craEntry() {
  const nf = nerveFrame();
  const a = -Math.PI * 0.3; // inferomedial (0 = medial, -PI/2 = inferior)
  return {
    art: nf.ring(EYE.craEntryBehindGlobe, a, nf.sheathR + 0.05),
    vein: nf.ring(EYE.craEntryBehindGlobe + 0.8, a - 0.32, nf.sheathR + 0.05),
    angle: a,
  };
}

// A point inside a rectus belly (for the muscular branches of the ophthalmic artery).
export function rectusBelly(name, f = 0.42) {
  const ins = am.rectusInsertion(name);
  const A = am.annulusPoint(ins.azimuth);
  // the muscle leaves the globe roughly 8-10 mm behind its insertion
  const T = am.behindLimbus(EYE.recti[name].fromLimbus + 9.5, ins.azimuth, L.scleraOuterR + 1.6);
  const p = new THREE.Vector3().lerpVectors(A, T, f);
  return { p, A, T, ins };
}

// Scleral foramina as the globe module draws them (globe/sclera.js: rng(4242) with the same call order:
// 16 short-PCA pits x 3 draws, the two long-PCA pits, then 7 anterior-ciliary pits x 1 draw), so the ciliary
// arteries of this module pierce the sclera exactly through its holes. Suggested as am.SCLERAL_FORAMINA.
let foramina = null;
export function scleralForamina() {
  if (foramina) return foramina;
  const Rs = L.scleraOuterR;
  const Do = am.retinaMap(am.DISC_MAP.x, am.DISC_MAP.y, Rs).normalize();
  const qo = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), Do);
  const eho = new THREE.Vector3(1, 0, 0).applyQuaternion(qo), evo = new THREE.Vector3(0, 1, 0).applyQuaternion(qo);
  const R = rng(4242);
  // direction at geodesic distance dist (mm) from the canal axis, at angle a (0 = along eho ~ nasal, PI/2 = superior)
  const around = (a, dist, r = 1) => Do.clone().multiplyScalar(Math.cos(dist / Rs))
    .addScaledVector(eho, Math.cos(a) * Math.sin(dist / Rs)).addScaledVector(evo, Math.sin(a) * Math.sin(dist / Rs)).normalize().multiplyScalar(r);
  const spca = [];
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2 + R.range(-0.18, 0.18);
    const dist = R.range(2.9, 4.6);
    const radius = R.range(0.1, 0.17);
    spca.push({ a, dist, radius, dir: around(a, dist) });
  }
  const lpca = [1, -1].map(side => { const dist = side > 0 ? 4.2 : 5.0; return { side, dist, a: side > 0 ? 0 : Math.PI, dir: around(side > 0 ? 0 : Math.PI, dist) }; });
  const aca = [];
  for (const [name, count] of [['medial', 2], ['inferior', 2], ['superior', 2], ['lateral', 1]]) {
    const ins = am.rectusInsertion(name);
    for (let c = 0; c < count; c++) {
      const off = count === 1 ? 0 : (c ? 1 : -1) * 0.22;
      const d = R.range(3.0, 4.0);
      aca.push({ name, c, off, d, az: ins.azimuth + off });
    }
  }
  foramina = { Do, eho, evo, around, spca, lpca, aca };
  return foramina;
}
