// Builds the anatomical model from the per-system GLBs:
//  · classifies every node (core/classify.js), skips technical helpers;
//  · merges nodes into a few big meshes per (depth group, class, cap group, side) with a per-vertex
//    structure index (aSid) → ~100 draw calls instead of ~1100, still individually addressable;
//  · keeps meshes that must move on their own (eyeballs rotate with the gaze) or carry morph targets
//    (future fitted skin with a 'female' target) as standalone meshes with the same attributes;
//  · creates the state (dynamic) and static data textures read by core/shader.js.
import * as THREE from 'three';
import { classify, G, CLASS_COLOR, DOUBLE_SIDED, TRANSPARENT, EYE_INTERIOR, CAP_ORDER } from './classify.js';
import { TEXW, U, patchLit, patchGhost, patchStencil } from './shader.js';

const SIDE = (name) => (/\.l$/.test(name) ? 'L' : /\.r$/.test(name) ? 'R' : 'M');
export const slug = (s) => String(s).toLowerCase().replace(/\.(l|r)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const baseName = (s) => String(s).trim().replace(/\.(l|r)$/, '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();

// muscle fibre direction overrides: mode 0 = axis, 1 = radial fan from a point, 2 = circular around a point
function fibreOverride(name, center, side) {
  const n = name.toLowerCase();
  const sx = side === 'L' ? 1 : side === 'R' ? -1 : 0;
  if (/frontalis|occipitalis|temporoparietalis|procerus|corrugator/.test(n)) return [0, 1, 0, 0];
  if (/^temporalis/.test(n)) return [0.052 * sx, 1.535, 0.025, 1];          // fibres converge on the coronoid process
  if (/orbicularis oculi/.test(n)) return [0.031 * sx, 1.591, 0.07, 2];       // around the palpebral fissure
  if (/orbicularis oris/.test(n)) return [0, 1.505, 0.09, 2];                 // around the mouth
  if (/platysma/.test(n)) { const l = Math.hypot(0.3, 1, 0.15); return [0.3 * sx / l, 1 / l, 0.15 / l, 0]; }
  return null;
}

function pca(pos, idxs) {
  // principal axis of a vertex cloud (power iteration on the covariance)
  let mx = 0, my = 0, mz = 0; const n = idxs.length;
  for (const i of idxs) { mx += pos[i * 3]; my += pos[i * 3 + 1]; mz += pos[i * 3 + 2]; }
  mx /= n; my /= n; mz /= n;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const i of idxs) { const x = pos[i * 3] - mx, y = pos[i * 3 + 1] - my, z = pos[i * 3 + 2] - mz; xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z; }
  let v = [0.3, 0.9, 0.2];
  for (let k = 0; k < 24; k++) {
    const w = [xx * v[0] + xy * v[1] + xz * v[2], xy * v[0] + yy * v[1] + yz * v[2], xz * v[0] + yz * v[1] + zz * v[2]];
    const l = Math.hypot(...w) || 1; v = w.map(c => c / l);
  }
  return v;
}

export function buildModel(gltfs, opts = {}) {
  const nodes = [];       // per structure-node record, index = sid
  const standalone = [];  // meshes kept separate
  const buckets = new Map();
  const tmpColor = new THREE.Color();
  let flipped = 0;

  for (const { file, gltf, variant } of gltfs) {
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const raw = (o.userData && o.userData.name) || o.name;
      const c = classify(raw, file);
      if (c.helper) return;
      const geo = o.geometry;
      // v3 textured skins (skin_m / skin_f): photographic PBR textures, no morph; cross-dissolved by sex in the shader
      const tex = c.cls === 'skin' && o.material && o.material.map
        ? { map: o.material.map, normalMap: o.material.normalMap, roughnessMap: o.material.roughnessMap, normalScale: o.material.normalScale ? o.material.normalScale.clone() : null } : null;
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!o.matrixWorld.equals(IDENT)) geo.applyMatrix4(o.matrixWorld);
      const pos = geo.attributes.position;
      geo.userData.node = raw;
      if (!(geo.morphAttributes && geo.morphAttributes.position) && fixOrientation(geo, file === 'skin')) flipped++;
      fixNormals(geo);
      const side = SIDE(raw.trim());
      const name = baseName(raw);
      const sid = nodes.length;
      // bbox, sample points, centre
      const box = new THREE.Box3().setFromBufferAttribute(pos);
      const step = Math.max(1, Math.floor(pos.count / 40));
      const samples = []; const sidx = [];
      for (let i = 0; i < pos.count; i += step) { samples.push(pos.getX(i), pos.getY(i), pos.getZ(i)); sidx.push(i); }
      const rec = {
        sid, node: raw.trim(), name, side, file, ...c,
        box, center: box.getCenter(new THREE.Vector3()), radius: box.getSize(new THREE.Vector3()).length() / 2,
        samples: new Float32Array(samples), tris: (geo.index ? geo.index.count : pos.count) / 3,
        tint: new THREE.Color(), fibre: [0, 1, 0, c.noField ? -1 : 0], structId: null,
      };
      // colour: class base + gentle per-structure variation (gyri hue variety makes the cortex readable)
      tmpColor.setHex(CLASS_COLOR[c.cls] ?? 0xcccccc);
      const h = hash(name);
      if (c.cls === 'cortex' || c.cls === 'sulcus' || c.cls === 'cerebellum' || c.cls === 'deepgrey') {
        const hsl = {}; tmpColor.getHSL(hsl);
        tmpColor.setHSL((hsl.h + (h - 0.5) * 0.05 + 1) % 1, hsl.s * (0.85 + 0.35 * hash(name + 's')), hsl.l * (0.94 + 0.1 * hash(name + 'l')));
      } else if (c.cls === 'muscle') {
        tmpColor.multiplyScalar(0.9 + 0.18 * h);
      } else if (c.cls === 'nucleus') {
        const hsl = {}; tmpColor.getHSL(hsl); tmpColor.setHSL((hsl.h + (h - 0.5) * 0.18 + 1) % 1, hsl.s, hsl.l);
      } else if (c.cls === 'bone') {
        tmpColor.multiplyScalar(0.97 + 0.05 * h);
      }
      rec.tint.copy(tmpColor).convertSRGBToLinear();
      if (tex) { rec.tint.setRGB(1, 1, 1); rec.textured = true; rec.variant = variant || 'm'; }
      if (c.cls === 'muscle') {
        const fo = fibreOverride(name, rec.center, side);
        if (fo) rec.fibre = fo;
        else { const arr = pos.array; const idx = []; for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 400))) idx.push(i); rec.fibre = [...pca(arr, idx), 0]; }
      }
      nodes.push(rec);

      if (c.cls === 'skin' && geo.index && !tex) { stripInteriorSkin(geo); weldSkinNormals(geo); }
      const hasMorph = geo.morphAttributes && Object.keys(geo.morphAttributes).length > 0;
      if (c.rotate && opts.eyesRigid) rec.fibre[3] = -1;   // eyeballs: no sex field (rigid; the female eye offset moves the pivot in main.js)
      if (c.rotate || hasMorph || tex) {
        const sidAttr = new THREE.Float32BufferAttribute(new Float32Array(pos.count).fill(sid), 1);
        geo.setAttribute('aSid', sidAttr);
        standalone.push({ rec, geo, morphDict: o.morphTargetDictionary || null, tex });
        return;
      }
      const key = c.cls === 'skin' ? 'skin' : `${c.group}|${c.cls}|${c.cap || '-'}|${side}`;   // all skin patches in one mesh → seamless normals
      let b = buckets.get(key);
      if (!b) { b = { key, group: c.group, cls: c.cls, cap: c.cap, side, parts: [], verts: 0, idx: 0 }; buckets.set(key, b); }
      b.parts.push({ geo, sid }); b.verts += pos.count; b.idx += geo.index ? geo.index.count : pos.count;
    });
  }

  // ---- skin realism: per-vertex region weights derived from facial landmarks (no UVs in the fitted skin)
  const scl = nodes.filter(r => r.cls === 'sclera');
  if (scl.length) {
    const eye = scl[0].center.clone(); eye.x = Math.abs(eye.x);
    const eyeR = scl[0].box.getSize(new THREE.Vector3()).y / 2;
    for (const s of standalone) {
      if (s.rec.cls !== 'skin') continue;
      if (s.tex) { skinLandmarks(s.geo); continue; }
      geo_smoothCreases(s.geo, eye); weldSkinNormals(s.geo); skinAttributes(s.geo, eye, eyeR);
    }
  }

  // ---- merge buckets
  const merged = [];
  for (const b of buckets.values()) {
    const P = new Float32Array(b.verts * 3), N = new Float32Array(b.verts * 3), S = new Float32Array(b.verts);
    const I = new Uint32Array(b.idx);
    let vo = 0, io = 0;
    for (const { geo, sid } of b.parts) {
      const p = geo.attributes.position, n = geo.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        P[(vo + i) * 3] = p.getX(i); P[(vo + i) * 3 + 1] = p.getY(i); P[(vo + i) * 3 + 2] = p.getZ(i);
        N[(vo + i) * 3] = n.getX(i); N[(vo + i) * 3 + 1] = n.getY(i); N[(vo + i) * 3 + 2] = n.getZ(i);
      }
      S.fill(sid, vo, vo + p.count);
      if (geo.index) { const a = geo.index.array; for (let k = 0; k < a.length; k++) I[io + k] = a[k] + vo; io += a.length; }
      else { for (let k = 0; k < p.count; k++) I[io + k] = vo + k; io += p.count; }
      vo += p.count;
      geo.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('aSid', new THREE.BufferAttribute(S, 1));
    g.setIndex(new THREE.BufferAttribute(I, 1));
    if (b.cls === 'skin') weldNormals(g);
    g.computeBoundingBox(); g.computeBoundingSphere();
    merged.push({ ...b, geo: g, sids: [...new Set(b.parts.map(p => p.sid))] });
  }

  // ---- data textures
  const rows = Math.ceil(nodes.length / TEXW);
  const stateArr = new Float32Array(TEXW * rows * 4);
  const staticArr = new Float32Array(TEXW * rows * 2 * 4);
  for (const r of nodes) {
    const x = r.sid % TEXW, y = Math.floor(r.sid / TEXW);
    const o0 = ((y * 2) * TEXW + x) * 4, o1 = ((y * 2 + 1) * TEXW + x) * 4;
    staticArr[o0] = r.tint.r; staticArr[o0 + 1] = r.tint.g; staticArr[o0 + 2] = r.tint.b; staticArr[o0 + 3] = r.group;
    staticArr[o1] = r.fibre[0]; staticArr[o1 + 1] = r.fibre[1]; staticArr[o1 + 2] = r.fibre[2]; staticArr[o1 + 3] = r.fibre[3];
    stateArr[r.sid * 4 + 2] = r.hidden ? 1 : 0;
  }
  const stateTex = new THREE.DataTexture(stateArr, TEXW, rows, THREE.RGBAFormat, THREE.FloatType);
  const staticTex = new THREE.DataTexture(staticArr, TEXW, rows * 2, THREE.RGBAFormat, THREE.FloatType);
  for (const t of [stateTex, staticTex]) { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; }
  U.uState.value = stateTex; U.uStatic.value = staticTex;
  const offsetArr = new Float32Array(TEXW * rows * 3 * 4);
  for (let i = 0; i < nodes.length; i++) { const x = i % TEXW, y = Math.floor(i / TEXW); offsetArr[((y * 3 + 1) * TEXW + x) * 4 + 3] = 1; }   // identity quaternions
  const offsetTex = new THREE.DataTexture(offsetArr, TEXW, rows * 3, THREE.RGBAFormat, THREE.FloatType);
  offsetTex.magFilter = offsetTex.minFilter = THREE.NearestFilter; offsetTex.generateMipmaps = false; offsetTex.needsUpdate = true;
  U.uOffset.value = offsetTex;

  return { nodes, merged, standalone, stateArr, stateTex, offsetArr, offsetTex, flipped };
}

