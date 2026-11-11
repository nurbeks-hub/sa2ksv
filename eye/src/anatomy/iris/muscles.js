// Intrinsic muscles of the iris, both driven by the live pupil on the GPU.
//  - Sphincter pupillae: circular smooth-muscle ring (~0.8 mm wide, ~0.12 mm thick at rest) in the posterior stroma
//    just outside the pupil margin; circumferential fibre bundles separated by connective-tissue septa. Volume is
//    conserved, so the contracted ring (miosis) is narrower in circumference but wider and thicker.
//  - Dilator pupillae: thin radial myoepithelial sheet (anterior layer of the iris epithelium), from behind the outer
//    half of the sphincter to the root, lying just anterior to the posterior pigment epithelium and following its folds.
import * as THREE from 'three';
import { patchedMaterial, gridGeometry, irisBounds } from './shading.js';

export function buildSphincter({ quality }) {
  const geo = irisBounds(gridGeometry(quality === 'low' ? 256 : 384, 14, { flip: true }));
  const mat = patchedMaterial({
    name: 'sphincter',
    params: { color: 0xffffff, roughness: 0.34, metalness: 0.0 },
    uniforms: {
      uMuscle: { value: new THREE.Color(0x9a5a4c) }, uFibre: { value: new THREE.Color(0xc89080) }, uSeptum: { value: new THREE.Color(0x4a2418) },
    },
    vHead: /* glsl */`
      varying vec2 vMUv; varying float vMTone;
      // fascicle coordinate across the band: ~7 circumferential bundles of uneven width, slowly braiding along the ring
      float irFasc(float x, vec2 cs, float th) {
        float xw = (x * 0.5 + 0.5) + 0.06 * sin(x * 5.3 + 1.1) + 0.05 * (vnoise(vec3(cs * 3.0, 2.0)) - 0.5);
        return abs(sin(xw * 3.14159265 * 7.0 + 1.2 * vnoise(vec3(cs * 4.0, 0.0)) + 0.4 * sin(th * 9.0)));
      }
      vec3 irSphP(float th, float b) {
        float pp = irPth(th, uPupil);
        vec4 sp = irSphincter(pp);
        float cb = cos(b), sb = sin(b);
        float x = sign(cb) * pow(abs(cb), 0.6), y = sign(sb) * pow(abs(sb), 0.6);
        vec2 cs = vec2(cos(th), sin(th));
        float bundle = 0.006 * (vnoise(vec3(cs * 22.0, b * 1.5)) - 0.5);
        float cord = irFasc(x, cs, th);
        float lift = 0.012 * sqrt(cord) * smoothstep(0.2, 0.6, abs(y));
        float r = sp.z + 0.5 * sp.x * x + bundle;
        float zb = irBack((r - pp) / (IR_R1 - pp), pp) + 0.018;
        return irPolar(th, r, zb + 0.5 * sp.y * (1.0 + y) + sign(y) * lift + bundle * 0.5);
      }`,
    vNormal: /* glsl */`
      float irTh = uv.x * IR_TAU, irB = uv.y * IR_TAU;
      vec3 irP = irSphP(irTh, irB);
      vec3 irN = normalize(cross(irSphP(irTh + 0.002, irB) - irSphP(irTh - 0.002, irB), irSphP(irTh, irB + 0.02) - irSphP(irTh, irB - 0.02)));
      vMUv = vec2(uv.x, uv.y);
      vMTone = clamp(-irDil(uPupil), 0.0, 1.0);   // contracted (miosis) -> active tone`,
    fHead: /* glsl */`
      uniform vec3 uMuscle, uFibre, uSeptum;
      varying vec2 vMUv; varying float vMTone;
      float irFasc(float x, vec2 cs, float th) {
        float xw = (x * 0.5 + 0.5) + 0.06 * sin(x * 5.3 + 1.1) + 0.05 * (vnoise(vec3(cs * 3.0, 2.0)) - 0.5);
        return abs(sin(xw * 3.14159265 * 7.0 + 1.2 * vnoise(vec3(cs * 4.0, 0.0)) + 0.4 * sin(th * 9.0)));
      }
      float irSphH(vec2 uv) {
        // smooth-muscle fibres run circumferentially (long along the ring, fine across it); septa between fascicles
        float th = uv.x * IR_TAU;
        vec2 c = vec2(cos(th), sin(th));
        float b = uv.y * IR_TAU, xb = cos(b);
        float x = sign(xb) * pow(abs(xb), 0.6);
        float cord = irFasc(x, c, th);
        float fib = vnoise(vec3(c * 6.0, uv.y * 260.0)) * 0.55 + vnoise(vec3(c * 16.0, uv.y * 620.0 + 7.0)) * 0.45;
        fib = smoothstep(0.25, 0.8, fib);
        float sep = 1.0 - smoothstep(0.0, 0.2, cord);
        return fib * 0.7 * (0.45 + 0.55 * cord) - sep * 0.8;
      }`,
    fColor: /* glsl */`
      {
        float h = irSphH(vMUv);
        float fib = clamp(h / 0.6, 0.0, 1.0), sep = clamp(-h, 0.0, 1.0);
        vec3 c = mix(uMuscle, uFibre, fib * 0.6);
        c = mix(c, uSeptum, sep * 0.75);
        c *= 0.88 + 0.24 * vnoise(vec3(cos(vMUv.x * IR_TAU) * 10.0, sin(vMUv.x * IR_TAU) * 10.0, vMUv.y * 3.0));
        c *= 1.0 + 0.18 * vMTone;
        diffuseColor.rgb = c;
      }`,
    fNormal: /* glsl */`
      {
        float h0 = irSphH(vMUv);
        float dhx = dFdx(h0), dhy = dFdy(h0);
        vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
        vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
        float det = dot(dpx, r1);
        normal = normalize(abs(det) * normal - sign(det) * 0.005 * (dhx * r1 + dhy * r2));
      }`,
    fEmissive: /* glsl */`
      totalEmissiveRadiance += diffuseColor.rgb * (0.04 + 0.05 * vMTone);`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sphincter-pupillae';
  return { mesh, mats: [mat] };
}

export function buildDilator({ quality }) {
  const geo = irisBounds(gridGeometry(quality === 'low' ? 256 : 384, 16));
  const mat = patchedMaterial({
    name: 'dilator',
    params: { color: 0xffffff, roughness: 0.78, metalness: 0.0, side: THREE.DoubleSide },
    uniforms: {
      uBase: { value: new THREE.Color(0x5e3a2e) }, uFib: { value: new THREE.Color(0x9a6a56) }, uGap: { value: new THREE.Color(0x24100a) },
    },
    vHead: /* glsl */`
      varying vec2 vDUv; varying float vDTone; varying float vDFold;
      vec3 irDilP(float th, float v, out float fold) {
        float pp = irPth(th, uPupil);
        vec4 sp = irSphincter(pp);
        float s0 = (sp.z - pp) / (IR_R1 - pp);
        float s = mix(s0, 0.992, v);
        fold = irPpeFold(th, s);
        return irPolar(th, irRad(s, pp), irBack(s, pp) + 0.010 - 0.8 * fold);
      }`,
    vNormal: /* glsl */`
      float irTh = uv.x * IR_TAU, irV = uv.y, irF, irF2;
      vec3 irP = irDilP(irTh, irV, irF);
      vec3 irN = normalize(cross(irDilP(irTh, min(irV + 0.01, 1.0), irF2) - irDilP(irTh, max(irV - 0.01, 0.0), irF2),
                                 irDilP(irTh + 0.002, irV, irF2) - irDilP(irTh - 0.002, irV, irF2)));
      vDUv = vec2(uv.x, irV); vDFold = irF;
      vDTone = clamp(irDil(uPupil), 0.0, 1.0);   // dilated -> dilator active`,
    fHead: /* glsl */`
      uniform vec3 uBase, uFib, uGap;
      varying vec2 vDUv; varying float vDTone; varying float vDFold;`,
    fColor: /* glsl */`
      {
        float th = vDUv.x * IR_TAU;
        vec2 cs = vec2(cos(th), sin(th));
        // radial myofilaments grouped into bundles (processes of the myoepithelial cells), not a uniform stripe
        float ph = th * 720.0 + 6.0 * vnoise(vec3(cs * 8.0, vDUv.y * 6.0));
        float aa = 1.0 - smoothstep(0.25, 0.7, fwidth(ph) / 6.2831853);   // fade fibres below pixel size
        float grp = smoothstep(0.3, 0.75, vnoise(vec3(cs * 46.0, vDUv.y * 7.0)));
        float fib = mix(0.5, 0.5 + 0.5 * sin(ph), aa * grp);
        float gph = th * 110.0 + 7.0 * vnoise(vec3(cs * 14.0, vDUv.y * 3.0));
        float gap = mix(0.1, smoothstep(0.7, 1.0, 0.5 + 0.5 * sin(gph)) * (0.4 + 0.6 * vnoise(vec3(cs * 30.0, vDUv.y * 4.0 + 2.0))), aa);
        vec3 c = mix(uBase, uFib, fib * 0.55 + 0.12 * grp);
        c = mix(c, uGap, gap * 0.65);
        c *= 0.8 + 0.35 * clamp(vDFold / 0.016, 0.0, 1.0);
        c *= 1.0 + 0.15 * vDTone;
        diffuseColor.rgb = c;
      }`,
    fEmissive: /* glsl */`
      totalEmissiveRadiance += diffuseColor.rgb * (0.04 + 0.04 * vDTone);`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'dilator-pupillae';
  return { mesh, mats: [mat] };
}
