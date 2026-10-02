export const duneVert = /* glsl */ `
uniform sampler2D uHeight;
varying vec2 vUv;
varying vec3 vWorld;
varying float vHeight;

void main() {
  vUv = uv;
  float h = texture2D(uHeight, uv).r;
  vec3 p = position;
  p.y += h;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vHeight = h;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const duneFrag = /* glsl */ `
precision highp float;

uniform sampler2D uHeight;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uCamPos;
uniform float uWorld;
uniform float uTexSize;
uniform float uTime;
uniform float uWind;
uniform vec2 uWindDir;
uniform float uFogDensity;
uniform int uShadowSteps;

varying vec2 vUv;
varying vec3 vWorld;
varying float vHeight;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float ripple(vec2 xz) {
  float a = dot(xz, uWindDir);
  float r = sin(a * 1.65 + uTime * uWind * 0.62);
  r += sin(a * 4.4 - uTime * uWind * 1.35 + 1.7) * 0.45;
  r += sin(a * 9.5 + uTime * uWind * 0.4) * 0.15;
  return r;
}

void main() {
  float worldStep = uWorld / uTexSize;
  vec2 e = vec2(1.0 / uTexSize, 0.0);
  float hxp = texture2D(uHeight, vUv + vec2(e.x, 0.0)).r;
  float hxm = texture2D(uHeight, vUv - vec2(e.x, 0.0)).r;
  float hzp = texture2D(uHeight, vUv - vec2(0.0, e.x)).r;
  float hzm = texture2D(uHeight, vUv + vec2(0.0, e.x)).r;
  float dx = (hxp - hxm) / (2.0 * worldStep);
  float dz = (hzp - hzm) / (2.0 * worldStep);

  float ripScale = 0.22;
  float r0 = ripple(vWorld.xz) * ripScale;
  float rx = ripple(vWorld.xz + vec2(0.35, 0.0)) * ripScale;
  float rz = ripple(vWorld.xz + vec2(0.0, 0.35)) * ripScale;
  dx += (rx - r0) / 0.35;
  dz += (rz - r0) / 0.35;

  float grainFw = fwidth(vWorld.x) * 40.0;
  float grain = hash(floor(vWorld.xz * 38.0)) - 0.5;
  grain *= smoothstep(1.4, 0.15, grainFw);
  dx += grain * 0.28;
  dz += grain * 0.16;

  vec3 N = normalize(vec3(-dx, 1.0, -dz));
  vec3 V = normalize(uCamPos - vWorld);
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);

  vec4 texel = texture2D(uHeight, vUv);
  float albedoN = texel.g;
  float slip = texel.b;

  float ndotl = dot(N, L);
  float wrap = clamp((ndotl + 0.22) / 1.22, 0.0, 1.0);
  float sunTerm = clamp(ndotl, 0.0, 1.0);

  float shadow = 1.0;
  float slope = L.y / max(length(L.xz), 0.0001);
  vec2 sunXZ = normalize(L.xz + vec2(1e-5));
  vec2 uvStep = sunXZ * 1.55 / uWorld;
  float jitter = hash(gl_FragCoord.xy) * 0.85;
  for (int i = 1; i <= 24; i++) {
    if (i > uShadowSteps) break;
    float fi = float(i) + jitter;
    vec2 u = vUv + uvStep * fi;
    if (u.x < 0.0 || u.y < 0.0 || u.x > 1.0 || u.y > 1.0) break;
    float hs = texture2D(uHeight, u).r;
    float rayH = vHeight + 0.42 + slope * 1.55 * fi;
    if (hs > rayH) {
      shadow = 0.0;
      break;
    }
  }

  vec3 sandLit = vec3(0.95, 0.78, 0.52);
  vec3 sandMid = vec3(0.68, 0.45, 0.26);
  vec3 sandSlip = vec3(0.40, 0.20, 0.11);
  vec3 albedo = mix(sandMid, sandLit, smoothstep(-0.05, 0.65, ndotl));
  albedo = mix(albedo, sandSlip, slip * 0.8);
  albedo *= mix(0.8, 1.14, albedoN);
  albedo *= mix(0.94, 1.06, grain * 0.5 + 0.5);

  float ao = 1.0;
  ao -= clamp(texture2D(uHeight, vUv + vec2(e.x * 3.0, 0.0)).r - vHeight, 0.0, 2.0) * 0.12;
  ao -= clamp(texture2D(uHeight, vUv - vec2(e.x * 3.0, 0.0)).r - vHeight, 0.0, 2.0) * 0.12;
  ao -= clamp(texture2D(uHeight, vUv + vec2(0.0, e.x * 3.0)).r - vHeight, 0.0, 2.0) * 0.12;
  ao -= clamp(texture2D(uHeight, vUv - vec2(0.0, e.x * 3.0)).r - vHeight, 0.0, 2.0) * 0.12;
  ao = clamp(ao, 0.55, 1.0);

  vec3 skyAmb = mix(vec3(0.34, 0.22, 0.14), uSkyColor, clamp(N.y * 0.55 + 0.35, 0.0, 1.0));
  vec3 col = albedo * uSunColor * sunTerm * shadow * 2.65;
  col += albedo * skyAmb * (0.14 + wrap * 0.06);
  col += albedo * vec3(0.16, 0.07, 0.04) * (1.0 - shadow);

  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 42.0) * sunTerm * shadow;
  float glitter = step(0.86, hash(floor(vWorld.xz * 22.0 + uTime * 0.15))) * spec;
  col += vec3(1.0, 0.92, 0.75) * (spec * 0.22 + glitter * 1.6);

  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  float crest = smoothstep(2.0, 9.0, vHeight) * (1.0 - slip);
  col += vec3(1.0, 0.82, 0.58) * rim * crest * 0.22 * shadow;

  float dist = distance(vWorld, uCamPos);
  float fog = 1.0 - exp(-dist * uFogDensity);
  fog = clamp(fog, 0.0, 1.0);
  float heightFog = exp(-max(vWorld.y, 0.0) * 0.02) * smoothstep(55.0, 170.0, dist);
  fog = max(fog, heightFog * 0.65);
  vec2 edgeUv = abs(vUv - 0.5) * 2.0;
  float border = smoothstep(0.8, 0.995, max(edgeUv.x, edgeUv.y));
  fog = max(fog, border);
  vec3 fogCol = mix(uHorizonColor, uSkyColor, smoothstep(30.0, 140.0, dist) * 0.28);
  col = mix(col, fogCol, fog);

  gl_FragColor = vec4(col, 1.0);
}
`;

export const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const skyFrag = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uElev;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float a = 0.0;
  float w = 0.5;
  for (int i = 0; i < 5; i++) {
    a += noise(p) * w;
    p *= 2.05;
    w *= 0.5;
  }
  return a;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  float low = exp(-max(h, -0.02) * 2.4);
  float mid = exp(-max(h, 0.0) * 6.5);
  vec3 sky = mix(uZenith, uHorizon, clamp(low, 0.0, 1.0));
  sky += uHorizon * mid * 0.35;

  if (h < 0.0) {
    sky = mix(uHorizon, uHorizon * vec3(0.62, 0.42, 0.28), clamp(-h * 3.0, 0.0, 1.0));
  }

  float sun = dot(dir, normalize(uSunDir));
  float disc = smoothstep(0.9986, 0.99945, sun);
  float limb = smoothstep(0.996, 0.9992, sun);
  float glowPow = mix(5.0, 28.0, clamp(uElev * 1.4, 0.0, 1.0));
  float glow = pow(clamp(sun, 0.0, 1.0), glowPow);
  float wide = pow(clamp(sun, 0.0, 1.0), 2.2);
  sky += uSunColor * (disc * 18.0 + limb * 1.6 + glow * 1.7 + wide * 0.18);

  float up = max(dir.y, 0.02);
  vec2 cuv = dir.xz / up * 0.22 + vec2(uTime * 0.004, 0.0);
  float cloud = fbm(cuv);
  cloud = smoothstep(0.55, 0.82, cloud);
  cloud *= smoothstep(0.02, 0.22, dir.y);
  cloud *= smoothstep(0.85, 0.35, dir.y);
  vec3 cloudCol = mix(uHorizon, vec3(1.0, 0.96, 0.90), 0.55);
  sky = mix(sky, cloudCol, cloud * 0.42);

  gl_FragColor = vec4(sky, 1.0);
}
`;