// Mirrored (.l) source meshes come out inside-out (both winding and normals reversed). Detect with the signed
// volume (closed meshes) or, for open skin patches, with the winding normal against the direction away from the
// head centre; reverse the winding and the normals so every mesh faces outward (needed for FrontSide culling,
// correct back-face tinting and consistent stencil parity).
const HEAD_C = new THREE.Vector3(0, 1.575, -0.005);
const EAR = /auricle|helix|tragus|concha|scapha|fossa|lobule|incisure|antitragus|auricular groove/i;
function fixOrientation(geo, radial) {
  let ref = HEAD_C;
  if (radial && EAR.test(geo.userData.node || '')) { geo.computeBoundingBox(); const cx = (geo.boundingBox.min.x + geo.boundingBox.max.x) / 2; ref = new THREE.Vector3(Math.sign(cx) * 0.035, 1.575, -0.01); }
  const p = geo.attributes.position, idx = geo.index;
  if (!idx) return false;
  const triCount = idx.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cr = new THREE.Vector3(), ctr = new THREE.Vector3();
  geo.computeBoundingBox(); geo.boundingBox.getCenter(ctr);
  let vol = 0, rad = 0;
  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(p, idx.getX(t * 3)).sub(ctr); b.fromBufferAttribute(p, idx.getX(t * 3 + 1)).sub(ctr); c.fromBufferAttribute(p, idx.getX(t * 3 + 2)).sub(ctr);
    cr.crossVectors(b, c); vol += a.dot(cr);
    if (radial) { const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)); const m = a.clone().add(b).add(c).multiplyScalar(1 / 3).add(ctr).sub(ref); rad += n.dot(m); }
  }
  const inside = radial ? rad < 0 : vol < 0;
  if (!inside) return false;
  const arr = idx.array;
  for (let t = 0; t < arr.length; t += 3) { const tmp = arr[t + 1]; arr[t + 1] = arr[t + 2]; arr[t + 2] = tmp; }
  idx.needsUpdate = true;
  const n = geo.attributes.normal.array; for (let i = 0; i < n.length; i++) n[i] = -n[i];
  geo.attributes.normal.needsUpdate = true;
  return true;
}

