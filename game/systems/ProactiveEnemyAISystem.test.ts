import { describe, expect, it } from 'vitest';

import { BUILDINGS } from '../../constants';
import { Age, BuildingType, Resources } from '../../types';
import {
  canAffordBuilding,
  generateBuildSearchOffsets,
  isBuildingUnlockedForAI,
} from './EnemyAIBuildRules';

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
    const enough: Resources = { ...market.cost };

    expect(canAffordBuilding(enough, market)).toBe(true);

    for (const resource of ['wood', 'food', 'gold'] as const) {
      if (market.cost[resource] <= 0) continue;
      expect(canAffordBuilding({
        ...enough,
        [resource]: market.cost[resource] - 1,
      }, market)).toBe(false);
    }
  });
});
