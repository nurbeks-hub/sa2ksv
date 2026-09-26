// Opening: a crisp 4K photograph of the two people with a real parallax camera push (people and backdrop on separate
// layers) → at their faces the photo turns into the two live 3D heads → the visitor picks whose head to enter → the
// chosen head hands over to the atlas. Web: wheel / touch / keys drive it. Kiosk: it plays by itself.
// Test hooks: window.__hero.{state(), set(p), enter('f'|'m'), skip()}.  ?nohero=1 bypasses it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { UI } from '../ui/i18n.js';

const Q = new URLSearchParams(location.search);
const KIOSK = Q.has('kiosk');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ROOT = new URL('../../', import.meta.url).href;
const BASE = ROOT + 'assets/hero/';
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;
const LITE_TEX = Q.get('tex') === 'lite' || (Q.get('tex') !== 'full' && ((IS_TOUCH && Math.min(screen.width, screen.height) < 900) || (navigator.deviceMemory && navigator.deviceMemory <= 4)));

// the two photographs; heads = [centre x / width, centre y / height, head height (hair top → chin) / height]
const PHOTO = {
  land: { bg: 'duo_bg_16x9.webp', fg: 'duo_fg_16x9.webp', w: 3840, h: 2160, heads: { f: [0.599, 0.157, 0.125], m: [0.682, 0.101, 0.137] } },
  port: { bg: 'duo_bg_9x16.webp', fg: 'duo_fg_9x16.webp', w: 2160, h: 3840, heads: { f: [0.535, 0.2096, 0.0964], m: [0.729, 0.168, 0.117] } },
};
const CHIN = { m: 1.484, f: 1.486 };          // atlas chin height (m), for the 3D head's hair-top → chin span
const YAW0 = { f: 0.16, m: -0.1 };            // the photo pose: she turns a little to her left, he to his right

