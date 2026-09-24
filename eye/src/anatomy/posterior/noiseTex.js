// Tileable value-noise texture (4 independent channels) that replaces per-fragment hash noise in the
// posterior-segment shaders. One bilinear fetch returns four noises, and the mip chain anti-aliases them
// for free (unresolved noise fades to its mean instead of sparkling).
//   GLSL: tn4(p) = texture(uNoise, p / 32) — value noise with unit lattice spacing, like vnoise().
import * as THREE from 'three';
import { rng } from '../../lib/materials.js';

let cached = null;

export function noiseTexture(size = 256, cells = 32, seed = 911) {
  if (cached) return cached;
  const data = new Uint8Array(size * size * 4);
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  for (let ch = 0; ch < 4; ch++) {
    const r = rng(seed + ch * 7919);
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    const L = (i, j) => lat[((j + cells) % cells) * cells + ((i + cells) % cells)];
    for (let y = 0; y < size; y++) {
      const fy = ((y + 0.5) / size) * cells, iy = Math.floor(fy), ty = fade(fy - iy);
      for (let x = 0; x < size; x++) {
        const fx = ((x + 0.5) / size) * cells, ix = Math.floor(fx), tx = fade(fx - ix);
        const a = L(ix, iy) + (L(ix + 1, iy) - L(ix, iy)) * tx;
        const b = L(ix, iy + 1) + (L(ix + 1, iy + 1) - L(ix, iy + 1)) * tx;
        data[(y * size + x) * 4 + ch] = Math.round(255 * (a + (b - a) * ty));
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}

// GLSL helpers (expects `uniform sampler2D uNoise;`).
export const GLSL_TNOISE = /* glsl */`
  vec4 tn4(vec2 p) { return texture2D(uNoise, p * 0.03125); }
  float tn(vec2 p) { return texture2D(uNoise, p * 0.03125).r; }
  // 4-octave fbm, octaves rotated so the 32-unit tiling never lines up
  float tfbm(vec2 p) {
    const mat2 M = mat2(0.8, -0.6, 0.6, 0.8);
    float s = 0.5 * tn4(p).r;
    p = M * p * 2.03 + 11.7; s += 0.25 * tn4(p).g;
    p = M * p * 2.01 + 5.3;  s += 0.125 * tn4(p).b;
    p = M * p * 2.02 + 3.1;  s += 0.0625 * tn4(p).a;
    return s * 1.03;
  }
  // hash-based 2D value noise (non-repeating), for the nerve-fibre striae
  float _h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float vnoise2(vec2 x) {
    vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(_h21(i), _h21(i + vec2(1.0, 0.0)), f.x), mix(_h21(i + vec2(0.0, 1.0)), _h21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;
