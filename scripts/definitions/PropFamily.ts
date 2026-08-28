
export type PropKind =
  | "barrel"
  | "crate"
  | "sack"
  | "cart"
  | "hay"
  | "fence"
  | "garden";

export interface PropFamilyDefinition {
  readonly kind: PropKind;
  readonly tags: readonly string[];
  readonly palette: readonly string[];
  readonly variantCount: number;
}

export interface PropVariantDefinition {
  readonly key: string;
  readonly kind: PropKind;
  readonly variant: number;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly sourceDefinition: string;
  readonly tags: readonly string[];
}

export interface PropSprite extends PropVariantDefinition {
  readonly pixels: Uint8ClampedArray;
}

/**
 * The prop palette deliberately stays shared with the building generator: warm
 * wood, muted cloth, and a single dark outline make a mixed atlas read as one
 * game.  Adding a family is data-only; the renderer below owns the silhouettes.
 */
export const PROP_FAMILY_DEFINITIONS: readonly PropFamilyDefinition[] = [
  {
    kind: "barrel",
    tags: ["storage", "wood", "market"],
    palette: ["#75452b", "#a96a3f", "#d0955d"],
    variantCount: 2,
  },
  {
    kind: "crate",
    tags: ["storage", "wood", "logistics"],
    palette: ["#8e5b32", "#bc8147", "#dfac68"],
    variantCount: 2,
  },
  {
    kind: "sack",
    tags: ["storage", "goods", "market"],
    palette: ["#b29368", "#d1b989", "#ead5a7"],
    variantCount: 2,
  },
  {
    kind: "cart",
    tags: ["logistics", "wood", "goods"],
    palette: ["#674027", "#9c6338", "#d09251"],
    variantCount: 2,
  },
  {
    kind: "hay",
    tags: ["farm", "storage", "organic"],
    palette: ["#a97724", "#d29d32", "#efc85a"],
    variantCount: 2,
  },
  {
    kind: "fence",
    tags: ["boundary", "farm", "wood"],
    palette: ["#704126", "#a66a39", "#d09a55"],
    variantCount: 2,
  },
  {
    kind: "garden",
    tags: ["garden", "farm", "organic"],
    palette: ["#5e3f25", "#72933f", "#a8c45d"],
    variantCount: 2,
  },
] as const;

export const PROP_CANVAS_WIDTH = 32;
export const PROP_CANVAS_HEIGHT = 32;
export const DEFAULT_PROP_SEED = 0x51_7a_9d_31;

/** Build stable, sorted variant definitions for a family seed. */
export function buildPropDefinitions(seed = DEFAULT_PROP_SEED): PropVariantDefinition[] {
  const definitions: PropVariantDefinition[] = [];
  for (const family of PROP_FAMILY_DEFINITIONS) {
    for (let variant = 1; variant <= family.variantCount; variant += 1) {
      const key = `${family.kind}_${String(variant).padStart(2, "0")}`;
      const variantSeed = mixSeed(seed, hashString(key) ^ Math.imul(variant, 0x9e3779b9));
      definitions.push({
        key,
        kind: family.kind,
        variant,
        seed: variantSeed,
        width: PROP_CANVAS_WIDTH,
        height: PROP_CANVAS_HEIGHT,
        sourceDefinition: `PropFamily/${family.kind}`,
        tags: ["prop", family.kind, ...family.tags],
      });
    }
  }
  return definitions.sort((a, b) => a.key.localeCompare(b.key));
}

/** Alias kept explicit for callers that prefer the noun form. */
export const createPropDefinitions = buildPropDefinitions;

/** Generate every prop variant into independent RGBA buffers. */
export function generatePropFamily(seed = DEFAULT_PROP_SEED): PropSprite[] {
  return buildPropDefinitions(seed).map(renderPropVariant);
}

