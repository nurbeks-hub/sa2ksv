// One shader patch applied (via onBeforeCompile) to EVERY material in the scene: lit, ghost, pick, stencil.
// It provides, per vertex:
//   · per-structure state from a data texture (ghost, highlight, dissolve, forced-visible), keyed by the
//     vertex attribute aSid (structure-node index) — this lets ~1000 nodes live in a few merged draw calls;
//   · the sex-morph deformation field (thin-plate / biharmonic RBF, ≤64 centres), blended by uSex, with
//     normals transformed by the cofactor of the field's analytic Jacobian (exact, cheaper than finite
//     differences);
// and per fragment: noise dissolve with a glowing edge, ghost hand-off, bust clipping, section contour glow,
// hover highlight and class-specific shading (wrap/SSS, muscle fibres + anisotropic sheen, bone porosity …).
import * as THREE from 'three';

export const TEXW = 256;
export const MAX_SF = 64;

// ------------------------------------------------------------------ shared uniforms (same objects in all programs)
export const U = {
  uState: { value: null },
  uOffset: { value: null },   // per-structure rigid offset (deep-dive explode / animation): rows t, q, pivot
  uStatic: { value: null },
  uLayerDis: { value: new Float32Array(8) },
  uTime: { value: 0 },
  uSex: { value: 0 },
  uSFCount: { value: 0 },
  uSFC: { value: Array.from({ length: MAX_SF }, () => new THREE.Vector3()) },
  uSFW: { value: Array.from({ length: MAX_SF }, () => new THREE.Vector3()) },
  uSFA: { value: new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0) },
  uSFT: { value: new THREE.Vector3() },
  uEyeDark: { value: 1 },
  uBust: { value: new THREE.Vector4(1.43, 0.2, 0.0, 0.35) },   // bust cut: y0, half-width where a shoulder slope starts, slope, forward rise
  uSecOn: { value: 0 },
  uIntro: { value: 1 },
  uCordY: { value: -10 },
  uEye: { value: new THREE.Vector3(0.0318, 1.5922, 0.0605) },
  uIris: { value: new THREE.Vector3(0.0318, 1.5925, 0.0064) },
  uSexF: { value: 0 },
  uRigInv: { value: new THREE.Matrix4() },
  uLidShade: { value: 1 },
  uBrows: { value: 1 },
};

// ------------------------------------------------------------------ GLSL
const NOISE = /* glsl */`
float hHash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float hNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hHash13(i), hHash13(i + vec3(1,0,0)), f.x), mix(hHash13(i + vec3(0,1,0)), hHash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hHash13(i + vec3(0,0,1)), hHash13(i + vec3(1,0,1)), f.x), mix(hHash13(i + vec3(0,1,1)), hHash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// dissolve field in [0,1]: organic blotches + a gentle top-down bias so layers peel from the crown
float hDisField(vec3 p) {
  float f = 0.6 * hNoise(p * 46.0) + 0.28 * hNoise(p * 131.0) + 0.12 * hNoise(p * 390.0);
  f = clamp((f - 0.22) / 0.56, 0.0, 1.0);
  return clamp(f * 0.8 + (1.745 - p.y) * 0.55 - 0.02, 0.0, 1.0);
}
`;

const VERT_HEAD = /* glsl */`
attribute float aSid;
uniform sampler2D uState;
uniform sampler2D uStatic;
uniform sampler2D uOffset;
uniform float uLayerDis[8];
uniform float uSex;
uniform int uSFCount;
uniform vec3 uSFC[${MAX_SF}];
uniform vec3 uSFW[${MAX_SF}];
uniform mat3 uSFA;
uniform vec3 uSFT;
flat varying vec4 vState;   // ghost, highlight, dissolve (total), forced
flat varying vec4 vTint;    // linear rgb, depth group
flat varying float vSid;
varying vec3 vRest;
#ifdef H_FIBRE
  varying vec3 vFibO;
  varying vec3 vFibV;
#endif
#ifdef H_SKIN
  attribute vec4 aSkinA; attribute vec4 aSkinB; attribute float aSkinC;
  varying vec4 vSkA; varying vec4 vSkB; varying float vSkC;
#endif
#ifdef H_EYEBALL
  uniform mat4 uRigInv;
  varying vec3 vHead;
#endif
vec3 hQrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void hField(vec3 p, out vec3 d, out mat3 J) {
  d = uSFA * p + uSFT; J = uSFA;
  for (int i = 0; i < ${MAX_SF}; i++) {
    if (i >= uSFCount) break;
    vec3 r = p - uSFC[i]; float l = max(length(r), 1e-6);
    d += uSFW[i] * l;
    J += outerProduct(uSFW[i], r / l);
  }
}
`;

