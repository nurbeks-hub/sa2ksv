// Section planes (sagittal / axial / coronal) with proper stencil caps.
// The plane is defined in the head's rest (rig-local) space so breathing / micro-turns never make the cut
// swim. One THREE.Plane is shared by every material's clippingPlanes array; when the section is off the plane
// is parked far away (one clipping plane is always compiled in, so toggling never recompiles shaders).
// Caps: for each tissue cap group, in CAP_ORDER, the group's closed meshes are drawn twice into the stencil
// buffer (back faces +1, front faces −1, depth test off) and then a flat plate on the plane fills every
// pixel with a non-zero count in the tissue colour, resetting the stencil for the next group. Inner groups
// come later and overwrite outer ones at equal depth (grey → white matter → deep nuclei → CSF; bone → air).
import * as THREE from 'three';
import { CAP_ORDER, CAP_COLOR } from './classify.js';
import { patchCap, U } from './shader.js';
import { stencilBack, stencilFront } from './model.js';

export const CENTER = new THREE.Vector3(0, 1.575, -0.005);
const AX = {
  sagittal: { e: new THREE.Vector3(1, 0, 0), base: 0.0, min: -0.06, max: 0.06, u: new THREE.Vector3(0, 0, 1), v: new THREE.Vector3(0, 1, 0) },
  axial: { e: new THREE.Vector3(0, 1, 0), base: 0.05, min: -0.11, max: 0.11, u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1) },
  coronal: { e: new THREE.Vector3(0, 0, 1), base: 0.015, min: -0.06, max: 0.085, u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0) },
};
const CAP_BASE = -2000;

export function createSection({ rig, scene }) {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1000);
  const clip = [plane];
  const state = { axis: null, sign: 1, offset: 0, on: 0 };   // sign: which side is removed (+1 → the +e side)
  const rigInv = new THREE.Matrix4();
  const localPlane = new THREE.Plane();
  const P0local = new THREE.Vector3(), P0world = new THREE.Vector3(), Nworld = new THREE.Vector3();

  // ---- cap plates (one per cap group)
  const caps = [];
  const capGeo = new THREE.PlaneGeometry(0.62, 0.62);
  CAP_ORDER.forEach((name, i) => {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(CAP_COLOR[name]), roughness: name === 'csf' ? 0.25 : 0.72, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.35 });
    m.userData.inv = rigInv;
    m.stencilWrite = true; m.stencilRef = 0; m.stencilFunc = THREE.NotEqualStencilFunc;
    m.stencilFail = THREE.ZeroStencilOp; m.stencilZFail = THREE.ZeroStencilOp; m.stencilZPass = THREE.ZeroStencilOp;
    m.depthFunc = THREE.LessEqualDepth;
    patchCap(m, name);
    const mesh = new THREE.Mesh(capGeo, m);
    mesh.renderOrder = CAP_BASE + i * 3 + 2;
    mesh.frustumCulled = false; mesh.visible = false; mesh.name = 'cap:' + name;
    scene.add(mesh);
    caps.push({ name, mesh, used: false });
  });

  // ---- stencil passes for a renderable (main mesh) with a cap group
  const stencils = [];
  function addStencil(mainMesh, capName) {
    const i = CAP_ORDER.indexOf(capName);
    if (i < 0) return;
    const b = new THREE.Mesh(mainMesh.geometry, stencilBack), f = new THREE.Mesh(mainMesh.geometry, stencilFront);
    for (const s of [b, f]) {
      s.renderOrder = CAP_BASE + i * 3 + (s === b ? 0 : 1);
      s.frustumCulled = false; s.visible = false; s.matrixAutoUpdate = false;
      s.userData.main = mainMesh;
      mainMesh.parent.add(s);
      s.position.copy(mainMesh.position); s.quaternion.copy(mainMesh.quaternion); s.updateMatrix();
      stencils.push(s);
    }
    caps[i].used = true;
  }

  // ---- glowing outline of the plane
  const outlineGeo = new THREE.BufferGeometry();
  outlineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(5 * 3), 3));
  const outline = new THREE.Line(outlineGeo, new THREE.LineBasicMaterial({ color: 0xf0b27a, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  outline.frustumCulled = false; outline.renderOrder = 10;
  scene.add(outline);

  function setAxis(axis, sign) {
    if (!axis) { state.axis = null; return; }
    if (state.axis !== axis) state.offset = AX[axis].base;
    state.axis = axis; state.sign = sign >= 0 ? 1 : -1;
  }
  function setOffset(o) { if (!state.axis) return; const a = AX[state.axis]; state.offset = THREE.MathUtils.clamp(o, a.min, a.max); }

  // world-space origin + normal of the (removed-side) axis — for the grip
  function gripInfo() { return { p: P0world.clone(), n: Nworld.clone(), axis: state.axis }; }

  function update(dt) {
    rig.updateMatrixWorld();
    rigInv.copy(rig.matrixWorld).invert();
    const target = state.axis ? 1 : 0;
    state.on += (target - state.on) * (1 - Math.exp(-dt * 6));
    if (Math.abs(target - state.on) < 0.002) state.on = target;
    U.uSecOn.value = state.on;
    if (!state.axis) {
      plane.normal.set(0, 1, 0); plane.constant = 1000;
      for (const c of caps) c.mesh.visible = false;
      for (const s of stencils) s.visible = false;
      outline.material.opacity = 0;
      return;
    }
    const a = AX[state.axis];
    P0local.copy(CENTER).addScaledVector(a.e, state.offset);
    const nk = a.e.clone().multiplyScalar(-state.sign);            // kept side normal
    localPlane.setFromNormalAndCoplanarPoint(nk, P0local);
    plane.copy(localPlane).applyMatrix4(rig.matrixWorld);
    P0world.copy(P0local).applyMatrix4(rig.matrixWorld);
    Nworld.copy(a.e).multiplyScalar(state.sign).transformDirection(rig.matrixWorld);
    // cap plates sit on the plane facing the removed side (the camera)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), Nworld);
    for (const c of caps) {
      c.mesh.visible = c.used;
      c.mesh.position.copy(P0world); c.mesh.quaternion.copy(q);
    }
    for (const s of stencils) s.visible = s.userData.main.visible;
    // outline rectangle
    const pos = outlineGeo.attributes.position;
    const hu = state.axis === 'axial' ? 0.13 : state.axis === 'coronal' ? 0.125 : 0.14, hv = state.axis === 'axial' ? 0.15 : 0.18;
    const cu = state.axis === 'sagittal' ? -0.005 : 0, cv = state.axis === 'axial' ? 0 : 0.0;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
    corners.forEach(([su, sv], k) => {
      const p = P0local.clone().addScaledVector(a.u, cu + su * hu).addScaledVector(a.v, cv + sv * hv);
      if (state.axis !== "axial") p.y = Math.max(p.y, 1.432);
      p.applyMatrix4(rig.matrixWorld);
      pos.setXYZ(k, p.x, p.y, p.z);
    });
    pos.needsUpdate = true;
    outline.material.opacity = 0.22 * state.on;
  }

  return { plane, clip, state, caps, stencils, addStencil, setAxis, setOffset, update, gripInfo, AX };
}
