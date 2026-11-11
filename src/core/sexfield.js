// Sex-morph deformation field (♂ → ♀), evaluated on the GPU in every material (core/shader.js).
// File: assets/sexfield.json (glTF metres), maps the MALE anatomy to the FEMALE anatomy:
//   { centers:[[x,y,z]…], weights:[[x,y,z]…], const:[x,y,z], linear:[[3×3] row-major] }
//   displacement(p) = const + linear·p + Σ_i weights_i · |p − centers_i|   (3-D biharmonic RBF)
//   (legacy form { affine:[12] } = row-major 3×4 [linear | const] is also accepted.)
//   Final position = p + uSex · displacement(p); normals use the analytic Jacobian of the same field.
//   Not applied to the Skin / Eyelashes nodes (they carry their own consistent 'female' morph target).
//   v3 extras (optional): eyes:{L:[dx,dy,dz],R:[…]} rigid ♀ offsets of the eyeball centres (the globes are excluded from
//   the field and their pivots move instead); bust:{m:[y0,w],f:[y0,w]} neck-base cut of each textured skin.
// Missing / invalid file → identity field (no deformation), reported in the returned status.
import * as THREE from 'three';
import { U, MAX_SF } from './shader.js';

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const vec3ok = (a) => Array.isArray(a) && a.length === 3 && a.every(num);

export const SF_EXTRA = { eyes: null, bust: null };
export function setSexField(f) {
  if (f && typeof f === 'object') {
    const e = f.eyes; SF_EXTRA.eyes = e && vec3ok(e.L) && vec3ok(e.R) ? { L: new THREE.Vector3().fromArray(e.L), R: new THREE.Vector3().fromArray(e.R) } : null;
    const b = f.bust, ok2 = (a) => Array.isArray(a) && a.length === 2 && a.every(num);
    SF_EXTRA.bust = b && ok2(b.m) && ok2(b.f) ? { m: b.m, f: b.f } : null;
  }
  if (!f || !Array.isArray(f.centers) || !Array.isArray(f.weights) || f.centers.length !== f.weights.length) return 'invalid';
  if (!f.centers.every(vec3ok) || !f.weights.every(vec3ok)) return 'invalid';
  let A = new Array(12).fill(0);
  if (Array.isArray(f.linear) && f.linear.length === 3 && f.linear.every(vec3ok) && vec3ok(f.const)) {
    A = [f.linear[0][0], f.linear[0][1], f.linear[0][2], f.const[0], f.linear[1][0], f.linear[1][1], f.linear[1][2], f.const[1], f.linear[2][0], f.linear[2][1], f.linear[2][2], f.const[2]];
  } else if (Array.isArray(f.affine) && f.affine.length === 12 && f.affine.every(num)) A = f.affine;
  else if (vec3ok(f.const)) { A[3] = f.const[0]; A[7] = f.const[1]; A[11] = f.const[2]; }
  const n = Math.min(MAX_SF, f.centers.length);
  for (let i = 0; i < MAX_SF; i++) {
    if (i < n) { U.uSFC.value[i].fromArray(f.centers[i]); U.uSFW.value[i].fromArray(f.weights[i]); }
    else { U.uSFC.value[i].set(0, 0, 0); U.uSFW.value[i].set(0, 0, 0); }
  }
  U.uSFCount.value = n;
  U.uSFA.value.set(A[0], A[1], A[2], A[4], A[5], A[6], A[8], A[9], A[10]);   // Matrix3.set takes row-major
  U.uSFT.value.set(A[3], A[7], A[11]);
  return f.centers.length > MAX_SF ? `loaded (truncated ${f.centers.length}→${MAX_SF})` : `loaded (${n} centres)`;
}

// CPU twin of the GPU field (used for probes/tests; same formula)
export function evalSexField(p, out = new THREE.Vector3()) {
  out.copy(p).applyMatrix3(U.uSFA.value).add(U.uSFT.value);
  const r = new THREE.Vector3();
  for (let i = 0; i < U.uSFCount.value; i++) { r.subVectors(p, U.uSFC.value[i]); out.addScaledVector(U.uSFW.value[i], r.length()); }
  return out;
}

export async function loadSexField(url = 'assets/sexfield.json') {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) return 'identity (no sexfield.json)';
    const j = await r.json();
    const s = setSexField(j);
    return s === 'invalid' ? 'identity (invalid sexfield.json)' : s;
  } catch { return 'identity (no sexfield.json)'; }
}