// Region weights for the skin shader, from landmarks found on the mesh itself (midline profile → nose tip,
// subnasale, lips, stomion; eyes from the sclera; ears by position) plus a curvature-based cavity term.
//   aSkinA = (redness, lips, thinness/translucency, beard)   aSkinB = (pore size, oiliness, cavity, periorbital)
//   aSkinC = lid margin / caruncle (wet, darker, pinker)
// midline profile landmarks (nose tip, subnasale, upper lip, stomion, lower lip) for region classification
function skinLandmarks(geo) {
  const P = geo.attributes.position.array, n = P.length / 3;
  const bins = new Map(), bw = 0.0006;
  let tip = { y: 1.56, z: -1 };
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (Math.abs(x) > 0.004 || y < 1.44 || y > 1.66) continue;
    const b = Math.round(y / bw); if (!(bins.get(b) > z)) bins.set(b, z);
    if (y > 1.5 && y < 1.62 && z > tip.z) tip = { y, z };
  }
  const zAt = (y) => bins.get(Math.round(y / bw)) ?? -1;
  const extreme = (y0, y1, wantMax) => { let best = null; for (let y = y0; y <= y1; y += bw) { const z = zAt(y); if (z < -0.5) continue; if (!best || (wantMax ? z > best.z : z < best.z)) best = { y, z }; } return best || { y: (y0 + y1) / 2, z: tip.z - 0.02 }; };
  // walk down the profile from the nose tip: alternate local minima / maxima of z (smoothed over 1.2 mm)
  const zs = (y) => { let a = 0, c = 0; for (let k = -1; k <= 1; k++) { const z = zAt(y + k * bw); if (z > -0.5) { a += z; c++; } } return c ? a / c : -1; };
  const walk = (y0, wantMax, maxLen) => {
    let best = { y: y0, z: zs(y0) };
    for (let y = y0 - bw; y > y0 - maxLen; y -= bw) {
      const z = zs(y); if (z < -0.5) continue;
      if (wantMax ? z > best.z : z < best.z) best = { y, z };
      else if (Math.abs(z - best.z) > 0.0012) break;          // turned around by > 1.2 mm: extremum found
    }
    return best;
  };
  const sn = walk(tip.y - 0.004, false, 0.03);
  const ls = walk(sn.y - bw, true, 0.02);
  const st = walk(ls.y - bw, false, 0.016);
  const li = walk(st.y - bw, true, 0.02);
  geo.userData.landmarks = { tip, sn, ls, st, li };
  return geo.userData.landmarks;
}

