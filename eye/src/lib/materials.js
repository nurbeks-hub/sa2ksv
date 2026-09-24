// Shared material helpers: ghosting (fade a part to a silhouette), hover highlight, seeded RNG, noise.
import * as THREE from 'three';

export function rng(seed = 1) {
  // mulberry32
  let a = seed >>> 0;
  const f = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.normal = () => { let u = 0, v = 0; while (u === 0) u = f(); while (v === 0) v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  return f;
}

// Remember the authored opacity/transparency so ghosting can be undone exactly.
export function remember(mat) {
  if (!mat.userData.__base) {
    mat.userData.__base = {
      opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite,
      emissive: mat.emissive ? mat.emissive.clone() : null, emissiveIntensity: mat.emissiveIntensity ?? 1,
    };
  }
  return mat.userData.__base;
}

const HL = new THREE.Color(0xd8ff3e);

// Default ghost/highlight for any part. ghost: 0 = normal, 1 = almost invisible silhouette.
// Custom ShaderMaterials participate by declaring uniforms uGhost / uHighlight.
export function applyGhost(object, ghost, highlight = 0) {
  object.traverse(o => {
    if (!o.isMesh && !o.isLine && !o.isLineSegments && !o.isPoints && !o.isInstancedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.uniforms && (m.uniforms.uGhost || m.uniforms.uHighlight)) {
        if (m.uniforms.uGhost) m.uniforms.uGhost.value = ghost;
        if (m.uniforms.uHighlight) m.uniforms.uHighlight.value = highlight;
        const b = remember(m);
        const want = b.transparent || ghost > 0.001;
        if (m.transparent !== want) { m.transparent = want; m.needsUpdate = true; }
        m.depthWrite = ghost > 0.5 ? false : b.depthWrite;
        continue;
      }
      const b = remember(m);
      const opacity = b.opacity * (1 - 0.94 * ghost);
      const transparent = b.transparent || ghost > 0.001;
      if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true; }
      m.opacity = opacity;
      m.depthWrite = ghost > 0.35 ? false : b.depthWrite;
      if (m.emissive && b.emissive) {
        m.emissive.copy(b.emissive).lerp(HL, highlight * 0.5);
        m.emissiveIntensity = b.emissiveIntensity + highlight * 0.35;
      }
    }
    o.visible = ghost < 0.995;
  });
}

// Cheap value noise for procedural textures (CPU side).
export function makeNoise2(seed = 7) {
  const r = rng(seed); const P = new Uint8Array(512); const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
  return (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y), A = P[X] + Y, B = P[X + 1] + Y;
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(grad(P[A], x, y), grad(P[B], x - 1, y), u),
      THREE.MathUtils.lerp(grad(P[A + 1], x, y - 1), grad(P[B + 1], x - 1, y - 1), u), v) * 0.7071 + 0.5; // ~[0,1]
  };
}

// Canvas-backed texture helper for procedural maps.
export function canvasTexture(w, h, draw, { srgb = true, repeat = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.needsUpdate = true;
  return t;
}

// GLSL snippet shared by custom shaders.
export const GLSL_NOISE = /* glsl */`
  vec3 _h3(vec3 p){p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yxz+33.33);return fract((p.xxy+p.yxx)*p.zyx);}
  float vnoise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
    float n=mix(mix(mix(_h3(i).x,_h3(i+vec3(1,0,0)).x,f.x),mix(_h3(i+vec3(0,1,0)).x,_h3(i+vec3(1,1,0)).x,f.x),f.y),
               mix(mix(_h3(i+vec3(0,0,1)).x,_h3(i+vec3(1,0,1)).x,f.x),mix(_h3(i+vec3(0,1,1)).x,_h3(i+vec3(1,1,1)).x,f.x),f.y),f.z);return n;}
  float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*vnoise(p);p*=2.03;a*=.5;}return s;}
`;
