// Opening film: two people full-length → scroll-driven camera push into their faces → choose whose head to enter →
// the photo hands over to the live 3D head. Web: wheel/touch/keys drive the film. Kiosk: it plays by itself.
// Test hooks: window.__hero.{state(), set(p), enter('f'|'m'), skip()}.  ?nohero=1 bypasses it.
import { UI } from '../ui/i18n.js';

const Q = new URLSearchParams(location.search);
const KIOSK = Q.has('kiosk');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const N = 145;                                  // frames in each sequence (18 fps × 8 s)
const PAPER = '#0F1113';                        // tall screens: the photo fades into the brand ink below it
const BASE = new URL('../../assets/hero/', import.meta.url).href;

// normalised face centres on the last frame of each sequence (x, y, radius as a fraction of frame height)
const FACES = {
  land: { f: [0.382, 0.4, 0.165], m: [0.681, 0.235, 0.175] },
  port: { f: [0.265, 0.39, 0.1], m: [0.775, 0.215, 0.11] },
};

const T = {
  kk: { sub: 'Ішіне үңілейік.', cue: 'Айналдырыңыз', cueTouch: 'Жоғары сырғытыңыз', ask: 'Кімнің басына кіреміз?', f: 'Әйел', m: 'Ер', skip: 'Өткізу' },
  ru: { sub: 'Заглянем внутрь.', cue: 'Прокрутите', cueTouch: 'Проведите вверх', ask: 'В чью голову заглянем?', f: 'Женщина', m: 'Мужчина', skip: 'Пропустить' },
  en: { sub: 'Let’s look inside.', cue: 'Scroll', cueTouch: 'Swipe up', ask: 'Whose head shall we explore?', f: 'Woman', m: 'Man', skip: 'Skip' },
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - Math.pow(1 - t, 4);

export function initHero({ onEnter, onDone, getLang }) {
  const root = document.getElementById('hero');
  if (!root || Q.has('nohero') || Q.has('still') || Q.has('alpha') || Q.get('inspect') || Q.get('dive') || Q.has('nointro')) { onDone?.(null); return null; }

  const touch = matchMedia('(pointer: coarse)').matches;
  let orient = innerWidth / innerHeight < 0.9 ? 'port' : 'land';
  const set = () => (orient === 'port' ? '9' : '16');

  root.innerHTML = `
    <div class="hero-stage">
      <video class="hero-idle" muted playsinline loop preload="auto"></video>
      <canvas class="hero-seq"></canvas>
      <div class="hero-shade"></div>
      <div class="hero-title">
        <h1 class="hero-h"><span class="w1"></span> <mark class="w2"></mark></h1>
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
  const video = $('.hero-idle'), cvs = $('.hero-seq'), ctx = cvs.getContext('2d');
  const picks = [...root.querySelectorAll('.hero-pick')];

  // ------------------------------------------------------------ text
  let textLang = null;
  function applyText() {
    const L = getLang?.() || 'kk', t = T[L] || T.en, u = UI[L] || UI.en;
    if (L === textLang) return;           // the engine re-sets <html lang> while loading: don't restart the title animation
    textLang = L;
    const brand = u.brand, mark = u.brandMark, rest = brand.replace(mark, '').trim();
    const markFirst = brand.indexOf(mark) === 0;
    $('.hero-h').innerHTML = markFirst ? `<mark class="w2">${mark}</mark> <span class="w1">${rest}</span>` : `<span class="w1">${rest}</span> <mark class="w2">${mark}</mark>`;
    $('.hero-sub').textContent = t.sub;
    $('.hero-cue-t').textContent = touch ? t.cueTouch : t.cue;
    $('.hero-ask').textContent = t.ask;
    picks.forEach(b => { b.querySelector('.lbl').textContent = t[b.dataset.sex]; b.setAttribute('aria-label', t[b.dataset.sex]); });
    $('.hero-skip').textContent = t.skip;
    root.lang = L;
  }
  applyText();
  const mo = new MutationObserver(applyText);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  // ------------------------------------------------------------ media
  const frames = new Array(N); let loaded = 0, lastDrawn = -1;
  function loadFrames() {
    const s = set(); lastDrawn = -1;
    // coarse-to-fine order so a scrub early on already has nearby frames
    const order = []; for (let step = 16; step >= 1; step >>= 1) for (let i = 0; i < N; i += step) if (!order.includes(i)) order.push(i);
    if (!order.includes(N - 1)) order.push(N - 1);
    order.forEach(i => {
      const im = new Image(); im.decoding = 'async'; im.src = `${BASE}f${s}/${String(i + 1).padStart(3, '0')}.webp`;
      im.onload = () => { frames[i] = im; loaded++; if (i === 0) draw(true); };
    });
  }
  video.src = `${BASE}idle${set() === '9' ? '9' : '16'}.mp4`;
  video.poster = `${BASE}poster${set()}.webp`;
  video.onerror = () => { video.removeAttribute('src'); };  // portrait idle may be missing: poster stays
  video.play().catch(() => {});
  loadFrames();

  function nearest(i) {
    if (frames[i]) return frames[i];
    for (let d = 1; d < N; d++) { if (frames[i - d]) return frames[i - d]; if (frames[i + d]) return frames[i + d]; }
    return null;
  }
  // cover-fit geometry shared by the canvas and the hotspots
  // cover-fit, except on tall screens: fit the width, pin to the top and let the seamless paper continue below
  function cover(iw, ih) {
    const W = innerWidth, H = innerHeight;
    const tall = W / iw * ih >= H * 0.72 && W / iw * ih < H;
    const s = tall ? W / iw : Math.max(W / iw, H / ih);
    root.classList.toggle('tall', tall);
    if (tall) root.style.setProperty('--imgH', (ih * s) + 'px');
    return { s, x: (W - iw * s) / 2, y: tall ? 0 : (H - ih * s) / 2, w: iw * s, h: ih * s };
  }
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cvs.width = Math.round(innerWidth * dpr); cvs.height = Math.round(innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingQuality = 'high';
    const o = innerWidth / innerHeight < 0.9 ? 'port' : 'land';
    if (o !== orient) { orient = o; frames.fill(undefined); loaded = 0; loadFrames(); video.src = `${BASE}idle${set()}.mp4`; video.poster = `${BASE}poster${set()}.webp`; video.play().catch(() => {}); }
    lastDrawn = -1; draw(true); placePicks();
  }
  function draw(force) {
    const i = clamp(Math.round(frameF), 0, N - 1);
    if (!force && i === lastDrawn) return;
    const im = nearest(i); if (!im) return;
    const c = cover(im.naturalWidth, im.naturalHeight);
    ctx.clearRect(0, 0, innerWidth, innerHeight); ctx.drawImage(im, c.x, c.y, c.w, c.h);
    if (c.h < innerHeight - 1) {             // paper below the photo, blended in
      ctx.fillStyle = PAPER; ctx.fillRect(0, c.h - 1, innerWidth, innerHeight - c.h + 1);
      const g = ctx.createLinearGradient(0, c.h - 150, 0, c.h); g.addColorStop(0, PAPER + '00'); g.addColorStop(1, PAPER);
      ctx.fillStyle = g; ctx.fillRect(0, c.h - 150, innerWidth, 150);
    }
    lastDrawn = frames[i] ? i : -1;
  }
  function facePx(sex) {
    const f = FACES[orient][sex], im = frames[N - 1] || nearest(N - 1);
    const iw = im ? im.naturalWidth : (orient === 'port' ? 900 : 1600), ih = im ? im.naturalHeight : (orient === 'port' ? 1600 : 900);
    const c = cover(iw, ih);
    return { x: c.x + f[0] * c.w, y: c.y + f[1] * c.h, r: f[2] * c.h };
  }
  function placePicks() {
    picks.forEach(b => { const p = facePx(b.dataset.sex); b.style.left = p.x + 'px'; b.style.top = p.y + 'px'; b.style.setProperty('--r', p.r + 'px'); });
  }

  // ------------------------------------------------------------ progress (virtual scroll with inertia)
  let target = 0, p = 0, frameF = 0, state = 'film', autoT = null, lastInput = performance.now();
  const push = d => { if (state !== 'film') return; target = clamp(target + d, 0, 1); lastInput = performance.now(); root.classList.add('moved'); };
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
  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  root.addEventListener('touchend', onTouchEnd);
  addEventListener('keydown', onKey);
  addEventListener('resize', resize);
  picks.forEach(b => b.addEventListener('click', e => { e.stopPropagation(); enter(b.dataset.sex); }));
  $('.hero-skip').addEventListener('click', () => skip());
  // a tap on the film (not on a pick) moves it forward on touch screens, like a "next"
  root.addEventListener('click', e => { if (state === 'film' && !e.target.closest('button') && target < 0.9) { autoTo(1, 3.2); } });

  function autoTo(to, secs) {
    const from = target, t0 = performance.now();
    cancelAnimationFrame(autoT);
    const step = () => { const k = clamp((performance.now() - t0) / (secs * 1000), 0, 1); target = from + (to - from) * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2); if (k < 1 && state === 'film') autoT = requestAnimationFrame(step); };
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
    target = 1; p = 1; frameF = N - 1; draw(true);
    try { sessionStorage.setItem('heroLast', sex); } catch {}
    chosen = sex; state = 'enter'; enterT0 = performance.now();
    const fp = facePx(sex);
    root.style.setProperty('--fx', fp.x + 'px'); root.style.setProperty('--fy', fp.y + 'px');
    root.classList.add('entering', 'enter-' + sex);
    onEnter?.(sex);
  }
  function skip() { if (state === 'enter' || state === 'gone') return; enter(sessionStorage.getItem('heroLast') === 'f' ? 'm' : 'f'); }
  function finish() {
    state = 'gone'; mo.disconnect();
    removeEventListener('keydown', onKey); removeEventListener('resize', resize);
    document.body.classList.remove('hero-on'); root.hidden = true; root.innerHTML = '';
    onDone?.(chosen);
  }

  // ------------------------------------------------------------ loop
  const tStart = performance.now();
  function tick(now) {
    if (state === 'gone') return;
    if (KIOSK && state === 'film' && target === 0 && now - tStart > 3800) autoTo(1, 7.5);
    if (REDUCED && state === 'film') { target = 1; }
    p += (target - p) * (REDUCED ? 1 : 0.085);
    if (Math.abs(target - p) < 0.0004) p = target;
    // film mapping: 0–0.06 title hold, 0.06–0.9 camera push, ≥0.9 choose
    const fp = smooth(0.05, 0.9, p);
    frameF = fp * (N - 1);
    const started = p > 0.012;
    root.style.setProperty('--p', p.toFixed(4));
    root.style.setProperty('--title', (1 - smooth(0.0, 0.14, p)).toFixed(3));
    root.classList.toggle('started', started);
    if (started) { if (!video.paused) video.pause(); draw(); }
    else if (video.paused && state === 'film') video.play().catch(() => {});
    $('.hero-progress i').style.transform = `scaleX(${fp.toFixed(4)})`;
    if (state === 'film' && p > 0.965) toChoose();
    if (state === 'choose' && target < 0.9) { state = 'film'; root.classList.remove('choosing'); clearTimeout(kioskPick); }
    if (state === 'enter') {
      const k = clamp((now - enterT0) / 1600, 0, 1);
      root.style.setProperty('--enter', easeOut(k).toFixed(4));
      if (k >= 1) { finish(); return; }
    }
    requestAnimationFrame(tick);
  }
  resize();
  requestAnimationFrame(tick);

  const api = {
    state: () => ({ state, p: +p.toFixed(3), frame: Math.round(frameF), loaded, chosen, orient }),
    set: v => { target = clamp(v, 0, 1); p = target; },
    enter, skip,
  };
  window.__hero = api;
  return api;
}
