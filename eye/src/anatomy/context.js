// The build context handed to every anatomy module: build(ctx) -> Part[]
//
// Part = {
//   id: string                     // must be one of the ids in src/parts.js
//   object: THREE.Object3D         // geometry in the ASSEMBLED pose, in the eye frame (mm)
//   pickables?: THREE.Mesh[]       // meshes for hover/click raycasts (may be invisible proxies)
//   anchor?: THREE.Vector3         // label anchor, local to object
//   focus?: { center: THREE.Vector3, radius: number }  // camera framing when inspected (local to object)
//   update?(frame)                 // per frame
//   setGhost?(ghost, highlight)    // optional custom ghosting (default: lib/materials.applyGhost)
// }
// frame = { time, dt, explode, vessels (0..1 glow), pupilR (mm), camera, ghost, highlight, inspect (bool) }
import * as THREE from 'three';
import { EYE, L, PALETTE } from '../config.js';
import * as materials from '../lib/materials.js';
import * as vessels from '../lib/vessels.js';
import * as am from '../lib/anatomyMath.js';

export function makeContext(extra = {}) {
  return { THREE, EYE, L, PALETTE, ...materials, vessels, am, quality: 'high', ...extra };
}

export const MODULE_LOADERS = {
  globe: () => import('./globe.js'),
  iris: () => import('./iris.js'),
  lens: () => import('./lens.js'),
  posterior: () => import('./posterior.js'),
  orbit: () => import('./orbit.js'),
  vasculature: () => import('./vasculature.js'),
};
