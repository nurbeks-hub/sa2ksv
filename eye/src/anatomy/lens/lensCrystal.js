// The crystalline lens: one mesh (the capsule surface) whose fragment shader ray-marches the lens volume
// analytically — refraction at the capsule, onion-layer fibre shells with meridional fibres, the amber
// nucleus, the Y sutures (anterior upright Y, posterior inverted Y) as analytic sheet integrals,
// Purkinje-style reflections of the stage lights on both faces and a transmitted back-light rim.
// Premultiplied blending, no depth write. The lens outline lives in a tiny polar lookup texture.
import * as THREE from 'three';
import { GLSL_NOISE } from '../../lib/materials.js';
import { LENS, lensBTable, lensOutline } from './profile.js';

const VERT = /* glsl */`
  varying vec3 vL; varying vec3 vNL;
  void main() {
    vL = position; vNL = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAG = /* glsl */`
  #define PI 3.14159265
  uniform sampler2D uBTex;          // R: B(phi) mm, G: dB/dphi, phi in [0, PI]
  uniform float uBN;                // table intervals
  uniform vec3 uCamL;
  uniform vec3 uLDir[3];
  uniform vec3 uLCol[3];
  uniform vec3 uLT1[3];
  uniform vec3 uLT2[3];
  uniform float uAmb, uGhost, uHighlight, uDim, uPixAng, uRe, uSutW, uGain, uZMax;
  uniform vec3 uCortex, uNucleus, uSuture;
  uniform float uArm[6];
  uniform float uBend[6];
  varying vec3 vL; varying vec3 vNL;
  ${GLSL_NOISE}

  // polar outline table indexed by u = (1 - cos phi) / 2: R = B (mm), G = dB/dcos(phi)
  vec2 Btab(float c) { return texture2D(uBTex, vec2(((0.5 - 0.5 * c) * uBN + 0.5) / (uBN + 1.0), 0.5)).rg; }
  float shellS(vec3 p) { float r = length(p); return r / Btab(p.z / max(r, 1e-5)).r; }
  // analytic outward normal of the shell through p: grad(|p| / B(c)), c = z / |p|
  vec3 shellN(vec3 p) {
    float r = max(length(p), 1e-5);
    vec3 er = p / r;
    vec2 b = Btab(er.z);
    return normalize(er / b.x - (b.y / (b.x * b.x)) * (vec3(0.0, 0.0, 1.0) - er.z * er));
  }
  float erfA(float x) { float x2 = x * x; float a = 0.147 * x2; return sign(x) * sqrt(1.0 - exp(-x2 * (1.2732395 + a) / (1.0 + a))); }
  float hg(float c, float g) { float g2 = g * g; float d = max(1.0 + g2 - 2.0 * g * c, 1e-4); return (1.0 - g2) / (4.0 * PI * d * sqrt(d)); }
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  float p4(float x) { x *= x; return x * x; }
  // mean of the bump (1 - u^2)^2, u = (s - si) / w, over a segment where s runs linearly from sa to sb
  float bumpC(float u) { u = clamp(u, -1.0, 1.0); float u2 = u * u; return u * (1.0 - u2 * (0.6666667 - 0.2 * u2)); }
  float shellSeg(float sa, float sb, float si, float w) {
    float ua = (sa - si) / w, ub = (sb - si) / w, du = ub - ua;
    if (abs(du) < 1e-3) { float um = 0.5 * (ua + ub); float q = max(0.0, 1.0 - um * um); return q * q; }
    return (bumpC(ub) - bumpC(ua)) / du;
  }

  // Rounded soft-box seen in direction r (the stage lights as area lights in the reflections).
  float softbox(vec3 r, int k, vec2 size) {
    float w = dot(r, uLDir[k]);
    if (w <= 0.0) return 0.0;
    vec2 uv = vec2(dot(r, uLT1[k]), dot(r, uLT2[k])) / (w * size);
    vec2 q = abs(uv);
    float d = pow(p4(q.x) + p4(q.y), 0.25) - 0.45;                            // squircle: no sharp corners
    float b = 1.0 - smoothstep(-0.15, 0.4, d);                                // soft, wide edge
    float fall = exp(-1.8 * dot(uv, uv));                                     // internal radial falloff
    return b * (0.3 + 0.7 * fall) * (0.82 + 0.18 * clamp(uv.y, -1.0, 1.0));
  }
  vec3 env(vec3 r) {
    // key + rim soft-boxes (gains ~4x lower than before so they never clip to flat white cards); the under
    // light is only a low, soft glow lobe (no hard box on the rim)
    vec3 c = uLCol[0] * softbox(r, 0, vec2(0.11, 0.085)) * 6.5
           + uLCol[1] * softbox(r, 1, vec2(0.04, 0.32)) * 5.0
           + uLCol[2] * pow(max(dot(r, uLDir[2]), 0.0), 18.0) * 0.5;
    return c + vec3(0.006, 0.007, 0.010) * (1.2 + r.y);
  }

  // Suture sheets: half-planes through the optical axis in the anterior half (upright Y: arms at 30, 150,
  // 270 deg) and the posterior half (inverted Y: 90, 210, 330 deg). Edge-on they integrate to a luminous
  // line; seen obliquely they read as the lines where the sheet meets the capsule and the nuclear shells.
  vec3 sutures(vec3 ro, vec3 rd, float tE, float pix) {
    vec3 I = vec3(0.0);
    float tz = abs(rd.z) > 1e-5 ? -ro.z / rd.z : 1e9;
    for (int k = 0; k < 6; k++) {
      float ang = k < 3 ? (0.5236 + float(k) * 2.0944) : (1.5708 + float(k - 3) * 2.0944);
      float ta = 0.0, tb = tE;
      if (k < 3) { if (rd.z > 0.0) ta = max(ta, tz); else tb = min(tb, tz); }
      else       { if (rd.z > 0.0) tb = min(tb, tz); else ta = max(ta, tz); }
      if (tb <= ta) continue;
      vec3 pm = ro + rd * (0.5 * (ta + tb));
      float rr = length(pm.xy) / uRe;
      ang += uBend[k] * rr * rr + 0.012 * sin(rr * 9.0 + float(k) * 1.7);
      vec2 dir = vec2(cos(ang), sin(ang));
      vec3 pn = vec3(dir.y, -dir.x, 0.0);
      float d0 = dot(ro, pn), dn = dot(rd, pn);
      float tcross = abs(dn) > 1e-4 ? clamp(-d0 / dn, ta, tb) : 0.5 * (ta + tb);
      float tc = mix(0.5 * (ta + tb), tcross, smoothstep(0.02, 0.1, abs(dn)));
      vec3 q = ro + rd * tc;
      float along = dot(q.xy, dir);
      float sq = shellS(q);
      float armLen = uArm[k] * max(sq, 0.2) * uRe;
      float rq = length(q.xy);
      float m = smoothstep(-0.01, 0.04, along) * (1.0 - smoothstep(armLen * 0.7, armLen, rq))
              * smoothstep(0.06, 0.22, sq) * (1.0 - smoothstep(0.93, 1.0, sq));
      if (m <= 0.0) continue;
      float w = max(uSutW, pix * 0.75);
      float integ;
      if (abs(dn) < 0.03) { float dc = d0 + dn * tc; integ = (tb - ta) * exp(-dc * dc / (w * w)); }
      else integ = w * 0.8862 / dn * (erfA((d0 + tb * dn) / w) - erfA((d0 + ta * dn) / w));
      integ *= uSutW / w;
      integ = 0.05 * (1.0 - exp(-integ / 0.05));    // edge-on sheets saturate at the weight of the oblique lines
      float sg = max(0.0045, 0.8 * pix / 3.0);
      float lines = 1.3 * exp(-pow((sq - 0.972) / (sg * 1.6), 2.0)) + 0.9 * exp(-pow((sq - 0.64) / sg, 2.0)) + 0.45 * exp(-pow((sq - 0.36) / sg, 2.0));
      float obl = smoothstep(0.02, 0.25, abs(dn));
      float dq = d0 + dn * tcross;
      integ = mix(integ, 0.0, obl * 0.85) + obl * lines * 0.12 * exp(-dq * dq / (w * w));
      float fetal = 0.55 + 0.45 * exp(-pow((sq - 0.5) / 0.22, 2.0));
      I += m * fetal * integ * (k < 3 ? vec3(1.0, 0.97, 0.93) : vec3(1.0, 0.7, 0.42) * 0.3);   // posterior: a faint warm λ
    }
    return I;
  }

  void main() {
    vec3 ro = vL;
    vec3 rd = normalize(vL - uCamL);
    vec3 n = normalize(vNL);
    float cosi = clamp(dot(-rd, n), 0.0, 1.0);
    float F = 0.028 + 0.972 * p4(1.0 - cosi) * (1.0 - cosi);
    vec3 col = env(reflect(rd, n)) * F;                      // anterior-face reflection (Purkinje III)

    vec3 rdi = refract(rd, n, 0.91);
    if (dot(rdi, rdi) < 0.5) rdi = rd;

    // exit: bounding ellipsoid (the lens lies inside it) -> bracket -> bisection on s = 1
    vec3 sc = vec3(uRe, uRe, uZMax);
    vec3 eo = ro / sc, ed = rdi / sc;
    float qa = dot(ed, ed), qb = dot(eo, ed), qc = dot(eo, eo) - 1.0;
    float tEl = (-qb + sqrt(max(qb * qb - qa * qc, 0.0))) / qa;
    float lo = 0.0, hi = tEl;
    for (int i = 1; i <= 4; i++) { float tt = tEl * float(i) * 0.2; if (shellS(ro + rdi * tt) < 1.0) lo = tt; else { hi = tt; break; } }
    for (int i = 0; i < 5; i++) { float m = 0.5 * (lo + hi); if (shellS(ro + rdi * m) > 1.0) hi = m; else lo = m; }
    float tE = 0.5 * (lo + hi);

    // volume: thin growth shells are pre-integrated per segment (alias-free with few steps), the fine
    // lamellae / meridional fibres / nuclear fill are point-sampled at segment midpoints.
    const int N = 14;
    float dt = tE / float(N);
    vec3 pMid = ro + rdi * (0.5 * tE);
    float nz = vnoise(pMid * 1.3 + 3.7) - 0.5;
    float fibMask = smoothstep(0.3, 0.75, vnoise(pMid * 3.1 + 9.0));
    float fibPh = atan(pMid.y, pMid.x) * 150.0 + nz * 26.0;
    float accC = 0.0, accN = 0.0;
    float sa = shellS(ro);
    for (int i = 1; i <= N; i++) {
      float sb = shellS(ro + rdi * (float(i) * dt));
      float s = 0.5 * (sa + sb);
      float zm = ro.z + rdi.z * ((float(i) - 0.5) * dt);
      float lamC = p4(p4(0.5 + 0.5 * cos(6.2832 * (s * 8.0 + nz * 0.12))));
      float lamF = p4(0.5 + 0.5 * cos(6.2832 * (s * 31.0 + nz * 0.35)));
      float fibr = p4(p4(0.5 + 0.5 * cos(fibPh + s * 20.0))) * fibMask;
      float cortex = smoothstep(0.66, 0.85, s);
      float bow = cortex * exp(-zm * zm * 4.9) * smoothstep(0.85, 0.97, s);
      // zones of discontinuity: capsule, cortical C1, adult-nucleus and embryonic-nucleus boundaries
      float zc = shellSeg(sa, sb, 0.988, 0.010) * 2.4 + shellSeg(sa, sb, 0.815, 0.014) * 0.25;
      float zn = shellSeg(sa, sb, 0.64, 0.02) * 1.0 + shellSeg(sa, sb, 0.3, 0.02) * 0.45;
      // grazing factor of this segment: |ds/dt| / |grad s| ~ |cos| between the ray and the shell normal
      // (|grad s| ~ s / |p|); the thin shells stay faint face-on and rise at grazing / optical-section angles
      float rm = max(length(ro + rdi * ((float(i) - 0.5) * dt)), 0.05);
      float graze = 1.0 - clamp(abs(sb - sa) / dt * rm / max(s, 0.05), 0.0, 1.0);
      float shw = 0.35 + 0.65 * graze * graze;
      accC += 0.0004 + cortex * (lamC * 0.006 + lamF * (0.0015 + 0.014 * fibr)) + bow * 0.03 + zc * 0.07 * shw;
      accN += (1.0 - smoothstep(0.2, 0.66, s)) * (0.006 + 0.005 * (1.0 - smoothstep(0.0, 0.66, s))) + zn * 0.06 * shw;
      sa = sb;
    }
    accC *= dt; accN *= dt;
    float tau = accN / 0.03;

    // single scattering of the stage lights (forward-peaked), plus a floor so the key side still reads
    vec3 Ls = vec3(uAmb);
    for (int k = 0; k < 3; k++) Ls += uLCol[k] * hg(dot(uLDir[k], rdi), 0.45) * 1.7;

    float pix = length(vL - uCamL) * uPixAng;
    vec3 sut = sutures(ro, rdi, tE, pix);
    vec3 vol = (accC * uCortex + accN * uNucleus + sut * uSuture) * Ls;

    // exit face: internal reflection (Purkinje IV, inverted) and transmitted back-light
    vec3 pE = ro + rdi * tE;
    vec3 nE = shellN(pE);
    float cosE = clamp(dot(rdi, nE), 0.0, 1.0);
    float FE = 0.02 + 0.98 * p4(1.0 - cosE) * (1.0 - cosE);
    vec3 r2 = reflect(rdi, nE);
    vec3 tr = refract(rdi, -nE, 1.18);
    vec3 back = dot(tr, tr) < 0.5 ? env(r2) : env(normalize(tr)) * 0.35 * (1.0 - FE);
    vol += env(r2) * FE * 0.35 + back * vec3(1.0, 0.93, 0.8) * 0.6;
    // faint cool caustic around the posterior pole (the lens focusing the stage light): clear glass on black
    float lsum = dot(uLCol[0] + uLCol[1], vec3(0.33));
    vol += vec3(0.55, 0.75, 1.0) * 0.012 * lsum * exp(-dot(pE.xy, pE.xy) * 0.3) * (1.0 - smoothstep(-0.6, 0.2, pE.z));

    col += (1.0 - F) * vol * uGain;
    float gr = 1.0 - cosi;
    col += (vec3(0.7, 0.8, 1.0) * pow(gr, 5.0) * 0.16 + vec3(1.0, 0.72, 0.4) * pow(gr, 2.5) * 0.02);  // crystal edge, faint dispersion
    col *= 1.0 - 0.65 * uDim;
    col += vec3(0.85, 1.0, 0.25) * uHighlight * (0.08 + 0.55 * (1.0 - cosi) * (1.0 - cosi));
    float alpha = (1.0 - exp(-tau * 0.3)) * 0.55;
    float g = 1.0 - 0.94 * uGhost;
    gl_FragColor = vec4(col * g, alpha * g);
  }`;

export function buildLensMesh() {
  const outline = lensOutline(128);
  const NAZ = 144;
  const rows = outline.length;
  const pos = new Float32Array(rows * (NAZ + 1) * 3), nor = new Float32Array(rows * (NAZ + 1) * 3);
  let o = 0, zMax = 0;
  for (let j = 0; j < rows; j++) {
    const { rho, z, nr, nz } = outline[j];
    zMax = Math.max(zMax, Math.abs(z));
    for (let k = 0; k <= NAZ; k++) {
      const a = (k / NAZ) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos[o] = rho * c; pos[o + 1] = rho * s; pos[o + 2] = z;
      nor[o] = nr * c; nor[o + 1] = nr * s; nor[o + 2] = nz;
      o += 3;
    }
  }
  const idx = [];
  for (let j = 0; j < rows - 1; j++) for (let k = 0; k < NAZ; k++) {
    const a = j * (NAZ + 1) + k, b = a + NAZ + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();

  const BN = 256;
  const tab = lensBTable(BN);
  const half = new Uint16Array((BN + 1) * 4);
  for (let i = 0; i <= BN; i++) {
    half[i * 4] = THREE.DataUtils.toHalfFloat(tab[i * 2]);
    half[i * 4 + 1] = THREE.DataUtils.toHalfFloat(tab[i * 2 + 1]);
    half[i * 4 + 2] = 0; half[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const btex = new THREE.DataTexture(half, BN + 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  btex.minFilter = btex.magFilter = THREE.LinearFilter;
  btex.wrapS = btex.wrapT = THREE.ClampToEdgeWrapping;
  btex.generateMipmaps = false;
  btex.colorSpace = THREE.NoColorSpace;
  btex.needsUpdate = true;

  const uniforms = {
    uBTex: { value: btex }, uBN: { value: BN }, uZMax: { value: zMax * 1.08 + 0.02 },
    uCamL: { value: new THREE.Vector3(0, 0, 60) },
    uLDir: { value: [new THREE.Vector3(-0.4, 0.55, 0.7).normalize(), new THREE.Vector3(0.6, 0.2, -0.8).normalize(), new THREE.Vector3(0.15, -0.9, 0.3).normalize()] },
    uLCol: { value: [new THREE.Color(0xfff1e0).multiplyScalar(1.55), new THREE.Color(0x9fc4ff).multiplyScalar(1.25), new THREE.Color(0xff9a7a).multiplyScalar(0.35)] },
    uLT1: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uLT2: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uAmb: { value: 0.22 },
    uGhost: { value: 0 }, uHighlight: { value: 0 }, uDim: { value: 0 },
    uPixAng: { value: 0.0005 }, uRe: { value: LENS.Re }, uSutW: { value: 0.012 }, uGain: { value: 1.0 },
    uCortex: { value: new THREE.Color(0.9, 0.93, 1.0) },
    uNucleus: { value: new THREE.Color(1.0, 0.56, 0.17) },
    uSuture: { value: new THREE.Color(1.0, 0.97, 0.9).multiplyScalar(0.8) },
    uArm: { value: [0.66, 0.7, 0.63, 0.7, 0.64, 0.68] },
    uBend: { value: [0.07, -0.05, 0.04, -0.06, 0.05, -0.04] },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'lens-crystal';
  mesh.renderOrder = 3;
  updateLightFrames(uniforms);
  return { mesh, uniforms };
}

// Tangent frames of the soft-box reflections (per light), recomputed when the light directions change.
const _up = new THREE.Vector3();
export function updateLightFrames(u) {
  for (let k = 0; k < 3; k++) {
    const L = u.uLDir.value[k];
    _up.set(0, 1, 0); if (Math.abs(L.y) > 0.95) _up.set(1, 0, 0);
    u.uLT1.value[k].crossVectors(_up, L).normalize();
    u.uLT2.value[k].crossVectors(L, u.uLT1.value[k]);
  }
}
