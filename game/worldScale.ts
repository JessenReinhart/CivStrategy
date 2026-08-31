import { BUILDINGS } from '../constants';
import { BuildingType } from '../types';

/**
 * World-scale tuning used to make settlements read as larger, denser places.
 * Gameplay ranges and movement values intentionally stay unchanged; this pass
 * only changes physical building footprints and character presentation.
 */
export const WORLD_CHARACTER_SCALE = 0.8;

export const BUILDING_FOOTPRINT_OVERRIDES: Partial<Record<BuildingType, { width: number; height: number }>> = {
  [BuildingType.HOUSE]: { width: 32, height: 32 },
  [BuildingType.LUMBER_CAMP]: { width: 32, height: 32 },
  [BuildingType.BARRACKS]: { width: 48, height: 48 },
  [BuildingType.FARM]: { width: 64, height: 64 },
};

let buildingScaleApplied = false;

/**
 * Apply the canonical footprint hierarchy once to the shared BUILDINGS defs.
 * BUILDINGS is a shared object, so placement, pathfinding, collisions, AI and
 * rendering all consume the same dimensions instead of drifting apart.
 */
export function applyBuildingWorldScale(): void {
  if (buildingScaleApplied) return;
  buildingScaleApplied = true;

  for (const [type, footprint] of Object.entries(BUILDING_FOOTPRINT_OVERRIDES) as Array<
    [BuildingType, { width: number; height: number }]
  >) {
    const def = BUILDINGS[type];
    if (!def) continue;
    def.width = footprint.width;
    def.height = footprint.height;
  }
}
