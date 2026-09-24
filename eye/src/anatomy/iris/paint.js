// Procedural iris maps painted in polar space: x = azimuth (0..2PI -> 0..W), y = s (pupil margin 0 -> root 1).
// Two canvases are painted with the same strokes: albedo (sRGB) and relief height (linear, 0.5 = neutral).
// Because the maps live in (theta, s) they follow the pupil for free: the stroma compresses/stretches radially.
// Features (hazel iris with central heterochromia): amber-honey pupillary zone of fine radial fibres, raised zig-zag
// collarette, green-brown -> grey-blue ciliary zone of wavy radial trabeculae, crypts of Fuchs (openings with sloping walls and a
// dark floor of deep stroma), pigment flecks and freckles, darker periphery and root. Contraction furrows are analytic (shader).
import * as THREE from 'three';
import { P0, R1, TAU, rad, collaretteS } from './profile.js';

export function paintIris(rng, { W = 4096, H = 1024, seed = 1911, quality = 'high' } = {}) {
  const t0 = performance.now();
  const R = rng(seed);
  // trabecular bundle axes of the ciliary zone (shared with the 3D strands): ridges with darker gaps between them
  const RB = rng(4243);
  const bundles = [];
  for (let i = 0; i < 170; i++) bundles.push({ th: RB() * TAU, spread: 0.006 + RB() * 0.014, s1: 0.75 + RB() * 0.24, curl: (RB() - 0.5) * 0.08, tone: RB() });
  const q = quality === 'low' ? 0.5 : 1;
  const cc = document.createElement('canvas'); cc.width = W; cc.height = H;
  const hc = document.createElement('canvas'); hc.width = W; hc.height = H;
  const C = cc.getContext('2d'), Hx = hc.getContext('2d');
  for (const g of [C, Hx]) { g.lineCap = 'round'; g.lineJoin = 'round'; }

  const X = th => (th / TAU) * W;
  const Y = s => s * H;
  const pxX = s => W / (TAU * rad(s, P0));   // px per mm along the azimuth at s (rest pupil)
  const pxY = H / (R1 - P0);                 // px per mm radially
  const grey = v => { const c = Math.round(Math.min(1, Math.max(0, v)) * 255); return `rgb(${c},${c},${c})`; };
  const pick = a => a[Math.floor(R() * a.length)];
  const clear = c => {
    if (c.startsWith('rgb(')) return c.replace('rgb(', 'rgba(').replace(')', ',0)');
    const n = parseInt(c.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},0)`;
  };

  // Draw fn(ctx) on both canvases with azimuthal wrap-around.
  function both(xmin, xmax, colFn, hFn) {
    const offs = [0]; if (xmin < 0) offs.push(W); if (xmax > W) offs.push(-W);
    for (const o of offs) {
      if (colFn) { C.save(); C.translate(o, 0); colFn(C); C.restore(); }
      if (hFn) { Hx.save(); Hx.translate(o, 0); hFn(Hx); Hx.restore(); }
    }
  }
  function polyline(g, pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); }
  // A wavy radial fibre from s0 to s1 at azimuth th: returns canvas points.
  function fibre(th, s0, s1, ampMm, waveMm, phase, driftRad, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, s = s0 + (s1 - s0) * t;
      const rmm = rad(s, P0);
      const distMm = (s - s0) * (R1 - P0);
      const lat = ampMm * Math.sin(TAU * distMm / waveMm + phase) * (0.35 + 0.65 * Math.sin(Math.PI * t));
      const a = th + driftRad * t + lat / rmm;
      pts.push([X(a), Y(s)]);
    }
    return pts;
  }
  function strokeFibre(pts, width, col, alpha, h, hAlpha) {
    let xmin = Infinity, xmax = -Infinity;
    for (const p of pts) { xmin = Math.min(xmin, p[0]); xmax = Math.max(xmax, p[0]); }
    both(xmin - width, xmax + width,
      g => { g.globalAlpha = alpha; g.strokeStyle = col; g.lineWidth = width; polyline(g, pts); g.stroke(); },
      h == null ? null : g => { g.globalAlpha = hAlpha; g.strokeStyle = grey(h); g.lineWidth = width; polyline(g, pts); g.stroke(); });
  }
  // Soft elliptical blob at (th, s) with radii in mm.
  function blob(th, s, rxMm, ryMm, col, alpha, h = null, hAlpha = 0) {
    const x = X(th), y = Y(s), rx = Math.max(1, rxMm * pxX(s)), ry = Math.max(1, ryMm * pxY);
    const paint = (g, c, a) => {
      g.globalAlpha = a; g.translate(x, y); g.scale(1, ry / rx);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      gr.addColorStop(0, c); gr.addColorStop(0.55, c); gr.addColorStop(1, clear(c)); // same hue at alpha 0: no dark fringe
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, TAU); g.fill();
    };
    both(x - rx, x + rx, g => paint(g, col, alpha), h == null ? null : g => paint(g, grey(h), hAlpha));
  }
  // ---------------------------------------------------------------- 1. base zones
  {
    const gr = C.createLinearGradient(0, 0, 0, H);
    const stops = [
      [0.00, '#1c0d05'], [0.03, '#4a260c'], [0.07, '#7a4614'], [0.14, '#96601e'], [0.22, '#a67226'], [0.27, '#a2702a'],
      [0.31, '#94703a'], [0.335, '#a8844a'], [0.37, '#78683a'], [0.45, '#686c34'], [0.55, '#5a6a36'],
      [0.68, '#4e6644'], [0.8, '#4a6054'], [0.9, '#465a62'], [0.96, '#324048'], [1.0, '#161c20'],
    ];
    for (const [s, c] of stops) gr.addColorStop(s, c);
    C.fillStyle = gr; C.fillRect(0, 0, W, H);
    Hx.fillStyle = grey(0.5); Hx.fillRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------- 2. large mottling (colour only)
  const greens = ['#6e8650', '#607a58', '#7c884c', '#6a806e', '#76888c', '#667c82', '#887c42'];
  for (let i = 0; i < 520 * q; i++) {
    const th = R() * TAU, s = 0.36 + R() * 0.6;
    blob(th, s, 0.08 + R() * 0.45, 0.15 + R() * 0.6, pick(greens), 0.06 + R() * 0.12);
  }
  for (let i = 0; i < 140 * q; i++) {  // brown clouds (melanin in the anterior border layer)
    const th = R() * TAU, s = 0.38 + R() * 0.55;
    blob(th, s, 0.1 + R() * 0.35, 0.1 + R() * 0.35, pick(['#5a3a1a', '#6a4a22', '#4a3218']), 0.08 + R() * 0.14);
  }
  for (let i = 0; i < 240 * q; i++) {  // amber warmth inside the pupillary zone
    const th = R() * TAU, s = 0.04 + R() * 0.26;
    blob(th, s, 0.05 + R() * 0.2, 0.08 + R() * 0.25, pick(['#c8802a', '#d89a3a', '#9a5418', '#b8701e']), 0.1 + R() * 0.18);
  }

  // heterogeneous sectors: some warmer (golden-brown), some cooler (blue-grey) wedges across the ciliary zone
  for (let i = 0; i < 14; i++) {
    const th = R() * TAU, warm = R() < 0.55;
    for (let k = 0; k < 18; k++) {
      blob(th + (R() - 0.5) * 0.35, 0.42 + R() * 0.45, 0.25 + R() * 0.4, 0.3 + R() * 0.5, warm ? pick(['#8a7a3a', '#7a6428', '#9a7a36']) : pick(['#5e7c86', '#6a8290', '#58707a']), 0.05 + R() * 0.07);
    }
  }
  // ---------------------------------------------------------------- 2b. broad radial undulations: trabecular bundles and the
  // darker, lower gaps between them (low-frequency relief that models under the key light)
  {
    const axis = (th0, curl, s0, s1, n = 16) => {
      const pts = [];
      for (let k = 0; k <= n; k++) { const t = k / n, s = s0 + (s1 - s0) * t; pts.push([X(th0 + curl * t), Y(s)]); }
      return pts;
    };
    const soft = (pts, wPx, col, a, h, ha, blurPx) => {
      let xmin = Infinity, xmax = -Infinity;
      for (const p of pts) { xmin = Math.min(xmin, p[0]); xmax = Math.max(xmax, p[0]); }
      both(xmin - wPx, xmax + wPx,
        col == null ? null : g => { g.filter = `blur(${blurPx}px)`; g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = wPx; polyline(g, pts); g.stroke(); g.filter = 'none'; },
        g => { g.filter = `blur(${blurPx}px)`; g.globalAlpha = ha; g.strokeStyle = grey(h); g.lineWidth = wPx; polyline(g, pts); g.stroke(); g.filter = 'none'; });
    };
    const sorted = bundles.slice().sort((a, b) => a.th - b.th);
    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i], nb = sorted[(i + 1) % sorted.length];
      const s0 = collaretteS(b.th) + 0.03;
      soft(axis(b.th, b.curl, s0, b.s1), (b.spread * 2.4 + 0.014) * W / TAU, b.tone < 0.5 ? '#8c8a6c' : '#7c8a86', 0.07, 0.57, 0.4, 5);
      let gap = nb.th - b.th; if (gap < 0) gap += TAU;
      if (gap > 0.022) {
        const tm = b.th + gap / 2, s0g = collaretteS(tm) + 0.04;
        soft(axis(tm, (b.curl + nb.curl) / 2, s0g, Math.min(b.s1, nb.s1) - 0.02), gap * 0.42 * W / TAU, '#171810', 0.2, 0.43, 0.42, 3);
      }
    }
  }

  // ---------------------------------------------------------------- 3. sunburst flames: amber rays leaving the collarette
  const flames = [];
  for (let i = 0; i < 260 * q; i++) {
    const th = R() * TAU, sc = collaretteS(th);
    const len = 0.05 + Math.pow(R(), 1.6) * 0.36;
    const halfW = (0.03 + R() * 0.09);                       // mm at the base
    const n = 10, pts = [];
    const wave = 0.3 + R() * 0.5, ph = R() * TAU;
    for (let k = 0; k <= n; k++) {
      const t = k / n, s = sc - 0.02 + len * t, r = rad(s, P0);
      const a = th + 0.03 * Math.sin(TAU * t / wave + ph) / r;
      pts.push([a, s, halfW * (1 - t) ** 1.3]);
    }
    const col = pick(['#c8842c', '#d49a44', '#b87426', '#e0aa52', '#a86a26', '#c89a3a']);
    const al = 0.26 + R() * 0.36;
    const poly = g => {
      g.beginPath();
      pts.forEach(([a, s, w], k) => { const x = X(a + w / rad(s, P0)), y = Y(s); k ? g.lineTo(x, y) : g.moveTo(x, y); });
      for (let k = pts.length - 1; k >= 0; k--) { const [a, s, w] = pts[k]; g.lineTo(X(a - w / rad(s, P0)), Y(s)); }
      g.closePath();
    };
    const x0 = X(th);
    flames.push({ x0, poly, col, al });
    both(x0 - 60, x0 + 60, g => { g.globalAlpha = al; g.fillStyle = col; poly(g); g.fill(); },
      g => { g.globalAlpha = 0.25; g.fillStyle = grey(0.56); poly(g); g.fill(); });
  }

  // ---------------------------------------------------------------- 4. pupillary-zone fibres (fine, amber-gold)
  for (let i = 0; i < 5200 * q; i++) {
    const th = R() * TAU, sc = collaretteS(th);
    const s0 = 0.012 + R() * 0.04, s1 = sc - 0.005 - R() * 0.07;
    const pts = fibre(th, s0, s1, 0.008 + R() * 0.03, 0.2 + R() * 0.45, R() * TAU, (R() - 0.5) * 0.07, 10);
    const u = R();
    if (u < 0.5) strokeFibre(pts, 0.9 + R() * 1.8, pick(['#e8b85c', '#d8a04a', '#c89040', '#f0cc80', '#b88034']), 0.08 + R() * 0.26, 0.6 + R() * 0.08, 0.35);
    else if (u < 0.68) strokeFibre(pts, 1 + R() * 2.2, pick(['#a0561a', '#8a4814', '#b06a28']), 0.12 + R() * 0.24, 0.55, 0.25);
    else strokeFibre(pts, 1 + R() * 2.4, pick(['#3a1c06', '#5a2e0c', '#4a2408', '#2a1204']), 0.18 + R() * 0.3, 0.4, 0.3);
  }
  // sector banding of the pupillary zone (radially elongated light/dark clouds)
  for (let i = 0; i < 160 * q; i++) {
    const th = R() * TAU, s = 0.06 + R() * 0.22;
    blob(th, s, 0.04 + R() * 0.12, 0.2 + R() * 0.3, pick(['#e0a850', '#c07a28', '#6a3a10', '#4a2408', '#f0c070']), 0.1 + R() * 0.16);
  }
  // fine concentric contraction folds near the margin (over the sphincter)
  for (let i = 0; i < 90 * q; i++) {
    const s = 0.03 + R() * 0.14, th0 = R() * TAU, len = 0.2 + R() * 0.9, n = 24, pts = [];
    for (let k = 0; k <= n; k++) { const th = th0 + len * k / n; pts.push([X(th), Y(s + 0.004 * Math.sin(k * 0.7 + i))]); }
    strokeFibre(pts, 1 + R() * 1.5, pick(['#3a1c06', '#2a1204']), 0.12 + R() * 0.16, 0.42, 0.35);
  }
  // radial furrows of the pupillary zone (dark grooves between fibre fascicles)
  for (let i = 0; i < 520 * q; i++) {
    const th = R() * TAU, sc = collaretteS(th);
    const pts = fibre(th, 0.02 + R() * 0.04, sc - 0.02 - R() * 0.06, 0.004 + R() * 0.01, 0.3 + R() * 0.4, R() * TAU, (R() - 0.5) * 0.02, 8);
    strokeFibre(pts, 1.6 + R() * 2.4, pick(['#2a1204', '#3a1a06', '#301606']), 0.25 + R() * 0.3, 0.34, 0.5);
  }
  // ---------------------------------------------------------------- 5. ciliary-zone trabeculae (wavy radial bundles)
  const lightFib = ['#a8ac80', '#9ca676', '#b0ac84', '#90a296', '#a4a484', '#b8aa74', '#94a288', '#a8a07a'];
  const darkFib = ['#1a2012', '#262614', '#161a14', '#2a2416', '#20180c'];
  for (let i = 0; i < 7600 * q; i++) {
    const th = R() * TAU, sc = collaretteS(th);
    const s0 = sc + 0.015 + 0.14 * R() ** 2;
    const s1 = Math.min(1.0, s0 + 0.12 + R() * 0.62);
    const pts = fibre(th, s0, s1, 0.01 + R() * 0.05, 0.35 + R() * 0.9, R() * TAU, (R() - 0.5) * 0.08, 12);
    if (R() < 0.58) strokeFibre(pts, 1.1 + R() * 3.0, pick(lightFib), 0.07 + R() * 0.2, 0.57 + R() * 0.06, 0.35);
    else strokeFibre(pts, 1.2 + R() * 3.4, pick(darkFib), 0.2 + R() * 0.36, 0.43, 0.3);
  }
  for (let i = 0; i < 420 * q; i++) {  // thicker radial ridges (vessel-bearing trabeculae)
    const th = R() * TAU, sc = collaretteS(th);
    const s0 = sc + 0.02 + R() * 0.08, s1 = Math.min(0.99, s0 + 0.25 + R() * 0.5);
    const pts = fibre(th, s0, s1, 0.02 + R() * 0.05, 0.5 + R() * 0.8, R() * TAU, (R() - 0.5) * 0.06, 14);
    strokeFibre(pts, 4 + R() * 6, pick(['#a8ae98', '#b0ae96', '#9ea8a8']), 0.12 + R() * 0.14, 0.7, 0.4);
  }

  // flames again as a colour-only glaze over the fibres (keeps the fibre luminance, tints it amber)
  C.save(); C.globalCompositeOperation = 'color';
  for (const f of flames) both(f.x0 - 60, f.x0 + 60, g => { g.globalAlpha = Math.min(0.85, f.al * 1.5); g.fillStyle = f.col; f.poly(g); g.fill(); }, null);
  C.restore();

  // ---------------------------------------------------------------- 6. collarette: raised zig-zag ridge (light tan)
  {
    const n = 1400, pts = [];
    for (let i = 0; i <= n; i++) { const th = (i / n) * TAU; pts.push([X(th), Y(collaretteS(th))]); }
    const band = (w, col, a, h, ha) => both(0, 0,
      g => { g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = w; polyline(g, pts); g.stroke(); },
      g => { g.globalAlpha = ha; g.strokeStyle = grey(h); g.lineWidth = w; polyline(g, pts); g.stroke(); });
    band(64, '#b08e58', 0.2, 0.64, 0.55);
    band(34, '#c2a068', 0.26, 0.72, 0.7);
    band(14, '#c9a870', 0.28, 0.8, 0.8);
    // interlacing trabeculae crossing the ridge
    for (let i = 0; i < 1100 * q; i++) {
      const th = R() * TAU, sc = collaretteS(th);
      const pts2 = fibre(th, sc - 0.03 - R() * 0.02, sc + 0.03 + R() * 0.03, 0.01, 0.3, R() * TAU, (R() - 0.5) * 0.02, 4);
      strokeFibre(pts2, 1.5 + R() * 3.2, pick(['#d2b684', '#c09e66', '#a4824c', '#caa878', '#8e6c3c']), 0.22 + R() * 0.34, 0.8 + R() * 0.1, 0.6);
    }
    // small pits between the collarette loops: few, radially elongated, soft, scattered off the line
    for (let i = 0; i < 120 * q; i++) {
      const th = R() * TAU, s = collaretteS(th) + (R() - 0.5) * 0.09;
      const x = X(th), y = Y(s), rx = Math.max(1, (0.008 + R() * 0.012) * pxX(s)), ry = Math.max(2, (0.025 + R() * 0.04) * pxY);
      const rot = (R() - 0.5) * 0.5, col = pick(['#3a2410', '#44301a', '#2e1c0c']), a = 0.22 + R() * 0.22, bl = `blur(${(0.6 + rx * 0.35).toFixed(2)}px)`;
      both(x - ry, x + ry,
        g => { g.filter = bl; g.globalAlpha = a; g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); g.fill(); g.filter = 'none'; },
        g => { g.filter = bl; g.globalAlpha = 0.55; g.fillStyle = grey(0.4); g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); g.fill(); g.filter = 'none'; });
    }
  }

  // ---------------------------------------------------------------- 7. crypts of Fuchs
  // A crypt is an opening in the anterior border layer: a soft shadowed surround, a sloping brown wall and an irregular
  // dark floor of deep stroma (its own shape, offset towards the pupil, so the pupillary wall is steep and the
  // peripheral wall a long slope). Every edge is a continuous (blurred) falloff, in the albedo and in the relief.
  const crypts = [];
  const crypt = (th, s, lenMm, widMm, depth) => {
    const x = X(th), y = Y(s), hw = Math.max(1.5, widMm * 0.5 * pxX(s)), hh = Math.max(1.5, lenMm * 0.5 * pxY), skew = (R() - 0.5) * 0.3;
    // ragged outline: pointed radially (lozenge), edge broken where fibres end at different lengths
    const N = 40, jag = [];
    for (let i = 0; i < N; i++) jag.push(R());
    const rj = i => 1 + 0.18 * ((jag[(i + N - 1) % N] + 2 * jag[i] + jag[(i + 1) % N]) / 4 - 0.5);
    const outline = (g, sc, oy = 0) => {
      g.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * TAU, c = Math.cos(a), sn = Math.sin(a), j = rj(i % N);
        const px = hw * sc * j * Math.sign(c) * Math.abs(c) ** 0.85, py = hh * sc * j * Math.sign(sn) * Math.abs(sn) ** 1.35;
        const X0 = x + px + skew * py, Y0 = y + oy + py;
        i ? g.lineTo(X0, Y0) : g.moveTo(X0, Y0);
      }
      g.closePath();
    };
    // floor: an irregular blob of its own (smooth closed curve through jittered radii)
    const NF = 9, fr = [], fa = [];
    for (let i = 0; i < NF; i++) { fr.push(0.55 + 0.7 * R()); fa.push((i + (R() - 0.5) * 0.5) / NF * TAU); }
    const fs = 0.4 + 0.2 * R(), fox = (R() - 0.5) * 0.35 * hw, foy = -hh * (0.16 + 0.14 * R());
    const floorPath = (g, sc) => {
      const P = fa.map((a, i) => [x + fox + Math.cos(a) * hw * fs * sc * fr[i] + skew * Math.sin(a) * hh * fs, y + foy + Math.sin(a) * hh * fs * sc * fr[i]]);
      g.beginPath();
      const m0 = [(P[NF - 1][0] + P[0][0]) / 2, (P[NF - 1][1] + P[0][1]) / 2];
      g.moveTo(m0[0], m0[1]);
      for (let i = 0; i < NF; i++) { const p = P[i], q2 = P[(i + 1) % NF]; g.quadraticCurveTo(p[0], p[1], (p[0] + q2[0]) / 2, (p[1] + q2[1]) / 2); }
      g.closePath();
    };
    const b0 = Math.max(0.8, Math.min(hw, hh) * 0.32);
    const blur = k => `blur(${(b0 * k).toFixed(2)}px)`;
    const floorCol = pick(['#1a0e07', '#1e1108', '#170c06']), wall = pick(['#5c3e1e', '#664624', '#543a1c']);
    const fibres = [];
    for (let i = 0, nf = 2 + Math.floor(R() * 4); i < nf; i++) fibres.push([(R() - 0.5) * hw * 1.2, (R() - 0.5) * hw, (R() - 0.5) * hw * 0.8, 0.5 + R() * 0.8, pick(['#3a2616', '#44301c', '#2e1e10']), 0.18 + R() * 0.2]);
    const vessel = R() < 0.7 ? [(R() - 0.5) * hw, (R() - 0.5) * hw, 0.8 + R() * 0.8, pick(['#5c2216', '#4e1c12', '#662a1a'])] : null;
    const border = [];
    for (let i = 0, nb = 4 + Math.floor(R() * 5); i < nb; i++) {
      const side = R() < 0.5 ? -1 : 1;
      border.push([side * hw * (0.75 + R() * 0.5), hh * (1.2 + R() * 0.6), hh * (1.2 + R() * 0.6), 0.8 + R() * 0.4, 0.16 + R() * 0.18, pick(lightFib), 1 + R() * 2]);
    }
    both(x - hw * 2, x + hw * 2, g => {
      g.filter = blur(1.3); g.globalAlpha = 0.24; g.fillStyle = '#1e140a'; outline(g, 1.28); g.fill();      // shadowed surround
      {
        const gr = g.createLinearGradient(0, y - hh, 0, y + hh);
        gr.addColorStop(0, '#24160a'); gr.addColorStop(0.35, wall); gr.addColorStop(1, wall);
        g.filter = blur(0.22); g.globalAlpha = 0.9; g.fillStyle = gr; outline(g, 1.0); g.fill();              // wall: steep and dark on the pupil side
      }
      g.filter = blur(0.45); g.globalAlpha = 0.6; g.fillStyle = '#2e1c0e'; outline(g, 0.78, foy * 0.4); g.fill();
      g.filter = blur(0.4); g.globalAlpha = 0.94; g.fillStyle = floorCol; floorPath(g, 1); g.fill();         // deep floor
      g.filter = 'none';
      // the floor is deep stroma: faint fibres and a small vessel
      g.save(); floorPath(g, 1.15); g.clip();
      for (const [dx0, dx1, dxm, w, col, a] of fibres) {
        g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = w;
        g.beginPath(); g.moveTo(x + fox + dx0, y + foy - hh * 0.6); g.quadraticCurveTo(x + fox + dxm, y + foy, x + fox + dx1, y + foy + hh * 0.6); g.stroke();
      }
      if (vessel) {
        g.globalAlpha = 0.35; g.strokeStyle = vessel[3]; g.lineWidth = vessel[2];
        g.beginPath(); g.moveTo(x + fox - hw, y + foy + vessel[0]); g.quadraticCurveTo(x + fox, y + foy + vessel[1] - hh * 0.2, x + fox + hw, y + foy + vessel[0] * 0.5); g.stroke();
      }
      g.restore();
      // bordering fibres overlapping the rim
      for (const [dx, up, dn, bow, a, col, w] of border) {
        g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = w;
        g.beginPath(); g.moveTo(x + dx, y - up); g.quadraticCurveTo(x + dx * bow, y, x + dx, y + dn); g.stroke();
      }
    }, g => {
      g.filter = blur(1.3); g.globalAlpha = 0.4; g.fillStyle = grey(0.5 - 0.12 * depth); outline(g, 1.28); g.fill();
      g.filter = blur(0.22); g.globalAlpha = 0.9; g.fillStyle = grey(0.5 - 0.34 * depth); outline(g, 1.0); g.fill();
      g.filter = blur(0.45); g.globalAlpha = 0.9; g.fillStyle = grey(0.5 - 0.64 * depth); outline(g, 0.78, foy * 0.4); g.fill();
      g.filter = blur(0.4); g.globalAlpha = 0.95; g.fillStyle = grey(0.5 - depth); floorPath(g, 1); g.fill();
      g.filter = 'none';
    });
    crypts.push({ th, s, halfTh: (widMm * 0.5) / rad(s, P0), halfS: (lenMm * 0.5) / (R1 - P0) });
  };
  // crypt placement: clustered in arcs (they come in groups along the collarette), sizes log-normal-ish
  for (let i = 0; i < 34 * q; i++) {                    // collarette crypt clusters
    const thc = R() * TAU, nC = 1 + Math.floor(R() * 4);
    for (let k = 0; k < nC; k++) {
      const th = thc + (R() - 0.5) * 0.22, s = collaretteS(th) + 0.03 + R() ** 1.6 * 0.16;
      const big = R() ** 2;
      crypt(th, s, 0.16 + big * 0.62, 0.08 + big * 0.3 + R() * 0.06, 0.3 + R() * 0.16);
    }
  }
  for (let i = 0; i < 10 * q; i++) {                    // mid ciliary zone, few and small
    const th = R() * TAU, s = 0.52 + R() * 0.24;
    crypt(th, s, 0.08 + R() * 0.14, 0.05 + R() * 0.08, 0.12 + R() * 0.1);
  }
  for (let i = 0; i < 16 * q; i++) {                    // peripheral crypts in arcs near the root, shallow, wider than long
    const thc = R() * TAU, nC = 2 + Math.floor(R() * 4);
    for (let k = 0; k < nC; k++) {
      const th = thc + k * (0.03 + R() * 0.04), s = 0.87 + R() * 0.09;
      crypt(th, s, 0.05 + R() * 0.08, 0.08 + R() * 0.18, 0.1 + R() * 0.1);
    }
  }
  for (let i = 0; i < 9 * q; i++) {                     // a few small pupillary-zone crypts
    const th = R() * TAU, s = 0.12 + R() * 0.14;
    crypt(th, s, 0.08 + R() * 0.1, 0.03 + R() * 0.04, 0.12 + R() * 0.1);
  }
  // point-in-crypt test (with a margin), so flecks never land inside an opening
  const inCrypt = (th, s, pad = 1.35) => {
    for (const c of crypts) {
      let d = th - c.th; d -= TAU * Math.round(d / TAU);
      const u = d / (c.halfTh * pad), v = (s - c.s) / (c.halfS * pad);
      if (u * u + v * v < 1) return true;
    }
    return false;
  };

  // ---------------------------------------------------------------- 8. flecks, freckles, periphery
  for (let i = 0; i < 26 * q; i++) { const th = R() * TAU, s = 0.4 + R() * 0.5; if (inCrypt(th, s, 2)) continue; blob(th, s, 0.025 + R() * 0.05, 0.025 + R() * 0.05, pick(['#5a3212', '#6a3c16', '#4a2a10']), 0.5 + R() * 0.35, 0.54, 0.3); }
  for (let i = 0; i < 70 * q; i++) { const th = R() * TAU, s = 0.36 + R() ** 1.5 * 0.5; if (inCrypt(th, s, 1.6)) continue; const r = 0.014 + R() * 0.03; blob(th, s, r * (0.8 + R() * 0.6), r * (1 + R() * 0.8), pick(['#e0aa4a', '#e8b85c', '#d0922e', '#c29a44']), 0.4 + R() * 0.35, 0.56, 0.3); }
  for (let i = 0; i < 4; i++) { const th = R() * TAU, s = 0.5 + R() * 0.4; if (inCrypt(th, s, 2)) continue; blob(th, s, 0.12 + R() * 0.12, 0.1 + R() * 0.1, '#3c1c0a', 0.75, 0.54, 0.5); }
  {
    const gr = C.createLinearGradient(0, Y(0.9), 0, H);
    gr.addColorStop(0, 'rgba(18,24,26,0)'); gr.addColorStop(0.6, 'rgba(18,24,26,0.45)'); gr.addColorStop(1, 'rgba(10,12,14,0.85)');
    C.globalAlpha = 1; C.fillStyle = gr; C.fillRect(0, Y(0.9), W, H - Y(0.9));
    for (let i = 0; i < 1600 * q; i++) {
      const th = R() * TAU, pts = fibre(th, 0.9 + R() * 0.04, 0.995, 0.01, 0.3, R() * TAU, 0, 3);
      strokeFibre(pts, 1 + R() * 1.5, R() < 0.5 ? '#6a7a7c' : '#141a1a', 0.2 + R() * 0.3, R() < 0.5 ? 0.55 : 0.46, 0.25);
    }
  }
  // the pupil ruff mesh covers s < 0.03: keep that band neutral in height
  Hx.globalAlpha = 1; Hx.fillStyle = grey(0.5); Hx.fillRect(0, 0, W, Y(0.012));

  const colorTex = new THREE.CanvasTexture(cc);
  colorTex.colorSpace = THREE.SRGBColorSpace;
  // relief as a single-channel R8 texture (a quarter of the VRAM of an RGBA canvas upload)
  // soften the relief by ~1 px (with azimuthal wrap): painted fibre strokes are 1-4 px wide, and their raw slopes
  // read as bark or hay under the key light; the albedo keeps the full sharpness
  const pad = 8, wide = document.createElement('canvas'); wide.width = W + 2 * pad; wide.height = H;
  const wg = wide.getContext('2d');
  wg.drawImage(hc, pad, 0); wg.drawImage(hc, pad - W, 0); wg.drawImage(hc, pad + W, 0);
  const soft = document.createElement('canvas'); soft.width = W + 2 * pad; soft.height = H;
  const sg = soft.getContext('2d', { willReadFrequently: true });
  sg.filter = 'blur(1.1px)'; sg.drawImage(wide, 0, 0); sg.filter = 'none';
  const img = sg.getImageData(pad, 0, W, H).data;
  wide.width = wide.height = soft.width = soft.height = 1;
  const r8 = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < r8.length; i++, j += 4) r8[i] = img[j];
  const heightTex = new THREE.DataTexture(r8, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  heightTex.colorSpace = THREE.NoColorSpace;
  heightTex.unpackAlignment = 1;
  for (const t of [colorTex, heightTex]) {
    t.flipY = false; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
  }
  hc.width = hc.height = 1;   // release the relief canvas
  return { colorTex, heightTex, crypts, bundles, pxX, pxY, ms: Math.round(performance.now() - t0) };
}
