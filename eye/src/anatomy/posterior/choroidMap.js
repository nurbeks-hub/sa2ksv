// Procedural choroidal vascular map.
// Vessel trees are grown on the CPU in an azimuthal-equidistant "angular map" of the choroid (mm along a
// sphere of radius RC, centred on the posterior pole, +x nasal, +y superior), then drawn into a canvas
// as a height field:  R = vein height (Haller/Sattler veins draining to the 4 vortex ampullae),
//                      G = artery height (short posterior ciliary arteries, recurrent arteries, long PCAs),
//                      B = vessel calibre class (0 fine .. 1 large).
// The same texture is sampled by the choroid (crisp) and by the retina (blurred, with parallax) so the
// fundus shows the real choroidal tessellation underneath.
import * as THREE from 'three';
import { EYE, L } from '../../config.js';
import * as am from '../../lib/anatomyMath.js';
import { rng, makeNoise2 } from '../../lib/materials.js';

export const RC = (L.choroidInnerR + L.scleraInnerR) * 0.5; // mid-choroid radius
export const TEX_EXT = 25;                                      // map half extent, mm
const TAU = Math.PI * 2;

export function angMapOfDir(d) {
  const s = Math.hypot(d.x, d.y);
  const p = Math.atan2(s, -d.z);
  const k = s > 1e-9 ? (p * RC) / s : 0;
  return [d.x * k, d.y * k];
}
function dirOfAngMap(x, y, out) {
  const rho = Math.hypot(x, y), p = rho / RC, az = Math.atan2(y, x), s = Math.sin(p);
  return out.set(s * Math.cos(az), s * Math.sin(az), -Math.cos(p));
}
const wrapPi = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

