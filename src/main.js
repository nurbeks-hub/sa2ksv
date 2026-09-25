// АДАМ БАСЫ / The Head — core: loading, intro, depth layers with dissolve, section caps, picking / inspect,
// living head (gaze, breathing, micro-turn), ♂/♀ morph, tour, search, i18n, sound and the test API.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { createStage } from './fx/stage.js';
import { buildModel, litMaterial, ghostMaterial, stencilBack, stencilFront, slug } from './core/model.js';
import { G, GROUP_DISSOLVE_AT, GROUP_REVEAL_AT, RAIL, RAIL_GROUPS, TRANSPARENT, EYE_INTERIOR } from './core/classify.js';
import { U, patchPick } from './core/shader.js';
import { createSection, CENTER } from './core/section.js';
import { loadSexField } from './core/sexfield.js';
import { loadContent } from './data/content.js';
import { UI, LANGS, initialLang, storeLang } from './ui/i18n.js';
import { Sound } from './audio/sound.js';
import { createDive } from './core/dive.js';

const Q = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const clamp = THREE.MathUtils.clamp;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const canvas = $('#gl');
const stage = createStage(canvas);
const { scene, camera, renderer } = stage;
const sound = new Sound();
if (Q.has('clean')) document.body.classList.add('clean');   // screenshots / thumbnails: no UI
if (Q.get('kiosk') === '1') { sound.enabled = false; stage.final.uniforms.uGrain.value = 0; }   // kiosk: silent until a visitor turns sound on; no grain
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;
const NO_INTRO = Q.has('nointro');
const FILES = ['skin', 'bones', 'muscles', 'vessels', 'nerves', 'organs', 'joints', 'lymph'];

// ============================================================ state
const S = {
  lang: initialLang(),
  depth: 0, depthTarget: 0, depthVel: 0,
  sex: 0, sexTarget: 0,
  section: null,
  inspect: null, inspectSid: -1,
  hoverSid: -1, hoverStruct: null,
  off: new Set(),                 // rail systems switched off
  hair: Q.get('hair') === '1',
  intro: NO_INTRO ? 1 : 0,
  ready: false,
  yawOff: 0, pitchOff: 0, yawVel: 0, pitchVel: 0, zoom: 1,
  pointer: new THREE.Vector2(0, 0), pointerPx: new THREE.Vector2(innerWidth * 0.4, innerHeight * 0.45), pointerIn: false,
  dragging: false, dragDist: 0, lastMove: 0, time: 0,
  touchedDepth: false,
  tourHl: null,
};

// ============================================================ loading UI
const loaderBar = $('#loader .bar i'), loaderPct = $('#loader .lsub b');
function setProgress(p) { loaderBar.style.transform = `scaleX(${clamp(p, 0, 1)})`; loaderPct.textContent = Math.round(p * 100) + '%'; }

async function fetchWithProgress(url, onBytes) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const total = +r.headers.get('content-length') || 0;
  if (!r.body || !total) { const b = await r.arrayBuffer(); onBytes(b.byteLength, b.byteLength); return b; }
  const reader = r.body.getReader(); const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onBytes(got, total); }
  const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

// ============================================================ model containers
const world = new THREE.Group();        // camera-independent root
const pivot = new THREE.Group();        // head micro-turn / breathing pivot (neck)
const rig = new THREE.Group();          // rest (glTF) coordinates live here
const NECK = new THREE.Vector3(0, 1.46, -0.02);
pivot.position.copy(NECK); rig.position.copy(NECK).multiplyScalar(-1);
pivot.add(rig); world.add(pivot); scene.add(world);
const section = createSection({ rig, scene });

let dive = null;             // organ deep-dive controller (core/dive.js)
let hairMod = null;          // optional strand hair (see __head.attachHair)
let M = null;                // model {nodes, merged, standalone, stateArr, stateTex}
let content = null;
const renderables = [];      // {mesh, ghost, group, cls, sids, eye}
const structs = new Map();   // structId → {id, sids, group, cls, name}
const sidToStruct = [];
const eyes = { L: null, R: null };
const pickMat = patchPick(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));

function setupScene() {
  const clip = section.clip;
  const mkMain = (geo, cls, group, parent, sids, eye) => {
    const mat = litMaterial(cls);
    mat.clippingPlanes = clip;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = true;
    mesh.layers.enable(1);
    if (TRANSPARENT.has(cls) && cls !== 'csf') mesh.layers.disable(1);   // glassy parts do not steal clicks
    if (TRANSPARENT.has(cls)) mesh.renderOrder = cls === 'cornea' ? 30 : 20;
    parent.add(mesh);
    const ghost = new THREE.Mesh(geo, ghostMaterial);
    ghost.visible = false; ghost.renderOrder = 40;
    parent.add(ghost);
    // brainstem and the optic/olfactory tracts are revealed with the nerve layer (the skull turns to glass there)
    // brainstem and optic tracts appear with the nerve layer; the tympanic membrane (sense-organ group) is under opaque skin
    const reveal = (group === G.brain && (cls === 'brainstem' || cls === 'nerve')) ? 2.5 : cls === 'ear' ? 0.002 : GROUP_REVEAL_AT[group];
    const r = { mesh, ghost, group, cls, sids, eye, allHidden: false, reveal };
    renderables.push(r);
    return r;
  };
  ghostMaterial.clippingPlanes = clip; stencilBack.clippingPlanes = clip; stencilFront.clippingPlanes = clip; pickMat.clippingPlanes = clip;
  for (const b of M.merged) {
    const r = mkMain(b.geo, b.cls, b.group, rig, b.sids, false);
    if (b.cap) section.addStencil(r.mesh, b.cap);
  }
  // eyes: globe parts rotate about the centre of the sclera
  const eyeParts = { L: [], R: [] };
  for (const s of M.standalone) {
    if (s.rec.rotate) eyeParts[s.rec.side === 'R' ? 'R' : 'L'].push(s);
  }
  for (const side of ['L', 'R']) {
    const parts = eyeParts[side]; if (!parts.length) continue;
    const scl = parts.find(p => p.rec.cls === 'sclera') || parts[0];
    const c = scl.rec.center.clone();
    U.uEye.value.set(Math.abs(c.x), c.y, c.z);
    const iris = parts.find(p => p.rec.cls === 'iris');
    if (iris) { const ic = iris.rec.center, is = iris.rec.box.getSize(new THREE.Vector3()); U.uIris.value.set(Math.abs(ic.x), ic.y, Math.max(is.x, is.y) / 2); }
    const piv = new THREE.Group(); piv.position.copy(c); rig.add(piv);
    eyes[side] = { pivot: piv, center: c, q: new THREE.Quaternion(), goal: new THREE.Quaternion() };
    for (const p of parts) {
      const r = mkMain(p.geo, p.rec.cls, p.rec.group, piv, [p.rec.sid], true);
      r.mesh.position.copy(c).multiplyScalar(-1); r.ghost.position.copy(r.mesh.position);
      if (p.rec.cap) section.addStencil(r.mesh, p.rec.cap);
    }
  }
  // other standalone meshes (morph targets, e.g. a fitted skin with a 'female' target)
  for (const s of M.standalone) {
    if (s.rec.rotate) continue;
    const r = mkMain(s.geo, s.rec.cls, s.rec.group, rig, [s.rec.sid], false);
    if (s.morphDict && 'female' in s.morphDict) { r.morphIndex = s.morphDict.female; r.mesh.morphTargetInfluences = new Array(Object.keys(s.morphDict).length).fill(0); r.mesh.morphTargetDictionary = s.morphDict; }
    if (s.rec.cap) section.addStencil(r.mesh, s.rec.cap);
  }
  // structures
  for (const rec of M.nodes) {
    const id = content.nodeToId[rec.node] || slug(rec.node);
    rec.structId = id;
    let st = structs.get(id);
    if (!st) { st = { id, sids: [], group: rec.group, cls: rec.cls, hidden: rec.hidden, box: new THREE.Box3() }; structs.set(id, st); }
    st.sids.push(rec.sid); st.box.union(rec.box);
    sidToStruct[rec.sid] = st;
  }
  for (const st of structs.values()) {
    st.center = st.box.getCenter(new THREE.Vector3());
    // content team: records flagged hide:true are technical / out of scope → never shown, not searchable
    if (content.hidden(st.id)) {
      st.excluded = true;   // no record: never named, searched or selectable
      // cortex parcels flagged hide (e.g. Lat_Fis-*, Jensen's sulcus) are still drawn as anonymous cortex —
      // removing them would punch holes in the brain surface
      if (!(st.cls === 'cortex' || st.cls === 'sulcus')) { st.hidden = true; for (const s of st.sids) M.nodes[s].hidden = true; }
    }
  }
}

