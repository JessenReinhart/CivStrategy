import { describe, expect, it, vi } from 'vitest';

vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { deserializeGame } from './SaveSystem';
import { UnitState, UnitType } from '../../types';
import type { MainScene } from '../MainScene';
import type { SaveGame } from '../../types';

function createSave(units: SaveGame['units'] = []): SaveGame {
  return {
    gameTime: 12_000,
    currentAge: 'Village',
    ageProgress: 0,
    isAdvancing: false,
    nextAge: null,
    currentSeason: 'Spring',
    seasonTimer: 500,
    resources: { wood: 100, food: 100, gold: 100 },
    population: units.length,
    happiness: 70,
    gameSpeed: 1,
    taxRate: 0,
    bloomIntensity: 1,
    dominanceProgress: 0,
    playerTerritoryPercent: 0,
    gameResult: null,
    victoryType: null,
    research: {
      completedPlayer: [],
      activePlayer: null,
      completedAI: [],
    },
    aiState: {},
    buildings: [],
    units,
  } as unknown as SaveGame;
}

function createScene(overrides: Record<string, unknown> = {}): MainScene {
  const scene = {
    units: { getChildren: () => [], remove: vi.fn() },
    buildings: { getChildren: () => [], remove: vi.fn() },
    villagerSystem: {
      getAllVillagers: () => [],
      destroyVillager: vi.fn(),
      spawnVillager: vi.fn(() => ({ state: UnitState.IDLE })),
    },
    unitSpatialHash: { remove: vi.fn() },
    pathfinder: { markGrid: vi.fn(), updateTerrainCosts: vi.fn() },
    terrainSystem: {},
    researchManager: undefined,
    enemyAI: undefined,
    entityFactory: { spawnBuilding: vi.fn(), spawnUnit: vi.fn() },
    economySystem: { assignJobs: vi.fn(), updateStats: vi.fn() },
    cameras: { main: { centerOn: vi.fn() } },
    mapWidth: 1024,
    mapHeight: 1024,
    maxPopulation: 8,
    happiness: 100,
    ...overrides,
  };

  return scene as unknown as MainScene;
}

describe('SaveSystem load continuity', () => {
  it('rebuilds worker assignments after villagers respawn and before stats publish', () => {
    const villager = { state: UnitState.IDLE };
    const spawnVillager = vi.fn(() => villager);
    const assignJobs = vi.fn();
    const updateStats = vi.fn();
    const scene = createScene({
      villagerSystem: {
        getAllVillagers: () => [],
        destroyVillager: vi.fn(),
        spawnVillager,
      },
      economySystem: { assignJobs, updateStats },
    });

    const save = createSave([{
      type: UnitType.VILLAGER,
      owner: 0,
      x: 120,
      y: 140,
      hp: 100,
      maxHp: 100,
      state: UnitState.WORKING,
    } as SaveGame['units'][number]]);

    deserializeGame(scene, save);

    expect(spawnVillager).toHaveBeenCalledTimes(1);
    expect(villager.state).toBe(UnitState.IDLE);
    expect(assignJobs).toHaveBeenCalledTimes(1);
    expect(updateStats).toHaveBeenCalledTimes(1);
    expect(spawnVillager.mock.invocationCallOrder[0]).toBeLessThan(assignJobs.mock.invocationCallOrder[0]);
    expect(assignJobs.mock.invocationCallOrder[0]).toBeLessThan(updateStats.mock.invocationCallOrder[0]);
  });

  it('clears player selection before destroying entities from the current world', () => {
    const clearSelection = vi.fn();
    const deselectBuilding = vi.fn();
    const removeUnit = vi.fn();
    const removeBuilding = vi.fn();
    const oldUnit = { getData: vi.fn(), visual: undefined };
    const oldBuilding = { getData: vi.fn(() => undefined), visual: undefined };

    const scene = createScene({
      inputManager: { clearSelection, deselectBuilding },
      units: { getChildren: () => [oldUnit], remove: removeUnit },
      buildings: { getChildren: () => [oldBuilding], remove: removeBuilding },
    });

    deserializeGame(scene, createSave());

    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(deselectBuilding).toHaveBeenCalledTimes(1);
    expect(removeUnit).toHaveBeenCalledTimes(1);
    expect(removeBuilding).toHaveBeenCalledTimes(1);
    expect(clearSelection.mock.invocationCallOrder[0]).toBeLessThan(removeUnit.mock.invocationCallOrder[0]);
    expect(deselectBuilding.mock.invocationCallOrder[0]).toBeLessThan(removeBuilding.mock.invocationCallOrder[0]);
  });
});
