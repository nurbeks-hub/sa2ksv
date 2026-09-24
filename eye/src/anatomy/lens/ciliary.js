// Ciliary body: one ring mesh (anterior face with the iris-root insertion, 72 clubbed ciliary processes of the
// pars plicata, smooth pars plana with meridional striae ending in the scalloped ora serrata, outer muscular
// surface against the sclera) + a section-cap mesh that shows the meridional cut (ciliary muscle wedge with
// longitudinal / radial / circular fibres, stroma, major arterial circle, epithelium) when a cutaway opens.
// The ring is meshed in two azimuthal bands: 18 vertices per process over the anterior face and the pars
// plicata (where the process heads need them), 6 per process over the pars plana, ora and outer surface,
// zipped together by a stitch strip (one geometry, one draw call).
import * as THREE from 'three';
import { GLSL_NOISE } from '../../lib/materials.js';
import { L, PALETTE } from '../../config.js';
import { CB, ciliaryRows, evalRow, cbPoint, merPoint, merInverse } from './profile.js';

const lin = hex => new THREE.Color(hex);

// Major arterial circle of the iris: the same landmark as the iris module (iris/profile.js MAC:
// r 6.05 mm, z = L.irisZ - 0.88, tube radius 0.1 mm), proposed for lib/anatomyMath.
export const MAC = { r: 6.05, z: L.irisZ - 0.88, tube: 0.1 };

export function makeCiliaryUniforms() {
  return {
    uCut: { value: 0 }, uCutAz: { value: 2.4 }, uCutHalf: { value: 0 },
    uVessels: { value: 0 }, uTime: { value: 0 },
    uValley: { value: lin(0x0a0503) }, uFlank: { value: lin(0x2a140c) }, uCrest: { value: lin(0x4a3528) },
    uTip: { value: lin(0x6a2a1e) }, uPlana: { value: lin(0x33200f) }, uOra: { value: lin(0x54443a) },
    uOuter: { value: lin(0x2d1911) },
    uMuscle: { value: lin(0x8f5a4b) }, uMuscleDk: { value: lin(0x5a3027) }, uPig: { value: lin(0x120905) },
    uStroma: { value: lin(0x2c170e) }, uBlood: { value: lin(0x3c0a09) }, uVesWall: { value: lin(0x8a4a3e) },
    uGlowA: { value: lin(PALETTE.arteryGlow) }, uArtery: { value: lin(PALETTE.artery) },
    uMAC: { value: new THREE.Vector3(MAC.r, MAC.z, MAC.tube) },
  };
}

const PARS = /* glsl */`
  uniform float uCut, uCutAz, uCutHalf, uVessels, uTime;
  uniform vec3 uValley, uFlank, uCrest, uTip, uPlana, uOra, uOuter, uMuscle, uMuscleDk, uPig, uStroma, uBlood, uVesWall, uGlowA, uArtery;
  uniform vec3 uMAC;
  varying vec4 vCB; varying vec3 vPL;
  ${GLSL_NOISE}
  float p4c(float x) { x *= x; return x * x; }
  float pulseAt(float ph) { float x = fract(uTime * 1.15 - ph); return exp(-x * 9.0) + 0.35 * exp(-pow((x - 0.28) * 10.0, 2.0)); }
  // anti-aliasing weight of a pattern with 'freq' features per unit, given the pixel footprint in those units
  float aaw(float freq, float fw) { return 1.0 - smoothstep(0.3, 0.75, freq * fw); }
`;