// ============================================================ camera rig (orbit around target, projection shifted left)
const cam = { target: new THREE.Vector3(0, 1.575, 0), yaw: -0.52, pitch: 0.06, dist: 1.25 };
const HOME = { target: new THREE.Vector3(0, 1.578, 0.005), yaw: -0.52, pitch: 0.06, dist: 1.0 };
const INTRO = { target: new THREE.Vector3(0, 1.585, 0.01), yaw: -0.18, pitch: 0.02, dist: 1.75 };
const want = { target: new THREE.Vector3(), yaw: 0, pitch: 0, dist: 1 };
let shiftX = -0.2, shiftY = 0.0;
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const sph = (yaw, pitch) => new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
function layoutShift() {
  const a = innerWidth / innerHeight;
  if (dive && dive.active && !dive.frame) { if (a < 0.9) return [0, -0.2]; return [document.body.classList.contains('dive-card') ? 0.02 : 0.22, 0.02]; }
  if (a < 0.9) return [0, 0.12];                       // portrait phone: centred, lifted above the rail
  const panel = document.body.classList.contains('inspecting') && !tour.on ? 0.04 : 0;
  return [-(0.2 + panel) * Math.min(1, a / 1.6), -0.01];
}
function applyProjection() {
  camera.updateProjectionMatrix();
  camera.projectionMatrix.elements[8] -= shiftX;
  camera.projectionMatrix.elements[9] -= shiftY;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
let inspectPose = null;
function desiredCamera() {
  want.target.copy(HOME.target); want.yaw = HOME.yaw; want.pitch = HOME.pitch; want.dist = HOME.dist;
  if (tour.on && tour.cam) Object.assign(want, { yaw: tour.cam.yaw, pitch: tour.cam.pitch, dist: tour.cam.dist }), want.target.copy(tour.cam.target || HOME.target);
  if (S.section && sectionPose) { want.yaw = sectionPose.yaw; want.pitch = sectionPose.pitch; want.dist = sectionPose.dist; }
  if (S.inspect && inspectPose) { want.target.copy(inspectPose.target); want.yaw = inspectPose.yaw; want.pitch = inspectPose.pitch; want.dist = inspectPose.dist; }
  if (dive) dive.cameraPose(want, camera.fov, frameDt, S.dragging);
  const a = innerWidth / innerHeight;
  if (a < 0.9) want.dist *= 1.0 + (0.9 - a) * 1.25;
  if (S.intro < 1) {
    const k = easeIO(clamp((S.intro - 0.05) / 0.95, 0, 1));
    want.target.lerpVectors(INTRO.target, want.target, k);
    want.yaw = THREE.MathUtils.lerp(INTRO.yaw, want.yaw, k); want.pitch = THREE.MathUtils.lerp(INTRO.pitch, want.pitch, k); want.dist = THREE.MathUtils.lerp(INTRO.dist, want.dist, k);
  }
  want.yaw += S.yawOff; want.pitch = clamp(want.pitch + S.pitchOff, -0.3, 1.25);
  want.dist *= S.zoom;
  return want;
}
let frameDt = 0.016;
function updateCamera(dt) {
  frameDt = dt;
  const w = desiredCamera();
  const k = S.intro < 1 ? 1 : 1 - Math.exp(-dt * (S.dragging ? 16 : 3.2));
  cam.target.lerp(w.target, k);
  cam.yaw += (w.yaw - cam.yaw) * k; cam.pitch += (w.pitch - cam.pitch) * k;
  cam.dist += (w.dist - cam.dist) * (S.intro < 1 ? 1 : 1 - Math.exp(-dt * 2.8));
  camera.position.copy(cam.target).addScaledVector(sph(cam.yaw, cam.pitch), cam.dist);
  camera.up.set(0, 1, 0); camera.lookAt(cam.target);
  camera.near = Math.max(0.01, cam.dist * 0.08); camera.far = cam.dist + 1.2;
  const [sx, sy] = layoutShift();
  shiftX = damp(shiftX, sx, 3, dt); shiftY = damp(shiftY, sy, 3, dt);
  applyProjection();
  camera.updateMatrixWorld();
}
function resetView() { S.yawOff = 0; S.pitchOff = 0; S.zoom = 1; S.yawVel = S.pitchVel = 0; }

// ============================================================ layers / visibility logic
const layerDis = U.uLayerDis.value;
const toggleDis = new Float32Array(8);
function depthDissolve(g, d) { const at = GROUP_DISSOLVE_AT[g]; return at == null ? 0 : clamp(d - at, 0, 1); }
function railIndexOfGroup(g) { for (let i = 0; i < RAIL.length; i++) if (RAIL_GROUPS[RAIL[i]].includes(g)) return i; return -1; }
function topGroup() {
  const d = S.depthTarget;
  return [G.skin, G.muscle, G.vessel, G.nerve, G.bone, G.brain][clamp(Math.round(d), 0, 5)];
}
function contextGroups() {
  const s = new Set([topGroup(), G.eye]);
  if (S.depthTarget < 4.5) s.add(G.bone);
  return s;
}

// per-structure targets (ghost, highlight, own dissolve, forced visible)
let tGhost, tHl, tOwn, tForce, cur;
function initState() {
  const n = M.nodes.length;
  tGhost = new Float32Array(n); tHl = new Float32Array(n); tOwn = new Float32Array(n); tForce = new Float32Array(n);
  cur = M.stateArr;
  computeTargets();
  for (let i = 0; i < n; i++) { cur[i * 4] = tGhost[i]; cur[i * 4 + 1] = 0; cur[i * 4 + 2] = tOwn[i]; cur[i * 4 + 3] = tForce[i]; }
  M.stateTex.needsUpdate = true;
}
function computeTargets() {
  const insp = S.inspect ? structs.get(S.inspect) : null;
  const ctx = insp ? contextGroups() : null;
  const hov = S.hoverStruct;
  for (const rec of M.nodes) {
    const i = rec.sid;
    let own = rec.hidden ? 1 : 0;
    if (rec.cls === 'hair') own = S.hair ? 0 : 1;
    const ri = railIndexOfGroup(rec.group);
    if (ri >= 0 && S.off.has(RAIL[ri])) own = 1;
    let ghost = 0, force = 0;
    const st = sidToStruct[i];
    // nerve layer: the skull, cartilage and viscera turn to glass so the nerves inside canals and the
    // cranial-nerve roots on the brainstem can be followed
    if (!insp && S.depthTarget === 3 && (rec.group === G.bone || rec.group === G.organ) && own < 1) ghost = 1;
    // below the muscle layer the eyeballs become glass (a bare globe in an empty orbit reads as a toy)
    if (!insp && S.depthTarget >= 2 && rec.group === G.eye && rec.cls !== 'ear' && own < 1) ghost = 1;
    // lymph nodes only on the vessel layer (elsewhere they read as stray dots) or when examined
    if (rec.cls === 'lymph' && S.depthTarget !== 2) own = 1;
    if (insp) {
      if (st === insp) { own = 0; force = 1; }
      else if (ctx.has(rec.group) && own < 1) ghost = 1;
      else own = 1;
    }
    const dv = dive ? dive.targetFor(rec, st) : null;
    if (dv) { own = rec.hidden && !dv.force ? 1 : dv.own; force = dv.force; ghost = dv.ghost; }
    tGhost[i] = ghost; tOwn[i] = own; tForce[i] = force;
    let hl = dv ? dv.hl : 0;
    if (hov && st === hov && !(insp && st === insp)) hl = 1;
    if (S.tourHl && S.tourHl.has(st?.id)) hl = Math.max(hl, 0.55);
    tHl[i] = hl;
  }
  for (const r of renderables) r.allHidden = r.sids.every(s => tOwn[s] >= 1 && cur[s * 4 + 2] >= 0.999 && tForce[s] === 0);
}
let targetsDirty = true;
function stepState(dt) {
  if (targetsDirty) { computeTargets(); targetsDirty = false; }
  let changed = false;
  const kG = 1 - Math.exp(-dt * 3.6), kH = 1 - Math.exp(-dt * 12), kF = 1 - Math.exp(-dt * 5);
  const own = dt / 0.85;
  let anyGhost = false;
  for (let i = 0, n = M.nodes.length; i < n; i++) {
    const o = i * 4;
    const g = cur[o], h = cur[o + 1], d = cur[o + 2], f = cur[o + 3];
    let ng = g + (tGhost[i] - g) * kG; if (Math.abs(ng - tGhost[i]) < 0.002) ng = tGhost[i];
    let nh = h + (tHl[i] - h) * kH; if (Math.abs(nh - tHl[i]) < 0.002) nh = tHl[i];
    let nd = d < tOwn[i] ? Math.min(tOwn[i], d + own) : Math.max(tOwn[i], d - own * 1.4);
    let nf = f + (tForce[i] - f) * kF; if (Math.abs(nf - tForce[i]) < 0.002) nf = tForce[i];
    if (ng !== g || nh !== h || nd !== d || nf !== f) { cur[o] = ng; cur[o + 1] = nh; cur[o + 2] = nd; cur[o + 3] = nf; changed = true; }
    if (ng > 0.002) anyGhost = true;
  }
  if (changed) { M.stateTex.needsUpdate = true; for (const r of renderables) r.allHidden = r.sids.every(s => tOwn[s] >= 1 && cur[s * 4 + 2] >= 0.999 && tForce[s] === 0 && cur[s * 4 + 3] < 0.001); }
  // layer dissolves
  for (let g = 0; g < 8; g++) {
    const ri = railIndexOfGroup(g);
    const off = ri >= 0 && S.off.has(RAIL[ri]) ? 1 : 0;
    toggleDis[g] = toggleDis[g] < off ? Math.min(off, toggleDis[g] + dt / 0.9) : Math.max(off, toggleDis[g] - dt / 0.9);
    layerDis[g] = Math.max(depthDissolve(g, S.depth), toggleDis[g]);
  }
  // visibility / culling
  const secOn = !!S.section || section.state.on > 0.01;
  const insp = S.inspect ? structs.get(S.inspect) : null;
  const ctx = insp ? contextGroups() : null;
  for (const r of renderables) {
    const forced = (insp || (dive && dive.active)) && r.sids.some(s => cur[s * 4 + 3] > 0.001);
    let vis;
    if (forced) vis = true;
    else if (layerDis[r.group] >= 0.999 || r.allHidden) vis = false;
    else vis = secOn || S.depth >= r.reveal || (insp && ctx.has(r.group)) || r.sids.some(s => cur[s * 4] > 0.002);
    r.mesh.visible = vis;
    r.ghost.visible = vis && anyGhost;
  }
  return anyGhost;
}

// ============================================================ picking (GPU, 1×1 px)
const pickRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
const pickBuf = new Uint8Array(4);
const _pickP = new THREE.Matrix4(), _pickM = new THREE.Matrix4(), _projSave = new THREE.Matrix4(), _projInvSave = new THREE.Matrix4();
function gpuPick(px, py) {
  if (!M) return -1;
  const { W, H } = stage.size;
  if (px < 0 || py < 0 || px >= W || py >= H) return -1;
  // pick matrix: magnify the 1-px window around (px,py) of the CURRENT (shifted) projection to the whole target
  const cx = (Math.floor(px) + 0.5) / W * 2 - 1, cy = 1 - (Math.floor(py) + 0.5) / H * 2;
  _pickM.set(W, 0, 0, -cx * W, 0, H, 0, -cy * H, 0, 0, 1, 0, 0, 0, 0, 1);
  _projSave.copy(camera.projectionMatrix); _projInvSave.copy(camera.projectionMatrixInverse);
  camera.projectionMatrix.premultiply(_pickM); camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  const prevLayers = camera.layers.mask;
  camera.layers.set(1);
  scene.overrideMaterial = pickMat;
  const oldClear = renderer.getClearColor(new THREE.Color()), oldA = renderer.getClearAlpha();
  renderer.setRenderTarget(pickRT); renderer.setClearColor(0x000000, 0); renderer.clear(true, true, true);
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(pickRT, 0, 0, 1, 1, pickBuf);
  renderer.setRenderTarget(null); renderer.setClearColor(oldClear, oldA);
  scene.overrideMaterial = null;
  camera.layers.mask = prevLayers;
  camera.projectionMatrix.copy(_projSave); camera.projectionMatrixInverse.copy(_projInvSave);
  const id = pickBuf[0] + pickBuf[1] * 256 + pickBuf[2] * 65536 - 1;
  return id >= 0 && id < M.nodes.length && !sidToStruct[id]?.excluded ? id : -1;
}
// ---- onboarding hand: shown until the first real action (drag, tap, wheel, key); in kiosk again after each tour
let handSeen = false;
function hideHand() { handSeen = true; document.body.classList.remove('show-hand'); }
for (const ev of ['pointerdown', 'wheel', 'keydown']) window.addEventListener(ev, () => { if (document.body.classList.contains('show-hand') && !tour.on) setTimeout(hideHand, 250); }, { capture: true, passive: true });

// ---- skin regions: the auricle, nose, eyes, lips are all one Skin mesh; a ray against it (only when the GPU pick
// says «skin») gives the rest-space point, classified against landmarks found on the mesh at load.
const REGION_LA = { auricle: 'Auricula', nose: 'Nasus externus', eye: 'Regio orbitalis', mouth: 'Regio oralis', forehead: 'Regio frontalis', scalp: 'Regio parietalis', cheek: 'Regio buccalis', chin: 'Regio mentalis', neck: 'Regio cervicalis' };
const REGION_DIVE = { auricle: ['ear'], nose: ['nose-sinuses'], eye: ['eye'], mouth: ['tongue', 'teeth'], forehead: ['face-muscles'], cheek: ['face-muscles', 'teeth'], chin: ['face-muscles'], scalp: ['skull'], neck: ['larynx-voice'] };
const skinRay = new THREE.Raycaster();
function skinMesh() { const r = renderables.find(r => r.cls === 'skin'); return r ? r.mesh : null; }
function classifyRegion(p) {
  const m = skinMesh(); const L = m?.geometry.userData.landmarks; const e = U.uEye.value;
  if (!L) return null;
  const ax = Math.abs(p.x);
  if (p.y < 1.475 && p.z < L.li.z - 0.03) return 'neck';
  if (ax > 0.056 && p.y > e.y - 0.075 && p.y < e.y + 0.045 && p.z < 0.03 && p.z > -0.075) return 'auricle';
  if (Math.hypot(ax - e.x, p.y - e.y) < 0.021 && p.z > e.z - 0.012) return 'eye';
  if (ax < 0.024 && p.y > L.sn.y - 0.004 && p.y < e.y + 0.004 && p.z > e.z) return 'nose';
  if (ax < 0.031 && p.y < L.sn.y - 0.002 && p.y > L.li.y - 0.009 && p.z > L.st.z - 0.022) return 'mouth';
  if (ax < 0.04 && p.y <= L.li.y - 0.009 && p.y > 1.455 && p.z > L.li.z - 0.045) return 'chin';
  if (p.y > e.y + 0.012 && p.z > 0.035 && p.y < e.y + 0.085) return 'forehead';
  if (p.y > e.y + 0.012) return 'scalp';
  if (p.y < 1.475) return 'neck';
  return 'cheek';
}
function skinRegionAt(px, py) {
  const m = skinMesh(); if (!m) return null;
  skinRay.setFromCamera(new THREE.Vector2(px / innerWidth * 2 - 1, -(py / innerHeight) * 2 + 1), camera);
  const hit = skinRay.intersectObject(m, false)[0]; if (!hit) return null;
  const p = rig.worldToLocal(hit.point.clone());
  return { region: classifyRegion(p), point: p };
}
let pickDirty = false, lastPick = 0;
function hoverPick(now) {
  if (!pickDirty || now - lastPick < 55) return;
  pickDirty = false; lastPick = now;
  if (!S.pointerIn || S.dragging || S.intro < 1 || gripDrag) { setHover(-1); return; }
  const sid = gpuPick(S.pointerPx.x, S.pointerPx.y);
  const reg = sid >= 0 && sidToStruct[sid]?.id === 'skin' ? skinRegionAt(S.pointerPx.x, S.pointerPx.y) : null;
  if ((reg?.region || null) !== S.hoverRegion) { S.hoverRegion = reg?.region || null; if (sidToStruct[sid] === S.hoverStruct) updateTip(); }
  setHover(sid);
}
function setHover(sid) {
  const st = sid >= 0 ? sidToStruct[sid] : null;
  if (st === S.hoverStruct && sid === S.hoverSid) return;
  if (st && st !== S.hoverStruct) sound.tick();
  S.hoverSid = sid; S.hoverStruct = st; targetsDirty = true;
  canvas.classList.toggle('pointing', !!st && st.id !== S.inspect);
  updateTip();
}

// ============================================================ inspect
function sysKey(st) {
  const c = st.cls;
  if (c === 'skin' || c === 'hair' || c === 'hairFine') return 'skin';
  if (c === 'muscle') return 'muscles';
  if (c === 'tendon' || c === 'fascia') return 'tendon';
  if (c === 'artery') return 'artery';
  if (c === 'vein') return 'vein';
  if (c === 'lymph') return 'lymph';
  if (c === 'nerve') return 'nerves';
  if (c === 'tooth') return 'teeth';
  if (c === 'cartilage' || c === 'disc') return 'cartilage';
  if (c === 'ligament') return 'joints';
  if (c === 'bone' || c === 'air') return 'bones';
  if (/gland|thyroid|pituitary/.test(c)) return 'glands';
  if (/mucosa|tongue|gingiva/.test(c)) return 'organs';
  if (c === 'meninges') return 'meninges';
  if (c === 'csf' || c === 'plexus') return 'csf';
  if (st.group === G.eye && c !== 'ear') return 'eye';
  if (c === 'ear') return 'organs';
  return 'brain';
}
function inspect(id, sid = -1, { fromTour = false, region = null, point = null } = {}) {
  const st = structs.get(id);
  if (!st) return false;
  if (dive && dive.active) dive.close();
  if (!fromTour) stopTour();
  if (sid < 0 && st.sids.length > 1) {
    // bilateral structure opened from search / API: frame the side that faces the camera
    let best = Infinity;
    for (const s of st.sids) { const d = M.nodes[s].center.clone().applyMatrix4(rig.matrixWorld).distanceTo(camera.position); if (d < best) { best = d; sid = s; } }
    if (st.sids.every(s => M.nodes[s].side === 'M')) sid = -1;
  }
  S.inspect = id; S.inspectSid = sid >= 0 ? sid : st.sids[0]; S.inspectRegion = id === 'skin' ? region : null;
  targetsDirty = true;
  // camera: frame the clicked node (or the whole structure when midline / searched)
  const rec = M.nodes[S.inspectSid];
  const box = point ? new THREE.Box3().setFromCenterAndSize(point, new THREE.Vector3(0.07, 0.07, 0.07)) : sid >= 0 ? rec.box : st.box;
  const c = box.getCenter(new THREE.Vector3());
  const radius = Math.max(0.012, box.getSize(new THREE.Vector3()).length() / 2);
  const wc = c.clone().applyMatrix4(rig.matrixWorld);
  const out = c.clone().sub(CENTER); out.y *= 0.6;
  let yaw = cam.yaw, pitch = clamp(cam.pitch, -0.2, 0.5);
  if (out.length() > 0.045 && !S.section) {
    out.normalize();
    const dirYaw = Math.atan2(out.x, out.z);
    // blend toward the outward direction, but never all the way round to the back of the head
    let dy = dirYaw - cam.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    yaw = cam.yaw + dy * 0.8;
    pitch = clamp(Math.asin(clamp(out.y, -1, 1)) * 0.8 + 0.08, -0.35, 0.6);
  }
  const fov = THREE.MathUtils.degToRad(camera.fov);
  if (st.group === G.eye) pitch = clamp(pitch, -0.05, 0.12);
  // frame the part with enough head around it that the skull is never cropped
  const dist = clamp(radius / Math.tan(fov / 2) * 2.4, st.group === G.eye ? 0.5 : 0.72, 1.05);
  inspectPose = { target: wc, yaw, pitch, dist };
  S.yawOff = 0; S.pitchOff = 0; S.zoom = 1;
  document.body.classList.add('inspecting');
  fillPanel(id);
  sound.chime(hashIdx(id));
  setHover(-1);
  return true;
}
function exitInspect() {
  if (!S.inspect) return;
  S.inspect = null; S.inspectSid = -1; inspectPose = null; targetsDirty = true;
  document.body.classList.remove('inspecting');
  S.yawOff = cam.yaw - (S.section && sectionPose ? sectionPose.yaw : HOME.yaw); S.yawOff = Math.atan2(Math.sin(S.yawOff), Math.cos(S.yawOff));
  S.zoom = 1;
}
const hashIdx = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 8; };
function stepInspect(dir) {
  const cur = structs.get(S.inspect); if (!cur) return;
  const list = [...structs.values()].filter(s => s.group === cur.group && !s.hidden && !s.excluded).sort((a, b) => nameOf(a.id).localeCompare(nameOf(b.id), S.lang));
  const i = list.indexOf(cur);
  const n = list[(i + dir + list.length) % list.length];
  if (n) inspect(n.id);
}