const VERT_PROLOGUE = /* glsl */`
  int hSid = int(aSid + 0.5);
  ivec2 hSt = ivec2(hSid % ${TEXW}, hSid / ${TEXW});
  vec4 hS = texelFetch(uState, hSt, 0);
  vec4 hT0 = texelFetch(uStatic, ivec2(hSt.x, hSt.y * 2), 0);
  vec4 hT1 = texelFetch(uStatic, ivec2(hSt.x, hSt.y * 2 + 1), 0);
  vec4 hOT = texelFetch(uOffset, ivec2(hSt.x, hSt.y * 3), 0);
  vec4 hOQ = texelFetch(uOffset, ivec2(hSt.x, hSt.y * 3 + 1), 0);
  vec4 hOP = texelFetch(uOffset, ivec2(hSt.x, hSt.y * 3 + 2), 0);
  bool hHasOff = hOT.w > 0.5;
  float hLd = uLayerDis[int(hT0.a + 0.5)];
  vState = vec4(hS.r, hS.g, mix(max(hLd, hS.b), hS.b, hS.a), hS.a);
  vTint = hT0;
  vSid = float(hSid);
  vRest = position;
  vec3 hD = vec3(0.0); mat3 hJ = mat3(0.0); bool hHasField = uSex > 0.0001 && hT1.w > -0.5 && (uSFCount > 0 || uSFA[0][0] != 0.0 || uSFA[1][1] != 0.0 || uSFA[2][2] != 0.0 || dot(uSFT, uSFT) > 0.0);
  if (hHasField) hField(position, hD, hJ);
  #ifdef H_SKIN
    vSkA = aSkinA; vSkB = aSkinB; vSkC = aSkinC;
  #endif
  #ifdef H_FIBRE
    vec3 hA = hT1.xyz;
    if (hT1.w > 0.5 && hT1.w < 1.5) hA = normalize(position - hT1.xyz);                       // radial fan (e.g. temporalis)
    else if (hT1.w > 1.5) hA = normalize(cross(vec3(0.0, 0.0, 1.0), position - hT1.xyz) + 1e-5); // circular (orbicularis)
    vFibO = hA;
    vFibV = normalize(mat3(modelViewMatrix) * hA);
  #endif
`;

// normals: n' = cof(F) n,  F = I + s·J   (cof(F) = det(F)·F^-T; we normalise afterwards)
const VERT_NORMAL = /* glsl */`
  if (hHasOff) objectNormal = hQrot(hOQ, objectNormal);
  if (hHasField) {
    mat3 hF = mat3(1.0) + uSex * hJ;
    objectNormal = normalize(transpose(inverse(hF)) * objectNormal);
  }
`;
const VERT_DISPLACE = /* glsl */`
  if (hHasField) transformed += uSex * hD;
  if (hHasOff) transformed = hOP.xyz + hQrot(hOQ, transformed - hOP.xyz) + hOT.xyz;
  #ifdef H_SKIN
    vRest = transformed;   // skin: bust cut + noise follow the female morph (clean neck edge for both sexes)
  #endif
  #ifdef H_SKIN
    transformed += normalize(normal) * 0.0012;   // skin floats 1.2 mm off the fitted anatomy: no tissue poking through
  #endif
`;
const VERT_CULL = /* glsl */`
  #ifdef H_EYEBALL
    vHead = (uRigInv * modelMatrix * vec4(transformed, 1.0)).xyz;   // head space: the lids do not rotate with the eye
  #endif
  if (vState.z > 0.999) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);  // fully dissolved: clip the triangle away
  #ifdef H_GHOSTPASS
    if (vState.x < 0.004) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);  // solid (not ghosted) structures skip the glass pass
  #endif
`;

const FRAG_HEAD = /* glsl */`
uniform float uTime;
uniform float uEyeDark;
uniform vec4 uBust;
uniform float uSecOn;
uniform float uIntro;
uniform float uCordY;
uniform vec3 uEye;      // |x|, y, z of the eyeball centres (rest space)
uniform vec3 uIris;     // |x|, y of the iris centre, iris radius
uniform float uSexF;    // eased sex blend (fragment side)
uniform float uBrows;   // 1 = paint procedural brows (off when strand brows are loaded)
flat varying vec4 vState;
flat varying vec4 vTint;
flat varying float vSid;
varying vec3 vRest;
#ifdef H_FIBRE
  varying vec3 vFibO;
  varying vec3 vFibV;
#endif
${NOISE}
`;

// runs right after clipping: bust clip, dissolve, ghost hand-off.  Leaves hDisEdge / hGhostEdge / hN for later.
const FRAG_PROLOGUE = /* glsl */`
  // bust: a clean museum cut across the neck base and over the shoulders
  { float ax = abs(vRest.x); float yb = uBust.x + max(0.0, ax - uBust.y) * uBust.z + max(0.0, vRest.z + 0.005) * uBust.w; if (vRest.y < yb) discard; }
  if (vRest.y < uCordY && int(vTint.a + 0.5) == 6) discard;   // brain layer: keep only a short stub of the spinal cord
  float hN = 0.0;
  float hDisEdge = 0.0, hGhostEdge = 0.0;
  if (vState.z > 0.0 || vState.x > 0.0) hN = hDisField(vRest);
  if (vState.z > 0.0) {
    float thr = vState.z * 1.12 - 0.06;
    if (hN < thr) discard;
    hDisEdge = (vState.z < 0.999) ? 1.0 - smoothstep(0.0, 0.05, hN - thr) : 0.0;
  }
`;
const FRAG_GHOST_HANDOFF = /* glsl */`
  if (vState.x > 0.0) {
    float thg = vState.x * 1.12 - 0.06;
    if (hN < thg) discard;
    hGhostEdge = (vState.x < 0.999) ? 1.0 - smoothstep(0.0, 0.05, hN - thg) : 0.0;
  }
`;

