import "./style.css";
import * as THREE from "three";
import { WIND_X, WIND_Z, WORLD, RES, createHeightfield } from "./heightfield";
import {
  blurFrag,
  brightFrag,
  compositeFrag,
  duneFrag,
  duneVert,
  fullscreenVert,
  hazeFrag,
  particleFrag,
  particleVert,
  skyFrag,
  skyVert,
} from "./shaders";

const canvas = document.querySelector<HTMLCanvasElement>("#view");
if (!canvas) throw new Error("missing canvas");

const hourInput = document.querySelector<HTMLInputElement>("#hour")!;
const windInput = document.querySelector<HTMLInputElement>("#wind")!;
const hazeInput = document.querySelector<HTMLInputElement>("#haze")!;
const camBtn = document.querySelector<HTMLButtonElement>("#cam-toggle")!;
const soundBtn = document.querySelector<HTMLButtonElement>("#sound-toggle")!;
const clockEl = document.querySelector<HTMLElement>("#clock")!;
const windRead = document.querySelector<HTMLElement>("#wind-read")!;
const hazeRead = document.querySelector<HTMLElement>("#haze-read")!;
const camRead = document.querySelector<HTMLElement>("#cam-read")!;
const bearingRead = document.querySelector<HTMLElement>("#bearing-read")!;
const arrow = document.querySelector<SVGElement>("#arrow")!;
const hint = document.querySelector<HTMLElement>("#hint")!;
const fallback = document.querySelector<HTMLElement>("#fallback")!;

const tagCrest = document.querySelector<HTMLElement>("#tag-crest")!;
const tagSlip = document.querySelector<HTMLElement>("#tag-slip")!;
const tagTrough = document.querySelector<HTMLElement>("#tag-trough")!;

const mobile = Math.min(window.innerWidth, window.innerHeight) < 760;
const segments = mobile ? 180 : 320;
const particleCount = mobile ? 2200 : 5600;
const shadowSteps = mobile ? 10 : 18;

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
    stencil: false,
  });
} catch {
  fallback.hidden = false;
  throw new Error("WebGL2 unavailable");
}

if (!renderer.capabilities.isWebGL2) {
  fallback.hidden = false;
}

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearColor(0x000000, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.6));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.35, 480);

const field = createHeightfield();

const duneMat = new THREE.ShaderMaterial({
  vertexShader: duneVert,
  fragmentShader: duneFrag,
  uniforms: {
    uHeight: { value: field.texture },
    uSunDir: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color() },
    uSkyColor: { value: new THREE.Color() },
    uHorizonColor: { value: new THREE.Color() },
    uCamPos: { value: new THREE.Vector3() },
    uWorld: { value: WORLD },
    uTexSize: { value: RES },
    uTime: { value: 0 },
    uWind: { value: 1 },
    uWindDir: { value: new THREE.Vector2(WIND_X, WIND_Z) },
    uFogDensity: { value: 0.0115 },
    uShadowSteps: { value: shadowSteps },
  },
});
duneMat.toneMapped = false;

const duneGeo = new THREE.PlaneGeometry(WORLD, WORLD, segments, segments);
duneGeo.rotateX(-Math.PI / 2);
const dunes = new THREE.Mesh(duneGeo, duneMat);
scene.add(dunes);

const skyMat = new THREE.ShaderMaterial({
  vertexShader: skyVert,
  fragmentShader: skyFrag,
  uniforms: {
    uSunDir: { value: new THREE.Vector3() },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
    uTime: { value: 0 },
    uElev: { value: 0.3 },
  },
  side: THREE.BackSide,
  depthWrite: false,
});
skyMat.toneMapped = false;
const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), skyMat);
sky.frustumCulled = false;
scene.add(sky);

type Particle = {
  positions: Float32Array;
  seeds: Float32Array;
  sizes: Float32Array;
  speeds: Float32Array;
  salt: Uint8Array;
  geo: THREE.BufferGeometry;
};