// ============================================================ section
let sectionPose = null;
function setSection(axis) {
  if (axis === S.section) axis = null;
  S.section = axis;
  if (!axis) { section.setAxis(null); sectionPose = null; }
  else {
    const sgn = axis === 'sagittal' ? (Math.sin(cam.yaw) >= 0 ? 1 : -1) : 1;
    section.setAxis(axis, sgn);
    const yaw = axis === 'sagittal' ? sgn * 1.25 : axis === 'coronal' ? -0.42 : -0.35;
    const pitch = axis === 'axial' ? 0.92 : 0.1;
    sectionPose = { yaw, pitch, dist: axis === 'axial' ? 1.05 : 1.12 };
    S.yawOff = 0; S.pitchOff = 0; S.zoom = 1;
    sound.swell();
  }
  document.body.classList.toggle('sectioning', !!axis);
  document.querySelectorAll('#sections button').forEach(b => b.classList.toggle('on', b.dataset.sec === axis));
  updateCutBtn();
  targetsDirty = true;
}
// grip: drag the plane along its normal directly on screen
const gripEl = $('#grip');
let gripDrag = null;
function gripScreen() {
  const gi = section.gripInfo(); if (!gi.axis) return null;
  const a = gi.p.clone().project(camera), b = gi.p.clone().addScaledVector(gi.n, 0.01).project(camera);
  const toPx = (v) => [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight];
  const pa = toPx(a), pb = toPx(b);
  return { x: pa[0], y: pa[1], vx: pb[0] - pa[0], vy: pb[1] - pa[1] };
}
function updateGrip() {
  const g = gripScreen(); if (!g) return;
  // keep the grip inside the viewport, offset a little from the head centre along the plane
  const x = clamp(g.x, 60, innerWidth - 60), y = clamp(g.y, 80, innerHeight - 80);   // on the cut itself
  gripEl.style.transform = `translate(${x}px, ${y}px) rotate(${Math.atan2(g.vy, g.vx)}rad)`;
}
gripEl.addEventListener('pointerdown', (e) => {
  e.preventDefault(); e.stopPropagation(); stopTour(); sound.start();
  gripEl.setPointerCapture(e.pointerId); gripEl.classList.add('drag');
  gripDrag = { x: e.clientX, y: e.clientY, o: section.state.offset };
});
gripEl.addEventListener('pointermove', (e) => {
  if (!gripDrag) return;
  const g = gripScreen(); if (!g) return;
  const dx = e.clientX - gripDrag.x, dy = e.clientY - gripDrag.y;
  const l2 = g.vx * g.vx + g.vy * g.vy || 1;
  const along = (dx * g.vx + dy * g.vy) / l2 * 0.01 * section.state.sign;
  section.setOffset(gripDrag.o + along);
});
const endGrip = () => { gripDrag = null; gripEl.classList.remove('drag'); };
gripEl.addEventListener('pointerup', endGrip); gripEl.addEventListener('pointercancel', endGrip);

// ============================================================ depth
function setDepth(d, { user = true } = {}) {
  const nd = clamp(Math.round(d), 0, 5);
  if (nd !== S.depthTarget) { S.depthTarget = nd; if (user) sound.swell(); targetsDirty = true; }
  if (user && S.intro < 1) S.intro = 1;
  if (user) { S.touchedDepth = true; document.body.classList.remove('show-rail-hint'); }
  if (S.inspect && user) exitInspect();
  updateRail();
}
function toggleSystem(name) {
  if (S.off.has(name)) S.off.delete(name); else S.off.add(name);
  targetsDirty = true; updateRail(); sound.tick();
}

// ============================================================ ♂/♀
function setSex(f) {
  S.sexTarget = f ? 1 : 0;
  document.querySelectorAll('#sex button').forEach(b => b.classList.toggle('on', (b.dataset.sex === 'f') === !!f));
  $('#sex .knob').style.transform = f ? 'translateX(100%)' : 'none';
  applyLang();
  sound.morph(0.9); setTimeout(() => sound.morph(0), 1200);
}

