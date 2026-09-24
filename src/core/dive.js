// Organ deep dive: an isolated, data-driven stage for one organ inside the head scene.
//   content/deepdives/index.json : [{id, title:{kk,ru,en}, trigger:[ids], iframe?:'eye/index.html'}]
//   content/deepdives/<id>.json  : {id, title, parts:[ids], explode:{id:[x,y,z]}, pivot?:{id:[x,y,z]},
//        chapters:[{title:{kk,ru,en}, text:{kk:[…],ru:[…],en:[…]}, highlight:[ids], explode, camera:{yaw,pitch,zoom},
//                   section: 'sagittal'|{axis, offset?}, anim: {type:'pulse'|'rotate'|'oscillate', …} | [ … ]}]}
// Everything else dissolves away; parts stay where they are in the head and the camera flies to them (so the
// organ keeps its true anatomical relations); explode moves parts along per-node vectors through a per-structure
// rigid-offset texture read by the shared shader patch (so picking, caps and ghosts follow the parts).
import * as THREE from 'three';

const base = new URL('../content/deepdives/', import.meta.url);

// Content schema uses {type:'pulse-path'|'oscillate'|'rotate', ids:[…], axis, amp(rotate: radians)}; the stage uses
// {type:'pulse', path} / {type:'oscillate'|'rotate', id, …, deg}. Accept both.
function normAnims(list) {
  const out = [];
  for (const a of list) {
    const ids = Array.isArray(a.ids) ? a.ids : (a.id ? [a.id] : []);
    if (a.type === 'pulse-path' || a.type === 'pulse') { out.push({ ...a, type: 'pulse', path: Array.isArray(a.path) && a.path.length ? a.path : ids }); continue; }
    if (a.type === 'rotate' || a.type === 'oscillate') {
      for (const id of ids) {
        const b = { ...a, id };
        if (a.type === 'rotate' && b.deg == null && b.amp != null) b.deg = (+b.amp) * 180 / Math.PI;
        out.push(b);
      }
    }
  }
  return out;
}

async function getJSON(url) { try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; } }
const L = (o, lang) => (o && typeof o === 'object' ? (o[lang] || o.en || o.kk || o.ru || '') : (typeof o === 'string' ? o : ''));
const arr = (a) => (Array.isArray(a) ? a : a ? [a] : []);

