// Posterior segment of the right eye: vitreous, retina (with macula and optic disc) and choroid.
// Built in the ASSEMBLED pose, eye frame (+Z anterior, +Y superior, +X nasal), mm.
//
// Draw calls (<= 6): retina, optic disc, choroid, vitreous gel (+ Cloquet's canal), vitreous fibrils, and the
// macula overlay (drawn only while it differs from the retina: macula hovered, or the retina ghosted).
// Pick proxies (macula, disc, vitreous) are invisible meshes and cost no draw call.
import * as THREE from 'three';
import { EYE, L } from '../config.js';
import * as am from '../lib/anatomyMath.js';
import { applyGhost } from '../lib/materials.js';
import { explodeVector } from '../parts.js';
import { Builder, capGrid, rimStrip, dirPost } from './posterior/geometry.js';
import { buildChoroidTexture } from './posterior/choroidMap.js';
import { lightUniforms, makeFundusMaterial, makeChoroidMaterial, DISC_GEOM } from './posterior/shaders.js';
import { buildVitreous } from './posterior/vitreous.js';

const TAU = Math.PI * 2;
const R = L.retinaInnerR;                 // inner limiting membrane
const RO = L.choroidInnerR - 0.006;       // outer face of the RPE (Bruch's membrane)
const RHO_M = 2.9;                        // central disk of the retina grid (macula ~5.5 mm + margin)
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Foveal pit: depth ~0.18 mm (slightly deepened from ~0.13 for legibility), flat foveola (~0.35 mm),
// clivus, and a faint parafoveal rim where the ganglion-cell layer is thickest.
export function foveaPit(rho) {
  return 0.18 * 0.5 * (1 - Math.tanh((rho - 0.42) / 0.16)) - 0.015 * Math.exp(-(((rho - 1.05) / 0.42) ** 2));
}

// Ora serrata. The retina ends exactly where the ciliary module's pars plana ends (lens/profile.js tEnd), so
// the scallops match in the assembled eye: ~48 narrow dentate processes (tips point anteriorly, reaching
// 0.1 mm in front of am.oraPolar) between broad, rounded oral bays (0.18 mm behind it).
// (Proposed as a shared anatomyMath.oraTeeth(az); duplicated here until then.)
const ORA_X = az => az * 24 + 0.55 * Math.sin(az * 5 + 1.3) + 0.25 * Math.sin(az * 13 + 0.4);
const ORA_TIP = -0.1 / EYE.scleraOuterR;           // polar offset of the tooth tips (the anterior envelope)
export function oraEdgePolar(az) {
  const bay = Math.pow(Math.abs(Math.sin(ORA_X(az))), 0.55);
  return am.oraPolar(az) + (-0.1 + 0.28 * bay) / EYE.scleraOuterR;
}
// Azimuth samples (ascending from 0) with a vertex exactly at every tooth tip (x = k*pi), plus edge rho.
function oraSamples(perTooth = 10) {
  const x0 = ORA_X(0), x1 = ORA_X(TAU);
  const n = Math.round(perTooth * (x1 - x0) / Math.PI);
  const xs = [];
  const tips = [];
  for (let k = Math.ceil(x0 / Math.PI); k * Math.PI < x1; k++) tips.push(k * Math.PI);
  for (let i = 0; i < n; i++) {
    const x = x0 + (x1 - x0) * (i / n);
    if (i === 0 || tips.every(t => Math.abs(t - x) > 0.3 * Math.PI / perTooth)) xs.push(x);
  }
  xs.push(...tips);
  xs.sort((a, b) => a - b);
  const invX = x => { let lo = 0, hi = TAU; for (let it = 0; it < 50; it++) { const m = 0.5 * (lo + hi); if (ORA_X(m) < x) lo = m; else hi = m; } return 0.5 * (lo + hi); };
  const az = xs.map((x, i) => (i === 0 ? 0 : invX(x)));
  return { az, rhoEdge: az.map(a => (Math.PI - oraEdgePolar(a)) * R) };
}

function tangentAnterior(x, y, z) {
  const p = Math.atan2(Math.hypot(x, y), -z), a = Math.atan2(y, x);
  return [Math.cos(p) * Math.cos(a), Math.cos(p) * Math.sin(a), Math.sin(p)];
}