// ============================================================ UI: rail, panel, tip, search, about, captions
const railOl = $('#rail ol');
const railMark = document.createElement('i'); railMark.className = 'mark';
function buildRail() {
  railOl.replaceChildren(railMark);
  RAIL.forEach((name, i) => {
    const li = document.createElement('li'); li.dataset.layer = name; li.dataset.i = i;
    const dot = document.createElement('span'); dot.className = 'dot';
    const th = document.createElement('span'); th.className = 'thumb'; th.style.backgroundImage = `url(assets/ui/layer-${name}.jpg)`;
    const nm = document.createElement('span'); nm.className = 'nm';
    li.style.setProperty('--lc', `var(--lay-${name})`);
    li.append(dot, th, nm); railOl.append(li);
    let press = null;
    li.addEventListener('pointerdown', (e) => { press = setTimeout(() => { press = 'long'; toggleSystem(name); }, 520); });
    const cancel = () => { if (press && press !== 'long') clearTimeout(press); };
    li.addEventListener('pointerleave', () => { cancel(); press = null; });
    li.addEventListener('pointerup', () => { if (press === 'long') { press = null; return; } cancel(); press = null; stopTour(); sound.start(); setDepth(i); });
    li.addEventListener('contextmenu', (e) => { e.preventDefault(); if (press && press !== 'long') clearTimeout(press); press = 'long'; toggleSystem(name); });
  });
  $('#rail').addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); railWheel(e.deltaY); }, { passive: false });
}
let railAcc = 0, railLast = 0;
function railWheel(dy) {
  stopTour();
  const now = performance.now();
  if (now - railLast > 350) railAcc = 0;
  railLast = now; railAcc += dy;
  if (Math.abs(railAcc) > 60) { setDepth(S.depthTarget + Math.sign(railAcc)); railAcc = 0; railLast = now + 250; }
}
function updateRail() {
  const T = UI[S.lang];
  railOl.querySelectorAll('li').forEach((li) => {
    const i = +li.dataset.i, name = li.dataset.layer;
    li.querySelector('.nm').textContent = T.layers[name];
    li.classList.toggle('cur', i === S.depthTarget);
    li.classList.toggle('above', i < S.depthTarget);
    li.classList.toggle('off', S.off.has(name));
    li.title = T.toggleSystemHint;
  });
}
function updateRailMark() {
  const lis = railOl.querySelectorAll('li'); if (!lis.length) return;
  const vertical = innerWidth > 760;
  const i0 = Math.floor(S.depth), i1 = Math.min(5, i0 + 1), f = S.depth - i0;
  const a = lis[i0], b = lis[i1];
  if (vertical) { const y = a.offsetTop + a.offsetHeight / 2 + ((b.offsetTop - a.offsetTop) * f); railMark.style.top = y + 'px'; railMark.style.left = '1px'; }
  else { const x = a.offsetLeft + 22 + (b.offsetLeft - a.offsetLeft) * f; railMark.style.left = x + 'px'; railMark.style.top = '5px'; }
}

function nameOf(id, lang = S.lang) { return content ? content.name(id, lang) : id; }
function systemLabel(st) { return UI[S.lang].systems[sysKey(st)] || ''; }
const panel = $('#panel');
function fillPanel(id) {
  const st = structs.get(id); if (!st) return;
  const T = UI[S.lang];
  panel.querySelector('.sys').textContent = systemLabel(st);
  const reg = id === 'skin' && S.inspectRegion ? S.inspectRegion : null;
  const nameFor = (l) => reg ? (UI[l].regions?.[reg] || nameOf(id, l)) : nameOf(id, l);
  panel.querySelector('.name').textContent = nameFor(S.lang);
  panel.querySelector('.name').lang = S.lang;
  panel.querySelector('.la').textContent = reg ? REGION_LA[reg] : content.latin(id);
  panel.querySelector('.role').textContent = content.role(id, S.lang);
  panel.querySelector('.role').lang = S.lang;
  panel.querySelector('.alt').textContent = LANGS.filter(l => l !== S.lang).map(l => nameFor(l)).filter((v, i, a) => a.indexOf(v) === i && v !== nameFor(S.lang)).join('  ·  ');
  const ul = panel.querySelector('.facts'); ul.replaceChildren();
  const facts = content.facts(id).slice(0, 3);
  const f0 = facts[0]; const wowT = f0 ? ((typeof f0[S.lang] === 'string' && f0[S.lang]) || f0.en || '') : '';
  panel.querySelector('.wow .wt').textContent = wowT ? localNum(wowT) : '';
  panel.querySelector('.wow').classList.toggle('none', !wowT);
  panel.classList.remove('open');
  panel.querySelector('.pmore').textContent = (T.kid && T.kid.more) || 'More';
  for (const [fi, f] of facts.entries()) {
    const txt = (typeof f[S.lang] === 'string' && f[S.lang]) || f.en || '';
    if (!txt) continue;
    const li = document.createElement('li'); li.textContent = fi === 0 ? '' : localNum(txt);
    const src = content.source(f.src);
    if (src) {
      const s = document.createElement('span'); s.className = 'src';
      s.append(T.panel.source + ': ');
      if (src.url) { const a = document.createElement('a'); a.href = src.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = src.title || src.url; s.append(a); }
      else s.append(src.title);
      li.append(s);
    }
    ul.append(li);
  }

  // deep-dive links: the region's organ(s) for skin, otherwise the index trigger
  const links = $('#dive-links'); links.replaceChildren();
  if (dive && !dive.active) {
    const ids = reg ? (REGION_DIVE[reg] || []) : (dive.entryFor(id) ? [dive.entryFor(id).id] : []);
    ids.filter(did => dive.D.index.some(e => e.id === did)).forEach((did, k) => {
      const entry = dive.D.index.find(e => e.id === did);
      const b = document.createElement('button');
      if (k === 0) { b.className = 'pill'; b.textContent = (T.kid && T.kid.look) || 'Look inside'; b.id = 'btn-dive'; }
      else { b.className = 'also mono'; b.textContent = `${T.organs?.also || 'Also'}: ${entry.title?.[S.lang] || entry.title?.en || did}`; }
      b.dataset.dive = did;
      b.addEventListener('click', () => openDive(did));
      links.append(b);
    });
  }
}
function localNum(str) {
  if (S.lang === 'en' || !str) return str;
  return String(str).replace(/(\d),(\d{3})(?!\d)/g, '$1 $2').replace(/(\d)\.(\d)/g, '$1,$2');
}
const tip = $('#tip');
function updateTip() {
  const st = S.hoverStruct;
  if (!st || S.dragging || (S.inspect && st.id === S.inspect && !(st.id === 'skin' && S.hoverRegion && S.hoverRegion !== S.inspectRegion))) { tip.classList.remove('show'); return; }
  const hr = st.id === 'skin' && S.hoverRegion ? S.hoverRegion : null;
  tip.querySelector('b').textContent = hr ? (UI[S.lang].regions?.[hr] || nameOf(st.id)) : nameOf(st.id);
  tip.querySelector('i').textContent = hr ? REGION_LA[hr] : content.latin(st.id);
  tip.classList.add('show');
  positionTip();
}
function positionTip() {
  const w = tip.offsetWidth || 160;
  let x = S.pointerPx.x + 18, y = S.pointerPx.y + 16;
  if (x + w > innerWidth - 12) x = S.pointerPx.x - w - 14;
  tip.style.transform = `translate(${x}px, ${y}px)`;
}

// captions (intro lines, tour titles)
const capEl = $('#caption'); let capTimer = null;
function caption(t, s = '', n = '', ms = 3200) {
  clearTimeout(capTimer);
  capEl.querySelector('.t').textContent = t; capEl.querySelector('.s').textContent = s; capEl.querySelector('.n').textContent = n;
  capEl.classList.add('show');
  if (ms > 0) capTimer = setTimeout(() => capEl.classList.remove('show'), ms);
}
function hideCaption() { clearTimeout(capTimer); capEl.classList.remove('show'); }

// search
const searchEl = $('#search'), qEl = $('#q'), resEl = $('#results');
let searchIndex = [], searchSel = 0;
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').normalize('NFC');
function buildSearch() {
  searchIndex = [];
  for (const st of structs.values()) {
    if (st.excluded) continue;
    const hay = [...LANGS.map(l => nameOf(st.id, l)), content.latin(st.id), content.raw[st.id] || ''].map(norm).join(' | ');
    searchIndex.push({ st, hay });
  }
}
function openSearch() { stopTour(); searchEl.hidden = false; qEl.value = ''; qEl.placeholder = UI[S.lang].search.placeholder; runSearch(); setTimeout(() => qEl.focus(), 0); }
function closeSearch() { searchEl.hidden = true; qEl.blur(); }
function runSearch() {
  const q = norm(qEl.value).trim();
  resEl.replaceChildren(); searchSel = 0;
  if (!q) return;
  const toks = q.split(/\s+/);
  const hits = [];
  for (const it of searchIndex) {
    if (!toks.every(t => it.hay.includes(t))) continue;
    const nm = norm(nameOf(it.st.id));
    const score = (nm.startsWith(q) ? 0 : nm.includes(q) ? 1 : 2) + nm.length / 200;
    hits.push({ it, score });
  }
  hits.sort((a, b) => a.score - b.score);
  for (const { it } of hits.slice(0, 40)) {
    const li = document.createElement('li');
    const left = document.createElement('div');
    const b = document.createElement('b'); b.textContent = nameOf(it.st.id);
    const i = document.createElement('i'); i.textContent = content.latin(it.st.id) ? '  ' + content.latin(it.st.id) : '';
    left.append(b, i);
    const s = document.createElement('span'); s.textContent = systemLabel(it.st);
    li.append(left, s); li.dataset.id = it.st.id;
    li.addEventListener('click', () => { closeSearch(); inspect(it.st.id); });
    resEl.append(li);
  }
  if (!hits.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = UI[S.lang].search.empty; resEl.append(li); }
  markSel();
}
function markSel() { [...resEl.children].forEach((li, i) => li.classList.toggle('sel', i === searchSel)); resEl.children[searchSel]?.scrollIntoView?.({ block: 'nearest' }); }
qEl.addEventListener('input', runSearch);
qEl.addEventListener('keydown', (e) => {
  const n = resEl.querySelectorAll('li[data-id]').length;
  if (e.key === 'ArrowDown') { e.preventDefault(); searchSel = Math.min(n - 1, searchSel + 1); markSel(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); searchSel = Math.max(0, searchSel - 1); markSel(); }
  else if (e.key === 'Enter') { const li = resEl.children[searchSel]; if (li?.dataset.id) { closeSearch(); inspect(li.dataset.id); } }
  else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  e.stopPropagation();
});
searchEl.addEventListener('pointerdown', (e) => { if (e.target === searchEl) closeSearch(); });

// about
function fillAbout() {
  const T = UI[S.lang];
  const A = Object.assign({}, T.about, content?.about?.[S.lang] || {});
  const box = $('#aboutbox');
  box.querySelector('h2').textContent = A.title || '';
  const body = box.querySelector('.about-body'); body.replaceChildren();
  for (const para of A.body || []) { const p = document.createElement('p'); p.textContent = para; body.append(p); }
  box.querySelector('.simpl-t').textContent = A.simplTitle || '';
  const sl = box.querySelector('.simpl'); sl.replaceChildren();
  for (const s of A.simpl || []) { const li = document.createElement('li'); li.textContent = s; sl.append(li); }
  box.querySelector('.lic-t').textContent = A.licTitle || '';
  const ll = box.querySelector('.lic'); ll.replaceChildren();
  for (const s of A.lic || []) { const li = document.createElement('li'); li.textContent = s; ll.append(li); }
  const srcs = content ? Object.entries(content.sources) : [];
  box.querySelector('.src-t').textContent = srcs.length ? T.panel.sources : '';
  const ol = box.querySelector('.sources'); ol.replaceChildren();
  for (const [, s] of srcs) {
    const src = content.source(s); if (!src) continue;
    const li = document.createElement('li');
    if (src.url) { const a = document.createElement('a'); a.href = src.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = src.title || src.url; li.append(a); } else li.textContent = src.title;
    ol.append(li);
  }
  box.querySelector('.credit').textContent = A.credit || '';
}

function tget(obj, path) { return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj); }
function applyLang() {
  const T = UI[S.lang];
  document.documentElement.lang = S.lang;
  document.title = T.title;
  document.querySelectorAll('[data-i18n]').forEach(el => { const v = tget(T, el.dataset.i18n); if (typeof v === 'string') el.textContent = v; });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { const v = tget(T, el.dataset.i18nAria); if (typeof v === 'string') el.setAttribute('aria-label', v); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { const v = tget(T, el.dataset.i18nTitle); if (typeof v === 'string') { el.title = v; el.setAttribute('aria-label', v); } });
  document.querySelectorAll('.lang').forEach(b => b.classList.toggle('on', b.dataset.lang === S.lang));
  $('#brand-sub').textContent = S.sexTarget > 0.5 ? (T.subF || T.sub) : (T.subM || T.sub);
  $('#hint').textContent = IS_TOUCH ? T.hintTouch : T.hint;
  qEl.placeholder = T.search.placeholder;
  updateRail(); updateTourBtn(); updateCutBtn(); fillAbout();
  if (S.inspect) fillPanel(S.inspect);
  if (dive) dive.applyLang();
  if (S.hoverStruct) updateTip();
  if (tour.on && tour.stop >= 0) showTourCaption(tour.stop);
}

