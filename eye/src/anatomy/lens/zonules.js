// Zonules of Zinn: ~600 fibre bundles as camera-facing ribbons in ONE draw call, shaded like silk
// (Kajiya-Kay sheen, fake cylinder across the ribbon, min-pixel-width anti-aliasing).
//  - anterior zonules: arise on the pars plana, run forward in the valleys between the ciliary processes,
//    then cross the circumlental space to the ANTERIOR capsule, ~0.5–1.3 mm in front of the equator;
//  - posterior zonules: arise from the valleys of the pars plicata and run back to the POSTERIOR capsule
//    (so the two sheets cross, bounding the canal of Petit);
//  - equatorial zonules: short fibres from the processes to the equator.
import * as THREE from 'three';
import { rng } from '../../lib/materials.js';
import { CB, valleyAz, surfaceDepth, cbPoint, tOra, lensSurfacePoint, lensPolarPoint, LENS } from './profile.js';

const VERT = /* glsl */`
  attribute vec3 aTan;
  attribute vec4 aZ;     // x: u along fibre (0 origin .. 1 insertion), y: side (-1|1), z: half-width mm, w: seed
  attribute vec2 aK;     // x: kind (0 ant, 1 post, 2 equatorial), y: hugging the ciliary surface (0..1)
  uniform float uViewH;
  varying vec3 vT; varying vec3 vV; varying float vSide; varying float vFade; varying float vU; varying float vSeed; varying float vHug; varying float vKind;
  varying float vAz;
  void main() {
    vAz = atan(position.y, position.x);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 tv = normalize((modelViewMatrix * vec4(aTan, 0.0)).xyz);
    vec3 vv = normalize(-mv.xyz);
    vec3 bv = cross(tv, vv);
    float bl = length(bv);
    bv = bl > 1e-4 ? bv / bl : vec3(1.0, 0.0, 0.0);
    float fan = 1.0 + 0.9 * smoothstep(0.92, 1.0, aZ.x);          // fibrils splay at the capsule
    // break the comb: bundle width varies ~2.5x between fibres, and each free span has a slight wave
    float w = aZ.z * fan * mix(1.0, 0.6, aK.y) * (0.6 + 0.9 * fract(aZ.w * 7.31));
    float pixel = 2.0 * max(-mv.z, 0.01) / (projectionMatrix[1][1] * uViewH);
    float wEff = max(w, pixel * 0.65);
    vFade = w / wEff;
    float wave = sin(aZ.x * 17.0 + aZ.w * 40.0) * 0.018 * sin(3.14159 * aZ.x) * (1.0 - aK.y);
    mv.xyz += bv * (aZ.y * wEff + wave);
    gl_Position = projectionMatrix * mv;
    vT = tv; vV = vv; vSide = aZ.y; vU = aZ.x; vSeed = aZ.w; vHug = aK.y; vKind = aK.x;
  }`;