function buildRetinaGeometry(ora) {
  const B = new Builder();
  const radius = rho => R + (rho < RHO_M + 0.2 ? foveaPit(rho) : 0);
  const opts = { R, radius, rhoM: RHO_M, KC: 40, AZC: 160, azA: ora.az, rhoEdge: ora.rhoEdge, KA: 48, side: 0 };
  let m = B.mark();
  capGrid(B, opts);
  B.orient(m, B.mark(), (x, y, z) => [-x, -y, -z]);
  m = B.mark();
  capGrid(B, { ...opts, radius: () => RO, KC: 8, KC_pow: 1, KA: 10, side: 1 });
  B.orient(m, B.mark(), (x, y, z) => [x, y, z]);
  const tmp = new THREE.Vector3();
  const inner = ora.az.map((a, j) => dirPost(ora.rhoEdge[j] / R, a, tmp).clone().multiplyScalar(R));
  const outer = ora.az.map((a, j) => dirPost(ora.rhoEdge[j] / R, a, tmp).clone().multiplyScalar(RO));
  m = B.mark();
  rimStrip(B, inner, outer, 2, 3);
  B.orient(m, B.mark(), tangentAnterior);
  return B.geometry('aSide');
}

function buildMaculaGeometry() {
  const B = new Builder();
  const radius = rho => R + foveaPit(rho);
  capGrid(B, { R, radius, rhoM: RHO_M, KC: 40, AZC: 160, side: 0 });
  B.orient(0, B.mark(), (x, y, z) => [-x, -y, -z]);
  return B.geometry('aSide');
}

// Flat pick patch on the sphere just in front of the ILM (between the retina and the retinal vessels).
function patchGeometry(center, ax, ay, r, rings = 8, seg = 48) {
  const B = new Builder();
  const tmp = new THREE.Vector3();
  const place = (mx, my) => { const rho = Math.hypot(mx, my); return dirPost(rho / R, Math.atan2(my, mx), tmp).multiplyScalar(r); };
  const c = B.vv(place(center.x, center.y));
  let prev = null;
  for (let k = 1; k <= rings; k++) {
    const s = k / rings;
    const ring = [];
    for (let j = 0; j < seg; j++) { const a = (j / seg) * TAU; ring.push(B.vv(place(center.x + Math.cos(a) * ax * s, center.y + Math.sin(a) * ay * s))); }
    if (!prev) for (let j = 0; j < seg; j++) B.t(c, ring[j], ring[(j + 1) % seg]);
    else for (let j = 0; j < seg; j++) { const j1 = (j + 1) % seg; B.t(prev[j], ring[j], prev[j1]); B.t(prev[j1], ring[j], ring[j1]); }
    prev = ring;
  }
  B.orient(0, B.mark(), (x, y, z) => [-x, -y, -z]);
  return B.geometry(null);
}

// Optic nerve head: elliptical grid about the disc. The cup is a smooth cosine bowl (no flat floor) about the
// temporally displaced cup centre, 0.28 mm deep, with a gently sloping temporal wall and a steeper nasal wall
// (where the central vessels climb out); the margin blends into the fundus.
export function discDepth(mx, my) {
  const D = am.DISC_MAP, cc = DISC_GEOM.cupC, ca = DISC_GEOM.cupAx;
  const ux = (mx - D.x - cc.x) / ca.x, uy = (my - D.y - cc.y) / ca.y;
  const ec = Math.hypot(ux, uy);
  const nas = 0.5 + 0.5 * (ec > 1e-6 ? ux / ec : 0);
  const k = 0.8 + 0.8 * nas;
  const u = Math.min(1, ec / 1.08);
  return DISC_GEOM.depth * (0.5 + 0.5 * Math.cos(Math.PI * Math.pow(u, k)));
}
function buildDiscGeometry() {
  const B = new Builder();
  const D = am.DISC_MAP, ax = DISC_GEOM.axes;
  const NT = 128, K = 46, SMAX = 1.32;
  const tmp = new THREE.Vector3();
  const place = (mx, my) => {
    const rho = Math.hypot(mx, my);
    return dirPost(rho / R, Math.atan2(my, mx), tmp).multiplyScalar(R + discDepth(mx, my));
  };
  const c = B.vv(place(D.x, D.y));
  let prev = null;
  for (let k = 1; k <= K; k++) {
    const s = SMAX * Math.pow(k / K, 1.15);
    const ring = [];
    for (let j = 0; j < NT; j++) { const a = (j / NT) * TAU; ring.push(B.vv(place(D.x + Math.cos(a) * ax.x * s, D.y + Math.sin(a) * ax.y * s))); }
    if (!prev) for (let j = 0; j < NT; j++) B.t(c, ring[j], ring[(j + 1) % NT]);
    else for (let j = 0; j < NT; j++) { const j1 = (j + 1) % NT; B.t(prev[j], ring[j], prev[j1]); B.t(prev[j1], ring[j], ring[j1]); }
    prev = ring;
  }
  B.orient(0, B.mark(), (x, y, z) => [-x, -y, -z]);
  return B.geometry('aSide');
}