// -------------------------------------------------------------- per-kind patches
function patchVertex(src, withNormals) {
  src = src.replace('#include <common>', '#include <common>\n' + VERT_HEAD);
  src = src.replace('void main() {', 'void main() {\n' + VERT_PROLOGUE);
  if (withNormals) src = src.replace('#include <defaultnormal_vertex>', VERT_NORMAL + '\n#include <defaultnormal_vertex>');
  src = src.replace('#include <morphtarget_vertex>', '#include <morphtarget_vertex>\n' + VERT_DISPLACE);
  src = src.replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_CULL);
  return src;
}

function commonFragHead(src) {
  return src.replace('#include <clipping_planes_pars_fragment>', '#include <clipping_planes_pars_fragment>\n' + FRAG_HEAD);
}

// lit wrap diffuse: skin/brain/bone look softer and warmer in the terminator (cheap subsurface approximation)
function litLightsChunk() {
  let c = THREE.ShaderChunk.lights_physical_pars_fragment;
  const line = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
  if (!c.includes(line)) { console.warn('[head] wrap-lighting hook not found; using stock diffuse'); return c; }
  // skin: a light from behind the head (rim) only lights the silhouette, never backward-facing walls of creases
  const irr = 'vec3 irradiance = dotNL * directLight.color;';
  if (c.includes(irr)) c = c.replace(irr, `vec3 irradiance = dotNL * directLight.color;
    #ifdef H_SKIN
      float hBehind = smoothstep(0.0, -0.35, dot(directLight.direction, geometryViewDir));
      float hSil = 1.0 - smoothstep(0.12, 0.4, dot(geometryNormal, geometryViewDir));
      float hRimK = mix(1.0, hSil, hBehind);
      irradiance *= hRimK;
    #endif`);
  c = c.replace(line, `
    #ifdef H_SKIN
    {
      // skin: red light scatters further (per-channel wrap, stronger in thin tissue) + back-lit transmission
      float hNL = dot( geometryNormal, directLight.direction );
      vec3 hWc = vec3(0.34, 0.19, 0.13) * (1.0 + 1.2 * vSkA.z);
      vec3 hWr = clamp((vec3(hNL) + hWc) / (1.0 + hWc), 0.0, 1.0);
      hWr = mix(hWr, hWr * hWr * (3.0 - 2.0 * hWr), 0.35);
      float hBack = pow(clamp(dot(geometryViewDir, -directLight.direction), 0.0, 1.0), 3.0);
      vec3 hTr = vec3(1.0, 0.3, 0.16) * (hBack * 1.4 + max(0.0, -hNL) * 0.25) * vSkA.z;
      reflectedLight.directDiffuse += directLight.color * (hWr * ( 1.0 - F ) * hRimK + hTr) * BRDF_Lambert( material.diffuseContribution ) * (1.0 - vSkB.z * 0.3);
    }
    #else
    float hNLraw = dot( geometryNormal, directLight.direction );
    float hWrap = saturate( ( hNLraw + H_WRAP ) / ( 1.0 + H_WRAP ) );
    vec3 hSss = H_SSS * saturate( hWrap - saturate( hNLraw ) ) * 2.0;
    reflectedLight.directDiffuse += directLight.color * ( hWrap * ( 1.0 - F ) + hSss ) * BRDF_Lambert( material.diffuseContribution );
    #endif
  `);
  return c;
}

