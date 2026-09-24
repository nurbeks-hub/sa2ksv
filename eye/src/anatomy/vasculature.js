// Vasculature of the right eye: every vessel part, each built as ONE merged tube geometry with ONE vessel
// material (flow pulses run trunk -> periphery for arteries and periphery -> trunk for veins, continuous
// across branches and across parts via dist0).
//
// Load order: the parts that show in the hero frame (conjunctival vessels, anterior ciliary arteries) and the
// cheap orbital ones are built in build(); the heavy, hidden ones (retinal trees, central retinal vessels, vortex
// veins: space colonization) are filled in idle slices after the first frame, so they never tax time-to-first-frame.
// Their Part objects exist from the start (empty group + pick proxy) and receive their mesh when ready.
import * as THREE from 'three';
import { buildRetinalTrees, DEFAULT_SURF, RETINA_R } from './vasculature/retina.js';
import { buildOphthalmic, buildCentralRetinal } from './vasculature/orbital.js';
import { buildAnteriorCiliary, buildPosteriorCiliary } from './vasculature/ciliary.js';
import { buildVortex } from './vasculature/vortex.js';
import { buildConjunctival } from './vasculature/conjunctiva.js';
import { nerveFrame, craEntry } from './vasculature/landmarks.js';
import { tubeGeometry, pickProxyGeometry, PROXY_MAT, enhanceVesselMaterial, PathSet } from './vasculature/util.js';

// Per-part look. Glow gains set the hierarchy of vessels mode: retina (hero) > orbital trunks > ciliary > conjunctiva
// > vortex (deep, many, would otherwise swamp everything).
const LOOKS = {
  'retinal-vessels': {
    colors: { artery: 0xc4402f, vein: 0x6a1c24, capillary: 0xb04a3a },
    tiers: [
      { min: 0.034, opts: { radial: 10, minRadial: 7, lengthStep: 0.07 } },
      { min: 0.006, max: 0.034, opts: { radial: 5, minRadial: 4, lengthStep: 0.18 } },
      { min: 0.0, max: 0.006, opts: { radial: 4, minRadial: 4, lengthStep: 0.03 } },       // perifoveal capillaries
    ],
    enhance: { thinTint: 0.1, reflex: 0.2, reflexPow: 36, spec: 0.45, rim: 0, edge: 0.3, edgeColor: 0xc8643c, fade: 0.8, fadeColor: 0xc8643c,
      glowGain: 1.3, thinGlow: 0.34, facingSign: -1, farGlow: 0.45, capNear: 10, capFar: 16 },
    proxy: { minR: 0.02, scale: 2.2, add: 0.1 },
  },
  'central-retinal-vessels': {
    colors: { artery: 0xb42c2e, vein: 0x5e1a22 },
    tiers: [{ min: 0, opts: { radial: 12, minRadial: 10, lengthStep: 0.08 } }],
    enhance: { thinTint: 0.0, reflex: 0.08, spec: 0.5, rim: 0.6, mottle: 0.12, core: 0.16, glowGain: 1.2, farGlow: 0.35 },
    proxy: { minR: 0, scale: 2.0, add: 0.25 },
  },
  'ophthalmic-artery': {
    colors: { artery: 0xae2a2e },
    tiers: [
      { min: 0.3, opts: { radial: 20, minRadial: 16, lengthStep: 0.18 } },
      { min: 0, max: 0.3, opts: { radial: 12, minRadial: 10, lengthStep: 0.16 } },
    ],
    enhance: { thinTint: 0.0, reflex: 0.07, spec: 0.5, rim: 0.6, mottle: 0.16, core: 0.2, glowGain: 1.2, farGlow: 0.22 },
    proxy: { minR: 0, scale: 1.6, add: 0.3 },
  },
  'posterior-ciliary-arteries': {
    colors: { artery: 0xae2c32 },
    tiers: [
      { min: 0.1, opts: { radial: 10, minRadial: 8, lengthStep: 0.12 } },
      { min: 0, max: 0.1, opts: { radial: 8, minRadial: 6, lengthStep: 0.1 } },
    ],
    enhance: { thinTint: 0.1, reflex: 0.08, spec: 0.6, rim: 0.6, mottle: 0.08, core: 0.1, glowGain: 0.6, farGlow: 0.3, fadeGlow: 0.8 },
    proxy: { minR: 0, scale: 2.2, add: 0.2 },
  },
  'anterior-ciliary-arteries': {
    colors: { artery: 0x98323a },
    tiers: [
      { min: 0.05, opts: { radial: 9, minRadial: 7, lengthStep: 0.08 } },
      { min: 0, max: 0.05, opts: { radial: 5, minRadial: 4, lengthStep: 0.1 } },
    ],
    enhance: { thinTint: 0.2, reflex: 0.05, spec: 0.3, rim: 0.2, edge: 0.4, edgeColor: 0xd8c8c2, fade: 0.6, fadeColor: 0xa47272,
      glowGain: 0.6, farGlow: 0.3 },
    proxy: { minR: 0.02, scale: 2.5, add: 0.15 },
  },
  'conjunctival-vessels': {
    colors: { artery: 0xbe3a44, vein: 0x8c2e3c, capillary: 0xc0525a },
    tiers: [
      { min: 0.026, opts: { radial: 7, minRadial: 5, lengthStep: 0.08 } },
      { min: 0.0075, max: 0.026, opts: { radial: 4, minRadial: 4, lengthStep: 0.1 } },
      { min: 0, max: 0.0075, opts: { radial: 4, minRadial: 4, lengthStep: 0.025 } },     // palisade loops, limbal venous ring
    ],
    enhance: { thinTint: 0.2, reflex: 0.04, spec: 0.15, rim: 0, edge: 0.5, edgeColor: 0xd8c8c2, fade: 0.8, fadeColor: 0xd8c2bb,
      thinGlow: 0.5, glowGain: 0.45, farGlow: 0.3, capNear: 17, capFar: 27 },
    proxy: { minR: 0.015, scale: 3.0, add: 0.12 },
  },
  'vortex-veins': {
    colors: { vein: 0x4c1624 },
    tiers: [
      { min: 0.2, opts: { radial: 16, minRadial: 12, lengthStep: 0.09 } },
      { min: 0, max: 0.2, opts: { radial: 7, minRadial: 5, lengthStep: 0.2 } },
    ],
    enhance: { thinTint: 0.15, reflex: 0.0, spec: 0.35, rim: 0.4, fade: 0.7, fadeColor: 0x2c110e, glowGain: 0.2, fadeGlow: 0.9, veinGlow: 0.6, farGlow: 0.25 },
    proxy: { minR: 0.06, scale: 1.8, add: 0.2 },
  },
};

