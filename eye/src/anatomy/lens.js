// Module "lens": the crystalline lens, the zonules of Zinn and the ciliary body (right eye, eye frame, mm).
// Draw calls: lens (1, ray-marched volume), zonules (1, ribbons), ciliary ring (1), section caps (1, only
// while the cutaway is open). Pick proxies are invisible low-poly lathes.
import * as THREE from 'three';
import { buildLensMesh, updateLightFrames } from './lens/lensCrystal.js';
import { buildZonules } from './lens/zonules.js';
import { buildCiliaryRing, buildSectionCaps, makeCiliaryUniforms } from './lens/ciliary.js';
import { LENS, lensOutline, cbPoint, evalRow, ciliaryRows, surfaceDepth, merPoint, CB, lensSurfacePoint, lensPolarPoint } from './lens/profile.js';

const DEFAULT_LIGHTS = [
  { dir: new THREE.Vector3(-40, 55, 70).normalize(), col: new THREE.Color(0xfff1e0).multiplyScalar(1.55) },
  { dir: new THREE.Vector3(60, 20, -80).normalize(), col: new THREE.Color(0x9fc4ff).multiplyScalar(1.25) },
  { dir: new THREE.Vector3(10, -60, 20).normalize(), col: new THREE.Color(0xff9a7a).multiplyScalar(0.35) },
];

// Reads the stage's directional lights (world space) so the custom shaders stay in sync with the rig.
function makeLightProbe() {
  let scene = null, lights = null;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const out = DEFAULT_LIGHTS.map(l => ({ dir: l.dir.clone(), col: l.col.clone() }));
  return function probe(sc) {
    if (sc !== scene) {
      scene = sc; lights = [];
      sc.traverse(o => { if (o.isDirectionalLight) lights.push(o); });
      lights = lights.slice(0, 3);
    }
    for (let i = 0; i < 3; i++) {
      const l = lights[i];
      if (!l) { out[i].dir.copy(DEFAULT_LIGHTS[i].dir); out[i].col.setRGB(0, 0, 0); continue; }
      a.setFromMatrixPosition(l.matrixWorld); b.setFromMatrixPosition(l.target.matrixWorld);
      out[i].dir.subVectors(a, b).normalize();
      out[i].col.copy(l.color).multiplyScalar(l.intensity * (l.visible ? 1 : 0));
    }
    return out;
  };
}

function lathe(points, segments = 48) {
  const g = new THREE.LatheGeometry(points.map(([r, z]) => new THREE.Vector2(Math.max(0, r), z)), segments);
  g.rotateX(Math.PI / 2);    // lathe axis Y -> eye axis Z  (point (r, z) -> (r, 0, z))
  return g;
}
function proxy(geom, side = THREE.FrontSide) {
  const m = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ visible: false, side }));
  m.name = 'pick-proxy';
  return m;
}