export function growChoroidVessels(seed = 20260922) {
  const R = rng(seed);
  const nz = makeNoise2(seed + 3);
  const amps = am.VORTEX_EXITS.map(v => v.clone().normalize());
  const ampMap = amps.map(angMapOfDir);
  const kR = RC / L.retinaInnerR;
  const disc = [am.DISC_MAP.x * kR, am.DISC_MAP.y * kR];
  const discAx = [EYE.discDiameter.h * 0.5 * kR, EYE.discDiameter.v * 0.5 * kR];
  const oraRho = az => (Math.PI - am.oraPolar(az)) * RC;
  const tmp = new THREE.Vector3();
  // vortex drainage territory (watershed zones meander rather than follow the meridians exactly)
  const quad = (x, y) => {
    dirOfAngMap(x, y, tmp);
    let b = 0, bd = -9, sd = -9;
    for (let i = 0; i < 4; i++) {
      const d = tmp.dot(amps[i]) + (nz(x * 0.22 + i * 31.7, y * 0.22 - i * 13.1) - 0.5) * 0.09;
      if (d > bd) { sd = bd; bd = d; b = i; } else if (d > sd) sd = d;
    }
    return [b, bd - sd];
  };

  const CELL = 0.2, GN = Math.ceil((2 * TEX_EXT) / CELL);
  const occW = new Float32Array(GN * GN), occId = new Int32Array(GN * GN).fill(-1), occK = new Int8Array(GN * GN).fill(-1);
  const cellOf = (x, y) => {
    const i = Math.floor((x + TEX_EXT) / CELL), j = Math.floor((y + TEX_EXT) / CELL);
    return i < 0 || j < 0 || i >= GN || j >= GN ? -1 : j * GN + i;
  };
  const STEP = 0.2;
  const MAX_STEPS = 700000;
  const branches = [];
  const queue = [];
  let head = 0, nextId = 0, totalSteps = 0;
  const spawn = o => { o.id = nextId++; queue.push(o); };

  function run(b) {
    let { x, y, ang, w } = b;
    const pts = [x, y], ws = [w];
    let side = R() < 0.5 ? 1 : -1;
    for (let s = 0; s < b.maxSteps && totalSteps < MAX_STEPS; s++) {
      totalSteps++;
      ang += (nz(b.id * 3.17 + 0.5, s * b.wf + b.id * 0.13) - 0.5) * b.wander;
      ang += wrapPi(b.guide(x, y) - ang) * b.gk;
      x += Math.cos(ang) * STEP; y += Math.sin(ang) * STEP;
      const rho = Math.hypot(x, y), az = Math.atan2(y, x);
      if (rho > oraRho(az) + 0.6) break;
      const ex = (x - disc[0]) / discAx[0], ey = (y - disc[1]) / discAx[1];
      if (ex * ex + ey * ey < 1.25) break;
      if (b.kind === 0) { const [qq, margin] = quad(x, y); if (qq !== b.q && margin > b.qm) break; }
      if (b.stop && b.stop(rho, az)) break;
      const c = cellOf(x, y);
      if (c >= 0) {
        if ((s > 5 || b.fill) && occK[c] === b.kind && occId[c] !== b.id && occId[c] !== b.parent && occW[c] >= w * (b.fill ? 0.3 : 0.55)) {
          if (b.fill || R() < 0.85) { pts.push(x, y); ws.push(w); break; }
        }
        if (w >= occW[c] || occK[c] !== b.kind) { occW[c] = w; occId[c] = b.id; occK[c] = b.kind; }
      }
      pts.push(x, y); ws.push(w);
      w *= b.taper;
      if (w < b.wMin) break;
      if (R() < STEP / (b.lam0 + b.lam1 * w)) {
        const sw = w * R.range(b.sr0, b.sr1);
        if (sw >= b.wMin) {
          side = -side;
          spawn({ ...b, x, y, ang: ang + side * R.range(0.45, 1.1), w: sw, parent: b.id });
          w = Math.cbrt(Math.max(w ** 3 - sw ** 3, (w * b.keep) ** 3));
          ang -= side * 0.12;
        }
      }
    }
    if (pts.length >= (b.fill ? 3 : 6)) branches.push({ kind: b.kind, pts, ws });
  }

  // --- Veins (Haller -> Sattler): wide, densely packed tributaries converging (with a whorl) on each vortex ampulla.
  ampMap.forEach((A, q) => {
    const whorl = 0.5;
    const guide = (x, y) => {
      const gx = x - A[0], gy = y - A[1];
      return Math.atan2(gy, gx) + whorl * Math.exp(-Math.hypot(gx, gy) / 2.4);
    };
    const n = 17;
    const a0 = R() * TAU;
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * TAU + R.range(-0.12, 0.12);
      spawn({
        kind: 0, q, guide, x: A[0] + Math.cos(a) * 0.6, y: A[1] + Math.sin(a) * 0.6, ang: a + whorl * 0.6,
        w: R.range(0.42, 0.66), parent: -1, maxSteps: 520, wander: 0.3, wf: 0.18, gk: 0.035, taper: 0.9993,
        wMin: 0.18, lam0: 0.7, lam1: 3.2, sr0: 0.5, sr1: 0.85, keep: 0.75, qm: 0.035,
      });
    }
  });
  // --- Short posterior ciliary arteries: enter around the disc and the macula, branch outwards.
  const pole = [2.1, 0.15];
  const guideOut = (x, y) => Math.atan2(y - pole[1], x - pole[0]);
  for (let k = 0; k < 20; k++) {
    const aroundDisc = k < 13;
    const c = aroundDisc ? disc : [0, 0];
    const a = R() * TAU, rr = aroundDisc ? R.range(1.25, 2.8) : R.range(1.2, 3.6);
    const x = c[0] + Math.cos(a) * rr, y = c[1] + Math.sin(a) * rr;
    const lim = R.range(13, 18);
    spawn({
      kind: 1, guide: guideOut, x, y, ang: guideOut(x, y) + R.range(-0.6, 0.6), w: R.range(0.07, 0.12), parent: -1,
      maxSteps: 300, wander: 0.6, wf: 0.4, gk: 0.045, taper: 0.9968, wMin: 0.02, lam0: 0.32, lam1: 2.6, sr0: 0.36, sr1: 0.72, keep: 0.62, qm: 1,
      stop: rho => rho > lim,
    });
  }
  // --- Recurrent arteries from the major arterial circle, running back from the ora.
  for (let k = 0; k < 30; k++) {
    const az = (k / 30) * TAU + R.range(-0.08, 0.08);
    const rho0 = oraRho(az) - 0.25;
    const lim = rho0 - R.range(4, 7.5);
    spawn({
      kind: 1, guide: (x, y) => Math.atan2(-y, -x), x: Math.cos(az) * rho0, y: Math.sin(az) * rho0, ang: az + Math.PI,
      w: R.range(0.055, 0.09), parent: -1, maxSteps: 200, wander: 0.55, wf: 0.4, gk: 0.06, taper: 0.997,
      wMin: 0.02, lam0: 0.3, lam1: 2.6, sr0: 0.36, sr1: 0.72, keep: 0.62, qm: 1, stop: rho => rho < lim,
    });
  }
  while (head < queue.length && totalSteps < MAX_STEPS) run(queue[head++]);

  // --- Dense venous layer: evenly spaced streamlines (Jobard & Lefer) of the drainage field of each vortex
  // ampulla. Neighbouring streams stay ~0.3 mm apart and terminate where they converge (= confluence), so the
  // whole choroid is packed with sinuous, roughly parallel veins that widen downstream, as in the real layer.
  const streams = (() => {
    const H = 0.1;
    // spacing 0.18–0.38 mm: with the calibres below the veins cover ~60–70 % of the posterior pole
    const dsepAt = (x, y) => 0.18 + 0.2 * nz(x * 0.45 + 40, y * 0.45 - 12);
    const CS = 0.15, SG = Math.ceil((2 * TEX_EXT) / CS);
    const headC = new Int32Array(SG * SG).fill(-1);
    const px = [], py = [], pl = [], nx = [];
    const cid = (x, y) => {
      const i = Math.floor((x + TEX_EXT) / CS), j = Math.floor((y + TEX_EXT) / CS);
      return i < 0 || j < 0 || i >= SG || j >= SG ? -1 : j * SG + i;
    };
    const add = (x, y, line) => {
      const i = px.length; px.push(x); py.push(y); pl.push(line);
      const c = cid(x, y); if (c >= 0) { nx.push(headC[c]); headC[c] = i; } else nx.push(-1);
    };
    const near = (x, y, r) => {
      const ci = Math.floor((x + TEX_EXT) / CS), cj = Math.floor((y + TEX_EXT) / CS), k = Math.ceil(r / CS), r2 = r * r;
      for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) {
        const i0 = ci + di, j0 = cj + dj;
        if (i0 < 0 || j0 < 0 || i0 >= SG || j0 >= SG) continue;
        for (let i = headC[j0 * SG + i0]; i >= 0; i = nx[i]) { const dx = px[i] - x, dy = py[i] - y; if (dx * dx + dy * dy < r2) return true; }
      }
      return false;
    };
    const inDomain = (x, y, q) => {
      const rho = Math.hypot(x, y);
      if (rho > oraRho(Math.atan2(y, x)) + 0.4) return false;
      const ex = (x - disc[0]) / discAx[0], ey = (y - disc[1]) / discAx[1];
      if (ex * ex + ey * ey < 1.3) return false;
      const [qq, margin] = quad(x, y);
      return qq === q || margin < 0.02;
    };
    const fieldAng = (x, y, q) => {
      const A = ampMap[q], dx = A[0] - x, dy = A[1] - y, d = Math.hypot(dx, dy);
      return Math.atan2(dy, dx) + 0.5 * Math.exp(-d / 2.4) + (nz(x * 0.32 + q * 17, y * 0.32) - 0.5) * 1.5 * Math.min(1, d / 3);
    };
    const lines = [];
    const trace = (sx, sy) => {
      const [q] = quad(sx, sy);
      const dl = dsepAt(sx, sy);
      if (!inDomain(sx, sy, q) || near(sx, sy, dl * 0.95)) return null;
      const halves = [];
      for (const dir of [1, -1]) {
        const h = [];
        let x = sx, y = sy;
        for (let n = 0; n < 700; n++) {
          const a1 = fieldAng(x, y, q) + (dir < 0 ? Math.PI : 0);
          const mx = x + Math.cos(a1) * H * 0.5, my = y + Math.sin(a1) * H * 0.5;
          const a2 = fieldAng(mx, my, q) + (dir < 0 ? Math.PI : 0);
          x += Math.cos(a2) * H; y += Math.sin(a2) * H;
          if (!inDomain(x, y, q)) break;
          const A = ampMap[q];
          if (dir > 0 && Math.hypot(x - A[0], y - A[1]) < 0.55) { h.push(x, y); break; }
          if (near(x, y, dsepAt(x, y) * 0.5)) { h.push(x, y); break; }
          h.push(x, y);
        }
        halves.push(h);
      }
      const pts = [];
      const bw = halves[1];
      for (let i = bw.length - 2; i >= 0; i -= 2) pts.push(bw[i], bw[i + 1]);
      pts.push(sx, sy);
      for (const v of halves[0]) pts.push(v);
      if (pts.length < 20) return null;
      const id = lines.length;
      for (let i = 0; i < pts.length; i += 2) add(pts[i], pts[i + 1], id);
      lines.push(pts);
      return pts;
    };
    const seeds = [];
    const pushSeeds = pts => {
      for (let i = 2; i < pts.length - 2; i += 6) {
        const tx = pts[i + 2] - pts[i - 2], ty = pts[i + 3] - pts[i - 1], tl = Math.hypot(tx, ty) || 1;
        const nxv = -ty / tl, nyv = tx / tl;
        const d = dsepAt(pts[i], pts[i + 1]);
        seeds.push(pts[i] + nxv * d, pts[i + 1] + nyv * d, pts[i] - nxv * d, pts[i + 1] - nyv * d);
      }
    };
    const drain = () => {
      while (seeds.length) {
        const y = seeds.pop(), x = seeds.pop();
        const l = trace(x, y);
        if (l) pushSeeds(l);
      }
    };
    ampMap.forEach(A => {
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; const l = trace(A[0] + Math.cos(a) * 1.4, A[1] + Math.sin(a) * 1.4); if (l) pushSeeds(l); }
      drain();
    });
    for (let k = 0; k < 2500; k++) {
      const l = trace(R.range(-TEX_EXT, TEX_EXT), R.range(-TEX_EXT, TEX_EXT));
      if (l) { pushSeeds(l); drain(); }
    }
    // calibre grows with the drained length (upstream arc length)
    return lines.map((pts, li) => {
      const n = pts.length / 2, ws = new Array(n);
      const f = R.range(0.6, 1.35);
      let sUp = 0;
      for (let i = 0; i < n; i++) {
        if (i > 0) sUp += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
        const wob = 0.8 + 0.4 * nz(li * 1.7 + 0.3, sUp * 0.6);
        const pole = 1 + 0.55 * Math.exp(-((Math.hypot(pts[i * 2], pts[i * 2 + 1]) / 6.5) ** 2));
        ws[i] = Math.min(0.45, (0.09 + 0.0128 * sUp) * f * wob * pole) * Math.min(1, 0.5 + sUp * 0.25);
      }
      return { kind: 0, pts, ws };
    });
  })();

  // --- Long posterior ciliary arteries (3 and 9 o'clock, suprachoroidal): gently sinuous, tapering forward.
  const lpca = [];
  const line = (x0, x1, y0, sgn) => {
    const pts = [], ws = [];
    const n = Math.round(Math.abs(x1 - x0) / STEP);
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t;
      pts.push(x, y0 + Math.sin(t * 7.0 + sgn) * 0.35 + Math.sin(t * 19.0 + 2 * sgn) * 0.08 + (nz(x * 0.3, sgn * 7) - 0.5) * 0.6);
      ws.push(0.19 * (1 - 0.6 * t) * Math.min(1, t * 12 + 0.35));
    }
    lpca.push({ kind: 1, pts, ws });
  };
  line(disc[0] + 2.4, 24.0, 0.15, 1);
  line(1.2, -23.6, -0.45, 2);

  return { branches: streams.concat(branches, lpca), ampMap, disc, discAx, totalSteps, streams: streams.length };
}

