// THE EYE — core: loads the anatomy modules, runs the intro, the explode timeline, gaze, picking,
// inspect and vessel modes, labels, i18n and sound.
import * as THREE from 'three';
import { createStage } from './fx/stage.js';
import { makeContext, MODULE_LOADERS } from './anatomy/context.js';
import { PARTS, PART_BY_ID, explodeVector, smooth } from './parts.js';
import { applyGhost } from './lib/materials.js';
import { EYE, L } from './config.js';
import { UI, initialLang, storeLang, LANG_OK } from './ui/i18n.js';
import { CONTENT, SOURCES } from './content/parts.js';
import { KIDS, KID_GROUPS, KID_GROUP_OF, KID_GROUP_NAMES } from './content/kids.js';
import { Sound } from './audio/sound.js';

const Q = new URLSearchParams(location.search);
// ?embed=1 — running inside the head atlas (iframe): no standalone header and no own back button (the parent shows one);
// Esc (when no panel/about is open) posts 'close' + {type:'eye-close'} to the parent; short intro.
const EMBED = Q.get('embed') === '1';
if (Q.get('paused') === '1') window.__eyePaused = true;
const INTRO_S = EMBED ? 1.8 : 3.6;
// ?kiosk=1 — exhibition touch screen (passed on by the head atlas): 72 px targets, no film grain, no hover-only UI.
const KIOSK = Q.get('kiosk') === '1';
function postParent(msg) { try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*'); } catch {} }
function closeEye() {
  if (window.parent && window.parent !== window) { postParent('close'); postParent({ type: 'eye-close' }); }   // the head engine listens for the plain string 'close'
  else location.href = '../';   // opened on its own: /…/eye/ → the head atlas one level up
}
const $ = s => document.querySelector(s);
const canvas = $('#gl');
const stage = createStage(canvas);
const { scene, camera, renderer } = stage;
const sound = new Sound();
if (KIOSK) stage.final.uniforms.uGrain.value = 0;

// ---------------------------------------------------------------- state
const S = {
  lang: initialLang(),
  explode: +(Q.get('explode') || 0), explodeTarget: +(Q.get('explode') || 0), explodeVel: 0,
  vessels: +(Q.get('vessels') || 0), vesselsTarget: +(Q.get('vessels') || 0),
  inspect: null, hover: null, hoverFromIndex: null,
  pupil: 3.4, pupilTarget: EYE.pupilR.rest,
  intro: Q.has('nointro') ? 1 : 0,
  gaze: Q.get('gaze') !== '0',
  yawOff: 0, pitchOff: 0, yawVel: 0, pitchVel: 0, zoom: 1,
  pointer: new THREE.Vector2(0, 0), pointerPx: new THREE.Vector2(innerWidth / 2, innerHeight / 2), pointerIn: false,
  dragging: false, dragDist: 0, lastWheel: 0, time: 0, fixedTime: Q.has('t') ? +Q.get('t') : null,
};
const eyeRig = new THREE.Group();
scene.add(eyeRig);
const parts = [];
const partById = {};

// ---------------------------------------------------------------- camera rig
const cam = { target: new THREE.Vector3(0, 0, L.irisZ), yaw: 0, pitch: 0, dist: 15 };
const POSE = {
  intro: { target: new THREE.Vector3(0, 0, L.irisZ), yaw: 0, pitch: 0, dist: 15.5 },
  whole: { target: new THREE.Vector3(-1.5, 0.5, -7), yaw: -0.62, pitch: 0.17, dist: 86 },
  mid: { target: new THREE.Vector3(0, 0, -14), yaw: -0.92, pitch: 0.2, dist: 150 },
  apart: { target: new THREE.Vector3(0, 2, -21), yaw: -1.2, pitch: 0.2, dist: 268 },
};
const VIEW_PREF = {
  retina: [-0.28, 0.1], choroid: [-0.3, 0.12], macula: [-0.15, 0.04], 'optic-disc': [-0.2, 0.05], 'retinal-vessels': [-0.25, 0.08],
  vitreous: [-0.5, 0.15], 'vortex-veins': [-0.6, 0.3], sclera: [-0.7, 0.2], cornea: [-0.55, 0.12], iris: [-0.3, 0.08],
  'sphincter-pupillae': [-0.35, 0.1], 'dilator-pupillae': [-0.35, 0.1], 'iris-vessels': [-0.3, 0.08], lens: [-0.8, 0.12],
  zonules: [-0.5, 0.2], 'ciliary-body': [-0.45, 0.25], conjunctiva: [-0.6, 0.15], 'conjunctival-vessels': [-0.5, 0.12],
  'optic-nerve': [-1.35, 0.25], 'central-retinal-vessels': [-1.3, 0.2], 'ophthalmic-artery': [-1.2, 0.5],
  'superior-rectus': [-0.9, 0.55], 'inferior-rectus': [-0.9, -0.45], 'medial-rectus': [0.9, 0.2], 'lateral-rectus': [-1.2, 0.2],
  'superior-oblique': [-0.2, 0.7], 'inferior-oblique': [-0.6, -0.6], 'anterior-ciliary-arteries': [-0.5, 0.25], 'posterior-ciliary-arteries': [-2.3, 0.25],
};
const lerpPose = (a, b, t, out) => {
  out.target.lerpVectors(a.target, b.target, t);
  out.yaw = a.yaw + (b.yaw - a.yaw) * t; out.pitch = a.pitch + (b.pitch - a.pitch) * t; out.dist = a.dist + (b.dist - a.dist) * t;
  return out;
};
const want = { target: new THREE.Vector3(), yaw: 0, pitch: 0, dist: 1 };
const tmpPose = { target: new THREE.Vector3(), yaw: 0, pitch: 0, dist: 1 };
const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function aspectScale() { const a = innerWidth / innerHeight; return a < 1.35 ? 1.35 / a * 1.05 : 1; }

function desiredCamera() {
  const e = S.explode;
  if (e < 0.35) lerpPose(POSE.whole, POSE.mid, smooth(e / 0.35), want);
  else lerpPose(POSE.mid, POSE.apart, smooth((e - 0.35) / 0.65), want);
  want.dist *= aspectScale();
  if (S.inspect && partById[S.inspect]) {
    const p = partById[S.inspect];
    const f = p.focusWorld();
    const pref = VIEW_PREF[S.inspect] || [-0.8, 0.2];
    want.yaw = pref[0]; want.pitch = pref[1];
    const fov = THREE.MathUtils.degToRad(camera.fov);
    want.dist = Math.max(4, f.radius / Math.sin(fov / 2) * 1.32) * aspectScale();
    // push the part left so the panel on the right does not cover it
    const dir = sphericalDir(want.yaw, want.pitch);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const shift = innerWidth > 760 ? want.dist * Math.tan(fov / 2) * camera.aspect * 0.28 : 0;
    want.target.copy(f.center).addScaledVector(right, shift);
    if (innerWidth <= 760) want.target.y -= want.dist * Math.tan(fov / 2) * 0.35;
  }
  if (S.intro < 1) {
    const k = easeIO(THREE.MathUtils.clamp((S.intro - 0.2) / 0.8, 0, 1));
    lerpPose(POSE.intro, want, k, tmpPose);
    want.target.copy(tmpPose.target); want.yaw = tmpPose.yaw; want.pitch = tmpPose.pitch; want.dist = tmpPose.dist;
  }
  want.yaw += S.yawOff; want.pitch = THREE.MathUtils.clamp(want.pitch + S.pitchOff, -1.35, 1.35);
  want.dist *= S.zoom;
  return want;
}
function sphericalDir(yaw, pitch) { return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)); }