// ============================================================ tour («Саяхат»)
const MIMIC = ['zygomaticus-major-muscle', 'zygomaticus-minor-muscle', 'orbicularis-oris-muscle', 'levator-labii-superioris', 'levator-anguli-oris', 'depressor-anguli-oris', 'depressor-labii-inferioris', 'risorius-muscle', 'mentalis-muscle', 'nasalis-muscle', 'procerus-muscle', 'frontalis-muscle', 'corrugator-supercilii', 'orbital-part-of-orbicularis-oculi', 'palpebral-part-of-orbicularis-oculi', 'buccinator', 'levator-nasolabialis', 'depressor-septi-nasi', 'occipitalis-muscle', 'temporoparietalis-muscle'];
// Attract tour: head layers → section → deep dives (brain, ear, larynx, tongue, eye) → back to the head.
// Loops forever until real user activity. Kiosk (?kiosk=1): starts itself, cycles ♂/♀ and kk → ru → en each loop,
// and resumes after 60 s of inactivity.
const KIOSK = Q.get('kiosk') === '1';
const TOUR_SPEED = Math.max(0.2, +(Q.get('tourspeed') || 1));
const IDLE_MS = +(Q.get('idle') || 60000);
const TOUR = [
  { d: 6.5, stop: 0, go() { closeDiveForTour(); exitInspect(); setSection(null); setDepth(0, { user: false }); S.tourHl = null; }, cam: { yaw: -0.32, pitch: 0.05, dist: 1.02 } },
  { d: 6.5, stop: 1, go() { setDepth(1, { user: false }); S.tourHl = new Set(MIMIC); }, cam: { yaw: -0.2, pitch: 0.06, dist: 0.92 } },
  { d: 6.5, stop: 2, go() { S.tourHl = null; inspect(findStruct(['superficial-part-of-masseter']), -1, { fromTour: true }); } },
  { d: 6.5, stop: 3, go() { exitInspect(); setDepth(2, { user: false }); }, cam: { yaw: -0.85, pitch: 0.1, dist: 1.05 } },
  { d: 6.5, stop: 4, go() { setDepth(3, { user: false }); S.tourHl = new Set(CRANIAL()); }, cam: { yaw: -1.05, pitch: -0.05, dist: 1.0 } },
  { d: 6.5, stop: 5, go() { S.tourHl = null; setDepth(4, { user: false }); }, cam: { yaw: -0.55, pitch: 0.12, dist: 1.12 } },
  { d: 5, stop: 6, go() { setDepth(5, { user: false }); }, cam: { yaw: -0.75, pitch: 0.35, dist: 1.0 } },
  { d: 5.5, stop: -1, go() { setSection('sagittal'); } },
  { d: 7, dive: ['brain', 0] }, { d: 6.5, dive: ['brain', 1], explode: 0.35 }, { d: 6.5, dive: ['brain', 3] },
  { d: 7, dive: ['ear', 1] }, { d: 7, dive: ['ear', 2], explode: 0.5 },
  { d: 7, dive: ['larynx-voice', 0] }, { d: 6.5, dive: ['larynx-voice', 1] },
  { d: 7, dive: ['tongue', 0] }, { d: 6.5, dive: ['tongue', 1] },
  { d: 20, eye: true },
  { d: 7, stop: 0, sex: true, go() { closeDiveForTour(); setSection(null); setDepth(0, { user: false }); setSex(S.sexTarget < 0.5); }, cam: { yaw: -0.3, pitch: 0.04, dist: 0.98 } },
];
const CRANIAL = () => [...structs.keys()].filter(id => /-(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)$/.test(id) && /nerve/.test(id));
function findStruct(cands) { for (const c of cands) if (structs.has(c)) return c; const k = [...structs.keys()].find(id => cands.some(c => id.includes(c))); return k || null; }
const tour = { on: false, t: 0, i: 0, next: 0, stop: -1, cam: null, loops: 0, step: -1 };
function closeDiveForTour() { if (dive && dive.active) dive.close(); }
function startTour({ auto = false } = {}) {
  if (!KIOSK) { sound.start(); syncSoundBtn(); }
  tour.on = true; tour.t = 0; tour.i = 0; tour.next = 0; tour.stop = -1; tour.cam = null; tour.step = -1;
  S.intro = 1; resetView(); closeSearch(); $('#aboutbox').hidden = true; $('#organs').hidden = true;
  if (auto) { closeDiveForTour(); exitInspect(); }
  document.body.classList.add('touring'); updateTourBtn();
}
function stopTour() {
  if (!tour.on) return;
  tour.on = false; tour.cam = null; S.tourHl = null; targetsDirty = true;
  document.body.classList.remove('touring'); hideCaption(); updateTourBtn();
  S.lastActivity = performance.now();
  if (KIOSK) document.body.classList.add('show-hand');
}
function showTourCaption(k) {
  const st = UI[S.lang].tourStops[k]; if (!st) return;
  caption(st.t, st.s, '', 0);
}
function runStep(s) {
  if (s.dive) {
    const [id, ch] = s.dive;
    const go = () => { if (!tour.on) return; if (s.explode != null) dive.setExplode(s.explode); const D = dive.D; const c = D.data?.chapters?.[D.chapter]; caption(D.data ? (D.data.title?.[S.lang] || D.data.title?.en || '') : '', c ? (c.title?.[S.lang] || c.title?.en || '') : '', '', 0); };
    if (!dive || !dive.D.index.some(e => e.id === id)) return false;
    if (dive.active === id) { dive.setChapter(ch); go(); } else { exitInspect(); dive.open(id, ch).then(go); }
    return true;
  }
  if (s.eye) {
    if (!dive || !dive.D.index.some(e => e.iframe)) return false;
    closeDiveForTour(); dive.open(dive.D.index.find(e => e.iframe).id, 0, { tour: true });
    showTourCaption(7);
    return true;
  }
  s.go(); targetsDirty = true;
  tour.cam = s.cam || null;
  if (s.stop >= 0) { tour.stop = s.stop; showTourCaption(s.stop); sound.swell(); }
  if (s.sex) caption(UI[S.lang].brand, S.sexTarget > 0.5 ? (UI[S.lang].subF || '') : (UI[S.lang].subM || ''), '', 0);
  return true;
}
function tickTour(dt) {
  if (!tour.on) return;
  tour.t += dt * TOUR_SPEED;
  if (tour.t >= tour.next) {
    tour.step++;
    if (tour.step >= TOUR.length) {       // loop: back to the top; kiosk cycles the language
      tour.step = 0; tour.loops++;
      if (KIOSK) { const l = LANGS[(LANGS.indexOf(S.lang) + 1) % LANGS.length]; S.lang = l; applyLang(); buildSearch(); }
    }
    const s = TOUR[tour.step];
    const ran = runStep(s);
    tour.next = tour.t + (ran ? s.d : 0);
    if (!s.dive && !s.eye) {} else tour.cam = null;
  }
  if (!(dive && dive.active)) { S.yawOff = Math.sin(tour.t * 0.21) * 0.1; S.pitchOff = Math.sin(tour.t * 0.16) * 0.03; }
}
function updateTourBtn() { const b = $('#btn-tour'); const K = UI[S.lang].kid || {}; b.querySelector('.bl').textContent = tour.on ? (K.stop || 'Stop') : (K.tour || 'Tour'); b.classList.toggle('on', tour.on); }

