// Shaders for the posterior segment. All outputs are linear HDR radiance (the stage's OutputPass tone-maps).
// Every material declares uGhost / uHighlight (see lib/materials.applyGhost).
// NaN safety: every fresnel/pow base is clamped (a NaN pixel is spread over the frame by UnrealBloom),
// derivative bump normals fall back to the geometric normal, and every output is max(col, 0).
import * as THREE from 'three';
import { EYE, L, PALETTE } from '../../config.js';
import * as am from '../../lib/anatomyMath.js';
import { RC, TEX_EXT } from './choroidMap.js';
import { noiseTexture, GLSL_TNOISE } from './noiseTex.js';

// Directions/colours of the production rig (fx/stage.js), so custom shaders sit in the same light.
export function lightUniforms() {
  return {
    uKeyDir: { value: new THREE.Vector3(-40, 55, 70).normalize() },
    uKeyCol: { value: new THREE.Color(0xfff1e0).multiplyScalar(1.55) },
    uRimDir: { value: new THREE.Vector3(60, 20, -80).normalize() },
    uRimCol: { value: new THREE.Color(0x9fc4ff).multiplyScalar(1.25) },
    uUnderDir: { value: new THREE.Vector3(10, -60, 20).normalize() },
    uUnderCol: { value: new THREE.Color(0xff9a7a).multiplyScalar(0.35) },
    uAmb: { value: new THREE.Color(0.075, 0.075, 0.085) },
  };
}

const COMMON = /* glsl */`
  #define PI 3.14159265
  uniform vec3 uKeyDir, uKeyCol, uRimDir, uRimCol, uUnderDir, uUnderCol, uAmb;
  uniform float uGhost, uHighlight, uTime, uGlow, uEncl;
  uniform float uR, uRC, uTexExt, uLimbusPolar;
  uniform vec3 uAccent;
  uniform sampler2D uNoise;
  ${GLSL_TNOISE}
  float sat(float x) { return clamp(x, 0.0, 1.0); }
  // 1 - |N.V|, clamped: rounding can push |N.V| a hair above 1 and pow() of a negative base is NaN
  float grazing(vec3 N, vec3 V) { return 1.0 - clamp(abs(dot(N, V)), 0.0, 1.0); }
  vec3 wrapLight(vec3 N, float w) {
    float k = max((dot(N, uKeyDir) + w) / (1. + w), 0.);
    float r = max((dot(N, uRimDir) + w) / (1. + w), 0.);
    float u = max((dot(N, uUnderDir) + w) / (1. + w), 0.);
    return (uKeyCol * k + uRimCol * r + uUnderCol * u) * 0.3183 + uAmb;
  }
  float specK(vec3 N, vec3 V, float sh) {
    vec3 H = uKeyDir + V;
    H *= inversesqrt(max(dot(H, H), 1e-8));
    return pow(max(dot(N, H), 0.), sh) * (sh + 8.) / 25.;
  }
  // map coords (mm along a sphere of radius 'scale') about the posterior pole: +x nasal, +y superior
  vec2 mapOf(vec3 p, float scale) {
    vec3 d = normalize(p);
    float s = length(d.xy);
    float pol = atan(s, -d.z);
    return d.xy * (pol * scale / max(s, 1e-7));
  }
  vec2 choroidUV(vec3 p) { return mapOf(p, uRC) / (2. * uTexExt) + 0.5; }
  // ora serrata (smooth line, anatomyMath.oraPolar) as map radius on a sphere of radius 'scale'
  float oraRhoS(float az, float scale) {
    float d = 6.0 + (0.5 - 0.5 * cos(az));
    return (PI - (uLimbusPolar + d / 12.0)) * scale;
  }
  float oraRho(float az) { return oraRhoS(az, uR); }
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  // cellular noise: x = F1, y = F2, z = cell id hash
  vec3 voronoi(vec2 x) {
    vec2 n = floor(x), f = fract(x);
    float F1 = 8., F2 = 8., id = 0.;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < F1) { F2 = F1; F1 = d; id = dot(n + g, vec2(7.0, 113.0)); } else if (d < F2) { F2 = d; }
    }
    return vec3(sqrt(F1), sqrt(F2), fract(sin(id) * 43758.5453));
  }
  float pulseShape(float ph) { return smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.08, 0.45, ph)); }
  // normal perturbed by a height with screen-space derivatives (dhx, dhy); geometric normal where degenerate
  vec3 bumpN(vec3 N, vec3 p, float dhx, float dhy) {
    vec3 dpx = dFdx(p), dpy = dFdy(p);
    vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
    float det = dot(dpx, r1);
    vec3 g = sign(det) * (dhx * r1 + dhy * r2);
    vec3 n = abs(det) * N - g;
    float l2 = dot(n, n);
    return l2 > 1e-24 ? n * inversesqrt(l2) : N;
  }
`;

