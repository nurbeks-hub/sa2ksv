// Shared renderer / lighting / post-processing used by the main site and the dev harness,
// so every anatomy module is judged under the same light.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PALETTE } from '../config.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.03 },
    uVignette: { value: 0.9 },
    uAberration: { value: 0.0016 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uAberration; uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec2 c = vUv - 0.5;
      float d = dot(c, c);
      vec2 off = c * uAberration * (0.4 + d * 4.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float vig = smoothstep(0.95, 0.18, d * uVignette * 1.6);
      col *= mix(0.55, 1.0, vig);
      // static grain: a per-frame re-seeded hash read as screen flicker (measured 1.9/255 mean |ΔY| on the empty background)
      float g = hash(floor(vUv * uResolution) + 0.5) - 0.5;
      col += g * uGrain * (0.35 + 0.65 * (1.0 - dot(col, vec3(0.3333))));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createStage(canvas, { pixelRatioCap = 2 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(PALETTE.bg, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.bg);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.3;

  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.3, 4000);
  camera.position.set(0, 0, 60);

  // Light rig: warm key high-left-front, cool rim from behind, soft fill, and a small movable "cursor" light.
  const lights = new THREE.Group();
  const key = new THREE.DirectionalLight(0xfff1e0, 1.55); key.position.set(-40, 55, 70);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 1.25); rim.position.set(60, 20, -80);
  const under = new THREE.DirectionalLight(0xff9a7a, 0.35); under.position.set(10, -60, 20);
  const hemi = new THREE.HemisphereLight(0x8a9bb0, 0x0a0505, 0.14);
  const cursor = new THREE.PointLight(0xffffff, 0, 60, 1.6); cursor.position.set(0, 0, 30);
  lights.add(key, rim, under, hemi, cursor);
  scene.add(lights);

  const size = new THREE.Vector2();
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.22, 0.5, 0.93);
  const final = new ShaderPass(FinalShader);
  const output = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(final);

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(size);
    final.uniforms.uResolution.value.copy(size);
  }
  resize();
  window.addEventListener('resize', resize);

  return {
    THREE, renderer, scene, camera, composer, bloom, final, lights: { key, rim, under, hemi, cursor },
    resize,
    render(time) { final.uniforms.uTime.value = time; composer.render(); },
  };
}
