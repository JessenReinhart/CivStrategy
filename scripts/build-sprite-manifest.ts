/* eslint-disable no-console -- CLI generator */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, extname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { sortKeys } from "./generate-prop-family.ts";

export interface SpriteManifestEntry {
  readonly key: string;
  readonly source: string;
  readonly width: number;
  readonly height: number;
  readonly sourceDefinition: string;
  readonly seed: number;
  readonly tags: readonly string[];
  readonly atlas?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface SpriteManifest {
  readonly version: 1;
  readonly assets: readonly SpriteManifestEntry[];
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_GENERATED_DIR = join(moduleDirectory, "..", "assets", "textures", "generated");

export function buildSpriteManifest(generatedDirectory = DEFAULT_GENERATED_DIR): SpriteManifest {
  const directory = resolve(generatedDirectory);
  if (!existsSync(directory)) return { version: 1, assets: [] };

  const sidecars = readSidecarMetadata(directory);
  const assets: SpriteManifestEntry[] = [];
  for (const fileName of readdirSync(directory).filter((name) => extname(name).toLowerCase() === ".png" && name !== "contact-sheet.png").sort()) {
    const dimensions = readPngDimensions(readFileSync(join(directory, fileName)));
    const source = fileName;
    const sidecar = sidecars.get(fileName);
    if (sidecar?.frames && Array.isArray(sidecar.frames)) {
      for (const frame of sidecar.frames) {
        if (!isFrame(frame)) continue;
        assets.push({
          key: frame.key,
          source,
          width: frame.width,
          height: frame.height,
          sourceDefinition: frame.sourceDefinition,
          seed: frame.seed,
          tags: [...frame.tags].map(String).sort(),
          atlas: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
        });
      }
      continue;
    }
    assets.push({
      key: fileName.replace(/\.png$/i, ""),
      source,
      width: dimensions.width,
      height: dimensions.height,
      sourceDefinition: sidecar?.sourceDefinition ?? `generated/${fileName.replace(/\.png$/i, "")}`,
      seed: typeof sidecar?.seed === "number" ? sidecar.seed : 0,
      tags: Array.isArray(sidecar?.tags) ? [...sidecar.tags].map(String).sort() : [],
    });
  }
  assets.sort((a, b) => a.key.localeCompare(b.key) || a.source.localeCompare(b.source));
  return sortKeys({ version: 1 as const, assets });
}

export function writeSpriteManifest(generatedDirectory = DEFAULT_GENERATED_DIR): string {
  const manifest = buildSpriteManifest(generatedDirectory);
  const outputPath = join(resolve(generatedDirectory), "manifest.json");
  if (!existsSync(resolve(generatedDirectory))) mkdirSync(resolve(generatedDirectory), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return outputPath;
}

export function readPngDimensions(png: Uint8Array): { width: number; height: number } {
  if (png.length < 24 || png[0] !== 137 || png[1] !== 80 || png[2] !== 78 || png[3] !== 71) {
    throw new Error("Invalid PNG signature.");
  }
  const width = readUint32(png, 16);
  const height = readUint32(png, 20);
  if (width < 1 || height < 1) throw new Error("PNG dimensions must be positive.");
  return { width, height };
}

interface Sidecar {
  readonly seed?: number;
  readonly sourceDefinition?: string;
  readonly tags?: readonly unknown[];
  readonly frames?: readonly unknown[];
  readonly props?: readonly unknown[];
}

function readSidecarMetadata(directory: string): Map<string, Sidecar> {
  const sidecars = new Map<string, Sidecar>();
  for (const fileName of readdirSync(directory).filter((name) => extname(name).toLowerCase() === ".json").sort()) {
    if (fileName === "manifest.json") continue;
    try {
      const value: unknown = JSON.parse(readFileSync(join(directory, fileName), "utf8"));
      if (!value || typeof value !== "object") continue;
      const sidecar = value as Sidecar;
      const frameSource = sidecar.props ? { ...sidecar, frames: sidecar.props } : sidecar;
      sidecars.set(fileName, frameSource);
      const pngName = fileName.replace(/\.json$/i, ".png");
      sidecars.set(pngName, frameSource);
    } catch {
      // Ignore unrelated or malformed JSON; PNG discovery remains useful.
    }
  }
  return sidecars;
}

interface FrameLike {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly sourceDefinition: string;
  readonly seed: number;
  readonly tags: readonly unknown[];
}

function isFrame(value: unknown): value is FrameLike {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number" &&
    typeof candidate.x === "number" &&
    typeof candidate.y === "number" &&
    typeof candidate.sourceDefinition === "string" &&
    typeof candidate.seed === "number" &&
    Array.isArray(candidate.tags)
  );
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const outputPath = writeSpriteManifest(DEFAULT_GENERATED_DIR);
  console.log(`Generated ${outputPath}`);
}