function skinAttributes(geo, eye, eyeR) {
  const P = geo.attributes.position.array, N = geo.attributes.normal.array, n = P.length / 3;
  // --- midline profile
  const bins = new Map(), bw = 0.0006;
  let tip = { y: 1.56, z: -1 };
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (Math.abs(x) > 0.004 || y < 1.44 || y > 1.66) continue;
    const b = Math.round(y / bw); if (!(bins.get(b) > z)) bins.set(b, z);
    if (y > 1.5 && y < 1.62 && z > tip.z) tip = { y, z };
  }
  const zAt = (y) => bins.get(Math.round(y / bw)) ?? -1;
  const extreme = (y0, y1, wantMax) => { let best = null; for (let y = y0; y <= y1; y += bw) { const z = zAt(y); if (z < -0.5) continue; if (!best || (wantMax ? z > best.z : z < best.z)) best = { y, z }; } return best || { y: (y0 + y1) / 2, z: tip.z - 0.02 }; };
  const sn = extreme(tip.y - 0.03, tip.y - 0.008, false);
  const ls = extreme(sn.y - 0.022, sn.y - 0.004, true);
  const st = extreme(ls.y - 0.016, ls.y - 0.003, false);
  const li = extreme(st.y - 0.02, st.y - 0.003, true);
  geo.userData.landmarks = { tip, sn, ls, st, li };
  // --- curvature cavity on the (indexed) mesh
  // (on welded positions: the mesh is split at UV seams and a one-sided neighbourhood would draw a line)
  const I = geo.index.array, wkey = new Map(), wid = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = Math.round(P[i*3]*1e5) + ',' + Math.round(P[i*3+1]*1e5) + ',' + Math.round(P[i*3+2]*1e5); let w = wkey.get(k); if (w === undefined) { w = wkey.size; wkey.set(k, w); } wid[i] = w; }
  const W = wkey.size, wacc = new Float32Array(W * 3), wcnt = new Float32Array(W), wel = new Float32Array(W), wpos = new Float32Array(W * 3);
  for (let i = 0; i < n; i++) { const w = wid[i] * 3; wpos[w] = P[i*3]; wpos[w+1] = P[i*3+1]; wpos[w+2] = P[i*3+2]; }
  const seen = new Set();
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = wid[I[t + k]], b = wid[I[t + (k + 1) % 3]];
    const ek = a < b ? a * W + b : b * W + a; if (seen.has(ek)) continue; seen.add(ek);
    for (const [u, v] of [[a, b], [b, a]]) { wacc[u*3] += wpos[v*3]; wacc[u*3+1] += wpos[v*3+1]; wacc[u*3+2] += wpos[v*3+2]; wcnt[u]++; wel[u] += Math.hypot(wpos[u*3]-wpos[v*3], wpos[u*3+1]-wpos[v*3+1], wpos[u*3+2]-wpos[v*3+2]); }
  }
  const acc = new Float32Array(n * 3), cnt = new Float32Array(n), el = new Float32Array(n);
  for (let i = 0; i < n; i++) { const w = wid[i]; acc[i*3] = wacc[w*3]; acc[i*3+1] = wacc[w*3+1]; acc[i*3+2] = wacc[w*3+2]; cnt[i] = wcnt[w]; el[i] = wel[w]; }
  const A = new Float32Array(n * 4), B = new Float32Array(n * 4), C = new Float32Array(n);
  const g = (dx, dy, dz, r) => Math.exp(-(dx * dx + dy * dy + dz * dz) / (r * r));
  const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], ax = Math.abs(x);
    const front = sst(-0.01, 0.03, z);
    // cavity: neighbours above the tangent plane → concave crease
    let cav = 0;
    if (cnt[i]) { const mx = acc[i * 3] / cnt[i] - x, my = acc[i * 3 + 1] / cnt[i] - y, mz = acc[i * 3 + 2] / cnt[i] - z; cav = (mx * N[i * 3] + my * N[i * 3 + 1] + mz * N[i * 3 + 2]) / Math.max(el[i] / cnt[i], 1e-5); }
    const cavity = Math.min(1, Math.max(0, cav * 1.3));
    // ears
    const ear = sst(0.058, 0.07, ax) * sst(eye.y - 0.075, eye.y - 0.05, y) * (1 - sst(eye.y + 0.02, eye.y + 0.04, y)) * (1 - sst(0.0, 0.025, z)) * sst(-0.07, -0.045, z);
    // lips (ellipse around the stomion, split upper / lower)
    const ry = y > st.y ? Math.max(0.004, ls.y - st.y + 0.0025) : Math.max(0.004, st.y - li.y + 0.0035);
    const le = Math.hypot(x / 0.0235, (y - st.y) / ry);
    const lips = (1 - sst(0.82, 1.0, le)) * sst(st.z - 0.016, st.z - 0.008, z);
    // redness: nose tip + alae, cheeks, ears, a little on the chin
    const red = Math.min(1, 0.7 * g(x, y - tip.y, z - tip.z, 0.011) + 0.45 * g(ax - 0.014, y - (tip.y - 0.008), 0, 0.008) * front
      + 0.45 * g(ax - 0.043, y - (eye.y - 0.033), 0, 0.017) * front + 0.6 * ear + 0.2 * g(x, y - (li.y - 0.02), 0, 0.012) * front);
    // eye region
    const de = Math.hypot(ax - eye.x, y - eye.y, z - eye.z) - eyeR;
    const nearEye = Math.hypot(ax - eye.x, y - eye.y) < 0.022 ? 1 : 0;
    const margin = nearEye * (1 - sst(0.0004, 0.0025, de));
    const lid = nearEye * (1 - sst(0.002, 0.009, de));
    const peri = Math.exp(-(((ax - eye.x) / 0.02) ** 2) - (((y - eye.y + 0.006) / 0.014) ** 2)) * (1 - lid) * front;
    // translucency: ear rims, eyelids, nostril alae
    const thin = Math.min(1, ear * 0.9 + lid * 0.6 + 0.5 * g(ax - 0.013, y - (tip.y - 0.006), z - (tip.z - 0.01), 0.006));
    // beard shadow: upper lip, chin, jaw, submental — never on the lips
    const beardZone = (1 - sst(sn.y - 0.002, sn.y + 0.004, y)) * sst(1.455, 1.475, y) * (1 - sst(0.05, 0.068, ax)) * sst(-0.04, -0.015, z);
    const beard = beardZone * (1 - lips) * (1 - 0.6 * g(ax - 0.035, y - (st.y + 0.002), 0, 0.006));
    // pores: large on nose and cheeks, fine on forehead and lids; oil: T-zone
    const pore = Math.min(1, 0.45 + 0.55 * g(x, y - tip.y, 0, 0.02) + 0.35 * g(ax - 0.035, y - (eye.y - 0.03), 0, 0.02)) * (1 - 0.6 * lid) * (1 - 0.5 * lips);
    const oil = Math.min(1, 0.8 * g(x, y - tip.y, 0, 0.018) + 0.7 * g(x * 0.6, y - (eye.y + 0.035), 0, 0.02) * front + 0.3 * lips);
    A.set([red, lips, thin, beard], i * 4);
    B.set([pore, oil, cavity, peri], i * 4);
    C[i] = margin;
  }
  geo.setAttribute('aSkinA', new THREE.BufferAttribute(A, 4));
  geo.setAttribute('aSkinB', new THREE.BufferAttribute(B, 4));
  geo.setAttribute('aSkinC', new THREE.BufferAttribute(C, 1));
}

