import { AGE_CONFIGS } from '../../constants';
import { Age, BuildingDef, BuildingType, Resources } from '../../types';

const BUILD_SEARCH_RADII = [0, 48, 88, 128, 176, 232, 296, 360];
const BUILD_SEARCH_DIRECTIONS = 12;

const VILLAGE_BUILDINGS = new Set<BuildingType>([
  BuildingType.TOWN_CENTER,
  BuildingType.BONFIRE,
  BuildingType.HOUSE,
  BuildingType.FARM,
  BuildingType.LUMBER_CAMP,
  BuildingType.HUNTERS_LODGE,
  BuildingType.BARRACKS,
  BuildingType.WALL,
]);

export interface BuildOffset {
  x: number;
  y: number;
}

/** Deterministic search pattern so a bad blueprint coordinate cannot stall the AI. */
export function generateBuildSearchOffsets(): BuildOffset[] {
  const offsets: BuildOffset[] = [];
  for (const radius of BUILD_SEARCH_RADII) {
    if (radius === 0) {
      offsets.push({ x: 0, y: 0 });
      continue;
    }
    for (let i = 0; i < BUILD_SEARCH_DIRECTIONS; i++) {
      const angle = (i / BUILD_SEARCH_DIRECTIONS) * Math.PI * 2;
      offsets.push({
        x: Math.round(Math.cos(angle) * radius),
        y: Math.round(Math.sin(angle) * radius),
      });
    }
  }
  return offsets;
}

export function isBuildingUnlockedForAI(type: BuildingType, age: Age): boolean {
  if (VILLAGE_BUILDINGS.has(type)) return true;
  if (age === Age.TOWN) return AGE_CONFIGS[Age.TOWN].unlocksBuildings.includes(type);
  if (age === Age.CITY_STATE) {
    return AGE_CONFIGS[Age.TOWN].unlocksBuildings.includes(type)
      || AGE_CONFIGS[Age.CITY_STATE].unlocksBuildings.includes(type);
  }
  return false;
}

export function canAffordBuilding(resources: Resources, def: BuildingDef): boolean {
  return resources.wood >= def.cost.wood
    && resources.food >= def.cost.food
    && resources.gold >= def.cost.gold;
}

/**
 * Terrain-aware placement score (lower is better) for AI town expansion.
 * Balances blueprint proximity against tactical and economic terrain suitability:
 * - Farms favor fertile low-elevation valleys.
 * - Barracks, Castles, and Walls favor commanding high ground.
 * - Lumber Camps and Hunter's Lodges favor mid-elevation timber/game belts.
 */
export function scoreBuildSiteTerrain(
  type: BuildingType,
  height: number,
  offsetX: number,
  offsetY: number,
): number {
  const distancePenalty = Math.hypot(offsetX, offsetY);
  let terrainBonus = 0;
  if (type === BuildingType.FARM) {
    terrainBonus = Math.max(0, 0.66 - height) * 120;
  } else if (
    type === BuildingType.BARRACKS
    || type === BuildingType.CASTLE
    || type === BuildingType.WALL
  ) {
    terrainBonus = Math.max(0, height - 0.5) * 80;
  } else if (
    type === BuildingType.LUMBER_CAMP
    || type === BuildingType.HUNTERS_LODGE
  ) {
    const midBandCloseness = Math.max(0, 0.14 - Math.abs(height - 0.56));
    terrainBonus = midBandCloseness * 90;
  }
  return distancePenalty - terrainBonus;
}

/**
 * Orders an AI expansion pool so missing or underrepresented infrastructure
 * is constructed before duplicating already abundant building types, while
 * preserving deterministic rotation order as a tie-breaker.
 */
export function prioritizeExpansionPool(
  pool: readonly BuildingType[],
  existingCounts: Partial<Record<BuildingType, number>>,
  startOffset: number = 0,
): BuildingType[] {
  if (pool.length === 0) return [];
  const safeOffset = ((startOffset % pool.length) + pool.length) % pool.length;
  const rotated = pool.map((_, step) => ({
    type: pool[(safeOffset + step) % pool.length],
    step,
  }));
  rotated.sort((a, b) => {
    const countDiff = (existingCounts[a.type] ?? 0) - (existingCounts[b.type] ?? 0);
    return countDiff !== 0 ? countDiff : a.step - b.step;
  });
  return rotated.map(entry => entry.type);
}