function makePart(ctx, id, { anchor, focus }) {
  const look = LOOKS[id];
  const mat = enhanceVesselMaterial(ctx.vessels.vesselMaterial(look.colors), look.enhance);
  mat.name = `vessels:${id}`;
  const group = new THREE.Group();
  group.name = id;
  const proxy = new THREE.Mesh(new THREE.BufferGeometry(), PROXY_MAT);
  proxy.name = 'pick-proxy';
  group.add(proxy);
  const part = {
    id, object: group, pickables: [proxy], anchor, focus, mesh: null, material: mat,
    update(frame) {
      mat.uniforms.uTime.value = frame.time;
      mat.uniforms.uGlow.value = frame.vessels || 0;
    },
    fill(paths) {
      const mesh = new THREE.Mesh(tubeGeometry(ctx.vessels, paths, look.tiers), mat);
      mesh.name = id;
      mesh.userData.partId = id;
      group.add(mesh);
      part.mesh = mesh;
      const g = pickProxyGeometry(ctx.vessels, paths, look.proxy);
      proxy.geometry.dispose();
      proxy.geometry = g;
      proxy.userData.partId = id;
    },
  };
  return part;
}

const nearestPoint = (paths, q, filter = () => true) => {
  let best = null, bd = Infinity;
  for (const p of paths) if (filter(p)) for (const v of p.points) { const d = v.distanceToSquared(q); if (d < bd) { bd = d; best = v; } }
  return best ? best.clone() : q.clone();
};

// The optic-nerve-head cup and the foveal pit of the posterior module, so the retinal vessels lie on its surfaces.
async function loadSurfaces() {
  const surf = { disc: DEFAULT_SURF.disc, pit: DEFAULT_SURF.pit };
  try {
    const sh = await import('./posterior/shaders.js');
    if (sh.DISC_GEOM && sh.DISC_GEOM.cupAx) surf.disc = sh.DISC_GEOM;
  } catch (e) { /* posterior module absent: replicated defaults */ }
  try {
    const po = await import('./posterior.js');
    if (typeof po.foveaPit === 'function') surf.pit = po.foveaPit;
    if (typeof po.discDepth === 'function') surf.cupDepth = po.discDepth;
  } catch (e) { /* defaults */ }
  return surf;
}

const nextFrame = () => new Promise(res => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setTimeout(res, 0)) : setTimeout(res, 0)));
const idleSlice = fn => new Promise(res => {
  const run = () => { try { fn(); } catch (e) { console.error('[vasculature] deferred build failed', e); } res(); };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 500 }); else setTimeout(run, 16);
});