function updateCamera(dt) {
  const w = desiredCamera();
  const k = S.intro < 1 ? 1 : 1 - Math.exp(-dt * (S.dragging ? 14 : 3.4));
  cam.target.lerp(w.target, k);
  cam.yaw += (w.yaw - cam.yaw) * k; cam.pitch += (w.pitch - cam.pitch) * k;
  cam.dist += (w.dist - cam.dist) * (S.intro < 1 ? 1 : 1 - Math.exp(-dt * 3.0));
  camera.position.copy(cam.target).addScaledVector(sphericalDir(cam.yaw, cam.pitch), cam.dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(cam.target);
  camera.near = Math.max(0.1, cam.dist * 0.02); camera.far = cam.dist * 12 + 400; camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- loading
async function loadAll() {
  const ctx = makeContext();
  const names = Object.keys(MODULE_LOADERS);
  let done = 0;
  for (const m of names) {
    try {
      const mod = await MODULE_LOADERS[m]();
      const built = await mod.build(ctx);
      for (const p of built) registerPart(p);
    } catch (e) { console.error(`[eye] module ${m} failed`, e); }
    done++; $('#loader b').textContent = `${Math.round(done / names.length * 100)}%`;
    await new Promise(r => setTimeout(r, 0));
  }
  parts.sort((a, b) => a.meta.index - b.meta.index);
}

function registerPart(p) {
  const meta = PART_BY_ID[p.id];
  if (!meta) { console.warn('[eye] unknown part id', p.id); return; }
  p.meta = meta;
  p.base = p.object.position.clone();
  p.object.traverse(o => { o.userData.partId = p.id; });
  if (!p.pickables || !p.pickables.length) { p.pickables = []; p.object.traverse(o => { if (o.isMesh) p.pickables.push(o); }); }
  const box = new THREE.Box3().setFromObject(p.object);
  const sph = box.getBoundingSphere(new THREE.Sphere());
  const toLocal = v => p.object.worldToLocal(v.clone());
  p.anchorLocal = p.anchor ? p.anchor.clone() : toLocal(sph.center);
  p.focusLocal = p.focus ? { center: p.focus.center.clone(), radius: p.focus.radius } : { center: toLocal(sph.center), radius: Math.max(1, sph.radius) };
  p.ghost = 0; p.highlight = 0;
  p.focusWorld = () => ({ center: p.object.localToWorld(p.focusLocal.center.clone()), radius: p.focusLocal.radius });
  p.anchorWorld = (out = new THREE.Vector3()) => p.object.localToWorld(out.copy(p.anchorLocal));
  eyeRig.add(p.object);
  parts.push(p); partById[p.id] = p;
}

// ---------------------------------------------------------------- ghosting / highlight logic
function isRelated(id, target) {
  if (id === target) return true;
  let p = PART_BY_ID[id];
  while (p && p.host) { if (p.host === target) return true; p = PART_BY_ID[p.host]; }
  return false;
}
function targetGhost(p) {
  let g = 0;
  const v = S.vessels;
  if (p.meta.group !== 'vessel') g = Math.max(g, (p.id === 'choroid' ? 0.5 : 1.0) * v);
  if (S.inspect) {
    const t = S.inspect;
    if (isRelated(p.id, t)) g = 0;
    else if (isRelated(t, p.id)) g = Math.max(g, PART_BY_ID[t].group === 'vessel' ? 0.88 : 0.7); // host of an inspected sub-part: faint context
    else g = 1;
  }
  return g;
}

// ---------------------------------------------------------------- labels + index
const labelsEl = $('#labels'), leadersEl = $('#leaders'), tipEl = $('#tip');
const labelIds = PARTS.filter(p => p.group !== 'vessel' && !p.host).map(p => p.id);
const vesselLabelIds = PARTS.filter(p => p.group === 'vessel').map(p => p.id);
const labelEls = {};
const SVGNS = 'http://www.w3.org/2000/svg';
function buildLabels() {
  for (const id of [...labelIds, ...vesselLabelIds]) {
    const el = document.createElement('div');
    el.className = 'lab' + (PART_BY_ID[id].group === 'vessel' ? ' vessel' : '');
    const b = document.createElement('b'); const s = document.createElement('span');
    el.append(b, s); labelsEl.append(el);
    const line = document.createElementNS(SVGNS, 'line'); const dot = document.createElementNS(SVGNS, 'circle'); dot.setAttribute('r', '2.4');
    leadersEl.append(line, dot);
    labelEls[id] = { el, b, s, line, dot, on: 0 };
  }
}
const proj = new THREE.Vector3();
const LAB_ROW = KIOSK ? 36 : 30;   // label chips are ≥15 px text now, so rows need more room
function toScreen(v) { proj.copy(v).project(camera); return [(proj.x * 0.5 + 0.5) * innerWidth, (-proj.y * 0.5 + 0.5) * innerHeight, proj.z]; }
function updateLabels() {
  // on a phone the 29 name chips cannot fit at ≥15 px: there the model is tapped directly and «Бөліктер» lists everything
  const roomy = innerWidth > 760;
  const showMain = roomy && S.explode > 0.82 && S.vessels < 0.4 && !S.inspect && S.intro >= 1;
  const showVessels = roomy && S.vessels > 0.6 && !S.inspect && S.intro >= 1;
  const center = toScreen(new THREE.Vector3(0, 0, 0).applyMatrix4(eyeRig.matrixWorld));
  let i = 0;
  const placed = [];
  const hoverId = S.hover;
  for (const id in labelEls) {
    const L_ = labelEls[id]; const p = partById[id];
    const isV = PART_BY_ID[id].group === 'vessel';
    const on = p && (isV ? showVessels : showMain);
    L_.el.classList.toggle('show', !!on);
    L_.el.classList.toggle('hover', hoverId === id);
    L_.line.style.opacity = L_.dot.style.opacity = on ? (hoverId === id ? 1 : 0.8) : 0;
    if (!on) continue;
    const [x, y, z] = toScreen(p.anchorWorld());
    if (z > 1) { L_.el.classList.remove('show'); continue; }
    let dx, dy;
    if (PART_BY_ID[id].group === 'muscle' || isV) {
      const ang = Math.atan2(y - center[1], x - center[0]);
      const len = isV ? 84 : 76;
      dx = Math.cos(ang) * len; dy = Math.sin(ang) * len;
      if (isV) { dy += (i % 2 ? -18 : 18); }
    } else {
      const up = (PART_BY_ID[id].index % 2) ? -1 : 1;
      dx = 20; dy = up * (64 + (PART_BY_ID[id].index % 3) * 32);
    }
    const w = (L_.w ||= L_.el.getBoundingClientRect().width || 120);
    placed.push({ L_, x, y, dx, lx: x + dx, ly: y + dy, w, left: dx < 0 });
    i++;
  }
  // resolve overlaps: push later labels further out along their vertical direction
  placed.sort((a, b) => Math.abs(a.ly - a.y) - Math.abs(b.ly - b.y));
  for (let a = 0; a < placed.length; a++) {
    for (let b = 0; b < a; b++) {
      const A = placed[a], B = placed[b];
      const ax0 = A.left ? A.lx - A.w - 8 : A.lx + 8, bx0 = B.left ? B.lx - B.w - 8 : B.lx + 8;
      const overlapX = ax0 < bx0 + B.w + 10 && bx0 < ax0 + A.w + 10;
      if (overlapX && Math.abs(A.ly - B.ly) < LAB_ROW) { const dir = A.ly >= A.y ? 1 : -1; A.ly = B.ly + dir * LAB_ROW; b = -1; }
    }
  }
  for (const P of placed) {
    const { L_, x, y, lx, ly, left } = P;
    L_.el.style.transform = `translate(${lx + (left ? -8 : 8)}px, ${ly - LAB_ROW / 2 + 2}px) translateX(${left ? '-100%' : '0'})`;
    L_.line.setAttribute('x1', x); L_.line.setAttribute('y1', y); L_.line.setAttribute('x2', lx); L_.line.setAttribute('y2', ly);
    L_.dot.setAttribute('cx', x); L_.dot.setAttribute('cy', y);
  }
  // hover tooltip (not when labels already show that part)
  const tipId = S.hover && !S.dragging && !S.inspect ? S.hover : null;
  if (tipId && !KIOSK && !(labelEls[tipId]?.el.classList.contains('show'))) {
    tipEl.textContent = kidName(tipId);
    tipEl.style.transform = `translate(${S.pointerPx.x + 16}px, ${S.pointerPx.y + 14}px)`;
    tipEl.classList.add('show');
  } else tipEl.classList.remove('show');
}

// ---------------------------------------------------------------- i18n / panel / about
function applyLang() {
  const T = UI[S.lang];
  document.documentElement.lang = S.lang;
  document.title = { kk: 'Көз — The Eye', ru: 'Глаз — The Eye', en: 'The Eye' }[S.lang];
  document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (T[k]) el.textContent = T[k]; });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { const k = el.dataset.i18nAria; if (T[k]) el.setAttribute('aria-label', T[k]); });
  document.querySelectorAll('.lang').forEach(b => b.classList.toggle('on', b.dataset.lang === S.lang));
  for (const id in labelEls) {
    labelEls[id].s.textContent = kidName(id);
    labelEls[id].w = 0; // re-measure (text length changed)
  }
  updateButtons(); updateHint(); updateTourBtn(); buildPicker();
  if (typeof capEl !== 'undefined' && capEl) capEl.classList.remove('show');   // a caption shown in the old language must not linger
  if (S.inspect) fillPanel(S.inspect);
  fillAbout();
}
function updateButtons() {
  const T = UI[S.lang];
  const b = $('#btn-explode'); b.querySelector('span').textContent = S.explodeTarget > 0.5 ? T.assemble : T.takeApart; b.classList.toggle('on', S.explodeTarget > 0.5);
  const v = $('#btn-vessels'); v.querySelector('span').textContent = T.vessels; v.classList.toggle('on', S.vesselsTarget > 0.5);
  $('#btn-parts span').textContent = T.parts;
}
// onboarding hand: «drag to turn» until the first drag/scroll, then «tap a part» once the eye is apart, gone after the first part.
const hand = { dragged: false, tapped: false };
function updateHint() {
  const T = UI[S.lang], el = $('#hand');
  const phase = hand.tapped ? null : !hand.dragged ? 'drag' : (S.explodeTarget > 0.5 && S.vesselsTarget < 0.5 ? 'tap' : null);
  el.dataset.phase = phase || '';
  if (phase) el.querySelector('.say span').textContent = phase === 'drag' ? T.handDrag : T.handTap;
}
function handDone(kind) {
  if (kind === 'drag' && !hand.dragged) { hand.dragged = true; updateHint(); }
  if (kind === 'tap' && !hand.tapped) { hand.tapped = true; hand.dragged = true; updateHint(); }
}
const kidName = id => KIDS[id]?.[S.lang]?.name || CONTENT[id]?.[S.lang] || id;
const buzz = () => { try { navigator.vibrate?.(12); } catch {} };
// Kazakh and Russian write 0,5 and 3 556 290; English keeps 0.5 and 3,556,290.
function localNum(str) {
  if (S.lang === 'en' || !str) return str;
  return String(str).replace(/(?<=\d),(?=\d{3}(?!\d))/g, '\u202F').replace(/(\d)\.(\d)/g, '$1,$2');
}
function fillPanel(id) {
  const T = UI[S.lang], c = CONTENT[id] || {}, k = KIDS[id] || {}, kl = k[S.lang] || {};
  const panel = $('#panel');
  const gid = KID_GROUP_OF[id], grp = KID_GROUPS.find(g => g.id === gid);
  const chip = panel.querySelector('.chip'); chip.textContent = KID_GROUP_NAMES[S.lang][gid] || ''; chip.style.setProperty('--c', grp?.color || '#f0b27a');
  panel.querySelector('.name').textContent = kidName(id);
  panel.querySelector('.simple').textContent = kl.s || c['desc_' + S.lang] || c.desc_en || '';
  const wow = panel.querySelector('.wow');
  wow.hidden = !kl.w;
  wow.querySelector('.wv').textContent = kl.v || ''; wow.querySelector('.wv').hidden = !kl.v;
  const wf = c.facts?.[k.f], ws = wf && SOURCES[wf.src];
  const wt = wow.querySelector('.wt'); wt.textContent = kl.w || '';
  wow.title = ws ? ws.title : '';   // the numbered source link lives under «More» with the same fact
  // «More»: scientific name (when the display name is simplified), the full description, all facts with sources
  const sci = panel.querySelector('.sci'); const regular = c[S.lang] || '';
  sci.hidden = !kl.name; sci.textContent = kl.name ? `${T.sci}: ${regular}` : '';
  panel.querySelector('.desc').textContent = c['desc_' + S.lang] || c.desc_en || '';
  const ul = panel.querySelector('.facts'); ul.replaceChildren();
  const h = document.createElement('li'); h.className = 'fh'; h.textContent = T.factsTitle; ul.append(h);
  for (const f of c.facts || []) {
    const li = document.createElement('li');
    const v = document.createElement('div'); v.className = 'v'; v.textContent = localNum(f['v_' + S.lang] || f.v);
    const unit = S.lang === 'en' ? f.u : (f['u_' + S.lang] ?? f.u);
    if (unit) { const sm = document.createElement('small'); sm.textContent = localNum(unit); v.append(sm); }
    // values/units come in English notation → localise; RU sentences are already in Russian notation, KK ones keep the English digits
    const tx = document.createElement('div'); tx.className = 't'; tx.textContent = S.lang === 'kk' ? localNum(f.kk || f.en) : (f[S.lang] || f.en);
    const src = SOURCES[f.src];
    if (src) { const a = document.createElement('a'); a.href = src.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `[${f.src + 1}]`; a.title = src.title; tx.append(' ', a); }
    li.append(v, tx); ul.append(li);
  }
  setMore(panel.querySelector('.more-btn').getAttribute('aria-expanded') === 'true' && panel.dataset.id === id);
  panel.dataset.id = id;
}
function setMore(open) {
  const panel = $('#panel'), btn = panel.querySelector('.more-btn');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn.querySelector('span').textContent = UI[S.lang][open ? 'less' : 'more'];
  panel.querySelector('.more').hidden = !open;
  panel.classList.toggle('open-more', open);
}