// ---------------- main ring ----------------
const SURF = /* glsl */`
  float cT = vCB.x, cSide = vCB.y, cCrest = vCB.z, cEndD = vCB.w;
  float cR = max(length(vPL.xy), 1e-3);
  float cAz = atan(vPL.y, vPL.x);
  float fwP = length(fwidth(vPL));                  // mm per pixel
  float fwA = fwP / cR;                             // radians per pixel (seam-safe, no fwidth of atan)
  float cn1 = vnoise(vPL * 6.0);
  float cn2 = mix(0.5, vnoise(vPL * 21.0 + 3.1), aaw(21.0, fwP));
  float head = 1.0 - smoothstep(0.35, 1.4, cT);
  float headW = pow(head, 1.5);
  float plic = 1.0 - smoothstep(1.9, 2.6, cT);
  // pars plicata: black valleys, dark-brown flanks, grey-brown crests; only the heads are reddish (vascular)
  vec3 inner = mix(uValley, uFlank, smoothstep(0.0, 0.5, cCrest));
  inner = mix(inner, uCrest, smoothstep(0.45, 0.95, cCrest) * plic * (0.8 + 0.4 * cn2));
  inner = mix(inner, uTip, smoothstep(0.6, 1.0, cCrest) * headW * plic * (0.65 + 0.7 * cn2));
  // pars plana: dark, meridional striae (the zonular grooves); the ora band paler, grey-brown
  float striae = mix(0.45, smoothstep(0.3, 0.8, vnoise(vec3(cAz * 150.0, cT * 0.6, 4.0))), aaw(150.0, fwA));
  float cn3 = mix(0.5, vnoise(vec3(cAz * 70.0, cT * 2.5, 1.7)), aaw(70.0, fwA));
  vec3 plana = uPlana * (0.8 + 0.4 * cn3) * (1.0 - 0.32 * striae);
  float ora = 1.0 - smoothstep(0.0, 0.55, cEndD);
  plana = mix(plana, uOra * (0.8 + 0.4 * cn1), ora * 0.85);
  inner = mix(plana, inner, plic);
  inner *= 0.85 + 0.3 * cn1;
  // outer surface (thin pigmented supraciliary lamina over the muscle): dark brown, faint meridional bundles
  float fib = mix(0.5, vnoise(vec3(cAz * 240.0, cT * 0.8, 0.0)), aaw(240.0, fwA));
  vec3 outer = uOuter * (0.78 + 0.4 * fib) * (0.9 + 0.2 * cn1);
  outer = mix(outer, uOuter * 0.72, smoothstep(2.0, 5.0, cT) * 0.5);
  float wIn = smoothstep(0.2, 0.8, cSide);
  diffuseColor.rgb = mix(outer, inner, wIn);
  float crestR = mix(0.58, 0.34, smoothstep(0.4, 0.95, cCrest));          // hyaline sheen on the crests
  float planaR = mix(0.5, 0.36, striae) - 0.06 * ora;
  float cRough = mix(0.62, mix(planaR, crestR, plic), wIn);
  float cH = mix(fib * 0.6 + cn2 * 0.2, (cn2 * 0.65 + cn1 * 0.35) * (0.3 + 0.7 * plic) + (striae * 0.3 + ora * cn1 * 0.5) * (1.0 - plic), wIn);
  float cBumpAmp = mix(0.010, 0.012, wIn);
  float cCoat = 0.0;
  float cSpec = mix(0.45, mix(0.7, 0.95, plic), wIn);
  vec3 cEmit = uTip * 0.012 * smoothstep(0.6, 1.0, cCrest) * headW * plic * wIn;
  if (uVessels > 0.001) {
    // capillary loops of the processes: sparse ridged lines running along each process (stretched along the
    // meridian), confined to the pars plicata; pulses flow back from the major arterial circle
    float vx = vnoise(vec3(cAz * 58.0, cT * 2.6, 11.0));
    float lines = p4c(1.0 - abs(2.0 * vx - 1.0)); lines *= lines * aaw(58.0, fwA);
    float tipV = smoothstep(0.55, 1.0, cCrest) * headW;
    float p = pulseAt(cT * 0.22 + cAz * 0.02);
    cEmit += uGlowA * uVessels * wIn * plic * (tipV * (0.22 + 0.55 * p) + lines * smoothstep(0.15, 0.8, cCrest) * (0.25 + 0.75 * p));
  }
`;
const CUT = /* glsl */`
  if (uCut > 0.001) { float dA = abs(mod(atan(vPL.y, vPL.x) - uCutAz + PI, 2.0 * PI) - PI); if (dA < uCutHalf) discard; }
`;
const BUMP = /* glsl */`
  {
    float fw = length(fwidth(vPL));
    float amp = cBumpAmp * (1.0 - smoothstep(0.03, 0.12, fw));
    vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
    float h = cH * amp;
    float dhx = dFdx(h), dhy = dFdy(h);
    vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
    float det = dot(dpx, r1);
    vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
    normal = normalize(abs(det) * normal - grad);
  }
`;

