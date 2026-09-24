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

export function buildModel(gltfs) {
  const nodes = [];       // per structure-node record, index = sid
  const standalone = [];  // meshes kept separate
  const buckets = new Map();
  const tmpColor = new THREE.Color();
  let flipped = 0;

  for (const { file, gltf } of gltfs) {
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const raw = (o.userData && o.userData.name) || o.name;
      const c = classify(raw, file);
      if (c.helper) return;
      const geo = o.geometry;
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
      if (c.cls === 'muscle') {
        const fo = fibreOverride(name, rec.center, side);
        if (fo) rec.fibre = fo;
        else { const arr = pos.array; const idx = []; for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 400))) idx.push(i); rec.fibre = [...pca(arr, idx), 0]; }
      }
      nodes.push(rec);

      const hasMorph = geo.morphAttributes && Object.keys(geo.morphAttributes).length > 0;
      if (c.rotate || hasMorph) {
        const sidAttr = new THREE.Float32BufferAttribute(new Float32Array(pos.count).fill(sid), 1);
        geo.setAttribute('aSid', sidAttr);
        standalone.push({ rec, geo, morphDict: o.morphTargetDictionary || null });
        return;
      }
      const key = c.cls === 'skin' ? 'skin' : `${c.group}|${c.cls}|${c.cap || '-'}|${side}`;   // all skin patches in one mesh → seamless normals
      let b = buckets.get(key);
      if (!b) { b = { key, group: c.group, cls: c.cls, cap: c.cap, side, parts: [], verts: 0, idx: 0 }; buckets.set(key, b); }
      b.parts.push({ geo, sid }); b.verts += pos.count; b.idx += geo.index ? geo.index.count : pos.count;
    });
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

  return { nodes, merged, standalone, stateArr, stateTex, flipped };
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
