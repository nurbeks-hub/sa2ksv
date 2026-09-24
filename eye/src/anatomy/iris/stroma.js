// Iris stroma: (1) anterior surface (displaced grid driven by the live pupil, polar albedo + relief maps, analytic
// low-frequency topography and contraction folds, procedural micro-relief), (2) thousands of 3D trabecular strands
// (one instanced draw of camera-facing ribbons with cylindrical normals, bridging the crypts), (3) the pigment layer:
// pupillary ruff (frill), posterior pigment epithelium with radial folds, and the root skirt, all in one geometry.
import * as THREE from 'three';
import { P0, R1, TAU, H_AMP, collaretteS, rad } from './profile.js';
import { patchedMaterial, gridGeometry, irisBounds, SHARED } from './shading.js';

// Vertex displacement samples the relief map at a mip below the grid Nyquist (448 x 100 cells vs 4096 x 1024
// texels -> ~2^4.5): the vertices carry only the band-limited shape, every finer detail is shading (normals from
// texture-space differences on an analytic tangent frame), so no triangle facets can appear.
const HMIP = '4.5';

// ------------------------------------------------------------------------------------------------ anterior surface
export function buildStromaSurface({ colorTex, heightTex, quality }) {
  const nu = quality === 'low' ? 320 : 448, nv = quality === 'low' ? 72 : 100;
  const geo = irisBounds(gridGeometry(nu, nv));
  const mat = patchedMaterial({
    name: 'stroma',
    params: { map: colorTex, roughness: 0.7, metalness: 0.0, color: 0xffffff, envMapIntensity: 0.7 },
    uniforms: { uHMap: { value: heightTex }, uHAmp: { value: H_AMP }, uSSS: { value: 0.05 } },
    vHead: /* glsl */`
      uniform sampler2D uHMap; uniform float uHAmp;
      varying vec2 vIrUv; varying vec2 vIrXY; varying vec4 vFmA; varying float vFmB;
      varying vec3 vIrTu; varying vec3 vIrTv; varying vec3 vIrGeo;`,
    vNormal: /* glsl */`
      float irTh = uv.x * IR_TAU, irS = uv.y;
      float irPp = irPth(irTh, uPupil);
      float irR = irRad(irS, irPp);
      vFmA = irFurrowMasksA(irTh); vFmB = irFurrowMaskB(irTh);
      float irFur = irFurrowHD(irTh, irS, irFurrowAmp(uPupil), vFmA, vFmB).x;
      float irTex = (textureLod(uHMap, uv, ${HMIP}).r - 0.5) * uHAmp;
      float irTk = irTuck(irR, irPp);                      // tuck the stroma edge under the pupillary ruff
      vec3 irP = irPolar(irTh, irR, irFrontD(irTh, irS, irPp) + (irTex + irFur) * (1.0 - irTk) - irTk * (0.5 * irThick(irS, irPp) + 0.02));
      // analytic tangent frame of the smooth base surface (slab + low-frequency topography)
      float irDs = (irFrontD(irTh, irS + 0.004, irPp) - irFrontD(irTh, irS - 0.004, irPp)) / 0.008;
      float irDt = (irFrontD(irTh + 0.01, irS, irPth(irTh + 0.01, uPupil)) - irFrontD(irTh - 0.01, irS, irPth(irTh - 0.01, uPupil))) / 0.02;
      vec2 irCs = vec2(cos(irTh), sin(irTh));
      vec3 irPs = vec3(irCs * (IR_R1 - irPp), irDs);
      vec3 irPt = vec3(-irCs.y * irR, irCs.x * irR, irDt);
      vec3 irN = normalize(cross(irPs, irPt));
      vIrTu = normalize(mat3(modelViewMatrix) * irPt); vIrTv = normalize(mat3(modelViewMatrix) * irPs);
      vIrUv = uv; vIrXY = irP.xy; vIrGeo = vec3(irR, irPp, irR - irPp);`,
    fHead: /* glsl */`
      uniform sampler2D uHMap; uniform float uHAmp, uSSS;
      varying vec2 vIrUv; varying vec2 vIrXY; varying vec4 vFmA; varying float vFmB;
      varying vec3 vIrTu; varying vec3 vIrTv; varying vec3 vIrGeo;
      float irMicro; float irH0; vec2 irFur; float irCav;`,
    fColor: /* glsl */`
      {
        float th = vIrUv.x * IR_TAU;
        // contraction folds: evaluated once per fragment (height + analytic slope), mostly relief, gentle albedo
        irFur = irFurrowHD(th, vIrUv.y, irFurrowAmp(uPupil), vFmA, vFmB);
        float tr = clamp(-irFur.x / (1.3 * IR_FURROW_MAX), 0.0, 1.0), cr = clamp(irFur.x / (0.35 * IR_FURROW_MAX), 0.0, 1.0);
        diffuseColor.rgb *= (1.0 - 0.25 * tr) * (1.0 + 0.06 * cr);
        // the pigment epithelium curls over the margin: the stroma darkens into the ruff instead of meeting it edge-on
        diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.04, 0.2, vIrGeo.z));
        float px = length(fwidth(vIrXY));
        irMicro = 0.006 * (1.0 - smoothstep(0.003, 0.009, px));
        if (irMicro > 0.0) diffuseColor.rgb *= 0.92 + 0.16 * vnoise(vec3(vIrXY * 24.0, 0.5));
        irH0 = texture2D(uHMap, vIrUv).r;
      }`,
    fRough: /* glsl */`
      roughnessFactor = mix(0.92, roughnessFactor, smoothstep(0.2, 0.48, irH0));`,
    // Relief shading: gradient of the painted height (texture-space differences at the pixel footprint) plus the
    // analytic fold slope and a micro-grain, applied on the analytic tangent frame (continuous across triangles).
    fNormal: /* glsl */`
      {
        vec2 d = max(fwidth(vIrUv), vec2(1.0 / 4096.0, 1.0 / 1024.0));
        float hu = texture2D(uHMap, vIrUv + vec2(d.x, 0.0)).r, hv = texture2D(uHMap, vIrUv + vec2(0.0, d.y)).r;
        vec2 len = vec2(IR_TAU * vIrGeo.x, IR_R1 - vIrGeo.y);              // mm per unit u / v
        vec2 g = vec2((hu - irH0) * uHAmp / (d.x * len.x), (hv - irH0) * uHAmp / (d.y * len.y) + irFur.y / len.y);
        if (irMicro > 0.0) {
          vec2 cs = normalize(vIrXY);
          float e = 0.004, m0 = vnoise(vec3(vIrXY * 42.0, 1.7));
          g += irMicro * vec2(vnoise(vec3((vIrXY + vec2(-cs.y, cs.x) * e) * 42.0, 1.7)) - m0, vnoise(vec3((vIrXY + cs * e) * 42.0, 1.7)) - m0) / e;
        }
        vec3 tu = normalize(vIrTu), tv = normalize(vIrTv);
        normal = normalize(normal - g.x * tu - g.y * tv);
        // directional cavity term (the stage casts no shadows): march the height field towards the key light
        irCav = 0.0;
        #if NUM_DIR_LIGHTS > 0
        {
          vec3 Ld = directionalLights[0].direction;
          float lu = dot(Ld, tu), lv = dot(Ld, tv), ln = dot(Ld, normalize(vNormal));
          float lt = max(length(vec2(lu, lv)), 1e-3);
          vec2 dir = vec2(lu, lv) / lt;
          float occ = 0.0;
          for (int k = 1; k <= 2; k++) {
            float dist = 0.03 * float(k * k);
            float hl = texture2D(uHMap, vIrUv + dir * dist / len).r;
            occ = max(occ, smoothstep(0.0, 0.025, (hl - irH0) * uHAmp - dist * ln / lt));
          }
          irCav = occ * smoothstep(-0.05, 0.2, ln);
        }
        #endif
      }`,
    // Crypt floors and fold troughs are deep: occlude ambient/specular so they read as holes, not shiny patches.
    fAO: /* glsl */`
      {
        float occ = smoothstep(0.12, 0.5, irH0) * (1.0 - 0.4 * clamp(-irFur.x / IR_FURROW_MAX, 0.0, 1.0));
        reflectedLight.indirectDiffuse *= 0.35 + 0.65 * occ;
        reflectedLight.indirectSpecular *= occ * occ;
        reflectedLight.directSpecular *= (0.2 + 0.8 * occ) * (1.0 - 0.85 * irCav);
        reflectedLight.directDiffuse *= 1.0 - 0.6 * irCav;
      }`,
    // Stroma is translucent tissue: a little forward-scattered light keeps the colour alive in shadowed relief.
    fEmissive: /* glsl */`
      totalEmissiveRadiance += diffuseColor.rgb * uSSS;`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'iris-stroma';
  mesh.renderOrder = -2;          // opaque: drawn first so the hidden layers behind it are rejected by early-z
  return { mesh, mats: [mat] };
}

// ------------------------------------------------------------------------------------------------ trabecular strands
export function buildStrands({ colorTex, heightTex, crypts, bundles, pxX, rng, quality }) {
  const R = rng(4242);
  const q = quality === 'low' ? 0.5 : 1;
  const seg = quality === 'low' ? 10 : 16;
  const cmax = seg / 6;                     // at least 6 segments per lateral wave cycle
  const A = [], B = [], Cc = [];
  const add = (th, s0, s1, w, drift, amp, cyc, ph, lift, arch, cv, kind) => {
    if (cyc > cmax) { amp *= cmax / cyc; cyc = cmax; }
    A.push(th, s0, s1, w); B.push(drift, amp, cyc, ph); Cc.push(lift, arch, cv, kind);
  };
  const gauss = () => (R() + R() + R() - 1.5) * 0.8;
  // crypt lookup (strands must not run across the openings; only a few bridge them)
  const buckets = Array.from({ length: 64 }, () => []);
  for (const c of crypts) {
    const b0 = Math.floor(((c.th - c.halfTh * 1.3) / TAU) * 64), b1 = Math.floor(((c.th + c.halfTh * 1.3) / TAU) * 64);
    for (let k = b0; k <= b1; k++) buckets[((k % 64) + 64) % 64].push(c);
  }
  const inCrypt = (th, s) => {
    const t = ((th % TAU) + TAU) % TAU;
    for (const c of buckets[Math.floor((t / TAU) * 64) % 64]) {
      let d = t - c.th; d -= TAU * Math.round(d / TAU);
      const u = d / (c.halfTh * 1.15), v = (s - c.s) / (c.halfS * 1.15);
      if (u * u + v * v < 1) return true;
    }
    return false;
  };
  // keep the longest crypt-free stretch of a radial strand (strands border the crypts instead of crossing them)
  const clip = (th, s0, s1, drift) => {
    const n = 16; let best = null, run = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n, free = !inCrypt(th + drift * t, s0 + (s1 - s0) * t);
      if (free && run === null) run = k;
      if ((!free || k === n) && run !== null) {
        const end = free ? k : k - 1;
        if (!best || end - run > best[1] - best[0]) best = [run, end];
        run = null;
      }
    }
    if (!best) return null;
    const t0 = best[0] / n, t1 = best[1] / n;
    return (t1 - t0) * (s1 - s0) > 0.05 ? [t0, t1] : null;
  };
  const addRadial = (th, s0, s1, w, drift, ...rest) => {
    const c = clip(th, s0, s1, drift);
    if (c) add(th + drift * c[0], s0 + (s1 - s0) * c[0], s0 + (s1 - s0) * c[1], w, drift * (c[1] - c[0]), ...rest);
  };
  const tone = b => Math.min(0.999, b.tone * 0.8 + R() * 0.2);   // hue family follows the bundle

  // pupillary zone: fine gold radial fibres from the ruff to the collarette
  for (let i = 0; i < 560 * q; i++) {
    const th = R() * TAU, sc = collaretteS(th);
    addRadial(th, 0.03 + R() * 0.04, sc - 0.01 - R() * 0.07, 0.007 + R() * 0.009, (R() - 0.5) * 0.08, 0.01 + R() * 0.02, 1 + R() * 2.5, R() * TAU, 0.003 + R() * 0.005, 0.003, R(), 0);
  }
  // ciliary zone, main radial trabeculae: rope-like bundles along the bundle axes
  for (let i = 0; i < 640 * q; i++) {
    const b = bundles[i % bundles.length];
    const th = b.th + gauss() * b.spread * 0.6, sc = collaretteS(th);
    const s0 = sc + 0.015 + R() * 0.05;
    addRadial(th, s0, Math.min(0.985, b.s1 + (R() - 0.5) * 0.08), 0.024 + R() * 0.032, b.curl + (R() - 0.5) * 0.02, 0.02 + R() * 0.05, 1 + R() * 1.8, R() * TAU, 0.014 + R() * 0.014, 0.01 * R(), tone(b), 4);
  }
  // ciliary zone: finer wavy trabeculae, mostly bundled, some crossing obliquely
  for (let i = 0; i < 1300 * q; i++) {
    const b = bundles[Math.floor(R() * bundles.length)];
    const bundled = R() < 0.7;
    const th = bundled ? b.th + gauss() * b.spread * 1.6 : R() * TAU;
    const sc = collaretteS(th);
    const s0 = sc + 0.01 + R() ** 2 * 0.1;
    const s1 = Math.min(0.985, bundled ? b.s1 + (R() - 0.5) * 0.1 : s0 + 0.2 + R() * 0.5);
    const cross = R() < 0.12 ? (R() - 0.5) * 0.3 : 0;
    addRadial(th, s0, Math.max(s0 + 0.08, s1), 0.01 + R() * 0.018, (bundled ? b.curl : (R() - 0.5) * 0.08) + cross, 0.006 + R() * 0.026, 1.2 + R() * 3.5, R() * TAU, 0.006 + R() * 0.01, 0.008 * R(), bundled ? tone(b) : R(), 1);
  }
  // shorter branches scattered through the ciliary zone
  for (let i = 0; i < 420 * q; i++) {
    const th = R() * TAU, s0 = 0.42 + R() * 0.5, s1 = Math.min(0.99, s0 + 0.06 + R() * 0.18);
    addRadial(th, s0, s1, 0.009 + R() * 0.016, (R() - 0.5) * 0.12, 0.006 + R() * 0.018, 0.8 + R() * 2, R() * TAU, 0.005 + R() * 0.008, 0.006 * R(), R(), 1);
  }
  // collarette: interlacing rope-like strands that build the raised ridge
  for (let i = 0; i < 420 * q; i++) {
    const th = R() * TAU, sc = collaretteS(th);
    add(th, sc - 0.03 - R() * 0.025, sc + 0.02 + R() * 0.035, 0.014 + R() * 0.022, (R() - 0.5) * 0.07, 0.01, 0.5 + R(), R() * TAU, 0.012 + R() * 0.01, 0.01, R(), 3);
  }
  // crypt bridges: a few trabeculae spanning the larger crypts of Fuchs (the floor lies deeper)
  for (const c of crypts) {
    if (c.halfS < 0.035) continue;
    const n = Math.floor(R() * 2.6);
    for (let k = 0; k < n; k++) {
      const th = c.th + (R() - 0.5) * 1.2 * c.halfTh;
      add(th, c.s - c.halfS * (1.15 + R() * 0.3), c.s + c.halfS * (1.15 + R() * 0.3), 0.008 + R() * 0.012, (R() - 0.5) * c.halfTh, 0.005 + R() * 0.01, 0.6 + R(), R() * TAU, 0.0, -0.008, R(), 2);
    }
  }
  const count = A.length / 4;
  paintContactShadows(colorTex, A, B, Cc, pxX);

  const base = new THREE.InstancedBufferGeometry();
  const pos = new Float32Array((seg + 1) * 2 * 3), uv = new Float32Array((seg + 1) * 2 * 2), idx = [];
  for (let i = 0; i <= seg; i++) for (let k = 0; k < 2; k++) { const v = i * 2 + k; uv[v * 2] = i / seg; uv[v * 2 + 1] = k ? 1 : -1; }
  for (let i = 0; i < seg; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
  base.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  base.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  base.setAttribute('normal', new THREE.BufferAttribute(new Float32Array((seg + 1) * 2 * 3), 3));   // see gridGeometry
  base.setIndex(idx);
  base.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(A), 4));
  base.setAttribute('iB', new THREE.InstancedBufferAttribute(new Float32Array(B), 4));
  base.setAttribute('iC', new THREE.InstancedBufferAttribute(new Float32Array(Cc), 4));
  base.instanceCount = count;
  irisBounds(base);

  // Blinn-Phong (no IBL) keeps the thin, overdrawn strands cheap; they are lit by the same rig lights as the stroma.
  const mat = patchedMaterial({
    name: 'strands', Base: THREE.MeshPhongMaterial,
    params: { color: 0xffffff, specular: 0x181714, shininess: 18, side: THREE.DoubleSide, alphaToCoverage: true },
    uniforms: {
      uHMap: { value: heightTex }, uCMap: { value: colorTex }, uHAmp: { value: H_AMP },
      uTOl: { value: new THREE.Color(0x98a668) }, uTBr: { value: new THREE.Color(0xa6926a) }, uTBl: { value: new THREE.Color(0x8a9a96) },
      uTPer: { value: new THREE.Color(0x7a8e94) }, uTPup: { value: new THREE.Color(0xd8a050) }, uTCre: { value: new THREE.Color(0xb89c6e) },
    },
    vHead: /* glsl */`
      attribute vec4 iA; attribute vec4 iB; attribute vec4 iC;
      uniform sampler2D uHMap; uniform sampler2D uCMap; uniform float uHAmp;
      uniform vec3 uTOl, uTBr, uTBl, uTPer, uTPup, uTCre;
      varying vec3 vSCol; varying float vAcross; varying vec3 vSideV; varying vec3 vFaceV; varying float vSAlpha; varying vec3 vSurfV; varying float vSurfMix; varying vec2 vRope;
      vec3 irStrandP(float t, bool full, out vec2 uvO) {
        float th0 = iA.x + iB.x * t;
        float pp = irPth(th0, uPupil);
        float sMin = 2.1 * irRuffRho(pp) / (IR_R1 - pp);
        float s = mix(max(iA.y, sMin), max(iA.z, sMin + 0.02), t);
        float r = irRad(s, pp);
        float lat = iB.y * sin(IR_TAU * iB.z * t + iB.w) * (0.35 + 0.65 * sin(3.14159265 * t));
        float th = th0 + lat / r;
        uvO = vec2(th / IR_TAU, s);
        float rel = max((textureLod(uHMap, uvO, ${HMIP}).r - 0.5) * uHAmp, -0.022);
        float ends = smoothstep(0.0, 0.14, t) * smoothstep(1.0, 0.86, t);
        float z = irFrontD(th, s, pp) + rel + (iC.x + iC.y * 4.0 * t * (1.0 - t)) * ends - 0.008 * (1.0 - ends);
        if (full && s > 0.52) z += irFurrowFull(th, s, uPupil);
        return irPolar(th, r, z);
      }`,
    vNormal: /* glsl */`
      float irT = uv.x;
      vec2 irUv0, irUvD;
      vec3 irP = irStrandP(irT, true, irUv0);
      vec3 irTan = normalize(irStrandP(min(irT + 0.03, 1.0), false, irUvD) - irStrandP(max(irT - 0.03, 0.0), false, irUvD));
      float irS0 = irUv0.y, irTh0 = irUv0.x * IR_TAU, irPp0 = irPth(irTh0, uPupil);
      float irK = (irFrontD(irTh0, irS0 + 0.004, irPp0) - irFrontD(irTh0, irS0 - 0.004, irPp0)) / (0.008 * (IR_R1 - irPp0));
      vec3 irN = normalize(vec3(-irK * cos(irTh0), -irK * sin(irTh0), 1.0));
      vec3 irBase = textureLod(uCMap, irUv0, 2.0).rgb;
      float irKind = iC.w, irV = iC.z;
      // hue family per bundle: olive / grey-brown / grey-blue, cooler towards the root
      vec3 irTint = irV < 0.4 ? uTOl : irV < 0.72 ? uTBr : uTBl;
      irTint = mix(irTint, uTPer, 0.6 * smoothstep(0.8, 0.96, irS0));
      vec3 irC;
      if (irKind < 0.5) irC = mix(irBase, uTPup, 0.3);
      else if (irKind < 1.5) irC = mix(irBase, irTint, 0.16);
      else if (irKind < 2.5) irC = irBase * 1.3 + vec3(0.01, 0.006, 0.003);
      else if (irKind < 3.5) irC = mix(irBase, uTCre, 0.22);
      else irC = mix(irBase, irTint, 0.22);
      if (irKind > 0.5) irC = mix(vec3(dot(irC, vec3(0.3, 0.55, 0.15))), irC, 0.92);
      float irRnd = fract(sin(iA.x * 91.7 + iB.w * 13.1) * 43758.5453);
      float irB = irRnd < 0.25 ? 0.62 + 0.3 * irRnd : 0.8 + 0.24 * irRnd;      // a quarter of the strands sit in shadow
      irB *= mix(0.55, 1.0, smoothstep(0.0, 0.2, irT) * smoothstep(1.0, 0.8, irT));   // ends dip into the stroma
      vSCol = irC * irB;
      vSurfMix = mix(0.45, 0.18, smoothstep(0.018, 0.05, iA.w));
      vRope = vec2(irT * (iA.z - iA.y) * 4.1 / max(iA.w, 0.005), iB.w);   // length in widths, phase
      vSurfV = normalize(normalMatrix * irN);`,
    vProject: /* glsl */`
      vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
      vec3 irTv = normalize((modelViewMatrix * vec4(irTan, 0.0)).xyz);
      vec3 irToCam = normalize(-mvPosition.xyz);
      vec3 irSideV = cross(irTv, irToCam);
      float irSL = length(irSideV);
      irSideV = irSL > 1e-4 ? irSideV / irSL : vec3(1.0, 0.0, 0.0);
      float irW = iA.w * (0.3 + 0.7 * sin(3.14159265 * irT));
      float irPix = -mvPosition.z * 2.0 / (projectionMatrix[1][1] * uViewH);
      // LOD: strands thinner than ~1/3 px fade out and collapse (the painted maps carry the same fibres)
      float irLod = smoothstep(0.22, 0.55, irW / irPix);
      float irWE = max(irW, irPix * 1.25) * step(0.001, irLod);
      vSAlpha = irLod * irW / max(irWE, 1e-6);
      mvPosition.xyz += irSideV * (0.5 * irWE * uv.y);
      #ifdef USE_ALPHAHASH
      vPosition = mvPosition.xyz * 40.0;
      #endif
      gl_Position = projectionMatrix * mvPosition;
      vAcross = uv.y; vSideV = irSideV;
      vFaceV = normalize(cross(irSideV, irTv));
      if (dot(vFaceV, irToCam) < 0.0) vFaceV = -vFaceV;`,
    fHead: /* glsl */`
      varying vec3 vSCol; varying float vAcross; varying vec3 vSideV; varying vec3 vFaceV; varying float vSAlpha; varying vec3 vSurfV; varying float vSurfMix; varying vec2 vRope;`,
    fColor: /* glsl */`
      {
        // twisted fibre bundle: helical striation across the ribbon, darker (occluded) flanks, and contact
        // darkening on the flank that lies against the stroma
        float a = clamp(vAcross, -1.0, 1.0);
        float tw = 0.5 + 0.5 * sin(a * 7.5 + vRope.x * 1.6 + vRope.y);
        float aa = 1.0 - smoothstep(0.6, 1.6, fwidth(a * 7.5 + vRope.x * 1.6));
        float low = clamp(-a * dot(vSideV, vSurfV) * 1.8, 0.0, 1.0);
        diffuseColor.rgb = vSCol * (0.8 + 0.2 * sqrt(max(1.0 - a * a, 0.0))) * mix(1.0, 0.84 + 0.24 * tw, aa) * (1.0 - 0.38 * low);
      }
      diffuseColor.a *= clamp(vSAlpha, 0.0, 1.0) * (1.0 - smoothstep(0.25, 1.0, abs(vAcross)));`,
    fNormal: /* glsl */`
      {
        float a = clamp(vAcross, -1.0, 1.0);
        vec3 nc = normalize(vFaceV * sqrt(max(1.0 - a * a, 0.0)) + vSideV * a);
        normal = normalize(mix(nc, vSurfV, vSurfMix));
      }`,
    fEmissive: /* glsl */`
      totalEmissiveRadiance += diffuseColor.rgb * 0.06;`,
  });
  const mesh = new THREE.Mesh(base, mat);
  mesh.name = 'iris-trabeculae';
  mesh.renderOrder = -1;
  // Edge falloff and LOD fade rely on alpha-to-coverage with a multisampled target (the production composer has 4x
  // MSAA). Rendering without MSAA falls back to hashed alpha, so the strands never turn into hard opaque ribbons.
  let msCache = null;
  mesh.onBeforeRender = (renderer) => {
    SHARED.uViewH.value = renderer.getDrawingBufferSize(_v2).y || 1080;
    const rt = renderer.getRenderTarget();
    let ms;
    if (rt) ms = rt.samples > 0;
    else { if (msCache === null) msCache = !!renderer.getContext().getContextAttributes()?.antialias; ms = msCache; }
    if (ms !== mat.alphaToCoverage) { mat.alphaToCoverage = ms; mat.alphaHash = !ms; mat.needsUpdate = true; }
  };
  return { mesh, mats: [mat], count, tris: count * seg * 2 };
}
const _v2 = new THREE.Vector2();

