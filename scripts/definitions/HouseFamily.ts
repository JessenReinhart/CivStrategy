import { encodeSprite, renderParts, type AnySpriteLayer, type SpriteCanvas } from '../sprite-pipeline.ts';
import {
  awning,
  banner,
  barrel,
  chimney,
  color,
  crate,
  createRng,
  darken,
  door,
  fence,
  foundation,
  hay,
  lighten,
  porch,
  roofMaterial,
  wallMaterial,
  window,
} from '../sprite-parts/index.ts';
import type { PartBox, Rgb } from '../sprite-parts/types.ts';

export type HouseAge = 'village' | 'town' | 'city';
export type HouseFaction = 'roman' | string;

export interface HouseFootprint {
  width: number;
  height: number;
}

export interface HouseDefinition {
  /** Stable asset key; callers may use this for manifest metadata. */
  key?: string;
  faction?: HouseFaction;
  age: HouseAge;
  footprint?: HouseFootprint;
  /** Variant index controls curated geometry while seed controls details. */
  variant?: number;
  corner?: boolean;
  seed?: number;
}

export interface GeneratedHouseSprite {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
  readonly png: Uint8Array;
  readonly definition: Readonly<HouseDefinition>;
  readonly metadata: {
    kind: 'house';
    faction: HouseFaction;
    age: HouseAge;
    variant: number;
    corner: boolean;
    seed: number;
    footprint: HouseFootprint;
  };
}

export const HOUSE_SPRITE_WIDTH = 128;
export const HOUSE_SPRITE_HEIGHT = 128;
export const HOUSE_DIMENSIONS = { width: HOUSE_SPRITE_WIDTH, height: HOUSE_SPRITE_HEIGHT } as const;

const ROMAN_WALLS: readonly Rgb[] = [
  color('#c4a76c'), color('#b8945c'), color('#d0b47a'), color('#a88357'),
];
const ROMAN_ROOFS: readonly Rgb[] = [
  color('#8b4513'), color('#9d4f1e'), color('#6f3414'), color('#a75b28'),
];
const AGE_WALL_LIGHT: Record<HouseAge, number> = { village: 0, town: 0.07, city: 0.14 };

function normalizedFootprint(footprint: HouseFootprint | undefined): HouseFootprint {
  const width = Number.isFinite(footprint?.width) ? Math.max(1, Math.min(4, footprint!.width)) : 2;
  const height = Number.isFinite(footprint?.height) ? Math.max(1, Math.min(4, footprint!.height)) : 2;
  return { width: Math.round(width), height: Math.round(height) };
}

function factionTint(faction: HouseFaction): Rgb {
  let hash = 0;
  for (let index = 0; index < faction.length; index++) hash = (Math.imul(hash, 31) + faction.charCodeAt(index)) | 0;
  const hue = Math.abs(hash) % 3;
  return [color('#3b65a8'), color('#9f3939'), color('#4e7f4a')][hue];
}

function box(x: number, y: number, width: number, height: number): PartBox {
  return { x, y, width, height };
}