const LIT_COLOR = /* glsl */`
  #include <color_fragment>
  diffuseColor.rgb *= vTint.rgb;
  #ifdef H_SKIN
    {
      // living skin albedo: melanin / haemoglobin mottling, redness (nose, cheeks, ears), darker periorbital
      // skin, lips with a vermilion border, wet lid margins, faint male beard shadow, creases (cavity)
      float hMot = hNoise(vRest * 36.0) * 0.6 + hNoise(vRest * 115.0) * 0.4;
      vec3 hC = diffuseColor.rgb * mix(vec3(0.965, 0.985, 1.0), vec3(1.035, 1.0, 0.965), hMot);
      hC = mix(hC, hC * vec3(1.1, 0.86, 0.84), vSkA.x * 0.42);
      hC *= mix(vec3(1.0), vec3(0.84, 0.8, 0.85), vSkB.w * 0.55);
      float hBeard = vSkA.w * (1.0 - uSexF) * (0.75 + 0.25 * hNoise(vRest * 2400.0));
      hC = mix(hC, hC * vec3(0.74, 0.76, 0.82), hBeard * 0.42);
      vec3 hLip = mix(vec3(0.33, 0.15, 0.13), vec3(0.3, 0.16, 0.14), uSexF) * (0.92 + 0.16 * hNoise(vec3(vRest.x * 900.0, vRest.y * 3000.0, vRest.z * 900.0)));
      hC = mix(hC, hLip, smoothstep(0.15, 1.0, vSkA.y) * mix(0.66, 0.4, uSexF));   // softer vermilion border, esp. ♀
      hC = mix(hC, hC * vec3(0.62, 0.5, 0.5), vSkC * 0.6);
      hC *= 1.0 - vSkB.z * 0.22;
      hC *= 0.98 + 0.04 * hNoise(vRest * 1300.0);
      diffuseColor.rgb = hC;
    }
    {
      // eyebrows painted procedurally on the skin (the fitted skin has no brow mesh): a soft arch of short hairs
      // above each orbit, denser and wider medially; a little finer and higher in the female morph
      float hSx = sign(vRest.x); float ax = abs(vRest.x);
      float hU = (ax - (uEye.x - 0.019)) / 0.045;
      if (uBrows > 0.5 && hU > -0.1 && hU < 1.1 && vRest.z > uEye.z + 0.004) {
        float hArch = sin(3.14159 * clamp(hU * 0.92 + 0.05, 0.0, 1.0));
        float hYc = uEye.y + 0.0168 + 0.0036 * hArch + 0.0012 * uSexF - 0.0022 * max(hU - 0.75, 0.0) * 4.0;
        float hTh = mix(0.0085, 0.0042, clamp(hU, 0.0, 1.0)) * mix(1.0, 0.8, uSexF);
        float hDy = (vRest.y - hYc) / hTh;
        float hMask = (1.0 - smoothstep(0.55, 1.0, abs(hDy))) * smoothstep(-0.1, 0.12, hU) * (1.0 - smoothstep(0.9, 1.1, hU));
        // hair strands slant laterally-upward
        vec2 hQ = vec2(ax * 0.8 + vRest.y * 0.6, vRest.y * 0.8 - ax * 0.6);
        float hStr = hNoise(vec3(hQ.x * 2300.0, hQ.y * 260.0, 3.0)) * 0.65 + hNoise(vec3(hQ.x * 900.0, hQ.y * 120.0, 9.0)) * 0.35;
        float hB = hMask * (0.45 + 0.4 * smoothstep(0.3, 0.8, hStr)) * 0.8;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.05, 0.04), hB);
      }
    }
    // inner surface (dermis tone) only in sections; elsewhere a back face seen through a fold of the fit keeps skin tone
    if (!gl_FrontFacing) diffuseColor.rgb = mix(diffuseColor.rgb * 0.85, vec3(0.42, 0.16, 0.12), uSecOn);
  #endif
  #ifdef H_LASH
  {
    // lash cards without a texture: fine dark strands; the lower lashes sparser
    float hS = hNoise(vec3(vRest.x * 6500.0, vRest.y * 70.0, vRest.z * 70.0));
    float hA = smoothstep(0.66, 0.86, hS) * (vRest.y > uEye.y ? 0.6 : 0.1) * mix(1.0, 0.7, uSexF);
    diffuseColor.rgb = vec3(0.03, 0.024, 0.02);
    diffuseColor.a *= hA;
  }
  #endif
  #ifdef H_BONE
    float hPor = hNoise(vRest * 520.0) * 0.6 + hNoise(vRest * 1500.0) * 0.4;
    diffuseColor.rgb *= 0.91 + 0.12 * hPor;
    diffuseColor.rgb *= mix(vec3(1.0), vec3(1.03, 0.98, 0.9), hNoise(vRest * 30.0));
  #endif
  #ifdef H_FIBRE
    vec3 hA = normalize(vFibO);
    vec3 hU = normalize(cross(hA, abs(hA.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 hV = cross(hA, hU);
    vec3 hQ = vec3(dot(vRest, hU), dot(vRest, hV), dot(vRest, hA));
    float hFine = hNoise(hQ * vec3(1100.0, 1100.0, 45.0));
    float hFas = hNoise(hQ * vec3(260.0, 260.0, 12.0));
    float hAA = clamp(1.6 - length(fwidth(hQ)) * 1100.0, 0.0, 1.0);
    float hFib = mix(0.5, hFine, hAA) * 0.55 + hFas * 0.45;
    diffuseColor.rgb *= 0.8 + 0.4 * hFib;
  #endif
  #ifdef H_BRAIN
    diffuseColor.rgb *= 0.96 + 0.08 * hNoise(vRest * 300.0);
  #endif
  #ifdef H_EYEIN
    diffuseColor.rgb *= 1.0 - uEyeDark * 0.985;
  #endif
  #ifdef H_VESSEL
    if (!gl_FrontFacing) diffuseColor.rgb *= 0.28;
  #endif
  #ifdef H_SCLERA
  {
    // sclera: warmer toward the canthi, faint vessels toward the periphery
    vec3 hEc = vec3(sign(vRest.x) * uEye.x, uEye.y, uEye.z);
    vec3 hDr = normalize(vRest - hEc);
    float hCorner = smoothstep(0.35, 0.9, abs(hDr.x)) * (1.0 - smoothstep(0.25, 0.65, abs(hDr.y)));
    vec3 hSc = diffuseColor.rgb * mix(vec3(1.0), vec3(1.05, 0.92, 0.84), hCorner * 0.7 + (1.0 - hDr.z) * 0.15);
    float hV1 = abs(hNoise(vRest * 780.0) - 0.5), hV2 = abs(hNoise(vRest * 1700.0 + 3.1) - 0.5);
    float hVes = ((1.0 - smoothstep(0.0, 0.03, hV1)) + 0.6 * (1.0 - smoothstep(0.0, 0.025, hV2))) * smoothstep(0.75, 0.3, hDr.z) * (0.35 + 0.65 * hCorner);
    hSc = mix(hSc, vec3(0.5, 0.1, 0.08), clamp(hVes, 0.0, 1.0) * 0.38);
    diffuseColor.rgb = hSc;
  }
  #endif
  #ifdef H_IRIS
  {
    // procedural iris (dark brown): radial stromal fibres, amber collarette, dark limbal ring
    vec2 hIc = vec2(sign(vRest.x) * uIris.x, uIris.y);
    vec2 hId = vRest.xy - hIc; float hR = length(hId) / uIris.z; float hAng = atan(hId.y, hId.x);
    float hF = hNoise(vec3(hAng * 24.0, hR * 5.0, 1.0)) * 0.55 + hNoise(vec3(hAng * 70.0, hR * 16.0, 7.0)) * 0.45;
    vec3 hCol = mix(vec3(0.085, 0.042, 0.018), vec3(0.042, 0.022, 0.011), smoothstep(0.45, 0.9, hR));
    hCol *= 0.6 + 0.8 * hF;
    hCol += vec3(0.05, 0.026, 0.008) * (1.0 - smoothstep(0.0, 0.09, abs(hR - 0.47))) * (0.6 + 0.6 * hF);
    hCol = mix(hCol, vec3(0.018, 0.012, 0.01), smoothstep(0.84, 1.0, hR));
    hCol *= 0.75 + 0.25 * smoothstep(0.2, 0.34, hR);   // pupillary ruff (the pupil itself is the real aperture)
    float hCr = smoothstep(0.68, 0.86, hNoise(vec3(hAng * 11.0, hR * 7.0, 4.0))) * smoothstep(0.36, 0.5, hR) * (1.0 - smoothstep(0.72, 0.85, hR));
    hCol *= 1.0 - 0.55 * hCr;                            // Fuchs crypts
    diffuseColor.rgb = hCol;
  }
  #endif
  if (vState.y < 0.0) { float hDm = -vState.y; float hL = dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(hL) * vec3(0.95, 0.95, 1.0), hDm * 0.55) * (1.0 - hDm * 0.55); }   // deep-dive context: dimmed
  #ifdef H_EYEBALL
  {
    // soft shadow of the upper lid and lid occlusion at the canthi (head space: the lids stay put)
    vec3 hEc2 = vec3(sign(vHead.x) * uEye.x, uEye.y, uEye.z);
    vec3 hDh = normalize(vHead - hEc2);
    float hSh = 1.0 - 0.55 * smoothstep(0.05, 0.42, hDh.y) - 0.25 * smoothstep(0.55, 0.95, abs(hDh.x)) - 0.15 * smoothstep(-0.2, -0.5, hDh.y);
    diffuseColor.rgb *= mix(1.0, hSh, uLidShade);
  }
  #endif
`;

