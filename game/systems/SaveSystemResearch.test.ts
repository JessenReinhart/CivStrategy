import { describe, expect, it, vi } from 'vitest';

vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { deserializeGame, serializeGame } from './SaveSystem';
import type { MainScene } from '../MainScene';
import type { SaveGame } from '../../types';

type TestActiveResearch = { techId: string; remainingMs: number };

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

function makeSceneWithResearch(
  playerActive: TestActiveResearch | null = null,
  aiActive: TestActiveResearch | null = null,
) {
  const activeResearch = new Map<number, TestActiveResearch>();
  if (playerActive) activeResearch.set(0, playerActive);
  if (aiActive) activeResearch.set(1, aiActive);

  const researchManager = {
    setCompleted: vi.fn(),
    setActiveResearch: vi.fn((playerId: number, techId: string, remainingMs: number) => {
      activeResearch.set(playerId, { techId, remainingMs });
    }),
    clearActiveResearch: vi.fn((playerId: number) => {
      activeResearch.delete(playerId);
    }),
    rebuildSnapshotPublic: vi.fn(),
    getActive: vi.fn((playerId: number) => activeResearch.get(playerId) ?? null),
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

function makeSerializableSceneWithAIResearch(activeAI: TestActiveResearch | null): MainScene {
  const researchManager = {
    getSnapshot: vi.fn(() => ({ completed: new Set() })),
    getActive: vi.fn((playerId: number) => playerId === 1 ? activeAI : null),
  };

  return {
    faction: 'Romans',
    enemyFaction: 'Gauls',
    mapMode: 'standard',
    mapWidth: 1024,
    mapHeight: 1024,
    isFowEnabled: true,
    peacefulMode: false,
    treatyLength: 0,
    aiDisabled: false,
    mapSeed: 1,
    mapPreset: 'balanced',
    gameTime: 1000,
    currentAge: 'Village',
    ageProgress: 0,
    isAdvancing: false,
    nextAge: null,
    currentSeason: 'Spring',
    resources: { wood: 123, food: 234, gold: 345 },
    population: 0,
    happiness: 100,
    gameSpeed: 1,
    taxRate: 0,
    bloomIntensity: 1,
    units: { getChildren: () => [] },
    buildings: { getChildren: () => [] },
    villagerSystem: { getAllVillagers: () => [] },
    researchManager,
    enemyAI: undefined,
    dominanceProgress: 0,
    playerTerritoryPercent: 0,
    gameResult: null,
    victoryType: null,
  } as unknown as MainScene;
}

describe('SaveSystem research restoration', () => {
  it('serializes active AI research with its remaining time', () => {
    const scene = makeSerializableSceneWithAIResearch({ techId: 'foraging_i', remainingMs: 3500 });

    const save = serializeGame(scene);

    expect(save.research.activeAI).toEqual({ techId: 'foraging_i', remainingMs: 3500 });
  });

  it('clears stale active research when the loaded save has none without changing restored resources', () => {
    const { scene, researchManager } = makeSceneWithResearch({ techId: 'stale-tech', remainingMs: 9999 });
    const save = makeSaveWithoutActiveResearch();

    deserializeGame(scene, save);

    expect(researchManager.clearActiveResearch).toHaveBeenCalledWith(0);
    expect(researchManager.setActiveResearch).not.toHaveBeenCalledWith(0, expect.anything(), expect.anything());
    expect(researchManager.getActive(0)).toBeNull();
    expect(scene.resources).toEqual(save.resources);
  });

  it('restores serialized active research instead of clearing it', () => {
    const { scene, researchManager } = makeSceneWithResearch({ techId: 'stale-tech', remainingMs: 9999 });
    const save = makeSaveWithoutActiveResearch();
    save.research.activePlayer = { techId: 'saved-tech', remainingMs: 4321 } as never;

    deserializeGame(scene, save);

    expect(researchManager.clearActiveResearch).not.toHaveBeenCalledWith(0);
    expect(researchManager.setActiveResearch).toHaveBeenCalledWith(0, 'saved-tech', 4321);
    expect(researchManager.getActive(0)).toEqual({ techId: 'saved-tech', remainingMs: 4321 });
    expect(scene.resources).toEqual(save.resources);
  });

  it('clears stale AI research when an older version-1 save has no activeAI field', () => {
    const { scene, researchManager } = makeSceneWithResearch(null, { techId: 'stale-ai-tech', remainingMs: 9999 });
    const save = makeSaveWithoutActiveResearch();

    deserializeGame(scene, save);

    expect(researchManager.clearActiveResearch).toHaveBeenCalledWith(1);
    expect(researchManager.getActive(1)).toBeNull();
    expect(scene.resources).toEqual(save.resources);
  });

  it('restores serialized active AI research instead of clearing it', () => {
    const { scene, researchManager } = makeSceneWithResearch(null, { techId: 'stale-ai-tech', remainingMs: 9999 });
    const save = makeSaveWithoutActiveResearch();
    save.research.activeAI = { techId: 'saved-ai-tech', remainingMs: 2468 } as never;

    deserializeGame(scene, save);

    expect(researchManager.clearActiveResearch).not.toHaveBeenCalledWith(1);
    expect(researchManager.setActiveResearch).toHaveBeenCalledWith(1, 'saved-ai-tech', 2468);
    expect(researchManager.getActive(1)).toEqual({ techId: 'saved-ai-tech', remainingMs: 2468 });
    expect(scene.resources).toEqual(save.resources);
  });
});
