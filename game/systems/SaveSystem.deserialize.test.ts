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
    trees: { getChildren: () => [] },
    villagerSystem: {
      getAllVillagers: () => [],
      destroyVillager: vi.fn(),
      spawnVillager: vi.fn(() => ({ state: UnitState.IDLE, carryAmount: 0, carryType: null })),
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
    const villager = { state: UnitState.IDLE, carryAmount: 0, carryType: null };
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

  it('round-trips gathered villager carry without exposing it to job reassignment first', () => {
    const sourceVillager = {
      owner: 0,
      x: 180,
      y: 220,
      state: UnitState.GATHERING,
      carryAmount: 7,
      carryType: 'wood' as const,
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
      population: 1,
      happiness: 70,
      gameSpeed: 1,
      taxRate: 0,
      bloomIntensity: 1,
      dominanceProgress: 0,
      playerTerritoryPercent: 0,
      gameResult: null,
      victoryType: null,
      villagerSystem: {
        getAllVillagers: () => [sourceVillager],
        destroyVillager: vi.fn(),
        spawnVillager: vi.fn(),
      },
    });

    const save = serializeGame(sourceScene);
    const savedVillager = save.units.find((unit) => unit.type === UnitType.VILLAGER) as SaveGame['units'][number] & {
      carryAmount?: number;
      carryType?: 'wood' | 'food' | 'gold' | null;
    };
    expect(savedVillager).toMatchObject({
      state: UnitState.CARRYING,
      carryAmount: 7,
      carryType: 'wood',
    });

    const restoredVillager = { state: UnitState.IDLE, carryAmount: 0, carryType: null as 'wood' | 'food' | 'gold' | null };
    const spawnVillager = vi.fn(() => restoredVillager);
    const assignJobs = vi.fn();
    const loadScene = createScene({
      villagerSystem: {
        getAllVillagers: () => [],
        destroyVillager: vi.fn(),
        spawnVillager,
      },
      economySystem: { assignJobs, updateStats: vi.fn() },
    });

    deserializeGame(loadScene, save);

    expect(restoredVillager).toMatchObject({
      state: UnitState.CARRYING,
      carryAmount: 7,
      carryType: 'wood',
    });
    expect(assignJobs).toHaveBeenCalledTimes(1);
  });

  it('keeps older version-1 villager saves without carry fields backward-compatible', () => {
    const restoredVillager = { state: UnitState.IDLE, carryAmount: 0, carryType: null };
    const scene = createScene({
      villagerSystem: {
        getAllVillagers: () => [],
        destroyVillager: vi.fn(),
        spawnVillager: vi.fn(() => restoredVillager),
      },
    });
    const oldSave = createSave([{
      type: UnitType.VILLAGER,
      owner: 0,
      x: 120,
      y: 140,
      hp: 100,
      maxHp: 100,
      state: UnitState.CARRYING,
    } as SaveGame['units'][number]]);

    deserializeGame(scene, oldSave);

    expect(restoredVillager).toEqual({
      state: UnitState.IDLE,
      carryAmount: 0,
      carryType: null,
    });
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

  it('round-trips partial and depleted finite gold mines without replenishing them', () => {
    const partialData: Record<string, unknown> = {
      isGoldMine: true,
      goldRemaining: 37,
      isDepleted: false,
      isChopped: false,
    };
    const depletedData: Record<string, unknown> = {
      isGoldMine: true,
      goldRemaining: 0,
      isDepleted: true,
      isChopped: true,
      depletedAt: 8_000,
    };
    const sourceMines = [
      { x: 240, y: 360, getData: (key: string) => partialData[key] },
      { x: 640, y: 480, getData: (key: string) => depletedData[key] },
    ];
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
      resources: { wood: 100, food: 100, gold: 163 },
      population: 1,
      happiness: 70,
      gameSpeed: 1,
      taxRate: 0,
      bloomIntensity: 1,
      dominanceProgress: 0,
      playerTerritoryPercent: 0,
      gameResult: null,
      victoryType: null,
      trees: { getChildren: () => sourceMines },
    });

    const save = serializeGame(sourceScene) as SaveGame & {
      resourceNodes?: {
        goldMines: Array<{
          x: number;
          y: number;
          goldRemaining: number;
          isDepleted: boolean;
          isChopped: boolean;
          depletedAt?: number;
        }>;
      };
    };
    expect(save.resourceNodes?.goldMines).toEqual([
      { x: 240, y: 360, goldRemaining: 37, isDepleted: false, isChopped: false, depletedAt: undefined },
      { x: 640, y: 480, goldRemaining: 0, isDepleted: true, isChopped: true, depletedAt: 8_000 },
    ]);

    const partialSetData = vi.fn();
    const depletedSetData = vi.fn();
    const setTexture = vi.fn();
    const setTint = vi.fn();
    const setScale = vi.fn();
    const restoredMines = [
      {
        x: 240,
        y: 360,
        getData: (key: string) => key === 'isGoldMine',
        setData: partialSetData,
      },
      {
        x: 640,
        y: 480,
        getData: (key: string) => key === 'isGoldMine',
        setData: depletedSetData,
        visual: { active: true, setTexture, setTint, setScale },
      },
    ];
    const loadScene = createScene({ trees: { getChildren: () => restoredMines } });

    deserializeGame(loadScene, save);

    expect(partialSetData).toHaveBeenCalledWith('goldRemaining', 37);
    expect(partialSetData).toHaveBeenCalledWith('isDepleted', false);
    expect(partialSetData).toHaveBeenCalledWith('isChopped', false);
    expect(depletedSetData).toHaveBeenCalledWith('goldRemaining', 0);
    expect(depletedSetData).toHaveBeenCalledWith('isDepleted', true);
    expect(depletedSetData).toHaveBeenCalledWith('isChopped', true);
    expect(depletedSetData).toHaveBeenCalledWith('depletedAt', 8_000);
    expect(setTexture).toHaveBeenCalledWith('stump');
    expect(setTint).toHaveBeenCalledWith(0xffffff);
    expect(setScale).toHaveBeenCalledWith(0.075);
  });

  it('keeps older version-1 saves without resource-node state backward-compatible', () => {
    const setData = vi.fn();
    const scene = createScene({
      trees: {
        getChildren: () => [{
          x: 240,
          y: 360,
          getData: (key: string) => key === 'isGoldMine',
          setData,
        }],
      },
    });

    deserializeGame(scene, createSave());

    expect(setData).not.toHaveBeenCalled();
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