// ---------------------------------------------------------------- visual picker (big cards, four simple groups)
const thumbs = {};
const GLASSY = new Set(['lens', 'zonules', 'vitreous', 'cornea']);   // id → dataURL, rendered once from the live scene
function buildPicker() {
  const box = $('#picker .groups'); if (!box) return;
  box.replaceChildren();
  for (const g of KID_GROUPS) {
    const sec = document.createElement('section'); sec.style.setProperty('--c', g.color);
    const h = document.createElement('h3'); h.textContent = KID_GROUP_NAMES[S.lang][g.id]; sec.append(h);
    const ul = document.createElement('ul');
    for (const id of g.parts) {
      const li = document.createElement('li');
      const btn = document.createElement('button'); btn.className = 'card'; btn.dataset.id = id;
      const pic = document.createElement('span'); pic.className = 'pic'; if (thumbs[id]) pic.style.backgroundImage = `url(${thumbs[id]})`;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = kidName(id);
      btn.append(pic, nm); li.append(btn); ul.append(li);
      btn.addEventListener('click', () => { buzz(); closePicker(); stopTour(); handDone('tap'); inspect(id); });
    }
    sec.append(ul); box.append(sec);
  }
}
// Each thumbnail: only that part visible, fully opaque, framed by its own bounding sphere, rendered straight to the canvas
// and copied out in the same task. Runs once, the first time the picker opens.
function renderThumbs() {
  if (Object.keys(thumbs).length) return;
  const size = 200, c2 = document.createElement('canvas'); c2.width = c2.height = size; const g2 = c2.getContext('2d');
  const tcam = new THREE.PerspectiveCamera(28, 1, 0.1, 5000);
  const vis = parts.map(p => p.object.visible);
  const oldSize = new THREE.Vector2(); renderer.getSize(oldSize); const dpr = renderer.getPixelRatio();
  const oldBg = scene.background;
  renderer.setPixelRatio(1); renderer.setSize(size, size, false);
  scene.background = new THREE.Color(0x23262c);   // a mid-dark card colour, so glassy parts (lens, vitreous, zonules) read
  const ghosts = parts.map(p => [p.ghost, p.highlight]);
  const shade = window.__eye._pupilShade; if (shade) shade.visible = false;   // the black pupil disc is not a part
  try {
    for (const p of parts) {
      for (const q of parts) q.object.visible = q === p;
      const glassy = p.id === 'zonules' ? 1 : GLASSY.has(p.id) ? 0.55 : 0;   // clear tissues get the hover tint, otherwise they vanish on the card
      if (p.setGhost) p.setGhost(0, glassy); else applyGhost(p.object, 0, glassy);
      const f = p.focusWorld();
      const pref = VIEW_PREF[p.id] || [-0.8, 0.2];
      const dist = Math.max(2, f.radius / Math.sin(THREE.MathUtils.degToRad(14)) * 1.08);
      tcam.position.copy(f.center).addScaledVector(sphericalDir(pref[0], pref[1]), dist);
      tcam.lookAt(f.center); tcam.near = dist * 0.02; tcam.far = dist * 4 + 50; tcam.updateProjectionMatrix();
      try { p.update?.({ ...frame, camera: tcam, vessels: p.meta.group === 'vessel' ? 0.6 : 0, ghost: 0, highlight: 0, inspect: true }); } catch {}
      renderer.render(scene, tcam);
      g2.clearRect(0, 0, size, size); g2.drawImage(canvas, 0, 0, size, size, 0, 0, size, size);
      thumbs[p.id] = c2.toDataURL('image/jpeg', 0.82);
    }
  } finally {
    parts.forEach((p, i) => { p.object.visible = vis[i]; p.ghost = ghosts[i][0]; p.highlight = ghosts[i][1]; if (p.setGhost) p.setGhost(p.ghost, p.highlight); else applyGhost(p.object, p.ghost, p.highlight); });
    scene.background = oldBg; renderer.setPixelRatio(dpr); renderer.setSize(oldSize.x, oldSize.y, false); stage.resize();
  }
}
function openPicker() {
  stopTour(); if (S.inspect) exitInspect();
  try { renderThumbs(); } catch (e) { console.warn('[eye] thumbnails', e); }
  buildPicker(); $('#picker').hidden = false; document.body.classList.add('picking');
  $('#picker .card')?.focus({ preventScroll: true });
}
function closePicker() { $('#picker').hidden = true; document.body.classList.remove('picking'); }
function fillAbout() {
  const T = UI[S.lang];
  const body = $('#aboutbox .about-body'); body.replaceChildren();
  for (const para of T.aboutBody) { const p = document.createElement('p'); p.textContent = para; body.append(p); }
  const cr = document.createElement('p'); cr.className = 'mono'; cr.style.cssText = 'font-size:11px;letter-spacing:.14em;color:var(--dim);text-transform:uppercase;margin-top:18px'; cr.textContent = T.credit; body.append(cr);
  const ol = $('#aboutbox .sources'); ol.replaceChildren();
  SOURCES.forEach(s => { const li = document.createElement('li'); const a = document.createElement('a'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = s.title; li.append(a); ol.append(li); });
}

// ---------------------------------------------------------------- captions: one large line at a time
const capEl = $('#caption'); let capTimer = null; const capsSeen = new Set();
function caption(key, ms = 2600, subKey = null) {
  const T = UI[S.lang]; if (!T[key]) return;
  clearTimeout(capTimer);
  capEl.replaceChildren(document.createTextNode(T[key]));
  if (subKey && T[subKey]) { const sm = document.createElement('small'); sm.textContent = T[subKey]; capEl.append(sm); }
  capEl.classList.add('show');
  capTimer = setTimeout(() => capEl.classList.remove('show'), ms);
}
function captionOnce(key, ms, subKey) { if (capsSeen.has(key) || Q.has('nocaptions')) return; capsSeen.add(key); caption(key, ms, subKey); }

// ---------------------------------------------------------------- actions
function setExplode(v) { S.explodeTarget = v; if (v > 0.5) S.intro = Math.max(S.intro, 1); updateButtons(); updateHint(); resetOrbit(); }
function toggleExplode() { if (S.inspect) exitInspect(); setExplode(S.explodeTarget > 0.5 ? 0 : 1); sound.swell(); }
function toggleVessels() { if (S.inspect) exitInspect(); S.vesselsTarget = S.vesselsTarget > 0.5 ? 0 : 1; updateButtons(); updateHint(); if (S.vesselsTarget) sound.swell(); }
function resetOrbit() { S.yawOff = 0; S.pitchOff = 0; S.zoom = 1; }
function inspect(id) {
  if (!partById[id]) return;
  S.inspect = id; resetOrbit(); handDone('tap');
  document.body.classList.add('inspecting');
  fillPanel(id); sound.chime(PART_BY_ID[id].index);
}
function exitInspect() { S.inspect = null; document.body.classList.remove('inspecting'); resetOrbit(); }
function step(d) {
  const avail = PARTS.filter(p => partById[p.id]);
  const i = avail.findIndex(p => p.id === S.inspect);
  const n = avail[(i + d + avail.length) % avail.length];
  inspect(n.id);
}

// ---------------------------------------------------------------- tour: one press, the page leads itself (~42 s)
const TOUR = [
  [0.0, () => { exitInspect(); S.vesselsTarget = 0; setExplode(0); }],
  [2.6, () => { setExplode(1); sound.swell(); }],
  [7.4, () => inspect('cornea')],
  [11.0, () => inspect('iris')],
  [14.6, () => inspect('lens')],
  [18.2, () => inspect('retina')],
  [22.4, () => inspect('optic-nerve')],
  [26.0, () => { exitInspect(); }],
  [28.0, () => { S.vesselsTarget = 1; sound.swell(); updateButtons(); updateHint(); }],
  [34.0, () => { setExplode(0); }],
  [39.5, () => { S.vesselsTarget = 0; updateButtons(); updateHint(); }],
  [42.0, () => stopTour()],
];
const tour = { on: false, t: 0, i: 0 };
function startTour() { sound.start(); tour.on = true; tour.t = 0; tour.i = 0; S.intro = Math.max(S.intro, 1); document.body.classList.add('touring'); updateTourBtn(); }
function stopTour() { if (!tour.on) return; tour.on = false; document.body.classList.remove('touring'); resetOrbit(); updateTourBtn(); }
function updateTourBtn() { const b = $('#btn-tour'); if (!b) return; b.querySelector('span').textContent = tour.on ? UI[S.lang].tourStop : UI[S.lang].tour; b.classList.toggle('on', tour.on); }
function tickTour(dt) {
  if (!tour.on) return;
  tour.t += dt;
  while (tour.i < TOUR.length && tour.t >= TOUR[tour.i][0]) { TOUR[tour.i][1](); tour.i++; }
  // slow cinematic drift of the camera while touring
  S.yawOff = Math.sin(tour.t * 0.23) * 0.22 + (S.inspect ? (tour.t % 3.6) * 0.06 : 0);
  S.pitchOff = Math.sin(tour.t * 0.17) * 0.06;
}

// ---------------------------------------------------------------- input
const raycaster = new THREE.Raycaster();
let pickDirty = false;
function pick() {
  pickDirty = false;
  if (!S.pointerIn || S.intro < 1) { S.hover = null; return; }
  raycaster.setFromCamera(S.pointer, camera);
  const cands = [];
  for (const p of parts) {
    if (p.ghost > 0.5 || !p.object.visible) continue;
    if (S.vessels > 0.5 && p.meta.group !== 'vessel') continue;
    for (const m of p.pickables) cands.push(m);
  }
  const hits = raycaster.intersectObjects(cands, false);
  let id = null;
  for (const h of hits) { const pid = h.object.userData.partId; if (pid && pid !== 'vitreous' || (pid === 'vitreous' && hits.length === 1)) { id = pid; break; } }
  if (S.inspect && id !== S.inspect) id = null;
  if (id !== S.hover && id) sound.tick();
  S.hover = id;
  canvas.classList.toggle('pointing', !!id && !S.inspect);
}

let downAt = null;
canvas.addEventListener('pointerdown', e => {
  stopTour();
  sound.start(); $('#sound').classList.remove('pulse'); $('#sound').classList.toggle('on', sound.enabled);
  canvas.setPointerCapture(e.pointerId);
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  S.dragging = true; S.dragDist = 0; canvas.classList.add('dragging'); document.body.classList.add('dragging');
});
canvas.addEventListener('pointermove', e => {
  S.pointerPx.set(e.clientX, e.clientY);
  S.pointer.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  S.pointerIn = true; pickDirty = true;
  if (S.dragging && downAt) {
    S.dragDist += Math.abs(e.movementX) + Math.abs(e.movementY);
    S.yawOff -= e.movementX * 0.0052; S.pitchOff += e.movementY * 0.0042;
    if (S.dragDist > 40) handDone('drag');
  }
});
canvas.addEventListener('pointerleave', () => { S.pointerIn = false; S.hover = null; });
canvas.addEventListener('pointerup', e => {
  canvas.classList.remove('dragging'); document.body.classList.remove('dragging'); S.dragging = false;
  if (downAt && S.dragDist < 6 && performance.now() - downAt.t < 600) {
    pick();
    if (S.hover && S.hover !== S.inspect) inspect(S.hover);
    else if (!S.hover && S.inspect) exitInspect();
  }
  downAt = null;
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  stopTour();
  const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  if (S.inspect || e.ctrlKey) { S.zoom = THREE.MathUtils.clamp(S.zoom * Math.exp(d * 0.0012), 0.3, 2.6); return; }
  if (S.intro < 1) S.intro = Math.min(1, S.intro + 0.05);
  S.explodeTarget = THREE.MathUtils.clamp(S.explodeTarget + d * 0.00085, 0, 1); handDone('drag');
  S.lastWheel = performance.now();
  updateButtons(); updateHint();
}, { passive: false });
// touch pinch zoom
const touches = new Map(); let pinch0 = null;
canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') touches.set(e.pointerId, [e.clientX, e.clientY]); });
canvas.addEventListener('pointermove', e => {
  if (!touches.has(e.pointerId)) return; touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (touches.size === 2) { const [a, b] = [...touches.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0) S.zoom = THREE.MathUtils.clamp(S.zoom * pinch0 / d, 0.3, 2.6); pinch0 = d; }
});
const endTouch = e => { touches.delete(e.pointerId); pinch0 = null; };
canvas.addEventListener('pointerup', endTouch); canvas.addEventListener('pointercancel', endTouch);

window.addEventListener('keydown', e => {
  if (tour.on && !(e.target.closest && e.target.closest('#btn-tour'))) stopTour();
  sound.start(); $('#sound').classList.remove('pulse'); $('#sound').classList.toggle('on', sound.enabled);
  if (e.target.closest && e.target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
  if (e.key === ' ') { e.preventDefault(); toggleExplode(); }
  else if (e.key === 'v' || e.key === 'V' || e.key === 'м' || e.key === 'М') toggleVessels();
  else if (e.key === 'Escape') { if (!$('#aboutbox').hidden) $('#aboutbox').hidden = true; else if (!$('#picker').hidden) closePicker(); else if (S.inspect) exitInspect(); else if (EMBED) closeEye(); else resetOrbit(); }
  else if (e.key === 'ArrowRight') { S.inspect ? step(1) : inspect(PARTS[0].id); }
  else if (e.key === 'ArrowLeft') { S.inspect ? step(-1) : inspect(PARTS[PARTS.length - 1].id); }
  else if (e.key === 'r' || e.key === 'R') resetOrbit();
});
$('#btn-tour').addEventListener('click', () => { buzz(); handDone('drag'); tour.on ? stopTour() : startTour(); });
$('#btn-explode').addEventListener('click', () => { buzz(); handDone('drag'); stopTour(); sound.start(); toggleExplode(); });
$('#btn-vessels').addEventListener('click', () => { buzz(); handDone('drag'); stopTour(); sound.start(); toggleVessels(); });
$('#btn-parts').addEventListener('click', () => { buzz(); handDone('drag'); sound.start(); openPicker(); });
$('#picker-close').addEventListener('click', closePicker);
$('#picker').addEventListener('click', e => { if (e.target.id === 'picker') closePicker(); });
$('#panel .more-btn').addEventListener('click', () => { buzz(); setMore($('#panel .more-btn').getAttribute('aria-expanded') !== 'true'); });
$('#panel-close').addEventListener('click', exitInspect);
$('#prev').addEventListener('click', () => step(-1));
$('#next').addEventListener('click', () => step(1));
function setLang(l, fromParent = false) {
  if (!LANG_OK(l)) return;
  S.lang = l; storeLang(l); applyLang();
  if (EMBED && !fromParent) postParent({ type: 'eye-lang', lang: l });
}
document.querySelectorAll('.lang').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
$('#back').addEventListener('click', closeEye);
// the head atlas can switch the language live: iframe.contentWindow.postMessage({ type: 'eye-lang', lang: 'ru' }, '*')
window.addEventListener('message', e => {
  const d = e.data;
  if (d && (d.type === 'eye-lang' || d.type === 'head-lang') && LANG_OK(d.lang) && d.lang !== S.lang) setLang(d.lang, true);
  if (d && d.type === 'eye-pause') window.__eyePaused = !!d.paused;   // the head atlas preloads this page hidden: no rendering until shown
});
$('#sound').addEventListener('click', () => { const was = sound.started; sound.start(); sound.setEnabled(was ? !sound.enabled : true); $('#sound').classList.remove('pulse'); $('#sound').classList.toggle('on', sound.enabled); });
$('#about').addEventListener('click', () => { $('#aboutbox').hidden = false; });
$('#about-close').addEventListener('click', () => { $('#aboutbox').hidden = true; });
$('#aboutbox').addEventListener('click', e => { if (e.target.id === 'aboutbox') $('#aboutbox').hidden = true; });

// ---------------------------------------------------------------- gaze (the eye follows the pointer with saccades)
const gaze = { cur: new THREE.Quaternion(), goal: new THREE.Quaternion(), nextSaccade: 0, micro: new THREE.Vector2() };
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), FWD = new THREE.Vector3(0, 0, 1);
function updateGaze(dt, t) {
  const active = S.gaze && S.explode < 0.03 && !S.inspect && S.intro >= 0.9 && S.vessels < 0.5;
  if (active && t > gaze.nextSaccade) {
    // look at the point under the pointer, half way to the camera; centre of the screen = looking at you
    raycaster.setFromCamera(S.pointerIn ? S.pointer : new THREE.Vector2(0, 0), camera);
    _v.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, cam.dist * 0.45);
    eyeRig.parent.worldToLocal(_v);
    const dir = _v.normalize();
    const ang = Math.min(FWD.angleTo(dir), THREE.MathUtils.degToRad(24));
    const axis = new THREE.Vector3().crossVectors(FWD, dir).normalize();
    if (axis.lengthSq() > 0.5) gaze.goal.setFromAxisAngle(axis, ang); else gaze.goal.identity();
    gaze.nextSaccade = t + 0.18 + Math.random() * 0.9;
  }
  if (!active) gaze.goal.identity();
  const k = 1 - Math.exp(-dt * (active ? 26 : 3));
  gaze.cur.slerp(gaze.goal, k);
  // fixational micro-tremor
  gaze.micro.set(Math.sin(t * 13.1) * 0.0014 + Math.sin(t * 7.3) * 0.001, Math.cos(t * 11.7) * 0.0012);
  _q.setFromEuler(new THREE.Euler(gaze.micro.y, gaze.micro.x, 0));
  eyeRig.quaternion.copy(gaze.cur).multiply(_q);
}