const FRAG = /* glsl */`
  uniform vec3 uLDir[3]; uniform vec3 uLCol[3];
  uniform float uGhost, uHighlight, uDim, uOpacity;
  uniform vec3 uBase;
  uniform float uCut, uCutAz, uCutHalf;
  varying float vAz;
  varying vec3 vT; varying vec3 vV; varying float vSide; varying float vFade; varying float vU; varying float vSeed; varying float vHug; varying float vKind;
  void main() {
    if (uCut > 0.001 && abs(mod(vAz - uCutAz + 3.14159265, 6.2831853) - 3.14159265) < uCutHalf) discard;
    vec3 T = normalize(vT); vec3 V = normalize(vV);
    float x = vSide;
    float core = sqrt(max(0.0, 1.0 - x * x));
    // fibrils at the insertion fan: a few sub-strands across the ribbon
    float fanK = smoothstep(0.92, 1.0, vU);
    float strands = mix(1.0, 0.35 + 0.65 * pow(abs(sin((x * 2.5 + vSeed * 7.0) * 3.14159)), 3.0), fanK);
    vec3 col = uBase * 0.05;
    for (int k = 0; k < 3; k++) {
      vec3 Ld = normalize((viewMatrix * vec4(uLDir[k], 0.0)).xyz);
      float tl = dot(T, Ld);
      float diff = sqrt(max(0.0, 1.0 - tl * tl));
      vec3 H = normalize(Ld + V);
      float th = dot(T, H);
      float spec = pow(sqrt(max(0.0, 1.0 - th * th)), 90.0);
      float spec2 = pow(sqrt(max(0.0, 1.0 - th * th)), 14.0);
      col += uLCol[k] * (uBase * diff * 0.2 + vec3(1.0) * spec * 1.3 + uBase * spec2 * 0.12);
    }
    float a = uOpacity * core * strands * vFade * (1.0 - 0.45 * fanK);
    a *= mix(1.0, 0.14, vHug);                                  // lying in the dark valleys of the ciliary body
    a *= smoothstep(0.0, 0.06, vU);                              // fade in from the origin in the basal lamina
    float br = fract(vSeed * 13.7);
    a *= 0.3 + 0.3 * br + 1.1 * br * br;                         // ~5x brightness spread between bundles
    col *= 1.0 - 0.6 * uDim;
    col += vec3(0.85, 1.0, 0.25) * uHighlight * 0.6;
    a *= 1.0 - 0.94 * uGhost;
    gl_FragColor = vec4(col * a, a);
  }`;

