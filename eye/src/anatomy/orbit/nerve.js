// Optic nerve (intraorbital segment) along am.nerveCurve(): fascicular neural core, translucent dural
// sheath with the subarachnoid gap, fine pial vessels, and a dissection-style stepped cut at the apex
// (dural cuff trimmed 2 mm short of the nerve stump) showing fascicles, pia, subarachnoid gap and dura
// in section. The central retinal vessels and the ophthalmic artery belong to the vasculature module.
import * as THREE from 'three';
import { rng } from '../../lib/materials.js';
import { buildTubes } from '../../lib/vessels.js';
import { sstep } from './sweep.js';

const V3 = THREE.Vector3;

export function buildNerveGeometry(ctx) {
  const { EYE, L, am } = ctx;
  const curve = am.nerveCurve();
  const NS = 360;
  const Ltot = curve.getLength();
  const fr = curve.computeFrenetFrames(NS, false);
  const P = []; for (let i = 0; i <= NS; i++) P.push(curve.getPointAt(i / NS));
  const frameAt = (a, p, n, b, t) => {
    const f = THREE.MathUtils.clamp(a / Ltot, 0, 1) * NS;
    const i = Math.min(NS - 1, Math.floor(f)), u = f - i;
    p.lerpVectors(P[i], P[i + 1], u);
    n.lerpVectors(fr.normals[i], fr.normals[i + 1], u).normalize();
    b.lerpVectors(fr.binormals[i], fr.binormals[i + 1], u).normalize();
    if (t) t.lerpVectors(fr.tangents[i], fr.tangents[i + 1], u).normalize();
  };
  // arc length where the centreline leaves the sclera
  const Rs = L.scleraOuterR;
  let sExit = 0;
  for (let i = 0; i <= NS; i++) if (P[i].length() >= Rs) { sExit = i / NS * Ltot; break; }
  const rn0 = EYE.nerveDiameter / 2;                 // 1.6
  const rdo = EYE.sheathDiameter / 2;                // 2.3 (dura outer)
  const rdi = rdo - 0.36;                            // dura inner: 0.36 mm thick dura, 0.34 mm subarachnoid gap
  const sEnd = Ltot, sCuff = Ltot - 2.0;
  const rn = a => {
    const ramp = sstep(sExit - 0.9, sExit + 1.4, a);
    const base = 0.86 + (rn0 - 0.86) * ramp;
    return base * (1 + 0.012 * Math.sin(a * 0.9 + 1.3) * ramp) * (1 + 0.035 * sstep(sEnd - 0.5, sEnd, a));
  };

  const p = new V3(), n = new V3(), b = new V3(), t = new V3();
  const M = 72;

  // ---- neural core: closed start inside the scleral canal -> side -> domed cut face at the apex
  const coreProf = [];
  const a0 = 0.25;
  for (let k = 0; k <= 6; k++) { const r = rn(a0) * Math.sin(k / 6 * Math.PI / 2); coreProf.push({ a: a0 - 0.2 * Math.cos(k / 6 * Math.PI / 2), r, k: 0 }); }
  const nSide = Math.ceil((sEnd - 0.06 - a0) / 0.11);
  for (let k = 1; k <= nSide; k++) { const a = a0 + (sEnd - 0.06 - a0) * k / nSide; coreProf.push({ a, r: rn(a), k: 0 }); }
  const rEnd = rn(sEnd);
  for (let k = 1; k <= 4; k++) { const ang = k / 4 * Math.PI / 2; coreProf.push({ a: sEnd - 0.06 + Math.sin(ang) * 0.06, r: rEnd - 0.06 + Math.cos(ang) * 0.06, k: k < 3 ? 0 : 1 }); }
  const nCap = 26;
  for (let k = 1; k <= nCap; k++) { const r = (rEnd - 0.06) * (1 - k / nCap); coreProf.push({ a: sEnd + 0.05 * (1 - (r / rEnd) ** 2), r, k: 1 }); }
  const core = revolveCurve(coreProf, M, frameAt, (o, pr, th) => [pr.r * Math.cos(th), pr.r * Math.sin(th), pr.a]);

  // ---- dural sheath: flare fused with the sclera -> outer wall -> cut face (cuff) -> inner wall -> closed
  const sS0 = sExit - 0.35;
  const flare = a => 1.45 * Math.exp(-Math.max(0, a - sExit) / 0.75);
  const sheathProf = [];
  const nOut = Math.ceil((sCuff - 0.05 - sS0) / 0.16);
  for (let k = 0; k <= nOut; k++) { const a = sS0 + (sCuff - 0.05 - sS0) * k / nOut; sheathProf.push({ a, r: rdo + flare(a), rf: rdo, k: 0, g: 1 - sstep(sS0, sExit + 1.7, a) }); }
  for (let k = 1; k <= 3; k++) { const ang = k / 4 * Math.PI / 2; sheathProf.push({ a: sCuff - 0.05 + Math.sin(ang) * 0.05, r: rdo - 0.05 + Math.cos(ang) * 0.05, k: 0, g: 0 }); }
  const nFace = 7;
  for (let k = 0; k <= nFace; k++) { const r = (rdo - 0.05) - (rdo - rdi - 0.1) * k / nFace; sheathProf.push({ a: sCuff, r, k: 1, g: 0 }); }
  for (let k = 1; k <= 3; k++) { const ang = k / 4 * Math.PI / 2; sheathProf.push({ a: sCuff - 0.05 + Math.cos(ang) * 0.05, r: rdi + 0.05 - Math.sin(ang) * 0.05, k: 2, g: 0 }); }
  const sI0 = sExit + 0.1;
  const nIn = Math.ceil((sCuff - 0.05 - sI0) / 0.35);
  for (let k = 0; k <= nIn; k++) { const a = sCuff - 0.05 - (sCuff - 0.05 - sI0) * k / nIn; sheathProf.push({ a, r: rdi, k: 2, g: 0 }); }
  for (let k = 1; k <= 3; k++) { sheathProf.push({ a: sI0 - (sI0 - sS0) * k / 3, r: rdi + (rdo + flare(sS0) - rdi) * k / 3, rf: rdi + (rdo - rdi) * k / 3, k: 2, g: 1 }); }
  const sheathWarp = (x, y, z, pr) => {
    if (!pr.g) return [x, y, z];
    const r = Math.hypot(x, y, z);
    const target = Math.max(Rs - 0.04, THREE.MathUtils.lerp(r, Rs - 0.03, pr.g));
    const f = target / r;
    return [x * f, y * f, z * f];
  };
  const sheathAttr = (o, pr, th) => [pr.r * Math.cos(th), pr.r * Math.sin(th), pr.a];
  const sheath = revolveCurve(sheathProf, 72, frameAt, sheathAttr, sheathWarp, true);
  // unflared twin (dura cut at the globe): the shader mixes to it when the nerve is exploded or inspected
  const flat = revolveCurve(sheathProf.map(pr => ({ ...pr, r: pr.rf ?? pr.r, g: 0 })), 72, frameAt, sheathAttr, null, true);
  sheath.setAttribute('aFlat', flat.attributes.position);
  sheath.setAttribute('aFlatN', flat.attributes.normal);

  // ---- pial + dural vessels (one tube geometry, vessel material)
  const R = rng(7331);
  const paths = [];
  const surf = (a, th, r) => { frameAt(a, p, n, b); return p.clone().addScaledVector(n, Math.cos(th) * r).addScaledVector(b, Math.sin(th) * r); };
  const trunks = 11;
  for (let v = 0; v < trunks; v++) {
    let th = (v / trunks) * Math.PI * 2 + R.range(-0.25, 0.25);
    const kind = v % 3 === 1 ? 1 : 0;
    const rv = kind ? R.range(0.045, 0.06) : R.range(0.032, 0.048);
    const drift = R.range(-0.02, 0.02);
    const pts = [], trace = [];
    const aStart = sExit + R.range(0.3, 1.2);
    for (let a = aStart; a <= sEnd - 0.12; a += 0.25) {
      th += drift + R.normal() * 0.035;
      trace.push([a, th]);
      pts.push(surf(a, th, rn(a) + rv * 0.45));
    }
    pts.push(surf(sEnd - 0.12, th, rn(sEnd - 0.12) + rv * 0.4));
    paths.push({ points: pts, radii: [rv, rv * 0.95, rv * 0.85], kind });
    // side branches wandering over the pia
    let a = aStart + R.range(0.8, 2.0);
    while (a < sEnd - 1.2) {
      const bth0 = trace[Math.min(trace.length - 1, Math.round((a - aStart) / 0.25))][1];
      const dir = R() < 0.5 ? -1 : 1;
      const len = R.range(0.9, 2.8);
      const bp = [];
      let bth = bth0, ba = a;
      const steps = Math.ceil(len / 0.2);
      for (let k = 0; k <= steps; k++) {
        bth += dir * R.range(0.04, 0.1);
        ba += R.range(0.05, 0.16) * (R() < 0.8 ? 1 : -1);
        if (ba > sEnd - 0.12) break;
        bp.push(surf(ba, bth, rn(ba) + rv * 0.3));
      }
      if (bp.length > 2) paths.push({ points: bp, radii: [rv * 0.6, rv * 0.3], kind });
      a += R.range(1.1, 2.6);
    }
  }
  // fine vessels on the outer dura
  for (let v = 0; v < 5; v++) {
    let th = R.range(0, Math.PI * 2);
    const rv = R.range(0.022, 0.034), kind = v % 2;
    const pts = [];
    const aS = sExit + R.range(1.5, 4), aE = sCuff - R.range(0.02, 3);
    for (let a = aS; a <= aE; a += 0.3) { th += R.normal() * 0.03 + 0.012; pts.push(surf(a, th, rdo + rv * 0.35)); }
    if (pts.length > 2) paths.push({ points: pts, radii: [rv * 0.7, rv, rv * 0.6], kind });
  }
  const vesselGeo = buildTubes(paths, { radial: 6, minRadial: 4, lengthStep: 0.22 });

  const coreGeo = mergeSimple([core]);
  frameAt(Ltot * 0.5, p, n, b);
  const top = new V3(0, 1, 0);
  const anchor = p.clone().addScaledVector(top, rdo + 0.3);
  frameAt(sEnd, p, n, b, t);
  return {
    coreGeo, sheathGeo: sheath, vesselGeo, anchor, curve, Ltot, sExit, cut: { centre: p.clone(), tangent: t.clone() },
    stats: { sExit, Ltot },
  };
}