/** Compose a house into a transparent RGBA pixel canvas. */
export function renderHouse(definition: HouseDefinition, seed = definition.seed ?? 0): SpriteCanvas {
  const rng = createRng(seed);
  const age = definition.age;
  const variant = Math.max(0, Math.trunc(definition.variant ?? rng.int(0, 3)));
  const corner = definition.corner ?? false;
  const footprint = normalizedFootprint(definition.footprint);
  const sizeScale = 1 + (footprint.width - 2) * 0.1 + (footprint.height - 2) * 0.08;
  const bodyWidth = Math.round((48 + (age === 'town' ? 8 : age === 'city' ? 14 : 0)) * sizeScale);
  const bodyHeight = Math.round((28 + (age === 'city' ? 8 : age === 'town' ? 4 : 0)) * sizeScale);
  const bodyX = 64 - Math.round(bodyWidth / 2);
  const bodyY = 56;
  const wall = lighten(rng.pick(ROMAN_WALLS), AGE_WALL_LIGHT[age]);
  const roof = rng.pick(ROMAN_ROOFS);
  const trim = lighten(wall, 0.27);
  const ground = color('#b8944a');
  const faction = definition.faction ?? 'roman';
  const factionColor = factionTint(faction);
  const layers: AnySpriteLayer[] = [];

  layers.push({
    part: foundation,
    box: box(bodyX - 8, bodyY + bodyHeight + 8, bodyWidth + 16, 12),
    config: { color: ground, depth: 8 },
    seed: 1,
  });
  layers.push({
    part: wallMaterial,
    box: box(bodyX, bodyY, bodyWidth, bodyHeight),
    config: { color: wall, style: variant % 3 === 1 ? 'stone' : variant % 3 === 2 ? 'wood' : 'plaster' },
    seed: 2,
  });

  const roofHeight = 22 + (age === 'city' ? 4 : age === 'town' ? 2 : 0);
  layers.push({
    part: roofMaterial,
    box: box(bodyX - 8, bodyY - roofHeight + 5, bodyWidth + 16, roofHeight),
    config: { color: roof, style: corner || variant % 3 === 2 ? 'hip' : 'gable', ridge: true },
    seed: 3,
  });

  const doorWidth = age === 'city' ? 10 : 8;
  const doorHeight = age === 'city' ? 17 : 14;
  layers.push({
    part: door,
    box: box(64 - doorWidth / 2, bodyY + bodyHeight - doorHeight, doorWidth, doorHeight),
    config: { color: darken(roof, 0.46), trim, arch: age !== 'village', knob: true },
    seed: 4,
  });

  const windowWidth = age === 'city' ? 9 : 7;
  const windowHeight = age === 'city' ? 9 : 7;
  const windowY = bodyY + Math.max(5, Math.round(bodyHeight * 0.32));
  layers.push({
    part: window,
    box: box(bodyX + 7, windowY, windowWidth, windowHeight),
    config: { frame: trim, glass: color('#254b64'), crossbar: variant % 2 === 0, glow: age === 'city' },
    seed: 5,
  });
  layers.push({
    part: window,
    box: box(bodyX + bodyWidth - windowWidth - 7, windowY, windowWidth, windowHeight),
    config: { frame: trim, glass: color('#254b64'), crossbar: variant % 2 !== 0, glow: age === 'city' },
    seed: 6,
  });

  if (variant % 4 !== 3 || age === 'city') {
    layers.push({
      part: chimney,
      box: box(bodyX + bodyWidth - 14, bodyY - roofHeight + 1, 7, 15),
      config: { color: color('#765341'), cap: true, smoke: false },
      seed: 7,
    });
  }
  if (age !== 'village' || variant % 2 === 0) {
    layers.push({
      part: porch,
      box: box(64 - (bodyWidth * 0.26), bodyY + bodyHeight - 3, bodyWidth * 0.52, 12),
      config: { color: darken(ground, 0.12), posts: age === 'city' ? 3 : 2 },
      seed: 8,
    });
  }
  if (age === 'town' || age === 'city') {
    layers.push({
      part: awning,
      box: box(64 - bodyWidth * 0.25, bodyY + bodyHeight - 18, bodyWidth * 0.5, 5),
      config: { color: factionColor, stripes: lighten(factionColor, 0.33) },
      seed: 9,
    });
  }
  if (age === 'city' || corner) {
    layers.push({
      part: banner,
      box: box(bodyX - 5, bodyY + 4, 9, 14),
      config: { color: factionColor, swallowtail: true },
      seed: 10,
    });
  }
  if (variant % 3 === 0) {
    layers.push({
      part: crate,
      box: box(bodyX - 1, bodyY + bodyHeight + 3, 9, 8),
      config: { color: color('#8b6f4e'), accent: trim, count: age === 'city' ? 2 : 1 },
      seed: 11,
    });
  } else if (variant % 3 === 1) {
    layers.push({
      part: barrel,
      box: box(bodyX + bodyWidth - 8, bodyY + bodyHeight + 2, 8, 10),
      config: { color: color('#76502f'), accent: trim },
      seed: 12,
    });
  } else {
    layers.push({
      part: hay,
      box: box(bodyX + bodyWidth - 10, bodyY + bodyHeight + 3, 10, 6),
      config: { color: color('#d4a83d'), accent: color('#f0d46e') },
      seed: 13,
    });
  }
  if (corner) {
    layers.push({
      part: fence,
      box: box(bodyX + bodyWidth + 2, bodyY + bodyHeight - 12, 18, 12),
      config: { color: color('#6b4226'), posts: 3, rails: 1 },
      seed: 14,
    });
  }

  return renderParts(HOUSE_SPRITE_WIDTH, HOUSE_SPRITE_HEIGHT, layers, seed);
}

/** Render a house and encode its pixels into a deterministic PNG. */
export function generateHouseSprite(definition: HouseDefinition, seed = definition.seed ?? 0): GeneratedHouseSprite {
  const canvas = renderHouse(definition, seed);
  const variant = Math.max(0, Math.trunc(definition.variant ?? createRng(seed).int(0, 3)));
  const corner = definition.corner ?? false;
  const faction = definition.faction ?? 'roman';
  const footprint = normalizedFootprint(definition.footprint);
  const key = definition.key ?? `house_${faction}_${definition.age}_${corner ? 'corner_' : ''}${String(variant + 1).padStart(2, '0')}`;
  return {
    key,
    width: canvas.width,
    height: canvas.height,
    pixels: canvas.pixels,
    png: encodeSprite(canvas),
    definition: { ...definition, seed },
    metadata: { kind: 'house', faction, age: definition.age, variant, corner, seed, footprint },
  };
}

export function generateHousePNG(definition: HouseDefinition, seed = definition.seed ?? 0): Uint8Array {
  return generateHouseSprite(definition, seed).png;
}

export const renderHouseSprite = generateHouseSprite;
/** Generate a fixed, curated family of coherent house variants. */
export function generateHouseFamily(seed = 0): GeneratedHouseSprite[] {
  const definitions: HouseDefinition[] = [
    ...[0, 1, 2].map((variant) => ({
      key: `house_roman_village_${String(variant + 1).padStart(2, '0')}`,
      faction: 'roman',
      age: 'village' as const,
      variant,
      seed: seed + variant,
    })),
    ...[0, 1, 2].map((variant) => ({
      key: `house_roman_town_${String(variant + 1).padStart(2, '0')}`,
      faction: 'roman',
      age: 'town' as const,
      variant,
      seed: seed + 16 + variant,
    })),
    ...[0, 1].map((variant) => ({
      key: `house_roman_town_corner_${String(variant + 1).padStart(2, '0')}`,
      faction: 'roman',
      age: 'town' as const,
      variant,
      corner: true,
      seed: seed + 32 + variant,
    })),
  ];
  return definitions.map((definition) => generateHouseSprite(definition, definition.seed));
}
