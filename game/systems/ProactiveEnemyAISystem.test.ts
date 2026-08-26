import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Math: {
      Between: vi.fn(() => 0),
      Distance: {
        Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
      },
    },
  },
}));

vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { BUILDINGS } from '../../constants';
import { Age, BlueprintItem, BuildingDef, BuildingType, MapMode, Resources } from '../../types';
import type { MainScene } from '../MainScene';
import {
  canAffordBuilding,
  generateBuildSearchOffsets,
  isBuildingUnlockedForAI,
} from './EnemyAIBuildRules';
import { ProactiveEnemyAISystem } from './ProactiveEnemyAISystem';

type BuildInternals = {
  tickTownBuild(): void;
  selectedBlueprint: BlueprintItem[];
  personality: 'aggressor' | 'defender' | 'economist' | 'balanced';
  aiCurrentAge: Age;
};

function makeBuilding(type: BuildingType, x: number, y: number, owner = 1) {
  const data = new Map<string, unknown>([
    ['def', BUILDINGS[type]],
    ['owner', owner],
    ['hp', BUILDINGS[type].maxHp],
  ]);
  return {
    x,
    y,
    scene: {},
    getData: (key: string) => data.get(key),
    setData: (key: string, value: unknown) => {
      data.set(key, value);
      return undefined;
    },
  };
}

function makeScene(options: { blockedBase?: boolean; spawnSucceeds?: boolean } = {}) {
  const buildings: ReturnType<typeof makeBuilding>[] = [];
  const spawnBuilding = vi.fn((type: BuildingType, x: number, y: number, owner: number) => {
    if (options.spawnSucceeds === false) return null;
    const building = makeBuilding(type, x, y, owner);
    buildings.push(building);
    return building;
  });

  const scene = {
    mapMode: MapMode.FIXED,
    mapWidth: 2000,
    mapHeight: 2000,
    terrainSystem: {
      getWaterLevel: vi.fn(() => 0.38),
      getHeightAt: vi.fn((x: number, y: number) => options.blockedBase && x === 300 && y === 300 ? 0.2 : 0.55),
      getBiomeLabel: vi.fn((x: number, y: number) => options.blockedBase && x === 300 && y === 300 ? 'deep' : 'grass'),
      getSlopeAt: vi.fn(() => ({ slope: 0, isBuildable: true })),
    },
    buildings: { getChildren: () => buildings },
    entityFactory: { spawnBuilding },
  };

  return { scene: scene as unknown as MainScene, buildings, spawnBuilding };
}

function getInternals(ai: ProactiveEnemyAISystem): BuildInternals {
  return ai as unknown as BuildInternals;
}

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
      expect(canAffordBuilding({ ...enough, [resource]: market.cost[resource] - 1 }, market)).toBe(false);
    }
  });

  it('recovers from a blocked blueprint coordinate and keeps building one structure per tick', () => {
    const { scene, spawnBuilding } = makeScene({ blockedBase: true });
    const ai = new ProactiveEnemyAISystem(scene);
    const internals = getInternals(ai);
    internals.selectedBlueprint = [
      { type: BuildingType.TOWN_CENTER, x: 0, y: 0 },
      { type: BuildingType.HOUSE, x: 80, y: 0 },
    ];
    ai.buildings = [null, null];
    ai.baseX = 300;
    ai.baseY = 300;
    ai.resources = { wood: 5000, food: 5000, gold: 5000 };

    const before = { ...ai.resources };
    internals.tickTownBuild();
    expect(spawnBuilding).toHaveBeenCalledTimes(1);
    const [, firstX, firstY] = spawnBuilding.mock.calls[0];
    expect({ x: firstX, y: firstY }).not.toEqual({ x: 300, y: 300 });
    expect(ai.buildings[0]).toBeTruthy();
    expect(ai.resources.wood).toBe(before.wood - BUILDINGS[BuildingType.TOWN_CENTER].cost.wood);
    expect(ai.resources.food).toBe(before.food - BUILDINGS[BuildingType.TOWN_CENTER].cost.food);
    expect(ai.resources.gold).toBe(before.gold - BUILDINGS[BuildingType.TOWN_CENTER].cost.gold);

    internals.tickTownBuild();
    expect(spawnBuilding).toHaveBeenCalledTimes(2);
    expect(ai.buildings[1]).toBeTruthy();
  });

  it('does not spend resources when the entity factory fails to create a building', () => {
    const { scene } = makeScene({ spawnSucceeds: false });
    const ai = new ProactiveEnemyAISystem(scene);
    const internals = getInternals(ai);
    internals.selectedBlueprint = [{ type: BuildingType.HOUSE, x: 0, y: 0 }];
    ai.buildings = [null];
    ai.resources = { wood: 777, food: 666, gold: 555 };
    const before = { ...ai.resources };
    internals.tickTownBuild();
    expect(ai.resources).toEqual(before);
    expect(ai.buildings[0]).toBeNull();
  });

  it('continues personality-driven expansion and keeps it in AI simulation accounting', () => {
    const { scene, buildings, spawnBuilding } = makeScene();
    const ai = new ProactiveEnemyAISystem(scene);
    const internals = getInternals(ai);
    internals.selectedBlueprint = [{ type: BuildingType.TOWN_CENTER, x: 0, y: 0 }];
    internals.personality = 'economist';
    internals.aiCurrentAge = Age.VILLAGE;
    const townCenter = makeBuilding(BuildingType.TOWN_CENTER, 300, 300);
    buildings.push(townCenter);
    ai.buildings = [townCenter as never];
    ai.resources = { wood: 5000, food: 5000, gold: 5000 };

    internals.tickTownBuild();
    expect(spawnBuilding).toHaveBeenCalledTimes(1);
    const expansion = buildings[buildings.length - 1];
    expect(expansion?.getData('aiExpansion')).toBe(true);
    expect(ai.buildings).toContain(expansion);
    const expansionType = (expansion?.getData('def') as BuildingDef).type;
    expect([BuildingType.FARM, BuildingType.LUMBER_CAMP, BuildingType.HOUSE]).toContain(expansionType);
  });
});