function makeParticles(): Particle {
  const positions = new Float32Array(particleCount * 3);
  const seeds = new Float32Array(particleCount);
  const sizes = new Float32Array(particleCount);
  const speeds = new Float32Array(particleCount);
  const salt = new Uint8Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    seeds[i] = Math.random();
    salt[i] = Math.random() < 0.74 ? 1 : 0;
    sizes[i] = salt[i] ? 9 + Math.random() * 14 : 22 + Math.random() * 36;
    speeds[i] = salt[i] ? 7 + Math.random() * 11 : 2.2 + Math.random() * 4.5;
    respawn(i, positions, seeds, salt, 0, 0, true);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  return { positions, seeds, sizes, speeds, salt, geo };
}

function respawn(
  i: number,
  positions: Float32Array,
  seeds: Float32Array,
  salt: Uint8Array,
  cx: number,
  cz: number,
  scatter: boolean,
): void {
  const across = (Math.random() - 0.5) * (scatter ? 90 : 50);
  const along = scatter ? (Math.random() - 0.5) * 90 : -8 - Math.random() * 36;
  const x = cx + WIND_X * along - WIND_Z * across;
  const z = cz + WIND_Z * along + WIND_X * across;
  const h = field.sample(x, z);
  const y = salt[i]
    ? h + 0.12 + Math.random() * 1.5
    : h + 1.8 + Math.random() * 11;
  positions[i * 3] = x;
  positions[i * 3 + 1] = y;
  positions[i * 3 + 2] = z;
  seeds[i] = Math.random();
}

const parts = makeParticles();
const particleMat = new THREE.ShaderMaterial({
  vertexShader: particleVert,
  fragmentShader: particleFrag,
  uniforms: {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uWindScreen: { value: new THREE.Vector2(1, 0) },
    uIntensity: { value: 0.85 },
  },
  transparent: true,
  depthWrite: false,
  blending: THREE.NormalBlending,
});
particleMat.toneMapped = false;
const points = new THREE.Points(parts.geo, particleMat);
scene.add(points);

const postScene = new THREE.Scene();
const postCam = new THREE.Camera();
const quadGeo = new THREE.PlaneGeometry(2, 2);

function passMat(fragment: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert,
    fragmentShader: fragment,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  mat.toneMapped = false;
  return mat;
}

const hazeMat = passMat(hazeFrag, {
  tColor: { value: null },
  tDepth: { value: null },
  uTime: { value: 0 },
  uHaze: { value: 0.9 },
  uNear: { value: camera.near },
  uFar: { value: camera.far },
});
const brightMat = passMat(brightFrag, { tColor: { value: null } });
const blurMat = passMat(blurFrag, {
  tColor: { value: null },
  uDir: { value: new THREE.Vector2() },
});
const compositeMat = passMat(compositeFrag, {
  tColor: { value: null },
  tBloom: { value: null },
  uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
  uSunVis: { value: 0 },
  uRayStrength: { value: 0.6 },
  uTime: { value: 0 },
  uExposure: { value: 1.05 },
});

const quad = new THREE.Mesh(quadGeo, compositeMat);
quad.frustumCulled = false;
postScene.add(quad);

let sceneRT: THREE.WebGLRenderTarget;
let hazeRT: THREE.WebGLRenderTarget;
let brightRT: THREE.WebGLRenderTarget;
let blurRT: THREE.WebGLRenderTarget;

function makeTarget(w: number, h: number, depth: boolean): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: depth,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
  });
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
  if (depth) {
    rt.depthTexture = new THREE.DepthTexture(w, h);
    rt.depthTexture.type = THREE.UnsignedIntType;
  }
  return rt;
}

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  particleMat.uniforms.uResolution.value.set(w, h);

  sceneRT?.dispose();
  hazeRT?.dispose();
  brightRT?.dispose();
  blurRT?.dispose();
  const pr = renderer.getPixelRatio();
  const rw = Math.max(2, Math.floor(w * pr));
  const rh = Math.max(2, Math.floor(h * pr));
  sceneRT = makeTarget(rw, rh, true);
  hazeRT = makeTarget(rw, rh, false);
  const bw = Math.max(2, Math.floor(rw / 3));
  const bh = Math.max(2, Math.floor(rh / 3));
  brightRT = makeTarget(bw, bh, false);
  blurRT = makeTarget(bw, bh, false);
}

window.addEventListener("resize", resize);
resize();

