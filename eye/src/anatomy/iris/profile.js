// Iris profile: one parametric description of the iris slab shared by every layer (stroma, strands,
// pigment epithelium, sphincter, dilator, vessels), in JS (CPU: paths, proxies, anchors) and GLSL (GPU: live pupil).
//
// Parameterisation: s in [0,1] runs from the pupil margin (s=0) to the iris root (s=1); theta is the azimuth
// (0 = +X nasal, PI/2 = +Y superior). The pupil radius p moves the margin; the tissue between margin and root
// is compressed/stretched radially, the slab bunches up peripherally on dilation (a thick roll near the root,
// volume roughly conserved) and the pupillary margin slides along the anterior lens capsule (so a dilated iris
// sits further back and flatter). The root (s = 1, inserted into the ciliary body) never moves; only its thickness
// grows a little on dilation.
//
// The pupil is not a perfect circle centred on the limbus: it is displaced slightly nasally and its outline has a
// low-order irregularity. pth(theta, p) gives the actual margin radius at an azimuth for a nominal pupil radius p;
// every layer uses it in place of p.
import { EYE, L } from '../../config.js';

export const P0 = EYE.pupilR.rest;
export const PMIN = EYE.pupilR.min;
export const PMAX = EYE.pupilR.max;
export const R1 = EYE.irisOuterR;
export const ZI = L.irisZ;
export const LR = EYE.lensAntRadius;
export const H_AMP = 0.30;          // mm of relief per unit of the height texture (0.5 = neutral)
export const TAU = Math.PI * 2;
export const DEC = 0.15;            // nasal decentration of the pupil (mm, +X)

// Major arterial circle of the iris (circulus arteriosus iridis major): in the ciliary-body stroma just behind the
// iris root, anterior to the circular ciliary muscle. Proposed as the shared landmark (see process/modules/iris.md).
// LPCA: the two long posterior ciliary arteries reach it at the horizontal meridian.
export const MAC = { r: 6.05, z: ZI - 0.88, tube: 0.1, lpcaAz: [0, Math.PI] };

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const sag = r => LR - Math.sqrt(LR * LR - r * r);

// actual margin radius at azimuth th (nasal decentration + low-order irregularity of the pupil outline)
export function wob(th) { return 0.012 * Math.sin(2 * th + 0.7) + 0.008 * Math.sin(3 * th + 2.1) + 0.005 * Math.sin(5 * th + 0.4); }
export function pth(th, p) { return p * (1 + wob(th)) + DEC * Math.cos(th); }

export function shape(s) { s = clamp(s, 0, 1); return 0.55 * s * s + 0.45 * Math.pow(smoothstep(0.7, 1, s), 1.6); }
export function rad(s, p) { return mix(p, R1, s); }
export function sOf(r, p) { return (r - p) / (R1 - p); }
export function mid(s, p) { const zm = ZI - 0.24 - (sag(p) - sag(P0)); return mix(zm, ZI - 0.66, shape(s)); }
// where the tissue bunches on dilation: most in the mid-periphery (the peripheral roll), less at the margin, some at the root
export function bunch(s) { return 0.35 + 0.9 * Math.exp(-(((s - 0.74) / 0.2) ** 2)); }
export function thick(s, p) {
  s = clamp(s, 0, 1);
  const t0 = 0.20 + 0.26 * smoothstep(0, 0.33, s) - 0.30 * smoothstep(0.35, 1, s);
  const k = (R1 - P0) / (R1 - p);
  return t0 * (1 + (k - 1) * bunch(s));
}
export function front(s, p) { return mid(s, p) + 0.5 * thick(s, p); }
// the pupillary portion bulges posteriorly onto the anterior lens capsule (iridolenticular contact)
export const contact = s => 0.10 * (1 - smoothstep(0, 0.3, s));
export function back(s, p) { return mid(s, p) - 0.5 * thick(s, p) - contact(s); }
// A point inside the slab at depth fraction d (0 = anterior surface, 1 = posterior surface), nominal pupil p.
export function inSlab(theta, s, d, p = P0) {
  const q = pth(theta, p);
  const r = rad(s, q), z = front(s, q) - d * thick(s, q);
  return [r * Math.cos(theta), r * Math.sin(theta), z];
}

