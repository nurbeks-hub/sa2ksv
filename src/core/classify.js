// Node → anatomical class / depth group / cap group / base colour.
// Works on the ORIGINAL Z-Anatomy node names (GLTFLoader keeps them in userData.name), so it keeps
// working when the assets are replaced by fitted versions with the same node names.

// Depth groups (index into uLayerDis[]).  A group dissolves when the depth rail passes its index.
export const G = { skin: 0, muscle: 1, vessel: 2, nerve: 3, bone: 4, organ: 5, brain: 6, eye: 7 };
export const GROUP_NAMES = ['skin', 'muscle', 'vessel', 'nerve', 'bone', 'organ', 'brain', 'eye'];
// depth value at which each group starts to dissolve (null = never dissolves)
export const GROUP_DISSOLVE_AT = [0, 1, 2, 3, 4, 3, null, null];   // viscera go with the nerve layer (glass there)
// minimum depth at which a group can be seen at all (everything under the skin is hidden by the opaque skin,
// the brain is hidden by the skull) — used to skip rendering occluded groups.
export const GROUP_REVEAL_AT = [-1, 0.002, 0.002, 0.002, 0.002, 0.002, 4.002, -1];
// rail items (depth stops) and which groups each rail toggle controls
export const RAIL = ['skin', 'muscles', 'vessels', 'nerves', 'bones', 'brain'];
export const RAIL_GROUPS = { skin: [G.skin], muscles: [G.muscle], vessels: [G.vessel], nerves: [G.nerve], bones: [G.bone], brain: [G.brain] };

// Cap groups for section stencil caps, drawn in this order (inner structures later so they overwrite outer ones).
export const CAP_ORDER = ['muscle', 'ligament', 'tongue', 'bone', 'tooth', 'cartilage', 'air', 'organ', 'gland', 'lymph', 'eye', 'lens', 'cortex', 'cerebellum', 'brainstem', 'white', 'deepgrey', 'csf'];
export const CAP_COLOR = {
  muscle: 0x8e2a26, ligament: 0xd9cfbc, tongue: 0xa3423c, bone: 0xe6d8bd, tooth: 0xf4efe4, cartilage: 0xcfd2cc, air: 0x0d0f12,
  organ: 0xc47f79, gland: 0xc9a47a, lymph: 0x9fbf8e, eye: 0xd9dfe2, lens: 0xe8e0b8,
  cortex: 0xb89a93, cerebellum: 0xb0918c, brainstem: 0xe3d5c8, white: 0xefe6dc, deepgrey: 0xa98c88, csf: 0x5d86a8,
};

// Base colours (sRGB hex) per class.  Illustrative, not true tissue colours (said in ⓘ).
export const CLASS_COLOR = {
  skin: 0xcfae98, hair: 0x14100e, hairFine: 0x1b1512,
  muscle: 0x9a2f2a, tendon: 0xcfc3b6, fascia: 0xd5cfc6,
  artery: 0xc4222f, vein: 0x2f4f9a, nerve: 0xefd98a, lymph: 0x9db88c,
  bone: 0xe9dcc3, tooth: 0xf6f1e6, cartilage: 0xd6d6cf, ligament: 0xd8d2c2, disc: 0xcfd8d6, air: 0x9ab4c8,
  gland: 0xd8b995, thyroid: 0x9a4a3f, mucosa: 0xc99590, tongue: 0xb8514b, gingiva: 0xc59a96, ear: 0xe8dcc8,
  cortex: 0xc4a6a0, sulcus: 0xa9898a, cerebellum: 0xbb9a93, brainstem: 0xe2d3c4, white: 0xf0e7dc, deepgrey: 0xb18f8b,
  nucleus: 0xc2716a, csf: 0x6aa2d4, plexus: 0xb3474b, meninges: 0xd8d0c8, pituitary: 0xd0957a,
  sclera: 0xd6cfc4, cornea: 0x000000, iris: 0x5a321a, lens: 0xf1e7c0, retina: 0xd9785a, vitreous: 0xe8eef2, ciliary: 0x3b2418,
};

const RX = (s) => new RegExp(s, 'i');
const has = (name, ...words) => words.some(w => name.includes(w));