// Choroid: shell between Bruch's membrane and the sclera, from the ora serrata (the anterior envelope of the
// retinal teeth, so no tooth overhangs it) back to the optic disc margin (a real hole where the nerve
// leaves). Grid is polar about the disc so the hole is exact.
function buildChoroidGeometry() {
  const Ri = L.choroidInnerR, Ro = L.scleraInnerR - 0.006;
  const D = am.DISC_MAP;
  const dc = dirPost(D.length() / R, Math.atan2(D.y, D.x));
  const ex = new THREE.Vector3().crossVectors(dc, new THREE.Vector3(0, 1, 0)).normalize();
  const ey = new THREE.Vector3().crossVectors(ex, dc).normalize();
  const a = EYE.discDiameter.h * 0.5, b = EYE.discDiameter.v * 0.5;
  const NB = 256, KI = 44, KO = 40;
  const tmp = new THREE.Vector3();
  const dirAt = (al, be, out = tmp) => out.copy(dc).multiplyScalar(Math.cos(al))
    .addScaledVector(ex, Math.cos(be) * Math.sin(al)).addScaledVector(ey, Math.sin(be) * Math.sin(al));
  const betas = [], aH = [], aO = [];
  for (let j = 0; j < NB; j++) {
    const be = (j / NB) * TAU;
    const hole = 1 / Math.sqrt((Math.cos(be) / a) ** 2 + (Math.sin(be) / b) ** 2) / R;
    let lo = hole, hi = Math.PI - 0.01;
    for (let it = 0; it < 40; it++) {
      const mid = 0.5 * (lo + hi);
      const d = dirAt(mid, be);
      const f = Math.acos(THREE.MathUtils.clamp(d.z, -1, 1)) - (am.oraPolar(Math.atan2(d.y, d.x)) + ORA_TIP);
      if (f > 0) lo = mid; else hi = mid;
    }
    betas.push(be); aH.push(hole); aO.push(0.5 * (lo + hi));
  }
  const B = new Builder();
  const surface = (K, rad, side) => {
    const rings = [];
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      rings.push(betas.map((be, j) => B.vv(dirAt(aH[j] + (aO[j] - aH[j]) * t, be).multiplyScalar(rad), side)));
    }
    for (let k = 0; k < K; k++) {
      const r0 = rings[k], r1 = rings[k + 1];
      for (let j = 0; j < NB; j++) { const j1 = (j + 1) % NB; B.t(r0[j], r1[j], r0[j1]); B.t(r0[j1], r1[j], r1[j1]); }
    }
  };
  let m = B.mark(); surface(KI, Ri, 0); B.orient(m, B.mark(), (x, y, z) => [-x, -y, -z]);
  m = B.mark(); surface(KO, Ro, 1); B.orient(m, B.mark(), (x, y, z) => [x, y, z]);
  const awayFromDisc = (x, y, z) => {
    const u = new THREE.Vector3(x, y, z).normalize();
    const t = u.clone().multiplyScalar(u.dot(dc)).sub(dc);
    return [t.x, t.y, t.z];
  };
  const ring = (alphas, rad) => betas.map((be, j) => dirAt(alphas[j], be).clone().multiplyScalar(rad));
  m = B.mark(); rimStrip(B, ring(aO, Ri), ring(aO, Ro), 2, 3); B.orient(m, B.mark(), awayFromDisc);
  m = B.mark(); rimStrip(B, ring(aH, Ri), ring(aH, Ro), 2, 3);
  B.orient(m, B.mark(), (x, y, z) => { const e = awayFromDisc(x, y, z); return [-e[0], -e[1], -e[2]]; });
  return { geometry: B.geometry('aSide'), discDir: dc };
}