// ============================================================ input
let downAt = null;
const touches = new Map(); let pinch0 = null;
canvas.addEventListener('pointerdown', (e) => {
  stopTour(); sound.start(); syncSoundBtn();
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch') touches.set(e.pointerId, [e.clientX, e.clientY]);
  downAt = { x: e.clientX, y: e.clientY, t: performance.now(), hoverSid: S.hoverSid };
  S.dragging = true; S.dragDist = 0; canvas.classList.add('dragging'); tip.classList.remove('show');
  if (S.intro < 1) S.intro = Math.max(S.intro, 0.999);
});
canvas.addEventListener('pointermove', (e) => {
  S.pointerPx.set(e.clientX, e.clientY);
  S.pointer.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  S.pointerIn = true; pickDirty = true; S.lastMove = performance.now();
  if (touches.has(e.pointerId)) {
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size === 2) { const [a, b] = [...touches.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0) S.zoom = clamp(S.zoom * pinch0 / d, 0.3, 2.2); pinch0 = d; S.dragDist += 10; return; }
  }
  if (S.dragging && downAt) {
    const mx = e.movementX || 0, my = e.movementY || 0;
    S.dragDist += Math.abs(mx) + Math.abs(my);
    S.yawVel = -mx * 0.0055; S.pitchVel = my * 0.0045;
    S.yawOff += S.yawVel; S.pitchOff += S.pitchVel;
  } else if (S.hoverStruct) positionTip();
});
canvas.addEventListener('pointerleave', () => { S.pointerIn = false; setHover(-1); });
const endPointer = (e) => {
  touches.delete(e.pointerId); if (touches.size < 2) pinch0 = null;
  canvas.classList.remove('dragging');
  const wasDrag = S.dragging; S.dragging = false;
  if (wasDrag && downAt && S.dragDist < 6 && performance.now() - downAt.t < 650 && e.type === 'pointerup') {
    let sid = gpuPick(e.clientX, e.clientY);
    if (sid < 0 && downAt.hoverSid >= 0) sid = downAt.hoverSid;   // thin structures: trust what was highlighted under the finger
    const st = sid >= 0 ? sidToStruct[sid] : null;
    if (dive && dive.active) { dive.selectPart(st ? st.id : null); downAt = null; pickDirty = true; return; }
    const reg = st && st.id === 'skin' ? skinRegionAt(e.clientX, e.clientY) : null;
    if (st && (st.id !== S.inspect || (reg && reg.region !== S.inspectRegion))) inspect(st.id, sid, reg ? { region: reg.region, point: reg.point } : {});
    else if (!st && S.inspect) exitInspect();
  }
  downAt = null; pickDirty = true;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('dblclick', () => { exitInspect(); resetView(); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault(); stopTour();
  const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  if (dive && dive.active && !e.ctrlKey) { dive.setExplode(dive.explodeTarget + d * 0.0012); return; }
  if (S.section && e.shiftKey) { section.setOffset(section.state.offset - d * 0.00012 * section.state.sign); return; }
  S.zoom = clamp(S.zoom * Math.exp(d * 0.0011), 0.3, 2.2);
  if (S.intro < 1) S.intro = 1;
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (e.target === qEl) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (tour.on && k !== 't' && k !== 'T' && k !== 'е' && k !== 'Е') stopTour();
  sound.start(); syncSoundBtn();
  if (e.target.closest && e.target.closest('button') && (k === ' ' || k === 'Enter')) return;
  if (dive && dive.active && k === 'Escape' && $('#aboutbox').hidden && searchEl.hidden) { if (dive.sel) dive.selectPart(null); else dive.close(); return; }
  if (dive && dive.active && !dive.frame && (k === 'ArrowRight' || k === 'ArrowLeft')) { const n = dive.D.chapter + (k === 'ArrowRight' ? 1 : -1); dive.setChapter(n); return; }
  if (dive && dive.active && (k === 'ArrowDown' || k === 'ArrowUp' || (k >= '1' && k <= '6') || k === 's' || k === 'S' || k === 't' || k === 'T')) return;
  if (k === 'Escape' && !organsEl.hidden) { organsEl.hidden = true; return; }
  if (k === 'Escape') {
    if (!$('#aboutbox').hidden) $('#aboutbox').hidden = true;
    else if (!searchEl.hidden) closeSearch();
    else if (S.inspect) exitInspect();
    else if (S.section) setSection(null);
    else resetView();
  } else if (k === 'ArrowDown' || k === 'PageDown') { e.preventDefault(); setDepth(S.depthTarget + 1); }
  else if (k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); setDepth(S.depthTarget - 1); }
  else if (k >= '1' && k <= '6') setDepth(+k - 1);
  else if (k === 'ArrowRight') { if (S.inspect) stepInspect(1); else S.yawOff -= 0.25; }
  else if (k === 'ArrowLeft') { if (S.inspect) stepInspect(-1); else S.yawOff += 0.25; }
  else if (k === '/' || k === '.') { e.preventDefault(); openSearch(); }
  else if (k === 's' || k === 'S' || k === 'ы' || k === 'Ы') { const order = [null, 'sagittal', 'axial', 'coronal']; const n = order[(order.indexOf(S.section) + 1) % 4]; setSection(n ?? S.section); if (!n) setSection(null); }
  else if (k === 't' || k === 'T' || k === 'е' || k === 'Е') { tour.on ? stopTour() : startTour(); }
  else if (k === 'g' || k === 'G' || k === 'п' || k === 'П') setSex(S.sexTarget < 0.5);
  else if (k === '[') section.setOffset(section.state.offset - 0.004 * section.state.sign);
  else if (k === ']') section.setOffset(section.state.offset + 0.004 * section.state.sign);
  else if (k === 'r' || k === 'R' || k === 'к' || k === 'К') resetView();
});
$('#btn-tour').addEventListener('click', () => { tour.on ? stopTour() : startTour(); });
function updateCutBtn() { const b = $('#btn-cut'); if (!b) return; const K = UI[S.lang].kid || {}; b.classList.toggle('on', !!S.section); b.querySelector('.bl').textContent = S.section ? (K.uncut || 'Close') : (K.cut || 'Cut'); }
$('#btn-cut').addEventListener('click', () => { stopTour(); sound.start(); if (S.inspect) exitInspect(); if (S.section) setSection(null); else setSection('sagittal'); hideHand(); });
document.querySelectorAll('#sections button').forEach(b => b.addEventListener('click', () => { stopTour(); sound.start(); if (S.inspect) exitInspect(); if (S.section !== b.dataset.sec) setSection(b.dataset.sec); }));   // direction chips only switch; the scissors button closes
document.querySelectorAll('#sex button').forEach(b => b.addEventListener('click', () => { stopTour(); sound.start(); setSex(b.dataset.sex === 'f'); }));
document.querySelectorAll('.lang').forEach(b => b.addEventListener('click', () => {
  // on phones only the current language is shown: tapping it cycles to the next one
  const next = (b.dataset.lang === S.lang && innerWidth <= 760) ? LANGS[(LANGS.indexOf(S.lang) + 1) % LANGS.length] : b.dataset.lang;
  S.lang = next; storeLang(S.lang); applyLang(); buildSearch();
}));
$('#btn-search').addEventListener('click', openSearch);
panel.querySelector('.pmore').addEventListener('click', () => panel.classList.toggle('open'));
$('#panel-close').addEventListener('click', () => { if (dive && dive.sel) dive.selectPart(null); else exitInspect(); });
$('#prev').addEventListener('click', () => { if (dive && dive.active) dive.stepPart(-1); else stepInspect(-1); });
$('#next').addEventListener('click', () => { if (dive && dive.active) dive.stepPart(1); else stepInspect(1); });
async function openDive(id, chapter = 0) { if (!dive) return false; stopTour(); closeSearch(); return dive.open(id, chapter); }
function syncSoundBtn() { const b = $('#sound'); if (sound.started) b.classList.remove('pulse'); b.classList.toggle('on', sound.started && sound.enabled); }
$('#sound').addEventListener('click', () => { const was = sound.started; sound.start(); sound.setEnabled(was ? !sound.enabled : true); syncSoundBtn(); });
$('#about').addEventListener('click', () => { stopTour(); fillAbout(); $('#aboutbox').hidden = false; });
$('#about-close').addEventListener('click', () => { $('#aboutbox').hidden = true; });
$('#aboutbox').addEventListener('click', (e) => { if (e.target.id === 'aboutbox') $('#aboutbox').hidden = true; });

// ============================================================ activity, kiosk, organs menu
S.lastActivity = performance.now(); let lastMove = { x: -1, y: -1, t: performance.now() }; let swallowClick = false;
function activity() { S.lastActivity = performance.now(); document.body.classList.remove('cursor-hidden'); }
function onUserInput(e, kind) {
  activity();
  if (!tour.on) return;
  if (kind === 'down' && e.target && e.target.closest && e.target.closest('#btn-tour')) return;   // the tour button toggles itself
  stopTour();
  if (KIOSK && kind === 'down') { e.preventDefault(); e.stopPropagation(); swallowClick = true; }   // first touch only wakes the UI
}
window.addEventListener('pointerdown', (e) => onUserInput(e, 'down'), true);
window.addEventListener('click', (e) => { if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); } }, true);
window.addEventListener('wheel', (e) => onUserInput(e, 'wheel'), { capture: true, passive: true });
window.addEventListener('keydown', (e) => { if (e.key === 't' || e.key === 'T' || e.key === 'е' || e.key === 'Е') { activity(); return; } onUserInput(e, 'key'); }, true);
window.addEventListener('touchstart', (e) => onUserInput(e, 'touch'), { capture: true, passive: true });
window.addEventListener('pointermove', (e) => {
  const d = lastMove.x < 0 ? 0 : Math.hypot(e.clientX - lastMove.x, e.clientY - lastMove.y);
  if (lastMove.x < 0 || d > 0) { lastMove = { x: e.clientX, y: e.clientY, t: performance.now() }; }
  if (d > 6) onUserInput(e, 'move'); else if (d > 0) document.body.classList.remove('cursor-hidden');
}, true);
if (KIOSK) {
  document.body.classList.add('kiosk');
  const vp = document.querySelector('meta[name=viewport]'); if (vp) vp.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  for (const ev of ['gesturestart', 'gesturechange', 'contextmenu', 'selectstart', 'dragstart']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length > 1 && e.target !== canvas) e.preventDefault(); }, { passive: false });
}
function returnToOverview() {
  exitInspect(); closeDiveForTour(); closeSearch(); $('#aboutbox').hidden = true; $('#organs').hidden = true;
  setSection(null); resetView();
}
function tickIdle(now) {
  if (!S.ready) return;
  if (KIOSK && now - lastMove.t > 3000 && now - S.lastActivity > 3000) document.body.classList.add('cursor-hidden');
  if (KIOSK && !tour.on && now - S.lastActivity > IDLE_MS) { returnToOverview(); startTour({ auto: true }); }
}
// organs menu
const organsEl = $('#organs'); const diveMeta = {};
async function openOrgans() {
  stopTour(); organsEl.hidden = false;
  const T = UI[S.lang]; const grid = organsEl.querySelector('.ogrid'); grid.replaceChildren();
  for (const e of dive.D.index) {
    const li = document.createElement('li'); li.tabIndex = 0; li.dataset.id = e.id;
    const im = document.createElement('div'); im.className = 'oimg'; im.style.backgroundImage = `url(assets/ui/organ-${e.id}.jpg)`;
    const b = document.createElement('b'); b.textContent = e.title?.[S.lang] || e.title?.en || e.id;
    const sp = document.createElement('span'); li.append(im, b, sp); grid.append(li);
    const open = () => { organsEl.hidden = true; openDive(e.id); };
    li.addEventListener('click', open); li.addEventListener('keydown', (k) => { if (k.key === 'Enter') open(); });
    if (e.iframe) { sp.textContent = T.tourStops?.[7]?.s || ''; continue; }
    const meta = diveMeta[e.id] || (diveMeta[e.id] = await fetch(`src/content/deepdives/${e.id}.json`).then(r => r.ok ? r.json() : null).catch(() => null));
    if (meta) { const n = (meta.chapters || []).length; const c0 = meta.chapters?.[0]?.title; sp.textContent = `${n} ${T.organs?.chapters || ''} · ${c0?.[S.lang] || c0?.en || ''}`; }
  }
}
$('#btn-organs').addEventListener('click', openOrgans);
// activity inside the embedded eye page also counts (same origin)
$('#diveframe iframe').addEventListener('load', (ev) => {
  try {
    const w = ev.target.contentWindow; if (!w || w.location.href === 'about:blank') return;
    const wake = () => { activity(); if (tour.on) stopTour(); };
    let lm = null;
    w.addEventListener('pointerdown', wake, true); w.addEventListener('keydown', wake, true); w.addEventListener('wheel', wake, { capture: true, passive: true });
    w.addEventListener('pointermove', (e) => { if (lm && Math.hypot(e.clientX - lm[0], e.clientY - lm[1]) > 6) wake(); lm = [e.clientX, e.clientY]; }, true);
  } catch {}
});
$('#organs-close').addEventListener('click', () => { organsEl.hidden = true; });
organsEl.addEventListener('click', (e) => { if (e.target === organsEl) organsEl.hidden = true; });

// ============================================================ living head: gaze, breathing, micro-turn
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), FWD = new THREE.Vector3(0, 0, 1);
const ray = new THREE.Raycaster();
let nextSaccade = 0, gazePoint = new THREE.Vector3(0, 1.6, 1.2);
const turn = { yaw: 0, pitch: 0 };
const STILL = Q.has('still');   // debug: freeze breathing, gaze, micro-turn, orbit drift (flicker measurement)
window.__headStill = STILL;
function updateLife(dt, t) {
  if (STILL) { t = 0; S.pointerIn = false; }
  const calm = !!S.inspect || !!S.section || tour.on || S.intro < 1;
  // head micro-turn toward the cursor (±6° yaw, ±3° pitch)
  const ty = !calm && S.pointerIn ? clamp(S.pointer.x + 0.35, -1, 1) * 0.1 : 0;
  const tp = !calm && S.pointerIn ? clamp(-S.pointer.y * 0.7, -1, 1) * 0.05 : 0;
  if ((!S.hoverStruct && !S.dragging) || calm) { turn.yaw = damp(turn.yaw, ty, 0.7, dt); turn.pitch = damp(turn.pitch, tp, 0.7, dt); }   // hold still under the cursor
  const breath = Math.sin(t * Math.PI * 2 / 4.6);
  // breathing: a slow 0.3 mm rise only (rotation made fine strands and highlights shimmer)
  pivot.rotation.set(turn.pitch, turn.yaw, 0, 'YXZ');
  pivot.position.set(NECK.x, NECK.y + breath * 0.0003, NECK.z);
  // eyes: both converge on the point under the cursor (or the camera), ±15°, with small saccades
  const active = !S.inspect && S.intro > 0.6;
  if (STILL) nextSaccade = 1e9; else if (t > nextSaccade) {
    if (active && S.pointerIn) {
      ray.setFromCamera(S.pointer, camera);
      gazePoint.copy(ray.ray.origin).addScaledVector(ray.ray.direction, cam.dist * 0.55);
    } else gazePoint.copy(camera.position);
    nextSaccade = t + 0.14 + Math.random() * 0.7;
  }
  rig.updateMatrixWorld(true);
  for (const side of ['L', 'R']) {
    const e = eyes[side]; if (!e) continue;
    _v.copy(gazePoint); rig.worldToLocal(_v); _v.sub(e.center).normalize();
    const ang = Math.min(FWD.angleTo(_v), THREE.MathUtils.degToRad(15));
    const axis = new THREE.Vector3().crossVectors(FWD, _v);
    if (axis.lengthSq() > 1e-8) e.goal.setFromAxisAngle(axis.normalize(), ang); else e.goal.identity();
    e.q.slerp(e.goal, 1 - Math.exp(-dt * 22));
    _q.identity();   // (no fixational tremor: it made the corneal highlight twinkle)
    e.pivot.quaternion.copy(e.q).multiply(_q);
  }
}