// Revolve a (a, r) profile around the nerve curve. attr(o, prof, theta) -> vec3 per vertex; kind from prof.k.
function revolveCurve(prof, M, frameAt, attr, warp, sheath = false) {
  const K = prof.length;
  const pos = new Float32Array(K * M * 3), at = new Float32Array(K * M * 3), kk = new Float32Array(K * M);
  const p = new V3(), n = new V3(), b = new V3();
  for (let k = 0; k < K; k++) {
    const pr = prof[k];
    frameAt(pr.a, p, n, b);
    for (let j = 0; j < M; j++) {
      const th = j / M * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      let x = p.x + pr.r * (c * n.x + s * b.x), y = p.y + pr.r * (c * n.y + s * b.y), z = p.z + pr.r * (c * n.z + s * b.z);
      if (warp) [x, y, z] = warp(x, y, z, pr);
      const o = k * M + j;
      pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;
      const v = attr(o, pr, th);
      at[o * 3] = v[0]; at[o * 3 + 1] = v[1]; at[o * 3 + 2] = v[2];
      kk[o] = pr.k;
    }
  }
  const idx = [];
  for (let k = 0; k < K - 1; k++) for (let j = 0; j < M; j++) {
    const a0 = k * M + j, a1 = k * M + (j + 1) % M, b0 = (k + 1) * M + j, b1 = (k + 1) * M + (j + 1) % M;
    idx.push(a0, a1, b0, a1, b1, b0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute(sheath ? 'aSU' : 'aNU', new THREE.BufferAttribute(at, 3));
  g.setAttribute(sheath ? 'aSK' : 'aNK', new THREE.BufferAttribute(kk, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // orientation: the first side vertex of the middle ring must face away from the axis
  const km = Math.floor(K * (sheath ? 0.3 : 0.5));
  frameAt(prof[km].a, p, n, b);
  const v = new V3().fromBufferAttribute(g.attributes.position, km * M).sub(p);
  const nn = new V3().fromBufferAttribute(g.attributes.normal, km * M);
  if (nn.dot(v) < 0) { for (let i = 0; i < idx.length; i += 3) { const x = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = x; } g.setIndex(idx); g.computeVertexNormals(); }
  g.computeBoundingSphere();
  return g;
}

// Flat vessel cross-section: wall annulus (kind 2) and lumen (kind 3), facing along n x b.
function discGeometry(c, n, b, rOut, rLum) {
  const M = 28, rings = [];
  for (let k = 0; k <= 5; k++) rings.push({ r: rOut - (rOut - rLum) * k / 5, k: 2, u: k / 5 });
  for (let k = 1; k <= 5; k++) rings.push({ r: rLum * (1 - k / 5), k: 3, u: 1 });
  const K = rings.length;
  const pos = new Float32Array(K * M * 3), at = new Float32Array(K * M * 3), kk = new Float32Array(K * M), nor = new Float32Array(K * M * 3);
  const f = new V3().crossVectors(n, b).normalize();
  for (let k = 0; k < K; k++) for (let j = 0; j < M; j++) {
    const th = j / M * Math.PI * 2, x = Math.cos(th) * rings[k].r, y = Math.sin(th) * rings[k].r;
    const depth = rings[k].k === 3 ? -0.03 * (1 - rings[k].r / rLum) : 0;
    const o = k * M + j;
    pos[o * 3] = c.x + n.x * x + b.x * y + f.x * depth; pos[o * 3 + 1] = c.y + n.y * x + b.y * y + f.y * depth; pos[o * 3 + 2] = c.z + n.z * x + b.z * y + f.z * depth;
    at[o * 3] = x; at[o * 3 + 1] = y; at[o * 3 + 2] = rings[k].u;
    kk[o] = rings[k].k;
    nor[o * 3] = f.x; nor[o * 3 + 1] = f.y; nor[o * 3 + 2] = f.z;
  }
  const idx = [];
  for (let k = 0; k < K - 1; k++) for (let j = 0; j < M; j++) {
    const a0 = k * M + j, a1 = k * M + (j + 1) % M, b0 = (k + 1) * M + j, b1 = (k + 1) * M + (j + 1) % M;
    idx.push(a0, a1, b0, a1, b1, b0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aNU', new THREE.BufferAttribute(at, 3));
  g.setAttribute('aNK', new THREE.BufferAttribute(kk, 1));
  // face winding toward +f
  const A = new V3().fromArray(pos, idx[0] * 3), Bv = new V3().fromArray(pos, idx[1] * 3), C = new V3().fromArray(pos, idx[2] * 3);
  const fn = new V3().crossVectors(Bv.sub(A), C.sub(A));
  if (fn.dot(f) < 0) for (let i = 0; i < idx.length; i += 3) { const x = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = x; }
  g.setIndex(idx);
  return g;
}

function mergeSimple(list) {
  const names = ['position', 'normal', 'aNU', 'aNK'];
  const out = new THREE.BufferGeometry();
  for (const nm of names) {
    const size = list[0].attributes[nm].itemSize;
    const total = list.reduce((a, g) => a + g.attributes[nm].count, 0);
    const arr = new Float32Array(total * size); let o = 0;
    for (const g of list) { arr.set(g.attributes[nm].array, o); o += g.attributes[nm].array.length; }
    out.setAttribute(nm, new THREE.BufferAttribute(arr, size));
  }
  const idx = []; let base = 0;
  for (const g of list) { const ix = g.index.array; for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base); base += g.attributes.position.count; }
  out.setIndex(base > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
