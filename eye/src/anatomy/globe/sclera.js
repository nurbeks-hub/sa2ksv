// Sclera: a thick collagen shell open anteriorly at the limbus and posteriorly at the scleral canal,
// with the lamina cribrosa spanning the canal.
//
// Shell = four surfaces merged into one mesh (one draw call):
//   aSurf 0  outer (episcleral) surface, r = Rs, rising into a low peripapillary collar where the
//            dural sheath of the optic nerve fuses with the outer sclera;
//   aSurf 1  inner surface (lamina fusca) with the thickness profile 0.8 mm limbus -> 0.5 mm equator
//            and a small inward scleral-spur ridge at the corneoscleral junction;
//   aSurf 2  the limbal cut face, mating exactly with the bevelled corneal rim;
//   aSurf 3  the wall of the scleral canal: disc-sized (1.77 x 1.88 mm) at the inner surface,
//            flaring to the 3.2 mm nerve diameter at the outer surface, axis along the disc exit.
// Parametrisation: each surface is a (polar, azimuth) grid around +Z whose rings are rotated
// progressively (slerp) from the limbus towards the canal axis, so both openings are clean circles
// (no boolean cut, no UV seam, no pole).
import * as THREE from 'three';
import { Mesher, corneaRim, patchMaterial, baseUniforms, makeSetGhost, proxyMaterial, sph, smooth01, smoothstep, stepList,
  GLSL_INTERIOR, GLSL_GRADBUMP, LIGHTS_BEGIN_INTERIOR, trackViewToLocal } from './shared.js';
import { rng } from '../../lib/materials.js';
import { PART_BY_ID, smooth } from '../../parts.js';