// ---- flicker measurement: mean |ΔY| between consecutive frames of the final image (0..255), plus a heatmap
let flick = null;
function flickerFrame() {
  const gl = renderer.getContext(); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const Y = new Float32Array(w * h); for (let i = 0; i < w * h; i++) Y[i] = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
  if (!flick.acc) flick.acc = new Float32Array(w * h), flick.w = w, flick.h = h;
  if (flick.prev && flick.prev.length === Y.length) { for (let i = 0; i < Y.length; i++) flick.acc[i] += Math.abs(Y[i] - flick.prev[i]); flick.pairs++; }
  else if (flick.prev) flick.resized++;
  flick.prev = Y; flick.dprs.add(stage.dpr);
  if (++flick.frames >= flick.n) { const f = flick; flick = null; f.done(f); }
}
function measureFlicker(n = 120) {
  return new Promise((done) => { flick = { n, frames: 0, pairs: 0, resized: 0, dprs: new Set(), done }; }).then((f) => {
    const m = f.acc.map(v => v / Math.max(1, f.pairs)); let sum = 0, over1 = 0, over2 = 0; const sorted = Float32Array.from(m).sort();
    for (const v of m) { sum += v; if (v > 1) over1++; if (v > 2) over2++; }
    // heatmap 480 px wide (flipped: GL rows are bottom-up)
    const W = 480, H = Math.round(480 * f.h / f.w), c = document.createElement('canvas'); c.width = W; c.height = H; const ctx2 = c.getContext('2d'); const img = ctx2.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const sx = Math.floor(x * f.w / W), sy = f.h - 1 - Math.floor(y * f.h / H); const v = Math.min(1, m[sy * f.w + sx] / 4); const o = (y * W + x) * 4; img.data[o] = 255 * Math.min(1, v * 2); img.data[o + 1] = 255 * Math.max(0, v * 2 - 1); img.data[o + 2] = 40; img.data[o + 3] = 255; }
    ctx2.putImageData(img, 0, 0);
    return { meanDY: +(sum / m.length).toFixed(3), p99: +sorted[Math.floor(sorted.length * 0.99)].toFixed(2), p999: +sorted[Math.floor(sorted.length * 0.999)].toFixed(2), fracOver1: +(over1 / m.length).toFixed(4), fracOver2: +(over2 / m.length).toFixed(4), pairs: f.pairs, resized: f.resized, dprs: [...f.dprs], heatmap: c.toDataURL('image/png') };
  });
}

// ============================================================ frame loop
const clock = { last: performance.now(), getDelta() { const n = performance.now(), d = (n - this.last) / 1000; this.last = n; return d; } };
const perf = { acc: 0, n: 0, win: 0, fps: 60, hist: [] };
// Adaptive resolution without a sawtooth: 2-s windows; drop by a big step after 2 slow windows; rise only after
// 5 fast windows (10 s) and never back to a level that was just too slow (that level is barred for 60 s).
const dprState = { slow: 0, fast: 0, lastChange: 0, ceiling: Infinity, ceilUntil: 0, history: [] };
function adaptDPR(dt) {
  if (Q.has('dpr')) return;
  if (dt > 0.1) return;                  // ignore stalls (tab switches, test harness benches)
  perf.acc += dt; perf.n++;
  if (perf.acc < 2) return;
  const fps = perf.n / perf.acc; perf.fps = fps; perf.acc = 0; perf.n = 0;
  if (document.hidden || !S.ready) return;
  const now = performance.now(), maxD = Math.min(devicePixelRatio || 1, 2);
  if (now > dprState.ceilUntil) dprState.ceiling = Infinity;
  if (fps < 48) { dprState.slow++; dprState.fast = 0; } else if (fps > 58.5) { dprState.fast++; dprState.slow = 0; } else { dprState.slow = 0; dprState.fast = 0; }
  const change = (v) => { const o = stage.dpr; const n = stage.setDPR(v); if (Math.abs(n - o) > 0.01) { dprState.lastChange = now; dprState.history.push([Math.round(now), +n.toFixed(2)]); } dprState.slow = dprState.fast = 0; };
  if (dprState.slow >= 2 && stage.dpr > 0.61 && now - dprState.lastChange > 4000) { dprState.bars = (dprState.bars || 0) + 1; dprState.ceiling = stage.dpr - 0.01; dprState.ceilUntil = dprState.bars > 1 ? Infinity : now + 60000; change(stage.dpr - 0.25); }
  else if (dprState.fast >= 5 && now - dprState.lastChange > 8000) { const target = Math.min(maxD, stage.dpr + 0.25); if (target <= dprState.ceiling && target > stage.dpr + 0.01) change(target); }
}
// debug: emulate a GPU-bound frame whose cost grows with the pixel count (?gpuload=ms at DPR 1)
const GPULOAD = +(Q.get('gpuload') || 0);
function emulateLoad() { if (!GPULOAD) return; const t0 = performance.now(), ms = GPULOAD * stage.dpr * stage.dpr; while (performance.now() - t0 < ms) {} }
let coveredFrames = 0;
const aboutEl = document.querySelector('#aboutbox');
function tick() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  S.time += dt; const t = S.time;
  U.uTime.value = t;
  // intro: head emerges from darkness while the key light sweeps round
  if (S.intro < 1) S.intro = Math.min(1, S.intro + dt / 5.2);
  const ie = easeIO(clamp(S.intro * 1.15, 0, 1));
  stage.setLights(easeIO(clamp(S.intro * 1.05, 0, 1)));
  stage.final.uniforms.uExposure.value = THREE.MathUtils.lerp(0.02, 1.0, ie);
  stage.composite.uniforms.uFade.value = ie;
  if (!NO_INTRO && S.intro > 0.18 && S.intro < 0.2) caption(UI[S.lang].intro.l1, '', '', 2400);
  if (!NO_INTRO && S.intro > 0.62 && S.intro < 0.64) caption(UI[S.lang].intro.l2, '', '', 2400);
  if (S.intro >= 1 && !document.body.classList.contains('ready')) {
    document.body.classList.add('ready');
    if (!handSeen && !(KIOSK && tour.on)) { document.body.classList.add('show-hand'); setTimeout(() => document.body.classList.remove('show-hand'), 14000); }
    if (!S.touchedDepth) setTimeout(() => { if (!S.touchedDepth) document.body.classList.add('show-rail-hint'); }, NO_INTRO ? 400 : 1600);
  }
  document.body.classList.toggle('show-hint', S.intro >= 1 && !S.inspect && !tour.on && !S.section);
  // inertia
  if (!S.dragging) { S.yawOff += S.yawVel; S.pitchOff += S.pitchVel; S.yawVel *= Math.exp(-dt * 5); S.pitchVel *= Math.exp(-dt * 5); }
  S.pitchOff = clamp(S.pitchOff, -1.2, 1.2);
  // depth & sex
  const prevDepth = S.depth;
  {  // eased constant-speed travel: every layer gets a readable ~1 s dissolve, long jumps go faster
    const diff = S.depthTarget - S.depth, ad = Math.abs(diff);
    const speed = Math.max(0.95, ad * 0.85) * Math.min(1, 0.25 + ad * 3);
    S.depth += Math.sign(diff) * Math.min(ad, speed * dt);
    if (Math.abs(S.depth - S.depthTarget) < 0.001) S.depth = S.depthTarget;
  }
  S.depthVel = (S.depth - prevDepth) / Math.max(dt, 1e-3);
  const prevSex = S.sex;
  S.sex = S.sex < S.sexTarget ? Math.min(S.sexTarget, S.sex + dt / 1.2) : Math.max(S.sexTarget, S.sex - dt / 1.2);
  const sexE = S.sex * S.sex * (3 - 2 * S.sex);
  U.uSex.value = sexE; U.uSexF.value = sexE;
  U.uRigInv.value.copy(rig.matrixWorld).invert();
  U.uLidShade.value = 1 - layerDis[G.skin];
  // optional strand hair module (src/fx/hair.js, attached via __head.attachHair): fades with the skin layer and sex
  if (hairMod) {
    const vis = (1 - layerDis[G.skin]) * (S.inspect ? 0.2 : 1) * (S.off.has('skin') ? 0 : 1) * (dive && dive.active ? 0 : 1);   // sections clip the hair like any tissue
    hairMod.object.visible = vis > 0.01;
    try { hairMod.update?.({ skin: vis, sex: sexE, time: t, dt, camera }); } catch (e) { if (!hairMod._warned) { hairMod._warned = true; console.warn('[head] hair update', e); } }
  }
  for (const r of renderables) if (r.morphIndex != null) r.mesh.morphTargetInfluences[r.morphIndex] = sexE;   // every frame (URL ?sex=f starts at 1)
  // eye interior darkness (living pupils are black) — lifted when the eye is cut or examined
  const insp = S.inspect ? structs.get(S.inspect) : null;
  const eyeOpen = (section.state.on > 0.5) || (insp && insp.group === G.eye);
  U.uEyeDark.value = damp(U.uEyeDark.value, eyeOpen ? 0 : 1, 4, dt);
  U.uCordY.value = S.depth > 4.5 && !S.section ? 1.505 : -10;

  tickTour(dt);
  tickIdle(performance.now());
  if (dive && dive.active) { dive.step(dt, t); targetsDirty = true; }
  updateLife(dt, t);
  section.update(dt);
  stepState(dt);
  hoverPick(performance.now());
  updateCamera(dt);
  if (S.section) updateGrip();
  updateRailMark();
  sound.update(dt, { explodeSpeed: S.depthVel * 0.6, vessels: 1 - Math.min(1, Math.abs(S.depth - 2)) });
  // a full-screen card (organs, about, eye page) covers the head: freeze the 3D behind it —
  // the blur behind the card stays still and the GPU is free (the organ grid was 7 fps otherwise)
  const covered = !organsEl.hidden || !aboutEl.hidden || document.body.classList.contains('diving-frame');
  coveredFrames = covered ? coveredFrames + 1 : 0;
  if (coveredFrames < 3) {
    stage.render(t);
    if (flick) flickerFrame();
    emulateLoad();
    adaptDPR(dt);
  }
  if (!window.__head.ready && S.ready) window.__head.ready = true;
  requestAnimationFrame(tick);
}

