import { describe, expect, it, vi } from 'vitest';

vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { deserializeGame } from './SaveSystem';
import type { MainScene } from '../MainScene';
import type { SaveGame } from '../../types';

function makeSaveWithoutActiveResearch(): SaveGame {
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
    mapSeed: 1,
    mapPreset: 'balanced',
    gameTime: 1000,
    currentAge: 'Village',
    ageProgress: 0,
    isAdvancing: false,
    nextAge: null,
    currentSeason: 'Spring',
    seasonTimer: 0,
    resources: { wood: 123, food: 234, gold: 345 },
    population: 0,
    happiness: 100,
    gameSpeed: 1,
    taxRate: 0,
    bloomIntensity: 1,
    units: [],
    buildings: [],
    research: {
      completedPlayer: [],
      activePlayer: null,
      completedAI: [],
    },
    aiState: {
      personality: 'balanced',
      currentAge: 'Village',
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
      aiCurrentAge: 'Village',
      aiAgeProgress: 0,
      aiIsAdvancing: false,
    },
    dominanceProgress: 0,
    playerTerritoryPercent: 0,
    gameResult: null,
    victoryType: null,
  } as unknown as SaveGame;
}

function makeSceneWithResearch(active: { techId: string; remainingMs: number } | null = null) {
  let activeResearch = active;
  const researchManager = {
    setCompleted: vi.fn(),
    setActiveResearch: vi.fn((playerId: number, techId: string, remainingMs: number) => {
      if (playerId === 0) activeResearch = { techId, remainingMs };
    }),
    clearActiveResearch: vi.fn((playerId: number) => {
      if (playerId === 0) activeResearch = null;
    }),
    rebuildSnapshotPublic: vi.fn(),
    getActive: vi.fn(() => activeResearch),
  };

  const scene = {
    faction: 'Romans',
    enemyFaction: 'Gauls',
    units: { getChildren: () => [], remove: vi.fn() },
    buildings: { getChildren: () => [], remove: vi.fn() },
    villagerSystem: { getAllVillagers: () => [], destroyVillager: vi.fn(), spawnVillager: vi.fn() },
    unitSpatialHash: { remove: vi.fn() },
    pathfinder: { markGrid: vi.fn(), updateTerrainCosts: vi.fn() },
    terrainSystem: {},
    researchManager,
    enemyAI: undefined,
    entityFactory: { spawnBuilding: vi.fn(), spawnUnit: vi.fn() },
    economySystem: { updateStats: vi.fn() },
    cameras: { main: { centerOn: vi.fn() } },
    mapWidth: 1024,
    mapHeight: 1024,
    resources: { wood: 999, food: 999, gold: 999 },
  } as unknown as MainScene;

  return { scene, researchManager };
}

describe('SaveSystem research restoration', () => {
  it('clears stale active research when the loaded save has none without changing restored resources', () => {
    const { scene, researchManager } = makeSceneWithResearch({ techId: 'stale-tech', remainingMs: 9999 });
    const save = makeSaveWithoutActiveResearch();

    deserializeGame(scene, save);

    expect(researchManager.clearActiveResearch).toHaveBeenCalledWith(0);
    expect(researchManager.setActiveResearch).not.toHaveBeenCalled();
    expect(researchManager.getActive(0)).toBeNull();
    expect(scene.resources).toEqual(save.resources);
  });

  it('restores serialized active research instead of clearing it', () => {
    const { scene, researchManager } = makeSceneWithResearch({ techId: 'stale-tech', remainingMs: 9999 });
    const save = makeSaveWithoutActiveResearch();
    save.research.activePlayer = { techId: 'saved-tech', remainingMs: 4321 } as never;

    deserializeGame(scene, save);

    expect(researchManager.clearActiveResearch).not.toHaveBeenCalled();
    expect(researchManager.setActiveResearch).toHaveBeenCalledWith(0, 'saved-tech', 4321);
    expect(researchManager.getActive(0)).toEqual({ techId: 'saved-tech', remainingMs: 4321 });
    expect(scene.resources).toEqual(save.resources);
  });
});
