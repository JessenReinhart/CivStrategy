import { describe, expect, it, vi } from 'vitest';

vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { deserializeGame } from './SaveSystem';
import { Age, BuildingType, UnitStance, UnitState, UnitType } from '../../types';
import type { MainScene } from '../MainScene';
import type { SaveGame } from '../../types';

function makeDataObject() {
  const data = new Map<string, unknown>();
  return {
    setData: vi.fn((key: string, value: unknown) => {
      data.set(key, value);
      return value;
    }),
    getData: vi.fn((key: string) => data.get(key)),
  };
}

function makeSave(garrison: Record<string, number>): SaveGame {
  return {
    version: 1,
    timestamp: 1,
    faction: 'Romans',
    enemyFaction: 'Gauls',
    mapMode: 'standard',
    mapSize: 'small',
    fowEnabled: true,
    peacefulMode: false,
    treatyLength: 0,
    aiDisabled: true,
    mapSeed: 123,
    mapPreset: 'balanced',
    gameTime: 10_000,
    currentAge: Age.VILLAGE,
    ageProgress: 0,
    isAdvancing: false,
    nextAge: null,
    currentSeason: 'spring',
    seasonTimer: 0,
    resources: { wood: 100, food: 100, gold: 100 },
    population: 0,
    happiness: 100,
    gameSpeed: 1,
    taxRate: 0,
    bloomIntensity: 1,
    units: [],
    buildings: [{
      type: BuildingType.CASTLE,
      owner: 0,
      x: 100,
      y: 120,
      hp: 900,
      maxHp: 1000,
      workers: 0,
      garrison,
    }],
    research: { completedPlayer: [], activePlayer: null, completedAI: [] },
    aiState: {
      personality: 'balanced',
      currentAge: Age.VILLAGE,
      ageProgress: 0,
      resources: { wood: 500, food: 500, gold: 500 },
      baseX: 200,
      baseY: 200,
      buildIndex: 0,
      selectedBlueprint: [],
      nextAttackTime: 0,
      lastEconomyTick: 0,
      lastBuildTick: 0,
      lastRecruitTick: 0,
      lastDefenseTick: 0,
      lastThreatCheck: 0,
      lastAttackTick: 0,
      lastTauntTime: 0,
      hasSpawnedStartingForest: false,
      personalityBonusBuildings: 0,
      aiCurrentAge: Age.VILLAGE,
      aiAgeProgress: 0,
      aiIsAdvancing: false,
    },
    dominanceProgress: 0,
    playerTerritoryPercent: 0,
    gameResult: null,
    victoryType: null,
  } as unknown as SaveGame;
}

describe('SaveSystem Castle garrison restore', () => {
  it('restores the serialized garrison onto a respawned Castle', () => {
    const castle = makeDataObject();
    const spawnBuilding = vi.fn(() => castle);
    const scene = {
      units: { getChildren: () => [], remove: vi.fn() },
      unitSpatialHash: { remove: vi.fn() },
      villagerSystem: {
        getAllVillagers: () => [],
        destroyVillager: vi.fn(),
        spawnVillager: vi.fn(),
      },
      buildings: { getChildren: () => [], remove: vi.fn() },
      pathfinder: { markGrid: vi.fn(), updateTerrainCosts: vi.fn() },
      terrainSystem: {},
      researchManager: undefined,
      enemyAI: undefined,
      entityFactory: { spawnBuilding, spawnUnit: vi.fn() },
      economySystem: { updateStats: vi.fn() },
      cameras: { main: { centerOn: vi.fn() } },
      mapWidth: 1024,
      mapHeight: 1024,
    } as unknown as MainScene;
    const garrison = { [UnitType.ARCHER]: 3, [UnitType.PIKESMAN]: 2 };

    deserializeGame(scene, makeSave(garrison));

    expect(spawnBuilding).toHaveBeenCalledWith(BuildingType.CASTLE, 100, 120, 0);
    expect(castle.setData).toHaveBeenCalledWith('garrison', garrison);
  });
});