// The fitted skin has a few sharp fitting creases (chin midline, side of the nose) that catch the rim light
// as bright lines. Find welded vertices whose normal deviates > ~30° from their neighbours' mean, outside the
// places where sharp features are real (eyes/lids, lips, nostrils, ears), and relax them (3 × Laplacian, λ 0.5).
function geo_smoothCreases(geo, eye) {
  const P = geo.attributes.position.array, I = geo.index.array, n = P.length / 3;
  const key = new Map(), wid = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = Math.round(P[i*3]*1e5) + ',' + Math.round(P[i*3+1]*1e5) + ',' + Math.round(P[i*3+2]*1e5); let w = key.get(k); if (w === undefined) { w = key.size; key.set(k, w); } wid[i] = w; }
  const W = key.size, pos = new Float32Array(W * 3), nb = Array.from({ length: W }, () => new Set());
  for (let i = 0; i < n; i++) pos.set([P[i*3], P[i*3+1], P[i*3+2]], wid[i] * 3);
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = wid[I[t+k]], b = wid[I[t+(k+1)%3]]; if (a !== b) { nb[a].add(b); nb[b].add(a); } }
  const normals = () => {
    const acc = new Float32Array(W * 3);
    for (let t = 0; t < I.length; t += 3) {
      const a = wid[I[t]]*3, b = wid[I[t+1]]*3, c = wid[I[t+2]]*3;
      const ux = pos[b]-pos[a], uy = pos[b+1]-pos[a+1], uz = pos[b+2]-pos[a+2], vx = pos[c]-pos[a], vy = pos[c+1]-pos[a+1], vz = pos[c+2]-pos[a+2];
      const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
      for (const w of [a, b, c]) { acc[w] += nx; acc[w+1] += ny; acc[w+2] += nz; }
    }
    for (let w = 0; w < W; w++) { const l = Math.hypot(acc[w*3], acc[w*3+1], acc[w*3+2]) || 1; acc[w*3] /= l; acc[w*3+1] /= l; acc[w*3+2] /= l; }
    return acc;
  };
  const N = normals(), mark = new Uint8Array(W);
  let found = 0;
  for (let w = 0; w < W; w++) {
    const x = pos[w*3], y = pos[w*3+1], z = pos[w*3+2], ax = Math.abs(x);
    if (z < 0.02 || ax > 0.052 || y < 1.44) continue;                                           // face only; not ears / neck
    if (Math.hypot(ax - eye.x, y - eye.y) < 0.021) continue;                                    // eyes + lids
    if (ax < 0.03 && y > 1.505 && y < 1.548 && z > 0.07) continue;                               // lips
    if (ax < 0.02 && y > 1.543 && y < 1.568 && z > 0.07 && Math.abs(N[w*3+1]) > 0.5) continue;  // nostril rims
    let mx = 0, my = 0, mz = 0; for (const v of nb[w]) { mx += N[v*3]; my += N[v*3+1]; mz += N[v*3+2]; }
    const l = Math.hypot(mx, my, mz) || 1;
    if ((N[w*3]*mx + N[w*3+1]*my + N[w*3+2]*mz) / l < 0.87) { mark[w] = 1; found++; }
  }
  const zone = new Uint8Array(W);
  for (let w = 0; w < W; w++) if (mark[w]) { zone[w] = 1; for (const v of nb[w]) zone[v] = 1; }
  for (let it = 0; it < 6; it++) {
    const np = pos.slice();
    for (let w = 0; w < W; w++) {
      if (!zone[w] || !nb[w].size) continue;
      let mx = 0, my = 0, mz = 0; for (const v of nb[w]) { mx += pos[v*3]; my += pos[v*3+1]; mz += pos[v*3+2]; }
      const k = nb[w].size;
      np[w*3] += 0.5 * (mx / k - pos[w*3]); np[w*3+1] += 0.5 * (my / k - pos[w*3+1]); np[w*3+2] += 0.5 * (mz / k - pos[w*3+2]);
    }
    pos.set(np);
  }
  for (let i = 0; i < n; i++) { const w = wid[i] * 3; P[i*3] = pos[w]; P[i*3+1] = pos[w+1]; P[i*3+2] = pos[w+2]; }
  geo.attributes.position.needsUpdate = true;
  geo.userData.creaseVerts = found;
}