export function build(ctx) {
  const probe = makeLightProbe();
  const drawSize = new THREE.Vector2();
  const invM = new THREE.Matrix4();
  const dbg = () => (globalThis.__lensDebug || {});

  // ---------------------------------------------------------------- lens
  const lens = buildLensMesh();
  // the part object stays at the eye origin (robust to any explode convention); the lens-local frame
  // (origin at the equatorial centre) is an inner pivot
  const lensObj = new THREE.Group(); lensObj.name = 'lens';
  const lensPivot = new THREE.Group(); lensPivot.name = 'lens-pivot';
  lensPivot.position.set(0, 0, LENS.z0);
  lensObj.add(lensPivot);
  lensPivot.add(lens.mesh);
  const outline = lensOutline(32);
  const lensProxy = proxy(lathe(outline.map((p, i) => [i === 0 || i === outline.length - 1 ? 0 : p.rho + 0.02, p.z * 1.01]), 40), THREE.DoubleSide);
  lensPivot.add(lensProxy);
  lens.mesh.onBeforeRender = (renderer, scene, camera) => {
    const u = lens.uniforms;
    invM.copy(lens.mesh.matrixWorld).invert();
    u.uCamL.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(invM);
    const L = probe(scene);
    for (let i = 0; i < 3; i++) { u.uLDir.value[i].copy(L[i].dir).transformDirection(invM); u.uLCol.value[i].copy(L[i].col); }
    updateLightFrames(u);
    renderer.getDrawingBufferSize(drawSize);
    const fov = camera.isPerspectiveCamera ? THREE.MathUtils.degToRad(camera.fov) : 0.5;
    u.uPixAng.value = (2 * Math.tan(fov / 2)) / Math.max(1, drawSize.y);
  };

  // ---------------------------------------------------------------- zonules
  const zon = buildZonules();
  const zonObj = new THREE.Group(); zonObj.name = 'zonules';
  zonObj.add(zon.mesh);
  // pick proxy: the triangular ring of the circumlental space (canal of Petit) + the fibres on the pars plana
  const zp = [
    [LENS.Re - 1.35, LENS.z0 + 0.95], [5.3, 8.75], [6.9, 8.0], [8.4, 6.9], [8.2, 6.6], [6.4, 7.0],
    [LENS.Re - 1.25, LENS.z0 - 1.3], [LENS.Re + 0.05, LENS.z0], [LENS.Re - 1.35, LENS.z0 + 0.95],
  ];
  zonObj.add(proxy(lathe(zp, 48), THREE.DoubleSide));
  zon.mesh.onBeforeRender = (renderer, scene) => {
    const L = probe(scene);
    for (let i = 0; i < 3; i++) { zon.uniforms.uLDir.value[i].copy(L[i].dir); zon.uniforms.uLCol.value[i].copy(L[i].col); }
    renderer.getDrawingBufferSize(drawSize);
    zon.uniforms.uViewH.value = Math.max(1, drawSize.y);
  };

  // ---------------------------------------------------------------- ciliary body
  const cu = makeCiliaryUniforms();
  const ring = buildCiliaryRing(cu);
  const caps = buildSectionCaps(cu);
  const cbObj = new THREE.Group(); cbObj.name = 'ciliary-body';
  cbObj.add(ring, caps.mesh);
  // pick proxy: envelope through the crests of the processes
  {
    const rows = ciliaryRows();
    const az = CB.P * 0.5;
    const pts = [];
    for (let j = 0; j < rows.length; j += 2) {
      const e = evalRow(rows[j], az);
      const d = rows[j].kind === 'out' ? -0.02 : e.d + 0.03;
      pts.push(merPoint(e.t, Math.max(e.d, d)));
    }
    pts.push(pts[0]);
    cbObj.add(proxy(lathe(pts, 72), THREE.DoubleSide));
  }
  let cutAmt = 0, cutAz = 2.35, camAz = 2.35, cutHold = 0, lastCutKey = '';
  const camL = new THREE.Vector3();
  const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

  const tHead = 0.6, azA = THREE.MathUtils.degToRad(118);
  const anchorCB = cbPoint(tHead, surfaceDepth(tHead, azA) + 0.05, azA);
  const azZ = THREE.MathUtils.degToRad(128);
  const anchorZon = cbPoint(0.6, surfaceDepth(0.6, azZ), azZ).add(lensPolarPoint(Math.PI / 2, azZ)).multiplyScalar(0.5);
  const anchorLens = lensSurfacePoint(3.2, true, THREE.MathUtils.degToRad(125), 0.05);

  return [
    {
      id: 'lens',
      object: lensObj,
      pickables: [lensProxy],
      anchor: anchorLens,
      focus: { center: new THREE.Vector3(0, 0, LENS.z0 - 0.3), radius: 6.2 },
      update(frame) {
        lens.uniforms.uDim.value = frame.vessels || 0;
      },
    },
    {
      id: 'zonules',
      object: zonObj,
      pickables: zonObj.children.filter(c => c.name === 'pick-proxy'),
      anchor: anchorZon,
      focus: { center: new THREE.Vector3(0, 0, LENS.z0), radius: 8.5 },
      update(frame) {
        zon.uniforms.uDim.value = frame.vessels || 0;
      },
    },
    {
      id: 'ciliary-body',
      object: cbObj,
      pickables: cbObj.children.filter(c => c.name === 'pick-proxy'),
      anchor: anchorCB,
      focus: { center: new THREE.Vector3(0, 0, 7.6), radius: 12 },
      update(frame) {
        cu.uTime.value = frame.time || 0;
        cu.uVessels.value = frame.vessels || 0;
        const d = dbg();
        const dt = frame.dt || 0.016;
        const ghost = frame.ghost || 0;
        // The cutaway belongs to the ciliary body's own inspection. main.js passes inspect as a boolean to every
        // part, so the part's own ghost tells whether it is the one inspected (another part's inspection ghosts it).
        // The condition must hold for a moment so the first frames of another part's ghost fade never open it.
        const cond = (frame.inspect === true || frame.inspect === 'ciliary-body') && ghost < 0.01;
        cutHold = cond ? cutHold + dt : 0;
        const want = d.cut != null ? d.cut : (cutHold > 0.2 ? 1 : 0);
        // track the camera azimuth (damped) while the cut is not fully open, so it follows the fly-to-inspect move
        if (frame.camera && (cutAmt < 0.999 || d.cut != null)) {
          camL.setFromMatrixPosition(frame.camera.matrixWorld);
          cbObj.worldToLocal(camL);
          const target = Math.hypot(camL.x, camL.y) > 2 ? Math.atan2(camL.y, camL.x) : 2.35;
          camAz = cutAmt < 0.001 ? target : wrapA(camAz + wrapA(target - camAz) * Math.min(1, dt * 4));
        }
        const k = d.cut != null ? 1 : Math.min(1, dt * (want < cutAmt && ghost > 0.5 ? 8 : 3.5));
        cutAmt += (want - cutAmt) * k;
        if (Math.abs(cutAmt - want) < 1e-3) cutAmt = want;
        const half = cutAmt * THREE.MathUtils.degToRad(d.cutHalfDeg || 48);
        // offset the wedge so the far section plane faces the camera (instead of both planes seen at grazing angles)
        cutAz = d.cutAz != null ? d.cutAz : wrapA(camAz + half * 0.85);
        cu.uCut.value = cutAmt; cu.uCutAz.value = cutAz; cu.uCutHalf.value = half;
        // the zonules share the cut only while the ciliary body itself is shown (never while they are inspected)
        const zc = ghost < 0.5 ? cutAmt : 0;
        zon.uniforms.uCut.value = zc; zon.uniforms.uCutAz.value = cutAz; zon.uniforms.uCutHalf.value = zc > 0 ? half : 0;
        caps.mesh.visible = cutAmt > 0.001 && (frame.ghost || 0) < 0.995;
        const key = `${cutAz.toFixed(4)}:${half.toFixed(4)}`;
        if (caps.mesh.visible && key !== lastCutKey) { caps.update(cutAz - half, cutAz + half); lastCutKey = key; }
      },
    },
  ];
}