export const particleVert = /* glsl */ `
attribute float aSeed;
attribute float aSize;
uniform float uTime;
uniform vec2 uResolution;
varying float vSeed;
varying float vFade;

void main() {
  vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.4);
  gl_PointSize = aSize * (uResolution.y / 720.0) * (92.0 / dist);
  gl_PointSize = clamp(gl_PointSize, 1.0, 64.0);
  vSeed = aSeed;
  vFade = smoothstep(70.0, 12.0, dist);
}
`;

export const particleFrag = /* glsl */ `
precision highp float;
uniform vec2 uWindScreen;
uniform float uIntensity;
varying float vSeed;
varying float vFade;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float ang = atan(uWindScreen.y, uWindScreen.x);
  float c = cos(ang);
  float s = sin(ang);
  vec2 r = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
  r.x /= mix(0.28, 0.62, fract(vSeed * 7.13));
  float d = length(r);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.05, d) * vFade;
  a *= mix(0.35, 1.0, fract(vSeed * 3.7));
  vec3 col = mix(vec3(0.78, 0.58, 0.34), vec3(1.0, 0.90, 0.68), fract(vSeed * 13.1));
  gl_FragColor = vec4(col * a * uIntensity, a * 0.85);
}
`;

export const fullscreenVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const hazeFrag = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform float uTime;
uniform float uHaze;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;

