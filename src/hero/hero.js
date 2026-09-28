// Opening, entirely in real-time 3D: the two photoreal heads stand on glass cubes with the Higgsfield mark etched
// inside. The camera rises out of a macro on the etched logo into a wide reveal (the hook, plays by itself), then the
// scroll orbits in while a lime scan passes through both heads (a glimpse inside), and ends on the two faces: the
// visitor picks whose head to enter and that head flies onto the atlas. Kiosk: it plays by itself.
// Test hooks: window.__hero.{state(), set(p), enter('f'|'m'), skip()}.  ?nohero=1 bypasses it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UI } from '../ui/i18n.js';

const Q = new URLSearchParams(location.search);
const KIOSK = Q.has('kiosk');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ROOT = new URL('../../', import.meta.url).href;
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;
const LITE = Q.get('tex') === 'lite' || (Q.get('tex') !== 'full' && ((IS_TOUCH && Math.min(screen.width, screen.height) < 900) || (navigator.deviceMemory && navigator.deviceMemory <= 4)));

const CHIN = { m: 1.484, f: 1.486 };          // atlas chin height (m)
const CUBE = 0.26, CH = 0.15;                 // glass plinth width/depth and height (m); heads stand on the top faces
const HX = { f: -0.19, m: 0.19 };

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

  root.innerHTML = `
    <div class="hero-stage">
      <canvas class="hero-3d"></canvas>
      <div class="hero-vignette"></div>
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
      <button class="hero-skip"></button>
      <div class="hero-progress"><i></i></div>
    </div>`;
  document.body.classList.add('hero-on');
  root.classList.add('hero3d');
  root.hidden = false;
  const $ = s => root.querySelector(s);
  const cvs = $('.hero-3d');
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

  // ------------------------------------------------------------ renderer, scene, post
  const renderer = new THREE.WebGLRenderer({ canvas: cvs, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d0f);
  scene.fog = new THREE.Fog(0x0b0d0f, 2.4, 6.5);
  const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;
  const cam = new THREE.PerspectiveCamera(30, 1, 0.02, 30); cam.layers.enable(1);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, cam));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.88);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const key = new THREE.DirectionalLight(0xfff1e6, 1.6); key.position.set(-1.4, 1.8, 1.6); scene.add(key);
  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.35); fill.position.set(1.6, 0.6, 1.2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xd1fe17, 0.45); rim.position.set(0.6, 1.0, -1.8); scene.add(rim);

  // floor: dark mirror (desktop) or a plain dark floor with soft contact shadows (phones)
  const FLOOR_Y = -CH;
  if (!LITE) {
    const mirror = new Reflector(new THREE.PlaneGeometry(12, 12), { textureWidth: 1024, textureHeight: 1024, color: 0x222629, clipBias: 0.003 });
    mirror.rotation.x = -Math.PI / 2; mirror.position.y = FLOOR_Y; scene.add(mirror);
    // the heads live on layer 1: the floor mirrors only the glass, logo and light
    const getRC = mirror.getReflectionCamera; mirror.getReflectionCamera = c => { const r = getRC.call(mirror, c); r.layers.set(0); return r; };
  }
  const dim = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ color: 0x0d0f11, transparent: true, opacity: LITE ? 1 : 0.8 }));
  dim.rotation.x = -Math.PI / 2; dim.position.y = FLOOR_Y + 0.0015; scene.add(dim);

  // a softly lit cyclorama behind the pair: gives the glass something to refract and separates the heads from the dark
  {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
    const gr = g.createRadialGradient(256, 150, 10, 256, 150, 300); gr.addColorStop(0, '#2c3034'); gr.addColorStop(0.5, '#181b1e'); gr.addColorStop(1, '#0b0d0f');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.5), new THREE.MeshBasicMaterial({ map: tx, fog: false }));
    wall.position.set(0, FLOOR_Y + 1.2, -1.6); scene.add(wall);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.006), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd1fe17).multiplyScalar(1.6), toneMapped: false, fog: false }));
    strip.position.set(0, FLOOR_Y + 0.02, -1.58); scene.add(strip);
  }
  // soft light pools under the cubes (the only lime in the room besides the logo)
  const poolTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(209,254,23,0.22)'); gr.addColorStop(0.3, 'rgba(209,254,23,0.05)'); gr.addColorStop(1, 'rgba(209,254,23,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();

  // glass cubes with the etched Higgsfield mark
  const etch = new THREE.TextureLoader().load(ROOT + 'assets/hero/hf_etch.png'); etch.colorSpace = THREE.SRGBColorSpace; etch.anisotropy = 8;
  const glassMat = LITE
    ? null : null;
  // frosted glass: a light translucent body (so it reads as glass on a dark stage) + crisp clear-coat highlights
  const glassMatReal = new THREE.MeshPhysicalMaterial({ color: 0x8fa1aa, metalness: 0, roughness: 0.1, transparent: true, opacity: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.1, depthWrite: false, side: THREE.DoubleSide });
  const cubeGeo = new RoundedBoxGeometry(CUBE, CH, CUBE, 5, 0.012);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 });
  const cubes = {};
  for (const k of ['f', 'm']) {
    const g = new THREE.Group(); g.position.set(HX[k], FLOOR_Y + CH / 2, 0); scene.add(g);
    const box = new THREE.Mesh(cubeGeo, glassMatReal); box.renderOrder = 2; g.add(box);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(CUBE * 0.995, CH * 0.99, CUBE * 0.995)), edgeMat); g.add(edges);
    // the mark floats inside the glass, a little behind the front face, and glows (bloom)
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(CUBE * 0.8, CUBE * 0.8 * 312 / 1600), new THREE.MeshBasicMaterial({ map: etch, color: new THREE.Color(0xd1fe17).multiplyScalar(1.15), transparent: true, depthWrite: false, toneMapped: false }));
    logo.position.set(0, 0, CUBE / 2 + 0.0015); logo.renderOrder = 5; g.add(logo);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(CUBE * 2.2, CUBE * 2.2), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(0, -CH / 2 + 0.003, 0); g.add(pool);
    cubes[k] = { g, logo, pool };
  }

  // ------------------------------------------------------------ the two photoreal heads (+ a scan shell for the glimpse inside)
  const heads = {}; let headsReady = false;
  const scanLo = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), scanHi = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const skinA = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), skinB = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const holoMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, clipping: true,
    uniforms: { uCol: { value: new THREE.Color(0xd1fe17) }, uOp: { value: 1 } },
    vertexShader: `#include <common>
      #include <clipping_planes_pars_vertex>
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
        vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <clipping_planes_pars_fragment>
      uniform vec3 uCol; uniform float uOp; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        #include <clipping_planes_fragment>
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float lines = smoothstep(0.35, 0.5, abs(fract(vW.y * 260.0) - 0.5));
        gl_FragColor = vec4(uCol * (0.08 + f * 1.6 + lines * 0.25) * 1.6, 1.0) * uOp;
      }`,
  });
  holoMat.clippingPlanes = [scanHi, scanLo];
  // ---- assembly: lime particles build each head from the inside out (brain → skull → muscles → skin)
  const LAYERS = ['brain', 'skull', 'muscle', 'skin'];
  const LSTART = [0.25, 1.35, 2.45, 3.55], LDUR = 1.1, LSPREAD = 0.95;          // seconds, per layer
  const ASSEMBLE_END = LSTART[3] + LSPREAD + LDUR + 0.25;                     // skin fully landed
  const SKIN_IN = [ASSEMBLE_END - 0.55, ASSEMBLE_END + 0.45];                  // the photoreal skin solidifies
  const LCOL = [new THREE.Color(0xd9828c), new THREE.Color(0xd8ccb4), new THREE.Color(0xb3322c), new THREE.Color(0xd6a88a)].map(c => c.multiplyScalar(0.72));
  const ptsMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: true,
    uniforms: { uT: { value: 0 }, uFade: { value: 0 }, uSize: { value: 0.0015 }, uPix: { value: 1 }, uBase: { value: new THREE.Vector3() }, uCol: { value: LCOL }, uLime: { value: new THREE.Color(0xd1fe17) } },
    vertexShader: `
      attribute float aSeed; attribute float aLayer; attribute float aDelay;
      uniform float uT, uSize, uPix; uniform vec3 uBase; uniform vec3 uCol[4];
      varying vec3 vCol; varying float vA; varying float vFly;
      float ease(float t){ return t < 0.5 ? 4.0*t*t*t : 1.0 - pow(-2.0*t + 2.0, 3.0) / 2.0; }
      void main(){
        float k = clamp((uT - aDelay) / ${LDUR.toFixed(2)}, 0.0, 1.0), e = ease(k);
        // born in a ring of light on the glass, spirals up into place
        float a0 = aSeed * 6.2831853 * 7.0, r0 = 0.03 + 0.09 * fract(aSeed * 13.7);
        vec3 start = uBase + vec3(cos(a0) * r0, 0.0, sin(a0) * r0);
        vec3 p = mix(start, position, e);
        vec3 axis = vec3(uBase.x, p.y, uBase.z);
        float ang = (1.0 - e) * (2.2 + 2.0 * fract(aSeed * 7.1));
        vec3 d = p - axis; p = axis + vec3(d.x * cos(ang) - d.z * sin(ang), d.y, d.x * sin(ang) + d.z * cos(ang));
        p.y += sin((1.0 - e) * 3.14159) * 0.03 * fract(aSeed * 3.3);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        vFly = 1.0 - smoothstep(0.72, 1.0, k);
        gl_PointSize = uSize * uPix * (1.0 + vFly * 0.6) * (projectionMatrix[1][1] * 0.5) * 1080.0 / max(0.05, -mv.z) / 1.0;
        int li = int(aLayer + 0.5);
        vCol = li == 0 ? uCol[0] : li == 1 ? uCol[1] : li == 2 ? uCol[2] : uCol[3];
        vA = smoothstep(0.0, 0.08, k);
      }`,
    fragmentShader: `
      uniform vec3 uLime; uniform float uFade; varying vec3 vCol; varying float vA; varying float vFly;
      void main(){
        vec2 q = gl_PointCoord - 0.5; float r = dot(q, q); if (r > 0.25) discard;
        vec3 c = mix(vCol, uLime * 1.25, vFly);
        float a = vA * (1.0 - uFade) * smoothstep(0.25, 0.12, r);
        if (a < 0.02) discard;
        gl_FragColor = vec4(c, a);
      }`,
  });
  const clouds = {};
  const cloudP = fetch(ROOT + 'assets/hero/assemble.bin').then(r => r.arrayBuffer()).then(buf => {
    const hl = new DataView(buf).getUint32(0, true); const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
    const base = 4 + hl, ctr = hdr.center, half = hdr.half;
    for (const sex of ['m', 'f']) {
      const ls = hdr.layers.filter(l => l.sex === sex); const n = ls.reduce((a, l) => a + l.n, 0);
      const pos = new Float32Array(n * 3), seed = new Float32Array(n), lay = new Float32Array(n), del = new Float32Array(n);
      let o = 0;
      for (const l of ls) {
        const q = new Int16Array(buf, base + l.offset, l.n * 3), li = LAYERS.indexOf(l.layer);
        let y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < l.n; i++) { const y = ctr[1] + q[i * 3 + 1] / 32767 * half; y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        for (let i = 0; i < l.n; i++) {
          const j = o + i;
          for (let c = 0; c < 3; c++) pos[j * 3 + c] = ctr[c] + q[i * 3 + c] / 32767 * half;
          seed[j] = Math.random(); lay[j] = li;
          // bottom-up wave inside each layer, with jitter
          del[j] = LSTART[li] + ((pos[j * 3 + 1] - y0) / Math.max(1e-4, y1 - y0)) * LSPREAD * 0.7 + Math.random() * LSPREAD * 0.3;
        }
        o += l.n;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      g.setAttribute('aLayer', new THREE.BufferAttribute(lay, 1)); g.setAttribute('aDelay', new THREE.BufferAttribute(del, 1));
      clouds[sex] = g;
    }
  }).catch(e => { console.warn('[hero] assembly cloud', e); });
  {
    const loader = new GLTFLoader(); const draco = new DRACOLoader(); draco.setDecoderPath(ROOT + 'vendor/three/jsm/libs/draco/'); loader.setDRACOLoader(draco);
    const suffix = LITE ? '_2k' : '';
    Promise.all(['f', 'm'].map(k => loader.loadAsync(`${ROOT}assets/skin_${k}${suffix}.glb`).then(async g => {
      const obj = g.scene; const box = new THREE.Box3().setFromObject(obj);
      const mats = [], shells = [];
      const meshes = []; obj.traverse(o => { if (o.isMesh) meshes.push(o); });
      meshes.forEach(o => {
        const m = o.material; m.metalness = 0; m.envMapIntensity = 0.6; m.transparent = true; m.side = THREE.FrontSide;
        m.clippingPlanes = [skinA, skinB]; m.clipIntersection = true; mats.push(m);
        const sh = new THREE.Mesh(o.geometry, holoMat); sh.renderOrder = 3; o.add(sh); shells.push(sh);
      });
      const top = box.max.y, chin = CHIN[k], cy = (top + chin) / 2, c = box.getCenter(new THREE.Vector3());
      obj.position.set(-c.x, -cy, -c.z);
      await cloudP;
      let pts = null;
      if (clouds[k]) {
        const mat = ptsMat.clone(); mat.uniforms.uCol.value = LCOL; mat.uniforms.uBase.value.set(c.x, box.min.y, c.z);
        pts = new THREE.Points(clouds[k], mat); pts.frustumCulled = false; pts.renderOrder = 4; obj.add(pts);
      }
      const grp = new THREE.Group(); grp.add(obj); scene.add(grp); grp.traverse(o => o.layers.set(1));
      const neck = box.min.y - cy;                                     // neck cut, relative to the group origin
      grp.position.set(HX[k], -neck + 0.002, 0);
      heads[k] = { grp, obj, mats, shells, pts, hm: top - chin, base: grp.position.clone() };
    }))).then(() => { headsReady = true; draco.dispose(); }).catch(e => { console.warn('[hero] 3D heads', e); headsReady = 'failed'; });
  }
  // the scan beam: a thin lime sheet that slides down through both heads
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({
    map: (() => { const c = document.createElement('canvas'); c.width = 8; c.height = 256; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(209,254,23,0)'); gr.addColorStop(0.5, 'rgba(209,254,23,1)'); gr.addColorStop(1, 'rgba(209,254,23,0)'); g.fillStyle = gr; g.fillRect(0, 0, 8, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })(),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  }));
  beam.rotation.x = -Math.PI / 2; beam.scale.set(1, 0.02, 1); beam.visible = false; scene.add(beam);

  // ------------------------------------------------------------ camera choreography
  const port = () => innerWidth / innerHeight < 0.9;
  // fit distance so a width w (m) fills a fraction of the frame
  const fitDist = (w, frac) => (w / 2) / (Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect * frac);
  function pose(p, intro) {
    const P = port();
    // wide establishing shot (landscape: the pair sits right of centre, the title owns the left)
    const wide = { yaw: -0.52, d: P ? fitDist(0.9, 0.9) : 2.35, h: 0.36, t: new THREE.Vector3(P ? 0 : -0.36, P ? 0.02 : -0.04, 0) };
    const mid = { yaw: -0.18, d: P ? fitDist(0.8, 0.95) : 1.55, h: 0.2, t: new THREE.Vector3(P ? 0 : -0.1, 0.06, 0) };
    const close = { yaw: 0.0, d: P ? fitDist(0.64, 0.98) : 1.1, h: 0.04, t: new THREE.Vector3(0, 0.15, 0) };
    const a = smooth(0.1, 0.5, p), b = smooth(0.5, 0.92, p);
    let yaw = lerp(lerp(wide.yaw, mid.yaw, a), close.yaw, b), d = lerp(lerp(wide.d, mid.d, a), close.d, b), h = lerp(lerp(wide.h, mid.h, a), close.h, b);
    const t = wide.t.clone().lerp(mid.t, a).lerp(close.t, b);
    const pos = new THREE.Vector3(t.x + Math.sin(yaw) * d, t.y + h, t.z + Math.cos(yaw) * d);
    // the hook: rise out of a macro on the etched mark of her cube
    if (intro < 1) {
      // close, slowly orbiting while the heads assemble; the wide reveal comes once they are built
      const e = easeIO(smooth(0.62, 1, intro));
      const ang = lerp(0.42, -0.12, easeIO(smooth(0, 0.7, intro))), R0 = 0.95;
      const mt = new THREE.Vector3(0.0, 0.12, 0), m0 = new THREE.Vector3(mt.x + Math.sin(ang) * R0, 0.19, mt.z + Math.cos(ang) * R0);
      pos.lerpVectors(m0, pos, e); t.lerpVectors(mt, t, e);
    }
    return { pos, t };
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
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, LITE ? 1.5 : 2);
    renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight, false);
    composer.setPixelRatio(dpr); composer.setSize(innerWidth, innerHeight);
    bloom.resolution.set(innerWidth / 2, innerHeight / 2);
    cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
    root.classList.toggle('tall', port());
  }
  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  root.addEventListener('touchend', onTouchEnd);
  addEventListener('keydown', onKey);
  addEventListener('resize', resize);
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
    state = 'choose'; root.classList.add('choosing');
    if (KIOSK) kioskPick = setTimeout(() => enter(sessionStorage.getItem('heroLast') === 'f' ? 'm' : 'f'), 3200);
  }
  function enter(sex) {
    if (state === 'enter' || state === 'gone') return;
    clearTimeout(kioskPick); cancelAnimationFrame(autoT);
    target = 1; p = 1; introT = 1; aT = Math.max(aT, 99);
    try { sessionStorage.setItem('heroLast', sex); } catch {}
    chosen = sex; state = 'enter'; enterT0 = performance.now();
    root.classList.add('entering', 'enter-' + sex);
    onEnter?.(sex);
  }
  function skip() { if (state === 'enter' || state === 'gone') return; enter(sessionStorage.getItem('heroLast') === 'f' ? 'm' : 'f'); }
  function finish() {
    state = 'gone'; mo.disconnect();
    removeEventListener('keydown', onKey); removeEventListener('resize', resize);
    composer.dispose(); renderer.dispose(); pmrem.dispose();
    document.body.classList.remove('hero-on'); root.hidden = true; root.innerHTML = ''; root.classList.remove('hero3d');
    onDone?.(chosen);
  }
  const V = new THREE.Vector3();
  function placePicks() {
    for (const b of picks) {
      const h = heads[b.dataset.sex]; if (!h) continue;
      V.copy(h.grp.position).project(cam);
      const x = (V.x * 0.5 + 0.5) * innerWidth, y = (-V.y * 0.5 + 0.5) * innerHeight;
      V.copy(h.grp.position).add(new THREE.Vector3(0, h.hm / 2, 0)).project(cam);
      const r = Math.abs(y - (-V.y * 0.5 + 0.5) * innerHeight) * 1.05;
      b.style.left = x + 'px'; b.style.top = y + 'px'; b.style.setProperty('--r', r + 'px');
    }
  }

  // ------------------------------------------------------------ loop
  const tStart = performance.now(); let last = tStart, t3 = 0, introT = REDUCED ? 1 : 0;
  const INTRO_S = ASSEMBLE_END + 0.9; let aT = REDUCED ? 99 : 0;
  function tick(now) {
    if (state === 'gone') return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t3 += dt;
    if (headsReady === true || headsReady === 'failed') { aT += dt; introT = Math.min(1, introT + dt / INTRO_S); }
    root.classList.toggle('intro-done', aT >= ASSEMBLE_END - 0.3);
    if (KIOSK && state === 'film' && target === 0 && aT > ASSEMBLE_END + 2.2) autoTo(1, 7.5);
    if (REDUCED && state === 'film') target = 1;
    // the heads must be loaded before the camera reaches them
    const cap = headsReady === true || headsReady === 'failed' ? 1 : 0.3;
    p += (Math.min(target, cap) - p) * (REDUCED ? 1 : 1 - Math.pow(0.002, dt));
    if (Math.abs(target - p) < 0.0004 && cap === 1) p = target;
    root.classList.toggle('waiting3d', target > 0.3 && cap < 1);
    root.style.setProperty('--title', (1 - smooth(0.02, 0.16, p)).toFixed(3));
    root.classList.toggle('started', p > 0.012);
    $('.hero-progress i').style.transform = `scaleX(${smooth(0.0, 0.95, p).toFixed(4)})`;
    if (state === 'film' && p > 0.955) toChoose();
    if (state === 'choose' && target < 0.9) { state = 'film'; root.classList.remove('choosing'); clearTimeout(kioskPick); }

    // camera: hook (time) × scroll (p), with a slow breathing drift
    const { pos, t } = pose(p, introT);
    pos.x += Math.sin(t3 * 0.23) * 0.02 * (1 - p); pos.y += Math.sin(t3 * 0.31) * 0.01;
    cam.position.copy(pos); cam.lookAt(t);

    // scan: a lime beam slides down through both heads while the camera orbits in (p 0.36 → 0.72)
    const sc = smooth(0.36, 0.72, p), scanOn = sc > 0.001 && sc < 0.999;
    const yTop = 0.33, yBot = -0.02, sy = lerp(yTop, yBot, sc), w = 0.075;
    scanHi.constant = -(sy - w); scanLo.constant = sy + w * 0.35;            // holo shell: sy−w < y < sy+0.35w
    skinA.constant = -(sy + w * 0.35); skinB.constant = sy - w;              // skin: everything outside that band
    if (!scanOn) { skinA.constant = 1e3; skinB.constant = 1e3; scanHi.constant = -1e3; scanLo.constant = -1e3; }   // skin whole, shell hidden
    beam.visible = scanOn; beam.position.y = sy + w * 0.35; beam.material.opacity = Math.min(1, Math.min(sc, 1 - sc) * 10);

    // enter: the chosen head flies onto the atlas head (same place, size and turn); everything else goes dark
    const en = state === 'enter' ? easeOut(clamp((now - enterT0) / 1500, 0, 1)) : 0;
    for (const k of ['f', 'm']) {
      cubes[k].logo.material.opacity = (0.55 + 0.45 * smooth(0.15, 0.6, introT)) * (1 - smooth(0, 0.6, en));
      cubes[k].g.visible = en < 0.99;
    }
    glassMatReal.opacity = 0.1 * (1 - en);
    dim.material.opacity = LITE ? 1 : 0.8 + 0.2 * en;
    if (headsReady === true) {
      const alive = smooth(0.6, 1, p);
      for (const k of ['f', 'm']) {
        const h = heads[k], ph0 = k === 'f' ? 0 : 1.9;
        const skinIn = smooth(SKIN_IN[0], SKIN_IN[1], aT - (k === 'f' ? 0.35 : 0));
        let op = skinIn;
        if (h.pts) { const u = h.pts.material.uniforms; u.uT.value = aT - (k === 'f' ? 0.35 : 0); u.uFade.value = smooth(SKIN_IN[0] + 0.3, SKIN_IN[1] + 0.25, u.uT.value); u.uPix.value = renderer.getPixelRatio() * innerHeight / 1080; h.pts.visible = u.uFade.value < 0.999 && state !== 'enter'; }
        if (state !== 'enter') {
          // at rest they look slightly toward each other; as we come close they turn to the viewer and breathe
          const face = (k === 'f' ? 0.28 : -0.22) * (1 - alive);
          h.grp.rotation.y = face + Math.sin(t3 * 0.5 + ph0) * (0.1 + 0.18 * alive);
          h.grp.rotation.x = Math.sin(t3 * 0.4 + ph0) * 0.02;
          h.grp.position.copy(h.base);
        } else if (k === chosen) {
          if (!h.goal) {
            const P = port(), tn = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
            const gx = innerWidth * (P ? 0.462 : 0.388), gy = innerHeight * (P ? 0.405 : 0.453), gh = innerHeight * (P ? 0.321 : 0.497);
            const D = h.hm * (innerHeight / 2) / (gh * tn);
            const local = new THREE.Vector3((gx - innerWidth / 2) / (innerHeight / 2) * D * tn, -(gy - innerHeight / 2) / (innerHeight / 2) * D * tn, -D);
            cam.updateMatrixWorld(); h.goal = local.applyMatrix4(cam.matrixWorld);
            h.from = h.grp.position.clone(); h.yawFrom = h.grp.rotation.y;
            const camYaw = Math.atan2(cam.position.x - h.goal.x, cam.position.z - h.goal.z);
            h.yawTo = camYaw + 0.52;
          }
          h.grp.position.lerpVectors(h.from, h.goal, en);
          h.grp.rotation.y = lerp(h.yawFrom, h.yawTo, en); h.grp.rotation.x *= 1 - en;
        } else op *= 1 - smooth(0, 0.5, en);
        for (const m of h.mats) { m.opacity = op; m.depthWrite = op > 0.9; m.visible = op > 0.004; }
        holoMat.uniforms.uOp.value = op;
        h.grp.visible = op > 0.003 || (h.pts && h.pts.visible);
      }
      placePicks();
    }
    rim.intensity = 0.45 * (1 - en);
    composer.render();
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
    state: () => ({ state, p: +p.toFixed(3), headsReady, intro: +introT.toFixed(2), assemble: +aT.toFixed(2), chosen }),
    set: v => { introT = 1; aT = 99; target = clamp(v, 0, 1); p = Math.min(target, headsReady === true ? 1 : 0.3); },
    enter, skip,
  };
  window.__hero = api;
  return api;
}