// Soft contact shadow painted into the albedo along the paths of the rope and bundled trabeculae (they sit in the
// stroma, not on it). Paths use the resting pupil, like the maps themselves.
function paintContactShadows(colorTex, A, B, Cc, pxX) {
  const cv = colorTex.image, g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#140c06';
  const n = 10, pts = [];
  for (let i = 0; i < A.length / 4; i++) {
    const kind = Cc[i * 4 + 3], w = A[i * 4 + 3];
    if (!(kind > 3.5 || (kind > 0.5 && kind < 1.5 && w > 0.016))) continue;
    const th0 = A[i * 4], s0 = A[i * 4 + 1], s1 = A[i * 4 + 2], drift = B[i * 4], amp = B[i * 4 + 1], cyc = B[i * 4 + 2], ph = B[i * 4 + 3];
    pts.length = 0;
    let xmin = Infinity, xmax = -Infinity;
    for (let k = 0; k <= n; k++) {
      const t = k / n, s = s0 + (s1 - s0) * t;
      const lat = amp * Math.sin(TAU * cyc * t + ph) * (0.35 + 0.65 * Math.sin(Math.PI * t));
      const x = ((th0 + drift * t + lat / rad(s, P0)) / TAU) * W;
      pts.push([x, s * H]); xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
    }
    const wPx = Math.max(1.2, w * pxX(0.5 * (s0 + s1)));
    const strong = kind > 3.5 ? 1 : 0.55;
    const offs = [0]; if (xmin < 0) offs.push(W); if (xmax > W) offs.push(-W);
    for (const o of offs) for (const [wk, a] of [[3.2, 0.06], [1.9, 0.07]]) {
      g.globalAlpha = a * strong; g.lineWidth = wPx * wk;
      g.beginPath(); g.moveTo(pts[0][0] + o, pts[0][1]);
      for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0] + o, pts[k][1]);
      g.stroke();
    }
  }
  g.restore();
  colorTex.needsUpdate = true;
}

