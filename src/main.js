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

const Q = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const clamp = THREE.MathUtils.clamp;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const canvas = $('#gl');
const stage = createStage(canvas);
const { scene, camera, renderer } = stage;
const sound = new Sound();
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
    const reveal = (group === G.brain && (cls === 'brainstem' || cls === 'nerve')) ? 2.5 : GROUP_REVEAL_AT[group];
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
function updateCamera(dt) {
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
    tGhost[i] = ghost; tOwn[i] = own; tForce[i] = force;
    let hl = 0;
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
    const forced = insp && r.sids.some(s => cur[s * 4 + 3] > 0.001);
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
let pickDirty = false, lastPick = 0;
function hoverPick(now) {
  if (!pickDirty || now - lastPick < 55) return;
  pickDirty = false; lastPick = now;
  if (!S.pointerIn || S.dragging || S.intro < 1 || gripDrag) { setHover(-1); return; }
  setHover(gpuPick(S.pointerPx.x, S.pointerPx.y));
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
function inspect(id, sid = -1, { fromTour = false } = {}) {
  const st = structs.get(id);
  if (!st) return false;
  if (!fromTour) stopTour();
  if (sid < 0 && st.sids.length > 1) {
    // bilateral structure opened from search / API: frame the side that faces the camera
    let best = Infinity;
    for (const s of st.sids) { const d = M.nodes[s].center.clone().applyMatrix4(rig.matrixWorld).distanceTo(camera.position); if (d < best) { best = d; sid = s; } }
    if (st.sids.every(s => M.nodes[s].side === 'M')) sid = -1;
  }
  S.inspect = id; S.inspectSid = sid >= 0 ? sid : st.sids[0];
  targetsDirty = true;
  // camera: frame the clicked node (or the whole structure when midline / searched)
  const rec = M.nodes[S.inspectSid];
  const box = sid >= 0 ? rec.box : st.box;
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
    const nm = document.createElement('span'); nm.className = 'nm';
    li.append(dot, nm); railOl.append(li);
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
  panel.querySelector('.name').textContent = nameOf(id);
  panel.querySelector('.name').lang = S.lang;
  panel.querySelector('.la').textContent = content.latin(id);
  panel.querySelector('.role').textContent = content.role(id, S.lang);
  panel.querySelector('.role').lang = S.lang;
  panel.querySelector('.alt').textContent = LANGS.filter(l => l !== S.lang).map(l => nameOf(id, l)).filter((v, i, a) => a.indexOf(v) === i && v !== nameOf(id)).join('  ·  ');
  const ul = panel.querySelector('.facts'); ul.replaceChildren();
  const facts = content.facts(id).slice(0, 2);
  for (const f of facts) {
    const txt = (typeof f[S.lang] === 'string' && f[S.lang]) || f.en || '';
    if (!txt) continue;
    const li = document.createElement('li'); li.textContent = localNum(txt);
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
  if (!ul.children.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = T.panel.noFacts; ul.append(li); }
}
function localNum(str) {
  if (S.lang === 'en' || !str) return str;
  return String(str).replace(/(\d),(\d{3})(?!\d)/g, '$1 $2').replace(/(\d)\.(\d)/g, '$1,$2');
}
const tip = $('#tip');
function updateTip() {
  const st = S.hoverStruct;
  if (!st || S.dragging || (S.inspect && st.id === S.inspect)) { tip.classList.remove('show'); return; }
  tip.querySelector('b').textContent = nameOf(st.id);
  tip.querySelector('i').textContent = content.latin(st.id);
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
  updateRail(); updateTourBtn(); fillAbout();
  if (S.inspect) fillPanel(S.inspect);
  if (S.hoverStruct) updateTip();
  if (tour.on && tour.stop >= 0) showTourCaption(tour.stop);
}

// ============================================================ tour («Саяхат»)
const MIMIC = ['zygomaticus-major-muscle', 'zygomaticus-minor-muscle', 'orbicularis-oris-muscle', 'levator-labii-superioris', 'levator-anguli-oris', 'depressor-anguli-oris', 'depressor-labii-inferioris', 'risorius-muscle', 'mentalis-muscle', 'nasalis-muscle', 'procerus-muscle', 'frontalis-muscle', 'corrugator-supercilii', 'orbital-part-of-orbicularis-oculi', 'palpebral-part-of-orbicularis-oculi', 'buccinator', 'levator-nasolabialis', 'depressor-septi-nasi', 'occipitalis-muscle', 'temporoparietalis-muscle'];
const TOUR = [
  { at: 0, stop: 0, go() { exitInspect(); setSection(null); setDepth(0, { user: false }); S.tourHl = null; }, cam: { yaw: -0.32, pitch: 0.05, dist: 1.02 } },
  { at: 6.5, stop: 1, go() { setDepth(1, { user: false }); S.tourHl = new Set(MIMIC); }, cam: { yaw: -0.2, pitch: 0.06, dist: 0.92 } },
  { at: 13, stop: 2, go() { S.tourHl = null; inspect(findStruct(['superficial-part-of-masseter']), -1, { fromTour: true }); } },
  { at: 19.5, stop: 3, go() { exitInspect(); setDepth(2, { user: false }); }, cam: { yaw: -0.85, pitch: 0.1, dist: 1.05 } },
  { at: 26, stop: 4, go() { setDepth(3, { user: false }); S.tourHl = new Set(CRANIAL()); }, cam: { yaw: -1.05, pitch: -0.05, dist: 1.0 } },
  { at: 32.5, stop: 5, go() { S.tourHl = null; setDepth(4, { user: false }); }, cam: { yaw: -0.55, pitch: 0.12, dist: 1.12 } },
  { at: 39, stop: 6, go() { setDepth(5, { user: false }); }, cam: { yaw: -0.75, pitch: 0.35, dist: 1.0 } },
  { at: 43.5, stop: -1, go() { setSection('sagittal'); } },
  { at: 49, stop: 7, go() { setSection(null); setDepth(0, { user: false }); }, cam: { yaw: -0.3, pitch: 0.03, dist: 0.36, target: new THREE.Vector3(0.031, 1.592, 0.06) } },
  { at: 57, stop: -2, go() { stopTour(); } },
];
const CRANIAL = () => [...structs.keys()].filter(id => /-(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)$/.test(id) && /nerve/.test(id));
function findStruct(cands) { for (const c of cands) if (structs.has(c)) return c; const k = [...structs.keys()].find(id => cands.some(c => id.includes(c))); return k || null; }
const tour = { on: false, t: 0, i: 0, stop: -1, cam: null };
function startTour() {
  sound.start(); syncSoundBtn();
  tour.on = true; tour.t = 0; tour.i = 0; tour.stop = -1; tour.cam = null;
  S.intro = 1; resetView(); closeSearch();
  document.body.classList.add('touring'); updateTourBtn();
}
function stopTour() {
  if (!tour.on) return;
  tour.on = false; tour.cam = null; S.tourHl = null; targetsDirty = true;
  document.body.classList.remove('touring'); hideCaption(); updateTourBtn();
}
function showTourCaption(k) {
  const st = UI[S.lang].tourStops[k]; if (!st) return;
  caption(st.t, st.s, `${String(k + 1).padStart(2, '0')} / ${String(UI[S.lang].tourStops.length).padStart(2, '0')}`, 0);
}
function tickTour(dt) {
  if (!tour.on) return;
  tour.t += dt;
  while (tour.i < TOUR.length && tour.t >= TOUR[tour.i].at) {
    const s = TOUR[tour.i]; s.go(); targetsDirty = true;
    if (s.cam) tour.cam = s.cam; else if (s.stop >= 0) tour.cam = null;
    if (s.stop >= 0) { tour.stop = s.stop; showTourCaption(s.stop); sound.swell(); }
    tour.i++;
    if (!tour.on) return;
  }
  S.yawOff = Math.sin(tour.t * 0.21) * 0.1;
  S.pitchOff = Math.sin(tour.t * 0.16) * 0.03;
}
function updateTourBtn() { const b = $('#btn-tour'); b.textContent = tour.on ? UI[S.lang].tour.stop : UI[S.lang].tour.start; b.classList.toggle('on', tour.on); }

// ============================================================ input
let downAt = null;
const touches = new Map(); let pinch0 = null;
canvas.addEventListener('pointerdown', (e) => {
  stopTour(); sound.start(); syncSoundBtn();
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch') touches.set(e.pointerId, [e.clientX, e.clientY]);
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
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
    const sid = gpuPick(e.clientX, e.clientY);
    const st = sid >= 0 ? sidToStruct[sid] : null;
    if (st && st.id !== S.inspect) inspect(st.id, sid);
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
document.querySelectorAll('#sections button').forEach(b => b.addEventListener('click', () => { stopTour(); sound.start(); if (S.inspect) exitInspect(); setSection(b.dataset.sec); }));
document.querySelectorAll('#sex button').forEach(b => b.addEventListener('click', () => { stopTour(); sound.start(); setSex(b.dataset.sex === 'f'); }));
document.querySelectorAll('.lang').forEach(b => b.addEventListener('click', () => {
  // on phones only the current language is shown: tapping it cycles to the next one
  const next = (b.dataset.lang === S.lang && innerWidth <= 760) ? LANGS[(LANGS.indexOf(S.lang) + 1) % LANGS.length] : b.dataset.lang;
  S.lang = next; storeLang(S.lang); applyLang(); buildSearch();
}));
$('#btn-search').addEventListener('click', openSearch);
$('#panel-close').addEventListener('click', exitInspect);
$('#prev').addEventListener('click', () => stepInspect(-1));
$('#next').addEventListener('click', () => stepInspect(1));
function syncSoundBtn() { const b = $('#sound'); if (sound.started) b.classList.remove('pulse'); b.classList.toggle('on', sound.started && sound.enabled); }
$('#sound').addEventListener('click', () => { const was = sound.started; sound.start(); sound.setEnabled(was ? !sound.enabled : true); syncSoundBtn(); });
$('#about').addEventListener('click', () => { stopTour(); fillAbout(); $('#aboutbox').hidden = false; });
$('#about-close').addEventListener('click', () => { $('#aboutbox').hidden = true; });
$('#aboutbox').addEventListener('click', (e) => { if (e.target.id === 'aboutbox') $('#aboutbox').hidden = true; });

// ============================================================ living head: gaze, breathing, micro-turn
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), FWD = new THREE.Vector3(0, 0, 1);
const ray = new THREE.Raycaster();
let nextSaccade = 0, gazePoint = new THREE.Vector3(0, 1.6, 1.2);
const turn = { yaw: 0, pitch: 0 };
function updateLife(dt, t) {
  const calm = !!S.inspect || !!S.section || tour.on || S.intro < 1;
  // head micro-turn toward the cursor (±6° yaw, ±3° pitch)
  const ty = !calm && S.pointerIn ? clamp(S.pointer.x + 0.35, -1, 1) * 0.1 : 0;
  const tp = !calm && S.pointerIn ? clamp(-S.pointer.y * 0.7, -1, 1) * 0.05 : 0;
  if (!S.hoverStruct || calm) { turn.yaw = damp(turn.yaw, ty, 0.7, dt); turn.pitch = damp(turn.pitch, tp, 0.7, dt); }   // hold still under the cursor
  const breath = Math.sin(t * Math.PI * 2 / 4.6);
  pivot.rotation.set(turn.pitch + breath * 0.0025, turn.yaw, 0, 'YXZ');
  pivot.position.set(NECK.x, NECK.y + breath * 0.0007, NECK.z);
  // eyes: both converge on the point under the cursor (or the camera), ±15°, with small saccades
  const active = !S.inspect && S.intro > 0.6;
  if (t > nextSaccade) {
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
    _q.setFromEuler(new THREE.Euler(Math.sin(t * 11.3 + (side === 'L' ? 0 : 1)) * 0.0012, Math.cos(t * 9.1) * 0.0012, 0));
    e.pivot.quaternion.copy(e.q).multiply(_q);
  }
}

// ============================================================ frame loop
const clock = { last: performance.now(), getDelta() { const n = performance.now(), d = (n - this.last) / 1000; this.last = n; return d; } };
const perf = { acc: 0, n: 0, win: 0, fps: 60, hist: [] };
function adaptDPR(dt) {
  if (Q.has('dpr')) return;
  if (dt > 0.1) return;                  // ignore stalls (tab switches, test harness benches)
  perf.acc += dt; perf.n++;
  if (perf.acc >= 1.5) {
    const fps = perf.n / perf.acc; perf.fps = fps; perf.acc = 0; perf.n = 0;
    if (!document.hidden && S.ready) {
      if (fps < 50 && stage.dpr > 0.7) stage.setDPR(stage.dpr - 0.15);
      else if (fps > 58.5 && stage.dpr < Math.min(devicePixelRatio || 1, 2) - 0.01) { perf.win++; if (perf.win >= 3) { stage.setDPR(stage.dpr + 0.1); perf.win = 0; } }
      else perf.win = 0;
    }
  }
}
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
  if (S.sex !== prevSex) for (const r of renderables) if (r.morphIndex != null) r.mesh.morphTargetInfluences[r.morphIndex] = sexE;
  // eye interior darkness (living pupils are black) — lifted when the eye is cut or examined
  const insp = S.inspect ? structs.get(S.inspect) : null;
  const eyeOpen = (section.state.on > 0.5) || (insp && insp.group === G.eye);
  U.uEyeDark.value = damp(U.uEyeDark.value, eyeOpen ? 0 : 1, 4, dt);
  U.uCordY.value = S.depth > 4.5 && !S.section ? 1.505 : -10;

  tickTour(dt);
  updateLife(dt, t);
  section.update(dt);
  stepState(dt);
  hoverPick(performance.now());
  updateCamera(dt);
  if (S.section) updateGrip();
  updateRailMark();
  sound.update(dt, { explodeSpeed: S.depthVel * 0.6, vessels: 1 - Math.min(1, Math.abs(S.depth - 2)) });
  stage.render(t);
  adaptDPR(dt);
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
  pick(x, y) { const sid = gpuPick(x, y); return sid >= 0 ? { sid, id: sidToStruct[sid].id, node: M.nodes[sid].node } : null; },
  // a screen point where the structure is actually visible (verified by the GPU pick), or null
  projectPart(id) {
    const st = structs.get(id); if (!st) return null;
    const v = new THREE.Vector3();
    const cands = [];
    for (const sid of st.sids) {
      const smp = M.nodes[sid].samples;
      for (let i = 0; i < smp.length; i += 3) {
        v.set(smp[i], smp[i + 1], smp[i + 2]).applyMatrix4(rig.matrixWorld).project(camera);
        if (Math.abs(v.x) > 0.98 || Math.abs(v.y) > 0.98 || v.z > 1) continue;
        cands.push([(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight]);
      }
      // centre of the node, nudged toward the samples
      const c = M.nodes[sid].center.clone().applyMatrix4(rig.matrixWorld).project(camera);
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
  _dbg: { U, stage, section, get M() { return M; }, structs, renderables, cam },
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
  const sf = await sexP; window.__head.timing.sexfield = sf;
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
  if (Q.has('tour')) setTimeout(startTour, NO_INTRO ? 300 : 5600);
  applyLang();
  clock.getDelta();
  requestAnimationFrame(tick);
}
boot().catch((e) => { console.error('[head] boot failed', e); const el = $('#loader .lsub'); if (el) el.textContent = 'Error: ' + (e && e.message ? e.message : e); });