// ---------------------------------------------------------------- pupil (light reflex from the pointer)
function updatePupil(dt, t) {
  let target = EYE.pupilR.rest;
  if (S.intro < 0.25) target = 3.6;           // dark-adapted at the start, then the light reflex
  else if (S.intro < 1) target = EYE.pupilR.rest - 0.35;
  else if (S.explode < 0.1 && !S.inspect) {
    const c = toScreen(new THREE.Vector3(0, 0, L.corneaApexZ).applyMatrix4(eyeRig.matrixWorld));
    const d = S.pointerIn ? Math.hypot(S.pointerPx.x - c[0], S.pointerPx.y - c[1]) / innerHeight : 1;
    const light = 1 - THREE.MathUtils.smoothstep(d, 0.04, 0.55);
    target = THREE.MathUtils.lerp(EYE.pupilR.rest + 0.9, EYE.pupilR.min + 0.25, light);
    stage.lights.cursor.intensity = light * 9;
    const wp = new THREE.Vector3(S.pointer.x, S.pointer.y, 0.5).unproject(camera);
    stage.lights.cursor.position.lerp(wp, 0.3);
  } else stage.lights.cursor.intensity *= 0.9;
  if (Q.has('pupil')) target = +Q.get('pupil');
  target += Math.sin(t * 0.9) * 0.05 + Math.sin(t * 2.3) * 0.025;   // hippus
  const tau = target < S.pupil ? 0.28 : 0.9;                        // constriction faster than dilation
  S.pupil += (target - S.pupil) * (1 - Math.exp(-dt / tau));
}