// skin micro-relief: pores (larger on nose/cheeks) and fine skin grain as a screen-space bump
const SKIN_BUMP = /* glsl */`
  #include <normal_fragment_maps>
  #ifdef H_SKIN
  {
    // folded fitting creases leave front faces whose normals point away from the viewer; they would catch the
    // back light as bright slivers. Bend such normals back to the silhouette plane.
    { vec3 hVv = normalize(vViewPosition); float hNv = dot(normal, hVv); if (hNv < 0.05) normal = normalize(normal + hVv * (0.05 - hNv)); }
    float hPs = mix(2700.0, 1500.0, vSkB.x);
    float hPn = hNoise(vRest * hPs);
    float hH = -smoothstep(0.72, 0.93, hPn) * 0.5 + (hNoise(vRest * 1900.0 + 7.7) - 0.5) * 0.12;
    float hFw = length(fwidth(vRest)) * hPs;
    hH *= 0.00003 * (0.35 + 1.0 * vSkB.x) * (1.0 - vSkA.y * 0.6) * clamp(1.6 - hFw, 0.0, 1.0);
    vec3 hPos = -vViewPosition;
    vec3 hDpx = dFdx(hPos), hDpy = dFdy(hPos);
    float hDhx = dFdx(hH), hDhy = dFdy(hH);
    vec3 hR1 = cross(hDpy, normal), hR2 = cross(normal, hDpx);
    float hDet = dot(hDpx, hR1);
    vec3 hGrad = sign(hDet) * (hDhx * hR1 + hDhy * hR2);
    normal = normalize(abs(hDet) * normal - hGrad);
  }
  #endif
`;
const SKIN_ROUGH = /* glsl */`
  #include <roughnessmap_fragment>
  #ifdef H_SKIN
    roughnessFactor = mix(roughnessFactor, 0.4, vSkB.y * 0.55);                 // oilier T-zone
    roughnessFactor = mix(roughnessFactor, mix(0.34, 0.5, uSexF), clamp(vSkA.y * 0.6, 0.0, 1.0));   // lips (♀ softer sheen)
    roughnessFactor = mix(roughnessFactor, 0.3, clamp(vSkC, 0.0, 1.0));   // wet lid margin
    roughnessFactor += (hNoise(vRest * 240.0) - 0.5) * 0.08;
  #endif
`;
const EARLY_DECL = /* glsl */`
#ifdef H_SKIN
  varying vec4 vSkA; varying vec4 vSkB; varying float vSkC;
#endif
#ifdef H_EYEBALL
  varying vec3 vHead;
  uniform float uLidShade;
#endif
`;