function patch(mat, key, { vertexAttr, vertexAssign, surf, cut, bump, rough, emit }) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mat.userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${vertexAttr}\nvarying vec4 vCB; varying vec3 vPL;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexAssign}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${cut || ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${surf}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${rough}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${bump || ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${emit}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\nmaterial.specularColor *= cSpec; material.specularColorBlended *= cSpec; material.specularF90 *= cSpec;\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= cCoat;\n#endif`);
  };
  mat.customProgramCacheKey = () => key;
}

export function buildCiliaryRing(uniforms, perA = 18, perB = 6) {
  const rows = ciliaryRows();
  const rowsA = rows.filter(r => r.band === 0), rowsB = rows.filter(r => r.band === 1);
  const NA = CB.N * perA, NB = CB.N * perB;
  const nA = rowsA.length, nB = rowsB.length;
  const nV = nA * NA + nB * NB;
  const pos = new Float32Array(nV * 3), cb = new Float32Array(nV * 4);
  const v = new THREE.Vector3();
  const fill = (rowList, NAZ, base) => {
    for (let k = 0; k < NAZ; k++) {
      const az = (k / NAZ) * Math.PI * 2;
      for (let j = 0; j < rowList.length; j++) {
        const e = evalRow(rowList[j], az);
        cbPoint(e.t, e.d, az, v);
        const o = base + j * NAZ + k;
        pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
        cb[o * 4] = e.t; cb[o * 4 + 1] = e.side; cb[o * 4 + 2] = e.crest; cb[o * 4 + 3] = e.tE - e.t;
      }
    }
  };
  const baseB = nA * NA;
  fill(rowsA, NA, 0);
  fill(rowsB, NB, baseB);

  const idx = [];
  const strips = (base, nRows, NAZ) => {
    for (let j = 0; j < nRows - 1; j++) for (let k = 0; k < NAZ; k++) {
      const k1 = (k + 1) % NAZ;
      const a = base + j * NAZ + k, b = base + j * NAZ + k1, c = base + (j + 1) * NAZ + k, d = base + (j + 1) * NAZ + k1;
      idx.push(a, b, c, b, d, c);
    }
  };
  strips(0, nA, NA);
  strips(baseB, nB, NB);
  // zipper between the last band-A row (NA vertices) and the first band-B row (NB vertices)
  {
    const top = (nA - 1) * NA, bot = baseB;
    let i = 0, m = 0;
    while (i < NA || m < NB) {
      const aNext = (i + 1) / NA, bNext = (m + 1) / NB;
      if (m >= NB || (i < NA && aNext <= bNext)) { idx.push(top + (i % NA), top + ((i + 1) % NA), bot + (m % NB)); i++; }
      else { idx.push(top + (i % NA), bot + ((m + 1) % NB), bot + (m % NB)); m++; }
    }
  }
  const index = new Uint32Array(idx);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCB', new THREE.BufferAttribute(cb, 4));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  // orientation check: outer rows must face away from the globe centre
  {
    const n = g.attributes.normal, o = baseB + (nB - 4) * NB;
    const px = pos[o * 3], py = pos[o * 3 + 1], pz = pos[o * 3 + 2];
    if (n.getX(o) * px + n.getY(o) * py + n.getZ(o) * pz < 0) {
      for (let i = 0; i < index.length; i += 3) { const t = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t; }
      g.index.needsUpdate = true;
      g.computeVertexNormals();
    }
  }
  g.computeBoundingSphere();

  // Standard (not Physical): the wet sheen comes from low roughness on the crests; cheaper than clearcoat.
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, emissive: 0x000000 });
  mat.userData.uniforms = uniforms;
  patch(mat, 'eye-ciliary-ring-v2', {
    vertexAttr: 'attribute vec4 aCB;',
    vertexAssign: 'vCB = aCB; vPL = position;',
    surf: SURF, cut: CUT, bump: BUMP,
    rough: 'roughnessFactor = cRough;',
    emit: 'totalEmissiveRadiance += cEmit;',
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'ciliary-ring';
  return mesh;
}

// ---------------- section caps ----------------
const CAP_SURF = /* glsl */`
  float sT = vCB.x, sD = vCB.y, sTot = vCB.z, sCrest = vCB.w;
  float fwP = length(fwidth(vPL));
  float sMus = 0.74 * smoothstep(-0.12, 0.75, sT) * pow(1.0 - smoothstep(0.5, 4.6, sT), 0.9);
  float cn = vnoise(vec3(sT * 7.0, sD * 7.0, 2.0));
  float cnF = mix(0.5, vnoise(vec3(sT * 30.0, sD * 30.0, 7.0)), aaw(30.0, fwP));
  float xm = sD / max(sMus, 1e-3);
  // ciliary muscle: bundles separated by thin connective septa. Anisotropic bundle noise stretched along each
  // fibre direction: longitudinal (meridional, along the sclera), radial (fanning from the scleral spur) and
  // circular (Mueller's muscle, running around the eye, so cut across here: rounded bundle profiles).
  float lon = mix(0.5, vnoise(vec3(sT * 2.2 + cn * 0.5, sD * 30.0, 3.0)), aaw(30.0, fwP));
  vec2 rq = vec2(sT + 0.25, sD + 0.05);
  float rLen = length(rq), rAng = atan(rq.y, rq.x);
  float rad = mix(0.5, vnoise(vec3(rAng * 24.0 + cn * 0.6, rLen * 2.4, 5.0)), aaw(24.0, fwP / max(rLen, 0.05)));
  float circ = mix(0.5, vnoise(vec3(sT * 20.0 + cn, sD * 20.0, 9.0)), aaw(20.0, fwP));
  float wLon = 1.0 - smoothstep(0.32, 0.5, xm);
  float wCirc = smoothstep(0.62, 0.78, xm) * (1.0 - smoothstep(0.8, 1.3, sT));
  float fibre = mix(mix(rad, lon, wLon), smoothstep(0.35, 0.65, circ), wCirc);
  vec3 musc = mix(uMuscleDk, uMuscle, smoothstep(0.28, 0.72, fibre)) * (0.9 + 0.2 * cnF);
  // stroma: loose connective tissue with melanocytes (dark brown, speckled)
  vec3 strom = uStroma * (0.65 + 0.5 * cn) * (1.0 - 0.55 * smoothstep(0.62, 0.82, cnF));
  float inMus = 1.0 - smoothstep(sMus - 0.03, sMus + 0.03, sD);
  vec3 col = mix(strom, musc, inMus);
  // vascular cores of the processes (dark red capillary tufts)
  float procCore = smoothstep(0.35, 0.6, sCrest) * smoothstep(sTot - 0.55, sTot - 0.25, sD) * (1.0 - smoothstep(sTot - 0.12, sTot - 0.06, sD));
  col = mix(col, uBlood * (1.0 + 0.8 * cnF), procCore * 0.75);
  // major arterial circle, in the stroma just behind the iris root: a soft lumen (blood core, pale wall)
  float macR = length(vec2(length(vPL.xy) - uMAC.x, vPL.z - uMAC.y)) / uMAC.z;
  float wall = smoothstep(1.25, 0.95, macR);
  col = mix(col, uVesWall * (0.8 + 0.3 * cnF), wall * 0.9);
  col = mix(col, uBlood * (0.8 + 0.4 * cn), smoothstep(0.78, 0.5, macR));
  // epithelium: pigmented (black) + non-pigmented (pale) double layer on the inner surface
  float epiP = smoothstep(sTot - 0.075, sTot - 0.05, sD) * (1.0 - smoothstep(sTot - 0.03, sTot - 0.018, sD));
  float epiN = smoothstep(sTot - 0.022, sTot - 0.012, sD);
  col = mix(col, uPig * 0.35, epiP);
  col = mix(col, vec3(0.2, 0.15, 0.12), epiN * 0.8);
  diffuseColor.rgb = col;
  float cRough = 0.8 - 0.1 * inMus;
  float cH = fibre * inMus * 0.8 + cnF * 0.3;
  float cBumpAmp = 0.005;
  float cCoat = 0.0;
  float cSpec = 0.25;
  // section illumination: a little self-light (plus a view-facing lift in the emissive chunk) so the cut reads
  vec3 cEmit = col * 0.1;
  if (uVessels > 0.001) cEmit += uGlowA * uVessels * (procCore * 0.6 + smoothstep(1.0, 0.5, macR) * 1.2) * (0.6 + 0.8 * pulseAt(0.0));
`;

export function buildSectionCaps(uniforms, K = 8) {
  const rows = ciliaryRows().filter(r => r.kind !== 'out');
  const NR = rows.length;
  const nV = 2 * NR * K;
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), sec = new Float32Array(nV * 4);
  const idx = [];
  for (let c = 0; c < 2; c++) for (let j = 0; j < NR - 1; j++) for (let k = 0; k < K - 1; k++) {
    const a = c * NR * K + j * K + k, b = a + 1, d = a + K, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aSec', new THREE.BufferAttribute(sec, 4));
  g.setIndex(idx);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide, emissive: 0x000000 });
  mat.userData.uniforms = uniforms;
  patch(mat, 'eye-ciliary-cap-v2', {
    vertexAttr: 'attribute vec4 aSec;',
    vertexAssign: 'vCB = aSec; vPL = position;',
    surf: CAP_SURF, bump: BUMP, cut: 'if (uCut < 0.001) discard;',
    rough: 'roughnessFactor = cRough;',
    emit: 'totalEmissiveRadiance += cEmit + diffuseColor.rgb * 0.28 * abs(dot(normalize(vViewPosition), normal));',
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'ciliary-section';
  mesh.visible = false;
  mesh.frustumCulled = false;

  const v = new THREE.Vector3();
  function update(az1, az2) {
    let o = 0;
    for (let c = 0; c < 2; c++) {
      const az = c === 0 ? az1 : az2;
      const sgn = c === 0 ? 1 : -1;       // normals point into the opened gap
      const nx = -Math.sin(az) * sgn, ny = Math.cos(az) * sgn;
      for (let j = 0; j < NR; j++) {
        const e = evalRow(rows[j], az);
        for (let k = 0; k < K; k++) {
          const f = k / (K - 1);
          const d = e.d * f;
          const [rho, zz] = merPoint(e.t, d);
          v.set(rho * Math.cos(az), rho * Math.sin(az), zz);
          pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
          nor[o * 3] = nx; nor[o * 3 + 1] = ny; nor[o * 3 + 2] = 0;
          sec[o * 4] = e.t; sec[o * 4 + 1] = d; sec[o * 4 + 2] = e.d; sec[o * 4 + 3] = e.crest;
          o++;
        }
      }
    }
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.attributes.aSec.needsUpdate = true;
    g.computeBoundingSphere();
  }
  update(2.0, 2.8);
  return { mesh, update };
}

// (t, d) of the major arterial circle in the meridional coordinates (for probes / labels)
export function macSection() { return merInverse(MAC.r, MAC.z); }