// The chin midline slit is a topological fold (two flaps) that Laplacian smoothing cannot close; its ~0.7 mm
// groove only matters through shading, so replace normals there by a spatial 4 mm average (base and ♀ morph).
function chinNormals(geo) {
  const P = geo.attributes.position.array, N = geo.attributes.normal.array, n = P.length / 3;
  const inBand = (i, pad) => Math.abs(P[i*3]) < 0.012 + pad && P[i*3+1] > 1.425 - pad && P[i*3+1] < 1.516 + pad && P[i*3+2] > 0.02;
  const cand = [], band = [];
  for (let i = 0; i < n; i++) { if (inBand(i, 0.004)) cand.push(i); if (inBand(i, 0)) band.push(i); }
  const R2 = 0.005 * 0.005, out = new Float32Array(band.length * 3);
  const mn = geo.morphAttributes.normal?.[0]?.array, outM = mn ? new Float32Array(band.length * 3) : null;
  band.forEach((i, k) => {
    let x = 0, y = 0, z = 0, mx = 0, my = 0, mz = 0;
    for (const j of cand) {
      const dx = P[j*3]-P[i*3], dy = P[j*3+1]-P[i*3+1], dz = P[j*3+2]-P[i*3+2], d2 = dx*dx+dy*dy+dz*dz;
      if (d2 > R2) continue; const w = 1 - d2 / R2;
      x += N[j*3]*w; y += N[j*3+1]*w; z += N[j*3+2]*w;
      if (mn) { mx += (N[j*3]+mn[j*3])*w; my += (N[j*3+1]+mn[j*3+1])*w; mz += (N[j*3+2]+mn[j*3+2])*w; }
    }
    // fade toward the band edge so the smoothed patch blends in
    const f = Math.min(1, (0.012 - Math.abs(P[i*3])) / 0.004);
    const l = Math.hypot(x, y, z) || 1; out.set([N[i*3]*(1-f) + x/l*f, N[i*3+1]*(1-f) + y/l*f, N[i*3+2]*(1-f) + z/l*f], k*3);
    if (mn) { const lm = Math.hypot(mx, my, mz) || 1; outM.set([mx/lm, my/lm, mz/lm], k*3); }
  });
  band.forEach((i, k) => {
    const f = Math.min(1, (0.012 - Math.abs(P[i*3])) / 0.004);
    if (mn) { const fx = (N[i*3]+mn[i*3])*(1-f) + outM[k*3]*f, fy = (N[i*3+1]+mn[i*3+1])*(1-f) + outM[k*3+1]*f, fz = (N[i*3+2]+mn[i*3+2])*(1-f) + outM[k*3+2]*f; mn[i*3] = fx; mn[i*3+1] = fy; mn[i*3+2] = fz; }
    const l = Math.hypot(out[k*3], out[k*3+1], out[k*3+2]) || 1;
    N[i*3] = out[k*3]/l; N[i*3+1] = out[k*3+1]/l; N[i*3+2] = out[k*3+2]/l;
    if (mn) { mn[i*3] -= N[i*3]; mn[i*3+1] -= N[i*3+1]; mn[i*3+2] -= N[i*3+2]; }
  });
  geo.attributes.normal.needsUpdate = true;
  if (mn) geo.morphAttributes.normal[0].needsUpdate = true;
}