// ------------------------------------------------------------------------------------------------ pigment layer
// Sections: 0 = pupillary ruff (frill) curling from the anterior surface around the margin to the back,
//           1 = posterior pigment epithelium with radial structural folds, 2 = root skirt at the ciliary insertion.
export function buildPigment({ quality }) {
  const lo = quality === 'low';
  const secs = [
    { g: gridGeometry(lo ? 512 : 768, 12, { flip: true, attr: { name: 'aSec', value: 0 } }) },
    { g: gridGeometry(lo ? 256 : 320, lo ? 20 : 28, { flip: true, attr: { name: 'aSec', value: 1 } }) },
    { g: gridGeometry(lo ? 256 : 320, 2, { flip: false, attr: { name: 'aSec', value: 2 } }) },
  ];
  const geo = irisBounds(mergeGrids(secs.map(s => s.g)));
  const mat = patchedMaterial({
    name: 'pigment',
    params: { color: 0xffffff, roughness: 0.62, metalness: 0.0 },
    uniforms: {
      uDark: { value: new THREE.Color(0x0b0503) }, uRuffDk: { value: new THREE.Color(0x22100a) }, uRuff: { value: new THREE.Color(0x4a2410) },
      uFold: { value: new THREE.Color(0x24120a) }, uRoot: { value: new THREE.Color(0x3a1a12) },
    },
    vHead: /* glsl */`
      attribute float aSec;
      varying float vPSec; varying vec2 vPUv; varying float vPBead; varying float vPFold;
      // pigment villi of the pupillary frill: rounded beads of irregular size and spacing (warped cells)
      float irBead(float th) {
        vec2 c = vec2(cos(th), sin(th));
        float x = th * (60.0 / IR_TAU) + 4.5 * vnoise(vec3(c * 2.5, 0.3)) + 2.2 * vnoise(vec3(c * 8.0, 1.1)) + 0.9 * vnoise(vec3(c * 25.0, 2.7));
        float f = fract(x);
        vec3 hs = _h3(vec3(mod(floor(x), 60.0), 3.7, 1.3));
        float w = 0.5 + 0.5 * hs.x;
        float u = clamp((f - 0.5 - (hs.y - 0.5) * (1.0 - w)) / (0.5 * w), -1.0, 1.0);
        float bump = 0.5 + 0.5 * cos(3.14159265 * u);
        float amp = hs.z < 0.3 ? 0.12 + 0.2 * hs.x : 0.25 + 0.75 * hs.z * hs.z;       // some villi are flat: breaks the periodicity
        return 0.3 + 0.7 * bump * amp + 0.3 * (vnoise(vec3(c * 5.0, 3.3)) - 0.5);
      }
      vec3 irPig(float sec, float th, float v, out float bead, out float fold) {
        float p = irPth(th, uPupil);
        bead = 0.0; fold = 0.0;
        if (sec < 0.5) {
          float rho = irRuffRho(p);
          float zTop = irFront(0.0, p), zBot = irBack(0.0, p);
          float zc = 0.5 * (zTop + zBot), rz = 0.5 * (zTop - zBot) + 0.012, rc = p + rho;
          bead = irBead(th);
          float crink = 0.006 * (vnoise(vec3(cos(th) * 20.0, sin(th) * 20.0, v * 2.0)) - 0.5);
          float lipTop = irFrontD(th, (rc - p) / (IR_R1 - p), p) + 0.01 + 0.01 * bead;
          vec2 q;
          if (v < 0.3) {
            // anterior lip: only ~0.02-0.06 mm beyond the curl at rest, a little more in miosis
            float u = v / 0.3;
            float reach = (0.016 + 0.024 * bead + 0.022 * vnoise(vec3(cos(th) * 9.0, sin(th) * 9.0, 5.0))) * (1.0 + 0.9 * max(-irDil(uPupil), 0.0));
            float r = mix(rc + reach, rc, u);
            float lift = mix(0.003, 0.01 + 0.01 * bead, smoothstep(0.0, 0.7, u));
            q = vec2(r, irFrontD(th, (r - p) / (IR_R1 - p), p) + lift);
          } else if (v < 0.8) {
            float u = (v - 0.3) / 0.5;
            float phi = 1.5707963 + u * 3.14159265;
            float bb = 0.007 * bead * sin(u * 3.14159265);
            q = vec2(rc + (rho + bb) * cos(phi) - 0.009 * bead * sin(u * 3.14159265), zc + (rz + bb) * sin(phi));
            q.y += (lipTop - (zc + rz)) * (1.0 - smoothstep(0.0, 0.4, u));
          } else {
            float u = (v - 0.8) / 0.2;
            float r = mix(rc, rc + 0.2, u);
            q = vec2(r, irBack((r - p) / (IR_R1 - p), p) - mix(0.012, 0.004, u));
          }
          return irPolar(th, q.x + crink, q.y);
        } else if (sec < 1.5) {
          float s = mix(0.035, 1.0, v);
          fold = irPpeFold(th, s);
          return irPolar(th, irRad(s, p), irBack(s, p) - 0.004 - fold);
        }
        float zf = irFront(1.0, p), zb = irBack(1.0, p);
        return irPolar(th, IR_R1 + 0.02 * sin(3.14159265 * v), mix(zf - 0.004, zb, v));
      }`,
    vNormal: /* glsl */`
      float irTh = uv.x * IR_TAU, irV = uv.y;
      float irB, irF, irB2, irF2;
      vec3 irP = irPig(aSec, irTh, irV, irB, irF);
      float irDu = 0.0015, irDv = 0.012;
      vec3 irPu = irPig(aSec, irTh + irDu, irV, irB2, irF2) - irPig(aSec, irTh - irDu, irV, irB2, irF2);
      vec3 irPv = irPig(aSec, irTh, min(irV + irDv, 1.0), irB2, irF2) - irPig(aSec, irTh, max(irV - irDv, 0.0), irB2, irF2);
      vec3 irN = normalize(aSec < 1.5 ? cross(irPu, irPv) : cross(irPv, irPu));
      vPSec = aSec; vPUv = vec2(irTh, irV); vPBead = irB; vPFold = irF;`,
    fHead: /* glsl */`
      uniform vec3 uDark, uRuffDk, uRuff, uFold, uRoot;
      varying float vPSec; varying vec2 vPUv; varying float vPBead; varying float vPFold;
      float irKnob;`,
    fColor: /* glsl */`
      {
        vec3 c = uDark;
        irKnob = 0.0;
        if (vPSec < 0.5) {
          // warm umber frill: lighter on the anterior lip and on the crests of the beads, black on the posterior side
          vec2 cs = vec2(cos(vPUv.x), sin(vPUv.x));
          // soft, irregular lumpiness only (no periodic crenellation term: it read as a tyre tread)
          float kn = vnoise(vec3(cs * 26.0, vPUv.y * 5.0));
          float kn2 = vnoise(vec3(cs * 9.0 + 3.1, vPUv.y * 2.5 + 1.7));
          irKnob = ((kn - 0.5) * 0.0035 + (kn2 - 0.5) * 0.007) * (1.0 - 0.5 * smoothstep(0.3, 0.7, vPUv.y));
          float front = 1.0 - smoothstep(0.25, 0.65, vPUv.y);
          c = mix(uRuffDk, uRuff, clamp(0.2 + 0.55 * front * (0.55 + 0.45 * kn) + 0.3 * clamp(vPBead, 0.0, 1.0) * front, 0.0, 1.0));
          c = mix(c, uDark, smoothstep(0.55, 0.85, vPUv.y));
        } else if (vPSec < 1.5) {
          c = mix(uDark, uFold, clamp(vPFold / 0.016, 0.0, 1.0));
        } else c = uRoot;
        diffuseColor.rgb = c;
      }`,
    fRough: /* glsl */`
      if (vPSec < 0.5) roughnessFactor = mix(0.46, 0.66, smoothstep(0.55, 0.85, vPUv.y)) + 0.1 * irKnob / 0.006;   // soft wet sheen on the frill`,
    fNormal: /* glsl */`
      if (vPSec < 0.5) normal = irBumpD(normal, -vViewPosition, irKnob);`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'iris-pigment-epithelium';
  return { mesh, mats: [mat] };
}

function mergeGrids(geos) {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), sec = new Float32Array(nv);
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3); uv.set(g.attributes.uv.array, vo * 2); sec.set(g.attributes.aSec.array, vo);
    const ia = g.index.array; for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo;
    vo += g.attributes.position.count; io += ia.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));   // see gridGeometry
  out.setAttribute('aSec', new THREE.BufferAttribute(sec, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
