import { describe, expect, it, vi } from 'vitest';

vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { deserializeGame } from './SaveSystem';
import { UnitState, UnitType } from '../../types';
import type { MainScene } from '../MainScene';
import type { SaveGame } from '../../types';

describe('SaveSystem worker assignment restore', () => {
  it('rebuilds worker assignments after villagers respawn and before stats publish', () => {
    const villager = { state: UnitState.IDLE };
    const spawnVillager = vi.fn(() => villager);
    const assignJobs = vi.fn();
    const updateStats = vi.fn();

    const scene = {
      units: { getChildren: () => [], remove: vi.fn() },
      buildings: { getChildren: () => [], remove: vi.fn() },
      villagerSystem: {
        getAllVillagers: () => [],
        destroyVillager: vi.fn(),
        spawnVillager,
      },
      unitSpatialHash: { remove: vi.fn() },
      pathfinder: { markGrid: vi.fn(), updateTerrainCosts: vi.fn() },
      terrainSystem: {},
      researchManager: undefined,
      enemyAI: undefined,
      entityFactory: { spawnBuilding: vi.fn(), spawnUnit: vi.fn() },
      economySystem: { assignJobs, updateStats },
      cameras: { main: { centerOn: vi.fn() } },
      mapWidth: 1024,
      mapHeight: 1024,
      maxPopulation: 8,
      happiness: 100,
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
      population: 1,
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
      units: [{
        type: UnitType.VILLAGER,
        owner: 0,
        x: 120,
        y: 140,
        hp: 100,
        maxHp: 100,
        state: UnitState.WORKING,
      }],
    } as unknown as SaveGame;

    deserializeGame(scene, save);

    expect(spawnVillager).toHaveBeenCalledTimes(1);
    expect(villager.state).toBe(UnitState.IDLE);
    expect(assignJobs).toHaveBeenCalledTimes(1);
    expect(updateStats).toHaveBeenCalledTimes(1);
    expect(spawnVillager.mock.invocationCallOrder[0]).toBeLessThan(assignJobs.mock.invocationCallOrder[0]);
    expect(assignJobs.mock.invocationCallOrder[0]).toBeLessThan(updateStats.mock.invocationCallOrder[0]);
  });
});