const VERT = /* glsl */`
  attribute float aSide;
  varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNw; varying vec3 vNl; varying float vSide;
  void main() {
    vLocal = position;
    vNl = normal;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNw = normalize(mat3(modelMatrix) * normal);
    vSide = aSide;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// ---------------------------------------------------------------------------------------------
// Fundus: retina (inner / RPE / cut rim), macula overlay, optic disc.
const FUNDUS_FRAG = /* glsl */`
  uniform sampler2D uChor;
  uniform vec2 uDisc, uDiscAx, uCupC, uCupAx;
  uniform vec3 uCamLocal;
  uniform vec3 uCRetina, uCMacula, uCDisc, uArtGlow, uVeinGlow;
  uniform float uDiscCut;
  varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNw; varying vec3 vNl; varying float vSide;

  // Jansonius et al. (2009) nerve-fibre trajectory model (degrees, disc-centred polar, 0 = away from fovea):
  // phi(r) = phi0 + b(phi0) (r - r0)^c(phi0), written as one exp: a + exp(b0 + b1 t + (c0 + c1 t) ln R).
  // P = (centre, 1/width, b0, b1), C = (c0, c1). Nasal bundles straightened slightly (model is unfitted there).
  float jF(float a, float logR, vec4 P, vec2 C) {
    float t = tanh(clamp((a - P.x) * P.y, -9.0, 9.0));
    return a + exp(P.z + P.w * t + (C.x + C.y * t) * logR) * smoothstep(0., 70., a);
  }
  // x: fibre label (deg, signed sup/inf), y: distance from the disc centre (deg), z: NFL thickness 0..1
  vec3 nflField(vec2 m, float rhoF) {
    vec2 p = (m - uDisc) / 0.293;
    float r = length(p);
    float R = max(r - 3.0, 0.0);
    if (R > 62.0) return vec3(0.0, r, 0.0);          // NFL negligible beyond ~18 mm from the disc
    float phi = degrees(atan(p.y, p.x));
    bool sup = phi >= 0.0;
    float tgt = abs(phi);
    vec4 P = sup ? vec4(121.0, 1.0 / 14.0, -1.9, -3.9) : vec4(90.0, 0.04, 0.7, -1.5);
    vec2 C = sup ? vec2(1.9, 1.4) : vec2(1.0, 0.5);
    float logR = log(max(R, 1e-3));
    // F(a) >= a, so the fibre label lies in [tgt - maxBend, tgt]
    float lo = max(0.0, tgt - 95.0), hi = tgt;
    float flo = jF(lo, logR, P, C), fhi = jF(hi, logR, P, C);
    for (int i = 0; i < 8; i++) {
      float mid = 0.5 * (lo + hi);
      float f = jF(mid, logR, P, C);
      if (f < tgt) { lo = mid; flo = f; } else { hi = mid; fhi = f; }
    }
    float a0 = mix(lo, hi, sat((tgt - flo) / max(fhi - flo, 1e-4)));
    float qa = sup ? (a0 - 126.) / 24. : (a0 - 120.) / 26.;
    float qp = (a0 - 172.) / 14.;
    float arc = exp(-qa * qa);
    float pm = 0.5 * exp(-qp * qp);
    float T = (0.28 + 0.72 * max(arc, pm)) * exp(-R / 13.) * smoothstep(-1.0, 1.5, R);
    T *= mix(0.12, 1.0, smoothstep(0.8, 4.2, rhoF));   // NFL is thin over the macula
    return vec3(sup ? a0 : -a0, r, T);
  }
  // Fine feathery streaks along the fibre trajectories: high frequency across bundles, broken along them.
  float striae(vec3 nf) {
    float lab = nf.x, r = nf.y;
    float s1 = vnoise2(vec2(lab * 1.6, r * 0.28 + 1.7));
    float s2 = vnoise2(vec2(lab * 4.6 + 13.1, r * 0.55 + 5.3));
    float aa1 = sat(1.0 - fwidth(lab * 1.6) * 1.3);
    float aa2 = sat(1.0 - fwidth(lab * 4.6) * 1.3);
    float s = 0.5 + (s1 - 0.5) * aa1 * 1.2 + (s2 - 0.5) * aa2 * 0.9;
    return smoothstep(0.25, 0.85, s);
  }

  // Optic nerve head albedo: orange-pink neuroretinal rim (pinker nasally, paler temporally where it is
  // thinnest), pale yellow-white cup with the faint grey pores of the lamina cribrosa, thin scleral ring.
  vec3 discAlbedo(vec2 m, out float mask, out float cupK) {
    vec2 dm = m - uDisc;
    float dl = max(length(dm), 1e-4);
    vec2 dn = dm / dl;
    vec4 nz = tn4(dn * 2.2 + 7.0);
    float e = length(dm / uDiscAx) * (1.0 + (nz.r - 0.5) * 0.03);
    vec2 dc = (dm - uCupC) / uCupAx;
    float ec = length(dc);
    // linear nasal-temporal gradient across the disc (an angular one splits the rim along a vertical seam)
    float hx = dm.x / uDiscAx.x;
    float temporal = smoothstep(0.3, -0.85, hx);
    float nasal = smoothstep(-0.3, 0.85, hx);
    // close to the fundus in value and hue (pink-orange, a little bluer), so it never lands on the
    // tone-map shoulder and bleaches to beige; pallor comes only temporally and in the cup
    vec3 rim = vec3(0.74, 0.235, 0.135);
    rim = mix(rim, vec3(0.72, 0.2, 0.16), nasal * 0.6);
    rim = mix(rim, mix(rim, uCDisc, 0.5), temporal * 0.6);
    // radial nerve-fibre bundles and the capillary blush of the rim
    float fib = tn4(dn * 30.0 + vec2(e * 1.6, 0.0)).b;
    rim *= 1.0 + 0.16 * (fib - 0.5) * smoothstep(0.3, 0.75, e);
    float blush = tn4(dm * 22.0 + 4.0).g;
    rim = mix(rim, rim * vec3(1.05, 0.84, 0.88), blush * 0.45 * (1.0 - temporal * 0.6));
    // cup pallor fades out over the cup wall
    vec3 cupCol = mix(uCDisc, vec3(0.98, 0.84, 0.6), 0.5) * 0.92;
    cupK = 1.0 - smoothstep(0.78, 1.08, ec);
    vec3 c = mix(rim, cupCol * (0.97 + 0.06 * nz.g), cupK);
    // lamina cribrosa pores (~15 % contrast), only in the floor of the cup
    vec3 vo = voronoi(dc * 5.5 + 3.0);
    float pore = (1.0 - smoothstep(0.1, 0.26, vo.x)) * (1.0 - smoothstep(0.3, 0.62, ec));
    c *= 1.0 - 0.09 * pore * vec3(1.0, 1.03, 1.08);
    // scleral ring of Elschnig: ~80 um pale ring at the margin, most visible temporally
    float ring = smoothstep(0.9, 0.985, e) * (1.0 - smoothstep(0.995, 1.075, e));
    c = mix(c, uCDisc * vec3(0.96, 0.88, 0.8), ring * (0.08 + 0.2 * temporal));
    mask = 1.0 - smoothstep(0.97, 1.08, e);
    return c;
  }

  // Fundus (neural retina over RPE + choroid, seen from the vitreous). Also returns the NFL field + striae.
  vec3 fundus(vec2 m, vec3 pL, vec3 N, vec3 Nl, vec3 V, vec3 vL, bool withDisc, out float edgeMacula, out vec3 nf, out float s) {
    float rho = length(m);
    float az = atan(m.y, m.x);
    float oraR = oraRho(az);
    vec3 nL = -normalize(pL);
    float ndv = clamp(dot(nL, vL), 0.12, 1.0);
    // translucency: look through ~0.45 mm of retina + RPE into the choroid (true parallax)
    vec3 deep = pL - vL * (0.45 / max(ndv, 0.3));
    vec2 uvD = choroidUV(deep);
    vec4 ch = texture2D(uChor, uvD, 3.6);
    float large = smoothstep(0.18, 0.62, ch.r) * smoothstep(0.15, 0.55, ch.b);
    // base: deep red-orange at the pole, warmer orange-pink mid-periphery, browner far periphery
    vec3 cOr = uCRetina;
    float mid = smoothstep(3.0, 12.0, rho);
    vec3 base = mix(cOr * vec3(0.9, 0.56, 0.42), cOr * vec3(1.0, 0.76, 0.6), mid);
    base *= mix(vec3(1.04, 0.9, 0.84), vec3(0.96, 1.08, 1.1), tn4(m * 0.35 + 11.0).r);
    // choroidal tessellation: orange vessel ribbons, darker pigmented interspaces (mostly peripheral)
    float tess = mix(0.07, 0.3, smoothstep(7.0, 20.0, rho));
    base = mix(base, base * vec3(0.6, 0.46, 0.42), (1.0 - large) * tess);
    base = mix(base, base * vec3(1.08, 1.0, 0.92), large * tess * 0.5);
    // RPE mottle (coarse + fine) and melanin granularity (~12 um, mip-filtered so it never sparkles)
    const mat2 RT = mat2(0.8, -0.6, 0.6, 0.8);
    float mot = 0.55 * tn4(m * 5.0 + 3.1).g + 0.3 * tn4(RT * m * 11.0 + 4.7).b + 0.15;
    base *= 0.86 + 0.28 * mot;
    base *= 1.0 + 0.1 * (tn4(m * 30.0 + 9.0).a - 0.5);
    base *= 1.0 + 0.09 * (tn4(RT * m * 82.0 + 2.3).r - 0.5);
    // macula lutea: denser RPE melanin + xanthophyll (lutein/zeaxanthin), fovea darkest
    float macW = 1.0 - smoothstep(0.5, 2.85, rho);
    float qx = rho / 1.45, qf = rho / 0.4, qy = rho / 0.6;
    float xan = exp(-qx * qx), fov = exp(-qf * qf), lut = exp(-qy * qy);
    base *= mix(vec3(1.0), vec3(0.72, 0.6, 0.5), macW * 0.85);
    base = mix(base, uCMacula * vec3(1.15, 1.05, 0.7), xan * 0.5);
    base *= mix(vec3(1.0), vec3(1.05, 0.97, 0.68), lut * 0.6);   // luteal pigment peaks at the foveola
    base *= 1.0 - 0.28 * fov;
    edgeMacula = smoothstep(2.45, 2.75, rho) * (1.0 - smoothstep(2.75, 2.95, rho));
    // periphery: thinner, greyer; cystoid (Blessig-Iwanoff) band just behind the ora
    float per = smoothstep(12.0, oraR - 0.3, rho);
    base = mix(base, base * vec3(0.72, 0.62, 0.62) + vec3(0.02, 0.016, 0.016), per * 0.8);
    float cyst = smoothstep(oraR - 2.8, oraR - 0.9, rho);
    if (cyst > 0.0) {
      vec3 vc = voronoi(m * 5.0);
      float bub = smoothstep(0.02, 0.16, vc.y - vc.x);
      base = mix(base, base * 1.16 + vec3(0.022, 0.018, 0.018), cyst * bub * 0.45);
    }
    // long posterior ciliary nerves/arteries: faint yellowish lines at 3 and 9 o'clock in the mid-periphery
    base = mix(base, base * vec3(1.2, 1.1, 0.9), smoothstep(0.1, 0.4, ch.g) * smoothstep(7.0, 12.0, abs(m.x)) * smoothstep(1.2, 0.0, abs(m.y)) * 0.5);
    // peripapillary halo and temporal pigment crescent
    vec2 dm = m - uDisc;
    float e = length(dm / uDiscAx);
    vec2 dn = dm / max(length(dm), 1e-4);
    float ppa = 1.0 - smoothstep(1.0, 1.22, e);
    base = mix(base, base * vec3(1.1, 1.03, 0.96) + vec3(0.018, 0.011, 0.006), ppa * 0.45);
    float temporal = smoothstep(0.1, -0.7, dn.x);
    float cres = smoothstep(1.0, 1.035, e) * (1.0 - smoothstep(1.05, 1.15, e)) * temporal;
    cres *= 0.5 + 0.8 * tn4(dn * 2.5 + 2.0).a;
    base = mix(base, vec3(0.07, 0.04, 0.03), sat(cres) * 0.5);
    // optic disc (flat stand-in when the disc mesh is not drawn)
    float dmask = 0.0;
    if (withDisc && e < 1.12) {
      float cupK;
      vec3 dA = discAlbedo(m, dmask, cupK);
      base = mix(base, dA, dmask);
    }
    // neural retina veil + nerve-fibre layer: silvery striations, thickest in the arcuate bundles
    nf = nflField(m, rho);
    s = striae(nf);
    float T = nf.z * (1.0 - dmask * 0.4);
    float fr = pow(1.0 - ndv, 2.5);
    vec3 veilC = vec3(0.9, 0.78, 0.74);
    float veil = 0.018 + 0.12 * fr + T * (0.03 + 0.2 * s);
    base = mix(base, veilC, clamp(veil, 0., 0.6));

    // lighting: wrapped diffuse (translucent tissue) + faint self-glow of the backlit fundus;
    // cavity occlusion of the eyecup and of the foveal clivus (slope of the pit wall)
    float slope = 1.0 - clamp(dot(Nl, nL), 0.0, 1.0);
    float cav = mix(1.0, 0.62, smoothstep(9.0, oraR, rho)) * (1.0 - min(0.9 * slope, 0.22));
    vec3 col = base * (wrapLight(N, 0.45) * 1.35 + 0.08) * cav;
    // ILM sheen, sparkling along the arcuate bundles (watered-silk reflex)
    float sparkle = max(s - 0.5, 0.0) * 2.0;             // only where the bundles are resolved
    float sp = specK(N, V, 160.0) * (0.008 + 0.35 * T * sparkle + 0.03 * macW * (1.0 - fov));
    col += uKeyCol * sp * 0.2;
    float nvw = max(dot(N, V), 0.0);
    col += vec3(0.9, 0.95, 1.0) * pow(nvw, 90.0) * (0.25 * T * sparkle) * 0.25;
    // foveal reflex: the pit is a concave mirror for light coaxial with the observer (tight lobe)
    float qr = rho / 0.07;
    col += vec3(1.0, 0.9, 0.74) * exp(-qr * qr) * pow(nvw, 400.0) * 0.3;
    // annular macular reflex (ILM over the parafoveal rim), only near normal incidence
    float qn = (rho - 1.05) / 0.18;
    col += vec3(0.85, 0.9, 1.0) * exp(-qn * qn) * pow(nvw, 60.0) * 0.014 * (0.4 + tn4(m * 6.0 + 1.3).b);
    // vessels mode: the fundus dims and the choroidal circulation glows through the translucent retina
    if (uGlow > 0.001) {
      vec4 chg = texture2D(uChor, uvD, 1.2);
      float ph = pulseShape(fract(length(mapOf(deep, uRC) - vec2(2.1, 0.15)) / 6.0 - uTime * 1.3));
      float fk = smoothstep(1.5, 4.0, rho);
      vec3 g = uVeinGlow * chg.r * 0.3 + uArtGlow * chg.g * (0.4 + 1.2 * ph) * 0.45 * fk;
      col = col * (1.0 - 0.5 * uGlow) + g * uGlow * 0.3;
    }
    return col * uEncl;
  }

  void main() {
    vec3 N = normalize(vNw);
    vec3 Nl = normalize(vNl);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 vL = normalize(uCamLocal - vLocal);
    vec2 m = mapOf(vLocal, uR);
    vec3 col;
    float edge = 0.0;
    vec3 nf = vec3(0.0);
    float s = 0.0;
  #if defined(RETINA)
    vec2 dm0 = m - uDisc;
    if (uDiscCut > 0.5 && length(dm0 / uDiscAx) < 1.12) discard;
    if (vSide < 0.5) {
      col = fundus(m, vLocal, N, Nl, V, vL, uDiscCut < 0.5, edge, nf, s);
      edge = 0.0;
    } else if (vSide < 1.5) {
      // retinal pigment epithelium, outer face: very dark brown, broad satin sheen, faint hexagonal cells
      vec3 c = vec3(0.06, 0.035, 0.025);
      c *= 0.66 + 0.68 * tfbm(m * 3.0 + 1.0);
      c = mix(c, c * vec3(1.25, 0.9, 0.8), smoothstep(0.45, 0.75, tn4(m * 0.6 + 4.0).g) * 0.6);
      vec3 vo = voronoi(m * 60.0);
      float aa = sat(1.0 - fwidth(m.x * 60.0));
      c *= 1.0 - 0.2 * aa * (1.0 - smoothstep(0.0, 0.12, vo.y - vo.x));
      float fr = pow(grazing(N, V), 3.0);
      col = c * wrapLight(N, 0.3) * 1.25 + uKeyCol * (specK(N, V, 14.0) * 0.035 + specK(N, V, 60.0) * 0.02) + vec3(0.09, 0.06, 0.05) * fr * 0.5;
    } else {
      float t = vSide - 2.0;  // 0 inner (vitreous side) .. 1 outer (RPE)
      // thin cut face of the retina at the ora (neural retina over the RPE band)
      vec3 c = mix(vec3(0.2, 0.1, 0.085), vec3(0.05, 0.03, 0.022), smoothstep(0.6, 0.8, t));
      col = c * wrapLight(N, 0.4) * 1.2 * uEncl;
    }
  #elif defined(MACULA)
    col = fundus(m, vLocal, N, Nl, V, vL, false, edge, nf, s);
  #else
    // optic disc mesh (real cup geometry), blending into the fundus at its margin
    vec2 dm = m - uDisc;
    float e = length(dm / uDiscAx);
    float dmask, cupK;
    vec3 dA = discAlbedo(m, dmask, cupK);
    vec3 fcol = vec3(0.0);
    float e2 = 0.0;
    if (dmask < 0.999) fcol = fundus(m, vLocal, N, Nl, V, vL, false, e2, nf, s);
    else if (e > 0.45) { nf = nflField(m, length(m)); s = striae(nf); }
    // lighting ~1.1x the fundus (pallor comes from the albedo, not from over-exposure);
    // occlusion from the slope of the cup wall, a little more in the depth of the cup
    vec3 nR = -normalize(vLocal);
    float slope = 1.0 - clamp(dot(Nl, nR), 0.0, 1.0);
    float depthN = sat((length(vLocal) - uR) / 0.28);
    float ao = (1.0 - 0.35 * slope) * (1.0 - 0.12 * depthN);
    vec3 dcol = dA * (wrapLight(N, 0.35) * 1.42 + 0.085) * ao * (1.0 + 0.1 * cupK);   // the lamina glows back
    dcol = mix(dcol, dcol * 1.08 + vec3(0.012, 0.01, 0.01), nf.z * s * 0.5 * smoothstep(0.45, 0.97, e));
    dcol += uKeyCol * specK(N, V, 30.0) * 0.006;
    if (uGlow > 0.001) dcol *= 1.0 - 0.45 * uGlow;
    col = mix(fcol, dcol * uEncl, dmask);
    edge = smoothstep(0.86, 1.0, e) * (1.0 - smoothstep(1.0, 1.12, e));
    if (!gl_FrontFacing) {
      // seen from the scleral side through the RPE opening: lamina cribrosa / exiting nerve fibres
      // warm grey-cream nerve tissue with the sieve of the lamina cribrosa; the cool rim light is desaturated
      vec3 Nb = normalize(mix(-N, normalize(vLocal), 0.8));
      float fibre = tn4(dm * 30.0 + 6.0).r;
      vec3 lv = voronoi(dm * 13.0 + 1.7);
      float sieve = (1.0 - smoothstep(0.12, 0.3, lv.x)) * (1.0 - smoothstep(0.55, 0.95, e));
      vec3 lc = vec3(0.42, 0.35, 0.27) * (0.88 + 0.24 * fibre) * (1.0 - 0.3 * sieve);
      vec3 li = wrapLight(Nb, 0.5);
      col = lc * (mix(li, vec3(dot(li, vec3(0.3333))), 0.7) * 1.0 + 0.04);
      N = Nb;
    }
  #endif
    float fres = pow(grazing(N, V), 2.0);
    col += uAccent * uHighlight * (0.16 + 0.6 * fres + 1.4 * edge);
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0 - 0.94 * uGhost);
  }
