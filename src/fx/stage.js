// Renderer, lights and a compact post pipeline:
//   scene → MSAA HDR target (+ depth/stencil texture)
//        → composite: depth-only SSAO (cavity darkening: sulci, orbit, teeth, muscle bellies) + background
//        → bloom (dissolve edges, section glow)
//        → final: ACES tone map, sRGB, vignette, fine grain, faint chromatic aberration.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const CompositeShader = {
  uniforms: {
    tColor: { value: null }, tDepth: { value: null },
    uInvProj: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() },
    uNear: { value: 0.05 }, uFar: { value: 5 },
    uRes: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 0.011 }, uAO: { value: 0.9 },
    uBg0: { value: new THREE.Color(0x07080a).convertSRGBToLinear() },
    uBg1: { value: new THREE.Color(0x1b1511).convertSRGBToLinear() },
    uBgCenter: { value: new THREE.Vector2(0.38, 0.55) }, uTime: { value: 0 }, uFade: { value: 1 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tColor; uniform sampler2D tDepth;
    uniform mat4 uInvProj; uniform mat4 uProj; uniform float uNear, uFar, uRadius, uAO, uTime, uFade;
    uniform vec2 uRes; uniform vec3 uBg0, uBg1; uniform vec2 uBgCenter;
    varying vec2 vUv;
    vec3 viewPos(vec2 uv, float d) { vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec4 v = uInvProj * c; return v.xyz / v.w; }
    float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
    void main() {
      vec4 col = texture2D(tColor, vUv);
      float d = texture2D(tDepth, vUv).r;
      // background: warm pool of light behind the head, falling to near black
      vec2 q = (vUv - uBgCenter) * vec2(uRes.x / uRes.y, 1.0);
      float r = length(q);
      vec3 bg = mix(uBg1, uBg0, smoothstep(0.0, 0.95, r)) * uFade;
      if (d >= 0.99999) { gl_FragColor = vec4(bg + col.rgb, 1.0); return; }
      vec3 P = viewPos(vUv, d);
      vec2 px = 1.0 / uRes;
      vec3 Px = viewPos(vUv + vec2(px.x, 0.0), texture2D(tDepth, vUv + vec2(px.x, 0.0)).r);
      vec3 Py = viewPos(vUv + vec2(0.0, px.y), texture2D(tDepth, vUv + vec2(0.0, px.y)).r);
      vec3 Pxm = viewPos(vUv - vec2(px.x, 0.0), texture2D(tDepth, vUv - vec2(px.x, 0.0)).r);
      vec3 Pym = viewPos(vUv - vec2(0.0, px.y), texture2D(tDepth, vUv - vec2(0.0, px.y)).r);
      vec3 dx = abs(Px.z - P.z) < abs(Pxm.z - P.z) ? Px - P : P - Pxm;
      vec3 dy = abs(Py.z - P.z) < abs(Pym.z - P.z) ? Py - P : P - Pym;
      vec3 N = normalize(cross(dx, dy));
      float rot = ign(gl_FragCoord.xy) * 6.2831853;
      vec3 T = normalize(abs(N.z) < 0.9 ? cross(N, vec3(0.0, 0.0, 1.0)) : cross(N, vec3(1.0, 0.0, 0.0)));
      vec3 B = cross(N, T);
      float occ = 0.0;
      const int NS = 14;
      for (int i = 0; i < NS; i++) {
        float fi = float(i);
        float a = rot + fi * 2.39996323;
        float h = (fi + 0.5) / float(NS);
        float s = sqrt(1.0 - h * h);
        vec3 k = (T * cos(a) * s + B * sin(a) * s + N * h) * mix(0.15, 1.0, h * h) ;
        vec3 S = P + k * uRadius;
        vec4 cp = uProj * vec4(S, 1.0); vec2 suv = cp.xy / cp.w * 0.5 + 0.5;
        if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) continue;
        float sd = texture2D(tDepth, suv).r;
        float sz = viewPos(suv, sd).z;
        float range = smoothstep(0.0, 1.0, uRadius / max(abs(P.z - sz), 1e-5));
        occ += (sz >= S.z + 0.0006 ? 1.0 : 0.0) * range;
      }
      float ao = 1.0 - occ / float(NS);
      ao = mix(1.0, pow(clamp(ao, 0.0, 1.0), 1.6), uAO);
      gl_FragColor = vec4(col.rgb * ao, 1.0);
    }`,
};

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uExposure: { value: 1.0 },
    uGrain: { value: 0.022 }, uVignette: { value: 1.0 }, uAberration: { value: 0.0012 }, uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse; uniform float uTime, uExposure, uGrain, uVignette, uAberration; uniform vec2 uRes;
    varying vec2 vUv;
    vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 ACES(vec3 color) {
      const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color *= uExposure / 0.6; color = ACESInputMat * color; color = RRTAndODTFit(color); color = ACESOutputMat * color; return clamp(color, 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec2 c = vUv - 0.5; float d = dot(c, c);
      vec2 off = c * uAberration * (0.3 + d * 4.0);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col = toSRGB(ACES(col));
      float vig = smoothstep(0.95, 0.12, d * uVignette * 1.55);
      col *= mix(0.62, 1.0, vig);
      float g = hash(floor(vUv * uRes)) - 0.5;   // static grain: a fixed film texture, no frame-to-frame flicker
      col += g * uGrain * (0.3 + 0.7 * (1.0 - dot(col, vec3(0.3333))));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: true, depth: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x000000, 1);
  renderer.autoClear = true;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(24, 16 / 9, 0.02, 6);

  // Light rig: one soft warm key high and to the left, a cool rim from behind-right, a low warm bounce and a faint hemisphere.
  const key = new THREE.DirectionalLight(0xfff6ef, 2.35);
  const rim = new THREE.DirectionalLight(0xa9c8ff, 1.0);
  const fill = new THREE.DirectionalLight(0xdfe4f0, 0.32);
  const hemi = new THREE.HemisphereLight(0x9aabc4, 0x14100d, 0.24);
  const lightRig = new THREE.Group();
  lightRig.add(key, rim, fill, hemi, key.target, rim.target, fill.target);
  scene.add(lightRig);
  const setLights = (sweep = 1) => {
    // sweep 0 → 1: the key travels from behind the head to its resting place (intro light sweep)
    const a = THREE.MathUtils.lerp(-2.6, -0.62, sweep);
    key.position.set(Math.sin(a) * 2, 2.2, Math.cos(a) * 2 + 0.3);
    rim.position.set(0.9, 0.7, -2.8);
    fill.position.set(0.6, -1.6, 2.2);
  };
  setLights(1);

  // ---- targets
  const size = new THREE.Vector2();
  const makeSceneRT = (w, h) => {
    const dt = new THREE.DepthTexture(w, h, THREE.UnsignedInt248Type);
    dt.format = THREE.DepthStencilFormat;
    return new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true, stencilBuffer: true, depthTexture: dt });
  };
  let sceneRT = makeSceneRT(4, 4);
  const postRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  const composite = new THREE.ShaderMaterial({ ...CompositeShader, uniforms: THREE.UniformsUtils.clone(CompositeShader.uniforms), depthTest: false, depthWrite: false });
  const final = new THREE.ShaderMaterial({ ...FinalShader, uniforms: THREE.UniformsUtils.clone(FinalShader.uniforms), depthTest: false, depthWrite: false });
  const quadC = new FullScreenQuad(composite), quadF = new FullScreenQuad(final);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.5, 1.35);

  let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let W = 1, H = 1;
  function resize() {
    W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    renderer.getDrawingBufferSize(size);
    sceneRT.setSize(size.x, size.y); postRT.setSize(size.x, size.y);
    bloom.setSize(size.x, size.y);
    composite.uniforms.uRes.value.copy(size); final.uniforms.uRes.value.copy(size);
    camera.aspect = W / H;
  }
  resize();
  window.addEventListener('resize', resize);

  function render(time, projectionShiftApplied = true) {
    composite.uniforms.uTime.value = time; final.uniforms.uTime.value = time;
    renderer.setRenderTarget(sceneRT);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    composite.uniforms.tColor.value = sceneRT.texture;
    composite.uniforms.tDepth.value = sceneRT.depthTexture;
    composite.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    composite.uniforms.uProj.value.copy(camera.projectionMatrix);
    composite.uniforms.uNear.value = camera.near; composite.uniforms.uFar.value = camera.far;
    renderer.setRenderTarget(postRT);
    quadC.render(renderer);
    bloom.render(renderer, null, postRT, 0.016, false);
    final.uniforms.tDiffuse.value = postRT.texture;
    renderer.setRenderTarget(null);
    quadF.render(renderer);
  }

  // compile against the HDR scene target so the programs match the ones used every frame (colour-space key)
  async function compile(timeoutMs = 9000) {
    renderer.setRenderTarget(sceneRT);
    const p = renderer.compileAsync(scene, camera, scene);
    await Promise.race([p, new Promise(r => setTimeout(r, timeoutMs))]);
    renderer.setRenderTarget(null);
  }

  return {
    THREE, renderer, scene, camera, bloom, composite, final, lights: { key, rim, fill, hemi }, setLights,
    resize, render, compile,
    get dpr() { return dpr; },
    setDPR(v) { v = Math.max(0.6, Math.min(v, Math.min(window.devicePixelRatio || 1, 2))); if (Math.abs(v - dpr) > 0.01) { dpr = v; resize(); } return dpr; },
    get size() { return { W, H, px: size.clone() }; },
  };
}