// Sphincter pupillae ring for margin radius p: width/thickness from volume conservation (a constricted ring is short and fat).
export function sphincter(p) {
  const rm0 = P0 + 0.45, rm = p + 0.45;
  const k = Math.sqrt(rm0 / rm);
  const w = 0.8 * k, h = 0.12 * k;
  const rc = p + 0.05 + w / 2;
  return { w, h, rc, zc: back(sOf(rc, p), p) + 0.018 + h / 2 };
}

// Collarette line (s as a function of azimuth): wavy, zig-zagging ring about a third of the way to the root.
const tri = x => 2 * Math.abs(x - Math.floor(x) - 0.5) - 0.5;
// Smooth version (without the zig-zag teeth): the course of the minor arterial circle beneath it.
export function collaretteSmooth(th) {
  return 0.335 + 0.016 * Math.sin(5 * th + 0.7) + 0.010 * Math.sin(11 * th + 2.1) + 0.006 * Math.sin(23 * th + 0.3);
}
export function collaretteS(th) {
  return collaretteSmooth(th) + 0.05 * tri(36 * th / TAU + 0.13 * Math.sin(3 * th));
}

const f = x => x.toFixed(6);
export const GLSL_PROFILE = /* glsl */`
#define IR_P0 ${f(P0)}
#define IR_R1 ${f(R1)}
#define IR_ZI ${f(ZI)}
#define IR_LR ${f(LR)}
#define IR_PMAX ${f(PMAX)}
#define IR_DEC ${f(DEC)}
#define IR_TAU 6.28318530718
float irSag(float r){ return IR_LR - sqrt(IR_LR*IR_LR - r*r); }
float irPth(float th, float p){ return p * (1.0 + 0.012*sin(2.0*th + 0.7) + 0.008*sin(3.0*th + 2.1) + 0.005*sin(5.0*th + 0.4)) + IR_DEC*cos(th); }
float irShape(float s){ s = clamp(s, 0.0, 1.0); float a = smoothstep(0.7, 1.0, s); return 0.55*s*s + 0.45*pow(a, 1.6); }
float irRad(float s, float p){ return mix(p, IR_R1, s); }
float irMid(float s, float p){ float zm = IR_ZI - 0.24 - (irSag(p) - irSag(IR_P0)); return mix(zm, IR_ZI - 0.66, irShape(s)); }
float irThick(float s, float p){
  s = clamp(s, 0.0, 1.0);
  float t0 = 0.20 + 0.26*smoothstep(0.0, 0.33, s) - 0.30*smoothstep(0.35, 1.0, s);
  float k = (IR_R1 - IR_P0) / (IR_R1 - p);
  float b = (s - 0.74) / 0.2;
  return t0 * (1.0 + (k - 1.0) * (0.35 + 0.9*exp(-b*b)));
}
float irFront(float s, float p){ return irMid(s, p) + 0.5*irThick(s, p); }
float irBack(float s, float p){ return irMid(s, p) - 0.5*irThick(s, p) - 0.10*(1.0 - smoothstep(0.0, 0.3, s)); }
float irDil(float p){ return clamp((p - IR_P0) / (IR_PMAX - IR_P0), -1.0, 1.0); }
vec3 irPolar(float th, float r, float z){ return vec3(r*cos(th), r*sin(th), z); }
float irCollS(float th){ return 0.335 + 0.016*sin(5.0*th + 0.7) + 0.010*sin(11.0*th + 2.1) + 0.006*sin(23.0*th + 0.3); }
// Low-frequency topography of the anterior border layer (on top of the slab): a gentle plateau over the pupillary
// zone, the raised collarette crest, and the ciliary zone stepping down outside it (fading to zero at the root).
float irLow(float th, float s){
  float sc = irCollS(th);
  float d = (s - sc) / 0.055;
  float crest = 0.05 * exp(-d*d);
  float plateau = 0.018 * smoothstep(0.03, 0.14, s) * (1.0 - smoothstep(sc - 0.12, sc, s));
  float stepDown = -0.035 * smoothstep(sc, sc + 0.12, s) * (1.0 - s);
  return crest + plateau + stepDown;
}
float irFrontD(float th, float s, float p){ return irFront(s, p) + irLow(th, s); }
// Pupillary ruff: radius of the curl around the margin, and how far the stroma tucks under it (1 at the margin).
float irRuffRho(float p){ return 0.5*irThick(0.0, p) + 0.012; }
float irTuck(float r, float p){ return 1.0 - smoothstep(0.0, 1.0*irRuffRho(p), r - p); }
// Sphincter ring (see profile.js sphincter()) -> (w, h, rc, zc), p = local margin radius
vec4 irSphincter(float p){
  float k = sqrt((IR_P0 + 0.45) / (p + 0.45));
  float w = 0.8*k, h = 0.12*k, rc = p + 0.05 + 0.5*w;
  return vec4(w, h, rc, irBack((rc - p)/(IR_R1 - p), p) + 0.018 + 0.5*h);
}
// Concentric contraction furrows of the peripheral ciliary zone: long soft partial arcs with a wavy course.
// Each is a fold: a trough with a low crest on its peripheral side. Nearly flat at rest, pronounced when dilated.
float irFurrowMask(float th, float i){
  vec3 q = vec3(cos(th)*1.25 + i*3.1, sin(th)*1.25 - i*1.7, i*1.37);
  return smoothstep(0.28, 0.72, vnoise(q));
}
float irFurrowS(float i, float th){ return 0.60 + i*0.08 + 0.018*sin(th*2.0 + i*1.7) + 0.010*sin(th*5.0 - i*2.3) + 0.005*sin(th*9.0 + i); }
float irFurrowAmp(float p){ return 0.003 + 0.042*smoothstep(2.3, 3.8, p); }
#define IR_FURROW_MAX 0.045
// returns (height mm, d height / d s)
vec2 irFurrowHD(float th, float s, float amp, vec4 mA, float mB){
  vec2 h = vec2(0.0);
  for (int i = 0; i < 5; i++){
    float fi = float(i);
    float sig = 0.026 + 0.006*fi;
    float d = (s - irFurrowS(fi, th)) / sig;
    float m = i == 0 ? mA.x : i == 1 ? mA.y : i == 2 ? mA.z : i == 3 ? mA.w : mB;
    float e = amp * m * exp(-d*d);
    h.x -= e * (1.0 - 1.8*d);
    h.y += e * (1.8 + 2.0*d - 3.6*d*d) / sig;
  }
  return h;
}
vec4 irFurrowMasksA(float th){ return vec4(irFurrowMask(th, 0.0), irFurrowMask(th, 1.0), irFurrowMask(th, 2.0), irFurrowMask(th, 3.0)); }
float irFurrowMaskB(float th){ return irFurrowMask(th, 4.0); }
float irFurrowFull(float th, float s, float p){ return irFurrowHD(th, s, irFurrowAmp(p), irFurrowMasksA(th), irFurrowMaskB(th)).x; }
// Radial (structural) folds of the posterior pigment epithelium; the dilator sheet follows them.
// Irregular spacing (noise-warped phase) and depth, plus fine circular folds near the pupil.
float irPpeFold(float th, float s){
  vec2 c = vec2(cos(th), sin(th));
  float w = 9.0*vnoise(vec3(c*2.5, s*2.0)) + 4.0*vnoise(vec3(c*7.0, s*3.0 + 5.0));
  float f = 0.5 + 0.5*sin(th*56.0 + w);
  float depth = 0.45 + 0.9*vnoise(vec3(c*5.0, s*1.5 + 3.0));
  return 0.016*depth*f*f*smoothstep(0.1, 0.3, s)*(1.0 - smoothstep(0.9, 1.0, s))
       + 0.005*(0.5 + 0.5*sin(s*150.0 + 3.0*vnoise(vec3(c*3.0, s*4.0))))*(1.0 - smoothstep(0.08, 0.22, s));
}
`;
