// Deterministic civilian sprite definition family.
// Builds small role/LOD frames for the Living City ambient population atlas.

import type { Rgba, PixelRenderer } from '../sprite-parts/index.ts';
import {
  createPixelBuffer,
  createRng,
  color,
  withAlpha,
} from '../sprite-parts/index.ts';
import { encodePNG } from '../png-encode.ts';

export const CIVILIAN_ROLES = [
  'civilian',
  'worker',
  'merchant',
  'farmer',
  'porter',
] as const;
export type CivilianRole = (typeof CIVILIAN_ROLES)[number];

export const CIVILIAN_LODS = ['near', 'mid', 'far'] as const;
export type CivilianLod = (typeof CIVILIAN_LODS)[number];

export const LOD_SIZE: Record<CivilianLod, number> = {
  near: 32,
  mid: 16,
  far: 8,
};

export interface Frame {
  role: CivilianRole;
  lod: CivilianLod;
  seed: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Atlas {
  width: number;
  height: number;
  png: Uint8Array;
  frames: Frame[];
  json: Record<string, unknown>;
}

export interface RolePalette {
  primary: Rgba;
  secondary: Rgba;
  accent: Rgba;
  skin: Rgba;
  dark: Rgba;
}

const PALETTES: Record<CivilianRole, RolePalette> = {
  civilian: {
    primary: color('#4f83a9'),
    secondary: color('#a7c4d6'),
    accent: color('#d4a07a'),
    skin: color('#e0b895'),
    dark: color('#223344'),
  },
  worker: {
    primary: color('#8b5a2b'),
    secondary: color('#d9c7a6'),
    accent: color('#9c9c9c'),
    skin: color('#e0b895'),
    dark: color('#3a2a18'),
  },
  merchant: {
    primary: color('#6a4c93'),
    secondary: color('#d6c6e0'),
    accent: color('#f2d066'),
    skin: color('#e3bfa3'),
    dark: color('#2d1f45'),
  },
  farmer: {
    primary: color('#4a7c2e'),
    secondary: color('#e2d7aa'),
    accent: color('#c49a6c'),
    skin: color('#d8ab7e'),
    dark: color('#253d17'),
  },
  porter: {
    primary: color('#b85c28'),
    secondary: color('#7a4221'),
    accent: color('#6e5338'),
    skin: color('#d8a27f'),
    dark: color('#4a2310'),
  },
};

export function getRolePalette(role: CivilianRole): RolePalette {
  return PALETTES[role];
}

function frameSeed(seed: number, role: CivilianRole, lod: CivilianLod): number {
  const roleIndex = CIVILIAN_ROLES.indexOf(role);
  const lodIndex = CIVILIAN_LODS.indexOf(lod);
  // Deterministic mix; keep within 31-bit positive integer range.
  return ((seed * 31 + roleIndex * 7 + lodIndex * 11) & 0x7fffffff) >>> 0;
}

function drawNearCivilian(
  renderer: PixelRenderer,
  role: CivilianRole,
  rng: () => number
): void {
  const size = 32;
  const cx = size / 2;
  const palette = PALETTES[role];
  const primary = palette.primary;
  const secondary = palette.secondary;
  const accent = palette.accent;
  const skin = palette.skin;
  const dark = palette.dark;

  // Ground shadow.
  renderer.fillEllipse(cx, 28, 8, 3, withAlpha(dark, 120));

  // Body and sash.
  renderer.fillRect(cx - 5, 15, 10, 14, primary);
  renderer.fillRect(cx - 5, 18, 10, 3, secondary);

  // Head.
  renderer.fillEllipse(cx, 9, 5, 5, skin);

  // Role-specific details (kept simple for 32 px readability).
  switch (role) {
    case 'worker': {
      renderer.fillRect(cx - 5, 5, 10, 3, dark);
      renderer.line(cx + 4, 17, cx + 10, 11, accent, 2);
      renderer.fillRect(cx + 9, 9, 3, 3, withAlpha(accent, 180));
      break;
    }
    case 'merchant': {
      renderer.fillRect(cx - 3, 16, 6, 11, secondary);
      renderer.fillRect(cx - 4, 5, 8, 3, accent);
      break;
    }
    case 'farmer': {
      renderer.fillEllipse(cx, 8, 8, 3, accent);
      renderer.fillRect(cx - 3, 8, 6, 3, accent);
      renderer.fillRect(cx - 3, 19, 6, 8, secondary);
      break;
    }
    case 'porter': {
      renderer.fillRect(cx - 4, 5, 8, 3, secondary);
      renderer.fillRect(cx + 4, 13, 5, 7, accent);
      break;
    }
    default: {
      // civilian — simple hair
      renderer.fillEllipse(cx, 7, 6, 3, dark);
      break;
    }
  }

  // Slight shade on one side using a deterministic hand from the seed.
  const shadeX = rng() > 0.5 ? cx - 4 : cx + 4;
  renderer.line(shadeX, 15, shadeX, 28, withAlpha(dark, 60), 1);
}

function drawMidCivilian(
  renderer: PixelRenderer,
  role: CivilianRole
): void {
  const size = 16;
  const cx = size / 2;
  const palette = PALETTES[role];
  const primary = palette.primary;
  const secondary = palette.secondary;
  const accent = palette.accent;
  const skin = palette.skin;
  const dark = palette.dark;

  renderer.fillEllipse(cx, 14, 4, 2, withAlpha(dark, 120));
  renderer.fillRect(cx - 2, 7, 5, 7, primary);
  renderer.fillRect(cx - 2, 9, 5, 2, secondary);
  renderer.fillEllipse(cx, 4, 2, 2, skin);

  switch (role) {
    case 'worker': {
      renderer.fillRect(cx - 2, 2, 5, 2, dark);
      renderer.line(cx + 2, 7, cx + 5, 4, accent, 1);
      break;
    }
    case 'merchant': {
      renderer.fillRect(cx - 1, 8, 3, 5, secondary);
      renderer.fillRect(cx - 2, 2, 4, 2, accent);
      break;
    }
    case 'farmer': {
      renderer.fillEllipse(cx, 3, 3, 1, accent);
      renderer.fillRect(cx - 1, 10, 3, 2, secondary);
      break;
    }
    case 'porter': {
      renderer.fillRect(cx - 2, 2, 4, 2, secondary);
      renderer.fillRect(cx + 2, 6, 2, 4, accent);
      break;
    }
    default: {
      renderer.fillRect(cx - 1, 2, 3, 2, dark);
      break;
    }
  }
}

function drawFarCivilian(
  renderer: PixelRenderer,
  role: CivilianRole
): void {
  const palette = PALETTES[role];
  const primary = palette.primary;
  const secondary = palette.secondary;
  const accent = palette.accent;
  const skin = palette.skin;
  const dark = palette.dark;

  renderer.fillRect(2, 6, 4, 1, withAlpha(dark, 120));
  renderer.fillRect(2, 2, 4, 5, primary);
  renderer.setPixel(3, 3, secondary);

  // Head/hat.
  switch (role) {
    case 'farmer':
    case 'porter':
    case 'merchant': {
      renderer.fillRect(3, 0, 2, 2, accent);
      break;
    }
    case 'worker': {
      renderer.fillRect(3, 0, 2, 2, dark);
      break;
    }
    default: {
      renderer.fillRect(3, 0, 2, 2, skin);
      break;
    }
  }
}

export function generateCivilianFrame(
  role: CivilianRole,
  lod: CivilianLod,
  seed: number
): PixelRenderer {
  const size = LOD_SIZE[lod];
  const renderer = createPixelBuffer(size, size);
  const rng = createRng(seed);

  switch (lod) {
    case 'near':
      drawNearCivilian(renderer, role, () => rng.next());
      break;
    case 'mid':
      drawMidCivilian(renderer, role);
      break;
    case 'far':
      drawFarCivilian(renderer, role);
      break;
  }

  return renderer;
}

function blit(
  dest: PixelRenderer,
  src: PixelRenderer,
  dx: number,
  dy: number
): void {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const si = (y * src.width + x) * 4;
      const a = src.pixels[si + 3];
      if (a === 0) continue;
      const di = ((dy + y) * dest.width + (dx + x)) * 4;
      dest.pixels[di] = src.pixels[si];
      dest.pixels[di + 1] = src.pixels[si + 1];
      dest.pixels[di + 2] = src.pixels[si + 2];
      dest.pixels[di + 3] = a;
    }
  }
}