type Mode = "cinematic" | "free";
const state = {
  hour: Number(hourInput.value),
  wind: Number(windInput.value),
  haze: Number(hazeInput.value),
  mode: "cinematic" as Mode,
  sound: false,
};

hourInput.addEventListener("input", () => {
  state.hour = Number(hourInput.value);
});
windInput.addEventListener("input", () => {
  state.wind = Number(windInput.value);
});
hazeInput.addEventListener("input", () => {
  state.haze = Number(hazeInput.value);
});

function setMode(mode: Mode): void {
  const changed = state.mode !== mode;
  state.mode = mode;
  const cinematic = mode === "cinematic";
  camBtn.setAttribute("aria-pressed", cinematic ? "true" : "false");
  camBtn.textContent = cinematic ? "Free look" : "Cinematic";
  camRead.textContent = cinematic ? "cinematic" : "free look";
  if (!cinematic && changed) enterFree();
}

camBtn.addEventListener("click", () => {
  setMode(state.mode === "cinematic" ? "free" : "cinematic");
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === "c" || event.key === "C") {
    setMode(state.mode === "cinematic" ? "free" : "cinematic");
  } else if (event.key === "h" || event.key === "H") {
    document.body.classList.toggle("ui-hidden");
  } else if (event.key === "m" || event.key === "M") {
    toggleSound();
  }
});

