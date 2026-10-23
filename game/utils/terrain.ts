/**
 * Shared terrain sentinel contract for Phase 2 determinism work.
 *
 * Terrain queries return normalized heights in [0, 1]. Coordinates outside the
 * baked map return `NO_TERRAIN` instead of a fake mid-land height so placement,
 * culling, and spawning paths can reject them explicitly.
 */
export const NO_TERRAIN = -1;

/** True when a height sample represents valid, in-baked-map terrain. */
export function isTerrainValid(height: number): boolean {
  return Number.isFinite(height) && height >= 0;
}