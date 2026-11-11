// Tissue materials for the orbit module. All are MeshPhysicalMaterial (so they sit in the production
// light rig and ghost through the default applyGhost opacity path) with procedural detail injected in
// onBeforeCompile: fibre / fascicle patterns, analytic bump, wrap-lighting "subsurface" warmth and
// section-based occlusion. No textures are sampled.
import * as THREE from 'three';
import { GLSL_NOISE } from '../../lib/materials.js';

// Scale-correct bump from a scalar height (mm) using screen-space derivatives of the view position.
const GLSL_BUMP = /* glsl */`
  vec3 orbBump(vec3 N, float h) {
    vec3 p = -vViewPosition;
    vec3 dpdx = dFdx(p), dpdy = dFdy(p);
    float dhx = dFdx(h), dhy = dFdy(h);
    vec3 r1 = cross(dpdy, N), r2 = cross(N, dpdx);
    float det = dot(dpdx, r1);
    float ad = abs(det);
    if (ad < 1e-14) return N;
    vec3 g = sign(det) * (dhx * r1 + dhy * r2) / ad;
    float gl = length(g);
    if (gl > 0.8) g *= 0.8 / gl;                       // cap the slope
    vec3 nn = normalize(N - g);
    float ndv = dot(N, normalize(vViewPosition));
    return normalize(mix(N, nn, smoothstep(0.03, 0.3, ndv)));   // no bump on silhouettes (no glints)
  }
  float orbN2(vec3 p) { return 0.64 * vnoise(p) + 0.36 * vnoise(p * 2.03 + 17.0); }
  vec2 orbHash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
  // Voronoi: x = F1, y = F2 - F1 (edge distance proxy), z = cell hash
  vec3 orbVoronoi(vec2 x) {
    vec2 n = floor(x), f = fract(x);
    float f1 = 8.0, f2 = 8.0; float id = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = orbHash2(n + g);
      o = 0.5 + 0.42 * sin(6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; id = fract(o.x * 13.7 + o.y * 7.3); } else if (d < f2) { f2 = d; }
    }
    f1 = sqrt(f1); f2 = sqrt(f2);
    return vec3(f1, f2 - f1, id);
  }
`;

// Common wrap/translucency light term (directional lights of the stage) + occlusion.
function sssChunk(colorExpr, thinExpr, aoExpr) {
  return /* glsl */`
  {
    vec3 sssCol = ${colorExpr};
    float thin = clamp(${thinExpr}, 0.0, 1.0);
    float aoF = ${aoExpr};
    vec3 sssAcc = vec3(0.0);
    #if NUM_DIR_LIGHTS > 0
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
      sssAcc += directionalLights[ i ].color * ( (max(0.0, (dot(normal, directionalLights[ i ].direction) + 0.6) / 1.6) - 0.8 * max(0.0, dot(normal, directionalLights[ i ].direction))) * 0.4 + pow(max(0.0, dot(-geometryViewDir, directionalLights[ i ].direction)), 3.0) * thin * 0.9 );
    }
    #pragma unroll_loop_end
    #endif
    reflectedLight.directDiffuse += sssAcc * sssCol;
    reflectedLight.indirectDiffuse *= aoF;
    reflectedLight.indirectSpecular *= mix(aoF, 1.0, 0.35);
    reflectedLight.directDiffuse *= mix(1.0, aoF, 0.4);
  }`;
}

// Soft-knee highlight compression (keeps key/rim-light specular peaks under the stage bloom threshold,
// so wet tissue does not throw CG "stars") and base-layer specular anti-aliasing.
const GLSL_KNEE = /* glsl */`
  {
    float mK = max(outgoingLight.r, max(outgoingLight.g, outgoingLight.b));
    if (mK > 0.7) outgoingLight *= (0.7 + (mK - 0.7) / (1.0 + 3.0 * (mK - 0.7))) / mK;
  }`;
const GLSL_SPEC_AA = 'material.roughness = min(max(material.roughness, 0.35 * length(fwidth(normal))), 1.0);';