float viewZ(float depth) {
  float z = depth * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

void main() {
  float depth = texture2D(tDepth, vUv).x;
  float dist = viewZ(depth);
  float heat = smoothstep(6.0, 55.0, dist);
  float band = exp(-pow((vUv.y - 0.46) * 5.5, 2.0));
  heat *= mix(0.25, 1.0, band);
  heat *= uHaze;
  float wob = sin(vUv.y * 160.0 + uTime * 2.6) * 0.0016;
  wob += sin(vUv.y * 54.0 - uTime * 1.35 + sin(vUv.x * 18.0 + uTime)) * 0.0034;
  wob += sin(vUv.x * 30.0 + uTime * 0.8) * 0.0008;
  vec2 offset = vec2(wob, wob * 0.28) * heat * 2.4;
  vec3 col;
  col.r = texture2D(tColor, vUv + offset * 1.15).r;
  col.g = texture2D(tColor, vUv + offset).g;
  col.b = texture2D(tColor, vUv + offset * 0.82).b;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const brightFrag = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float m = smoothstep(1.35, 2.6, l);
  gl_FragColor = vec4(c * m, 1.0);
}
`;

export const blurFrag = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb * 0.227027;
  c += texture2D(tColor, vUv + uDir * 1.384615).rgb * 0.316216;
  c += texture2D(tColor, vUv - uDir * 1.384615).rgb * 0.316216;
  c += texture2D(tColor, vUv + uDir * 3.230769).rgb * 0.070270;
  c += texture2D(tColor, vUv - uDir * 3.230769).rgb * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}
`;

export const compositeFrag = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform vec2 uSunUv;
uniform float uSunVis;
uniform float uRayStrength;
uniform float uTime;
uniform float uExposure;
varying vec2 vUv;

vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  col += bloom * 0.45;

  float rays = 0.0;
  if (uSunVis > 0.5) {
    vec2 toSun = uSunUv - vUv;
    float distS = length(toSun);
    vec2 stepv = toSun / 16.0;
    vec2 p = vUv;
    float acc = 0.0;
    for (int i = 0; i < 16; i++) {
      p += stepv;
      vec2 q = clamp(p, 0.001, 0.999);
      acc += dot(texture2D(tColor, q).rgb, vec3(0.333));
    }
    rays = (acc / 16.0) * exp(-distS * 1.35) * uRayStrength;
  }
  col += vec3(1.0, 0.74, 0.46) * rays * 0.42;

  col *= uExposure;
  col = aces(col);

  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col * vec3(1.02, 0.90, 0.78), col * vec3(1.05, 0.99, 0.93), smoothstep(0.08, 0.7, luma));

  float vig = smoothstep(1.25, 0.42, length((vUv - 0.5) * vec2(1.05, 1.0)));
  col *= mix(0.78, 1.0, vig);

  float grain = hash(gl_FragCoord.xy + fract(uTime * 13.0) * 80.0) - 0.5;
  col += grain * 0.02;

  gl_FragColor = vec4(col, 1.0);
}
`;