// Returns { cls, group, cap, hidden, helper, eye }  (helper → not loaded at all)
export function classify(rawNode, file) {
  const node = String(rawNode || '').trim();
  const name = node.replace(/\.(l|r)$/, '').replace(/\*/g, '').trim();
  const n = name.toLowerCase();
  const out = { cls: 'bone', group: G.bone, cap: null, hidden: false, helper: false, eye: false, rotate: false };
  const set = (cls, group, cap = null, extra = {}) => Object.assign(out, { cls, group, cap }, extra);

  // inner-ear organ meshes: source licence is non-commercial → never loaded (nerves VIII stay)
  if (/^(cochlea|vestibule|semicircular|cochlear duct|utricle|saccule)\b(?! nerve| nuclei)/i.test(name)) { out.helper = true; return out; }
  // technical helpers from Z-Anatomy: curves, meridians, equator lines, label points, muscle-end patches
  if (/-curve/i.test(node) || /meridian|equator/i.test(node) || /\.e\d*[lr]?$/i.test(node) || /^\?/.test(node) || /\.[jgt]$/.test(node)) {
    out.helper = true; return out;
  }

  switch (file) {
    case 'skin': {
      // fitted skin: 'Skin' (single mesh + 'female' morph) and 'Eyelashes'; legacy Z-Anatomy region names still work
      if (n === 'hairs of head') return set('hair', G.skin, null, { hidden: true, noField: true });
      if (n === 'hairs of eyebrow' || n === 'eyelashes') return set('hairFine', G.skin, null, { noField: true });
      return set('skin', G.skin, null, { noField: true });
    }
    case 'muscles': {
      if (has(n, 'investing cervical fascia', 'masseteric fascia', 'temporal fascia')) return set('fascia', G.muscle, null, { hidden: true });
      if (has(n, 'bursa', 'tendon sheath')) return set('tendon', G.muscle, null, { hidden: true });
      if (has(n, 'aponeurosis', 'tendon', 'tendinous', 'tarsus', 'trochlea')) return set('tendon', G.muscle);
      // muscles of the back/shoulder that only enter the neck slab at its cut: keep them out of the bust
      if (has(n, 'supraspinatus', 'rhomboid', 'serratus posterior', 'interspinales thoracis', 'levatores', 'longissimus thoracis', 'serratus anterior')) { out.helper = true; return out; }
      return set('muscle', G.muscle, 'muscle');
    }
    case 'vessels': {
      const intracranial = /cerebral|communicating|basilar|cerebellar|pontine|callosomarginal|pericallosal|striate|insular branch|of central sulcus|of precentral sulcus|angular gyrus|postcentral arterial|posterior parietal|parieto-occipital|prefrontal|frontobasal|temporo-occipital|lateral occipital artery|medial occipital artery|temporal branch(es)? of middle|anterior temporal branch|posterior temporal branch|orbitofrontal branches|frontal branches of callosomarginal|anterior spinal/.test(n);
      const vein = /vein|sinus|plexus|venous/.test(n) && !/artery/.test(n);
      if (vein) return set('vein', G.vessel);
      return set('artery', intracranial ? G.brain : G.vessel);
    }
    case 'lymph': return set('lymph', G.vessel, 'lymph');
    case 'organs': {
      if (has(n, 'hypophysis', 'pineal')) return set('pituitary', G.brain, 'gland');
      if (has(n, 'thyroid gland', 'parathyroid')) return set('thyroid', G.organ, 'gland');
      if (has(n, 'gland', 'duct')) return set('gland', G.organ, 'gland');
      if (n === 'tongue') return set('tongue', G.organ, 'tongue');
      if (n === 'gingiva') return set('gingiva', G.organ, 'organ');
      return set('mucosa', G.organ, 'organ');
    }
    case 'joints': {
      if (has(n, 'intervertebral disc', 'nucleus pulposus', 'articular disc')) return set('disc', G.bone, 'cartilage');
      return set('ligament', G.bone, 'ligament');
    }
    case 'bones': {
      if (/tooth|incisor|canine|premolar|molar/.test(n)) return set('tooth', G.bone, 'tooth');
      if (/cartilage/.test(n)) return set('cartilage', G.bone, 'cartilage');
      if (/^sinus of|cells of ethmoid/.test(n)) return set('air', G.bone, 'air', { hidden: true });
      return set('bone', G.bone, 'bone');
    }
    case 'nerves': return classifyNerves(n, set, out);
  }
  return out;
}