export function buildSclera(ctx) {
  const { EYE, L, PALETTE, am } = ctx;
  const Rs = L.scleraOuterR, thL = am.LIMBUS_POLAR;
  const rim = corneaRim(EYE, L);
  const thP = Math.atan2(rim.rP, rim.zP), rPin = Math.hypot(rim.rP, rim.zP); // inner lip ring (Schwalbe's line level)
  const SEG = 192;

  // Canal axes: the outer opening follows the optic nerve exit (retinaMap at the scleral surface),
  // the inner opening sits under the optic disc (retinaMap at the retina) -> a slightly oblique canal.
  const Do = am.retinaMap(am.DISC_MAP.x, am.DISC_MAP.y, Rs).normalize();
  const Di = am.retinaMap(am.DISC_MAP.x, am.DISC_MAP.y, L.retinaInnerR).normalize();
  const negZ = new THREE.Vector3(0, 0, -1);
  const qo = new THREE.Quaternion().setFromUnitVectors(negZ, Do);
  const qi = new THREE.Quaternion().setFromUnitVectors(negZ, Di);
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
  const eho = X.clone().applyQuaternion(qo), evo = Y.clone().applyQuaternion(qo);
  const ehi = X.clone().applyQuaternion(qi), evi = Y.clone().applyQuaternion(qi);
  const collarH = 0.32;                       // peripapillary thickening -> ~0.9-1.0 mm canal depth
  const rTop = Rs + collarH;
  const canalRo = EYE.nerveDiameter / 2;     // 1.6 mm
  const aHi = EYE.discDiameter.h / 2, aVi = EYE.discDiameter.v / 2;
  const rInPost = L.scleraInnerR;            // shared landmark: choroid/retina sit inside it

  // Inner radius vs polar angle (from +Z): spur ridge at the lip, 0.8 mm behind the limbus, 0.5 from the
  // pars plana back (kept at L.scleraInnerR so the choroid/retina of the posterior module fit).
  const innerR = th => {
    if (th <= thP) return rPin;
    if (th < thP + 0.07) return rPin + (Rs - 0.8 - rPin) * smooth01((th - thP) / 0.07);
    return (Rs - 0.8) + (0.8 - (Rs - rInPost)) * smooth01((th - thP - 0.07) / (1.25 - thP - 0.07));
  };
  const outerR = dir => {
    const s = Math.acos(THREE.MathUtils.clamp(dir.dot(Do), -1, 1)) * Rs;
    return Rs + collarH * Math.pow(1 - smoothstep(1.7, 3.8, s), 1.4);
  };
  const rot = (v, q, w) => { const qq = new THREE.Quaternion().slerp(q, w); return v.applyQuaternion(qq); };
  const tmp = new THREE.Vector3();

  const m = new Mesher({ aSurf: 1, aThick: 1, aDepth: 1 });

  // ---- outer surface -------------------------------------------------------------------------
  const alphaO = Math.atan(canalRo / Math.sqrt(rTop * rTop - canalRo * canalRo));
  const thEndO = Math.PI - alphaO;
  const thO = stepList(thL, thEndO, th => {
    const sL = (th - thL) * Rs, sC = (thEndO - th) * Rs;
    let st = 0.46;
    if (sL < 1.0) st = 0.12; else if (sL < 3.0) st = 0.25;
    if (sC < 2.2) st = 0.1; else if (sC < 4.0) st = 0.22;
    return st / Rs;
  });
  const wO = th => smoothstep(thL + 0.3, Math.PI - 0.35, th);
  const outerRings = [], outerThick = [];
  for (const th of thO) {
    const ring = [], thick = [];
    for (let j = 0; j < SEG; j++) {
      const az = j / SEG * Math.PI * 2;
      const dir = rot(sph(th, az, 1, new THREE.Vector3()), qo, wO(th));
      if (th === thEndO) {
        const p = Do.clone().addScaledVector(eho, Math.cos(az) * Math.tan(alphaO)).addScaledVector(evo, Math.sin(az) * Math.tan(alphaO)).normalize().multiplyScalar(rTop);
        ring.push(p); thick.push(rTop - rInPost); continue;
      }
      const ro = outerR(dir);
      ring.push(dir.clone().multiplyScalar(ro));
      thick.push(ro - innerR(Math.acos(dir.z)));
    }
    outerRings.push(ring); outerThick.push(thick);
  }
  m.addGrid(outerRings, { aSurf: () => 0, aThick: (i, j) => outerThick[i][j], aDepth: () => 0 }, { expect: p => p.clone().normalize() });

  // ---- inner surface -------------------------------------------------------------------------
  const tanH = aHi / Math.sqrt(rInPost * rInPost - aHi * aHi), tanV = aVi / Math.sqrt(rInPost * rInPost - aVi * aVi);
  const holeDir = az => Di.clone().addScaledVector(ehi, Math.cos(az) * tanH).addScaledVector(evi, Math.sin(az) * tanV).normalize();
  const thEndMeanI = Math.PI - Math.atan((tanH + tanV) / 2);
  const thI = stepList(thP, thEndMeanI, th => {
    const sL = (th - thP) * Rs, sC = (thEndMeanI - th) * Rs;
    let st = 0.5;
    if (sL < 1.2) st = 0.12; else if (sL < 3.0) st = 0.28;
    if (sC < 1.5) st = 0.12; else if (sC < 3) st = 0.25;
    return st / Rs;
  });
  const frI = thI.map(t => (t - thP) / (thEndMeanI - thP));
  const wI = th => smoothstep(thP + 0.3, Math.PI - 0.35, th);
  const innerRings = [];
  for (let i = 0; i < frI.length; i++) {
    const ring = [];
    for (let j = 0; j < SEG; j++) {
      const az = j / SEG * Math.PI * 2;
      if (i === frI.length - 1) { ring.push(holeDir(az).multiplyScalar(rInPost)); continue; }
      const cx = Math.cos(az) * tanH, cy = Math.sin(az) * tanV;
      const thEnd = Math.PI - Math.atan(Math.hypot(cx, cy));
      const azEnd = Math.atan2(cy, cx);
      const th = thP + frI[i] * (thEnd - thP);
      const w = wI(th);
      let dAz = azEnd - az; dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
      const dir = rot(sph(th, az + dAz * w, 1, new THREE.Vector3()), qi, w);
      ring.push(dir.multiplyScalar(i === 0 ? rPin : innerR(Math.acos(dir.z))));
    }
    innerRings.push(ring);
  }
  m.addGrid(innerRings, {
    aSurf: () => 1, aDepth: () => 1,
    aThick: (i, j, p) => { const d = p.clone().normalize(); return outerR(d) - p.length(); },
  }, { expect: p => p.clone().normalize().negate() });

  // ---- limbal cut face (mates with the corneal rim bevel) --------------------------------------
  const NL = 7, lipRings = [];
  for (let i = 0; i <= NL; i++) {
    const t = i / NL, rho = rim.lR + (rim.rP - rim.lR) * t, z = rim.lZ + (rim.zP - rim.lZ) * t, ring = [];
    for (let j = 0; j < SEG; j++) { const az = j / SEG * Math.PI * 2; ring.push(new THREE.Vector3(Math.cos(az) * rho, Math.sin(az) * rho, z)); }
    lipRings.push(ring);
  }
  m.addGrid(lipRings, { aSurf: () => 2, aDepth: i => i / NL, aThick: () => Rs - rPin }, {
    expect: p => new THREE.Vector3(-p.x, -p.y, 0).normalize(),
  });

  // ---- scleral canal wall --------------------------------------------------------------------
  const canalRing = (xi, az, out = new THREE.Vector3()) => {
    const k = Math.pow(smoothstep(0.28, 1.0, xi), 1.15);
    const R = rInPost + (rTop - rInPost) * xi;
    const ah = aHi + (canalRo - aHi) * k, av = aVi + (canalRo - aVi) * k;
    const th = ah / Math.sqrt(R * R - ah * ah), tv = av / Math.sqrt(R * R - av * av);
    const D = tmp.copy(Di).lerp(Do, xi).normalize();
    const eh = new THREE.Vector3().copy(ehi).lerp(eho, xi).normalize(), ev = new THREE.Vector3().copy(evi).lerp(evo, xi).normalize();
    return out.copy(D).addScaledVector(eh, Math.cos(az) * th).addScaledVector(ev, Math.sin(az) * tv).normalize().multiplyScalar(R);
  };
  const NC = 14, canalRings = [];
  for (let i = 0; i <= NC; i++) {
    const xi = i / NC, ring = [];
    for (let j = 0; j < SEG; j++) {
      const az = j / SEG * Math.PI * 2;
      if (i === 0) ring.push(holeDir(az).multiplyScalar(rInPost));
      else if (i === NC) ring.push(Do.clone().addScaledVector(eho, Math.cos(az) * Math.tan(alphaO)).addScaledVector(evo, Math.sin(az) * Math.tan(alphaO)).normalize().multiplyScalar(rTop));
      else ring.push(canalRing(xi, az));
    }
    canalRings.push(ring);
  }
  m.addGrid(canalRings, { aSurf: () => 3, aDepth: i => 1 - i / NC, aThick: () => rTop - rInPost }, {
    expect: p => { const pd = p.dot(Do); return Do.clone().multiplyScalar(pd).sub(p).normalize(); },
  });

  const geo = m.build();

  // ---- emissary canals (scleral foramina) --------------------------------------------------------
  const R = rng(4242);
  const pits = [];
  const addPit = (dir, radius, axis = null, elong = 1) => pits.push({ dir: dir.clone().normalize(), radius, axis: axis || new THREE.Vector3(0, 0, 1), elong });
  // Vortex vein exits: oblique oval channels, long axis meridional.
  for (const v of am.VORTEX_EXITS) {
    const n = v.clone().normalize();
    const mer = sph(Math.acos(n.z) + 0.02, Math.atan2(n.y, n.x), 1).sub(n).normalize();
    addPit(n, 0.42, mer, 2.1);
  }
  // Short posterior ciliary arteries & nerves: a ring of small foramina around the canal.
  const ehO = eho, evO = evo;
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2 + R.range(-0.18, 0.18);
    const s = R.range(2.9, 4.6) / Rs;
    const dir = Do.clone().multiplyScalar(Math.cos(s)).addScaledVector(ehO, Math.cos(a) * Math.sin(s)).addScaledVector(evO, Math.sin(a) * Math.sin(s));
    addPit(dir, R.range(0.1, 0.17));
  }
  // Long posterior ciliary arteries/nerves: horizontal meridian, nasal and temporal of the nerve.
  for (const side of [1, -1]) {
    const s = (side > 0 ? 4.2 : 5.0) / Rs;
    const dir = Do.clone().multiplyScalar(Math.cos(s)).addScaledVector(ehO, side * Math.sin(s));
    addPit(dir, 0.2, ehO.clone(), 1.8);
  }
  // Anterior ciliary arteries: pierce the sclera ~3-4 mm behind the limbus, in line with the recti.
  for (const [name, count] of [['medial', 2], ['inferior', 2], ['superior', 2], ['lateral', 1]]) {
    const ins = am.rectusInsertion(name);
    for (let c = 0; c < count; c++) {
      const off = count === 1 ? 0 : (c ? 1 : -1) * 0.22;
      addPit(am.behindLimbus(R.range(3.0, 4.0), ins.azimuth + off), 0.09);
    }
  }
  const NPITS = pits.length;
  const NPOST = 4 + 16 + 2; // vortex, short + long posterior ciliary (anterior ciliary follow)
  const uPits = pits.map(p => new THREE.Vector4(p.dir.x, p.dir.y, p.dir.z, p.radius));
  const uPitsB = pits.map(p => new THREE.Vector4(p.axis.x, p.axis.y, p.axis.z, p.elong));

  // ---- material ------------------------------------------------------------------------------
  const ivory = new THREE.Color(PALETTE.sclera);
  const uniforms = baseUniforms({
    uViewToLocal: { value: new THREE.Matrix3() },
    uCanalAxis: { value: Do.clone() },
    uOpenCos: { value: Math.cos(thL) },
    uIvory: { value: new THREE.Vector3(ivory.r, ivory.g, ivory.b).multiplyScalar(0.84) }, // keep the white in the tonal range where texture reads
    uLimbPolar: { value: thL },
    uCorneaOff: { value: 0 },
    uCheap: { value: 0 },
    uPits: { value: uPits }, uPitsB: { value: uPitsB },
  });
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.5,
    ior: 1.41, specularIntensity: 0.62,
    envMapIntensity: 0.6,
  });
  patchMaterial(mat, 'sclera', {
    uniforms,
    vertPars: 'attribute float aSurf; attribute float aThick; attribute float aDepth; varying float vSurf; varying float vThick; varying float vDepth;',
    vertMain: 'vSurf = aSurf; vThick = aThick; vDepth = aDepth;',
    fragPars: GLSL_INTERIOR + GLSL_GRADBUMP + /* glsl */`
      #define NPITS ${NPITS}
      #define PIT_V 4
      #define PIT_P ${NPOST}
      uniform vec3 uIvory; uniform float uLimbPolar; uniform float uCorneaOff; uniform float uCheap;
      uniform vec4 uPits[NPITS]; uniform vec4 uPitsB[NPITS];
      varying float vSurf; varying float vThick; varying float vDepth;
      float gH = 0.0; float gRough = 0.5; vec3 gUndG = vec3(0.0);
      const vec3 G_SSS = vec3(1.0, 0.58, 0.44);
      void gPit(int i, vec3 n, inout float h, inout float dark) {
        vec4 a = uPits[i]; vec4 b = uPitsB[i];
        vec3 d = (n - a.xyz) * 12.0;
        if (dot(d, d) > 1.6) return;
        float along = dot(d, b.xyz);
        vec3 perp = d - b.xyz * along - a.xyz * dot(d, a.xyz);
        float e = sqrt(along * along / (b.w * b.w) + dot(perp, perp));
        float rr = a.w;
        float core = 1.0 - smoothstep(rr * 0.25, rr, e);
        float lip = smoothstep(rr * 0.75, rr * 1.2, e) * (1.0 - smoothstep(rr * 1.2, rr * 2.6, e));
        h += -core * 0.035 + lip * 0.006;
        dark = max(dark, core);
      }
      // Scleral foramina, tested only in their own region (vortex ring / peripapillary / anterior).
      float gPits(vec3 n, float sL, float cd, out float dark) {
        float h = 0.0; dark = 0.0;
        if (sL > 11.0 && sL < 21.0) for (int i = 0; i < PIT_V; i++) gPit(i, n, h, dark);
        if (cd < 6.5) for (int i = PIT_V; i < PIT_P; i++) gPit(i, n, h, dark);
        if (sL < 5.5) for (int i = PIT_P; i < NPITS; i++) gPit(i, n, h, dark);
        return h;
      }
      float gRidge(float v) { v = 1.0 - abs(2.0 * v - 1.0); return v * v * v; }
      // Collagen striation field (fine lamellae + coarser bundles): circumferential at the limbus
      // and around the canal, meridional in between, interwoven near the posterior pole.
      void gFibers(vec3 P, vec3 n, float polar, float sL, float cd, vec4 B, out float fine, out float bund) {
        vec2 az = n.xy / max(length(n.xy), 1e-4);
        float wL = 1.0 - smoothstep(2.5, 7.5, sL);
        float wC = 1.0 - smoothstep(3.2, 6.5, cd);
        float wP = smoothstep(2.3, 2.75, polar) * (1.0 - wC);
        float wM = max(0.0, 1.0 - wL - wC - wP);
        fine = 0.0; bund = 0.0;
        if (wL > 0.001) {
          float wp = polar + (B.z - 0.5) * 0.012;
          vec4 f = tn(vec3(az * 9.0, wp * 200.0)); vec4 g = tn(vec3(az * 6.0 + 3.0, wp * 48.0 + 3.1));
          fine += wL * gRidge(f.x); bund += wL * g.y;
        }
        if (wM > 0.001) {
          vec4 f = tn(vec3(az * 175.0, polar * 14.0)); vec4 g = tn(vec3(az * 38.0, polar * 9.0 + 7.0 + B.w * 1.7));
          fine += wM * gRidge(f.y); bund += wM * g.x;
        }
        if (wC > 0.001) {
          vec3 t1 = normalize(cross(uCanalAxis, vec3(0.0, 1.0, 0.0))); vec3 t2 = cross(uCanalAxis, t1);
          vec2 a2 = normalize(vec2(dot(n, t1), dot(n, t2)) + 1e-5);
          float cw = cd + (B.w - 0.5) * 0.22 + (B.x - 0.5) * 0.12; // near-concentric ring fibres (big warps drew contour lines)
          vec4 f = tn(vec3(a2 * 12.0, cw * 16.0 + (B.z - 0.5) * 0.6)); vec4 g = tn(vec3(a2 * 6.0 + 5.0, cw * 4.2 + 5.0));
          fine += wC * mix(gRidge(f.z), f.x, 0.5) * 0.8; bund += wC * g.z;
        }
        if (wP > 0.001) {
          // Interwoven posterior collagen: three sets of short, stretched fibre streaks (anisotropic noise
          // in the pole's tangent plane) at 0/60/120 deg, their mix drifting with low-frequency noise so the
          // dominant direction rotates slowly across the pole. No isolines of isotropic noise.
          vec2 uv = P.xy + (B.zw - 0.5) * 0.9;
          vec2 q0 = uv;
          vec2 q1 = vec2(0.5 * uv.x + 0.866 * uv.y, -0.866 * uv.x + 0.5 * uv.y);
          vec2 q2 = vec2(-0.5 * uv.x + 0.866 * uv.y, -0.866 * uv.x - 0.5 * uv.y);
          float r0 = gRidge(tn(vec3(q0.x * 1.5, q0.y * 13.0, 2.3)).w);
          float r1 = gRidge(tn(vec3(q1.x * 1.5, q1.y * 13.0, 7.9)).z);
          float r2 = gRidge(tn(vec3(q2.x * 1.5, q2.y * 13.0, 4.1)).y);
          vec3 wd = max(tn(P * 0.35 + 19.0).xyz - 0.25, 0.02); wd = wd * wd; wd /= (wd.x + wd.y + wd.z);
          float fw = r0 * wd.x + r1 * wd.y + r2 * wd.z;
          vec4 g = tn(vec3(q1.x * 0.45, q1.y * 3.2, 5.1));
          fine += wP * fw * 0.9; bund += wP * g.w;
        }
      }`,
    frag: [
      ['#include <color_fragment>', /* glsl */`#include <color_fragment>
      {
        vec3 P = vLocal; float r = length(P); vec3 n = P / r;
        float polar = acos(clamp(n.z, -1.0, 1.0));
        float sL = (polar - uLimbPolar) * 12.0;
        float cd = acos(clamp(dot(n, uCanalAxis), -1.0, 1.0)) * 12.0;
        float fp = max(length(fwidth(P)), 1e-4);
        float fadeF = 1.0 - smoothstep(0.012, 0.03, fp);
        float fadeB = 1.0 - smoothstep(0.05, 0.12, fp);
        vec4 A = tn(P * 0.5 + 11.0);        // x mottle, y translucent patches, z patchiness, w undulation
        vec4 B = tn(P * 1.45 + 7.3);        // x mottle detail, y undulation detail, z/w warps
        vec3 ivory = uIvory;
        vec3 slate = vec3(0.36, 0.42, 0.52);
        vec3 fusca = vec3(0.20, 0.115, 0.07);
        vec3 col;
        if (vSurf < 0.5) {
          // --- outer surface ---
          float fine = 0.0, bund = 0.5;
          float pd = 0.0, ph = 0.0;
          if (uCheap < 0.5) {
            if (fadeB > 0.0) gFibers(P, n, polar, sL, cd, B, fine, bund);
            ph = gPits(n, sL, cd, pd);
          }
          float mott = A.x * 0.66 + B.x * 0.34;
          float patchy = smoothstep(0.3, 0.75, A.z);
          col = ivory * (0.86 + 0.26 * mott);
          col *= mix(vec3(1.0), vec3(1.03, 1.0, 0.92), smoothstep(1.2, 2.6, polar));       // posterior: warmer, older collagen
          float limb = 1.0 - smoothstep(-0.05, 1.25, sL + (B.z - 0.5) * 0.35);
          col = mix(col, vec3(0.2, 0.25, 0.33), 0.78 * limb * limb);                          // translucent limbal zone (uvea shows through)
          col = mix(col, col * vec3(1.05, 0.9, 0.88), 0.4 * smoothstep(0.5, 1.6, sL) * (1.0 - smoothstep(3.0, 6.5, sL))); // episcleral flush
          col = mix(col, slate * 1.3, 0.28 * smoothstep(1.4, 3.0, sL) * (1.0 - smoothstep(6.5, 9.0, sL))); // uvea (ciliary body) shows through
          col = mix(col, slate * 1.25, 0.28 * smoothstep(0.62, 0.5, vThick));               // thin equatorial sclera -> bluish
          col = mix(col, slate * 1.35, 0.2 * smoothstep(0.55, 0.75, A.y));                  // uneven collagen packing
          col *= mix(vec3(1.0), vec3(1.03, 1.0, 0.95), smoothstep(0.5, 0.25, A.y));
          col *= 1.0 - (0.04 + 0.08 * patchy) * (bund - 0.5) * fadeB + (0.03 + 0.06 * patchy) * (fine - 0.2) * fadeF;
          col = mix(col, vec3(0.34, 0.2, 0.17), pd * 0.62);
          col *= 1.0 - 0.5 * uVessels;
          gH = fine * (0.0015 + 0.003 * patchy) * fadeF + (bund - 0.5) * (0.003 + 0.006 * patchy) * fadeB + ph;
          // broad undulation: exact analytic slope (screen derivatives would quantise the wet highlight per 2x2 quad)
          if (uCheap < 0.5) {
            vec4 ua, uax, uay, uaz, ub, ubx, uby, ubz;
            tnG4(P * 0.5 + 11.0, ua, uax, uay, uaz); tnG4(P * 1.45 + 7.3, ub, ubx, uby, ubz);
            gUndG = gGrad(uax, uay, uaz, vec4(0.0, 0.0, 0.0, 0.62 * 0.5 * 0.03)) + gGrad(ubx, uby, ubz, vec4(0.0, 0.38 * 1.45 * 0.03, 0.0, 0.0));
          }
          gRough = mix(0.52, 0.7, smoothstep(1.2, 2.3, polar)) + (bund - 0.5) * 0.1 * fadeB - 0.05 * fine * fadeF;
          gSSS = 1.0 - 0.7 * limb; gInterior = 0.0; gAmb = 1.0;
        } else if (vSurf < 1.5) {
          // --- inner surface: lamina fusca (melanocytes, grooves of the long ciliary nerves) ---
          vec4 C = tn(P * 3.2 + A.xyz * 1.6 + 1.0);
          float pig = A.x * 0.5 + B.x * 0.3 + C.y * 0.2;
          col = fusca * (0.65 + 0.7 * pig);
          col *= 1.0 - 0.35 * smoothstep(0.55, 0.85, C.x);
          float hz = abs(n.y) * 12.0;
          float groove = exp(-hz * hz / 0.05) * smoothstep(1.0, 1.35, polar) * (1.0 - smoothstep(2.6, 2.9, polar));
          col *= 1.0 - 0.45 * groove;
          float streak = tn(vec3(n.xy / max(length(n.xy), 1e-4) * 90.0, polar * 4.0)).z;
          col *= 0.92 + 0.16 * streak * fadeB;
          float nearLip = 1.0 - smoothstep(0.9, 2.6, sL);
          col = mix(col, ivory * vec3(0.86, 0.8, 0.74), nearLip);                           // scleral spur / trabecular zone
          col *= 1.0 - 0.4 * uVessels;
          gH = -groove * 0.02 + (pig - 0.5) * 0.01 + (streak - 0.5) * 0.004 * fadeB;
          gRough = 0.52;
          gSSS = 0.0; gInterior = 1.0; gAmb = mix(0.28, 0.6, nearLip);
        } else {
          // --- cut faces: limbal lip (2) and canal wall (3) ---
          float d = vDepth;
          vec3 cut = vec3(0.82, 0.73, 0.66);
          vec4 C = tn(P * 3.0 + 2.0);
          float lam = 0.5 + 0.5 * sin(d * 34.0 + C.x * 7.0);
          lam = mix(0.5, lam, 0.6);
          float speck = fadeF > 0.0 ? tn(P * 64.0).y : 0.5;
          col = cut * (0.9 + 0.12 * lam) * (0.93 + 0.1 * speck * fadeF);
          col = mix(col, cut * vec3(1.02, 0.88, 0.86), 1.0 - smoothstep(0.0, 0.1, d));      // episclera
          col = mix(col, fusca * 1.6, smoothstep(0.86, 0.97, d));                          // lamina fusca
          // In situ the limbal face is the corneoscleral junction seen through the corneal periphery:
          // a dim, grey-blue translucent zone. It becomes a cut collagen face once the cornea is lifted off.
          if (vSurf < 2.5) col = mix(vec3(0.24, 0.28, 0.34), col, uCorneaOff);
          col *= 1.0 - 0.4 * uVessels;
          gH = (lam - 0.5) * 0.003 + (speck - 0.5) * 0.0015 * fadeF;
          gRough = 0.58;
          gSSS = 0.6;
          gInterior = vSurf > 2.5 ? 1.0 : 0.0;
          gAmb = vSurf > 2.5 ? 0.75 : mix(0.7, 1.0, uCorneaOff);
        }
        diffuseColor.rgb = col;
      }`],
      ['#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(gRough, 0.05, 1.0);`],
      ['#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (uCheap < 0.5) { normal = gBump(-vViewPosition, normal, gH, faceDirection); normal = gGradBump(normal, gUndG * faceDirection); }`],
      ['#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float nvh = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
          totalEmissiveRadiance += G_LIME * uHighlight * (0.02 + 0.45 * nvh * nvh * nvh);
        }`],
      ['#include <lights_fragment_begin>', LIGHTS_BEGIN_INTERIOR],
      ['#include <lights_fragment_end>', `
        irradiance *= gAmb; iblIrradiance *= gAmb; radiance *= gAmb;
        #include <lights_fragment_end>
        reflectedLight.directDiffuse += gWrapAcc * BRDF_Lambert( material.diffuseContribution ) * G_SSS * gSSS * 0.55;
        {
          float nvS = clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0);
          reflectedLight.indirectDiffuse += (1.0 - gInterior) * pow(1.0 - nvS, 4.0) * vec3(0.10, 0.095, 0.09) * (1.0 - 0.5 * uVessels);
        }`],
    ],
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sclera';
  trackViewToLocal(mesh, uniforms.uViewToLocal, uniforms.uCheap);
  mesh.renderOrder = -2;

  // ---- lamina cribrosa ----------------------------------------------------------------------
  const lamina = buildLamina({ canalRing, Di, Do, ehi, evi, eho, evo, rInPost, rTop, aHi, aVi, canalRo, uniformsBase: uniforms });

  // ---- pick proxy ---------------------------------------------------------------------------
  const proxyGeo = new THREE.SphereGeometry(Rs, 40, 26, 0, Math.PI * 2, thL, Math.PI - thL);
  proxyGeo.rotateX(Math.PI / 2);
  const proxy = new THREE.Mesh(proxyGeo, proxyMaterial());
  proxy.name = 'sclera-pick';

  const corneaWin = PART_BY_ID['cornea']?.window || [0, 1];
  const object = new THREE.Group(); object.name = 'part:sclera';
  object.add(mesh, lamina.mesh, proxy);

  return {
    id: 'sclera',
    object,
    pickables: [proxy],
    anchor: am.fromAnterior(THREE.MathUtils.degToRad(78), THREE.MathUtils.degToRad(152), Rs),
    focus: { center: new THREE.Vector3(0, 0, -0.5), radius: 14.2 },
    setGhost: makeSetGhost(object, [uniforms, lamina.uniforms]),
    update(frame) {
      for (const u of [uniforms, lamina.uniforms]) { u.uTime.value = frame.time; u.uVessels.value = frame.vessels || 0; }
      uniforms.uCorneaOff.value = smooth((frame.explode - corneaWin[0]) / Math.max(1e-6, corneaWin[1] - corneaWin[0]) * 4.0);
    },
    info: { canalAxisOuter: Do.toArray(), canalAxisInner: Di.toArray(), pits: NPITS },
  };
}

// Lamina cribrosa: four stacked, posteriorly bowed collagen plates spanning the inner part of the
// scleral canal, perforated by ~250 pores (larger at the superior and inferior poles, as in life)
// and a central channel for the central retinal vessels. Pores are real holes (alpha-to-coverage).
function buildLamina({ canalRing, Di, Do, ehi, evi, eho, evo, rInPost, rTop, aHi, aVi, canalRo, uniformsBase }) {
  const SEG = 96, NRING = 22;
  const m = new Mesher({ aPlate: 3 });
  const plates = [0.1, 0.19, 0.28, 0.37];
  const center = new THREE.Vector3();
  plates.forEach((xi, k) => {
    const rings = [], uv = [];
    const edge = []; for (let j = 0; j < SEG; j++) edge.push(canalRing(xi, j / SEG * Math.PI * 2, new THREE.Vector3()));
    const R = rInPost + (rTop - rInPost) * xi;
    const D = Di.clone().lerp(Do, xi).normalize();
    center.copy(D).multiplyScalar(R);
    const kk = Math.pow(smoothstep(0.28, 1.0, xi), 1.15);
    const ah = aHi + (canalRo - aHi) * kk, av = aVi + (canalRo - aVi) * kk;
    for (let i = 0; i <= NRING; i++) {
      const rho = 0.06 + 0.94 * Math.sqrt(i / NRING);
      const ring = [], ruv = [];
      for (let j = 0; j < SEG; j++) {
        const az = j / SEG * Math.PI * 2;
        const e = edge[j];
        const p = center.clone().lerp(e, rho);
        p.addScaledVector(D, 0.035 * (1 - rho * rho)); // bowed posteriorly
        ring.push(p); ruv.push([Math.cos(az) * ah * rho, Math.sin(az) * av * rho, k]);
      }
      rings.push(ring); uv.push(ruv);
    }
    m.addGrid(rings, { aPlate: (i, j) => uv[i][j] }, { expect: () => D.clone() });
  });
  const geo = m.build();
  const uniforms = baseUniforms({
    uViewToLocal: { value: new THREE.Matrix3() },
    uCanalAxis: uniformsBase.uCanalAxis, uOpenCos: uniformsBase.uOpenCos,
  });
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.55, side: THREE.DoubleSide,
    alphaTest: 0.5, alphaToCoverage: true,
    specularIntensity: 0.5,
  });
  patchMaterial(mat, 'lamina', {
    uniforms,
    vertPars: 'attribute vec3 aPlate; varying vec3 vPlate;',
    vertMain: 'vPlate = aPlate;',
    fragPars: GLSL_INTERIOR + /* glsl */`
      varying vec3 vPlate;
      float gH = 0.0;
      vec2 gHash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
      // Distance to the nearest Voronoi border (the collagen beams) + id of the cell (the pore).
      float gVoronoi(vec2 x, out vec2 cid) {
        vec2 n = floor(x), f = fract(x); float md = 8.0; vec2 mr = vec2(0.0); cid = n;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 g = vec2(float(i), float(j));
          vec2 r = g + gHash2(n + g) * 0.8 + 0.1 - f;
          float d = dot(r, r);
          if (d < md) { md = d; mr = r; cid = n + g; }
        }
        float be = 8.0;
        for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
          vec2 g = vec2(float(i), float(j));
          vec2 r = g + gHash2(floor(x) + g) * 0.8 + 0.1 - f;
          if (dot(mr - r, mr - r) > 1e-5) be = min(be, dot(0.5 * (mr + r), normalize(r - mr)));
        }
        return be;
      }`,
    frag: [
      ['#include <color_fragment>', /* glsl */`#include <color_fragment>
      {
        vec2 uv = vPlate.xy; float layer = vPlate.z;
        vec2 q = uv / 0.1 + vec2(layer * 0.05, -layer * 0.04);
        vec2 id; float border = gVoronoi(q, id);
        float vert = smoothstep(0.2, 0.85, abs(uv.y) / 0.94);
        float edge = length(uv / vec2(0.885, 0.94));
        // beam half-width (cell units): thinner beams (= larger pores) at the superior/inferior poles
        float bw = (0.2 - 0.07 * vert) * (0.8 + 0.5 * gHash2(id + 7.0).x) + 0.5 * smoothstep(0.78, 0.98, edge) + 0.04 * layer;
        float beam = bw - border;   // > 0: collagen beam, < 0: pore
        float aa = max(fwidth(beam), 1e-4);
        float poreVis = 1.0 - smoothstep(0.12, 0.3, length(fwidth(q)));
        float mask = mix(1.0, smoothstep(-aa, aa, beam), poreVis);
        float cv = length(uv - vec2(0.06, 0.0)) - 0.13;
        mask *= smoothstep(-0.008, 0.008, cv);
        diffuseColor.a *= mask;
        float ao = smoothstep(0.0, 0.12, beam) * smoothstep(0.0, 0.05, cv);
        diffuseColor.rgb = vec3(0.86, 0.82, 0.76) * mix(0.66, 0.45 + 0.55 * ao, poreVis) * (0.92 + 0.12 * tn(vLocal * 40.0).x);
        diffuseColor.rgb *= 1.0 - 0.4 * uVessels;
        gH = ao * 0.012;
        gInterior = 1.0; gAmb = 0.38; gSSS = 0.0;
      }`],
      ['#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = gBump(-vViewPosition, normal, gH, faceDirection);`],
      ['#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += G_LIME * uHighlight * 0.08;`],
      ['#include <lights_fragment_begin>', LIGHTS_BEGIN_INTERIOR],
      ['#include <lights_fragment_end>', `
        irradiance *= gAmb; iblIrradiance *= gAmb; radiance *= gAmb;
        #include <lights_fragment_end>`],
    ],
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'lamina-cribrosa';
  trackViewToLocal(mesh, uniforms.uViewToLocal);
  return { mesh, uniforms };
}
