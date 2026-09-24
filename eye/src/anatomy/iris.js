// IRIS module — adult right eye. Parts: iris (stroma + pigment epithelium), sphincter-pupillae, dilator-pupillae,
// iris-vessels. All layers share one parametric slab (iris/profile.js) and are driven by the live pupil on the GPU.
// See process/modules/iris.md for the design notes.
import * as THREE from 'three';
import { paintIris } from './iris/paint.js';
import { buildStromaSurface, buildStrands, buildPigment } from './iris/stroma.js';
import { buildSphincter, buildDilator } from './iris/muscles.js';
import { buildIrisVessels } from './iris/vessels.js';
import { SHARED, setLook } from './iris/shading.js';
import { P0, PMIN, PMAX, R1, TAU, MAC, rad, front, back, sOf, sphincter, pth, thick } from './iris/profile.js';

export async function build(ctx) {
  const quality = ctx.quality === 'low' ? 'low' : 'high';
  const paint = paintIris(ctx.rng, { quality });
  const stroma = buildStromaSurface({ ...paint, quality });
  const strands = buildStrands({ ...paint, rng: ctx.rng, quality });
  const pigment = buildPigment({ quality });
  const sph = buildSphincter({ quality });
  const dil = buildDilator({ quality });
  const ves = buildIrisVessels(ctx, quality);

  // ---------------------------------------------------------------- invisible pick proxies (follow the pupil on the CPU)
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
  const ringProxy = (nu, nv, fn) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((nu + 1) * (nv + 1) * 3), 3));
    const idx = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    const m = new THREE.Mesh(g, proxyMat);
    m.userData.fill = (p) => {
      const arr = g.attributes.position.array; let k = 0;
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const v = fn(TAU * i / nu, j / nv, p); arr[k++] = v[0]; arr[k++] = v[1]; arr[k++] = v[2]; }
      g.attributes.position.needsUpdate = true; g.computeBoundingSphere(); g.computeBoundingBox();
    };
    return m;
  };
  const polar = (th, r, z) => [r * Math.cos(th), r * Math.sin(th), z];
  // every layer uses the local margin radius q = pth(theta, p) (decentred, slightly irregular pupil)
  const irisProxy = ringProxy(96, 6, (th, v, p) => { const q = pth(th, p); return polar(th, rad(v, q), front(v, q) + 0.02); });
  const sphProxy = ringProxy(96, 2, (th, v, p) => { const S = sphincter(pth(th, p)); const r = S.rc + (v - 0.5) * S.w; return polar(th, r, S.zc + S.h / 2); });
  const dilProxy = ringProxy(96, 4, (th, v, p) => {
    const q = pth(th, p), S = sphincter(q), s0 = sOf(S.rc, q), s = s0 + (0.99 - s0) * v;
    return polar(th, rad(s, q), back(s, q) + 0.01);
  });
  const vesProxy = new THREE.Mesh(ves.proxyGeo, proxyMat);
  const vpRest = ves.proxyGeo.attributes.position.array.slice();
  const vpNorm = ves.proxyGeo.attributes.normal.array, vpRad = ves.proxyGeo.attributes.aRadius.array;
  const remapProxy = (p) => {       // CPU twin of GLSL_REMAP in iris/vessels.js
    const arr = ves.proxyGeo.attributes.position.array;
    for (let i = 0; i < vpRad.length; i++) {
      const cx = vpRest[i * 3] - vpNorm[i * 3] * vpRad[i], cy = vpRest[i * 3 + 1] - vpNorm[i * 3 + 1] * vpRad[i], cz = vpRest[i * 3 + 2] - vpNorm[i * 3 + 2] * vpRad[i];
      const r = Math.hypot(cx, cy), th = Math.atan2(cy, cx), q0 = pth(th, P0), q = pth(th, p);
      let s = (r - q0) / (R1 - q0);
      let nx = cx, ny = cy, nz = cz;
      if (s < 1 && r > 1e-4) {
        s = Math.max(s, 0);
        const d = (front(s, q0) - cz) / thick(s, q0);
        const k = rad(s, q) / r;
        nx = cx * k; ny = cy * k; nz = front(s, q) - d * thick(s, q);
      }
      arr[i * 3] = nx + vpNorm[i * 3] * vpRad[i]; arr[i * 3 + 1] = ny + vpNorm[i * 3 + 1] * vpRad[i]; arr[i * 3 + 2] = nz + vpNorm[i * 3 + 2] * vpRad[i];
    }
    ves.proxyGeo.attributes.position.needsUpdate = true; ves.proxyGeo.computeBoundingSphere(); ves.proxyGeo.computeBoundingBox();
  };

  // ---------------------------------------------------------------- groups
  const gIris = new THREE.Group(); gIris.name = 'iris';
  gIris.add(stroma.mesh, strands.mesh, pigment.mesh, irisProxy);
  const gSph = new THREE.Group(); gSph.name = 'sphincter-pupillae'; gSph.add(sph.mesh, sphProxy);
  const gDil = new THREE.Group(); gDil.name = 'dilator-pupillae'; gDil.add(dil.mesh, dilProxy);
  const gVes = new THREE.Group(); gVes.name = 'iris-vessels'; gVes.add(ves.mesh, vesProxy);

  // ---------------------------------------------------------------- anchors / focus
  const anchors = {
    iris: new THREE.Vector3(), sph: new THREE.Vector3(), dil: new THREE.Vector3(),
    ves: ves.paths.macPt(3.95),
  };
  const placeAnchors = (p) => {
    const thI = 2.35, sI = 0.62, qI = pth(thI, p); anchors.iris.set(...polar(thI, rad(sI, qI), front(sI, qI) + 0.05));
    const S = sphincter(pth(0.75, p)); anchors.sph.set(...polar(0.75, S.rc, S.zc + S.h / 2));
    const sD = 0.72, qD = pth(4.1, p); anchors.dil.set(...polar(4.1, rad(sD, qD), back(sD, qD) + 0.01));
  };

  // ---------------------------------------------------------------- shared per-frame state
  // The pupil dynamics (light reflex, hippus) are owned by the core: frame.pupilR is used as is (one filter only).
  const st = { key: null, proxyP: -1, look: {} };
  function tick(frame) {
    const key = `${frame.time}|${frame.dt}`;
    if (key === st.key) return;
    st.key = key;
    const p = THREE.MathUtils.clamp(Number.isFinite(frame.pupilR) ? frame.pupilR : P0, PMIN * 0.8, PMAX * 1.08);
    const t = frame.time || 0;
    SHARED.uPupil.value = p;
    SHARED.uTime.value = t;
    SHARED.uVes.value = THREE.MathUtils.clamp(frame.vessels || 0, 0, 1);
    ves.mat.uniforms.uTime.value = t;
    ves.mat.uniforms.uGlow.value = SHARED.uVes.value;
    if (Math.abs(p - st.proxyP) > 0.01) {
      st.proxyP = p;
      irisProxy.userData.fill(p); sphProxy.userData.fill(p); dilProxy.userData.fill(p); remapProxy(p);
      placeAnchors(p);
    }
  }
  placeAnchors(P0);
  tick({ time: 0, dt: 0, pupilR: P0, vessels: 0 });

  // ---------------------------------------------------------------- parts
  const makePart = (id, object, pickables, anchor, focus, looks) => {
    const state = { ghost: 0, hl: 0 };
    const apply = () => looks(state.ghost, state.hl);
    st.look[id] = apply;
    return {
      id, object, pickables, anchor, focus,
      update(frame) { tick(frame); apply(); },
      setGhost(ghost, highlight = 0) { state.ghost = ghost; state.hl = highlight; apply(); },
    };
  };
  const zc = front(0.5, P0);
  if (typeof window !== 'undefined' && /irisdebug/.test(location.search)) window.__iris = { stroma, strands, pigment, sph, dil, ves, SHARED, paint };
  // Vessel mode is owned by the core (it ghosts every non-vessel part by frame.vessels); the iris does not add a fade
  // of its own, so the two never multiply.
  return [
    makePart('iris', gIris, [irisProxy], anchors.iris, { center: new THREE.Vector3(0, 0, zc - 0.1), radius: 6.6 }, (g, h) => {
      setLook(gIris, [...stroma.mats, ...strands.mats, ...pigment.mats], g, h, 1);
      // opaque: stroma first (early-z rejects the layers behind it); blended: after the other iris layers
      const tr = stroma.mats[0].transparent;
      stroma.mesh.renderOrder = tr ? 1 : -2; strands.mesh.renderOrder = tr ? 2 : -1;
      irisProxy.visible = g < 0.995;
    }),
    makePart('sphincter-pupillae', gSph, [sphProxy], anchors.sph, { center: new THREE.Vector3(0, 0, sphincter(P0).zc), radius: 3.1 },
      (g, h) => setLook(gSph, sph.mats, g, h, 1)),
    makePart('dilator-pupillae', gDil, [dilProxy], anchors.dil, { center: new THREE.Vector3(0, 0, back(0.5, P0)), radius: 6.4 },
      (g, h) => setLook(gDil, dil.mats, g, h, 1)),
    makePart('iris-vessels', gVes, [vesProxy], anchors.ves, { center: new THREE.Vector3(0, 0, MAC.z + 0.4), radius: 7.0 },
      (g, h) => setLook(gVes, [ves.mat], g, h, 1)),
  ];
}