// ICT skin is split at UV seams: coincident vertices get different normals → visible lines (chin, scalp).
// Recompute area-weighted normals on welded positions for the base AND for the 'female' morph target
// (morph normal delta = welded female normal − welded base normal).
function weldSkinNormals(geo) {
  const P = geo.attributes.position.array, I = geo.index.array, n = P.length / 3;
  const q = 1e5, key = new Map(), wid = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = Math.round(P[i*3]*q) + ',' + Math.round(P[i*3+1]*q) + ',' + Math.round(P[i*3+2]*q); let w = key.get(k); if (w === undefined) { w = key.size; key.set(k, w); } wid[i] = w; }
  const normalsFor = (pos) => {
    const acc = new Float32Array(key.size * 3);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t]*3, b = I[t+1]*3, c = I[t+2]*3;
      const ux = pos[b]-pos[a], uy = pos[b+1]-pos[a+1], uz = pos[b+2]-pos[a+2], vx = pos[c]-pos[a], vy = pos[c+1]-pos[a+1], vz = pos[c+2]-pos[a+2];
      const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
      for (const v of [I[t], I[t+1], I[t+2]]) { const w = wid[v]*3; acc[w] += nx; acc[w+1] += ny; acc[w+2] += nz; }
    }
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const w = wid[i]*3, l = Math.hypot(acc[w], acc[w+1], acc[w+2]) || 1; out[i*3] = acc[w]/l; out[i*3+1] = acc[w+1]/l; out[i*3+2] = acc[w+2]/l; }
    return out;
  };
  const nb = normalsFor(P);
  // keep the source orientation (outward) — flip if the recomputed field disagrees on average
  const src = geo.attributes.normal.array; let d = 0; for (let i = 0; i < n; i += 7) d += nb[i*3]*src[i*3] + nb[i*3+1]*src[i*3+1] + nb[i*3+2]*src[i*3+2];
  const sgn = d < 0 ? -1 : 1; if (sgn < 0) for (let i = 0; i < nb.length; i++) nb[i] = -nb[i];
  geo.attributes.normal.array.set(nb); geo.attributes.normal.needsUpdate = true;
  const mp = geo.morphAttributes.position, mn = geo.morphAttributes.normal;
  if (mp && mn) for (let k = 0; k < mp.length; k++) {
    const rel = geo.morphTargetsRelative !== false;
    const dp = mp[k].array, fp = new Float32Array(P.length);
    for (let i = 0; i < P.length; i++) fp[i] = rel ? P[i] + dp[i] : dp[i];
    const nf = normalsFor(fp); if (sgn < 0) for (let i = 0; i < nf.length; i++) nf[i] = -nf[i];
    const dn = mn[k].array; for (let i = 0; i < dn.length; i++) dn[i] = rel ? nf[i] - nb[i] : nf[i];
    mn[k].needsUpdate = true;
  }
}

// The fitted skin carries a few hundred long stitching triangles deep inside the head (hidden when opaque,
// but they draw a streak through the glass/ghost head). Drop long triangles whose centroid lies well inside.
function stripInteriorSkin(geo) {
  const p = geo.attributes.position.array, I = geo.index.array, keep = [];
  let dropped = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const e = Math.max(Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]), Math.hypot(p[b] - p[c], p[b + 1] - p[c + 1], p[b + 2] - p[c + 2]), Math.hypot(p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]));
    const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    // interior of the head (ellipsoid) or of the neck (cylinder below the chin)
    const inHead = (cx / 0.06) ** 2 + ((cy - 1.58) / 0.085) ** 2 + ((cz + 0.005) / 0.075) ** 2 < 1;
    const inNeck = cy < 1.52 && (cx / 0.028) ** 2 + ((cz + 0.015) / 0.028) ** 2 < 1;
    if (e > 0.018 && (inHead || inNeck)) { dropped++; continue; }
    keep.push(I[t], I[t + 1], I[t + 2]);
  }
  if (dropped) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(keep), 1));
  geo.userData.droppedInterior = dropped;
}

// Smooth normals across separate patches (Z-Anatomy skin is split into ~100 regions): accumulate area-weighted
// face normals on positions welded to a 0.05 mm grid, then write the shared normal back to every copy.
function weldNormals(g) {
  const p = g.attributes.position.array, n = g.attributes.normal.array, I = g.index.array;
  const key = new Map(); const wid = new Int32Array(p.length / 3);
  const q = 20000;
  for (let i = 0; i < wid.length; i++) {
    const k = Math.round(p[i * 3] * q) + ',' + Math.round(p[i * 3 + 1] * q) + ',' + Math.round(p[i * 3 + 2] * q);
    let w = key.get(k); if (w === undefined) { w = key.size; key.set(k, w); } wid[i] = w;
  }
  const acc = new Float32Array(key.size * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [I[t], I[t + 1], I[t + 2]]) { const w = wid[v] * 3; acc[w] += nx; acc[w + 1] += ny; acc[w + 2] += nz; }
  }
  for (let i = 0; i < wid.length; i++) {
    const w = wid[i] * 3; const l = Math.hypot(acc[w], acc[w + 1], acc[w + 2]);
    if (l > 0) { n[i * 3] = acc[w] / l; n[i * 3 + 1] = acc[w + 1] / l; n[i * 3 + 2] = acc[w + 2] / l; }
  }
}

