import { describe, expect, it, vi } from 'vitest';

vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { deserializeGame } from './SaveSystem';
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

describe('SaveSystem happiness restore', () => {
  it('preserves serialized happiness and rebuilds max population from the normal base', () => {
    const savedHappiness = 61;
    const happinessBonus = 8;
    const populationBonus = 4;
    const building = makeDataObject();

    const scene = {
      units: {
        getChildren: () => [],
        remove: vi.fn(),
      },
      buildings: {
        getChildren: () => [],
        remove: vi.fn(),
      },
      villagerSystem: {
        getAllVillagers: () => [],
        destroyVillager: vi.fn(),
        spawnVillager: vi.fn(),
      },
      unitSpatialHash: { remove: vi.fn() },
      pathfinder: {
        markGrid: vi.fn(),
        updateTerrainCosts: vi.fn(),
      },
      terrainSystem: {},
      researchManager: undefined,
      enemyAI: undefined,
      entityFactory: {
        spawnBuilding: vi.fn(() => {
          // Match the live EntityFactory side effects used during restoration.
          scene.maxPopulation += populationBonus;
          scene.happiness += happinessBonus;
          return building;
        }),
        spawnUnit: vi.fn(),
      },
      economySystem: { updateStats: vi.fn() },
      cameras: { main: { centerOn: vi.fn() } },
      mapWidth: 1024,
      mapHeight: 1024,
      maxPopulation: 999,
      happiness: 999,
    } as unknown as MainScene;

    const save = {
      gameTime: 12_000,
      currentAge: 'Village',
      ageProgress: 0,
      isAdvancing: false,
      nextAge: null,
      currentSeason: 'Spring',
      seasonTimer: 500,
      resources: { wood: 100, food: 100, gold: 100 },
      population: 0,
      happiness: savedHappiness,
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
      units: [],
      buildings: [{
        type: 'Bonfire',
        owner: 0,
        x: 100,
        y: 100,
        hp: 100,
        maxHp: 100,
        workers: 0,
      }],
    } as unknown as SaveGame;

    deserializeGame(scene, save);

    expect(scene.happiness).toBe(savedHappiness);
    expect(scene.maxPopulation).toBe(8 + populationBonus);
    expect(scene.entityFactory.spawnBuilding).toHaveBeenCalledTimes(1);
  });
});
