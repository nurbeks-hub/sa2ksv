// Cornea: a positive meniscus. Anterior sphere R 7.8, posterior conicoid (apical R 6.5, Q ~ -0.29)
// giving 0.54 mm centrally and 0.67 mm at the rim, which sits exactly on the limbus.
// Physical transmission (ior 1.376) with a crisp tear-film clearcoat, a grey-blue limbal ring and
// the five corneal layers readable as banding on the cut rim.
import * as THREE from 'three';
import { Mesher, corneaRim, patchMaterial, baseUniforms, makeSetGhost, proxyMaterial, GLSL_GRADBUMP, trackViewToLocal } from './shared.js';

// Dev hook: ?inspect=1 on the harness forces the inspected look (layer banding on the cut rim).
const DEV_INSPECT = typeof location !== 'undefined' && /[?&]inspect=1(&|$)/.test(location.search);

export function buildCornea(ctx, env) {
  const { EYE, L } = ctx;
  const rim = corneaRim(EYE, L);
  const SEG = 192;
  const C = new THREE.Vector3(0, 0, rim.cZ);

  const m = new Mesher({ aPart: 1, aDepth: 1 });

  // Anterior surface (apex -> limbus), denser towards the rim.
  const NA = 46, antRings = [], antRho = [];
  for (let i = 0; i <= NA; i++) {
    const t = i / NA; const rho = rim.lR * (1 - Math.pow(1 - t, 1.35)) ;
    antRho.push(rho);
    const z = rim.zAnt(rho), ring = [];
    for (let j = 0; j < SEG; j++) { const a = j / SEG * Math.PI * 2; ring.push(new THREE.Vector3(Math.cos(a) * rho, Math.sin(a) * rho, z)); }
    antRings.push(ring);
  }
  m.addGrid(antRings, { aPart: () => 0, aDepth: () => 0 }, {
    normals: (i, j, p) => p.clone().sub(C).normalize(),
  });

  // Posterior surface (endothelium), faces into the anterior chamber (-Z).
  const NP = 38, postRings = [];
  for (let i = 0; i <= NP; i++) {
    const t = i / NP; const rho = rim.rP * (1 - Math.pow(1 - t, 1.3));
    const z = rim.zPost(rho), ring = [];
    for (let j = 0; j < SEG; j++) { const a = j / SEG * Math.PI * 2; ring.push(new THREE.Vector3(Math.cos(a) * rho, Math.sin(a) * rho, z)); }
    postRings.push(ring);
  }
  m.addGrid(postRings, { aPart: () => 1, aDepth: () => 1 }, {
    normals: (i, j, p) => {
      const rho = Math.hypot(p.x, p.y); const s = rim.dzPost(rho);
      const rx = rho > 1e-6 ? p.x / rho : 0, ry = rho > 1e-6 ? p.y / rho : 0;
      return new THREE.Vector3(-s * rx, -s * ry, -1).normalize();
    },
  });

  // Cut rim: straight bevel from the anterior limbus ring to the posterior rim ring.
  const NR = 6, rimRings = [];
  const fr = rim.rP - rim.lR, fz = rim.zP - rim.lZ; const fl = Math.hypot(fr, fz);
  const nR = -fz / fl, nZ = fr / fl; // outward normal in (rho, z)
  for (let i = 0; i <= NR; i++) {
    const t = i / NR; const rho = rim.lR + fr * t, z = rim.lZ + fz * t, ring = [];
    for (let j = 0; j < SEG; j++) { const a = j / SEG * Math.PI * 2; ring.push(new THREE.Vector3(Math.cos(a) * rho, Math.sin(a) * rho, z)); }
    rimRings.push(ring);
  }
  m.addGrid(rimRings, { aPart: () => 2, aDepth: (i) => i / NR }, {
    normals: (i, j, p) => { const rho = Math.hypot(p.x, p.y); return new THREE.Vector3(p.x / rho * nR, p.y / rho * nR, nZ).normalize(); },
  });

  const geo = m.build();

  const uniforms = baseUniforms({ uLimbusR: { value: rim.lR }, uViewToLocal: { value: new THREE.Matrix3() } });
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.0,
    transmission: 1, ior: 1.376, thickness: 2.4,
    attenuationColor: new THREE.Color(0xfbfaf7), attenuationDistance: 40,
    specularIntensity: 1.0, specularColor: new THREE.Color(2.2, 2.2, 2.2), // tear film + epithelium: F0 ~ 0.055
    envMap: env, envMapIntensity: 1.0,
  });
  patchMaterial(mat, 'cornea', {
    uniforms,
    vertPars: 'attribute float aPart; attribute float aDepth; varying float vPart; varying float vDepth;',
    vertMain: 'vPart = aPart; vDepth = aDepth;',
    fragPars: GLSL_GRADBUMP + /* glsl */`
      uniform float uLimbusR;
      varying float vPart; varying float vDepth;
      float gCornT = 1.0; float gCornThick = 1.0; float gScat = 0.0; vec3 gTearG = vec3(0.0);`,
    frag: [
      ['#include <color_fragment>', /* glsl */`#include <color_fragment>
      {
        float rho = length(vLocal.xy);
        vec2 az2 = vLocal.xy / max(rho, 1e-4);
        // Limbal ring: the corneal periphery reads as a soft grey-blue band against the iris.
        float lr = smoothstep(uLimbusR - 0.95, uLimbusR - 0.08, rho);
        lr *= 0.8 + 0.2 * tn(vec3(az2 * 6.0, 1.0)).x;
        vec3 tint = mix(vec3(1.0), vec3(0.34, 0.41, 0.5), lr * 0.5);
        // Sclerocorneal zone: the corneal stroma loses its order over the last ~1 mm and scatters like the
        // sclera it grows out of (milky blue-grey, partly opaque). The sclera overlaps the cornea further at
        // 12 and 6 o'clock, so the clear cornea reads as a horizontal oval (~11.7 x 10.6 mm).
        float ov = az2.y * az2.y;
        float zw = tn(vec3(az2 * 4.0, 3.0)).y - 0.5;
        float zIn = uLimbusR - 0.8 - 0.55 * ov + zw * 0.25;
        gScat = smoothstep(zIn, uLimbusR + 0.02, rho);
        gScat *= gScat * (3.0 - 2.0 * gScat);
        tint = mix(tint, vec3(0.5, 0.55, 0.62) * (0.92 + 0.16 * zw), gScat);
        gCornThick = 1.0 - smoothstep(1.5, uLimbusR - 0.1, rho) * 0.86; // keep some refraction depth at the periphery
        gCornT = mix(1.0, 0.42, gScat);
        if (vPart > 1.5) {
          // Five layers across the cut rim (fractions of the 0.67 mm rim thickness; the three
          // thin layers are drawn ~2-3x thicker so they survive at screen scale).
          float d = vDepth;
          float aa = max(fwidth(d), 0.004);
          float epi  = 1.0 - smoothstep(0.088 - aa, 0.088 + aa, d);
          float bow  = smoothstep(0.092 - aa, 0.092 + aa, d) * (1.0 - smoothstep(0.118 - aa, 0.118 + aa, d));
          float desc = smoothstep(0.944 - aa, 0.944 + aa, d) * (1.0 - smoothstep(0.970 - aa, 0.970 + aa, d));
          float endo = smoothstep(0.978 - aa, 0.978 + aa, d);
          float stroma = clamp(1.0 - epi - bow - desc - endo, 0.0, 1.0);
          float lam = 0.5 + 0.5 * sin(d * 240.0 + tn(vLocal * 5.0).y * 5.0);
          vec3 c = vec3(0.84, 0.88, 0.92) * epi + vec3(1.0) * bow + vec3(1.0) * desc
                 + vec3(0.5, 0.57, 0.68) * endo + vec3(0.9, 0.94, 0.98) * mix(1.0, 0.8 + 0.2 * lam, 0.4 + 0.6 * uInspect) * stroma;
          tint = c;
          gCornT = mix(0.82, 0.45, uInspect) * (1.0 - 0.45 * (bow + desc + epi * 0.5) * (0.4 + 0.6 * uInspect));
          gScat = 0.0;
        }
        diffuseColor.rgb = tint;
        // Tear film: slow undulation (~3 um) + a finer ripple, with exact analytic slopes so the catch-light
        // edges waver smoothly instead of stepping per pixel quad.
        if (vPart < 0.5) {
          vec4 v1, x1, y1, z1, v2, x2, y2, z2;
          tnG4(vLocal * 2.3 + vec3(0.0, 0.0, uTime * 0.04), v1, x1, y1, z1);
          tnG4(vLocal * 8.0 + 3.7, v2, x2, y2, z2);
          gTearG = gGrad(x1, y1, z1, vec4(0.003 * 2.3, 0.0, 0.0, 0.0)) + gGrad(x2, y2, z2, vec4(0.0, 0.00035 * 8.0, 0.0, 0.0));
        }
      }`],
      ['#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (vPart < 0.5) normal = gGradBump(normal, gTearG);`],
      ['#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
        #ifdef USE_CLEARCOAT
        if (vPart < 0.5) clearcoatNormal = gGradBump(clearcoatNormal, gTearG);
        #endif`],
      ['#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float nvh = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
          totalEmissiveRadiance += G_LIME * uHighlight * (0.03 + 0.55 * nvh * nvh * nvh);
          // faint cool rim line so the dome keeps its silhouette against black (profile / exploded views)
          if (vPart < 0.5) totalEmissiveRadiance += vec3(0.55, 0.66, 0.82) * pow(nvh, 5.0) * 0.16 * (1.0 - gScat) * (1.0 - 0.6 * uVessels);
        }`],
      ['#include <lights_fragment_end>', `iblIrradiance *= mix(0.04, 0.22, gScat);
        #include <lights_fragment_end>
        reflectedLight.directSpecular *= 1.0 - 0.6 * uVessels;
        reflectedLight.indirectSpecular *= 1.0 - 0.6 * uVessels;`],
      ['#include <transmission_fragment>', THREE.ShaderChunk.transmission_fragment
        .replace('material.transmission = transmission;', 'material.transmission = transmission * gCornT;')
        .replace('material.thickness = thickness;', 'material.thickness = thickness * gCornThick;')
        .replace('n, v, material.roughness, material.diffuseContribution', 'n, v, (vPart > 1.5 ? 0.15 : 0.0), material.diffuseContribution')],
    ],
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'cornea';
  mesh.renderOrder = 2;
  trackViewToLocal(mesh, uniforms.uViewToLocal);

  // Low-poly pick proxy (anterior cap).
  const proxyGeo = new THREE.SphereGeometry(rim.Ra, 32, 10, 0, Math.PI * 2, 0, Math.asin(rim.lR / rim.Ra));
  proxyGeo.rotateX(Math.PI / 2); proxyGeo.translate(0, 0, rim.cZ);
  const proxy = new THREE.Mesh(proxyGeo, proxyMaterial());
  proxy.name = 'cornea-pick';

  const object = new THREE.Group(); object.name = 'part:cornea';
  object.add(mesh, proxy);

  const az = THREE.MathUtils.degToRad(128);
  const aRho = 4.2;
  const anchor = new THREE.Vector3(Math.cos(az) * aRho, Math.sin(az) * aRho, rim.zAnt(aRho));
  let inspect = 0;
  return {
    id: 'cornea',
    object,
    pickables: [proxy],
    anchor,
    focus: { center: new THREE.Vector3(0, 0, (L.limbusZ + L.corneaApexZ) / 2 - 0.4), radius: 7.6 },
    setGhost: makeSetGhost(object, [uniforms]),
    update(frame) {
      uniforms.uTime.value = frame.time;
      uniforms.uVessels.value = frame.vessels || 0;
      const want = (frame.inspect || DEV_INSPECT) && (frame.ghost || 0) < 0.5 ? 1 : 0;
      inspect += (want - inspect) * Math.min(1, (frame.dt || 0.016) * 4);
      uniforms.uInspect.value = inspect;
    },
    info: { Q: rim.Q, rimInner: [rim.rP, rim.zP] },
  };
}