export async function build(ctx) {
  const t0 = performance.now();
  const lights = lightUniforms();
  const { tex: chorTex, phase: phaseTex, net } = buildChoroidTexture(ctx.quality === 'low' ? 1024 : 2048, 20260922);
  const t1 = performance.now();

  // --- retina, macula, disc
  const ora = oraSamples();
  const retinaMat = makeFundusMaterial('RETINA', lights, chorTex);
  const maculaMat = makeFundusMaterial('MACULA', lights, chorTex);
  const discMat = makeFundusMaterial('DISC', lights, chorTex);
  const retinaMesh = new THREE.Mesh(buildRetinaGeometry(ora), retinaMat);
  retinaMesh.name = 'retina';
  const maculaMesh = new THREE.Mesh(buildMaculaGeometry(), maculaMat);
  maculaMesh.name = 'macula';
  maculaMesh.renderOrder = 1;
  maculaMesh.visible = false;
  const discMesh = new THREE.Mesh(buildDiscGeometry(), discMat);
  discMesh.name = 'optic-disc';
  discMesh.renderOrder = -1;

  const hidden = () => new THREE.MeshBasicMaterial({ visible: false });
  const maculaProxy = new THREE.Mesh(patchGeometry(am.FOVEA_MAP, EYE.maculaDiameter / 2, EYE.maculaDiameter / 2, R - 0.015, 8, 48), hidden());
  maculaProxy.name = 'macula-pick';
  const discProxy = new THREE.Mesh(patchGeometry(am.DISC_MAP, DISC_GEOM.axes.x * 1.05, DISC_GEOM.axes.y * 1.05, R - 0.015, 6, 40), hidden());
  discProxy.name = 'optic-disc-pick';

  // camera in each mesh's local frame (translucency parallax); the retina cuts its disc only while the
  // real disc mesh is being drawn un-ghosted, so isolating/ghosting parts never leaves a hole.
  const camW = new THREE.Vector3();
  const setCam = (mesh, mat, camera) => { camW.setFromMatrixPosition(camera.matrixWorld); mat.uniforms.uCamLocal.value.copy(mesh.worldToLocal(camW)); };
  let retinaFrame = 0, discFrame = -10;
  retinaMesh.onBeforeRender = (r, s, camera) => {
    const f = ++retinaFrame;
    setCam(retinaMesh, retinaMat, camera);
    retinaMat.uniforms.uDiscCut.value = f - discFrame <= 1 && discMat.uniforms.uGhost.value < 0.5 ? 1 : 0;
  };
  maculaMesh.onBeforeRender = (r, s, camera) => setCam(maculaMesh, maculaMat, camera);
  discMesh.onBeforeRender = (r, s, camera) => { discFrame = retinaFrame + 1; setCam(discMesh, discMat, camera); };

  // --- choroid
  const { geometry: chorGeo } = buildChoroidGeometry();
  const ampDirs = am.VORTEX_EXITS.map(v => v.clone().normalize());
  const poleDir = dirPost(0.2, 0.05);
  const choroidMat = makeChoroidMaterial(lights, chorTex, phaseTex, ampDirs, poleDir);
  const choroidMesh = new THREE.Mesh(chorGeo, choroidMat);
  choroidMesh.name = 'choroid';

  // --- vitreous
  const vit = buildVitreous(lights);
  const vitInner = new THREE.Group();
  vitInner.add(vit.shell, vit.fibrils, vit.proxy);

  const group = (...o) => { const g = new THREE.Group(); o.forEach(x => g.add(x)); return g; };
  const retinaGroup = group(retinaMesh), choroidGroup = group(choroidMesh);
  // The globe encloses the fundus until the eye is opened: a living pupil is black without coaxial light,
  // so the fundus (and the gel) only light up as the anterior segment comes away, or when inspected.
  const enclOf = f => (f.inspect ? 1 : 0.06 + 0.94 * smooth(0.03, 0.25, f.explode || 0));
  const fundusUpdate = mat => frame => {
    const u = mat.uniforms;
    u.uTime.value = frame.time; u.uGlow.value = frame.vessels || 0; u.uEncl.value = enclOf(frame);
  };
  const retinaMapV = (x, y, r = R) => dirPost(Math.hypot(x, y) / R, Math.atan2(y, x)).multiplyScalar(r);
  let lastVessels = 0;
  const ev = [0, 0, 0], er = [0, 0, 0];

  const t2 = performance.now();
  if (typeof window !== 'undefined') {
    window.__posteriorStats = { texMs: Math.round(t1 - t0), totalMs: Math.round(t2 - t0), vesselBranches: net.branches.length, streams: net.streams, growSteps: net.totalSteps, fibrils: vit.fibrilCount, oraSamples: ora.az.length };
  }

  return [
    {
      id: 'vitreous',
      object: group(vitInner),
      pickables: [vit.proxy],
      anchor: dirPost(Math.PI - 1.05, 2.35).multiplyScalar(R - 0.4),
      focus: { center: new THREE.Vector3(0, 0, -1.5), radius: 11.5 },
      // subtle by default; full strength only while the vitreous itself is inspected or hovered
      update(frame) {
        const focus = (frame.inspect && (frame.ghost || 0) < 0.1) || (frame.highlight || 0) > 0.05 ? 1 : 0;
        const encl = enclOf(frame);
        for (const m of vit.materials) {
          m.uniforms.uTime.value = frame.time;
          m.uniforms.uEncl.value = encl;
          const u = m.uniforms.uStrength;
          u.value += ((focus ? 1.0 : 0.55) - u.value) * Math.min(1, (frame.dt || 0.016) * 6);
        }
        vit.shellMat.uniforms.uFocus.value = (vit.shellMat.uniforms.uStrength.value - 0.55) / 0.45;
        // Until parts.js moves the nested layers outermost-first, hold the gel inside the retina while the
        // explode windows would push it out behind the retina (a no-op with outermost-first windows).
        const e = frame.explode || 0;
        explodeVector('vitreous', e, ev); explodeVector('retina', e, er);
        vitInner.position.z = Math.max(0, er[2] - ev[2]);
        if (frame.camera) { vitInner.updateMatrixWorld(); vit.updateSide(frame.camera); }
      },
    },
    {
      id: 'retina',
      object: retinaGroup,
      pickables: [retinaMesh],
      anchor: retinaMapV(-5.8, 6.2),
      focus: { center: new THREE.Vector3(0, 0, -7.0), radius: 12 },
      update: fundusUpdate(retinaMat),
    },
    {
      id: 'macula',
      object: group(maculaMesh, maculaProxy),
      pickables: [maculaProxy, maculaMesh],
      anchor: retinaMapV(0, 0),
      focus: { center: retinaMapV(0, 0), radius: 3.2 },
      update(frame) {
        fundusUpdate(maculaMat)(frame);
        // the retina already draws the macula; the overlay is only needed while it looks different
        const gm = maculaMat.uniforms.uGhost.value, gr = retinaMat.uniforms.uGhost.value;
        const retinaShown = retinaGroup.visible && retinaMesh.visible && gr < 0.995;
        maculaMesh.visible = gm < 0.995 && (!retinaShown || maculaMat.uniforms.uHighlight.value > 0.01 || gm < gr - 0.01);
      },
    },
    {
      id: 'optic-disc',
      object: group(discMesh, discProxy),
      pickables: [discProxy],
      anchor: retinaMapV(am.DISC_MAP.x, am.DISC_MAP.y),
      focus: { center: retinaMapV(am.DISC_MAP.x, am.DISC_MAP.y), radius: 1.9 },
      update: fundusUpdate(discMat),
    },
    {
      id: 'choroid',
      object: choroidGroup,
      pickables: [choroidMesh],
      anchor: dirPost(1.2, 3.75).multiplyScalar(L.scleraInnerR),
      focus: { center: new THREE.Vector3(0, 0, -6.5), radius: 12.5 },
      update(frame) {
        const u = choroidMat.uniforms;
        u.uTime.value = frame.time; u.uGlow.value = frame.vessels || 0;
        lastVessels = frame.vessels || 0;
      },
      // In vessel mode the core half-ghosts the choroid (0.5 x vessels) so the vessels inside stay visible.
      // Keep that for the tissue, but add the circulation's glow at full strength (premultiplied output).
      setGhost(g, h) {
        choroidMat.uniforms.uVesGhost.value = Math.min(g, 0.5 * lastVessels);
        applyGhost(choroidGroup, g, h);
      },
    },
  ];
}
