// Bulbar conjunctiva: a thin, wet, transparent membrane from the limbus back towards the fornix.
// Profile (per azimuth, in globe-polar coordinates): its inner face is a smooth max of the corneal
// and scleral surfaces (so it bridges the limbal sulcus like the real limbal epithelium), it tapers
// to nothing ~0.4 mm onto the cornea and ends posteriorly in a rounded, slightly out-curled free
// edge (the cut fornix reflection). Its stroma spans r = Rs+0.03 .. Rs+0.15, so the conjunctival
// vessels of the vasculature module (on Rs+0.08) sit inside it.
import * as THREE from 'three';
import { Mesher, corneaRim, patchMaterial, baseUniforms, makeSetGhost, proxyMaterial, sph, smoothstep, stepList, GLSL_GRADBUMP, trackViewToLocal } from './shared.js';
import { PART_BY_ID, smooth } from '../../parts.js';

export function buildConjunctiva(ctx, env) {
  const { EYE, L, am } = ctx;
  const Rs = L.scleraOuterR, thL = am.LIMBUS_POLAR;
  const rim = corneaRim(EYE, L);
  const SEG = 192;

  // Distance from the globe centre to the anterior corneal sphere along polar direction th.
  const rCornea = th => { const c = Math.cos(th), s = Math.sin(th); return rim.cZ * c + Math.sqrt(rim.Ra * rim.Ra - rim.cZ * rim.cZ * s * s); };
  const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
  const rhoTip = rim.lR - 0.42;
  const thTip = Math.atan2(rhoTip, rim.zAnt(rhoTip));
  const GAP = 0.03, T = 0.12;
  // Posterior extent along the surface from the limbus: ~12 mm, a little shorter nasally
  // (plica/caruncle side) and longer temporally, as the fornices are.
  const lenAt = az => 12.0 - 1.1 * Math.cos(az) + 0.25 * Math.sin(3 * az + 1.3);
  const thickAt = (th, thEnd) => {
    const a = smoothstep(thTip, thL - 0.004, th);              // taper onto the cornea
    const limb = Math.exp(-Math.pow((th - thL) * Rs / 0.55, 2)) * 0.05; // limbal thickening
    return T * Math.pow(a, 0.7) + limb * a;
  };
  const innerR = th => smax(rCornea(th), Rs, 0.16) + GAP;
  const lift = (th, thEnd) => { const e = smoothstep(thEnd - 0.075, thEnd, th); return 0.08 * e * e; };

  // Normalised profile positions (0 tip .. 1 edge), denser at the limbus and at the free edge.
  const thEndMean = thL + 12.0 / Rs;
  const thList = stepList(thTip, thEndMean, th => {
    const sL = (th - thL) * Rs;
    let step = 0.34;
    if (sL < 1.2) step = 0.1; else if (sL < 3.0) step = 0.2;
    if ((thEndMean - th) * Rs < 1.2) step = 0.12;
    return step / Rs;
  });
  const fr = thList.map(t => (t - thTip) / (thEndMean - thTip));

  const m = new Mesher({ aS: 1, aSide: 1 });
  const outer = [], inner = [];
  for (let i = 0; i < fr.length; i++) { outer.push([]); inner.push([]); }
  const EDGE = 7, cap = []; for (let k = 0; k <= EDGE; k++) cap.push([]);
  const d = new THREE.Vector3(), tang = new THREE.Vector3();
  for (let j = 0; j < SEG; j++) {
    const az = j / SEG * Math.PI * 2;
    const thEnd = thL + lenAt(az) / Rs;
    for (let i = 0; i < fr.length; i++) {
      const th = thTip + fr[i] * (thEnd - thTip);
      sph(th, az, 1, d);
      const ri = innerR(th) + lift(th, thEnd);
      const t = thickAt(th, thEnd);
      inner[i].push(d.clone().multiplyScalar(ri));
      outer[i].push(d.clone().multiplyScalar(ri + t));
    }
    // Rounded free edge: half-round from the outer to the inner face, bulging posteriorly.
    const thE = thEnd, ri = innerR(thE) + lift(thE, thEnd), t = thickAt(thE, thEnd);
    sph(thE, az, 1, d);
    sph(thE + 0.01, az, 1, tang).sub(d).normalize(); // posterior tangent
    const mid = d.clone().multiplyScalar(ri + t * 0.5);
    for (let k = 0; k <= EDGE; k++) {
      const a = Math.PI * k / EDGE; // 0 = outer, PI = inner
      cap[k].push(mid.clone().addScaledVector(d, Math.cos(a) * t * 0.5).addScaledVector(tang, Math.sin(a) * t * 0.62));
    }
  }
  m.addGrid(outer, { aS: i => fr[i], aSide: () => 0 }, { expect: p => p.clone().normalize() });
  m.addGrid(inner, { aS: i => fr[i], aSide: () => 1 }, { expect: p => p.clone().normalize().negate() });
  m.addGrid(cap, { aS: () => 1, aSide: () => 2 }, { expect: p => { const q = p.clone().normalize(); return sph(Math.acos(q.z) + 0.2, Math.atan2(q.y, q.x), 1).sub(q); } });
  const geo = m.build();

  const uniforms = baseUniforms({ uBaseOpacity: { value: 0.07 }, uExplode: { value: 0 }, uLimbPolar: { value: thL }, uViewToLocal: { value: new THREE.Matrix3() } });
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xf3d9d4, metalness: 0, roughness: 0.07,
    transparent: true, opacity: uniforms.uBaseOpacity.value, depthWrite: false,
    ior: 1.337, specularIntensity: 1.0, specularColor: new THREE.Color(1.25, 1.25, 1.25),
    envMap: env, envMapIntensity: 0.42,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  patchMaterial(mat, 'conjunctiva', {
    uniforms,
    vertPars: 'attribute float aS; attribute float aSide; varying float vS; varying float vSide;',
    vertMain: 'vS = aS; vSide = aSide;',
    fragPars: GLSL_GRADBUMP + /* glsl */`
      uniform float uBaseOpacity; uniform float uExplode; uniform float uLimbPolar;
      varying float vS; varying float vSide;
      float gAlphaMul = 1.0; float gH = 0.0; float gSpecMul = 1.0; float gTip = 1.0; vec3 gWobG = vec3(0.0);
      float gRidgeC(float v) { v = 1.0 - abs(2.0 * v - 1.0); return v * v * v * v; }`,
    frag: [
      ['#include <color_fragment>', /* glsl */`#include <color_fragment>
      {
        vec3 P = vLocal; vec3 n = normalize(P);
        float polar = acos(clamp(n.z, -1.0, 1.0));
        float sL = (polar - uLimbPolar) * 12.0;
        vec2 az = n.xy / max(length(n.xy), 1e-4);
        float fp = max(length(fwidth(P)), 1e-4);
        float detail = 1.0 - smoothstep(0.03, 0.08, fp);
        // Palisades of Vogt: radial fibrovascular ridges in a ~1.5 mm limbal band, strongest at 12 and 6 o'clock.
        float pz = smoothstep(-0.2, 0.1, sL) * (1.0 - smoothstep(0.35, 1.1, sL));
        // Tear-film undulation with exact analytic slopes (no screen derivatives -> no 2x2-quad stair-steps
        // on the softbox reflection): a gentle ~0.015 mm swell plus a finer, lower ripple, calmest near the limbus.
        vec4 W, wx, wy, wz, W2, vx, vy, vz;
        tnG4(P * 0.75 + 3.0, W, wx, wy, wz);
        tnG4(P * 3.1 + 7.0, W2, vx, vy, vz);
        float wobA = mix(0.007, 0.016, smoothstep(1.0, 3.5, sL));
        gWobG = gGrad(wx, wy, wz, vec4(wobA * 0.75, 0.0, 0.0, 0.0)) + gGrad(vx, vy, vz, vec4(wobA * 0.14 * 3.1, 0.0, 0.0, 0.0));
        // The 0.42 mm taper onto the cornea has no thickness: no relief and no tear-film reflection of its
        // own there (the cornea's tear film carries the reflection across the limbus).
        gTip = smoothstep(-0.12, 0.35, sL);
        float pal = pz > 0.0 ? tn(vec3(az * 58.0, sL * 1.6)).x * 0.7 + tn(vec3(az * 130.0, sL * 2.5 + 4.0)).y * 0.3 : 0.0;
        pal = smoothstep(0.5, 0.85, pal) * pz * (0.25 + 0.75 * abs(az.y));
        // Loose membrane: faint circumferential micro-folds that grow towards the fornix edge, fine epithelial grain.
        float foldZone = smoothstep(4.0, 11.0, sL);
        float fold = tn(vec3(az * 7.0, sL * 2.4 + W.y * 1.5)).z;
        float grain = detail > 0.0 ? tn(P * 22.0).w : 0.5;
        gH = (pal * 0.006 * detail + (fold - 0.5) * (0.004 + 0.012 * foldZone) + (grain - 0.5) * 0.0015 * detail) * gTip;
        gWobG *= gTip;
        vec3 c = mix(vec3(0.95, 0.80, 0.78), vec3(1.0, 0.86, 0.85), uExplode);
        c = mix(c, vec3(0.94, 0.87, 0.86), 0.5 * smoothstep(0.1, -0.6, n.y) * (1.0 - uExplode)); // less pink inferiorly
        // Limbal epithelium is glass-clear: let the translucent grey-blue limbus show through.
        float limbZone = smoothstep(-0.6, -0.1, sL) * (1.0 - smoothstep(0.4, 1.4, sL));
        diffuseColor.rgb = c;
        gAlphaMul = (1.0 + pal * 0.6 + foldZone * 0.35) * smoothstep(0.0, 0.07, vS) * (1.0 - 0.75 * limbZone * (1.0 - uExplode));
        // In situ the membrane runs on to the fornix, so its cut edge melts into the sclera; once the
        // veil floats free (explode) the rolled free edge reads as a delicate hem.
        float hem = smoothstep(0.965, 1.0, vS) + (vSide > 1.5 ? 1.4 : 0.0);
        float inSitu = 1.0 - smoothstep(0.88, 1.0, vS);
        gAlphaMul *= mix(inSitu, 1.0 + 1.0 * hem, uExplode);
        gSpecMul = mix(mix(0.35, 1.0, inSitu), 1.0, uExplode);
        gAlphaMul *= mix(1.0, 0.6, uExplode); // floating free: a delicate veil, not a bowl
        // floating free, the loose membrane relaxes into soft wrinkles
        if (uExplode > 0.001) {
          // loose band relaxing into soft meridional pleats
          vec4 Wr = tn(vec3(az * 11.0 + W.z * 0.8, sL * 0.22));
          float pleat = smoothstep(0.25, 0.75, Wr.x);
          gH += uExplode * (pleat - 0.5) * 0.09 * smoothstep(0.5, 3.0, sL);
          gAlphaMul *= 1.0 + uExplode * 0.35 * Wr.y;
        }
      }`],
      ['#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.2, uExplode * 0.7);`],
      ['#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = gBump(-vViewPosition, normal, gH, faceDirection);
        normal = gGradBump(normal, gWobG * ((vSide > 0.5 && vSide < 1.5) ? -1.0 : 1.0) * faceDirection);`],
      ['#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
        #ifdef USE_CLEARCOAT
        clearcoatNormal = gBump(-vViewPosition, clearcoatNormal, gH * 0.6, faceDirection);
        clearcoatNormal = gGradBump(clearcoatNormal, gWobG * 0.6);
        #endif`],
      // Performance: the membrane's look is its tear-film reflection of the studio env (IBL); direct
      // lights only contribute Lambert diffuse + back-scatter here (no per-light GGX lobes), and the
      // IBL irradiance lookup is skipped.
      ['#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin
        .replace('IncidentLight directLight;', 'IncidentLight directLight;\nvec3 gBackAcc = vec3( 0.0 );')
        .replace('getDirectionalLightInfo( directionalLight, directLight );',
          'getDirectionalLightInfo( directionalLight, directLight );\n\t\tgBackAcc += directLight.color * max( 0.0, - dot( geometryNormal, directLight.direction ) );')
        .replaceAll('RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',
          'reflectedLight.directDiffuse += saturate( dot( geometryNormal, directLight.direction ) ) * directLight.color * BRDF_Lambert( material.diffuseContribution );')],
      ['#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '')],
      ['#include <lights_fragment_end>', `iblIrradiance *= 0.04;
        #include <lights_fragment_end>
        reflectedLight.directDiffuse += gBackAcc * BRDF_Lambert( material.diffuseContribution ) * (0.15 + 1.5 * uExplode) * 0.9;`],
      ['#include <opaque_fragment>', /* glsl */`
      {
        // Thin-film veil: opacity grows with path length at grazing angles; reflections are added
        // un-premultiplied so the tear film stays crisp while the tissue itself stays see-through.
        float nv = clamp(abs(dot(normalize(geometryNormal), geometryViewDir)), 0.0, 1.0);
        float a0 = clamp(diffuseColor.a * gAlphaMul * (1.0 - 0.55 * uVessels), 0.0, 0.92);
        float aE = 1.0 - pow(1.0 - a0, 1.0 / max(nv, mix(0.1, 0.22, uExplode)));
        float fade = clamp(diffuseColor.a / max(uBaseOpacity, 1e-4), 0.0, 1.0);
        vec3 spec = totalSpecular;
        #ifdef USE_CLEARCOAT
          spec = totalSpecular * (1.0 - material.clearcoat * Fcc) + (clearcoatSpecularDirect + clearcoatSpecularIndirect) * material.clearcoat;
        #endif
        vec3 diff = max(outgoingLight - spec, vec3(0.0));
        spec += G_LIME * uHighlight * (0.04 + 0.7 * pow(1.0 - nv, 2.0));
        gl_FragColor = vec4(diff * aE + spec * fade * gSpecMul * gTip, aE);
        // floating free: a thin pink Fresnel edge glow carries the silhouette instead of a dense body
        gl_FragColor.rgb += vec3(1.0, 0.8, 0.8) * pow(1.0 - nv, 3.0) * 0.07 * uExplode * (1.0 - 0.55 * uVessels);
        // ...and its stroma scatters the studio light (pink, translucent) instead of reading as a dark body
        gl_FragColor.rgb += diffuseColor.rgb * vec3(1.0, 0.86, 0.86) * aE * 0.3 * uExplode * (1.0 - 0.55 * uVessels);
      }`],
    ],
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'conjunctiva';
  mesh.renderOrder = 3;
  trackViewToLocal(mesh, uniforms.uViewToLocal);

  const proxyGeo = new THREE.SphereGeometry(Rs + 0.15, 48, 14, 0, Math.PI * 2, thL - 0.02, 12.0 / Rs + 0.02);
  proxyGeo.rotateX(Math.PI / 2);
  const proxy = new THREE.Mesh(proxyGeo, proxyMaterial());
  proxy.name = 'conjunctiva-pick';

  const object = new THREE.Group(); object.name = 'part:conjunctiva';
  object.add(mesh, proxy);

  const win = PART_BY_ID['conjunctiva']?.window || [0, 1];
  return {
    id: 'conjunctiva',
    object,
    pickables: [proxy],
    anchor: am.behindLimbus(5.0, THREE.MathUtils.degToRad(104), Rs + 0.15),
    focus: { center: new THREE.Vector3(0, 0, L.limbusZ - 3.2), radius: 12.5 },
    setGhost: makeSetGhost(object, [uniforms]),
    update(frame) {
      uniforms.uTime.value = frame.time;
      uniforms.uVessels.value = frame.vessels || 0;
      uniforms.uExplode.value = smooth((frame.explode - win[0]) / Math.max(1e-6, win[1] - win[0]));
    },
  };
}
