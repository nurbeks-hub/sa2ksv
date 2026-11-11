// Material plumbing for the iris module: MeshStandardMaterial patched through onBeforeCompile so every layer is lit by
// the production rig (key/rim/under/hemi, the movable cursor light and the PMREM environment) while its geometry is
// driven on the GPU by the live pupil. Each patched material carries uHighlight (a subtle lime rim) and participates in
// ghosting through the standard opacity path; the module's setGhost() drives both.
import * as THREE from 'three';
import { GLSL_NOISE } from '../../lib/materials.js';
import { GLSL_PROFILE } from './profile.js';

// Uniforms shared by every iris material (one object each, so a single update drives all layers).
export const SHARED = {
  uPupil: { value: 1.9 },
  uTime: { value: 0 },
  uVes: { value: 0 },        // vessel-glow mode 0..1
  uViewH: { value: 1080 },   // drawing-buffer height (px), for pixel-width clamping of thin strands
};

const HEAD = /* glsl */`
uniform float uPupil, uTime, uVes, uViewH, uHighlight;
${GLSL_NOISE}
${GLSL_PROFILE}
// screen-space derivative bump for a procedural height h (mm), fragment only
#ifdef IR_FRAGMENT
vec3 irBumpD(vec3 n, vec3 pos, float h) {
  vec3 dpx = dFdx(pos), dpy = dFdy(pos);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  return normalize(abs(det) * n - sign(det) * (dFdx(h) * r1 + dFdy(h) * r2));
}
#endif
`;

// opts: { name, params, uniforms, vHead, vNormal (code that must define vec3 irP and vec3 irN), vProject (optional
// replacement for project_vertex), fHead, fColor (after map_fragment; may edit diffuseColor), fNormal (after
// normal_fragment_maps; may edit normal), fEmissive (after emissivemap_fragment), fBump (replacement for bumpmap pars) }
export function patchedMaterial(opts) {
  const mat = new (opts.Base || THREE.MeshStandardMaterial)(opts.params || {});
  const uniforms = { uHighlight: { value: 0 }, ...opts.uniforms };
  mat.userData.irisUniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, SHARED, uniforms);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', `#include <common>\n${HEAD}\n${opts.vHead || ''}`);
    vs = vs.replace('#include <beginnormal_vertex>', `${opts.vNormal}\nvec3 objectNormal = irN;\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(1.0,0.0,0.0);\n#endif`);
    vs = vs.replace('#include <begin_vertex>', 'vec3 transformed = irP;\n#ifdef USE_ALPHAHASH\nvPosition = irP;\n#endif');
    if (opts.vProject) vs = vs.replace('#include <project_vertex>', opts.vProject);
    fs = fs.replace('#include <common>', `#include <common>\n#define IR_FRAGMENT\n${HEAD}\n${opts.fHead || ''}`);
    if (opts.fBump) fs = fs.replace('#include <bumpmap_pars_fragment>', opts.fBump);
    if (opts.fColor) fs = fs.replace('#include <color_fragment>', `#include <color_fragment>\n${opts.fColor}`);
    if (opts.fNormal) fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${opts.fNormal}`);
    if (opts.fRough) fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${opts.fRough}`);
    if (opts.fAO) fs = fs.replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${opts.fAO}`);
    fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      ${opts.fEmissive || ''}
      {
        float hlF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.5);
        totalEmissiveRadiance += vec3(0.85, 1.0, 0.24) * uHighlight * (0.04 + 0.55 * hlF);
      }`);
    shader.vertexShader = vs; shader.fragmentShader = fs;
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => 'iris-' + opts.name;
  return mat;
}

// Ghost/highlight/vessel-fade for a set of materials of one part.
// ghost: 0..1 (default fade like lib/materials.applyGhost), fade: extra opacity multiplier (vessel mode).
export function setLook(object, mats, ghost, highlight, fade = 1) {
  for (const m of mats) {
    if (!m.userData.__irisBase) m.userData.__irisBase = { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
    const b = m.userData.__irisBase;
    if (m.uniforms) {                                   // ShaderMaterial (vessels)
      if (m.uniforms.uGhost) m.uniforms.uGhost.value = ghost;
      if (m.uniforms.uHighlight) m.uniforms.uHighlight.value = highlight;
      const want = b.transparent || ghost > 0.001;
      if (m.transparent !== want) { m.transparent = want; m.needsUpdate = true; }
      m.depthWrite = ghost > 0.5 ? false : b.depthWrite;
      continue;
    }
    const op = b.opacity * (1 - 0.94 * ghost) * fade;
    const tr = b.transparent || op < 0.999;
    if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
    m.opacity = op;
    m.depthWrite = ghost > 0.35 ? false : b.depthWrite;
    if (m.userData.irisUniforms) m.userData.irisUniforms.uHighlight.value = highlight;
  }
  object.traverse(o => { if (o.isMesh) o.visible = ghost < 0.995; });
}

// Grid geometry helper: (nu+1) x (nv+1) vertices with uv in [0,1]^2 (u wraps around the azimuth with a seam column),
// optional extra per-vertex attribute. flip reverses the winding.
export function gridGeometry(nu, nv, { flip = false, vMap = v => v, attr = null } = {}) {
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
  const uv = new Float32Array((nu + 1) * (nv + 1) * 2);
  let k = 0;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    uv[k * 2] = i / nu; uv[k * 2 + 1] = vMap(j / nv); k++;
  }
  const idx = [];
  const id = (i, j) => j * (nu + 1) + i;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1);
    if (!flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // A normal attribute must exist (its values are replaced in the vertex shader): without one three.js silently
  // compiles standard/phong materials with FLAT_SHADED, i.e. faceted normals from screen-space derivatives.
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array((nu + 1) * (nv + 1) * 3), 3));
  if (attr) g.setAttribute(attr.name, new THREE.BufferAttribute(new Float32Array((nu + 1) * (nv + 1)).fill(attr.value), 1));
  g.setIndex(idx);
  return g;
}

export function irisBounds(g, center = new THREE.Vector3(0, 0, 9.4), radius = 7.2) {
  g.boundingSphere = new THREE.Sphere(center, radius);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-radius, -radius, center.z - 2), new THREE.Vector3(radius, radius, center.z + 2));
  return g;
}