// ---------------------------------------------------------------- frame
// frame timer (performance.now based; THREE.Clock is deprecated in r186)
const clock = { last: performance.now(), getDelta() { const n = performance.now(), d = (n - this.last) / 1000; this.last = n; return d; } };
let inspGlow = 0;
const frame = { time: 0, dt: 0, explode: 0, vessels: 0, pupilR: 1.9, camera, ghost: 0, highlight: 0, inspect: false };
const tmp = [0, 0, 0];
let lastExplode = S.explode;
function tick() {
  if (window.__eyePaused) { clock.getDelta(); requestAnimationFrame(tick); return; }
  const dt = Math.min(clock.getDelta(), 1 / 20);
  S.time += dt; const t = S.fixedTime != null ? S.fixedTime : S.time;
  if (S.intro < 1) S.intro = Math.min(1, S.intro + dt / INTRO_S);
  if (S.intro > 0.3 && !Q.has('nointro') && !EMBED) captionOnce('capIntro1', 1700);
  if (S.intro >= 1 && S.time > (EMBED ? 2.2 : 4.6) && !Q.has('nointro') && S.explode < 0.1) captionOnce('capIntro2', EMBED ? 2200 : 2800);
  if (S.explode > 0.97 && S.vessels < 0.3 && !S.inspect) captionOnce('capApart', 2600, 'capApartSub');
  if (S.vessels > 0.9 && !S.inspect) captionOnce('capVessels', 2800, 'capVesselsSub');
  if (S.inspect && capEl.classList.contains('show')) capEl.classList.remove('show');
  if (S.intro >= 1 && !document.body.classList.contains('ready')) document.body.classList.add('ready');
  document.body.classList.toggle('show-hint', !S.inspect && S.intro >= 1 && !tour.on);
  // snap near the ends after idle scrolling
  if (performance.now() - S.lastWheel > 700) { if (S.explodeTarget < 0.06) S.explodeTarget = 0; if (S.explodeTarget > 0.94) S.explodeTarget = 1; }
  S.explode += (S.explodeTarget - S.explode) * (1 - Math.exp(-dt * 2.6));
  if (Math.abs(S.explodeTarget - S.explode) < 1e-4) S.explode = S.explodeTarget;
  S.explodeVel = (S.explode - lastExplode) / Math.max(dt, 1e-3); lastExplode = S.explode;
  S.vessels += (S.vesselsTarget - S.vessels) * (1 - Math.exp(-dt * 2.2));
  document.body.classList.toggle('exploded', S.explode > 0.8 && S.vessels < 0.5);

  tickTour(dt);
  updateGaze(dt, t);
  updatePupil(dt, t);
  if (window.__eye._pupilShade) window.__eye._pupilShade.visible = S.explode < 0.035 && S.vessels < 0.08 && !S.inspect;
  if (pickDirty) pick();

  inspGlow += ((S.inspect && PART_BY_ID[S.inspect]?.group === 'vessel' ? 0.75 : 0) - inspGlow) * (1 - Math.exp(-dt * 3));
  Object.assign(frame, { time: t, dt, explode: S.explode, vessels: Math.max(S.vessels, inspGlow), pupilR: S.pupil, inspect: !!S.inspect });
  const hoverId = S.hover;
  for (const p of parts) {
    explodeVector(p.id, S.explode, tmp);
    p.object.position.set(p.base.x + tmp[0], p.base.y + tmp[1], p.base.z + tmp[2]);
    const g = targetGhost(p);
    p.ghost += (g - p.ghost) * (1 - Math.exp(-dt * 5));
    if (Math.abs(g - p.ghost) < 0.002) p.ghost = g;
    const h = (hoverId && (hoverId === p.id) && !S.inspect) ? 0.32 : 0;   // subtle: a hint, not a repaint
    p.highlight += (h - p.highlight) * (1 - Math.exp(-dt * 10));
    if (p.setGhost) p.setGhost(p.ghost, p.highlight); else applyGhost(p.object, p.ghost, p.highlight);
    frame.ghost = p.ghost; frame.highlight = p.highlight;
    try { p.update?.(frame); } catch (e) { if (!p._warned) { console.error('[eye] update failed', p.id, e); p._warned = true; } }
  }
  // no heartbeat modulation of bloom: a whole-frame brightness pulse reads as flicker (the vessels themselves still carry the flow)
  stage.bloom.strength = 0.22 + S.vessels * 0.32;
  stage.bloom.threshold = 0.93 - S.vessels * 0.28;
  stage.bloom.radius = 0.5 + S.vessels * 0.2;
  updateCamera(dt);
  eyeRig.updateMatrixWorld(true);
  updateLabels();
  sound.update(dt, { explodeSpeed: S.explodeVel, vessels: S.vessels });
  stage.render(t);
  if (flick.on) flick.sample();
  if (!window.__eye.ready) { window.__eye.ready = true; }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- flicker probe (QA): mean |ΔY| between consecutive rendered frames
// Regions are [x, y, w, h] in CSS px; luminance Y = 0.2126R + 0.7152G + 0.0722B on the 0–255 scale. Read right after render,
// in the same task, so the drawing buffer is still valid without preserveDrawingBuffer.
const flick = {
  on: false, n: 0, left: 0, regions: [], prev: [], sums: [], maxs: [], resolve: null, c2: null,
  start(frames, regions) {
    this.regions = regions; this.left = frames + 1; this.n = 0; this.prev = regions.map(() => null); this.sums = regions.map(() => 0); this.maxs = regions.map(() => 0);
    this.c2 = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    this.on = true; return new Promise(r => { this.resolve = r; });
  },
  sample() {
    const dpr = renderer.getPixelRatio();
    this.regions.forEach((rg, i) => {
      const [x, y, w, h] = rg.map(v => Math.round(v * dpr));
      this.c2.canvas.width = w; this.c2.canvas.height = h;
      this.c2.drawImage(canvas, x, y, w, h, 0, 0, w, h);
      const d = this.c2.getImageData(0, 0, w, h).data, Y = new Float32Array(w * h);
      for (let k = 0, j = 0; k < d.length; k += 4, j++) Y[j] = 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
      const p = this.prev[i];
      if (p) { let s = 0; for (let j = 0; j < Y.length; j++) s += Math.abs(Y[j] - p[j]); const m = s / Y.length; this.sums[i] += m; this.maxs[i] = Math.max(this.maxs[i], m); }
      this.prev[i] = Y;
    });
    this.n++;
    if (--this.left <= 0) { this.on = false; const f = this.n - 1; this.resolve(this.regions.map((rg, i) => ({ region: rg, meanDY: +(this.sums[i] / f).toFixed(3), maxDY: +this.maxs[i].toFixed(3), frames: f }))); }
  },
};

// ---------------------------------------------------------------- debug / automation API
window.__eye = {
  ready: false, get _gaze() { return gaze; },
  set(o = {}) {
    if ('lang' in o) { S.lang = o.lang; applyLang(); }
    if ('close' in o && o.close) closeEye();
    if ('intro' in o) S.intro = o.intro;
    if ('explode' in o) { S.explodeTarget = o.explode; if (o.instant) S.explode = o.explode; S.intro = 1; }
    if ('vessels' in o) { S.vesselsTarget = o.vessels; if (o.instant) S.vessels = o.vessels; }
    if ('inspect' in o) { o.inspect ? inspect(o.inspect) : exitInspect(); }
    if ('yawOff' in o) S.yawOff = o.yawOff; if ('pitchOff' in o) S.pitchOff = o.pitchOff; if ('zoom' in o) S.zoom = o.zoom;
    if ('gaze' in o) S.gaze = o.gaze;
    if ('pointer' in o) { S.pointerIn = true; S.pointerPx.set(o.pointer[0], o.pointer[1]); S.pointer.set(o.pointer[0] / innerWidth * 2 - 1, -(o.pointer[1] / innerHeight) * 2 + 1); pickDirty = true; }
    updateButtons(); updateHint();
    return true;
  },
  _dbg() { return { cam: { t: cam.target.toArray().map(v => +v.toFixed(2)), yaw: +cam.yaw.toFixed(2), pitch: +cam.pitch.toFixed(2), dist: +cam.dist.toFixed(1) }, ghosts: Object.fromEntries(parts.map(p => [p.id, +p.ghost.toFixed(2)])), focus: S.inspect && partById[S.inspect] ? (f => ({ c: f.center.toArray().map(v => +v.toFixed(2)), r: f.radius }))(partById[S.inspect].focusWorld()) : null }; },
  projectPart(id) { const p = partById[id]; if (!p) return null; const s = toScreen(p.anchorWorld()); return [Math.round(s[0]), Math.round(s[1])]; },
  tour(on = true) { on ? startTour() : stopTour(); return tour.on; },
  measureFlicker(frames = 60, regions = [[40, 120, 360, 300], [innerWidth / 2 - 180, innerHeight / 2 - 180, 360, 360]]) { return flick.start(frames, regions); },
  openPicker() { openPicker(); return !$('#picker').hidden; },
  state() { return { embed: EMBED, kiosk: KIOSK, picker: !$('#picker').hidden, hand: $('#hand').dataset.phase || null, tour: tour.on, tourT: +tour.t.toFixed(1), explode: S.explode, vessels: S.vessels, inspect: S.inspect, hover: S.hover, pupil: S.pupil, intro: S.intro, lang: S.lang, parts: parts.map(p => p.id), missing: PARTS.filter(p => !partById[p.id]).map(p => p.id) }; },
  info() {
    let tris = 0; scene.traverse(o => { if (o.isMesh && o.geometry && o.visible) { const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } });
    return { tris: Math.round(tris), calls: renderer.info.render.calls, programs: renderer.info.programs?.length };
  },
};

// ---------------------------------------------------------------- boot
buildLabels();
applyLang();
if (!('ontouchstart' in window)) $('#sound').classList.add('pulse');
await loadAll();
window.__eye.timing = { loaded: Math.round(performance.now()) };
// The pupil of a living eye looks black because almost no light comes back out of it.
// A dark shade just behind the lens stops the (orange) retina showing through while assembled.
const pupilShade = new THREE.Mesh(new THREE.CircleGeometry(EYE.pupilR.max + 0.25, 64), new THREE.MeshBasicMaterial({ color: 0x010101, side: THREE.DoubleSide }));
pupilShade.position.z = L.lensAntZ - 0.3;   // just behind the pupil margin: the lens behind it is not seen in a living eye either
eyeRig.add(pupilShade);
window.__eye._pupilShade = pupilShade;
eyeRig.updateMatrixWorld(true);
updateCamera(1);
// Pre-compile shaders (opaque and ghosted variants) so the intro does not stutter; never wait more than a few seconds.
const within = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
try {
  await within(renderer.compileAsync(scene, camera), 3500);
  for (const p of parts) applyGhost(p.object, 0.5, 0);
  await within(renderer.compileAsync(scene, camera), 2500);
  for (const p of parts) applyGhost(p.object, 0, 0);
} catch (e) { console.warn('[eye] precompile', e); }
window.__eye.timing.compiled = Math.round(performance.now());
$('#loader').style.opacity = '0';
if (Q.get('inspect')) inspect(Q.get('inspect'));
if (S.explodeTarget > 0) S.intro = 1;
if (Q.has('tour')) setTimeout(startTour, Q.has('nointro') ? 300 : 4200);
clock.getDelta();
requestAnimationFrame(tick);
if (EMBED) { try { window.focus(); } catch {} postParent({ type: 'eye-ready', lang: S.lang }); }
