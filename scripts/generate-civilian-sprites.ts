/* eslint-disable no-console -- sprite generation CLI */
/**
 * Build the deterministic civilian atlas.
 *
 * The module is intentionally side-effect free when imported: tests can call
 * generateCivilianAtlas directly without creating files. Run this file with a
 * TypeScript-capable Node runner to write assets/textures/generated/.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCivilianAtlas } from './definitions/CivilianSpriteFamily.ts';
import type { Atlas } from './definitions/CivilianSpriteFamily.ts';

export { generateCivilianAtlas } from './definitions/CivilianSpriteFamily.ts';
export {
  CIVILIAN_LODS,
  CIVILIAN_ROLES,
  LOD_SIZE,
  generateCivilianFrame,
  getRolePalette,
} from './definitions/CivilianSpriteFamily.ts';
export type {
  Atlas,
  CivilianLod,
  CivilianRole,
  Frame,
  RolePalette,
} from './definitions/CivilianSpriteFamily.ts';

export const DEFAULT_CIVILIAN_SEED = 116;

/** Recursively sort object keys so manifest bytes are stable across runtimes. */
export function sortManifest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortManifest);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortManifest((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function serializeCivilianManifest(atlas: Atlas): string {
  // A trailing newline makes the generated JSON pleasant to inspect while
  // preserving deterministic bytes.
  return `${JSON.stringify(sortManifest(atlas.json), null, 2)}\n`;
}

export interface CivilianAtlasOutput {
  pngPath: string;
  jsonPath: string;
  pngBytes: number;
  jsonBytes: number;
}

export function writeCivilianAtlas(
  outDir: string,
  seed = DEFAULT_CIVILIAN_SEED
): CivilianAtlasOutput {
  const atlas = generateCivilianAtlas(seed);
  mkdirSync(outDir, { recursive: true });
  const pngPath = resolve(outDir, 'civilian-atlas.png');
  const jsonPath = resolve(outDir, 'civilian-atlas.json');
  const manifest = serializeCivilianManifest(atlas);
  writeFileSync(pngPath, atlas.png);
  writeFileSync(jsonPath, manifest, 'utf8');
  return {
    pngPath,
    jsonPath,
    pngBytes: atlas.png.byteLength,
    jsonBytes: new TextEncoder().encode(manifest).byteLength,
  };
}

function isMainModule(): boolean {
  // `process.argv[1]` is undefined when evaluated by Vitest or another
  // embedding runtime, which keeps importing this module side-effect free.
  const entry = process.argv[1];
  return Boolean(entry && resolve(entry) === fileURLToPath(import.meta.url));
}

export function runCli(seed = DEFAULT_CIVILIAN_SEED): CivilianAtlasOutput {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(scriptDir, '..', 'assets', 'textures', 'generated');
  const result = writeCivilianAtlas(outDir, seed);
  console.log(`Generated civilian atlas (${result.pngBytes} PNG bytes)`);
  console.log(`  ${result.pngPath}`);
  console.log(`  ${result.jsonPath}`);
  return result;
}

if (isMainModule()) {
  const rawSeed = process.argv[2];
  const seed = rawSeed === undefined ? DEFAULT_CIVILIAN_SEED : Number(rawSeed);
  if (!Number.isFinite(seed)) {
    throw new Error(`Invalid seed: ${rawSeed}`);
  }
  runCli(seed);
}