// Some source meshes carry vertex normals that disagree with their winding while their winding is correct.
// Compare vertex normals with winding normals on a sample of triangles and flip the normals if they disagree.
function fixNormals(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal, idx = geo.index;
  const triCount = (idx ? idx.count : p.count) / 3;
  const step = Math.max(1, Math.floor(triCount / 300));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3(), vn = new THREE.Vector3();
  let agree = 0, disagree = 0;
  for (let t = 0; t < triCount; t += step) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(p, i0); b.fromBufferAttribute(p, i1); c.fromBufferAttribute(p, i2);
    fn.subVectors(c, b).cross(a.sub(b));
    if (fn.lengthSq() < 1e-18) continue;
    vn.fromBufferAttribute(n, i0).add(c.fromBufferAttribute(n, i1)).add(b.fromBufferAttribute(n, i2));
    const d = fn.dot(vn);
    if (d > 0) agree++; else if (d < 0) disagree++;
  }
  if (disagree > agree * 1.5 && disagree > 3) {
    const arr = n.array; for (let i = 0; i < arr.length; i++) arr[i] = -arr[i];
    n.needsUpdate = true;
    return true;
  }
  return false;
}

const IDENT = new THREE.Matrix4();
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10007) / 10007; }

// ------------------------------------------------------------------ materials (one lit material per class)
const litCache = new Map();
export function litMaterial(cls) {
  if (litCache.has(cls)) return litCache.get(cls);
  const P = MAT_PARAMS[cls] || {};
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: P.r ?? 0.6, metalness: 0,
    side: DOUBLE_SIDED.has(cls) ? THREE.DoubleSide : THREE.FrontSide,
    transparent: TRANSPARENT.has(cls), opacity: P.o ?? 1, depthWrite: !TRANSPARENT.has(cls),
    envMapIntensity: P.env ?? 0.6,
  });
  m.name = 'lit:' + cls;
  if (cls === 'cornea') { m.blending = THREE.AdditiveBlending; m.opacity = 1; }   // tear film: reflections only
  patchLit(m, cls);
  litCache.set(cls, m);
  return m;
}
const MAT_PARAMS = {
  skin: { r: 0.56, env: 0.22 }, hair: { r: 0.7 }, hairFine: { r: 0.8, o: 0.92 },
  muscle: { r: 0.46, env: 0.55 }, tongue: { r: 0.4 }, tendon: { r: 0.46, env: 0.55 }, fascia: { r: 0.46, env: 0.5 },
  artery: { r: 0.3, env: 0.7 }, vein: { r: 0.32, env: 0.7 }, nerve: { r: 0.42 }, lymph: { r: 0.45 },
  bone: { r: 0.62, env: 0.5 }, tooth: { r: 0.22, env: 1.1 }, cartilage: { r: 0.7, env: 0.35 }, ligament: { r: 0.4 }, disc: { r: 0.35 },
  gland: { r: 0.5 }, thyroid: { r: 0.45 }, mucosa: { r: 0.3, env: 0.8 }, gingiva: { r: 0.35 }, ear: { r: 0.35 },
  cortex: { r: 0.5, env: 0.55 }, sulcus: { r: 0.5, env: 0.55 }, cerebellum: { r: 0.5 }, brainstem: { r: 0.45 }, white: { r: 0.45 }, deepgrey: { r: 0.5 },
  nucleus: { r: 0.5 }, plexus: { r: 0.35 }, pituitary: { r: 0.45 }, csf: { r: 0.15, o: 0.42, env: 1.2 }, meninges: { r: 0.3, o: 0.5 },
  sclera: { r: 0.3, env: 0.6 }, cornea: { r: 0.04, o: 1, env: 1.1 }, iris: { r: 0.72, env: 0.15 }, lens: { r: 0.1, o: 0.5, env: 1.2 },
  retina: { r: 0.5 }, vitreous: { r: 0.1, o: 0.14, env: 0.8 }, ciliary: { r: 0.6 },
};

// v3 textured skin: glTF base colour + normal + roughness maps, one material per variant (same shader program)
export function skinTexMaterial(tex, variant) {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: tex.map, normalMap: tex.normalMap || null, roughnessMap: tex.roughnessMap || null,
    roughness: 1, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.3,
  });
  if (tex.normalScale && m.normalMap) m.normalScale.copy(tex.normalScale).multiplyScalar(0.8);
  for (const t of [tex.map, tex.normalMap, tex.roughnessMap]) if (t) t.anisotropy = 8;
  m.name = 'lit:skintex:' + variant;
  patchLit(m, 'skintex');
  return m;
}

export const ghostMaterial = patchGhost(new THREE.MeshMatcapMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide }));
ghostMaterial.name = 'ghost';

function stencilMat(side, op) {
  const m = new THREE.MeshBasicMaterial({ side, colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true });
  m.stencilFunc = THREE.AlwaysStencilFunc; m.stencilFail = op; m.stencilZFail = op; m.stencilZPass = op;
  m.name = 'stencil';
  return patchStencil(m);
}
export const stencilBack = stencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp);
export const stencilFront = stencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp);
export { CAP_ORDER, EYE_INTERIOR, G };
