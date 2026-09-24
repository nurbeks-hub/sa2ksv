// Orbit module: optic nerve (intraorbital) and the six extraocular muscles, assembled pose, eye frame (mm).
// Geometry: ./orbit/muscles.js, ./orbit/nerve.js (sweeps in ./orbit/sweep.js); materials: ./orbit/shaders.js.
import * as THREE from 'three';
import { buildMuscleGeometry } from './orbit/muscles.js';
import { buildNerveGeometry } from './orbit/nerve.js';
import { muscleMaterial, nerveMaterial, sheathMaterial } from './orbit/shaders.js';

function topAnchor(sw, frac) {
  const i = Math.round((sw.S - 1) * frac), j = Math.round(sw.M / 4);
  const a = sw.geometry.attributes.position;
  return new THREE.Vector3().fromBufferAttribute(a, i * sw.M + j);
}

function focusOf(geometry, pad = 1.0) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const c = bb.getCenter(new THREE.Vector3());
  const r = bb.getSize(new THREE.Vector3()).length() / 2;
  return { center: c, radius: r * pad };
}

export function build(ctx) {
  const m = buildMuscleGeometry(ctx);
  const nv = buildNerveGeometry(ctx, m);
  const parts = [];

  // ---- extraocular muscles
  const defs = [
    ['superior-rectus', m.sr, 11, 0.55],
    ['inferior-rectus', m.ir, 23, 0.55],
    ['medial-rectus', m.mr, 37, 0.55],
    ['lateral-rectus', m.lr, 51, 0.55],
    ['superior-oblique', m.so, 67, 0.38],
    ['inferior-oblique', m.io, 79, 0.45],
  ];
  for (const [id, data, seed, af] of defs) {
    const mat = muscleMaterial({ seed, length: data.sw.Ltot, twist: id === 'superior-oblique' ? 0.08 : 0, twistEnd: id === 'superior-oblique' ? data.marks.sX + 1 : 0 });
    const mesh = new THREE.Mesh(data.geometry, mat);
    mesh.name = id;
    const g = new THREE.Group(); g.name = id; g.add(mesh);
    const u = mat.userData.orbitUniforms;
    parts.push({
      id, object: g, pickables: [mesh],
      anchor: topAnchor(data.sw, af),
      focus: focusOf(data.geometry, 0.62),
      update(frame) { u.uVessels.value = frame.vessels || 0; },
    });
  }

  // ---- optic nerve: neural core with the apex cut face, translucent dural sheath, pial / dural vessels
  const coreMat = nerveMaterial();
  const sheathMat = sheathMaterial();
  const vMat = ctx.vessels.vesselMaterial();
  const core = new THREE.Mesh(nv.coreGeo, coreMat); core.name = 'optic-nerve-core';
  const sheath = new THREE.Mesh(nv.sheathGeo, sheathMat); sheath.name = 'optic-nerve-sheath'; sheath.renderOrder = 2;
  const pial = new THREE.Mesh(nv.vesselGeo, vMat); pial.name = 'optic-nerve-pial-vessels';
  const ng = new THREE.Group(); ng.name = 'optic-nerve'; ng.add(core, pial, sheath);
  const cu = coreMat.userData.orbitUniforms, su = sheathMat.userData.orbitUniforms;
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  let inspectAttach = 1;
  parts.push({
    id: 'optic-nerve', object: ng, pickables: [sheath, core],
    anchor: nv.anchor,
    focus: focusOf(nv.sheathGeo, 0.6),
    update(frame) {
      const v = frame.vessels || 0;
      cu.uVessels.value = v; su.uVessels.value = v;
      // dura fused onto the sclera only while the nerve sits on the globe; cut free when the nerve's
      // explode window starts (0.24) or when it is inspected with the globe ghosted
      const tgt = frame.inspect && (frame.ghost || 0) < 0.5 ? 0 : 1;
      inspectAttach += (tgt - inspectAttach) * (1 - Math.exp(-(frame.dt || 1 / 60) * 6));
      if (Math.abs(tgt - inspectAttach) < 0.002) inspectAttach = tgt;
      su.uAttach.value = (1 - ss(0.24, 0.3, frame.explode || 0)) * inspectAttach;
      vMat.uniforms.uTime.value = frame.time || 0;
      vMat.uniforms.uGlow.value = v;
    },
  });

  if (typeof location !== 'undefined' && /\/dev\//.test(location.pathname)) {
    const minR = {};
    for (const [id, data] of defs) minR[id] = +data.sw.minR.toFixed(3);
    let tris = 0; for (const p of parts) p.object.traverse(o => { if (o.isMesh) tris += o.geometry.index.count / 3; });
    globalThis.__orbit = { minR, tris, nerve: nv.stats, marks: m.so.marks };
  }
  return parts;
}