// Draw the vessel trees into an RGB height-field canvas.
export function drawChoroidMap(net, size = 2048) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighten';
  g.lineCap = 'round'; g.lineJoin = 'round';
  const k = size / (2 * TEX_EXT);
  const X = x => (x + TEX_EXT) * k, Y = y => (TEX_EXT - y) * k;
  const stretchAt = (x, y) => { const p = Math.hypot(x, y) / RC; return p > 1e-3 ? p / Math.sin(p) : 1; };

  const buckets = new Map();
  for (const b of net.branches) {
    const n = b.ws.length;
    for (let i = 0; i < n - 1; i += 3) {
      const j = Math.min(i + 3, n - 1);
      const mid = (i + j) >> 1;
      const wpx = b.ws[mid] * stretchAt(b.pts[mid * 2], b.pts[mid * 2 + 1]) * k;
      const wb = Math.max(1, Math.round(wpx * 2) / 2);
      const key = b.kind * 1000 + wb;
      let p = buckets.get(key);
      if (!p) { p = { path: new Path2D(), kind: b.kind, w: wb }; buckets.set(key, p); }
      p.path.moveTo(X(b.pts[i * 2]), Y(b.pts[i * 2 + 1]));
      for (let t = i + 1; t <= j; t++) p.path.lineTo(X(b.pts[t * 2]), Y(b.pts[t * 2 + 1]));
    }
  }
  // Rounded vessel cross-section as concentric strokes (max-blended): outer wall low, lumen crest high.
  const PASSES = [[1.0, 0.3], [0.84, 0.55], [0.66, 0.75], [0.46, 0.9], [0.24, 1.0]];
  const large = 0.4 * k;
  for (const p of buckets.values()) {
    for (const [f, v] of PASSES) {
      if (f < 1 && p.w * f < 0.9) continue;
      const val = Math.round(v * 255);
      g.strokeStyle = p.kind === 0 ? `rgb(${val},0,0)` : `rgb(0,${val},0)`;
      g.lineWidth = Math.max(0.9, p.w * f);
      g.stroke(p.path);
    }
    if (p.kind === 0) {
      const cls = Math.round(Math.min(1, p.w / large) * 255);
      g.strokeStyle = `rgb(0,0,${cls})`;
      g.lineWidth = Math.max(0.9, p.w * 0.85);
      g.stroke(p.path);
    }
  }
  // Vortex ampullae: dilated venous sacs, elongated along the meridian.
  for (const A of net.ampMap) {
    const az = Math.atan2(A[1], A[0]);
    const s = stretchAt(A[0], A[1]);
    g.save();
    g.translate(X(A[0]), Y(A[1]));
    g.rotate(-az);
    g.scale(1.0, 0.72 * s);
    const rad = 0.95 * k;
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, rad);
    grd.addColorStop(0, 'rgb(255,0,255)');
    grd.addColorStop(0.55, 'rgb(215,0,235)');
    grd.addColorStop(0.85, 'rgb(90,0,160)');
    grd.addColorStop(1, 'rgb(0,0,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, rad, 0, TAU); g.fill();
    g.restore();
  }
  const c2 = document.createElement('canvas');
  c2.width = c2.height = size;
  const g2 = c2.getContext('2d');
  g2.filter = 'blur(0.7px)';
  g2.drawImage(c, 0, 0);
  return c2;
}

