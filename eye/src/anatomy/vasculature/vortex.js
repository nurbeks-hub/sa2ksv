// Vortex veins: four ampullae in the outer choroid, one per quadrant just behind the equator, each collecting a
// whorl of choroidal tributaries (pinwheel primaries, then space colonization inside its drainage territory with
// a swirl near the ampulla), then draining through an oblique ~2.4 mm scleral canal to exit a few mm behind the
// equator (am.VORTEX_EXITS) and on, extrasclerally, to a cut end.
// Everything is fitted INSIDE the coats: the cross-sections are flattened along the local sphere normal so a
// vein never reaches Bruch's membrane / the retina and the canal stays under the outer scleral surface until
// its exit (the ampulla is an oblate lens ~0.9 x 1.3 mm, ~0.22 mm thick).
// The tubular tributaries are limited to ~5.6 mm around each ampulla; beyond that the posterior module's painted
// Haller layer carries the choroidal veins.
import * as THREE from 'three';
import { EYE, L } from '../../config.js';
import * as am from '../../lib/anatomyMath.js';
import { colonize, poissonSphere, bandSampler, pruneLeaves, murray, extractChains, chainsToDense } from './sc.js';
import { PathSet, spline, radiiArray, lerp, smoothstep, polyLength, meander } from './util.js';

const deg = THREE.MathUtils.degToRad;
export const CHOROID_OUTER = L.choroidInnerR + EYE.choroidThick;
export const VORTEX_CAL = { trunk: 0.34, canal: 0.28, ampW: 0.46, ampHalfT: 0.11, trib: 0.22, floor: 0.021 };
export const AMPULLA_POLAR = 92.2;     // deg from the anterior pole (~0.45 mm behind the equator)
export const TERRITORY = 5.6;          // mm (chord) around each ampulla

