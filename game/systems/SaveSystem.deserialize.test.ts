import { describe, expect, it, vi } from 'vitest';

vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { deserializeGame, serializeGame } from './SaveSystem';
import { BuildingType, UnitState, UnitType } from '../../types';
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

  it('preserves a Barracks rally waypoint through a save/load round trip', () => {
    const waypoint = { x: 640, y: 720 };
    const sourceBarracks = {
      x: 300,
      y: 320,
      getData: vi.fn((key: string) => ({
        def: { type: BuildingType.BARRACKS },
        owner: 0,
        hp: 500,
        maxHp: 500,
        workers: 0,
        waypoint,
      })[key]),
    };
    const sourceScene = createScene({
      faction: 'Romans',
      enemyFaction: 'Gauls',
      mapMode: 'Fixed Map',
      isFowEnabled: true,
      peacefulMode: false,
      treatyLength: 300_000,
      aiDisabled: false,
      mapSeed: 42,
      mapPreset: 'standard',
      gameTime: 12_000,
      currentAge: 'Village',
      ageProgress: 0,
      isAdvancing: false,
      nextAge: null,
      currentSeason: 'Spring',
      seasonTimer: 500,
      resources: { wood: 100, food: 100, gold: 100 },
      population: 4,
      happiness: 70,
      gameSpeed: 1,
      taxRate: 0,
      bloomIntensity: 1,
      dominanceProgress: 0,
      playerTerritoryPercent: 0,
      gameResult: null,
      victoryType: null,
      buildings: { getChildren: () => [sourceBarracks], remove: vi.fn() },
    });

    const save = serializeGame(sourceScene);
    const savedBarracks = save.buildings[0] as SaveGame['buildings'][number] & {
      waypoint?: { x: number; y: number };
    };
    expect(savedBarracks.waypoint).toEqual(waypoint);

    const setData = vi.fn();
    const restoredBarracks = { setData };
    const loadScene = createScene({
      entityFactory: {
        spawnBuilding: vi.fn(() => restoredBarracks),
        spawnUnit: vi.fn(),
      },
    });

    deserializeGame(loadScene, save);

    expect(setData).toHaveBeenCalledWith('waypoint', waypoint);
  });
});