const LIT_EMISSIVE = /* glsl */`
  #include <emissivemap_fragment>
  {
    vec3 hV = normalize(vViewPosition);
    vec3 hNn = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
    float hFr = pow(1.0 - clamp(abs(dot(hNn, hV)), 0.0, 1.0), 3.0);
    totalEmissiveRadiance += vec3(1.0, 0.52, 0.22) * hDisEdge * mix(2.2, 0.9, uSecOn);
    totalEmissiveRadiance += vec3(0.55, 0.75, 1.0) * hGhostEdge * 1.4;
    totalEmissiveRadiance += (vTint.rgb * 0.22 + vec3(0.05, 0.045, 0.04) + vec3(0.9, 0.75, 0.55) * hFr * 0.55) * max(vState.y, 0.0);
    #if NUM_CLIPPING_PLANES > 0
      float hKd = clippingPlanes[0].w - dot(vClipPosition, clippingPlanes[0].xyz);
      totalEmissiveRadiance += vec3(1.0, 0.7, 0.42) * uSecOn * exp(-max(hKd, 0.0) / 0.00035) * 0.9;
    #endif
  }
`;

const LIT_AFTER_LIGHTS = /* glsl */`
  #include <lights_fragment_end>
  #ifdef H_FIBRE
    #if NUM_DIR_LIGHTS > 0
    {
      vec3 hT = normalize(vFibV - normal * dot(normal, vFibV));
      vec3 hH = normalize(directionalLights[0].direction + geometryViewDir);
      float hTh = dot(hT, hH);
      float hK = pow(sqrt(max(0.0, 1.0 - hTh * hTh)), 64.0) * saturate(dot(normal, directionalLights[0].direction) + 0.3);
      reflectedLight.directSpecular += directionalLights[0].color * hK * 0.085 * (0.55 + 0.9 * hFib);
    }
    #endif
  #endif
  #ifdef H_SKIN
    { float hFr = pow(1.0 - saturate(dot(normal, geometryViewDir)), 4.0); reflectedLight.indirectSpecular += hFr * 0.022 * vec3(1.0, 0.84, 0.76) * (1.0 - vSkB.z); }
    #if NUM_DIR_LIGHTS > 0
    {
      // second, sharper specular lobe (dual-lobe skin: ~0.3 + the base ~0.55), weighted by oiliness
      vec3 hL = directionalLights[0].direction; vec3 hH = normalize(hL + geometryViewDir);
      float hNh = saturate(dot(normal, hH)), hNl = saturate(dot(normal, hL)), hVh = saturate(dot(geometryViewDir, hH));
      float hA2 = 0.09 * 0.09; float hDd = hNh * hNh * (hA2 - 1.0) + 1.0;
      float hD = hA2 / (3.14159 * hDd * hDd);
      float hF = 0.028 + 0.972 * pow(1.0 - hVh, 5.0);
      reflectedLight.directSpecular += directionalLights[0].color * hD * hF * 0.25 * hNl * (0.12 + 0.88 * vSkB.y) * (1.0 - vSkB.z * 0.7) * 0.4;
    }
    #endif
  #endif
`;

