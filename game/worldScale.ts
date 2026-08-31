import { BUILDINGS } from '../constants';
import { BuildingType } from '../types';

/**
 * Presentation scale for human-sized actors. Gameplay movement, combat ranges,
 * vision, and physics stay in simulation units.
 */
export const WORLD_CHARACTER_SCALE = 0.8;

/**
 * Canonical physical footprint overrides for the denser settlement pass.
 * Runtime systems continue to consume BUILDINGS, so placement, pathfinding,
 * collision, AI, rendering, and persistence share the same resulting values.
 */
export const BUILDING_FOOTPRINT_OVERRIDES: Partial<Record<BuildingType, { width: number; height: number }>> = {
  [BuildingType.HOUSE]: { width: 32, height: 32 },
  [BuildingType.LUMBER_CAMP]: { width: 32, height: 32 },
  [BuildingType.BARRACKS]: { width: 48, height: 48 },
  [BuildingType.FARM]: { width: 64, height: 64 },
};

let applied = false;

/** Apply the shared footprint hierarchy once before building visuals are consumed. */
export function applyBuildingWorldScale(): void {
  if (applied) return;
  applied = true;

  for (const [type, footprint] of Object.entries(BUILDING_FOOTPRINT_OVERRIDES) as Array<
    [BuildingType, { width: number; height: number }]
  >) {
    const def = BUILDINGS[type];
    if (!def) continue;
    def.width = footprint.width;
    def.height = footprint.height;
  }
}