// ============================================================ test / automation API
window.__head = {
  ready: false,
  set(o = {}) {
    if ('lang' in o && LANGS.includes(o.lang)) { S.lang = o.lang; applyLang(); buildSearch(); }
    if ('intro' in o) S.intro = o.intro;
    if ('layer' in o) { const i = typeof o.layer === 'number' ? o.layer : RAIL.indexOf(o.layer); if (i >= 0) { setDepth(i, { user: false }); if (o.instant) S.depth = S.depthTarget; } }
    if ('sex' in o) setSex(o.sex === 'f' || o.sex === 1 || o.sex === true);
    if ('section' in o) setSection(o.section || null);
    if ('secOffset' in o) section.setOffset(o.secOffset);
    if ('inspect' in o) { o.inspect ? inspect(o.inspect) : exitInspect(); }
    if ('tour' in o) { o.tour ? startTour() : stopTour(); }
    if ('yaw' in o) S.yawOff = o.yaw; if ('pitch' in o) S.pitchOff = o.pitch; if ('zoom' in o) S.zoom = o.zoom;
    if ('off' in o) { S.off = new Set(o.off); targetsDirty = true; updateRail(); }
    if ('hair' in o) { S.hair = !!o.hair; targetsDirty = true; }
    if ('pointer' in o) { S.pointerIn = true; S.pointerPx.set(o.pointer[0], o.pointer[1]); S.pointer.set(o.pointer[0] / innerWidth * 2 - 1, -(o.pointer[1] / innerHeight) * 2 + 1); pickDirty = true; }
    return true;
  },
  state() {
    return {
      ready: S.ready, intro: +S.intro.toFixed(3), lang: S.lang, layer: RAIL[S.depthTarget], depth: +S.depth.toFixed(3), sex: S.sexTarget ? 'f' : 'm', sexT: +S.sex.toFixed(3),
      section: S.section, secOffset: +section.state.offset.toFixed(4), inspect: S.inspect, hover: S.hoverStruct?.id || null,
      tour: tour.on, tourT: +tour.t.toFixed(1), tourStop: tour.stop, off: [...S.off], dpr: stage.dpr, fps: Math.round(perf.fps),
      panelName: S.inspect ? $('#panel .name').textContent : null,
      structures: structs.size, nodes: M ? M.nodes.length : 0,
      dive: dive ? dive.state() : null, dprHistory: dprState.history, tourStep: tour.step, tourLoops: tour.loops, kiosk: KIOSK, inspectRegion: S.inspectRegion || null, hoverRegion: S.hoverRegion || null, organsOpen: !organsEl.hidden, idleMs: Math.round(performance.now() - S.lastActivity),
      camYaw: +cam.yaw.toFixed(3), camPitch: +cam.pitch.toFixed(3), camDist: +cam.dist.toFixed(3), zoom: +S.zoom.toFixed(3), yawOff: +S.yawOff.toFixed(3),
      search: !searchEl.hidden, about: !$('#aboutbox').hidden, panelOpen: document.body.classList.contains('inspecting'),
    };
  },
  structures() { return [...structs.values()].map(s => ({ id: s.id, group: s.group, cls: s.cls, hidden: !!s.hidden, n: s.sids.length })); },
  // true render cost: n frames back-to-back with a GPU sync (not limited by vsync)
  bench(n = 60) {
    const gl = renderer.getContext();
    stage.render(S.time); gl.finish();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) stage.render(S.time + i * 0.016);
    const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = (performance.now() - t0) / n;
    return { msPerFrame: +ms.toFixed(2), fpsEquivalent: Math.round(1000 / ms), dpr: stage.dpr, px: stage.size.px.toArray() };
  },
  // hair integration point: attachHair({ object: THREE.Object3D (rest/glTF coordinates), update?({skin, sex, time, dt, camera}) })
  attachHair(mod) { if (!mod || !mod.object) return false; hairMod = mod; if (mod.object.parent !== rig) rig.add(mod.object); return true; },
  dive(id, chapter = 0) { if (!id) { dive?.close(); return Promise.resolve(true); } return openDive(id, chapter); },
  region(x, y) { const r = skinRegionAt(x, y); return r ? r.region : null; },
  // a screen point on the skin that classifies as the given region (and is really the visible skin there)
  projectRegion(name) {
    const m = skinMesh(); if (!m) return null; const P = m.geometry.attributes.position; const v = new THREE.Vector3();
    for (let i = 0; i < P.count; i += 7) {
      v.fromBufferAttribute(P, i); if (classifyRegion(v) !== name) continue;
      const w = v.clone().applyMatrix4(rig.matrixWorld).project(camera); if (Math.abs(w.x) > 0.95 || Math.abs(w.y) > 0.95 || w.z > 1) continue;
      const x = (w.x * 0.5 + 0.5) * innerWidth, y = (-w.y * 0.5 + 0.5) * innerHeight;
      const sid = gpuPick(x, y); if (sid < 0 || sidToStruct[sid].id !== 'skin') continue;
      if (skinRegionAt(x, y)?.region === name) return [Math.round(x), Math.round(y)];
    }
    return null;
  },
  diveIndex() { return dive ? dive.D.index : []; },
  measureFlicker,
  pick(x, y) { const sid = gpuPick(x, y); return sid >= 0 ? { sid, id: sidToStruct[sid].id, node: M.nodes[sid].node } : null; },
  // a screen point where the structure is actually visible (verified by the GPU pick), or null
  projectPart(id) {
    const st = structs.get(id); if (!st) return null;
    const v = new THREE.Vector3();
    const cands = [];
    for (const sid of st.sids) {
      const smp = M.nodes[sid].samples;
      const off = dive ? dive.offsetOf(sid) : null;
      for (let i = 0; i < smp.length; i += 3) {
        v.set(smp[i], smp[i + 1], smp[i + 2]); if (off) v.add(off); v.applyMatrix4(rig.matrixWorld).project(camera);
        if (Math.abs(v.x) > 0.98 || Math.abs(v.y) > 0.98 || v.z > 1) continue;
        cands.push([(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight]);
      }
      // centre of the node, nudged toward the samples
      const c = M.nodes[sid].center.clone().add(off || new THREE.Vector3()).applyMatrix4(rig.matrixWorld).project(camera);
      cands.unshift([(c.x * 0.5 + 0.5) * innerWidth, (-c.y * 0.5 + 0.5) * innerHeight]);
    }
    for (const [x, y] of cands) {
      for (const [ox, oy] of [[0, 0], [3, 3], [-3, -3], [4, -4], [-4, 4]]) {
        const sid = gpuPick(x + ox, y + oy);
        if (sid >= 0 && sidToStruct[sid] === st) return [Math.round(x + ox), Math.round(y + oy)];
      }
    }
    return null;
  },
  info() {
    let tris = 0, meshes = 0; scene.traverse(o => { if (o.isMesh && o.visible && o.geometry && o.material && o.material.colorWrite !== false) { let p = o.parent, vis = true; while (p) { if (!p.visible) vis = false; p = p.parent; } if (!vis) return; meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    return { tris: Math.round(tris), meshes, calls: renderer.info.render.calls, frameTris: renderer.info.render.triangles, programs: renderer.info.programs?.length, dpr: stage.dpr, gl: renderer.capabilities.isWebGL2 ? 'webgl2' : 'webgl1' };
  },
  timing: {},
  _dbg: { U, stage, section, get M() { return M; }, get dive() { return dive; }, structs, renderables, cam },
};

// ============================================================ boot
async function boot() {
  applyLang();
  if (Q.has('dpr')) stage.setDPR(+Q.get('dpr') || 1);
  buildRail(); updateRail();
  if (!IS_TOUCH) $('#sound').classList.add('pulse');
  const gl = renderer.getContext();
  if (!(gl instanceof WebGL2RenderingContext)) { $('#loader .lsub').textContent = 'WebGL2 required'; return; }
  const contentP = loadContent(LANGS);
  const sexP = loadSexField();
  const sizes = FILES.map(() => [0, 1]);
  const progress = () => { let g = 0, t = 0; for (const [a, b] of sizes) { g += a; t += b; } setProgress(0.82 * g / t); };
  const draco = new DRACOLoader(); draco.setDecoderPath('vendor/three/jsm/libs/draco/'); draco.setWorkerLimit(4);
  const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
  const t0 = performance.now();
  const gltfs = await Promise.all(FILES.map(async (file, i) => {
    const buf = await fetchWithProgress(`assets/${file}.glb`, (a, b) => { sizes[i] = [a, b]; progress(); });
    const gltf = await loader.parseAsync(buf, 'assets/');
    return { file, gltf };
  }));
  window.__head.timing.fetched = Math.round(performance.now() - t0);
  content = await contentP;
  setProgress(0.86);
  await new Promise(r => setTimeout(r, 0));
  M = buildModel(gltfs);
  draco.dispose();
  setupScene();
  initState();
  buildSearch();
  dive = createDive({
    structs, M, rig, camera, U, CENTER, section, sound,
    lang: () => S.lang, ui: () => UI[S.lang], source: (r) => content.source(r), name: (id) => nameOf(id), fillPanel,
    dirty: () => { targetsDirty = true; },
    resetView,
    setSection: (axis) => { if ((axis || null) !== S.section) setSection(axis || null); },
    beforeEnter: () => { exitInspect(); setHover(-1); tip.classList.remove('show'); },
    afterExit: () => { resetView(); document.body.classList.remove('dive-card'); },
  });
  await dive.loadIndex();
  const sf = await sexP; window.__head.timing.sexfield = sf;
  // strand hair (separate module): scalp hair ♂/♀ + eyebrows; the procedural brows switch off when strands exist
  if (Q.get('hair') !== '0') {
    try {
      const { createHair } = await import('./fx/hair.js');
      const hair = await Promise.race([createHair(renderer, scene, { parent: rig, base: 'assets/', skinOffset: 0.0012 /* = skin shader's outward push */, clippingPlanes: section.clip }), new Promise(r => setTimeout(() => r(null), 15000))]);
      if (hair) {
        window.__head.attachHair({
          object: hair.object3d,
          update({ skin, sex, dt, camera }) { hair.setSex(sex); hair.setOpacity(skin); hair.update(dt, camera); },
        });
        if (hair.sets && hair.sets.brows) U.uBrows.value = 0;
        window.__head.timing.hair = hair.stats ? hair.stats() : true;
      }
    } catch (e) { console.warn('[head] hair module not loaded', e); }
  }
  window.__head.timing.built = Math.round(performance.now() - t0);
  window.__head.timing.flippedNormals = M.flipped;
  setProgress(0.9);
  // URL state
  const L = Q.get('layer'); if (L != null) { const i = isNaN(+L) ? RAIL.indexOf(L) : +L; if (i >= 0) { S.depthTarget = clamp(i, 0, 5); S.depth = S.depthTarget; S.touchedDepth = true; } }
  if (Q.get('sex') === 'f') { S.sexTarget = S.sex = 1; setSex(true); }
  // shader precompile with everything visible (no hitches later), then back to normal
  stepState(0.016); updateCamera(1);
  const within = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
  try {
    const vis = []; scene.traverse(o => { if ((o.isMesh || o.isLine) && !o.visible) { vis.push(o); o.visible = true; } });
    await stage.compile(9000);
    setProgress(0.97);
    stage.render(0);           // allocate targets / compile post
    for (const o of vis) o.visible = false;
    gpuPick(innerWidth / 2, innerHeight / 2);
  } catch (e) { console.warn('[head] precompile', e); }
  window.__head.timing.compiled = Math.round(performance.now() - t0);
  setProgress(1);
  document.body.classList.add('loaded');
  S.ready = true;
  if (Q.get('section')) setSection(Q.get('section'));
  if (Q.get('inspect')) { S.intro = 1; inspect(Q.get('inspect')); }
  if (Q.get('dive')) { S.intro = 1; openDive(Q.get('dive'), +(Q.get('chapter') || 0)); }
  if (Q.has('tour') || KIOSK) setTimeout(() => startTour({ auto: KIOSK }), NO_INTRO ? 300 : 5600);
  // eye deep dive: load the eye page hidden in the background so it opens instantly
  // (a little later, when the visitor is not interacting: the eye page compiles its shaders on the main thread)
  const preload = () => { if (performance.now() - S.lastActivity < 4000 || tour.on && !KIOSK) return setTimeout(preload, 3000); try { dive.preloadFrame(); } catch (e) { console.warn("[head] eye preload", e); } };
  setTimeout(preload, NO_INTRO ? 20000 : 25000);
  applyLang();
  clock.getDelta();
  requestAnimationFrame(tick);
}
boot().catch((e) => { console.error('[head] boot failed', e); const el = $('#loader .lsub'); if (el) el.textContent = 'Error: ' + (e && e.message ? e.message : e); });