// ---------------------------------------------------------------- material factory
const CLASS_DEFINES = {
  skin: { H_SKIN: 1, H_WRAP: 0.42, H_SSS: 'vec3(0.1, 0.035, 0.02)' },
  hair: { H_WRAP: 0.2, H_SSS: 'vec3(0.0)' },
  hairFine: { H_LASH: 1, H_WRAP: 0.2, H_SSS: 'vec3(0.0)' },
  muscle: { H_FIBRE: 1, H_WRAP: 0.35, H_SSS: 'vec3(0.22, 0.02, 0.01)' },
  tongue: { H_WRAP: 0.4, H_SSS: 'vec3(0.25, 0.04, 0.03)' },
  tendon: { H_WRAP: 0.3, H_SSS: 'vec3(0.06, 0.06, 0.07)' },
  fascia: { H_WRAP: 0.3, H_SSS: 'vec3(0.06, 0.06, 0.07)' },
  artery: { H_VESSEL: 1, H_WRAP: 0.3, H_SSS: 'vec3(0.2, 0.01, 0.01)' },
  vein: { H_VESSEL: 1, H_WRAP: 0.3, H_SSS: 'vec3(0.02, 0.02, 0.12)' },
  nerve: { H_WRAP: 0.4, H_SSS: 'vec3(0.12, 0.09, 0.02)' },
  lymph: { H_WRAP: 0.45, H_SSS: 'vec3(0.06, 0.12, 0.03)' },
  bone: { H_BONE: 1, H_WRAP: 0.38, H_SSS: 'vec3(0.14, 0.09, 0.035)' },
  tooth: { H_WRAP: 0.35, H_SSS: 'vec3(0.1, 0.1, 0.08)' },
  cartilage: { H_WRAP: 0.5, H_SSS: 'vec3(0.05, 0.08, 0.1)' },
  ligament: { H_WRAP: 0.35, H_SSS: 'vec3(0.06, 0.06, 0.05)' },
  disc: { H_WRAP: 0.5, H_SSS: 'vec3(0.05, 0.08, 0.08)' },
  air: { H_WRAP: 0.2, H_SSS: 'vec3(0.0)' },
  gland: { H_WRAP: 0.45, H_SSS: 'vec3(0.18, 0.08, 0.03)' },
  thyroid: { H_WRAP: 0.45, H_SSS: 'vec3(0.2, 0.03, 0.02)' },
  mucosa: { H_WRAP: 0.45, H_SSS: 'vec3(0.22, 0.05, 0.04)' },
  gingiva: { H_WRAP: 0.45, H_SSS: 'vec3(0.22, 0.05, 0.04)' },
  ear: { H_WRAP: 0.35, H_SSS: 'vec3(0.1, 0.08, 0.05)' },
  cortex: { H_BRAIN: 1, H_WRAP: 0.42, H_SSS: 'vec3(0.14, 0.05, 0.04)' },
  sulcus: { H_BRAIN: 1, H_WRAP: 0.42, H_SSS: 'vec3(0.14, 0.05, 0.04)' },
  cerebellum: { H_BRAIN: 1, H_WRAP: 0.42, H_SSS: 'vec3(0.14, 0.05, 0.04)' },
  brainstem: { H_BRAIN: 1, H_WRAP: 0.42, H_SSS: 'vec3(0.1, 0.07, 0.05)' },
  white: { H_BRAIN: 1, H_WRAP: 0.45, H_SSS: 'vec3(0.1, 0.08, 0.06)' },
  deepgrey: { H_BRAIN: 1, H_WRAP: 0.42, H_SSS: 'vec3(0.14, 0.05, 0.04)' },
  nucleus: { H_WRAP: 0.42, H_SSS: 'vec3(0.14, 0.04, 0.03)' },
  plexus: { H_WRAP: 0.45, H_SSS: 'vec3(0.2, 0.03, 0.03)' },
  pituitary: { H_WRAP: 0.45, H_SSS: 'vec3(0.16, 0.06, 0.03)' },
  csf: { H_WRAP: 0.3, H_SSS: 'vec3(0.0)' },
  meninges: { H_WRAP: 0.3, H_SSS: 'vec3(0.0)' },
  sclera: { H_SCLERA: 1, H_EYEBALL: 1, H_WRAP: 0.4, H_SSS: 'vec3(0.12, 0.06, 0.05)' },
  cornea: { H_WRAP: 0.0, H_SSS: 'vec3(0.0)' },
  iris: { H_IRIS: 1, H_EYEBALL: 1, H_WRAP: 0.3, H_SSS: 'vec3(0.05, 0.02, 0.0)' },
  lens: { H_EYEIN: 1, H_WRAP: 0.3, H_SSS: 'vec3(0.0)' },
  retina: { H_EYEIN: 1, H_WRAP: 0.3, H_SSS: 'vec3(0.1, 0.02, 0.01)' },
  vitreous: { H_EYEIN: 1, H_WRAP: 0.3, H_SSS: 'vec3(0.0)' },
  ciliary: { H_EYEIN: 1, H_WRAP: 0.3, H_SSS: 'vec3(0.0)' },
};

export function classDefines(cls) {
  const d = Object.assign({}, CLASS_DEFINES[cls] || { H_WRAP: 0.3, H_SSS: 'vec3(0.0)' });
  d.H_WRAP = Number(d.H_WRAP).toFixed(3);   // GLSL needs a float literal
  return d;
}

function attachUniforms(shader) { for (const k in U) shader.uniforms[k] = U[k]; }

// lit (MeshStandardMaterial) patch
export function patchLit(mat, cls) {
  const defs = classDefines(cls);
  mat.defines = Object.assign({}, mat.defines || {}, defs);
  mat.onBeforeCompile = (shader) => {
    attachUniforms(shader);
    shader.vertexShader = patchVertex(shader.vertexShader, true);
    let f = commonFragHead(shader.fragmentShader);
    f = f.replace('#include <common>', '#include <common>\n' + EARLY_DECL);
    f = f.replace('#include <normal_fragment_maps>', SKIN_BUMP);
    f = f.replace('#include <roughnessmap_fragment>', SKIN_ROUGH);
    f = f.replace('#include <lights_physical_pars_fragment>', litLightsChunk());
    f = f.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG_PROLOGUE + FRAG_GHOST_HANDOFF);
    f = f.replace('#include <color_fragment>', LIT_COLOR);
    f = f.replace('#include <emissivemap_fragment>', LIT_EMISSIVE);
    f = f.replace('#include <lights_fragment_end>', LIT_AFTER_LIGHTS);
    shader.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => 'lit:' + cls + ':' + mat.side + ':' + mat.transparent;
  return mat;
}