function makeMaterial({ key, params, uniforms, vPars = '', vNorm = '', vMain = '', fPars = '', color = '', rough = '', normal = '', phys = '', light = '', final = '' }) {
  const mat = new THREE.MeshPhysicalMaterial(params);
  mat.userData.orbitUniforms = uniforms;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${vPars}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${vNorm}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vMain}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\n${fPars}`)
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${GLSL_BUMP}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${color}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${rough}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${normal}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${GLSL_SPEC_AA}\n${phys}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${light}`)
      .replace('#include <opaque_fragment>', `${final}\n${GLSL_KNEE}\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

// ---------------------------------------------------------------------------------------------
// Extraocular muscle: fleshy belly with fascicle striations and perimysium seams, glossy
// tendons with collagen crimp, interdigitating musculotendinous junction, cartilage (trochlea).
export function muscleMaterial({ seed = 1, length = 40, twist = 0, twistEnd = 0 } = {}) {
  const uniforms = { uSeed: { value: seed }, uVessels: { value: 0 }, uLen: { value: length }, uTwist: { value: twist }, uTwistEnd: { value: twistEnd } };
  return makeMaterial({
    key: 'orbit-muscle-v15',
    uniforms,
    params: {
      color: 0xffffff, roughness: 0.5, metalness: 0, clearcoat: 1.0, clearcoatRoughness: 0.3,
      ior: 1.42, specularIntensity: 0.65,
    },
    vPars: `${GLSL_NOISE}
      uniform float uSeed;
      attribute vec3 aMU; attribute vec2 aSec; attribute float aTend; attribute float aKind;
      varying vec3 vMU; varying vec2 vSec; varying float vTend; varying float vKind; varying vec4 vLow;`,
    vMain: /* glsl */`
      vMU = aMU; vSec = aSec; vTend = aTend; vKind = aKind;
      vec3 lw = vec3(aMU.x * 0.32, aMU.y * 0.045, uSeed);
      vLow = vec4(0.64 * vnoise(lw) + 0.36 * vnoise(lw * 2.03 + 17.0),
                  vnoise(vec3(aMU.x * 0.28, aMU.y * 0.07, uSeed * 0.37)),
                  vnoise(vec3(aMU.x * 0.9, aMU.y * 0.1, uSeed + 4.0)),
                  vnoise(vec3(aMU.x * 0.7, aMU.y * 0.22, uSeed + 13.0)));`,
    fPars: /* glsl */`
      uniform float uSeed, uVessels, uLen, uTwist, uTwistEnd;
      varying vec3 vMU; varying vec2 vSec; varying float vTend; varying float vKind; varying vec4 vLow;
      float gTend, gCart, gPeri, gFib, gTf, gFine, gH, gIns;
    `,
    color: /* glsl */`
      {
        float lat = vMU.x, al = vMU.y;
        float px = max(length(fwidth(vMU.xy)), 1e-4);
        gFine = 1.0 - smoothstep(0.012, 0.05, px);
        float gMid = 1.0 - smoothstep(0.04, 0.16, px);
        gCart = step(1.5, vKind);
        // fascicles: long parallel bundles (~0.38 mm) whose borders wander gently along the muscle
        float warp = (vLow.x - 0.5) * 2.4;
        float uF = lat / 0.38 + warp + 0.45 * sin(lat * 3.7 + vLow.y * 4.0);
        float fid = floor(uF), fu = fract(uF);
        float edge = min(fu, 1.0 - fu);
        float fh = fract(sin((fid + uSeed * 3.1) * 127.1) * 43758.5453);
        // musculotendinous junction: each fascicle ends at its own level, with rounded tips
        float jag = (fh - 0.5) * 0.9 + (vnoise(vec3(lat * 14.0, 1.7, uSeed)) - 0.5) * 0.3 - (0.5 - edge) * 0.3;
        gTend = smoothstep(-0.7, 0.7, vTend + jag);
        gIns = 0.0;
        vec3 belly = vec3(0.0), tendC = vec3(0.0), cart = vec3(0.0);
        float hB = 0.0, hT = 0.0, hC = 0.0;
        gPeri = 0.0; gFib = 0.5; gTf = 0.5;
        if (gTend < 0.999 && gCart < 0.5) {
          float uF2 = lat / 0.21 + warp * 1.4 + 7.0;
          float edge2 = min(fract(uF2), 1.0 - fract(uF2));
          float split = smoothstep(0.55, 0.78, vLow.z);
          float fh2 = fract(sin((fid + uSeed * 1.7) * 311.7) * 23421.631);
          float peri = (1.0 - smoothstep(0.0, 0.16, edge)) * (0.35 + 0.65 * fh2);
          peri = max(peri, (1.0 - smoothstep(0.0, 0.12, edge2)) * split * 0.8);
          gFib = vnoise(vec3(lat * 42.0, al * 0.55, uSeed + 2.0));
          float fib2 = gFine > 0.01 ? vnoise(vec3(lat * 90.0, al * 1.2, uSeed + 5.0)) : 0.5;
          float blot = vLow.y;
          float streak = smoothstep(0.65, 0.92, vnoise(vec3(lat * 5.5, al * 0.07, uSeed + 3.0))) * smoothstep(-3.5, 0.0, vTend + jag);
          vec3 deep = vec3(0.052, 0.008, 0.006), mid = vec3(0.155, 0.024, 0.017), hi = vec3(0.27, 0.05, 0.034);
          float tone = 0.25 + 0.4 * fh + 0.35 * blot;
          belly = mix(deep, mid, smoothstep(0.1, 0.85, tone));
          belly = mix(belly, hi, smoothstep(0.6, 0.95, gFib) * 0.35 * gFine);
          belly *= mix(1.0, 0.55, peri * gMid);
          // perimysial vessels seen through the epimysium: thin wandering dark-red lines along the belly
          float vw = vnoise(vec3(lat * 0.55 + (vLow.y - 0.5) * 1.6, al * 0.11, uSeed + 31.0));
          float ves = (1.0 - smoothstep(0.006, 0.022, abs(vw - 0.5))) * gMid * (1.0 - smoothstep(-2.0, 0.5, vTend + jag));
          belly = mix(belly, vec3(0.085, 0.006, 0.02), ves * 0.75);
          belly = mix(belly, vec3(0.36, 0.22, 0.18), peri * smoothstep(0.6, 0.92, vnoise(vec3(lat * 2.5, al * 0.25, uSeed + 8.0))) * 0.5 * gMid);
          belly = mix(belly, vec3(0.46, 0.39, 0.34), streak * 0.28);
          gPeri = peri;
          hB = (0.04 * sqrt(clamp(edge * 2.0, 0.0, 1.0)) + 0.012 * sqrt(clamp(edge2 * 2.0, 0.0, 1.0)) * split) * mix(0.4, 1.0, gMid) + (0.006 * gFib + 0.002 * fib2) * gFine;
        }
        if (gTend > 0.001 && gCart < 0.5) {
          // tendon: parallel collagen bundles, pearly
          float uT = lat / 0.34 + warp * 1.6 + 2.2 * vnoise(vec3(lat * 1.3, al * 0.09, uSeed + 21.0)) + 0.35 * sin(al * 0.6 + lat * 2.0 + vLow.w * 6.0)
            + (al * uTwist + 1.6 * vnoise(vec3(lat * 0.8, al * 0.3, uSeed + 41.0)) * step(0.001, uTwist)) * (1.0 - smoothstep(uTwistEnd - 2.0, uTwistEnd, al));
          float tEdge = min(fract(uT), 1.0 - fract(uT));
          float th = fract(sin((floor(uT) + uSeed) * 91.7) * 43758.5453);
          gTf = th;
          float tf2 = gFine > 0.01 ? vnoise(vec3(lat * 40.0, al * 0.6, uSeed + 11.0)) : 0.5;
          float tLow = vLow.w;
          float tStr = vnoise(vec3(lat * 2.3 + warp, al * 0.07, uSeed + 17.0));
          tendC = vec3(0.74, 0.71, 0.665) * (0.8 + 0.06 * th * gMid + 0.05 * tf2 * gFine + 0.08 * tLow + 0.2 * tStr) * mix(1.0, 0.98, (1.0 - smoothstep(0.0, 0.25, tEdge)) * gMid);
          tendC += vec3(-0.012, 0.0, 0.026) * (smoothstep(0.5, 0.9, tf2) * gFine + smoothstep(0.55, 0.85, tStr) * 0.8);
          tendC *= 1.0 - 0.12 * smoothstep(0.86, 1.0, vSec.y);
          tendC = mix(tendC, vec3(0.60, 0.40, 0.36), (1.0 - smoothstep(0.0, 1.6, vTend + jag)) * 0.5);   // pinkish aponeurosis
          float dIns = uLen - al;
          gIns = 1.0 - smoothstep(0.0, 0.8, dIns);
          tendC *= 1.0 + 0.12 * smoothstep(0.86, 1.0, vSec.y) * gIns;   // no dark rim at the insertion
          tendC = mix(tendC, vec3(0.82, 0.78, 0.72), gIns * 0.7);           // blend into the sclera
          hT = (0.004 * sqrt(clamp(tEdge * 2.0, 0.0, 1.0)) * gMid + 0.006 * tLow + 0.01 * tStr + 0.004 * tf2 * gFine + 0.0011 * sin(al * 23.0 + th * 9.0 + tf2 * 4.0) * gFine * tLow) * (1.0 - gIns);
        }
        if (gCart > 0.5) {
          float cn = orbN2(vec3(lat * 2.0, al * 2.0, 4.0));
          float cm = vnoise(vec3(lat * 7.0, al * 7.0, 9.0));
          cart = vec3(0.66, 0.68, 0.67) * (0.86 + 0.12 * cn + 0.05 * cm);
          cart = mix(cart, vec3(0.70, 0.64, 0.58), smoothstep(0.55, 0.85, cn) * 0.3);
          hC = 0.02 * cn + 0.006 * cm;
        }
        vec3 col = mix(belly, tendC, gTend);
        col = mix(col, cart, gCart);
        col *= mix(1.0, 0.62, uVessels);
        diffuseColor.rgb = col;
        gH = mix(mix(hB, hT, gTend), hC, gCart);
      }
    `,
    rough: /* glsl */`
      roughnessFactor = mix(mix(0.52 + 0.12 * gPeri - 0.08 * gFib, 0.36 - 0.05 * gTf, gTend), 0.55, gCart);
    `,
    normal: 'normal = orbBump(normal, gH);',
    phys: /* glsl */`
      {
        // tame grazing-angle Fresnel on thin, curved edges (otherwise the rim light blooms into hot glints)
        float ndvG = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        float f90 = mix(0.3, 1.0, smoothstep(0.03, 0.3, ndvG));
        material.specularF90 *= f90;
        #ifdef USE_CLEARCOAT
          material.clearcoatF90 = f90;
        #endif
      }
      #ifdef USE_CLEARCOAT
        material.clearcoat = mix(mix(0.22 * (1.0 - 0.6 * gPeri), 0.4 * (1.0 - gIns), gTend), 0.15, gCart) * (1.0 - 0.85 * smoothstep(0.82, 1.0, vSec.y));
        material.clearcoatRoughness = min(max(mix(0.36, 0.25, gTend), 0.0525) + geometryRoughness * 1.5, 1.0);
      #endif
    `,
    light: sssChunk(
      'mix(mix(vec3(0.16, 0.02, 0.012), vec3(0.1, 0.075, 0.06), gTend), vec3(0.15, 0.16, 0.17), gCart) * mix(1.0, 0.6, uVessels)',
      'max(max(gTend * 0.6, gCart * 0.5), pow(clamp(vSec.y, 0.0, 1.0), 6.0))',   // clamp: MSAA can extrapolate varyings past silhouettes (pow of a negative = NaN)
      'mix(0.4, 1.0, smoothstep(-1.0, 0.35, vSec.x))',
    ),
  });
}

// ---------------------------------------------------------------------------------------------
// Optic nerve core: pial surface (creamy, faint fascicular ridges), cut face with fascicles and
// pial septa, and the cut walls/lumens of the central retinal artery and vein.
export function nerveMaterial() {
  const uniforms = { uVessels: { value: 0 } };
  return makeMaterial({
    key: 'orbit-nerve-v7',
    uniforms,
    params: {
      color: 0xffffff, roughness: 0.45, metalness: 0, clearcoat: 1.0, clearcoatRoughness: 0.3,
      ior: 1.4, specularIntensity: 0.6,
    },
    vPars: 'attribute vec3 aNU; attribute float aNK;\nvarying vec3 vNU; varying float vNK;',
    vMain: 'vNU = aNU; vNK = aNK;',
    fPars: /* glsl */`
      uniform float uVessels;
      varying vec3 vNU; varying float vNK;
      float gH, gCut, gWet, gLum;
    `,
    color: /* glsl */`
      {
        float px = max(length(fwidth(vNU.xy)), 1e-4);
        float fine = 1.0 - smoothstep(0.012, 0.05, px);
        vec3 col; gCut = 0.0; gWet = 0.0; gLum = 0.0;
        if (vNK < 0.5) {
          // side: pia over fascicles; longitudinal septa glimpsed through the pia
          vec2 cs = normalize(vNU.xy + 1e-5);
          vec3 q = vec3(cs * 1.6, vNU.z);
          float a = vnoise(vec3(q.xy * 7.0, q.z * 0.35));
          float b = vnoise(vec3(q.xy * 19.0, q.z * 0.9 + 3.0));
          float ridge = 1.0 - abs(a * 2.0 - 1.0);
          float sept = smoothstep(0.8, 0.97, ridge);
          float mott = orbN2(vec3(q.xy * 1.2, q.z * 0.25));
          col = vec3(0.86, 0.80, 0.70) * (0.9 + 0.12 * b);
          col = mix(col, vec3(0.80, 0.62, 0.56), sept * 0.35 * fine);
          col = mix(col, vec3(0.82, 0.66, 0.60), smoothstep(0.55, 0.8, mott) * 0.35);
          gH = 0.018 * a + 0.006 * b * fine - 0.016 * sept;
        } else if (vNK < 1.5) {
          // cut face: rounded fascicles separated by pial septa (two scales), pia rim, septal capillaries
          gCut = 1.0; gWet = 1.0;
          vec2 p = vNU.xy;
          float r = length(p);
          // strongly warped cells so septa curve; one irregular fascicle scale (~0.08-0.15 mm), no domes
          vec2 wp = p + 0.12 * vec2(vnoise(vec3(p * 3.5, 1.0)) - 0.5, vnoise(vec3(p * 3.5, 7.0)) - 0.5)
                      + 0.03 * vec2(vnoise(vec3(p * 11.0, 2.0)) - 0.5, vnoise(vec3(p * 11.0, 9.0)) - 0.5);
          vec3 v1 = orbVoronoi(wp / 0.115 + 3.7);
          vec3 v2 = orbVoronoi(wp / 0.5 + 11.3);
          float e1 = v1.y * 0.115, e2 = v2.y * 0.5;
          float sep1 = (1.0 - smoothstep(0.006, 0.025, e1)) * (0.45 + 0.25 * v1.z);
          float sep2 = (1.0 - smoothstep(0.008, 0.035, e2)) * 0.3;
          float rim = smoothstep(1.47, 1.56, r);
          float sep = max(max(sep1, sep2), rim);
          float cellTone = 0.93 + 0.08 * v1.z + 0.03 * v2.z;
          vec3 fasc = vec3(0.90, 0.82, 0.66) * cellTone * (0.95 + 0.06 * vnoise(vec3(p * 60.0, 4.0)));
          fasc = mix(fasc, vec3(0.90, 0.78, 0.68), 0.2 * smoothstep(0.4, 0.9, vnoise(vec3(p * 4.0, 3.0))));
          vec3 septC = mix(vec3(0.72, 0.58, 0.52), vec3(0.66, 0.47, 0.43), sep2 / 0.3);
          col = mix(fasc, septC, sep);
          float cap = sep1 * step(0.8, vnoise(vec3(p * 34.0, 2.0)));
          col = mix(col, vec3(0.42, 0.06, 0.06), cap * 0.5);
          col = mix(col, vec3(0.64, 0.42, 0.38), rim * 0.7);
          gH = -0.003 * smoothstep(0.0, 0.04, e1) - 0.002 * sep2;   // very slight concavity per fascicle
        } else if (vNK < 2.5) {
          // vessel wall in section
          gCut = 1.0; gWet = 1.0;
          float ring = vNU.z;
          col = mix(vec3(0.78, 0.50, 0.46), vec3(0.62, 0.22, 0.2), ring);
          gH = 0.0;
        } else {
          // lumen with a little clotted blood
          gCut = 1.0; gWet = 1.0; gLum = 1.0;
          col = vec3(0.16, 0.012, 0.014) * (0.8 + 0.4 * vnoise(vec3(vNU.xy * 40.0, 1.0)));
          gH = -0.01 * vnoise(vec3(vNU.xy * 25.0, 5.0));
        }
        col *= mix(1.0, 0.7, uVessels);
        diffuseColor.rgb = col;
      }
    `,
    rough: 'roughnessFactor = mix(0.46, 0.3, gWet); roughnessFactor = mix(roughnessFactor, 0.2, gLum);',
    normal: 'normal = orbBump(normal, gH);',
    phys: /* glsl */`
      #ifdef USE_CLEARCOAT
        material.clearcoat = mix(0.35, 0.8, gWet);
        material.clearcoatRoughness = min(max(mix(0.3, 0.1, gWet), 0.0525) + geometryRoughness * 1.5, 1.0);
      #endif
    `,
    light: sssChunk('mix(vec3(0.45, 0.3, 0.2), vec3(0.3, 0.2, 0.15), gCut) * 0.8', '0.15', '1.0'),
  });
}

// ---------------------------------------------------------------------------------------------
// Dural sheath: translucent, slightly glossy fibrous tube; opaque cut face.
export function sheathMaterial() {
  const uniforms = { uVessels: { value: 0 }, uAttach: { value: 1 } };
  return makeMaterial({
    key: 'orbit-sheath-v6',
    uniforms,
    params: {
      color: 0xffffff, roughness: 0.42, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.22,
      transparent: true, depthWrite: false, side: THREE.FrontSide, ior: 1.4, specularIntensity: 0.55,
    },
    vPars: `${GLSL_NOISE}
      uniform float uAttach;
      attribute vec3 aSU; attribute float aSK; attribute vec3 aFlat; attribute vec3 aFlatN;
      varying vec3 vSU; varying float vSK; varying vec2 vSLow;`,
    // uAttach 1: dura flared and fused onto the sclera; 0: plain dural tube cut at the globe (explode / inspect)
    vNorm: 'objectNormal = normalize(mix(aFlatN, objectNormal, uAttach));',
    vMain: /* glsl */`
      transformed = mix(aFlat, transformed, uAttach);
      vSU = aSU; vSK = aSK;
      { vec2 cs = normalize(aSU.xy + 1e-5); float ang = atan(cs.y, cs.x); vec2 qq = cs * 2.3;
        vSLow = vec2(vnoise(vec3(qq * 3.0, (aSU.z + ang * 1.1) * 1.6)), vnoise(vec3(qq * 3.0 + 7.0, (aSU.z - ang * 1.1) * 1.6))); }`,
    fPars: /* glsl */`
      uniform float uVessels;
      varying vec3 vSU; varying float vSK; varying vec2 vSLow;
      float gH, gFace, gA;
    `,
    color: /* glsl */`
      {
        vec2 cs = normalize(vSU.xy + 1e-5);
        float ang = atan(cs.y, cs.x);
        vec3 q = vec3(cs * 2.3, vSU.z);
        float h1 = vSLow.x, h2 = vSLow.y;
        float lam = vnoise(vec3(q.xy * 9.0, vSU.z * 0.7));
        gFace = step(0.5, vSK) * (1.0 - step(1.5, vSK));
        float fibL = vnoise(vec3(q.xy * 14.0, vSU.z * 0.5));
        vec3 col = vec3(0.73, 0.745, 0.76) * (0.86 + 0.12 * h1 + 0.1 * h2) * (0.9 + 0.16 * fibL);
        gA = 0.86 + 0.28 * h1 * h2 + 0.1 * fibL;
        // cut face: concentric fibrous lamellae
        float rr = length(vSU.xy);
        float lamF = 0.5 + 0.5 * sin(rr * 90.0 + vnoise(vec3(vSU.xy * 12.0, 1.0)) * 5.0);
        col = mix(col, vec3(0.80, 0.76, 0.72) * (0.86 + 0.14 * lamF), gFace);
        col *= mix(1.0, 0.75, uVessels);
        diffuseColor.rgb = col;
        gH = (0.012 * (h1 + h2) + 0.006 * lam + 0.004 * fibL) * (1.0 - gFace) + 0.004 * lamF * gFace;
      }
    `,
    normal: /* glsl */`
      normal = orbBump(normal, gH);
      {
        vec3 vd = normalize(vViewPosition);
        float fr = pow(max(0.0, 1.0 - abs(dot(normal, vd))), 2.0);
        float a = mix(0.6, 0.95, fr) * gA;
        a = mix(a, 1.0, gFace);
        a = mix(a, 0.3, step(1.5, vSK));
        a *= mix(1.0, 0.55, uVessels * (1.0 - gFace));
        diffuseColor.a *= a;
      }
    `,
    light: sssChunk('vec3(0.25, 0.24, 0.23)', '0.25', '1.0'),
  });
}