/** Render one deterministic, transparent 32x32 prop sprite. */
export function renderPropVariant(definition: PropVariantDefinition): PropSprite {
  const family = PROP_FAMILY_DEFINITIONS.find((candidate) => candidate.kind === definition.kind);
  if (!family) throw new Error(`Unknown prop kind: ${definition.kind}`);

  const pixels = new Uint8ClampedArray(definition.width * definition.height * 4);
  const rng = createRng(definition.seed);
  const palette = family.palette.map(parseHex);
  const outline: RGB = [41, 31, 24];
  const [base, mid, light] = palette;
  const ox = Math.floor(rng() * 3) - 1;
  const oy = Math.floor(rng() * 3) - 1;

  // A small isometric ground shadow anchors every family member equally.
  ellipse(pixels, definition.width, definition.height, 16 + ox, 26 + oy, 11, 3, [24, 21, 18], 95);
  switch (definition.kind) {
    case "barrel":
      drawBarrel(pixels, definition.width, definition.height, ox, oy, base, mid, light, outline, rng);
      break;
    case "crate":
      drawCrate(pixels, definition.width, definition.height, ox, oy, base, mid, light, outline, rng);
      break;
    case "sack":
      drawSack(pixels, definition.width, definition.height, ox, oy, base, mid, light, outline, rng);
      break;
    case "cart":
      drawCart(pixels, definition.width, definition.height, ox, oy, base, mid, light, outline, rng);
      break;
    case "hay":
      drawHay(pixels, definition.width, definition.height, ox, oy, base, mid, light, outline, rng);
      break;
    case "fence":
      drawFence(pixels, definition.width, definition.height, ox, oy, base, mid, light, outline, rng);
      break;
    case "garden":
      drawGarden(pixels, definition.width, definition.height, ox, oy, base, mid, light, outline, rng);
      break;
  }

  return { ...definition, pixels };
}

function drawBarrel(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  ox: number,
  oy: number,
  base: RGB,
  mid: RGB,
  light: RGB,
  outline: RGB,
  rng: () => number
): void {
  ellipse(pixels, width, height, 16 + ox, 10 + oy, 8, 3, outline, 255);
  fillRect(pixels, width, height, 8 + ox, 10 + oy, 16, 13, mid, 255);
  ellipse(pixels, width, height, 16 + ox, 10 + oy, 7, 2, light, 255);
  ellipse(pixels, width, height, 16 + ox, 23 + oy, 7, 2, base, 255);
  fillRect(pixels, width, height, 9 + ox, 12 + oy, 2, 10, base, 255);
  fillRect(pixels, width, height, 21 + ox, 12 + oy, 2, 10, base, 255);
  line(pixels, width, height, 10 + ox, 14 + oy, 22 + ox, 14 + oy, outline, 1);
  line(pixels, width, height, 10 + ox, 20 + oy, 22 + ox, 20 + oy, outline, 1);
  if (rng() > 0.45) fillRect(pixels, width, height, 13 + ox, 12 + oy, 1, 7, light, 190);
}

function drawCrate(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  ox: number,
  oy: number,
  base: RGB,
  mid: RGB,
  light: RGB,
  outline: RGB,
  rng: () => number
): void {
  fillRect(pixels, width, height, 7 + ox, 9 + oy, 18, 17, outline, 255);
  fillRect(pixels, width, height, 9 + ox, 11 + oy, 14, 13, mid, 255);
  line(pixels, width, height, 10 + ox, 12 + oy, 21 + ox, 23 + oy, base, 2);
  line(pixels, width, height, 21 + ox, 12 + oy, 10 + ox, 23 + oy, light, 2);
  line(pixels, width, height, 9 + ox, 11 + oy, 23 + ox, 11 + oy, light, 1);
  line(pixels, width, height, 9 + ox, 23 + oy, 23 + ox, 23 + oy, base, 1);
  if (rng() > 0.5) fillRect(pixels, width, height, 11 + ox, 13 + oy, 2, 2, light, 255);
}