// Per-vessel pulse phase for vessel mode: R = vein phase, G = artery phase, constant along each vessel,
// so the travelling glints run along the vessels instead of blinking as random blotches.
export function drawPhaseMap(net, size = 1024, seed = 5) {
  const R = rng(seed);
  const k = size / (2 * TEX_EXT);
  const X = x => (x + TEX_EXT) * k, Y = y => (TEX_EXT - y) * k;
  const layer = kind => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const b of net.branches) {
      if (b.kind !== kind) continue;
      const v = Math.round(20 + R() * 235);
      g.strokeStyle = kind === 0 ? `rgb(${v},0,0)` : `rgb(0,${v},0)`;
      let wmax = 0;
      for (const w of b.ws) wmax = Math.max(wmax, w);
      g.lineWidth = Math.max(1.5, wmax * k * 1.25);
      g.beginPath();
      g.moveTo(X(b.pts[0]), Y(b.pts[1]));
      for (let i = 2; i < b.pts.length; i += 2) g.lineTo(X(b.pts[i]), Y(b.pts[i + 1]));
      g.stroke();
    }
    return c;
  };
  const veins = layer(0), arts = layer(1);
  const g = veins.getContext('2d');
  g.globalCompositeOperation = 'lighten';
  g.drawImage(arts, 0, 0);
  return veins;
}

export function buildChoroidTexture(size = 2048, seed) {
  const net = growChoroidVessels(seed);
  const canvas = drawChoroidMap(net, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  const phase = new THREE.CanvasTexture(drawPhaseMap(net, size >> 1));
  phase.colorSpace = THREE.NoColorSpace;
  phase.wrapS = phase.wrapT = THREE.ClampToEdgeWrapping;
  phase.minFilter = THREE.LinearMipmapLinearFilter;
  phase.generateMipmaps = true;
  phase.needsUpdate = true;
  return { tex, phase, net };
}