// ghost: cheap fresnel glass (MeshMatcapMaterial base: normals + view dir, no lights)
export function patchGhost(mat) {
  mat.defines = Object.assign({}, mat.defines || {}, { H_GHOSTPASS: 1 });
  mat.onBeforeCompile = (shader) => {
    attachUniforms(shader);
    shader.vertexShader = patchVertex(shader.vertexShader, true);
    let f = commonFragHead(shader.fragmentShader);
    f = f.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG_PROLOGUE + `
      if (vState.x < 0.004) discard;
      float hGs = vState.x;
      if (hGs < 0.999 && hN > hGs * 1.12 - 0.06 + 0.05) discard;   // not yet handed off from the solid
    `);
    f = f.replace('vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;', `
      float hFr = pow(1.0 - clamp(abs(dot(normal, viewDir)), 0.0, 1.0), 2.6);
      vec3 hCol = mix(vec3(0.58, 0.68, 0.82), vTint.rgb * 1.3 + 0.1, 0.4);
      vec3 outgoingLight = hCol;
      int hG = int(vTint.a + 0.5);
      float hK = hG == 6 ? 0.1 : hG == 4 ? 0.75 : hG == 5 ? 0.55 : 1.0;   // brain / bone / viscera ghosts are dense: keep them fainter
      diffuseColor.a = (0.002 + hFr * 0.075) * hK * hGs * (1.0 - vState.z);
    `);
    shader.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => 'ghost';
  return mat;
}

// pick: writes (sid+1) as 24-bit colour.  Ghosted / dissolved fragments are transparent to picking.
export function patchPick(mat) {
  mat.onBeforeCompile = (shader) => {
    attachUniforms(shader);
    shader.vertexShader = patchVertex(shader.vertexShader, false);
    let f = commonFragHead(shader.fragmentShader);
    f = f.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG_PROLOGUE + `
      if (vState.x > 0.5) discard;
    `);
    f = f.replace('#include <opaque_fragment>', `
      float hId = vSid + 1.0;
      gl_FragColor = vec4(mod(hId, 256.0) / 255.0, mod(floor(hId / 256.0), 256.0) / 255.0, floor(hId / 65536.0) / 255.0, 1.0);
    `);
    f = f.replace('#include <tonemapping_fragment>', '').replace('#include <colorspace_fragment>', '');
    shader.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => 'pick';
  return mat;
}

// stencil: parity passes for section caps (colour writes off)
export function patchStencil(mat) {
  mat.onBeforeCompile = (shader) => {
    attachUniforms(shader);
    shader.vertexShader = patchVertex(shader.vertexShader, false);
    let f = commonFragHead(shader.fragmentShader);
    f = f.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG_PROLOGUE + `
      if (vState.x > 0.5 || vState.z > 0.02) discard;   // ghosted or dissolving structures are not capped
    `);
    shader.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => 'stencil:' + mat.side;
  return mat;
}

// cap plane: lit flat plate in tissue colour with a subtle procedural texture; bust-clipped.
export function patchCap(mat, capName) {
  mat.defines = Object.assign({}, mat.defines || {}, { ['CAP_' + capName.toUpperCase()]: 1, H_WRAP: '0.300', H_SSS: 'vec3(0.0)' });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBust = U.uBust; shader.uniforms.uTime = U.uTime; shader.uniforms.uCapInv = { value: mat.userData.inv };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCapW;\nuniform mat4 uCapInv;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCapW = (uCapInv * modelMatrix * vec4(transformed, 1.0)).xyz;');
    let f = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCapW;\nuniform vec4 uBust;\n' + NOISE);
    f = f.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      { float ax = abs(vCapW.x); float yb = uBust.x + max(0.0, ax - uBust.y) * uBust.z + max(0.0, vCapW.z + 0.005) * uBust.w; if (vCapW.y < yb) discard; }`);
    f = f.replace('#include <color_fragment>', `#include <color_fragment>
      #ifdef CAP_BONE
        { float t = hNoise(vCapW * 900.0) * 0.6 + hNoise(vCapW * 2600.0) * 0.4; diffuseColor.rgb *= 0.78 + 0.3 * smoothstep(0.25, 0.75, t); }
      #endif
      #ifdef CAP_MUSCLE
        { float t = hNoise(vCapW * 1400.0); diffuseColor.rgb *= 0.82 + 0.3 * t; }
      #endif
      #if defined(CAP_CORTEX) || defined(CAP_CEREBELLUM) || defined(CAP_DEEPGREY)
        { float t = hNoise(vCapW * 500.0); diffuseColor.rgb *= 0.95 + 0.08 * t; }
      #endif
    `);
    f = f.replace('#include <lights_physical_pars_fragment>', litLightsChunk());
    shader.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => 'cap:' + capName;
  return mat;
}