export function generateCivilianAtlas(seed: number): Atlas {
  const atlasWidth = CIVILIAN_LODS.reduce(
    (sum, lod) => sum + LOD_SIZE[lod],
    0
  );
  const rowHeight = LOD_SIZE.near;
  const atlasHeight = CIVILIAN_ROLES.length * rowHeight;

  const atlas = createPixelBuffer(atlasWidth, atlasHeight);
  const frames: Frame[] = [];

  for (let r = 0; r < CIVILIAN_ROLES.length; r++) {
    const role = CIVILIAN_ROLES[r];
    let x = 0;
    for (let l = 0; l < CIVILIAN_LODS.length; l++) {
      const lod = CIVILIAN_LODS[l];
      const size = LOD_SIZE[lod];
      const fs = frameSeed(seed, role, lod);
      const frame = generateCivilianFrame(role, lod, fs);
      const y = r * rowHeight + Math.floor((rowHeight - size) / 2);
      blit(atlas, frame, x, y);
      frames.push({ role, lod, seed: fs, x, y, w: size, h: size });
      x += size;
    }
  }

  const png = encodePNG(atlas.width, atlas.height, atlas.pixels);

  const framesObj: Record<string, Record<string, unknown>> = {};
  for (const f of frames) {
    framesObj[`${f.role}.${f.lod}`] = {
      role: f.role,
      lod: f.lod,
      seed: f.seed,
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
    };
  }

  const json: Record<string, unknown> = {
    generator: 'scripts/generate-civilian-sprites.ts',
    seed,
    meta: {
      width: atlas.width,
      height: atlas.height,
      roles: [...CIVILIAN_ROLES],
      lods: [...CIVILIAN_LODS],
    },
    frames: framesObj,
  };

  return { width: atlas.width, height: atlas.height, png, frames, json };
}
