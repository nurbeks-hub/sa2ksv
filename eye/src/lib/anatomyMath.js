// Shared landmark math so every module agrees on where things are.
// Eye frame: +Z anterior, +Y superior, +X nasal (right eye). Globe centre at origin. Units: mm.
import * as THREE from 'three';
import { EYE, L } from '../config.js';

// Point on a sphere of radius r, given polar angle from the +Z (anterior) axis and azimuth
// (azimuth 0 = +X nasal, PI/2 = +Y superior, PI = temporal, 3PI/2 = inferior).
export function fromAnterior(polar, azimuth, r) {
  const s = Math.sin(polar);
  return new THREE.Vector3(s * Math.cos(azimuth) * r, s * Math.sin(azimuth) * r, Math.cos(polar) * r);
}

// Polar angle (from +Z) of the limbus on the scleral surface.
export const LIMBUS_POLAR = Math.asin(EYE.limbusR / L.scleraOuterR);

// Point on the outer scleral surface at a distance d (mm) posterior to the limbus, measured along the surface.
export function behindLimbus(d, azimuth, r = L.scleraOuterR) {
  return fromAnterior(LIMBUS_POLAR + d / L.scleraOuterR, azimuth, r);
}

// Retina map: azimuthal-equidistant projection centred on the posterior pole (fovea).
// Map coords (mx, my) in mm along the retinal surface: +mx = nasal, +my = superior.
// Returns a world point on a sphere of radius r (default: inner retinal surface).
export function retinaMap(mx, my, r = L.retinaInnerR) {
  const rho = Math.hypot(mx, my);
  const polarFromPost = rho / r;
  const az = Math.atan2(my, mx);
  const s = Math.sin(polarFromPost);
  return new THREE.Vector3(s * Math.cos(az) * r, s * Math.sin(az) * r, -Math.cos(polarFromPost) * r);
}
export function worldToRetinaMap(v, r = L.retinaInnerR) {
  const n = v.clone().normalize();
  const polarFromPost = Math.acos(THREE.MathUtils.clamp(-n.z, -1, 1));
  const az = Math.atan2(n.y, n.x);
  const rho = polarFromPost * r;
  return new THREE.Vector2(Math.cos(az) * rho, Math.sin(az) * rho);
}

// Key retinal landmarks in map coords (mm). Fovea at the pole, disc 4.4 mm nasal and slightly superior.
export const FOVEA_MAP = new THREE.Vector2(0, 0);
export const DISC_MAP = new THREE.Vector2(EYE.discFoveaDistance, 0.25);
// Ora serrata: anterior edge of the retina, ~6 mm (nasal) to ~7 mm (temporal) behind the limbus on the inner wall.
export function oraPolar(azimuth) {
  const d = 6.0 + 1.0 * (0.5 - 0.5 * Math.cos(azimuth)); // nasal (az=0) 6 mm, temporal 7 mm
  return LIMBUS_POLAR + d / L.scleraOuterR;
}

// Optic nerve centreline from the disc (exit at the back of the globe) to the optic canal (apex).
export function nerveCurve() {
  const exit = retinaMap(DISC_MAP.x, DISC_MAP.y, L.scleraOuterR + 0.2);
  const dir = exit.clone().normalize();
  const apex = new THREE.Vector3(...EYE.nerveApex);
  const c1 = exit.clone().add(dir.clone().multiplyScalar(6));
  const c2 = new THREE.Vector3(exit.x * 0.6 + apex.x * 0.4 - 1.5, exit.y * 0.6 + apex.y * 0.4 + 1.0, THREE.MathUtils.lerp(exit.z, apex.z, 0.45));
  const c3 = new THREE.Vector3(apex.x - 0.8, apex.y, apex.z + 8);
  return new THREE.CatmullRomCurve3([exit.clone().sub(dir.clone().multiplyScalar(1.2)), exit, c1, c2, c3, apex], false, 'centripetal');
}

// Rectus muscle insertion: centre point, tangent (posterior direction along the surface) and width.
export function rectusInsertion(name) {
  const m = EYE.recti[name];
  const az = Math.atan2(m.dir[1], m.dir[0]);
  const centre = behindLimbus(m.fromLimbus, az);
  const aheadPolar = LIMBUS_POLAR + m.fromLimbus / L.scleraOuterR;
  const back = fromAnterior(aheadPolar + 0.05, az, L.scleraOuterR).sub(centre).normalize();
  return { azimuth: az, centre, back, width: m.width, polar: aheadPolar };
}

// Origin of a rectus on the annulus of Zinn (ring around the optic canal).
export function annulusPoint(azimuth) {
  const apex = new THREE.Vector3(...EYE.nerveApex);
  return apex.add(new THREE.Vector3(Math.cos(azimuth) * EYE.annulusR, Math.sin(azimuth) * EYE.annulusR, 0));
}

// Insertions of the obliques (posterior, behind the equator).
export const SUPERIOR_OBLIQUE_INSERTION = fromAnterior(THREE.MathUtils.degToRad(112), THREE.MathUtils.degToRad(118), L.scleraOuterR);
export const INFERIOR_OBLIQUE_INSERTION = fromAnterior(THREE.MathUtils.degToRad(128), THREE.MathUtils.degToRad(196), L.scleraOuterR);

// Vortex vein exits: four, one per quadrant, a few mm behind the equator.
export const VORTEX_EXITS = [45, 135, 225, 315].map(a => fromAnterior(THREE.MathUtils.degToRad(90 + 16), THREE.MathUtils.degToRad(a), L.scleraOuterR));
