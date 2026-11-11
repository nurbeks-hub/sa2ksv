// Registry of every inspectable part: id, group, host (vessels move with their host tissue),
// explode offset (mm, from assembled pose) and timeline window [t0, t1] on the explode track.
// Anatomy modules build geometry in the ASSEMBLED pose; the core applies these offsets.
// Order = index shown in the UI (01..NN), front to back.

export const PART_ORDER = [
  // id,                        group,     host,            offset [x,y,z],      window
  ['cornea',                    'optics',  null,            [0, 0, 64],          [0.05, 0.55]],
  ['conjunctiva',               'coat',    null,            [0, 0, 44],          [0.02, 0.45]],
  ['conjunctival-vessels',      'vessel',  'conjunctiva',   null,                null],
  ['iris',                      'uvea',    null,            [0, 0, 34],          [0.10, 0.62]],
  ['sphincter-pupillae',        'muscle',  'iris',          [0, 0, 2.2],         [0.55, 0.9]],
  ['dilator-pupillae',          'muscle',  'iris',          [0, 0, -2.2],        [0.55, 0.9]],
  ['iris-vessels',              'vessel',  'iris',          null,                null],
  ['lens',                      'optics',  null,            [0, 0, 22],          [0.14, 0.66]],
  ['zonules',                   'optics',  null,            [0, 0, 16],          [0.16, 0.68]],
  ['ciliary-body',              'uvea',    null,            [0, 0, 10],          [0.18, 0.70]],
  ['sclera',                    'coat',    null,            [0, 0, 0],           [0.0, 1.0]],
  ['anterior-ciliary-arteries', 'vessel',  'sclera',        null,                null],
  ['posterior-ciliary-arteries','vessel',  'sclera',        null,                null],
  ['vitreous',                  'chamber', null,            [0, 0, -26],         [0.20, 0.72]],
  ['retina',                    'neural',  null,            [0, 0, -46],         [0.16, 0.68]],
  ['macula',                    'neural',  'retina',        null,                null],
  ['optic-disc',                'neural',  'retina',        null,                null],
  ['retinal-vessels',           'vessel',  'retina',        null,                null],
  ['choroid',                   'uvea',    null,            [0, 0, -64],         [0.12, 0.62]],
  ['vortex-veins',              'vessel',  'choroid',       null,                null],
  ['optic-nerve',               'neural',  null,            [0, 0, -84],         [0.08, 0.58]],
  ['central-retinal-vessels',   'vessel',  'optic-nerve',   null,                null],
  ['ophthalmic-artery',         'vessel',  'optic-nerve',   null,                null],
  ['superior-rectus',           'muscle',  null,            [-14, 25, 0],        [0.26, 0.86]],
  ['inferior-rectus',           'muscle',  null,            [16, -24, -18],      [0.26, 0.86]],
  ['medial-rectus',             'muscle',  null,            [16, 24, -18],       [0.28, 0.88]],
  ['lateral-rectus',            'muscle',  null,            [-14, -25, 0],       [0.28, 0.88]],
  ['superior-oblique',          'muscle',  null,            [2, 40, 8],          [0.3, 0.9]],
  ['inferior-oblique',          'muscle',  null,            [0, -40, 10],        [0.3, 0.9]],
];

export const PARTS = PART_ORDER.map(([id, group, host, offset, window], i) => ({
  id, group, host, offset, window, index: i + 1,
}));
export const PART_BY_ID = Object.fromEntries(PARTS.map(p => [p.id, p]));

// Resolve the explode offset/window of a part (vessels inherit from their host, recursively).
export function explodeOf(id) {
  let p = PART_BY_ID[id];
  const extra = [0, 0, 0];
  let win = p?.window;
  while (p && p.host) {
    if (p.offset) { extra[0] += p.offset[0]; extra[1] += p.offset[1]; extra[2] += p.offset[2]; }
    const h = PART_BY_ID[p.host];
    if (!win && h) win = h.window;
    p = h;
  }
  const o = p?.offset || [0, 0, 0];
  return { offset: [o[0] + extra[0], o[1] + extra[1], o[2] + extra[2]], window: win || [0, 1], local: PART_BY_ID[id]?.host ? PART_BY_ID[id].offset : null };
}

// Which module builds which parts (for the dev harness).
export const MODULES = {
  globe: ['cornea', 'conjunctiva', 'sclera'],
  iris: ['iris', 'sphincter-pupillae', 'dilator-pupillae', 'iris-vessels'],
  lens: ['lens', 'zonules', 'ciliary-body'],
  posterior: ['vitreous', 'retina', 'macula', 'optic-disc', 'choroid'],
  orbit: ['optic-nerve', 'superior-rectus', 'inferior-rectus', 'medial-rectus', 'lateral-rectus', 'superior-oblique', 'inferior-oblique'],
  vasculature: ['conjunctival-vessels', 'anterior-ciliary-arteries', 'posterior-ciliary-arteries', 'retinal-vessels', 'vortex-veins', 'central-retinal-vessels', 'ophthalmic-artery'],
};

const smooth = t => { t = Math.min(1, Math.max(0, t)); return t * t * t * (t * (t * 6 - 15) + 10); };

// Displacement of a part at explode progress e (0..1): sum over the host chain of offset * eased(window).
export function explodeVector(id, e, out = [0, 0, 0]) {
  out[0] = out[1] = out[2] = 0;
  let p = PART_BY_ID[id];
  while (p) {
    if (p.offset) {
      const w = p.window || [0, 1];
      const k = smooth((e - w[0]) / Math.max(1e-6, w[1] - w[0]));
      out[0] += p.offset[0] * k; out[1] += p.offset[1] * k; out[2] += p.offset[2] * k;
    }
    p = p.host ? PART_BY_ID[p.host] : null;
  }
  return out;
}
export { smooth };
