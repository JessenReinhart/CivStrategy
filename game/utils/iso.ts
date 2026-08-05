export const toIso = (x: number, y: number): { x: number, y: number } => {
  return {
    x: x - y,
    y: (x + y) * 0.5
  };
};

import { TERRAIN_CONFIG } from '../../constants';

/**
 * toIso with terrain height lift — elevates tile/screen-Y by height × HEIGHT_LIFT.
 * Discrete band: round to half-band so adjacent cells on same band show flat plateau.
 * Pass terrainHeight from TerrainSystem (0–1 range).
 */
export const toIsoElev = (
  x: number, y: number, terrainHeight: number, heightRef: number = TERRAIN_CONFIG.WATER_LEVEL,
): { x: number; y: number } => {
  const base = toIso(x, y);
  const lift = Math.max(0, terrainHeight - heightRef) * TERRAIN_CONFIG.HEIGHT_LIFT;
  return { x: base.x, y: base.y - lift };
};

/**
 * Depth-sort key with elevation: base iso Y + lift.
 */
export const isoElevDepth = (
  x: number, y: number, terrainHeight: number, heightRef: number = TERRAIN_CONFIG.WATER_LEVEL,
): number => {
  const base = (x + y) * 0.5;
  const lift = Math.max(0, terrainHeight - heightRef) * TERRAIN_CONFIG.HEIGHT_LIFT;
  return base - lift;
};

export const toCartesian = (isoX: number, isoY: number): { x: number, y: number } => {
  return {
    x: isoY + isoX * 0.5,
    y: isoY - isoX * 0.5
  };
};