function drawSack(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  ox: number,
  oy: number,
  base: RGB,
  mid: RGB,
  light: RGB,
  outline: RGB,
  rng: () => number
): void {
  ellipse(pixels, width, height, 16 + ox, 18 + oy, 9, 9, outline, 255);
  ellipse(pixels, width, height, 16 + ox, 18 + oy, 7, 8, mid, 255);
  fillRect(pixels, width, height, 13 + ox, 9 + oy, 6, 4, outline, 255);
  fillRect(pixels, width, height, 14 + ox, 10 + oy, 4, 2, light, 255);
  line(pixels, width, height, 12 + ox, 15 + oy, 19 + ox, 15 + oy, light, 1);
  line(pixels, width, height, 11 + ox, 20 + oy, 20 + ox, 20 + oy, base, 1);
  if (rng() > 0.4) line(pixels, width, height, 17 + ox, 13 + oy, 19 + ox, 22 + oy, light, 1);
}

function drawCart(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  ox: number,
  oy: number,
  base: RGB,
  mid: RGB,
  light: RGB,
  outline: RGB,
  rng: () => number
): void {
  fillRect(pixels, width, height, 5 + ox, 13 + oy, 20, 9, outline, 255);
  fillRect(pixels, width, height, 7 + ox, 14 + oy, 16, 6, mid, 255);
  line(pixels, width, height, 8 + ox, 15 + oy, 21 + ox, 19 + oy, light, 1);
  line(pixels, width, height, 8 + ox, 19 + oy, 21 + ox, 15 + oy, base, 1);
  ellipse(pixels, width, height, 10 + ox, 24 + oy, 4, 4, outline, 255);
  ellipse(pixels, width, height, 10 + ox, 24 + oy, 2, 2, light, 255);
  ellipse(pixels, width, height, 22 + ox, 24 + oy, 4, 4, outline, 255);
  ellipse(pixels, width, height, 22 + ox, 24 + oy, 2, 2, light, 255);
  line(pixels, width, height, 24 + ox, 15 + oy, 30 + ox, 9 + oy, outline, 2);
  if (rng() > 0.5) fillRect(pixels, width, height, 13 + ox, 11 + oy, 4, 3, light, 255);
}

function drawHay(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  ox: number,
  oy: number,
  base: RGB,
  mid: RGB,
  light: RGB,
  outline: RGB,
  rng: () => number
): void {
  fillRect(pixels, width, height, 6 + ox, 14 + oy, 20, 10, outline, 255);
  fillRect(pixels, width, height, 8 + ox, 12 + oy, 16, 11, mid, 255);
  fillRect(pixels, width, height, 10 + ox, 10 + oy, 12, 5, light, 255);
  ellipse(pixels, width, height, 16 + ox, 11 + oy, 6, 3, light, 255);
  for (let index = 0; index < 5; index += 1) {
    const x = 9 + index * 3 + Math.floor(rng() * 2);
    line(pixels, width, height, x + ox, 13 + oy, x - 2 + ox, 23 + oy, base, 1);
  }
}

function drawFence(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  ox: number,
  oy: number,
  base: RGB,
  mid: RGB,
  light: RGB,
  outline: RGB,
  rng: () => number
): void {
  const lean = rng() > 0.5 ? 1 : 0;
  for (const x of [8, 16, 24]) {
    fillRect(pixels, width, height, x + ox, 8 + oy + lean, 3, 17, outline, 255);
    fillRect(pixels, width, height, x + ox + 1, 9 + oy + lean, 1, 15, mid, 255);
    fillRect(pixels, width, height, x + ox + 1, 9 + oy + lean, 1, 4, light, 255);
  }
  fillRect(pixels, width, height, 7 + ox, 12 + oy, 20, 3, outline, 255);
  fillRect(pixels, width, height, 8 + ox, 13 + oy, 18, 1, light, 255);
  fillRect(pixels, width, height, 7 + ox, 19 + oy, 20, 3, outline, 255);
  fillRect(pixels, width, height, 8 + ox, 20 + oy, 18, 1, base, 255);
}