function classifyNerves(n, set, out) {
  // ---- eye (globe parts rotate with the gaze)
  if (/chamber of eyeball|segment of eyeball|zonular/.test(n)) return set('vitreous', G.eye, null, { hidden: true, eye: true, rotate: true });
  if (n === 'cornea') return set('cornea', G.eye, null, { eye: true, rotate: true });
  if (n === 'sclera') return set('sclera', G.eye, 'eye', { eye: true, rotate: true });
  if (n === 'iris') return set('iris', G.eye, null, { eye: true, rotate: true });
  if (n === 'lens') return set('lens', G.eye, 'lens', { eye: true, rotate: true });
  if (n === 'retina') return set('retina', G.eye, null, { eye: true, rotate: true });
  if (n === 'vitreous body') return set('vitreous', G.eye, null, { eye: true, rotate: true });
  if (n === 'ciliary body') return set('ciliary', G.eye, null, { eye: true, rotate: true });
  if (n === 'suspensory ligament of eyeball') return set('tendon', G.muscle, null, { hidden: true });
  // ---- lacrimal apparatus / ear → organs (inner ear stays with the eyes as a sense organ)
  if (/lacrimal|nasolacrimal/.test(n)) return set('gland', G.organ, 'gland');
  if (/cochlea$|^vestibule$|tympanic membrane/.test(n)) return set('ear', G.eye, 'bone');
  if (n === 'auditory tube') return set('mucosa', G.organ, 'organ');
  // ---- meninges (hidden by default; would cover the brain)
  if (/falx cerebri|tentorium cerebelli/.test(n)) return set('meninges', G.brain, null, { hidden: true });
  // ---- ventricles & CSF spaces
  if (/ventricle|aqueduct of midbrain|central canal/.test(n)) return set('csf', G.brain, 'csf');
  if (n === 'choroid plexus') return set('plexus', G.brain, null);
  if (n === 'septum pellucidum') return set('white', G.brain, 'white');
  // ---- peripheral & cranial nerves; optic/olfactory are CNS tracts and stay with the brain
  if (/^optic (nerve|chiasm|tract)|^olfactory nerve/.test(n)) return set('nerve', G.brain, null);
  if (/nerve|chorda tympani|root of trigeminal|division of mandibular/.test(n) && !/nucleus|nuclei/.test(n)) return set('nerve', G.nerve, null);
  // ---- brain
  if (/nucleus|nuclei|olive$/.test(n) && !/caudate|lentiform|red nucleus/.test(n)) return set('nucleus', G.brain, 'deepgrey');
  if (/white matter|corpus callosum|fornix|commissure|stria |cuneate fasciculus/.test(n)) return set('white', G.brain, 'white');
  if (/thalamus|caudate|putamen|globus pallidus|lentiform|amygdal|hippocamp|hypothalamus|mamillary|septal nuclei|habenula|geniculate|red nucleus/.test(n)) return set('deepgrey', G.brain, 'deepgrey');
  if (/midbrain|pons|medulla oblongata|pyramid of medulla|peduncle|colliculus|interpeduncular/.test(n)) return set('brainstem', G.brain, 'brainstem');
  if (/lobule|vermis|culmen|declive|folium|tuber of|pyramis|uvula of vermis|nodule|lingula|flocculus|tonsil of cerebellum|central lobule/.test(n)) return set('cerebellum', G.brain, 'cerebellum');
  if (/sulcus|sulci|lat_fis|fissure/.test(n) && !/gyrus and sulcus|gyri and sulcus|gyrus and sulci/.test(n)) return set('sulcus', G.brain, 'cortex');
  // gyri, lobules, poles, cuneus, insula, temporal plane … = cortex parcels (Destrieux-style)
  return set('cortex', G.brain, 'cortex');
}

// Which classes are rendered double-sided (thin sheets / open surfaces)
export const DOUBLE_SIDED = new Set(['skin', 'hair', 'hairFine', 'tendon', 'fascia', 'artery', 'vein', 'nerve', 'meninges', 'retina', 'iris', 'cornea', 'ciliary', 'mucosa', 'plexus']);
// Transparent classes (drawn after opaque, no depth write)
export const TRANSPARENT = new Set(['cornea', 'lens', 'vitreous', 'csf', 'meninges', 'hairFine']);
// classes that live inside the globe and look black through the pupil in a living eye
export const EYE_INTERIOR = new Set(['retina', 'vitreous', 'lens', 'ciliary']);