`;

// ---------------------------------------------------------------------------------------------
// Choroid: Haller/Sattler vessels to the vortex ampullae (outer face), choriocapillaris (inner face).
// Output is premultiplied (material.premultipliedAlpha): in vessel mode the tissue is half-ghosted by the
// core, but the glow of the circulation is added at full strength instead of being faded with it.
const CHOROID_FRAG = /* glsl */`
  uniform sampler2D uChor, uPhase;
  uniform vec3 uAmp[4];
  uniform vec3 uPoleDir;
  uniform vec3 uArtGlow, uVeinGlow;
  uniform float uVesGhost;
  varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNw; varying vec3 vNl; varying float vSide;

  float hOf(vec4 t) { return max(t.r, t.g * 0.85); }

  void main() {
    vec3 N = normalize(vNw);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 d = normalize(vLocal);
    vec2 a = mapOf(vLocal, uRC);
    vec2 uv = a / (2.0 * uTexExt) + 0.5;
    vec4 t = texture2D(uChor, uv);
    float vein = t.r, art = t.g;
    float dA = 1e3;
    for (int i = 0; i < 4; i++) dA = min(dA, acos(clamp(dot(d, uAmp[i]), -1.0, 1.0)) * uRC);
    float dP = acos(clamp(dot(d, uPoleDir), -1.0, 1.0)) * uRC;
    float vm = smoothstep(0.06, 0.5, vein);
    float amk = smoothstep(0.08, 0.5, art);
    // how well the 2048^2 height field is resolved on screen (texels per pixel)
    vec2 fw = fwidth(uv);
    float texPx = length(fw) * 2048.0;
    float resK = clamp(1.6 - texPx * 0.5, 0.0, 1.0);
    // pigmented stroma: melanocytes, lamina fusca patches
    float mel = tfbm(a * 5.0 + 2.0);
    float speck = tn4(a * 42.0 + 1.0).a;
    vec3 stroma = vec3(0.058, 0.027, 0.017) * (0.62 + 0.62 * mel) * (1.0 + 0.3 * (speck - 0.5));
    vec3 tissue, glow = vec3(0.0);
    float pV = 0.0, pA = 0.0;
    if (uGlow > 0.001) {
      // per-vessel constant phase (uPhase), so pulses visibly run along each vessel
      vec4 ph = texture2D(uPhase, uv);
      pV = pow(pulseShape(fract(dA / 6.0 + uTime * 0.55 + ph.r)), 2.0);
      pA = pow(pulseShape(fract(dP / 6.0 - uTime * 1.1 + ph.g)), 2.0);
    }
    float fovK = smoothstep(1.5, 4.0, length(a));
    if (vSide < 0.5) {
      // inner face: velvety choriocapillaris sheet (lobules, pillars) over the deeper Sattler/Haller veins
      vec4 tb = texture2D(uChor, uv, 2.0);
      vec2 wa = a + (tn4(a * 9.0 + 1.0).rg - 0.5) * 0.06;
      vec3 lob = voronoi(wa * 2.6);
      vec3 capv = voronoi(wa * 21.0);
      float aa = sat(1.0 - fwidth(a.x * 21.0) * 0.9);
      float holeR = 0.1 + 0.12 * capv.z;
      float pillar = 1.0 - smoothstep(holeR - 0.05, holeR + 0.2, capv.x);
      float lobEdge = 1.0 - smoothstep(0.0, 0.12, lob.y - lob.x);
      float lobCtr = smoothstep(0.35, 0.0, lob.x);
      float deepV = smoothstep(0.15, 0.75, tb.r);
      // continuous capillary sheet; deep veins only modulate it
      vec3 cc = vec3(0.2, 0.034, 0.026) * mix(0.74, 1.1, deepV);
      cc *= 1.0 + 0.25 * smoothstep(0.2, 0.7, tb.g);
      cc *= 1.0 - 0.3 * pillar * aa;
      cc *= 0.9 + 0.2 * lobCtr;
      cc = mix(cc, cc * vec3(0.72, 0.64, 0.82), lobEdge * 0.4 * sat(1.0 - fwidth(a.x * 2.6) * 2.0));
      cc *= 0.86 + 0.28 * mel;
      // anterior end: the pigment epithelium continues forward as the pigmented pars plana epithelium
      float pp = smoothstep(oraRhoS(atan(a.y, a.x), uRC) - 0.7, oraRhoS(atan(a.y, a.x), uRC) + 0.1, length(a));
      cc = mix(cc, vec3(0.05, 0.028, 0.02), pp * 0.85);
      float capH = ((1.0 - pillar) * 0.01 * aa + tb.r * 0.02) * resK;
      vec3 Nb = bumpN(N, vWorld, dFdx(capH), dFdy(capH));
      float fz = pow(grazing(N, V), 2.0);                  // velvet fuzz of the capillary sheet
      tissue = cc * (wrapLight(Nb, 0.35) * 1.3 + 0.03) + uKeyCol * specK(Nb, V, 30.0) * 0.012 * (0.5 + 0.5 * deepV)
             + vec3(0.2, 0.06, 0.06) * fz * 0.08 * (1.0 - pp);
      if (uGlow > 0.001) {
        glow = uArtGlow * (0.02 + 0.02 * pA) * (1.0 - pillar * aa) * fovK + uVeinGlow * deepV * (0.07 + 0.1 * pV)
             + uArtGlow * smoothstep(0.2, 0.7, tb.g) * (0.06 + 0.3 * pA) * fovK;
        tissue *= 1.0 - 0.75 * uGlow;
      }
    } else if (vSide < 1.5) {
      // outer face: Haller's layer — large, densely packed veins converging on the vortex ampullae,
      // in brown-black pigmented stroma. Bump from a prefiltered height gradient (fetched at the same mip
      // as the albedo) so thin vessels never sparkle; chain rule to screen space.
      float eps = max(1.0 / 2048.0, max(fw.x, fw.y) * 0.75);
      vec2 g = vec2(hOf(texture2D(uChor, uv + vec2(eps, 0.0))) - hOf(texture2D(uChor, uv - vec2(eps, 0.0))),
                    hOf(texture2D(uChor, uv + vec2(0.0, eps))) - hOf(texture2D(uChor, uv - vec2(0.0, eps)))) / (2.0 * eps);
      float hs = 0.07 * mix(0.3, 1.0, resK);
      vec4 pid = texture2D(uPhase, uv);                   // per-vessel random value (also the pulse phase)
      vec3 Nb = bumpN(N, vWorld, dot(g, dFdx(uv)) * hs, dot(g, dFdy(uv)) * hs);
      float fus = smoothstep(0.52, 0.82, tfbm(a * 1.3 + 3.0));
      stroma = mix(stroma, vec3(0.1, 0.058, 0.036), fus * 0.45);
      vec3 veinC = mix(vec3(0.085, 0.016, 0.022), vec3(0.17, 0.03, 0.036), smoothstep(0.3, 1.0, vein));
      vec3 artC = mix(vec3(0.15, 0.03, 0.025), vec3(0.22, 0.048, 0.036), smoothstep(0.3, 1.0, art));
      veinC *= 0.82 + 0.36 * pid.r;
      // densely packed veins: the vessel wall (low height) already counts as vein, and the interstitium is
      // a dark maroon-brown rather than black, so the face reads as a vein mat and not as red wires
      stroma = mix(stroma, veinC * 0.55, 0.35);
      vec3 c = mix(stroma, veinC, smoothstep(0.02, 0.32, vein));
      c = mix(c, artC, smoothstep(0.15, 0.6, art) * (1.0 - 0.55 * vm));
      // suprachoroid (lamina fusca): a patchy brown pigmented veil over the Haller vessels
      c = mix(c, stroma * 1.15, 0.16 + 0.3 * fus);
      float qa = dA / 1.1;
      float amp = exp(-qa * qa);
      c = mix(c, vec3(0.07, 0.012, 0.022), amp * 0.5);
      float graze = smoothstep(0.05, 0.45, abs(dot(N, V)));
      float wet = (specK(Nb, V, 40.0) * 0.028 * (0.25 + vm + amk) * mix(0.25, 1.0, resK) + specK(Nb, V, 10.0) * 0.01) * graze;
      tissue = c * (wrapLight(Nb, 0.3) * 1.3 + 0.02) + uKeyCol * wet;
      if (uGlow > 0.001) {
        float crest = smoothstep(0.45, 1.0, vein);
        glow = uVeinGlow * (0.045 + 0.12 * crest + 0.28 * pV * crest) * vm
             + uArtGlow * (0.12 + 0.6 * pA) * amk * smoothstep(0.3, 0.9, art) * fovK
             + uVeinGlow * amp * (0.15 + 0.3 * pV);
        tissue *= 1.0 - 0.8 * uGlow;
      }
    } else {
      float tt = vSide - 2.0;
      vec3 c = mix(vec3(0.2, 0.035, 0.03), vec3(0.07, 0.022, 0.015), tt);
      tissue = c * (wrapLight(N, 0.4) * 1.2 + 0.02);
    }
    float fres = pow(grazing(N, V), 2.0);
    tissue += uAccent * uHighlight * (0.14 + 0.7 * fres);
    float alpha = 1.0 - 0.94 * uGhost;
    // ghosting beyond the vessel-mode share (e.g. another part inspected) fades the glow too
    float extra = sat((uGhost - uVesGhost) / max(1.0 - uVesGhost, 1e-3));
    vec3 outc = tissue * alpha + glow * uGlow * (1.0 - extra);
    gl_FragColor = vec4(max(outc, vec3(0.0)), alpha);
  }
