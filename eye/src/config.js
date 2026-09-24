// Geometry of an adult right eye (OD), in millimetres. Scene unit = 1 mm.
// Frame: +Z anterior (towards the viewer / cornea), +Y superior, +X nasal (medial), -X temporal (lateral).
// Globe centre at the origin. Values are typical adult emmetropic figures; sources live in content/parts.js.

export const EYE = {
  // Coats
  scleraOuterR: 12.0,
  scleraThick: { limbus: 0.8, equator: 0.5, posterior: 1.0 },
  choroidThick: 0.26,
  retinaThick: 0.25,

  // Cornea (spherical-cap model)
  limbusR: 5.85,              // half of 11.7 mm horizontal visible iris diameter
  corneaAntRadius: 7.8,
  corneaPostRadius: 6.5,
  corneaCentralThick: 0.54,
  corneaPeriphThick: 0.67,

  // Anterior segment
  anteriorChamberDepth: 3.0,  // corneal endothelium -> anterior lens
  irisOuterR: 6.0,
  pupilR: { min: 1.0, rest: 1.9, max: 4.0 },

  // Lens
  lensEquatorR: 4.75,
  lensThick: 4.0,
  lensAntRadius: 10.0,
  lensPostRadius: 6.0,

  // Ciliary body / zonules / ora serrata (distances along the inner wall behind the limbus)
  ciliaryProcesses: 72,
  parsPlicata: 2.0,
  parsPlana: 4.0,

  // Posterior pole
  foveaDiameter: 1.5,
  foveolaDiameter: 0.35,
  fazDiameter: 0.5,
  maculaDiameter: 5.5,
  discDiameter: { v: 1.88, h: 1.77 },
  discFoveaDistance: 4.4,      // mm along the retina, nasal of the fovea

  // Optic nerve
  nerveDiameter: 3.2,          // neural part, intraorbital
  sheathDiameter: 4.6,         // with meninges
  nerveApex: [7.5, 0.5, -40.0],  // optic canal / annulus of Zinn (behind and nasal)
  craEntryBehindGlobe: 11.0,   // central retinal vessels pierce the nerve

  // Extraocular muscles: insertion distance from limbus along the surface (spiral of Tillaux) and width
  recti: {
    medial:   { dir: [ 1, 0], fromLimbus: 5.5, width: 10.3 },
    inferior: { dir: [ 0,-1], fromLimbus: 6.5, width: 9.8 },
    lateral:  { dir: [-1, 0], fromLimbus: 6.9, width: 9.2 },
    superior: { dir: [ 0, 1], fromLimbus: 7.7, width: 10.6 },
  },
  annulusR: 5.5,               // ring of origin around the optic canal
  trochlea: [14.5, 12.0, 6.0],
  ioOrigin: [13.0, -13.0, 7.5],
};

// Derived landmarks (computed once so every module agrees).
const Rs = EYE.scleraOuterR;
export const L = (() => {
  const scleraInnerR = Rs - EYE.scleraThick.equator;
  const choroidInnerR = scleraInnerR - EYE.choroidThick;
  const retinaInnerR = choroidInnerR - EYE.retinaThick;
  const limbusZ = Math.sqrt(Rs * Rs - EYE.limbusR * EYE.limbusR);
  const corneaCenterZ = limbusZ - Math.sqrt(EYE.corneaAntRadius ** 2 - EYE.limbusR ** 2);
  const corneaApexZ = corneaCenterZ + EYE.corneaAntRadius;
  const corneaPostApexZ = corneaApexZ - EYE.corneaCentralThick;
  const lensAntZ = corneaPostApexZ - EYE.anteriorChamberDepth;
  const lensPostZ = lensAntZ - EYE.lensThick;
  const irisZ = lensAntZ + 0.35;             // pupil margin rests on the anterior lens capsule
  const discAngle = EYE.discFoveaDistance / retinaInnerR; // radians around +Y, towards +X (nasal)
  return {
    scleraOuterR: Rs, scleraInnerR, choroidInnerR, retinaInnerR,
    limbusZ, corneaCenterZ, corneaApexZ, corneaPostApexZ,
    lensAntZ, lensPostZ, lensEquatorZ: lensAntZ - EYE.lensThick * 0.42,
    irisZ,
    axialLength: corneaApexZ + retinaInnerR, // apex -> inner retina at the posterior pole
    discAngle,
    discCenterDir: [Math.sin(discAngle), 0.02, -Math.cos(discAngle)],
    foveaDir: [0, -0.015, -1],
  };
})();

export const PALETTE = {
  bg: 0x020203,
  sclera: 0xe9e3da,
  scleraDeep: 0xcfc3b4,
  artery: 0xc3162c,
  arteryGlow: 0xff3b4e,
  vein: 0x5b1030,
  veinGlow: 0x9a3cff,
  choroid: 0x5a1a14,
  retina: 0xe8906a,
  macula: 0x9a5a2a,
  disc: 0xf2d6a8,
  muscle: 0x9b2f2c,
  tendon: 0xe7ddd0,
  nerve: 0xefe6d6,
  ciliary: 0x2a140c,
  lens: 0xf4e6c8,
  // ?iris=brown (used by the head atlas): dark brown, as in the predominantly brown-eyed Kazakh population
  iris: (typeof location !== 'undefined' && new URLSearchParams(location.search).get('iris') === 'brown')
    ? { deep: 0x160a04, mid: 0x3f2310, light: 0x6e4724, fleck: 0x4b3018 }
    : { deep: 0x2b1407, mid: 0x7a4a1c, light: 0xc79a4a, fleck: 0x6f8a52 },
  accent: 0xd8ff3e,
};

// Choreography of the explode timeline (0 = assembled, 1 = fully apart)
export const TIMELINE = {
  // [t0, t1] windows per part are defined by each part; this is the camera path.
  camera: [
    { t: 0.0, theta: 0.0, phi: 0.02, r: 58 },
    { t: 0.35, theta: 0.55, phi: 0.12, r: 92 },
    { t: 1.0, theta: 1.05, phi: 0.2, r: 150 },
  ],
};