export function buildVortex({ rng }) {
  const Rc = CHOROID_OUTER;              // outer face of the choroid = inner face of the sclera (11.5)
  const Rin = L.choroidInnerR;           // Bruch's membrane (11.24)
  const Rs = L.scleraOuterR;
  const Rg = Rc - 0.08;                  // growth sphere
  const D = 0.24;
  const set = new PathSet();
  const discC = am.retinaMap(am.DISC_MAP.x, am.DISC_MAP.y, Rg);
  const skin = Rc + 0.035;               // outer skin of the choroidal veins: a faint relief on the choroid, 0.035 mm into the sclera

  const seeds = [], amp = [];
  am.VORTEX_EXITS.forEach((E, k) => {
    const az = Math.atan2(E.y, E.x);
    const twist = (k % 2 ? 1 : -1) * deg(2.5);
    const pc = deg(AMPULLA_POLAR + (k < 2 ? -0.4 : 0.5));    // superior ampullae sit a little further forward here
    const half = 0.62 / Rg;                                  // ampulla half length (rad)
    const pts = [pc + half, pc + half * 0.35, pc - half * 0.35, pc - half].map(p => am.fromAnterior(p, az + twist, Rg));
    const ampSeed = { pts, tree: 0, group: k, maxKids: () => 6, noBranch: () => true };
    seeds.push(ampSeed);
    const centre = am.fromAnterior(pc, az + twist, Rg);
    amp.push({ k, az, twist, E, centre, pc, half, seed: ampSeed, stubs: [] });
    // the whorl: 6-7 primary tributaries converge on the ampulla along pinwheel spirals
    const nrm = centre.clone().normalize();
    const eM = am.fromAnterior(pc - 0.02, az + twist, Rg).sub(centre); eM.addScaledVector(nrm, -eM.dot(nrm)).normalize();
    const eC = new THREE.Vector3().crossVectors(nrm, eM).normalize();
    const nStub = 6 + (k % 2);
    for (let j = 0; j < nStub; j++) {
      const th0 = (j + 0.3 * (rng() - 0.5)) / nStub * Math.PI * 2;
      const Ls = 2.2 + 0.8 * rng(), sw = deg(75 + 25 * rng());
      const sp = [];
      for (let s = 0.4; s <= Ls; s += D) {
        const th = th0 + sw * (s / Ls) * (s / Ls);
        // elliptical start so the spirals leave the rim of the (elongated) ampulla
        sp.push(centre.clone().addScaledVector(eM, Math.cos(th) * (s + 0.25)).addScaledVector(eC, Math.sin(th) * s).normalize().multiplyScalar(Rg));
      }
      const stub = { pts: sp, tree: 0, group: k, parentNode: () => ampSeed.first + 1 + (Math.cos(th0) > 0 ? 1 : 0), noBranch: (i) => i * D < 1.0, maxKids: () => 2 };
      seeds.push(stub);
      amp[k].stubs.push(stub);
    }
  });

  // attractors: inside each ampulla's territory only (quadrant watershed with wavy borders)
  const p0 = am.LIMBUS_POLAR + 3.2 / Rs;
  const spacing = pU => {
    const pol = Math.acos(THREE.MathUtils.clamp(pU.z, -1, 1));
    if (pol < p0) return 0;
    const p = pU.clone().multiplyScalar(Rg);
    if (p.distanceTo(discC) < 2.1) return 0;
    const dA = Math.min(...amp.map(a => a.centre.distanceTo(p)));
    if (dA > TERRITORY) return 0;
    return lerp(0.62, 0.95, smoothstep(1.5, TERRITORY, dA));
  };
  const pts = poissonSphere({ R: Rg, count: 2600, tries: 10, rand: rng, sample: bandSampler(p0, deg(150)), spacing, cell: 1.3 });
  const attractors = pts.map(a => {
    const pol = Math.acos(THREE.MathUtils.clamp(a.p.z / Rg, -1, 1));
    const az = (Math.atan2(a.p.y, a.p.x) + 0.34 * Math.sin(pol * 3.1 + 1.3) + 0.14 * Math.sin(pol * 8.3) + Math.PI * 4) % (Math.PI * 2);
    const q = Math.floor(az / (Math.PI / 2)) % 4;
    return { p: a.p, tree: 0, mask: 1 << q };
  });

  const bias = (n, dir) => {
    const A = amp[n.group].centre;
    const d = n.p.distanceTo(A);
    if (d > 5.0) return null;
    const nrm = n.p.clone().normalize();
    const away = n.p.clone().sub(A); away.addScaledVector(nrm, -away.dot(nrm)).normalize();
    const swirl = new THREE.Vector3().crossVectors(nrm, away).normalize();
    const w = Math.exp(-d / 2.4);
    return swirl.multiplyScalar(0.5 * w).addScaledVector(away, 0.2 * w);
  };
  const sc = colonize({
    R: Rg, seeds, attractors, rand: rng, di: 2.6, dk: () => 0.62, dkCross: 0.2, D,
    inertia: 1.3, splitAngle: 0.95, sideAngle: 0.55, minSpacing: 1.0, maxTurn: 0.3, bias, maxIter: 300,
    sideLean: 0.35, sideBack: -0.5,
    spanOf: (n, r) => (n.seed ? 0.2 : 0.9 + 1.4 * r()),
    allow: (p, n) => p.distanceTo(discC) > 1.9 && p.distanceTo(amp[n.group].centre) < TERRITORY + 0.4,
  });
  const nodes = sc.nodes;
  pruneLeaves(nodes, 0.9);
  murray(nodes, 3);

  const roots = amp.map(a => a.seed.first);
  const rootOf = new Int32Array(nodes.length).fill(-1);
  for (const n of nodes) rootOf[n.i] = n.parent < 0 ? n.i : rootOf[n.parent];
  const scale = {};
  amp.forEach(a => {
    const mx = Math.max(1, ...a.stubs.map(st => nodes[st.first].rm));
    scale[a.seed.first] = VORTEX_CAL.trib / mx;
  });
  const rOf = n => Math.max(VORTEX_CAL.floor, n.rm * scale[rootOf[n.i]]);
  const chains = extractChains(nodes, roots);
  const dense = chainsToDense(nodes, chains, { rOf, every: 2, spacing: 0.1, tailMaxTurn: 0.7 });

  // radial half-thickness allowed for a vein centred at radius cr: never below Bruch's (+0.02), never more than
  // `outer` (a hair into the sclera for the choroidal veins; well under the outer scleral surface for the canal)
  const fitK = (cr, r, outer, cap = 1) => {
    const h = Math.min(cr - (Rin + 0.02), outer - cr, cap);
    return THREE.MathUtils.clamp(h / r, 0.08, 1);
  };

  // trunks: cut extrascleral end -> scleral exit -> oblique intrascleral canal -> ampulla (flow authored from the drain)
  const trunkLen = {};
  amp.forEach((a, k) => {
    const az = a.az, tw = a.twist;
    const s = a.seed;
    const ampPts = [];
    for (let i = s.first; i <= s.last; i++) ampPts.push(nodes[i].p);
    const exitPolar = Math.acos(a.E.z / a.E.length());
    const ampBack = a.pc + a.half;                                  // posterior pole of the ampulla (canal mouth)
    const m = meander(610 + k);
    // canal: leaves the ampulla's posterior pole, climbs obliquely through the sclera (outer skin kept >= 0.12 mm
    // under the surface) and surfaces in the globe module's oval vortex foramen
    const canal = [];
    const nC = 14;
    for (let i = nC; i >= 1; i--) {
      const u = i / nC;
      const pol = lerp(ampBack, exitPolar, u);
      const azi = lerp(az + tw, az + tw * 0.15, smoothstep(0, 1, u)) + 0.03 * Math.sin(Math.PI * u) * (m(u * 3) + 0.6);
      const cr = u < 0.8 ? lerp(Rg + 0.03, Rs - 0.28, smoothstep(0, 0.8, u)) : lerp(Rs - 0.28, Rs + 0.06, smoothstep(0.8, 1.0, u));
      canal.push(am.fromAnterior(pol, azi, cr));
    }
    const ctrl = [
      am.fromAnterior(deg(116.5), az + tw * 0.1 + (k < 2 ? 0.05 : -0.05), Rs + 1.15),
      am.fromAnterior(deg(111), az + tw * 0.12, Rs + 0.46),
      am.fromAnterior(exitPolar + deg(1.6), az + tw * 0.14, Rs + 0.2),
      ...canal,
      ...ampPts.map(p => p.clone().normalize().multiplyScalar(Rg)),
    ];
    const pts = spline(ctrl, 0.07);
    const cl = [0]; for (let i = 1; i < pts.length; i++) cl.push(cl[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const Lt = cl[cl.length - 1];
    const ampLen = polyLength(ampPts);
    const ampStart = Lt - ampLen - 0.25;
    // arc length of the scleral exit along this trunk
    let sExit = 0; for (let i = 0; i < pts.length; i++) if (pts[i].length() > Rs) sExit = cl[i];
    const radii = radiiArray(u => {
      const x = u * Lt;
      if (x < sExit) return lerp(VORTEX_CAL.trunk, VORTEX_CAL.trunk * 0.9, x / Math.max(1, sExit));
      if (x < ampStart) return VORTEX_CAL.canal;
      const t = (x - ampStart) / (Lt - ampStart);
      return VORTEX_CAL.canal + (VORTEX_CAL.ampW - VORTEX_CAL.canal) * Math.sin(Math.PI * Math.min(1, t * 1.02)) ** 0.7;
    }, 64);
    set.add(pts, radii, 1, {
      dist0: 0, cap0: true, tag: `vortex-${k}`,
      shape: (c, r, sv) => {
        const cr = c.length();
        if (cr > Rs + 0.04) return 1;                                             // extrascleral: round
        const outer = lerp(Rs + 0.5, Rs - 0.12, smoothstep(0.15, 0.75, sv - sExit)); // canal stays under the surface
        const isAmp = sv > ampStart - 0.1;
        return fitK(cr, r, isAmp ? skin + 0.02 : outer, isAmp ? VORTEX_CAL.ampHalfT : 0.16);
      },
    });
    trunkLen[s.first] = Lt - ampLen;
  });

  // tributaries: outer skin flush with `skin`, flattened to fit the choroid; the far territory fades into the
  // choroid tone and loses its glow (the posterior module paints the rest of Haller's layer)
  for (const d of dense) {
    const root = rootOf[d.ids[0]];
    const A = amp.find(a => a.seed.first === root).centre;
    for (let i = 0; i < d.pts.length; i++) {
      const r = d.rads[i];
      const hr = Math.min(r, 0.135);
      d.pts[i].normalize().multiplyScalar(skin - hr);
    }
    set.add(d.pts, Array.from(d.rads), 1, {
      dist0: d.dist0 + trunkLen[root],
      shape: (c, r) => fitK(c.length(), r, skin + 0.001),
      fadeFn: c => smoothstep(3.2, TERRITORY + 0.2, c.distanceTo(A)),
    });
  }
  return { paths: set.paths, ampullae: amp.map(a => a.centre.clone()), stats: { nodes: nodes.length, chains: chains.length, it: sc.iterations, attractors: attractors.length } };
}
