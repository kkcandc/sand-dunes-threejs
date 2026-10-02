import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  RGBAFormat,
} from "three";

export const WORLD = 280;
export const RES = 512;

/** Wind blows toward +X and a little +Z. Bearing the wind comes from is ~248°. */
export const WIND_X = 0.9284766908852594;
export const WIND_Z = 0.3713906763541037;

const TEXELS = RES * RES;

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function hash2(ix: number, iz: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function noise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

function fbm(x: number, z: number, octaves: number): number {
  let acc = 0;
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    acc += amp * noise(x * freq, z * freq);
    sum += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return acc / sum;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Asymmetric transverse dunes: long windward rise, sharp crest, steep slip face. */
export function terrainHeight(x: number, z: number): number {
  const nx = x * 0.01;
  const nz = z * 0.01;
  const macro = (fbm(nx * 0.8 + 2.2, nz * 0.8, 5) - 0.5) * 5.2;

  const along = x * WIND_X + z * WIND_Z;
  const across = -x * WIND_Z + z * WIND_X;
  const warp = (fbm(nx * 1.65 + 8.0, nz * 1.65, 4) - 0.5) * 42;
  const warp2 = (fbm(across * 0.011 + 3.1, along * 0.005 + 1.7, 3) - 0.5) * 16;

  const spacing = 27;
  const phase = (along + warp + warp2) / spacing;
  const p = phase - Math.floor(phase);
  const crestAt = 0.6;

  let profile: number;
  if (p < crestAt) {
    profile = Math.pow(p / crestAt, 1.7);
  } else {
    const t = (p - crestAt) / (1 - crestAt);
    profile = Math.exp(-t * 2.55);
  }

  const ampNoise = 0.5 + 0.5 * fbm(across * 0.007 + 1.2, along * 0.0035 + 4.4, 3);
  const gap = smoothstep(0.22, 0.78, fbm(across * 0.018 + 9.0, along * 0.008, 3));
  const dune = profile * (6.4 + 8.2 * ampNoise) * (0.48 + 0.52 * gap);

  const phaseB = (across * 0.62 + along * 0.12 + warp * 0.35) / 13.5;
  const pb = phaseB - Math.floor(phaseB);
  const crestB = 0.64;
  const profileB =
    pb < crestB
      ? Math.pow(pb / crestB, 1.45)
      : Math.exp(-((pb - crestB) / (1 - crestB)) * 2.1);
  const minor = profileB * 1.15 * (0.35 + 0.65 * fbm(nx * 2.4 + 6.0, nz * 2.4, 2));

  return macro + dune + minor;
}

function albedoAt(x: number, z: number): number {
  return fbm(x * 0.037 + 12.0, z * 0.037 - 4.0, 3);
}

function slipAt(x: number, z: number): number {
  const eps = 1.15;
  const h = terrainHeight(x, z);
  const down = terrainHeight(x + WIND_X * eps, z + WIND_Z * eps);
  const slope = (h - down) / eps;
  return Math.min(1, Math.max(0, slope / 0.85));
}

export type Heightfield = {
  texture: DataTexture;
  sample: (x: number, z: number) => number;
  crest: { x: number; z: number; h: number };
  slipPoint: { x: number; z: number; h: number };
  trough: { x: number; z: number; h: number };
};

export function createHeightfield(): Heightfield {
  const heights = new Float32Array(TEXELS);
  const slips = new Float32Array(TEXELS);
  const data = new Float32Array(TEXELS * 4);

  let minH = Infinity;
  let maxH = -Infinity;

  for (let j = 0; j < RES; j++) {
    const v = j / (RES - 1);
    const z = -(v - 0.5) * WORLD;
    for (let i = 0; i < RES; i++) {
      const u = i / (RES - 1);
      const x = (u - 0.5) * WORLD;
      const h = terrainHeight(x, z);
      const idx = j * RES + i;
      heights[idx] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  for (let j = 0; j < RES; j++) {
    const v = j / (RES - 1);
    const z = -(v - 0.5) * WORLD;
    for (let i = 0; i < RES; i++) {
      const u = i / (RES - 1);
      const x = (u - 0.5) * WORLD;
      const idx = j * RES + i;
      const slip = slipAt(x, z);
      slips[idx] = slip;
      const o = idx * 4;
      data[o] = heights[idx];
      data[o + 1] = albedoAt(x, z);
      data[o + 2] = slip;
      data[o + 3] = 1;
    }
  }

  const texture = new DataTexture(data, RES, RES, RGBAFormat, FloatType);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const sample = (x: number, z: number): number => {
    const u = Math.min(1, Math.max(0, x / WORLD + 0.5));
    const v = Math.min(1, Math.max(0, -z / WORLD + 0.5));
    const x0 = u * (RES - 1);
    const y0 = v * (RES - 1);
    const i = Math.floor(x0);
    const j = Math.floor(y0);
    const fx = x0 - i;
    const fy = y0 - j;
    const i1 = Math.min(i + 1, RES - 1);
    const j1 = Math.min(j + 1, RES - 1);
    const h00 = heights[j * RES + i];
    const h10 = heights[j * RES + i1];
    const h01 = heights[j1 * RES + i];
    const h11 = heights[j1 * RES + i1];
    const a = h00 + (h10 - h00) * fx;
    const b = h01 + (h11 - h01) * fx;
    return a + (b - a) * fy;
  };

  let crest = { x: 12, z: 4, h: 0, score: -Infinity };
  let trough = { x: -16, z: 10, h: Infinity };

  for (let j = 2; j < RES - 2; j += 2) {
    const v = j / (RES - 1);
    const z = -(v - 0.5) * WORLD;
    for (let i = 2; i < RES - 2; i += 2) {
      const u = i / (RES - 1);
      const x = (u - 0.5) * WORLD;
      const radial = Math.hypot(x, z);
      if (radial < 10 || radial > 52) continue;
      const idx = j * RES + i;
      const h = heights[idx];
      const slip = slips[idx];
      if (h < trough.h) trough = { x, z, h };
      if (slip > 0.18 && slip < 0.62 && h > 3) {
        const score = h + slip * 1.4 - radial * 0.02;
        if (score > crest.score) crest = { x, z, h, score };
      }
    }
  }

  const slipPoint = {
    x: crest.x + WIND_X * 5.5,
    z: crest.z + WIND_Z * 5.5,
    h: 0,
  };
  slipPoint.h = sample(slipPoint.x, slipPoint.z);

  console.info(
    `[sirocco] dunes ${minH.toFixed(1)}m … ${maxH.toFixed(1)}m, crest (${crest.x.toFixed(0)}, ${crest.z.toFixed(0)})`,
  );

  return {
    texture,
    sample,
    crest: { x: crest.x, z: crest.z, h: crest.h },
    slipPoint,
    trough,
  };
}
