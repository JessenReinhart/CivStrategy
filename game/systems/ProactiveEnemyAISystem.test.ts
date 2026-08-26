import { describe, expect, it } from 'vitest';

import { BUILDINGS } from '../../constants';
import { Age, BuildingType } from '../../types';
import {
  canAffordBuilding,
  generateBuildSearchOffsets,
  isBuildingUnlockedForAI,
} from './ProactiveEnemyAISystem';

describe('ProactiveEnemyAISystem build rules', () => {
  it('keeps advanced buildings locked until the matching age', () => {
    expect(isBuildingUnlockedForAI(BuildingType.HOUSE, Age.VILLAGE)).toBe(true);
    expect(isBuildingUnlockedForAI(BuildingType.MARKET, Age.VILLAGE)).toBe(false);
    expect(isBuildingUnlockedForAI(BuildingType.MARKET, Age.TOWN)).toBe(true);
    expect(isBuildingUnlockedForAI(BuildingType.CATHEDRAL, Age.TOWN)).toBe(false);
    expect(isBuildingUnlockedForAI(BuildingType.CATHEDRAL, Age.CITY_STATE)).toBe(true);
    expect(isBuildingUnlockedForAI(BuildingType.CASTLE, Age.CITY_STATE)).toBe(true);
  });

  it('searches the requested site first and then many fallback positions', () => {
    const offsets = generateBuildSearchOffsets();

    expect(offsets[0]).toEqual({ x: 0, y: 0 });
    expect(offsets.length).toBeGreaterThan(70);
    expect(offsets.some(offset => Math.hypot(offset.x, offset.y) > 300)).toBe(true);
  });

  it('requires the full building resource cost', () => {
    const market = BUILDINGS[BuildingType.MARKET];

    expect(canAffordBuilding({ wood: 150, food: 0, gold: 100 }, market)).toBe(true);
    expect(canAffordBuilding({ wood: 149, food: 999, gold: 999 }, market)).toBe(false);
    expect(canAffordBuilding({ wood: 999, food: 999, gold: 99 }, market)).toBe(false);
  });
});
