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