const fromBearing = (() => {
  let deg = (Math.atan2(-WIND_X, -WIND_Z) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
})();
const towardDeg = (Math.atan2(WIND_X, WIND_Z) * 180) / Math.PI;
bearingRead.textContent = `${Math.round(fromBearing)}°`;
arrow.style.transform = `rotate(${towardDeg}deg)`;

type Shot = {
  t: number;
  x: number;
  z: number;
  lift: number;
  lx: number;
  lz: number;
  fov: number;
};

const SHOTS: Shot[] = [
  { t: 0, x: 4, z: -8, lift: 2.6, lx: -10, lz: 22, fov: 36 },
  { t: 0.16, x: -2, z: 6, lift: 2.3, lx: -18, lz: 28, fov: 30 },
  { t: 0.32, x: 10, z: 14, lift: 3.2, lx: -8, lz: 36, fov: 34 },
  { t: 0.48, x: 6, z: -2, lift: 15, lx: -16, lz: 20, fov: 50 },
  { t: 0.64, x: 14, z: -14, lift: 2.5, lx: -4, lz: 12, fov: 28 },
  { t: 0.8, x: 0, z: 16, lift: 5.4, lx: -20, lz: 4, fov: 40 },
  { t: 0.92, x: 8, z: -4, lift: 3.0, lx: -12, lz: 20, fov: 33 },
  { t: 1, x: 4, z: -8, lift: 2.6, lx: -10, lz: 22, fov: 36 },
];

const LOOP = 78;
const rawOffset = Number(new URLSearchParams(location.search).get("t"));
const timeOffset = Number.isFinite(rawOffset) ? rawOffset : 0;
const desiredPos = new THREE.Vector3();
const desiredLook = new THREE.Vector3();
const lookAt = new THREE.Vector3(16, 4, 0);
const spherical = new THREE.Spherical(28, 1.05, 0.4);
const orbitTarget = new THREE.Vector3(12, 4, 4);
const offset = new THREE.Vector3();
const sunDir = new THREE.Vector3();
const sunWorld = new THREE.Vector3();
const windWorld = new THREE.Vector3(WIND_X, 0, WIND_Z);
const windScreen = new THREE.Vector3();
const tmp = new THREE.Vector3();

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function palette(hour: number): {
  zenith: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
  exposure: number;
  fog: number;
  elev: number;
} {
  const day = Math.min(1, Math.max(0, (hour - 6.2) / 12.6));
  const elev = Math.sin(day * Math.PI);
  const golden = smoothstep(14.6, 17.2, hour) * (1 - smoothstep(18.5, 19.2, hour));
  const noon = smoothstep(10.2, 12, hour) * (1 - smoothstep(13.4, 15.4, hour));
  const zenith = new THREE.Color().setRGB(
    mix(0.15, 0.30, noon) + golden * 0.06,
    mix(0.22, 0.46, noon),
    mix(0.46, 0.78, noon) - golden * 0.14,
  );
  const horizon = new THREE.Color().setRGB(
    mix(0.86, 1.05, golden),
    mix(0.48, 0.62, golden) + noon * 0.16,
    mix(0.28, 0.22, golden) + noon * 0.42,
  );
  const sun = new THREE.Color().setRGB(
    1,
    mix(0.72, 0.94, noon),
    mix(0.38, 0.78, noon),
  );
  const exposure = mix(1.02, 1.12, noon) + golden * 0.08;
  const fog = 0.0065 + golden * 0.003;
  return { zenith, horizon, sun, exposure, fog, elev };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function updateSun(hour: number): number {
  const day = Math.min(1, Math.max(0, (hour - 6.2) / 12.6));
  const elev = Math.max(0.11, Math.sin(day * Math.PI) * 0.78);
  const az = Math.PI * 1.04 + (hour - 17.5) * 0.2;
  sunDir.set(
    Math.cos(elev) * Math.cos(az),
    Math.sin(elev),
    Math.cos(elev) * Math.sin(az),
  ).normalize();
  return elev;
}

function pathPose(u: number): void {
  const t = ((u % 1) + 1) % 1;
  let i = 0;
  while (i < SHOTS.length - 2 && SHOTS[i + 1].t < t) i++;
  const a = SHOTS[i];
  const b = SHOTS[i + 1];
  const f = smooth((t - a.t) / Math.max(0.0001, b.t - a.t));
  const x = mix(a.x, b.x, f);
  const z = mix(a.z, b.z, f);
  const y = field.sample(x, z) + mix(a.lift, b.lift, f);
  const lx = mix(a.lx, b.lx, f);
  const lz = mix(a.lz, b.lz, f);
  const ly = field.sample(lx, lz) + 2.4;
  desiredPos.set(
    x + Math.sin(performance.now() * 0.0007) * 0.12,
    y + Math.sin(performance.now() * 0.0013) * 0.05,
    z,
  );
  desiredLook.set(lx, ly, lz);
  camera.fov = mix(a.fov, b.fov, f);
}

function enterFree(): void {
  orbitTarget.copy(lookAt);
  offset.copy(camera.position).sub(orbitTarget);
  if (offset.lengthSq() < 1) offset.set(12, 6, 12);
  spherical.setFromVector3(offset);
  spherical.phi = Math.min(1.35, Math.max(0.22, spherical.phi));
}

let dragging = false;
let lastX = 0;
let lastY = 0;
let pinch = 0;

canvas.addEventListener("pointerdown", (event) => {
  dragging = true;
  lastX = event.clientX;
  lastY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const dx = event.clientX - lastX;
  const dy = event.clientY - lastY;
  if (dx * dx + dy * dy < 4) return;
  lastX = event.clientX;
  lastY = event.clientY;
  if (state.mode === "cinematic") setMode("free");
  spherical.theta -= dx * 0.005;
  spherical.phi = Math.min(1.32, Math.max(0.22, spherical.phi + dy * 0.0032));
});

window.addEventListener("pointerup", () => {
  dragging = false;
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (state.mode === "cinematic") setMode("free");
    spherical.radius = Math.min(78, Math.max(5, spherical.radius * Math.exp(event.deltaY * 0.0011)));
  },
  { passive: false },
);

canvas.addEventListener("dblclick", () => setMode("cinematic"));

canvas.addEventListener(
  "touchmove",
  (event) => {
    if (event.touches.length === 2) {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      const d = Math.hypot(dx, dy);
      if (pinch > 0) {
        spherical.radius = Math.min(78, Math.max(5, spherical.radius - (d - pinch) * 0.06));
      }
      pinch = d;
    }
  },
  { passive: false },
);
canvas.addEventListener("touchend", () => {
  pinch = 0;
});

setTimeout(() => hint.classList.add("hide"), 6400);

type WindAudio = {
  ctx: AudioContext;
  filter: BiquadFilterNode;
  gain: GainNode;
};

let audio: WindAudio | null = null;

function toggleSound(): void {
  if (!audio) {
    const ctx = new AudioContext();
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    audio = { ctx, filter, gain };
  }
  state.sound = !state.sound;
  if (state.sound) {
    void audio.ctx.resume();
    audio.gain.gain.cancelScheduledValues(audio.ctx.currentTime);
    audio.gain.gain.linearRampToValueAtTime(0.045, audio.ctx.currentTime + 0.6);
  } else {
    audio.gain.gain.cancelScheduledValues(audio.ctx.currentTime);
    audio.gain.gain.linearRampToValueAtTime(0, audio.ctx.currentTime + 0.25);
  }
  soundBtn.setAttribute("aria-pressed", state.sound ? "true" : "false");
  soundBtn.textContent = state.sound ? "Mute wind" : "Wind audio";
}

soundBtn.addEventListener("click", toggleSound);

function formatHour(hour: number): string {
  const h24 = Math.floor(hour);
  const m = Math.floor((hour - h24) * 60);
  return `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function projectTag(el: HTMLElement, x: number, z: number, lift: number): void {
  const y = field.sample(x, z) + lift;
  tmp.set(x, y, z).project(camera);
  const behind = tmp.z > 1;
  const sx = tmp.x * 0.5 + 0.5;
  const sy = -tmp.y * 0.5 + 0.5;
  const visible = !behind && sx > 0.04 && sx < 0.96 && sy > 0.16 && sy < 0.78;
  el.classList.toggle("show", visible && !document.body.classList.contains("ui-hidden"));
  el.style.left = `${sx * 100}%`;
  el.style.top = `${sy * 100}%`;
}

function blit(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
  quad.material = material;
  renderer.setRenderTarget(target);
  renderer.render(postScene, postCam);
}

const camForward = new THREE.Vector3();
let slowFrames = 0;
let last = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const time = now * 0.001 + timeOffset;

  if (dt > 0.045) slowFrames++;
  else slowFrames = Math.max(0, slowFrames - 1);
  if (slowFrames > 40 && renderer.getPixelRatio() > 1) {
    renderer.setPixelRatio(1);
    resize();
    slowFrames = 0;
  }

  const hour = state.hour;
  const elev = updateSun(hour);
  const colors = palette(hour);
  const gust = 1 + 0.1 * Math.sin(time * 0.37) + 0.05 * Math.sin(time * 1.17);
  const wind = state.wind * gust;

  if (state.mode === "cinematic") {
    pathPose((time % LOOP) / LOOP);
    const k = 1 - Math.exp(-dt * 1.35);
    camera.position.lerp(desiredPos, k);
    lookAt.lerp(desiredLook, 1 - Math.exp(-dt * 1.8));
    camera.lookAt(lookAt);
  } else {
    offset.setFromSpherical(spherical);
    desiredPos.copy(orbitTarget).add(offset);
    const ground = field.sample(desiredPos.x, desiredPos.z);
    if (desiredPos.y < ground + 1.35) desiredPos.y = ground + 1.35;
    camera.position.lerp(desiredPos, 1 - Math.exp(-dt * 5));
    camera.lookAt(orbitTarget);
    lookAt.copy(orbitTarget);
  }
  camera.updateProjectionMatrix();

  const posAttr = parts.geo.getAttribute("position") as THREE.BufferAttribute;
  const arr = posAttr.array as Float32Array;
  for (let i = 0; i < particleCount; i++) {
    const ix = i * 3;
    arr[ix] += WIND_X * parts.speeds[i] * wind * dt;
    arr[ix + 2] += WIND_Z * parts.speeds[i] * wind * dt;
    const turb = Math.sin(time * 1.6 + parts.seeds[i] * 40) * dt * (parts.salt[i] ? 0.8 : 0.4);
    arr[ix] += -WIND_Z * turb;
    arr[ix + 2] += WIND_X * turb;
    const h = field.sample(arr[ix], arr[ix + 2]);
    if (parts.salt[i]) {
      const bob = Math.sin(time * 6.5 + parts.seeds[i] * 20) * 0.35;
      const target = h + 0.25 + bob + parts.seeds[i] * 0.8;
      arr[ix + 1] += (target - arr[ix + 1]) * Math.min(1, dt * 4);
    } else {
      arr[ix + 1] += Math.sin(time * 0.8 + parts.seeds[i] * 12) * dt * 0.25;
    }
    const dx = arr[ix] - camera.position.x;
    const dz = arr[ix + 2] - camera.position.z;
    if (dx * dx + dz * dz > 70 * 70 || arr[ix + 1] < h) {
      respawn(i, arr, parts.seeds, parts.salt, camera.position.x, camera.position.z, false);
    }
  }
  posAttr.needsUpdate = true;

  camera.getWorldDirection(camForward);
  windScreen.copy(windWorld).project(camera);
  const windOrigin = camera.position.clone().project(camera);
  particleMat.uniforms.uWindScreen.value.set(windScreen.x - windOrigin.x, windScreen.y - windOrigin.y);
  particleMat.uniforms.uTime.value = time;
  particleMat.uniforms.uIntensity.value = 0.75 + wind * 0.4;

  duneMat.uniforms.uSunDir.value.copy(sunDir);
  duneMat.uniforms.uSunColor.value.copy(colors.sun);
  duneMat.uniforms.uSkyColor.value.copy(colors.zenith);
  duneMat.uniforms.uHorizonColor.value.copy(colors.horizon);
  duneMat.uniforms.uCamPos.value.copy(camera.position);
  duneMat.uniforms.uTime.value = time;
  duneMat.uniforms.uWind.value = wind;
  duneMat.uniforms.uFogDensity.value = colors.fog;

  sky.position.copy(camera.position);
  skyMat.uniforms.uSunDir.value.copy(sunDir);
  skyMat.uniforms.uZenith.value.copy(colors.zenith);
  skyMat.uniforms.uHorizon.value.copy(colors.horizon);
  skyMat.uniforms.uSunColor.value.copy(colors.sun);
  skyMat.uniforms.uTime.value = time;
  skyMat.uniforms.uElev.value = elev;

  renderer.setRenderTarget(sceneRT);
  renderer.render(scene, camera);

  hazeMat.uniforms.tColor.value = sceneRT.texture;
  hazeMat.uniforms.tDepth.value = sceneRT.depthTexture;
  hazeMat.uniforms.uTime.value = time;
  hazeMat.uniforms.uHaze.value = state.haze;
  blit(hazeMat, hazeRT);

  brightMat.uniforms.tColor.value = hazeRT.texture;
  blit(brightMat, brightRT);

  const bw = brightRT.width;
  const bh = brightRT.height;
  blurMat.uniforms.tColor.value = brightRT.texture;
  blurMat.uniforms.uDir.value.set((1.6 / bw) * 1.35, 0);
  blit(blurMat, blurRT);
  blurMat.uniforms.tColor.value = blurRT.texture;
  blurMat.uniforms.uDir.value.set(0, 1.6 / bh);
  blit(blurMat, brightRT);

  sunWorld.copy(camera.position).addScaledVector(sunDir, 200);
  sunWorld.project(camera);
  compositeMat.uniforms.tColor.value = hazeRT.texture;
  compositeMat.uniforms.tBloom.value = brightRT.texture;
  compositeMat.uniforms.uSunUv.value.set(sunWorld.x * 0.5 + 0.5, sunWorld.y * 0.5 + 0.5);
  compositeMat.uniforms.uSunVis.value = camForward.dot(sunDir) > 0.05 ? 1 : 0;
  compositeMat.uniforms.uRayStrength.value = (0.7 - Math.min(elev, 0.45)) * 0.55;
  compositeMat.uniforms.uTime.value = time;
  compositeMat.uniforms.uExposure.value = colors.exposure;
  blit(compositeMat, null);

  projectTag(tagCrest, field.crest.x, field.crest.z, 2.2);
  projectTag(tagSlip, field.slipPoint.x, field.slipPoint.z, 1.6);
  projectTag(tagTrough, field.trough.x, field.trough.z, 1.4);

  clockEl.textContent = formatHour(hour);
  windRead.textContent = `${(9.6 * wind).toFixed(1)} m/s`;
  const hazeLabel = state.haze < 0.25 ? "clear" : state.haze < 0.7 ? "shimmer" : "mirage";
  hazeRead.textContent = hazeLabel;

  if (audio && state.sound) {
    audio.filter.frequency.value = 280 + wind * 160;
    audio.gain.gain.setTargetAtTime(0.03 + wind * 0.012, audio.ctx.currentTime, 0.2);
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
