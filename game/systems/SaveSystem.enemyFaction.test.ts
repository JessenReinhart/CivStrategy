import { describe, expect, it, vi } from 'vitest';

vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { deserializeGame } from './SaveSystem';
import { FactionType } from '../../types';
import type { MainScene } from '../MainScene';
import type { SaveGame } from '../../types';

function makeBuilding() {
  const data = new Map<string, unknown>();
  return {
    setData: vi.fn((key: string, value: unknown) => {
      data.set(key, value);
      return value;
    }),
    getData: vi.fn((key: string) => data.get(key)),
  };
}

describe('SaveSystem enemy faction restore', () => {
  it('restores the serialized enemy faction before enemy buildings respawn', () => {
    const savedEnemyFaction = FactionType.CARTHAGE;
    const building = makeBuilding();
    const enemyFactionAtSpawn: FactionType[] = [];

    const scene = {
      faction: FactionType.ROMANS,
      enemyFaction: FactionType.GAULS,
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
          enemyFactionAtSpawn.push(scene.enemyFaction);
          return building;
        }),
        spawnUnit: vi.fn(),
      },
      economySystem: { updateStats: vi.fn() },
      cameras: { main: { centerOn: vi.fn() } },
      mapWidth: 1024,
      mapHeight: 1024,
      maxPopulation: 5,
      happiness: 100,
    } as unknown as MainScene;

    const save = {
      enemyFaction: savedEnemyFaction,
      gameTime: 12_000,
      currentAge: 'Village',
      ageProgress: 0,
      isAdvancing: false,
      nextAge: null,
      currentSeason: 'Spring',
      seasonTimer: 500,
      resources: { wood: 100, food: 100, gold: 100 },
      population: 0,
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
      units: [],
      buildings: [{
        type: 'Town Center',
        owner: 1,
        x: 200,
        y: 200,
        hp: 100,
        maxHp: 100,
        workers: 0,
      }],
    } as unknown as SaveGame;

    deserializeGame(scene, save);

    expect(scene.enemyFaction).toBe(savedEnemyFaction);
    expect(enemyFactionAtSpawn).toEqual([savedEnemyFaction]);
  });
});