export function buildZonules(seed = 91) {
  const R = rng(seed);
  const P = CB.P;
  const fibres = [];
  const tmp = new THREE.Vector3();
  const onSurface = (t, az, lift) => cbPoint(t, surfaceDepth(t, az) + lift, az, new THREE.Vector3());

  for (let i = 0; i < CB.N; i++) {
    // each valley between two processes carries a small bundle of fibres, spread across its floor
    const groove = (off, t) => valleyAz(i, t) + off * P;
    // --- anterior zonules (pars plana -> anterior capsule)
    const nA = 4 + (R() < 0.4 ? 1 : 0);
    for (let f = 0; f < nA; f++) {
      const off = (R() - 0.5) * 0.14;
      const tO = 2.7 + R() * Math.max(0.5, tOra(groove(off, 3)) - 3.4);
      const tL = 0.45 + R() * 0.75;
      const r = 0.010 + R() * 0.009;
      const pts = [], hug = [];
      for (let t = tO; t > tL; t -= 0.25) { pts.push(onSurface(t, groove(off, t), 0.02 + r)); hug.push(1); }
      pts.push(onSurface(tL, groove(off, tL), 0.03 + r)); hug.push(1);
      const azI = groove(off, tL) + (R() - 0.5) * 0.4 * P;
      const ins = lensSurfacePoint(LENS.Re - (0.5 + R() * 0.8), true, azI, 0.004);
      pushSpan(pts, hug, ins, 7, R);
      fibres.push({ pts, hug, r, kind: 0, seed: R() });
    }
    // --- posterior zonules (pars plicata valleys -> posterior capsule)
    const nP = 2 + (R() < 0.7 ? 1 : 0);
    for (let f = 0; f < nP; f++) {
      const off = (R() - 0.5) * 0.14;
      const tO = 0.55 + R() * 1.35;
      const r = 0.008 + R() * 0.007;
      const pts = [], hug = [];
      for (let t = tO + 0.45; t > tO; t -= 0.15) { pts.push(onSurface(t, groove(off, t), 0.02 + r)); hug.push(1); }
      pts.push(onSurface(tO, groove(off, tO), 0.03 + r)); hug.push(1);
      const azI = groove(off, tO) + (R() - 0.5) * 0.4 * P;
      const ins = lensSurfacePoint(LENS.Re - (0.35 + R() * 0.85), false, azI, 0.004);
      pushSpan(pts, hug, ins, 7, R);
      fibres.push({ pts, hug, r, kind: 1, seed: R() });
    }
    // --- equatorial zonules
    const nE = R() < 0.6 ? 2 : 1;
    for (let f = 0; f < nE; f++) {
      const off = (R() - 0.5) * 0.14;
      const tO = 0.35 + R() * 0.7;
      const r = 0.007 + R() * 0.006;
      const pts = [onSurface(tO + 0.2, groove(off, tO + 0.2), 0.02 + r), onSurface(tO, groove(off, tO), 0.03 + r)];
      const hug = [1, 1];
      const ins = lensPolarPoint(Math.PI / 2 + (R() - 0.5) * 0.25, groove(off, tO) + (R() - 0.5) * 0.3 * P, 0.004);
      pushSpan(pts, hug, ins, 5, R);
      fibres.push({ pts, hug, r, kind: 2, seed: R() });
    }
  }

  // ribbons
  const pos = [], tan = [], z = [], kk = [], idx = [];
  let base = 0, segs = 0;
  for (const fb of fibres) {
    const curve = new THREE.CatmullRomCurve3(fb.pts, false, 'centripetal', 0.5);
    const n = Math.max(8, Math.round(curve.getLength() / 0.16));
    const pts = curve.getSpacedPoints(n);
    const hugN = fb.hug.length, total = fb.pts.length;
    for (let j = 0; j <= n; j++) {
      const u = j / n;
      const p = pts[j];
      const a = pts[Math.max(0, j - 1)], b = pts[Math.min(n, j + 1)];
      tmp.subVectors(b, a).normalize();
      // hugging weight: fraction of control points still on the surface at this parameter
      const cu = u * (total - 1);
      const hugW = cu < hugN - 1 ? 1 : Math.max(0, 1 - (cu - (hugN - 1)) / 1.2);
      for (const s of [-1, 1]) {
        pos.push(p.x, p.y, p.z); tan.push(tmp.x, tmp.y, tmp.z);
        z.push(u, s, fb.r, fb.seed); kk.push(fb.kind, hugW);
      }
      if (j > 0) { const q = base + (j - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); segs++; }
    }
    base += (n + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 3));
  g.setAttribute('aZ', new THREE.Float32BufferAttribute(z, 4));
  g.setAttribute('aK', new THREE.Float32BufferAttribute(kk, 2));
  g.setIndex(base > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();

  const uniforms = {
    uLDir: { value: [new THREE.Vector3(-40, 55, 70).normalize(), new THREE.Vector3(60, 20, -80).normalize(), new THREE.Vector3(10, -60, 20).normalize()] },
    uLCol: { value: [new THREE.Color(0xfff1e0).multiplyScalar(1.55), new THREE.Color(0x9fc4ff).multiplyScalar(1.25), new THREE.Color(0xff9a7a).multiplyScalar(0.35)] },
    uGhost: { value: 0 }, uHighlight: { value: 0 }, uDim: { value: 0 }, uOpacity: { value: 0.24 },
    uCut: { value: 0 }, uCutAz: { value: 0 }, uCutHalf: { value: 0 },
    uBase: { value: new THREE.Color(0.86, 0.86, 0.84) },
    uViewH: { value: 1080 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'zonule-fibres';
  mesh.renderOrder = 2;
  mesh.frustumCulled = true;
  return { mesh, uniforms, count: fibres.length, fibres };
}

// Free span from the last surface point to the capsule insertion: taut, with the faintest sag.
function pushSpan(pts, hug, ins, n, R) {
  const a = pts[pts.length - 1].clone();
  const sag = new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(0.05);
  for (let k = 1; k <= n; k++) {
    const u = k / n;
    const p = new THREE.Vector3().lerpVectors(a, ins, u).addScaledVector(sag, Math.sin(Math.PI * u));
    pts.push(p); hug.push(0);
  }
}
