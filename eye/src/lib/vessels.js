// Vessel toolkit shared by every module that draws blood vessels.
//  - buildTubes(paths): merges many polylines into ONE BufferGeometry of tubes with flow attributes.
//  - vesselMaterial(): lit tube shader with arterial/venous colour, ghost/highlight, and a "vessels mode"
//    glow where pulses travel along the vessel in the direction of blood flow.
//
// A path is { points: Vector3[], radii: number[] | number, kind: 0 (artery) | 1 (vein) | 2 (capillary),
//             dist0?: number (mm of path length already travelled from the heart side, for continuous flow) }
// Flow direction: arteries flow from points[0] to the end, veins flow from the end back to points[0]
// (i.e. always author paths from the trunk outwards; the shader reverses veins).
import * as THREE from 'three';
import { PALETTE } from '../config.js';

export function buildTubes(paths, { radial = 7, minRadial = 4, lengthStep = 0.35 } = {}) {
  const pos = [], nor = [], dist = [], kind = [], rad = [], idx = [];
  const tmpT = new THREE.Vector3(), tmpN = new THREE.Vector3(), tmpB = new THREE.Vector3(), prevN = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let base = 0;
  for (const p of paths) {
    const pts = resample(p.points, lengthStep);
    if (pts.length < 2) continue;
    const radiiIn = Array.isArray(p.radii) ? p.radii : null;
    const n = pts.length;
    const r0 = radiiIn ? radiiIn[0] : p.radii;
    const seg = Math.max(minRadial, Math.min(radial, Math.round(3 + r0 * 40)));
    let d = p.dist0 || 0;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      tmpT.subVectors(b, a).normalize();
      if (i === 0) {
        tmpN.copy(Math.abs(tmpT.dot(up)) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).cross(tmpT).normalize();
      } else {
        // parallel transport
        tmpN.copy(prevN).sub(tmpB.copy(tmpT).multiplyScalar(prevN.dot(tmpT))).normalize();
      }
      prevN.copy(tmpN);
      tmpB.crossVectors(tmpT, tmpN).normalize();
      if (i > 0) d += pts[i].distanceTo(pts[i - 1]);
      const u = i / (n - 1);
      const r = radiiIn ? sampleArr(radiiIn, u) : p.radii * (1 - 0.35 * u);
      for (let j = 0; j < seg; j++) {
        const ang = (j / seg) * Math.PI * 2;
        const cx = Math.cos(ang), sy = Math.sin(ang);
        const nx = tmpN.x * cx + tmpB.x * sy, ny = tmpN.y * cx + tmpB.y * sy, nz = tmpN.z * cx + tmpB.z * sy;
        pos.push(pts[i].x + nx * r, pts[i].y + ny * r, pts[i].z + nz * r);
        nor.push(nx, ny, nz);
        dist.push(d); kind.push(p.kind || 0); rad.push(r);
      }
      if (i > 0) {
        const r0i = base + (i - 1) * seg, r1i = base + i * seg;
        for (let j = 0; j < seg; j++) {
          const j1 = (j + 1) % seg;
          idx.push(r0i + j, r1i + j, r0i + j1, r0i + j1, r1i + j, r1i + j1);
        }
      }
    }
    base += n * seg;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setAttribute('aRadius', new THREE.Float32BufferAttribute(rad, 1));
  g.setIndex(base > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

function sampleArr(arr, u) {
  const f = u * (arr.length - 1), i = Math.floor(f), t = f - i;
  return i >= arr.length - 1 ? arr[arr.length - 1] : arr[i] * (1 - t) + arr[i + 1] * t;
}

export function resample(points, step) {
  if (points.length < 2) return points.map(p => p.clone());
  const out = [points[0].clone()];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const L = a.distanceTo(b);
    let t = step - carry;
    while (t < L) { out.push(new THREE.Vector3().lerpVectors(a, b, t / L)); t += step; }
    carry = L - (t - step);
  }
  const last = points[points.length - 1];
  if (out[out.length - 1].distanceTo(last) > step * 0.3) out.push(last.clone()); else out[out.length - 1].copy(last);
  return out;
}

// Catmull-Rom smoothing of a sparse control polyline.
export function smoothPath(ctrl, samplesPerSeg = 8) {
  if (ctrl.length < 3) return ctrl;
  const c = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  return c.getPoints(ctrl.length * samplesPerSeg);
}

export function vesselMaterial({ artery = PALETTE.artery, vein = PALETTE.vein, capillary = 0x8a2a3a, opacity = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uGlow: { value: 0 }, uGhost: { value: 0 }, uHighlight: { value: 0 },
      uArtery: { value: new THREE.Color(artery) }, uVein: { value: new THREE.Color(vein) }, uCap: { value: new THREE.Color(capillary) },
      uArteryGlow: { value: new THREE.Color(PALETTE.arteryGlow) }, uVeinGlow: { value: new THREE.Color(PALETTE.veinGlow) },
      uKey: { value: new THREE.Vector3(-0.4, 0.55, 0.7).normalize() }, uOpacity: { value: opacity },
      uPulse: { value: 1.0 },
    },
    vertexShader: /* glsl */`
      attribute float aDist; attribute float aKind; attribute float aRadius;
      varying vec3 vN; varying vec3 vV; varying float vDist; varying float vKind; varying float vRad;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        vDist = aDist; vKind = aKind; vRad = aRadius;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uGlow, uGhost, uHighlight, uOpacity, uPulse;
      uniform vec3 uArtery, uVein, uCap, uArteryGlow, uVeinGlow, uKey;
      varying vec3 vN; varying vec3 vV; varying float vDist; varying float vKind; varying float vRad;
      void main() {
        vec3 n = normalize(vN);
        float isVein = step(0.5, vKind) * (1.0 - step(1.5, vKind));
        float isCap = step(1.5, vKind);
        vec3 base = mix(mix(uArtery, uVein, isVein), uCap, isCap);
        vec3 keyV = normalize((viewMatrix * vec4(uKey, 0.0)).xyz);
        float diff = max(dot(n, keyV), 0.0) * 0.75 + 0.25;
        float fres = pow(1.0 - max(dot(n, normalize(vV)), 0.0), 2.5);
        float spec = pow(max(dot(reflect(-keyV, n), normalize(vV)), 0.0), 40.0) * 0.5;
        vec3 col = base * diff + spec + base * fres * 0.6;
        // Flow: arteries pulse outward, veins return. Pulses spaced ~6 mm, speed scaled by calibre.
        float dir = mix(1.0, -1.0, isVein);
        float speed = mix(9.0, 4.5, isVein) * uPulse;
        float ph = fract(vDist / 6.0 - dir * uTime * speed / 6.0);
        float pulse = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.08, 0.45, ph));
        vec3 glowC = mix(uArteryGlow, uVeinGlow, isVein);
        col = mix(col, glowC * (0.55 + 1.6 * pulse) + glowC * fres * 0.9, uGlow);
        col += vec3(0.85, 1.0, 0.25) * uHighlight * (0.35 + fres);
        float a = uOpacity * (1.0 - 0.96 * uGhost);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: opacity < 1,
  });
}