function drawGarden(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  ox: number,
  oy: number,
  base: RGB,
  mid: RGB,
  light: RGB,
  outline: RGB,
  rng: () => number
): void {
  fillRect(pixels, width, height, 5 + ox, 15 + oy, 22, 9, outline, 255);
  fillRect(pixels, width, height, 7 + ox, 16 + oy, 18, 7, base, 255);
  for (let row = 0; row < 2; row += 1) {
    line(pixels, width, height, 8 + ox, 18 + row * 4 + oy, 24 + ox, 18 + row * 4 + oy, outline, 1);
  }
  for (let index = 0; index < 6; index += 1) {
    const x = 9 + (index % 3) * 6 + Math.floor(rng() * 2);
    const y = 14 + Math.floor(index / 3) * 5;
    line(pixels, width, height, x + ox, y + oy, x - 1 + ox, y - 4 + oy, mid, 2);
    fillRect(pixels, width, height, x - 2 + ox, y - 5 + oy, 3, 2, light, 255);
  }
}

type RGB = readonly [number, number, number];

function parseHex(value: string): RGB {
  const normalized = value.replace("#", "");
  const number = Number.parseInt(normalized, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function paint(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  color: RGB,
  alpha: number
): void {
  if (x < 0 || y < 0 || x >= width || y >= height || alpha <= 0) return;
  const index = (y * width + x) * 4;
  if (alpha >= 255 || pixels[index + 3] === 0) {
    pixels[index] = color[0];
    pixels[index + 1] = color[1];
    pixels[index + 2] = color[2];
    pixels[index + 3] = Math.min(255, alpha);
    return;
  }
  const sourceAlpha = alpha / 255;
  const destinationAlpha = pixels[index + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  pixels[index] = Math.round((color[0] * sourceAlpha + pixels[index] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
  pixels[index + 1] = Math.round((color[1] * sourceAlpha + pixels[index + 1] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
  pixels[index + 2] = Math.round((color[2] * sourceAlpha + pixels[index + 2] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
  pixels[index + 3] = Math.round(outputAlpha * 255);
}

function fillRect(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: RGB,
  alpha: number
): void {
  for (let py = y; py < y + rectHeight; py += 1) {
    for (let px = x; px < x + rectWidth; px += 1) paint(pixels, width, height, px, py, color, alpha);
  }
}

function ellipse(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  color: RGB,
  alpha: number
): void {
  for (let y = centerY - radiusY; y <= centerY + radiusY; y += 1) {
    for (let x = centerX - radiusX; x <= centerX + radiusX; x += 1) {
      const dx = (x - centerX) / radiusX;
      const dy = (y - centerY) / radiusY;
      if (dx * dx + dy * dy <= 1) paint(pixels, width, height, x, y, color, alpha);
    }
  }
}

function line(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  color: RGB,
  thickness: number
): void {
  let x = startX;
  let y = startY;
  const deltaX = Math.abs(endX - startX);
  const deltaY = Math.abs(endY - startY);
  const stepX = startX < endX ? 1 : -1;
  const stepY = startY < endY ? 1 : -1;
  let error = deltaX - deltaY;
  while (true) {
    fillRect(pixels, width, height, x - Math.floor(thickness / 2), y - Math.floor(thickness / 2), thickness, thickness, color, 255);
    if (x === endX && y === endY) break;
    const twiceError = 2 * error;
    if (twiceError > -deltaY) {
      error -= deltaY;
      x += stepX;
    }
    if (twiceError < deltaX) {
      error += deltaX;
      y += stepY;
    }
  }
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mixSeed(first: number, second: number): number {
  let mixed = (first ^ second) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
