// Ophthalmic artery (orbital course and branches) and the central retinal artery / vein inside the optic nerve.
import * as THREE from 'three';
import { EYE } from '../../config.js';
import { nerveFrame, pcaSeams, craEntry, rectusBelly, PCA_SEAM_B } from './landmarks.js';
import { PathSet, spline, radiiArray, lerp, endDist, polyLength, meander } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// index of the sample of `pts` nearest to q
function nearestIndex(pts, q) { let bi = 0, bd = 1e9; pts.forEach((p, i) => { const d = p.distanceToSquared(q); if (d < bd) { bd = d; bi = i; } }); return bi; }

export function buildOphthalmic() {
  const nf = nerveFrame();
  const Lz = nf.lengthToApex;
  const P = (b, m, n) => nf.off(b, m, n);
  const oa = new PathSet();
  const sp = 0.12;

  // Trunk: leaves the optic canal inferolateral to the nerve, runs forward on its lateral side,
  // crosses ABOVE the nerve from lateral to medial, then runs forward along the medial wall
  // between the medial rectus and the superior oblique (cut end: continues as supratrochlear / dorsal nasal).
  const trunkCtrl = [
    P(Lz + 2.2, -1.6, -1.35),
    P(Lz - 1.0, -2.55, -1.15),
    P(Lz - 4.5, -3.05, -0.35),
    P(Lz - 8.0, -3.25, 0.7),
    P(Lz - 11.0, -2.55, 2.45),
    P(Lz - 13.2, -0.7, 3.35),
    P(Lz - 15.2, 1.55, 3.1),
    P(Lz - 17.0, 3.4, 2.7),
    V(10.4, 4.9, -21.0),
    V(11.8, 5.9, -16.2),
    V(12.6, 6.6, -11.0),
    V(13.1, 7.3, -6.4),
  ];
  const trunkPts = spline(trunkCtrl, sp);
  const trunk = oa.add(trunkPts, radiiArray(u => lerp(0.7, 0.5, Math.pow(u, 0.8)), 16), 0, { dist0: 0, cap0: true, cap1: true, tag: 'trunk' });
  const onTrunk = q => nearestIndex(trunkPts, q);

  const branch = (fromQ, ctrl, r0, r1, opts = {}) => {
    const at = onTrunk(fromQ);
    const pts = spline([trunkPts[at], ...ctrl], sp);
    return oa.add(pts, radiiArray(u => lerp(r0, r1, u), 10), 0, { parent: opts.parent || trunk, at, cap1: opts.cap !== false, tag: opts.tag });
  };
  const branchFrom = (parent, fromQ, ctrl, r0, r1, opts = {}) => {
    const at = nearestIndex(parent.points, fromQ);
    const pts = spline([parent.points[at], ...ctrl], sp);
    return oa.add(pts, radiiArray(u => lerp(r0, r1, u), 10), 0, { parent, at, cap1: opts.cap !== false, tag: opts.tag });
  };

  // 1. Central retinal artery: first branch, runs forward under the nerve (adherent to the dura),
  //    swinging from inferolateral to inferomedial, and pierces the sheath ~11 mm behind the globe.
  const cra = craEntry();
  const craCtrl = [];
  for (let b = Lz - 3.6; b > EYE.craEntryBehindGlobe + 0.6; b -= 2.2) {
    const t = (Lz - 3.6 - b) / (Lz - 3.6 - EYE.craEntryBehindGlobe);
    const ang = lerp(-Math.PI * 0.78, -Math.PI * 0.36, Math.pow(t, 0.9));
    craCtrl.push(nf.ring(b, ang, nf.sheathR + 0.2));
  }
  craCtrl.push(cra.art);
  const craBranch = branch(P(Lz - 2.4, -2.3, -1.4), craCtrl, 0.14, 0.125, { cap: false, tag: 'cra' });

  // 2. Inferior (medial) muscular trunk -> inferior rectus, medial rectus (and on to the inferior oblique).
  const infMus = branch(P(Lz - 3.4, -2.2, -1.5), [P(Lz - 5.5, -1.0, -3.6), P(Lz - 7.8, 0.6, -5.2)], 0.26, 0.22, { cap: false, tag: 'mus-inf' });
  branchFrom(infMus, infMus.points[infMus.points.length - 1], [rectusBelly('inferior', 0.36).p.clone().add(V(0.4, 1.0, 0)), rectusBelly('inferior', 0.45).p.clone().add(V(0.2, 1.0, 0))], 0.2, 0.15, { tag: 'mus-IR' });
  branchFrom(infMus, infMus.points[Math.floor(infMus.points.length * 0.7)], [P(Lz - 9.0, 3.6, -3.2), rectusBelly('medial', 0.34).p.clone().add(V(-1.0, -0.8, 0)), rectusBelly('medial', 0.42).p.clone().add(V(-1.0, -0.8, 0))], 0.17, 0.13, { tag: 'mus-MR' });

  // 3. Lateral posterior ciliary artery trunk (continues in the posterior-ciliary part).
  const seams = pcaSeams();
  const lpcCtrl = [];
  for (let b = Lz - 6.8; b > PCA_SEAM_B + 1.2; b -= 2.4) lpcCtrl.push(nf.off(b, -(nf.sheathR + 0.34), 0.25));
  lpcCtrl.push(seams.lateral);
  const lpc = branch(P(Lz - 5.8, -3.1, -0.1), lpcCtrl, 0.23, 0.2, { cap: false, tag: 'pca-lat' });

  // 4. Lacrimal artery (cut): laterally and forward along the upper border of the lateral rectus.
  const lacr0 = P(Lz - 8.8, -3.25, 0.9);
  branch(lacr0, [lacr0.clone().add(V(-2.6, 1.6, 2.8)), lacr0.clone().add(V(-5.0, 2.8, 6.2)), lacr0.clone().add(V(-6.6, 3.4, 9.2))], 0.3, 0.26, { tag: 'lacrimal' });

  // 5. Lateral (superior) muscular trunk -> lateral rectus, superior rectus (+ levator / superior oblique).
  const latMus0 = P(Lz - 10.2, -2.9, 1.9);
  const latMus = branch(latMus0, [latMus0.clone().add(V(-1.2, 1.5, 2.2)), latMus0.clone().add(V(-2.0, 2.2, 4.2))], 0.24, 0.2, { cap: false, tag: 'mus-lat' });
  const lm1 = latMus.points[latMus.points.length - 1];
  branchFrom(latMus, lm1, [rectusBelly('lateral', 0.4).p.clone().add(V(1.1, 1.0, 0)), rectusBelly('lateral', 0.5).p.clone().add(V(1.0, 0.6, 0))], 0.17, 0.13, { tag: 'mus-LR' });
  branchFrom(latMus, lm1, [lm1.clone().add(V(1.0, 2.2, 1.6)), rectusBelly('superior', 0.44).p.clone().add(V(-0.6, -1.0, 0)), rectusBelly('superior', 0.52).p.clone().add(V(-0.6, -1.0, 0))], 0.17, 0.13, { tag: 'mus-SR' });

  // 6. Supraorbital artery (cut): leaves the trunk as it crosses the nerve, climbs towards the roof.
  const so0 = P(Lz - 13.2, -0.7, 3.4);
  branch(so0, [so0.clone().add(V(-0.4, 2.4, 1.6)), so0.clone().add(V(-0.6, 4.6, 4.2)), so0.clone().add(V(-0.4, 6.0, 7.4))], 0.24, 0.22, { tag: 'supraorbital' });

  // 7. Medial posterior ciliary artery trunk (continues in the posterior-ciliary part).
  const mpcCtrl = [];
  for (let b = Lz - 17.4; b > PCA_SEAM_B + 1.6; b -= 2.4) mpcCtrl.push(nf.off(b, nf.sheathR + 0.34, 0.6));
  mpcCtrl.push(seams.medial);
  const mpc = branch(P(Lz - 16.2, 2.6, 3.0), mpcCtrl, 0.23, 0.2, { cap: false, tag: 'pca-med' });

  // 8. Posterior and anterior ethmoidal arteries (cut): medially towards the ethmoidal foramina.
  const pe0 = V(11.0, 5.3, -19.0);
  branch(pe0, [pe0.clone().add(V(2.0, 0.6, 0.4)), pe0.clone().add(V(4.4, 1.0, 1.0))], 0.19, 0.17, { tag: 'post-ethmoidal' });
  const ae0 = V(12.7, 6.7, -10.2);
  branch(ae0, [ae0.clone().add(V(1.8, 0.2, 0.8)), ae0.clone().add(V(3.8, 0.1, 1.6))], 0.2, 0.18, { tag: 'ant-ethmoidal' });

  const out = {
    paths: oa.paths,
    craEnd: { point: cra.art.clone(), dist: endDist(craBranch) },
    pcaLat: { point: seams.lateral.clone(), dist: endDist(lpc) },
    pcaMed: { point: seams.medial.clone(), dist: endDist(mpc) },
    muscularDist: endDist(latMus) + 12,
  };
  return out;
}