export async function build(ctx) {
  const { rng, am, L, EYE } = ctx;
  const surf = await loadSurfaces();
  const nf = nerveFrame();

  // ---- ophthalmic artery first (it sets the flow distance of everything downstream)
  const oph = buildOphthalmic();

  // ---- parts (all exist from the start; heavy ones are filled later)
  const fovea = am.retinaMap(0, 0, RETINA_R);
  const retPart = makePart(ctx, 'retinal-vessels', {
    anchor: am.retinaMap(-1.2, 3.9, RETINA_R),
    focus: { center: fovea.clone().lerp(am.retinaMap(2.4, 0, RETINA_R), 0.5).multiplyScalar(0.8), radius: 9 },
  });
  const cenPart = makePart(ctx, 'central-retinal-vessels', {
    anchor: craEntry().art.clone(),
    focus: { center: nf.at(EYE.craEntryBehindGlobe * 0.45).p.clone(), radius: 8 },
  });
  const ophPart = makePart(ctx, 'ophthalmic-artery', {
    anchor: oph.paths[0].points[Math.floor(oph.paths[0].points.length * 0.55)].clone(),
    focus: { center: new THREE.Vector3(6, 2, -26), radius: 17 },
  });
  ophPart.fill(oph.paths);

  // ---- anterior segment first: the hero frame shows these
  const aca = buildAnteriorCiliary({ rng: rng(77), dist0: oph.muscularDist + 38 });
  const acaPart = makePart(ctx, 'anterior-ciliary-arteries', {
    anchor: nearestPoint(aca.paths, am.behindLimbus(EYE.recti.lateral.fromLimbus - 1.5, Math.PI, L.scleraOuterR + 0.05), p => p.tag && p.tag.startsWith('aca-lateral')),
    focus: { center: new THREE.Vector3(0, 0, 8.5), radius: 11 },
  });
  acaPart.fill(aca.paths);

  const conj = buildConjunctival({ rng: rng(9090), dist0: 55, arcade: aca.arcade });
  const conjPart = makePart(ctx, 'conjunctival-vessels', {
    anchor: nearestPoint(conj.paths, am.behindLimbus(5.0, Math.PI * 1.04, L.scleraOuterR + 0.08), p => p.kind < 2 && (p.kind % 1) < 0.1),
    focus: { center: new THREE.Vector3(0, 0, 8), radius: 12 },
  });
  conjPart.fill(conj.paths);

  // ---- posterior ciliary arteries (continue the two PCA trunks of the ophthalmic artery)
  const pca = buildPosteriorCiliary({ rng: rng(515), lat: oph.pcaLat, med: oph.pcaMed });
  const viewDir = new THREE.Vector3(-0.72, 0.25, -0.65).normalize();
  const pcaAnchor = pca.spcaEntries.reduce((b, p) => (p.clone().normalize().dot(viewDir) > b.clone().normalize().dot(viewDir) ? p : b), pca.spcaEntries[0]).clone();
  const pcaPart = makePart(ctx, 'posterior-ciliary-arteries', {
    anchor: pcaAnchor,
    focus: { center: am.retinaMap(am.DISC_MAP.x, am.DISC_MAP.y, L.scleraOuterR + 1.0).multiplyScalar(0.94), radius: 9 },
  });
  pcaPart.fill(pca.paths);

  const vorPart = makePart(ctx, 'vortex-veins', {
    anchor: am.VORTEX_EXITS[1].clone().normalize().multiplyScalar(L.scleraOuterR + 0.4),
    focus: { center: new THREE.Vector3(0, 0, -1), radius: 15 },
  });

  // ---- deferred: retina (hero of the fundus), central retinal vessels, vortex veins
  let ret = null;
  const ready = (async () => {
    await nextFrame();
    await idleSlice(() => { ret = buildRetinalTrees({ rng: rng(4242), surf }); });
    await idleSlice(() => {
      const cen = buildCentralRetinal({ craStart: oph.craEnd.point, craDist0: oph.craEnd.dist, rootA: ret.rootA, rootV: ret.rootV, rootR: ret.rootR });
      cenPart.fill(cen.paths);
      const retSet = new PathSet();
      for (const d of ret.dense) retSet.add(d.pts, Array.from(d.rads), d.tree, { dist0: d.dist0 + (d.tree === 0 ? cen.artEnd : cen.veinEnd) });
      for (const c of ret.caps) retSet.add(c.pts, c.rads, c.kind, { dist0: cen.artEnd + 12, noPick: true });
      retPart.fill(retSet.paths);
    });
    await idleSlice(() => { vorPart.fill(buildVortex({ rng: rng(3131) }).paths); });
    if (typeof window !== 'undefined') window.__vasculatureReady = true;
  })();
  for (const p of [retPart, cenPart, vorPart]) p.ready = ready;

  return [conjPart, acaPart, pcaPart, retPart, vorPart, cenPart, ophPart];
}