`;

function baseUniforms(lights, extra) {
  return {
    ...lights,
    uGhost: { value: 0 }, uHighlight: { value: 0 }, uTime: { value: 0 }, uGlow: { value: 0 }, uEncl: { value: 1 },
    uR: { value: L.retinaInnerR }, uRC: { value: RC }, uTexExt: { value: TEX_EXT }, uLimbusPolar: { value: am.LIMBUS_POLAR },
    uAccent: { value: new THREE.Color(PALETTE.accent) },
    uArtGlow: { value: new THREE.Color(PALETTE.arteryGlow) }, uVeinGlow: { value: new THREE.Color(PALETTE.veinGlow) },
    uNoise: { value: noiseTexture() },
    ...extra,
  };
}

export const DISC_GEOM = {
  axes: new THREE.Vector2(EYE.discDiameter.h * 0.5, EYE.discDiameter.v * 0.5),
  // cup: horizontally oval, displaced temporally and slightly superiorly. Rim widths (mm):
  // I 0.69 > S 0.65 > N 0.625 > T 0.405 (ISNT rule). C/D 0.42 horizontal, 0.29 vertical.
  cupC: new THREE.Vector2(-0.11, 0.02),
  cupAx: new THREE.Vector2(0.37, 0.27),
  depth: 0.28,
};

export function makeFundusMaterial(kind, lights, chorTex) {
  const defines = {}; defines[kind] = '';
  const mat = new THREE.ShaderMaterial({
    defines,
    uniforms: baseUniforms(lights, {
      uChor: { value: chorTex },
      uDisc: { value: am.DISC_MAP.clone() },
      uDiscAx: { value: DISC_GEOM.axes.clone() },
      uCupC: { value: DISC_GEOM.cupC.clone() },
      uCupAx: { value: DISC_GEOM.cupAx.clone() },
      uCamLocal: { value: new THREE.Vector3(0, 0, 100) },
      uCRetina: { value: new THREE.Color(PALETTE.retina) },
      uCMacula: { value: new THREE.Color(PALETTE.macula) },
      uCDisc: { value: new THREE.Color(PALETTE.disc) },
      uDiscCut: { value: 0 },
    }),
    vertexShader: VERT,
    fragmentShader: COMMON + FUNDUS_FRAG,
  });
  if (kind !== 'RETINA') {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -4;
  }
  if (kind === 'DISC') mat.side = THREE.DoubleSide;
  return mat;
}

export function makeChoroidMaterial(lights, chorTex, phaseTex, ampDirs, poleDir) {
  const mat = new THREE.ShaderMaterial({
    uniforms: baseUniforms(lights, {
      uChor: { value: chorTex },
      uPhase: { value: phaseTex },
      uAmp: { value: ampDirs },
      uPoleDir: { value: poleDir },
      uVesGhost: { value: 0 },
    }),
    vertexShader: VERT,
    fragmentShader: COMMON + CHOROID_FRAG,
  });
  mat.premultipliedAlpha = true;
  return mat;
}