// Central retinal artery and vein inside the optic nerve, from the inferomedial sheath to the disc.
export function buildCentralRetinal({ craStart, craDist0, rootA, rootV, rootR }) {
  const nf = nerveFrame();
  const cra = craEntry();
  const set = new PathSet();
  const sp = 0.08;
  const bE = EYE.craEntryBehindGlobe;
  const a = cra.angle;

  // artery: pierces the sheath and the pia obliquely, reaches the axis, then runs forward just nasal of it
  const artCtrl = [craStart, nf.ring(bE - 0.55, a, 1.35), nf.ring(bE - 1.3, a, 0.55), nf.off(bE - 2.3, 0.2, -0.05)];
  for (let b = bE - 4.0; b > 1.2; b -= 2.0) artCtrl.push(nf.off(b, 0.17 + 0.03 * Math.sin(b), 0.02 * Math.cos(b * 1.3)));
  // through the lamina cribrosa it drifts onto its emergence point and meets the retinal tree root (which sits
  // 0.34 mm under the cup floor) heading straight up the axis, so the fillet onto the floor is continuous
  artCtrl.push(nf.off(0.9, 0.12, 0.04), rootA.clone().addScaledVector(rootA.clone().normalize(), 0.55), rootA.clone().addScaledVector(rootA.clone().normalize(), 0.2), rootA);
  const artPts = spline(artCtrl, sp);
  const artery = set.add(artPts, radiiArray(u => lerp(0.125, rootR.art, Math.min(1, u * 3)), 12), 0, { dist0: craDist0, tag: 'cra' });

  // vein: authored from its (cut) drainage end back in the orbit, runs forward under the nerve, enters beside the artery
  const vBack = 21.0;
  const vCtrl = [nf.ring(vBack, -Math.PI * 0.55, nf.sheathR + 0.28), nf.ring(vBack - 3.5, -Math.PI * 0.5, nf.sheathR + 0.26), nf.ring(bE + 2.4, a - 0.3, nf.sheathR + 0.24), cra.vein,
    nf.ring(bE + 0.25, a - 0.32, 1.3), nf.ring(bE - 0.5, a - 0.3, 0.55), nf.off(bE - 1.6, -0.2, -0.08)];
  for (let b = bE - 3.2; b > 1.2; b -= 2.0) vCtrl.push(nf.off(b, -0.19 - 0.03 * Math.sin(b * 1.1), -0.02 * Math.cos(b)));
  vCtrl.push(nf.off(0.9, -0.2, 0.0), rootV.clone().addScaledVector(rootV.clone().normalize(), 0.55), rootV.clone().addScaledVector(rootV.clone().normalize(), 0.2), rootV);
  const vPts = spline(vCtrl, sp);
  const vein = set.add(vPts, radiiArray(u => lerp(0.175, rootR.vein, Math.min(1, u * 2.2)), 12), 1, { dist0: 0, cap0: true, tag: 'crv' });

  return { paths: set.paths, artEnd: endDist(artery), veinEnd: endDist(vein), entry: cra.art.clone() };
}