const T = {
  kk: { sub: 'Ішіне үңілейік.', cue: 'Айналдырыңыз', cueTouch: 'Жоғары сырғытыңыз', ask: 'Кімнің басына кіреміз?', f: 'Әйел', m: 'Ер', skip: 'Өткізу' },
  ru: { sub: 'Заглянем внутрь.', cue: 'Прокрутите', cueTouch: 'Проведите вверх', ask: 'В чью голову заглянем?', f: 'Женщина', m: 'Мужчина', skip: 'Пропустить' },
  en: { sub: 'Let’s look inside.', cue: 'Scroll', cueTouch: 'Swipe up', ask: 'Whose head shall we explore?', f: 'Woman', m: 'Man', skip: 'Skip' },
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = t => 1 - Math.pow(1 - t, 4);
const lerp = (a, b, t) => a + (b - a) * t;

export function initHero({ onEnter, onDone, getLang }) {
  const root = document.getElementById('hero');
  if (!root || Q.has('nohero') || Q.has('still') || Q.has('alpha') || Q.get('inspect') || Q.get('dive') || Q.has('nointro')) { onDone?.(null); return null; }

  let orient = innerWidth / innerHeight < 0.9 ? 'port' : 'land';
  root.innerHTML = `
    <div class="hero-stage">
      <div class="hero-photo"><img class="hero-bg" alt="" decoding="async"><img class="hero-fg" alt="" decoding="async"></div>
      <div class="hero-shade"></div>
      <div class="hero-dark"></div>
      <canvas class="hero-3d"></canvas>
      <div class="hero-title">
        <h1 class="hero-h"></h1>
        <p class="hero-sub"></p>
      </div>
      <div class="hero-cue"><span class="hero-cue-line"></span><span class="hero-cue-t"></span></div>
      <div class="hero-choose">
        <p class="hero-ask"></p>
        <button class="hero-pick" data-sex="f"><span class="ring"><i></i><i></i><i></i><i></i></span><span class="lbl"></span></button>
        <button class="hero-pick" data-sex="m"><span class="ring"><i></i><i></i><i></i><i></i></span><span class="lbl"></span></button>
      </div>
      <div class="hero-scan"></div>
      <button class="hero-skip"></button>
      <div class="hero-progress"><i></i></div>
    </div>`;
  document.body.classList.add('hero-on');
  root.hidden = false;
  const $ = s => root.querySelector(s);
  const imgBg = $('.hero-bg'), imgFg = $('.hero-fg'), cvs = $('.hero-3d');
  const picks = [...root.querySelectorAll('.hero-pick')];

  // ------------------------------------------------------------ text
  let textLang = null;
  function applyText() {
    const L = getLang?.() || 'kk', t = T[L] || T.en, u = UI[L] || UI.en;
    if (L === textLang) return;           // the engine re-sets <html lang> while loading: don't restart the title animation
    textLang = L;
    const brand = u.brand, mark = u.brandMark, rest = brand.replace(mark, '').trim();
    $('.hero-h').innerHTML = brand.indexOf(mark) === 0 ? `<mark class="w2">${mark}</mark> <span class="w1">${rest}</span>` : `<span class="w1">${rest}</span> <mark class="w2">${mark}</mark>`;
    $('.hero-sub').textContent = t.sub;
    $('.hero-cue-t').textContent = IS_TOUCH ? t.cueTouch : t.cue;
    $('.hero-ask').textContent = t.ask;
    picks.forEach(b => { b.querySelector('.lbl').textContent = t[b.dataset.sex]; b.setAttribute('aria-label', t[b.dataset.sex]); });
    $('.hero-skip').textContent = t.skip;
    root.lang = L;
  }
  applyText();
  const mo = new MutationObserver(applyText);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  // ------------------------------------------------------------ photo layers
  let ph = PHOTO[orient], photoReady = false;
  function loadPhoto() {
    ph = PHOTO[orient]; photoReady = false; let n = 0;
    const done = () => { if (++n === 2) { photoReady = true; root.classList.add('photo-ready'); layout(); } };
    imgBg.onload = done; imgFg.onload = done;
    imgBg.src = BASE + ph.bg; imgFg.src = BASE + ph.fg;
  }
  // cover-fit rect of the photograph + the camera push (anchor A → target T, zoom 1 → Zf)
  let G = null;
  function geometry() {
    const W = innerWidth, H = innerHeight, s = Math.max(W / ph.w, H / ph.h);
    const c = { x: (W - ph.w * s) / 2, y: (H - ph.h * s) / 2, w: ph.w * s, h: ph.h * s, s };
    const hb = {};
    for (const k of ['f', 'm']) { const [hx, hy, hh] = ph.heads[k]; hb[k] = { x: c.x + hx * c.w, y: c.y + hy * c.h, h: hh * c.h }; }
    const x0 = Math.min(hb.f.x - hb.f.h * 0.45, hb.m.x - hb.m.h * 0.45), x1 = Math.max(hb.f.x + hb.f.h * 0.45, hb.m.x + hb.m.h * 0.45);
    const y0 = Math.min(hb.f.y - hb.f.h * 0.5, hb.m.y - hb.m.h * 0.5), y1 = Math.max(hb.f.y + hb.f.h * 0.5, hb.m.y + hb.m.h * 0.5);
    const A = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    const port = orient === 'port';
    const Zf = Math.min((port ? 0.34 : 0.5) * H / (y1 - y0), (port ? 0.86 : 0.62) * W / (x1 - x0));
    const Tt = { x: W * (port ? 0.5 : 0.52), y: H * (port ? 0.36 : 0.45) };
    G = { W, H, c, hb, A, T: Tt, Zf };
  }
  const project = (P, e) => { const s = lerp(1, G.Zf, e); return { x: G.A.x + (P.x - G.A.x) * s + (G.T.x - G.A.x) * e, y: G.A.y + (P.y - G.A.y) * s + (G.T.y - G.A.y) * e, s }; };
  function layout() {
    geometry();
    for (const im of [imgBg, imgFg]) { Object.assign(im.style, { left: G.c.x + 'px', top: G.c.y + 'px', width: G.c.w + 'px', height: G.c.h + 'px', transformOrigin: `${G.A.x - G.c.x}px ${G.A.y - G.c.y}px` }); }
    place3D();
  }

  // ------------------------------------------------------------ the two live 3D heads
  const renderer = new THREE.WebGLRenderer({ canvas: cvs, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const cam = new THREE.PerspectiveCamera(20, 1, 0.05, 50);
  const key = new THREE.DirectionalLight(0xfff3ea, 1.35); key.position.set(-1.2, 1.6, 1.4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xd1fe17, 0); rim.position.set(1.5, 0.8, -1.2); scene.add(rim);
  const heads = {}; let headsReady = false;
  {
    const loader = new GLTFLoader(); const draco = new DRACOLoader(); draco.setDecoderPath(ROOT + 'vendor/three/jsm/libs/draco/'); loader.setDRACOLoader(draco);
    const suffix = LITE_TEX ? '_2k' : '';
    Promise.all(['f', 'm'].map(k => loader.loadAsync(`${ROOT}assets/skin_${k}${suffix}.glb`).then(g => {
      const obj = g.scene; const box = new THREE.Box3().setFromObject(obj);
      obj.traverse(o => { if (o.isMesh) { const m = o.material; m.metalness = 0; m.envMapIntensity = 0.55; m.transparent = true; m.side = THREE.FrontSide; } });
      const top = box.max.y, chin = CHIN[k], cy = (top + chin) / 2, c = box.getCenter(new THREE.Vector3());
      obj.position.set(-c.x, -cy, -c.z);
      const grp = new THREE.Group(); grp.add(obj); scene.add(grp);
      heads[k] = { grp, obj, hm: top - chin, op: 1 };
    }))).then(() => { headsReady = true; draco.dispose(); place3D(); }).catch(e => { console.warn('[hero] 3D heads', e); headsReady = 'failed'; });
  }
  // put each head exactly where that face is in the photograph at the end of the push
  const scr = {};
  function place3D() {
    if (!G) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr); renderer.setSize(G.W, G.H, false);
    cam.aspect = G.W / G.H; cam.updateProjectionMatrix();
    const tn = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    for (const k of ['f', 'm']) {
      const f = project(G.hb[k], 1), hpx = G.hb[k].h * G.Zf;
      scr[k] = { x: f.x, y: f.y, h: hpx };
      const h = heads[k]; if (!h) continue;
      const D = h.hm * (G.H / 2) / (hpx * tn);
      h.grp.position.set((f.x - G.W / 2) / (G.H / 2) * D * tn, -(f.y - G.H / 2) / (G.H / 2) * D * tn, -D);
      h.base = h.grp.position.clone(); h.D = D;
    }
    placePicks();
  }
  function placePicks() {
    picks.forEach(b => { const s = scr[b.dataset.sex]; if (!s) return; b.style.left = s.x + 'px'; b.style.top = s.y + 'px'; b.style.setProperty('--r', (s.h * 0.5) + 'px'); });
  }

  // ------------------------------------------------------------ progress (virtual scroll with inertia)
  let target = 0, p = 0, state = 'film', autoT = null;
  const push = d => { if (state !== 'film') return; target = clamp(target + d, 0, 1); root.classList.add('moved'); };
  const onWheel = e => { e.preventDefault(); push((e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) / 2600); };
  let ty = null;
  const onTouchStart = e => { ty = e.touches[0].clientY; };
  const onTouchMove = e => { if (ty == null) return; e.preventDefault(); const y = e.touches[0].clientY; push((ty - y) / (innerHeight * 2.2)); ty = y; };
  const onTouchEnd = () => { ty = null; };
  const onKey = e => {
    if (state === 'gone') return;
    if (['ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); push(0.12); }
    else if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); push(-0.12); }
    else if (e.key === 'Escape') skip();
  };
  const onResize = () => { const o = innerWidth / innerHeight < 0.9 ? 'port' : 'land'; if (o !== orient) { orient = o; loadPhoto(); } layout(); };
  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  root.addEventListener('touchend', onTouchEnd);
  addEventListener('keydown', onKey);
  addEventListener('resize', onResize);
  picks.forEach(b => b.addEventListener('click', e => { e.stopPropagation(); enter(b.dataset.sex); }));
  $('.hero-skip').addEventListener('click', () => skip());
  root.addEventListener('click', e => { if (state === 'film' && !e.target.closest('button') && target < 0.9) autoTo(1, 3.4); });

  function autoTo(to, secs) {
    const from = target, t0 = performance.now();
    cancelAnimationFrame(autoT);
    const step = () => { const k = clamp((performance.now() - t0) / (secs * 1000), 0, 1); target = from + (to - from) * easeIO(k); if (k < 1 && state === 'film') autoT = requestAnimationFrame(step); };
    root.classList.add('moved'); autoT = requestAnimationFrame(step);
  }

  // ------------------------------------------------------------ choose / enter / leave
  let chosen = null, enterT0 = 0, kioskPick = null;
  function toChoose() {
    state = 'choose'; root.classList.add('choosing'); placePicks();
    if (KIOSK) kioskPick = setTimeout(() => enter(sessionStorage.getItem('heroLast') === 'f' ? 'm' : 'f'), 3200);
  }
  function enter(sex) {
    if (state === 'enter' || state === 'gone') return;
    clearTimeout(kioskPick); cancelAnimationFrame(autoT);
    target = 1; p = 1;
    try { sessionStorage.setItem('heroLast', sex); } catch {}
    chosen = sex; state = 'enter'; enterT0 = performance.now();
    root.classList.add('entering', 'enter-' + sex);
    onEnter?.(sex);
  }
  function skip() { if (state === 'enter' || state === 'gone') return; enter(sessionStorage.getItem('heroLast') === 'f' ? 'm' : 'f'); }
  function finish() {
    state = 'gone'; mo.disconnect();
    removeEventListener('keydown', onKey); removeEventListener('resize', onResize);
    renderer.dispose(); pmrem.dispose();
    document.body.classList.remove('hero-on'); root.hidden = true; root.innerHTML = '';
    onDone?.(chosen);
  }

  // ------------------------------------------------------------ loop
  const tStart = performance.now(); let last = tStart, t3 = 0;
  function tick(now) {
    if (state === 'gone') return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (KIOSK && state === 'film' && target === 0 && now - tStart > 3800) autoTo(1, 7.5);
    if (REDUCED && state === 'film') target = 1;
    // the 3D heads must be ready before the photograph hands over to them
    const cap = headsReady === true || headsReady === 'failed' ? 1 : 0.7;
    p += (Math.min(target, cap) - p) * (REDUCED ? 1 : 1 - Math.pow(0.001, dt));
    if (Math.abs(target - p) < 0.0004 && cap === 1) p = target;
    root.classList.toggle('waiting3d', target > 0.7 && cap < 1);

    const e = easeIO(smooth(0.04, 0.74, p));           // camera push
    // a lime scan line sweeps down: above it the photograph has become the dark atlas world with the live 3D heads
    const scan = smooth(0.7, 0.86, p), dark = scan;
    root.style.setProperty('--title', (1 - smooth(0.0, 0.14, p)).toFixed(3));
    root.style.setProperty('--scan', scan.toFixed(4));
    root.classList.toggle('started', p > 0.012);
    if (G && photoReady) {
      const sF = lerp(1, G.Zf, e);
      const bx = (G.T.x - G.A.x) * e * 0.78, by = (G.T.y - G.A.y) * e * 0.78, c = G.c, A = G.A;
      // the backdrop drifts less (parallax) but must always cover the frame
      const sB = Math.max(lerp(1, 1 + (G.Zf - 1) * 0.55, e),
        (A.y + by) / Math.max(1, A.y - c.y), (G.H - A.y - by) / Math.max(1, c.y + c.h - A.y),
        (A.x + bx) / Math.max(1, A.x - c.x), (G.W - A.x - bx) / Math.max(1, c.x + c.w - A.x));
      imgFg.style.transform = `translate(${(G.T.x - G.A.x) * e}px, ${(G.T.y - G.A.y) * e}px) scale(${sF})`;
      imgBg.style.transform = `translate(${bx}px, ${by}px) scale(${sB})`;
    }
    $('.hero-progress i').style.transform = `scaleX(${smooth(0.04, 0.95, p).toFixed(4)})`;
    if (state === 'film' && p > 0.955) toChoose();
    if (state === 'choose' && target < 0.9) { state = 'film'; root.classList.remove('choosing'); clearTimeout(kioskPick); }

    // 3D heads: appear on the faces, then come alive (a slow turn proves they are real 3D)
    if (headsReady === true) {
      t3 += dt;
      const alive = smooth(0.86, 1, p);
      const en = state === 'enter' ? easeOut(clamp((now - enterT0) / 1500, 0, 1)) : 0;
      for (const k of ['f', 'm']) {
        const h = heads[k]; if (!h.base) continue;
        const ph0 = k === 'f' ? 0 : 1.9;
        if (state !== 'enter') {
          h.grp.rotation.y = YAW0[k] * (1 - alive * 0.6) + Math.sin(t3 * 0.55 + ph0) * 0.32 * alive;
          h.grp.rotation.x = Math.sin(t3 * 0.4 + ph0) * 0.03 * alive;
        }
        let op = 1;
        if (state === 'enter') {
          if (k === chosen) {
            // fly to exactly where the atlas head is waiting (same place, size and turn), then the film dissolves
            if (!h.goal) {
              const port = orient === 'port', tn = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
              const gx = G.W * (port ? 0.462 : 0.388), gy = G.H * (port ? 0.405 : 0.453), gh = G.H * (port ? 0.321 : 0.497);
              const D = h.hm * (G.H / 2) / (gh * tn);
              h.goal = new THREE.Vector3((gx - G.W / 2) / (G.H / 2) * D * tn, -(gy - G.H / 2) / (G.H / 2) * D * tn, -D);
              h.from = h.grp.position.clone(); h.yawFrom = h.grp.rotation.y;
            }
            h.grp.position.lerpVectors(h.from, h.goal, en);
            h.grp.rotation.y = lerp(h.yawFrom, 0.52, en); h.grp.rotation.x *= 1 - en;
          }
          else op *= 1 - smooth(0, 0.5, en);
        }
        h.obj.traverse(o => { if (o.isMesh) o.material.opacity = op; });
        h.grp.visible = op > 0.003;
      }
      rim.intensity = 1.1 * dark;
      key.intensity = lerp(1.35, 1.6, dark);
      renderer.render(scene, cam);
    }
    if (state === 'enter') {
      const k = clamp((now - enterT0) / 1600, 0, 1);
      root.style.setProperty('--enter', easeOut(k).toFixed(4));
      if (k >= 1) { finish(); return; }
    }
    requestAnimationFrame(tick);
  }
  loadPhoto(); layout();
  requestAnimationFrame(tick);

  const api = {
    state: () => ({ state, p: +p.toFixed(3), headsReady, photoReady, chosen, orient }),
    set: v => { target = clamp(v, 0, 1); p = Math.min(target, headsReady === true ? 1 : 0.7); },
    enter, skip,
  };
  window.__hero = api;
  return api;
}
