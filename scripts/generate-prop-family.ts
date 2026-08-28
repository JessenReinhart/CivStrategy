/* eslint-disable no-console -- CLI generator */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { encodePNG } from "./png-encode.ts";
import {
  generatePropFamily,
  PROP_CANVAS_HEIGHT,
  PROP_CANVAS_WIDTH,
  type PropSprite,
} from "./definitions/PropFamily.ts";

export interface PropAtlas {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
  readonly frames: readonly PropFrame[];
}

export interface PropFrame {
  readonly key: string;
  readonly kind: string;
  readonly variant: number;
  readonly seed: number;
  readonly sourceDefinition: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly tags: readonly string[];
}

export interface PropManifest {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly sourceDefinition: string;
  readonly tags: readonly string[];
  readonly atlas: { readonly x: number; readonly y: number; readonly source: string };
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROP_OUTPUT_DIR = join(moduleDirectory, "..", "assets", "textures", "generated");

export function packPropAtlas(sprites: readonly PropSprite[], columns = 4): PropAtlas {
  if (sprites.length === 0) throw new Error("At least one sprite is required.");
  if (!Number.isInteger(columns) || columns < 1) throw new Error("Atlas columns must be a positive integer.");
  const rows = Math.ceil(sprites.length / columns);
  const width = columns * PROP_CANVAS_WIDTH;
  const height = rows * PROP_CANVAS_HEIGHT;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const frames: PropFrame[] = [];

  sprites.forEach((sprite, index) => {
    const x = (index % columns) * PROP_CANVAS_WIDTH;
    const y = Math.floor(index / columns) * PROP_CANVAS_HEIGHT;
    blit(pixels, width, height, x, y, sprite.pixels, PROP_CANVAS_WIDTH, PROP_CANVAS_HEIGHT);
    frames.push({
      key: sprite.key,
      kind: sprite.kind,
      variant: sprite.variant,
      seed: sprite.seed,
      sourceDefinition: sprite.sourceDefinition,
      x,
      y,
      width: PROP_CANVAS_WIDTH,
      height: PROP_CANVAS_HEIGHT,
      tags: [...sprite.tags].sort(),
    });
  });
  return { width, height, pixels, frames };
}

export function buildPropAtlas(seed = 0x51_7a_9d_31): { atlas: PropAtlas; manifest: PropManifest[] } {
  const sprites = generatePropFamily(seed).sort((a, b) => a.key.localeCompare(b.key));
  const atlas = packPropAtlas(sprites);
  const manifest = atlas.frames.map((frame) => ({
    key: frame.key,
    width: frame.width,
    height: frame.height,
    seed: frame.seed,
    sourceDefinition: frame.sourceDefinition,
    tags: frame.tags,
    atlas: { x: frame.x, y: frame.y, source: "props.png" },
  }));
  return { atlas, manifest };
}

export function blit(
  dest: Uint8ClampedArray,
  destWidth: number,
  destHeight: number,
  offsetX: number,
  offsetY: number,
  src: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number
): void {
  for (let y = 0; y < srcHeight; y += 1) {
    for (let x = 0; x < srcWidth; x += 1) {
      const dx = offsetX + x;
      const dy = offsetY + y;
      if (dx < 0 || dy < 0 || dx >= destWidth || dy >= destHeight) continue;
      const sourceIndex = (y * srcWidth + x) * 4;
      const destinationIndex = (dy * destWidth + dx) * 4;
      const sourceAlpha = src[sourceIndex + 3] / 255;
      if (sourceAlpha <= 0) continue;
      if (sourceAlpha >= 1) {
        dest.set(src.subarray(sourceIndex, sourceIndex + 4), destinationIndex);
        continue;
      }
      const destinationAlpha = dest[destinationIndex + 3] / 255;
      const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      dest[destinationIndex] = Math.round((src[sourceIndex] * sourceAlpha + dest[destinationIndex] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
      dest[destinationIndex + 1] = Math.round((src[sourceIndex + 1] * sourceAlpha + dest[destinationIndex + 1] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
      dest[destinationIndex + 2] = Math.round((src[sourceIndex + 2] * sourceAlpha + dest[destinationIndex + 2] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
      dest[destinationIndex + 3] = Math.round(outputAlpha * 255);
    }
  }
}

export function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => sortKeys(entry)) as unknown as T;
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted as T;
  }
  return value;
}

function writePropArtifacts(outputDirectory: string, seed: number): void {
  if (!existsSync(outputDirectory)) mkdirSync(outputDirectory, { recursive: true });
  const { atlas, manifest } = buildPropAtlas(seed);
  writeFileSync(join(outputDirectory, "props.png"), Buffer.from(encodePNG(atlas.width, atlas.height, atlas.pixels)));
  writeFileSync(join(outputDirectory, "props.json"), `${JSON.stringify(sortKeys({ seed, width: atlas.width, height: atlas.height, frames: atlas.frames }), null, 2)}\n`);
  writeFileSync(join(outputDirectory, "prop-manifest.json"), `${JSON.stringify(sortKeys({ seed, props: manifest }), null, 2)}\n`);
  console.log(`Generated props.png (${atlas.width}x${atlas.height}) with ${atlas.frames.length} frames.`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const seedArgument = process.argv.find((argument) => argument.startsWith("--seed="));
  const seed = seedArgument ? Number.parseInt(seedArgument.slice("--seed=".length), 10) : 0x51_7a_9d_31;
  writePropArtifacts(DEFAULT_PROP_OUTPUT_DIR, seed);
}