export function createDive(ctx) {
  const { structs, M, rig, camera, U } = ctx;
  const $ = (s) => document.querySelector(s);
  const el = $('#dive'), frameEl = $('#diveframe');
  const labelsEl = el.querySelector('.dive-labels'), leadersEl = el.querySelector('.dive-leaders');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const D = {
    index: [], active: null, data: null, parts: [], partSet: new Set(), sids: [], centroid: new THREE.Vector3(), radius: 0.03,
    chapter: 0, core: [], encloser: new Set(), fit: new THREE.Vector3(), fitR: 0.03, labelFor: new Map(), expanded: false, explode: 0, explodeTarget: 0, hl: null, anims: [], animHl: null, sel: null, orbit: 0, cam: { yaw: 0, pitch: 0.12, zoom: 1 },
    dirs: new Map(), labels: [], frame: false, dirtyOffsets: false,
  };

  async function loadIndex() {
    const idx = await getJSON(new URL('index.json', base));
    D.index = Array.isArray(idx) ? idx.filter(e => e && typeof e.id === 'string') : [];
    return D.index;
  }
  const entryFor = (structId) => D.index.find(e => arr(e.trigger).includes(structId)) || null;

  // ------------------------------------------------------------------ open / close
  async function open(id, chapter = 0) {
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id)) return false;
    const entry = D.index.find(e => e.id === id) || { id };
    if (entry.iframe) return openFrame(entry);
    const data = await getJSON(new URL(`${id}.json`, base));
    if (!data || !Array.isArray(data.parts)) { console.warn('[head] deep dive not found', id); return false; }
    ctx.beforeEnter();
    D.active = id; D.data = data; D.sel = null;
    D.parts = data.parts.map(p => structs.get(p)).filter(Boolean);
    D.partSet = new Set(D.parts.map(s => s.id));
    D.sids = D.parts.flatMap(s => s.sids);
    // organ frame
    // frame on the organ's solid parts; long nerves/vessels that run away from it do not set the scale
    const core = D.parts.filter(st => !['nerve', 'artery', 'vein'].includes(st.cls));
    D.core = core;

    const box = new THREE.Box3(); for (const st of (core.length ? core : D.parts)) box.union(st.box);
    // paired organs far apart (the two ears): show one side only, facing the camera
    const bl = new THREE.Box3(), br = new THREE.Box3();
    for (const st of core.length ? core : D.parts) for (const sid of st.sids) { const r = M.nodes[sid]; if (r.side === 'L') bl.union(r.box); else if (r.side === 'R') br.union(r.box); }
    const hasMid = (core.length ? core : D.parts).some(st => st.sids.some(sid => M.nodes[sid].side === 'M'));
    D.oneSide = data.side === 'L' ? 'L' : data.side === 'both' ? null : (!hasMid && !bl.isEmpty() && !br.isEmpty() && (bl.min.x - br.max.x) > 0.01 ? 'L' : null);
    if (D.oneSide) { const keep = new THREE.Box3(); for (const st of core.length ? core : D.parts) for (const sid of st.sids) if (M.nodes[sid].side !== 'R') keep.union(M.nodes[sid].box); if (!keep.isEmpty()) box.copy(keep); }
    box.getCenter(D.centroid); D.radius = Math.max(0.012, box.getSize(new THREE.Vector3()).length() / 2);
    // explode vectors (per node; data vectors are for the left/midline node and mirrored for the right)
    D.dirs.clear();
    for (const st of D.parts) for (const sid of st.sids) {
      const rec = M.nodes[sid];
      const given = data.explode && data.explode[st.id];
      let v;
      if (Array.isArray(given) && given.length === 3) { v = new THREE.Vector3(...given); if (rec.side === 'R') v.x = -v.x; }
      else {
        v = rec.center.clone().sub(D.centroid);
        const l = v.length();
        v = l < 1e-5 ? new THREE.Vector3(0, 0, 0) : v.multiplyScalar((D.radius * (0.45 + 0.8 * l / D.radius)) / l);
      }
      D.dirs.set(sid, v);
    }
    buildLabels();
    buildSteps();
    D.fit = D.centroid.clone(); D.fitR = D.radius; D.encloser = new Set();
    el.hidden = false; document.body.classList.add('diving'); ctx.section.outline.visible = false;
    applyLang();
    setChapter(Math.max(0, Math.min((data.chapters || []).length - 1, chapter | 0)), true);
    D.orbit = 0;
    ctx.sound?.swell();
    ctx.dirty();
    return true;
  }
  function close() {
    if (D.frame) return closeFrame();
    if (!D.active) return;
    D.active = null; D.data = null; D.parts = []; D.partSet = new Set(); D.anims = []; D.hl = null; D.animHl = null; D.explode = D.explodeTarget = 0;
    selectPart(null);
    resetOffsets();
    el.hidden = true; document.body.classList.remove('diving'); ctx.section.outline.visible = true;
    labelsEl.replaceChildren(); leadersEl.replaceChildren(); D.labels = [];
    ctx.setSection(null);
    ctx.afterExit();
    ctx.dirty();
  }
  function openFrame(entry) {
    ctx.beforeEnter();
    D.frame = true;
    const f = frameEl.querySelector('iframe');
    const url = new URL(entry.iframe, new URL('../../', import.meta.url));
    if (url.origin !== location.origin) { console.warn('[head] deep-dive iframe must be same-origin'); return false; }
    url.searchParams.set('embed', '1'); url.searchParams.set('lang', ctx.lang());
    f.src = url.href;
    frameEl.hidden = false; document.body.classList.add('diving-frame');
    D.active = entry.id;
    return true;
  }
  function closeFrame() {
    D.frame = false; D.active = null;
    const f = frameEl.querySelector('iframe'); f.src = 'about:blank';
    frameEl.hidden = true; document.body.classList.remove('diving-frame');
    ctx.afterExit();
  }
  window.addEventListener('message', (e) => { if (D.frame && (e.data === 'close' || e.data?.type === 'close')) closeFrame(); });
  $('#diveframe-back').addEventListener('click', closeFrame);
  $('#dive-back').addEventListener('click', close);

  // ------------------------------------------------------------------ chapters
  const stepsEl = el.querySelector('.dive-steps');
  function buildSteps() {
    stepsEl.replaceChildren();
    (D.data.chapters || []).forEach((ch, i) => {
      const li = document.createElement('li'); li.dataset.i = i;
      const b = document.createElement('b'); b.textContent = String(i + 1);
      const s = document.createElement('span');
      li.append(b, s); li.addEventListener('click', () => setChapter(i));
      stepsEl.append(li);
    });
  }
  function setChapter(i, first = false) {
    const chs = D.data.chapters || [];
    if (!chs.length) { D.hl = null; D.anims = []; return; }
    D.chapter = Math.max(0, Math.min(chs.length - 1, i));
    const ch = chs[D.chapter];
    const hl = arr(ch.highlight).filter(id => D.partSet.has(id));
    D.hl = hl.length ? new Set(hl) : null;
    D.encloser = new Set();
    if (D.hl) {
      const sideBox = (st) => { const b = new THREE.Box3(); for (const sid of st.sids) if (!(D.oneSide && M.nodes[sid].side === 'R')) b.union(M.nodes[sid].box); return b; };
      const hb = new THREE.Box3(); for (const id of D.hl) hb.union(sideBox(structs.get(id)));
      const hr = hb.getSize(new THREE.Vector3()).length();
      for (const st of D.parts) if (!D.hl.has(st.id)) { const b = sideBox(st); if (b.isEmpty()) continue; const r = b.getSize(new THREE.Vector3()).length(); if (r > 1.8 * hr && b.intersectsBox(hb)) D.encloser.add(st.id); }
    }
    if (typeof ch.explode === 'number') D.explodeTarget = Math.max(0, Math.min(1, ch.explode));
    else if (first) D.explodeTarget = 0;
    D.cam = { yaw: ch.camera?.yaw ?? 0, pitch: ch.camera?.pitch ?? 0.12, zoom: ch.camera?.zoom ?? 1 };
    ctx.resetView();
    // section plane through the organ centroid
    const sec = typeof ch.section === 'string' ? { axis: ch.section } : ch.section;
    if (sec && sec.axis) {
      ctx.setSection(sec.axis);
      const e = { sagittal: 'x', axial: 'y', coronal: 'z' }[sec.axis];
      if (e) ctx.section.setOffset(typeof sec.offset === 'number' ? sec.offset : D.centroid[e] - ctx.CENTER[e]);
    } else ctx.setSection(null);
    D.anims = normAnims(arr(ch.anim).filter(a => a && a.type));
    stepsEl.querySelectorAll('li').forEach(li => li.classList.toggle('on', +li.dataset.i === D.chapter));
    fillChapter();
    if (!first) ctx.sound?.tick();
    ctx.dirty();
  }
  function fillChapter() {
    if (!D.data) return;
    const lang = ctx.lang(), T = ctx.ui();
    el.querySelector('.eyebrow').textContent = L(D.data.title, lang);
    const ch = (D.data.chapters || [])[D.chapter];
    el.querySelector('.ct').textContent = ch ? L(ch.title, lang) : '';
    const cx = el.querySelector('.cx'); cx.replaceChildren();
    const paras = (ch ? arr(ch.text && typeof ch.text === 'object' && !Array.isArray(ch.text) ? (ch.text[lang] || ch.text.en || ch.text.kk) : ch.text) : []).filter(p => typeof p === 'string');
    paras.forEach((p, i) => { const e = document.createElement('p'); e.textContent = p; if (i > 0) e.className = 'rest'; cx.append(e); });
    const more = el.querySelector('.more');
    more.hidden = paras.length < 2; D.expanded = false; el.querySelector('.dive-col').classList.remove('open');
    more.textContent = T.dive?.more || 'Read more';
    const fl = el.querySelector('.dfacts'); fl.replaceChildren();
    for (const f of arr(ch?.facts)) {
      if (!f || typeof f !== 'object') continue;
      const txt = (typeof f[lang] === 'string' && f[lang]) || f.en || ''; if (!txt) continue;
      const li = document.createElement('li'); const t = document.createElement('div'); t.className = 'ft'; t.textContent = txt; li.append(t);
      const src = ctx.source(f.src);
      if (src) { const sEl = document.createElement('div'); sEl.className = 'fs mono'; if (src.url) { const a = document.createElement('a'); a.href = src.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = src.title || src.url; sEl.append(a); } else sEl.textContent = src.title; li.append(sEl); }
      li.addEventListener('click', (e) => { if (e.target.tagName !== 'A') li.classList.toggle('open'); });
      fl.append(li);
    }
    stepsEl.querySelectorAll('li').forEach(li => { const c = D.data.chapters[+li.dataset.i]; li.querySelector('span').textContent = L(c.title, lang); li.title = L(c.title, lang); });
  }
  el.querySelector('.more').addEventListener('click', () => {
    D.expanded = !D.expanded; el.querySelector('.dive-col').classList.toggle('open', D.expanded);
    const T = ctx.ui(); el.querySelector('.more').textContent = D.expanded ? (T.dive?.less || 'Less') : (T.dive?.more || 'Read more');
  });

  // ------------------------------------------------------------------ labels: only the chapter's focus (≤ 7, ≤ 12 when
  // exploded), largest first, in two tidy columns beside the organ; leader lines leave the organ sideways.
  function buildLabels() { labelsEl.replaceChildren(); leadersEl.replaceChildren(); D.labels = []; D.labelFor = new Map(); }
  function labelOf(st) {
    let L_ = D.labelFor.get(st.id);
    if (!L_) {
      const lab = document.createElement('div'); lab.className = 'lab';
      const line = document.createElementNS(SVGNS, 'polyline'); const dot = document.createElementNS(SVGNS, 'circle'); dot.setAttribute('r', '1.8');
      leadersEl.append(line, dot); labelsEl.append(lab);
      L_ = { st, lab, line, dot, w: 0 }; D.labelFor.set(st.id, L_); D.labels.push(L_);
      lab.textContent = ctx.name(st.id);
    }
    return L_;
  }
  function labelSet() {
    const cap = innerWidth <= 760 ? 0 : D.explode > 0.5 ? 12 : 7;   // phones: no labels, tap a part for its card
    let pool = D.hl ? D.parts.filter(s => D.hl.has(s.id)) : D.parts.slice();
    pool.sort((a, b) => b.box.getSize(_c).length() - a.box.getSize(_c).length());
    const out = pool.slice(0, cap);
    if (D.sel && !out.some(s => s.id === D.sel)) out.push(structs.get(D.sel));
    return new Set(out);
  }
  const _v = new THREE.Vector3(), _c = new THREE.Vector3();
  const toScreen = (v) => { _v.copy(v).applyMatrix4(rig.matrixWorld).project(camera); return [(_v.x * 0.5 + 0.5) * innerWidth, (-_v.y * 0.5 + 0.5) * innerHeight, _v.z]; };
  function updateLabels() {
    const show = labelSet();
    // screen rectangle of the focus box (current explode)
    const fb = focusBox().union(organBox()), cs = [];
    for (const x of [fb.min.x, fb.max.x]) for (const y of [fb.min.y, fb.max.y]) for (const z of [fb.min.z, fb.max.z]) cs.push(toScreen(_c.set(x, y, z)));
    const rx0 = Math.min(...cs.map(c => c[0])), rx1 = Math.max(...cs.map(c => c[0])), cy = (Math.min(...cs.map(c => c[1])) + Math.max(...cs.map(c => c[1]))) / 2, cx = (rx0 + rx1) / 2;
    const textEdge = (el.querySelector('.dive-col').getBoundingClientRect().right || 480) + 24;
    const allowLeft = rx0 - 36 - 190 > textEdge;
    const colL = Math.max(textEdge + 190, rx0 - 36), colR = Math.min(innerWidth - (document.body.classList.contains('dive-card') ? 450 : 24), rx1 + 36);
    const placed = [];
    for (const L_ of D.labels) { if (!show.has(L_.st)) { L_.lab.style.opacity = '0'; L_.line.style.opacity = L_.dot.style.opacity = 0; } }
    for (const st of show) {
      if (!st) continue;
      const L_ = labelOf(st);
      let best = null, bd = Infinity;
      for (const sid of st.sids) {
        if (D.oneSide && M.nodes[sid].side === 'R') continue;
        const p = M.nodes[sid].center.clone().add(currentOffset(sid));
        const d = p.clone().applyMatrix4(rig.matrixWorld).distanceTo(camera.position);
        if (d < bd) { bd = d; best = p; }
      }
      if (!best) continue;
      const [x, y, z] = toScreen(best);
      if (z > 1) { L_.lab.style.opacity = '0'; L_.line.style.opacity = L_.dot.style.opacity = 0; continue; }
      const left = allowLeft && x < cx;
      L_.w ||= L_.lab.getBoundingClientRect().width || 100;
      placed.push({ L_, x, y, left, ly: y });
    }
    for (const side of [true, false]) {
      const g = placed.filter(p => p.left === side).sort((a, b) => a.y - b.y);
      for (let i = 1; i < g.length; i++) if (g[i].ly - g[i - 1].ly < 22) g[i].ly = g[i - 1].ly + 22;
      if (g.length > 1) { const span = g[g.length - 1].ly - g[0].ly, mean = g.reduce((a, p) => a + p.y, 0) / g.length; const top = Math.max(70, Math.min(mean - span / 2, innerHeight - 90 - span)); const d = top - g[0].ly; for (const p of g) p.ly += d; }
    }
    const wR = Math.max(0, ...placed.filter(p => !p.left).map(p => p.L_.w));
    const colR2 = Math.min(colR, innerWidth - (document.body.classList.contains('dive-card') ? 450 : 24) - wR - 12);
    for (const P of placed) {
      const colX = P.left ? colL : Math.max(colR2, P.x + 16);
      const elbow = P.left ? Math.min(P.x - 10, colX + 14) : Math.max(P.x + 10, colX - 14);
      P.L_.lab.style.opacity = ''; P.L_.line.style.opacity = P.L_.dot.style.opacity = 0.85;
      P.L_.lab.classList.toggle('hot', D.sel === P.L_.st.id);
      P.L_.lab.style.transform = `translate(${colX + (P.left ? -6 : 6)}px, ${P.ly - 8}px) translateX(${P.left ? '-100%' : '0'})`;
      P.L_.line.setAttribute('points', `${P.x},${P.y} ${elbow},${P.ly} ${colX},${P.ly}`);
      P.L_.dot.setAttribute('cx', P.x); P.L_.dot.setAttribute('cy', P.y);
    }
  }

  // ------------------------------------------------------------------ per-structure offsets (explode + animation)
  const TEXW = M.offsetTex.image.width;
  function writeOffset(sid, t, q, p, on) {
    const x = sid % TEXW, y = Math.floor(sid / TEXW), A = M.offsetArr;
    const o0 = ((y * 3) * TEXW + x) * 4, o1 = ((y * 3 + 1) * TEXW + x) * 4, o2 = ((y * 3 + 2) * TEXW + x) * 4;
    A[o0] = t.x; A[o0 + 1] = t.y; A[o0 + 2] = t.z; A[o0 + 3] = on ? 1 : 0;
    A[o1] = q.x; A[o1 + 1] = q.y; A[o1 + 2] = q.z; A[o1 + 3] = q.w;
    A[o2] = p.x; A[o2 + 1] = p.y; A[o2 + 2] = p.z;
  }
  function resetOffsets() {
    const I = new THREE.Quaternion(), Z = new THREE.Vector3();
    for (let sid = 0; sid < M.nodes.length; sid++) writeOffset(sid, Z, I, Z, false);
    M.offsetTex.needsUpdate = true;
  }
  const _t = new THREE.Vector3(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _ax = new THREE.Vector3();
  function updateOffsets(t) {
    const rot = new Map(), osc = new Map(); let pulse = null;
    for (const a of D.anims) {
      const period = Math.max(0.2, +a.period || 2), ph = Math.sin(2 * Math.PI * t / period);
      if (a.type === 'rotate' && structs.has(a.id)) rot.set(a.id, { axis: _ax.fromArray(arr(a.axis).length === 3 ? a.axis : [1, 0, 0]).clone().normalize(), ang: THREE.MathUtils.degToRad(+a.deg || 10) * ph, pivot: Array.isArray(a.pivot) ? new THREE.Vector3(...a.pivot) : (D.data.pivot?.[a.id] ? new THREE.Vector3(...D.data.pivot[a.id]) : structs.get(a.id).center.clone()) });
      if (a.type === 'oscillate' && structs.has(a.id)) osc.set(a.id, new THREE.Vector3().fromArray(arr(a.axis).length === 3 ? a.axis : [0, 1, 0]).normalize().multiplyScalar((+a.amp || 0.002) * ph));
      if (a.type === 'pulse') { const path = arr(a.path).filter(id => D.partSet.has(id)); if (path.length) { const k = Math.floor((t / period) * path.length) % path.length; pulse = { path, on: path[k] }; } }
    }
    for (const st of D.parts) {
      const r = rot.get(st.id), o = osc.get(st.id);
      for (const sid of st.sids) {
        _t.copy(D.dirs.get(sid) || _p.set(0, 0, 0)).multiplyScalar(D.explode);
        if (o) { const oo = o.clone(); if (M.nodes[sid].side === 'R') oo.x = -oo.x; _t.add(oo); }
        if (r) { const ax = r.axis.clone(), pv = r.pivot.clone(); if (M.nodes[sid].side === 'R') { ax.y = -ax.y; ax.z = -ax.z; pv.x = -pv.x; } _q.setFromAxisAngle(ax, r.ang); _p.copy(pv); }
        else { _q.identity(); _p.set(0, 0, 0); }
        writeOffset(sid, _t, _q, _p, true);
      }
    }
    M.offsetTex.needsUpdate = true;
    const prev = D.animHl?.on;
    D.animHl = pulse;
    return pulse && pulse.on !== prev;
  }

  function currentOffset(sid) { return (D.dirs.get(sid) || _p.set(0, 0, 0)).clone().multiplyScalar(D.explode); }
  function organBox() {   // whole (solid) organ at the current explode, for label columns
    const b = new THREE.Box3();
    for (const st of (D.core.length ? D.core : D.parts)) for (const sid of st.sids) { if (D.oneSide && M.nodes[sid].side === 'R') continue; const nb = M.nodes[sid].box.clone(); nb.translate(currentOffset(sid)); b.union(nb); }
    return b;
  }
  // parts that frame the camera: the chapter highlight (or all solid parts), at their exploded positions
  function focusBox() {
    const box = new THREE.Box3();
    const list = D.hl ? D.parts.filter(s => D.hl.has(s.id)) : (D.core.length ? D.core : D.parts);
    for (const st of list) for (const sid of st.sids) { if (D.oneSide && M.nodes[sid].side === 'R') continue; const b = M.nodes[sid].box.clone(); b.translate(currentOffset(sid)); box.union(b); }
    if (box.isEmpty()) box.setFromCenterAndSize(D.centroid, new THREE.Vector3(0.05, 0.05, 0.05));
    return box;
  }

  // ------------------------------------------------------------------ hooks used by main.js
  function targetFor(rec, st) {
    if (!D.active || D.frame) return null;
    if (!st || !D.partSet.has(st.id) || (D.oneSide && rec.side === 'R')) return { own: 1, force: 0, ghost: 0, hl: 0 };
    let ghost = 0, hl = 0;
    if (D.hl && !D.hl.has(st.id)) {
      // context parts stay readable: dimmed solid; parts that would hide the focus (much larger enclosing
      // structures, e.g. the temporal bone around the ossicles) turn to glass
      if (D.encloser.has(st.id)) ghost = 1; else hl = -0.8;
    } else if (D.hl) hl = 0.12;
    if (D.animHl) { if (D.animHl.on === st.id) { hl = 0.9; ghost = 0; } else if (D.animHl.path.includes(st.id)) hl = Math.max(hl, 0.1); }
    if (D.sel === st.id) { hl = 0.45; ghost = 0; }
    return { own: 0, force: 1, ghost, hl };
  }
  function cameraPose(want, fovDeg, dt, dragging) {
    if (!D.active || D.frame) return false;
    if (!dragging) D.orbit += dt * 0.05;
    const fb = focusBox(), c = fb.getCenter(new THREE.Vector3()), sz = fb.getSize(new THREE.Vector3());
    D.fit.lerp(c, 1 - Math.exp(-dt * 3)); D.fitR += (Math.max(0.006, 0.5 * Math.max(sz.y, Math.hypot(sz.x, sz.z) * 0.85)) - D.fitR) * (1 - Math.exp(-dt * 3));
    // the focus fills ~60 % of the stage height; content zoom is only a gentle hint
    const zoomHint = Math.min(1.15, Math.max(0.9, 1 / (D.cam.zoom || 1) ** 0.15));
    const tanH = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
    const distFocus = D.fitR / (0.52 * tanH), distAll = organBox().getSize(new THREE.Vector3()).length() * 0.5 / (0.85 * tanH);
    want.dist = Math.max(0.07, distFocus, Math.min(distAll, distFocus * 2.2)) * zoomHint;
    if (innerWidth / innerHeight < 0.9) want.dist *= 1.55;   // portrait: the organ lives in the upper half   // the focus fills ~60 %, the whole organ stays ≤ ~stage height
    // when the whole organ sets the distance, drift the aim toward the organ centre so it is not cut by the frame
    const k = Math.min(1, Math.max(0, (distAll / Math.max(distFocus, 1e-4) - 1) * 1.5));
    want.target.copy(D.fit).lerp(D.centroid, k).applyMatrix4(rig.matrixWorld);
    want.yaw = (D.oneSide ? 0.1 : -0.62) + D.cam.yaw + Math.sin(D.orbit) * 0.3;
    want.pitch = Math.max(-0.35, Math.min(0.6, D.cam.pitch));
    return true;
  }
  function step(dt, t) {
    if (!D.active || D.frame) return false;
    const prev = D.explode;
    D.explode += (D.explodeTarget - D.explode) * (1 - Math.exp(-dt * 3.5));
    if (Math.abs(D.explode - D.explodeTarget) < 1e-4) D.explode = D.explodeTarget;
    const slider = $('#dive-x'); if (document.activeElement !== slider) slider.value = D.explodeTarget;
    const pulseChanged = updateOffsets(t);
    updateLabels();
    return pulseChanged || Math.abs(prev - D.explode) > 1e-5 && false;
  }
  function selectPart(id) {
    D.sel = id && D.partSet.has(id) ? id : null;
    document.body.classList.toggle('dive-card', !!D.sel);
    if (D.sel) ctx.fillPanel(D.sel);
    ctx.dirty();
  }
  function stepPart(dir) {
    if (!D.parts.length) return;
    const i = D.parts.findIndex(s => s.id === D.sel);
    selectPart(D.parts[(i + dir + D.parts.length) % D.parts.length].id);
  }
  function applyLang() {
    if (D.frame) { try { frameEl.querySelector('iframe').contentWindow.postMessage({ type: 'eye-lang', lang: ctx.lang() }, location.origin); } catch {} return; }
    if (!D.active) return;
    for (const L_ of D.labels) { L_.lab.textContent = ctx.name(L_.st.id); L_.w = 0; }
    fillChapter();
    if (D.sel) ctx.fillPanel(D.sel);
  }
  $('#dive-x').addEventListener('input', (e) => { D.explodeTarget = +e.target.value; });

  return {
    D, loadIndex, entryFor, open, close, setChapter, targetFor, cameraPose, step, selectPart, stepPart, applyLang,
    get active() { return D.active; }, get frame() { return D.frame; }, get sel() { return D.sel; },
    setExplode(v) { D.explodeTarget = Math.max(0, Math.min(1, v)); },
    get explode() { return D.explode; }, get explodeTarget() { return D.explodeTarget; },
    offsetOf(sid) { const x = sid % TEXW, y = Math.floor(sid / TEXW), o = ((y * 3) * TEXW + x) * 4; return M.offsetArr[o + 3] > 0.5 ? new THREE.Vector3(M.offsetArr[o], M.offsetArr[o + 1], M.offsetArr[o + 2]) : null; },
    state() { return { dive: D.active, frame: D.frame, chapter: D.chapter, chapters: D.data ? (D.data.chapters || []).length : 0, explode: +D.explode.toFixed(3), sel: D.sel, parts: D.parts.map(s => s.id) }; },
  };
}
