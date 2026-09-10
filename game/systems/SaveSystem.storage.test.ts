import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../MainScene', () => ({ MainScene: class {} }));

import {
  clearPendingLoad,
  clearSave,
  hasSave,
  isPendingLoad,
  loadFromLocalStorage,
  PENDING_LOAD_KEY,
  SAVE_KEY,
  saveToLocalStorage,
  setPendingLoad,
} from './SaveSystem';

const storage = new Map<string, string>();
const OPTIONAL_AI_RESTORE_FIELDS = [
  'nextAttackTime',
  'lastEconomyTick',
  'lastBuildTick',
  'lastRecruitTick',
  'lastDefenseTick',
  'lastThreatCheck',
  'lastAttackTick',
  'lastTauntTime',
  'hasSpawnedStartingForest',
  'personalityBonusBuildings',
  'aiCurrentAge',
  'aiAgeProgress',
  'aiIsAdvancing',
] as const;
const aiState = {
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
};
const save = {
  version: 1,
  timestamp: 123,
  faction: 'Romans',
  enemyFaction: 'Gauls',
  mapMode: 'Fixed Map',
  mapSize: 'Medium',
  fowEnabled: true,
  peacefulMode: false,
  treatyLength: 10,
  aiDisabled: false,
  mapSeed: 42,
  mapPreset: 'standard',
  gameTime: 0,
  currentAge: 'Village',
  ageProgress: 0,
  isAdvancing: false,
  nextAge: null,
  currentSeason: 'spring',
  seasonTimer: 0,
  resources: { wood: 500, food: 500, gold: 500 },
  population: 4,
  happiness: 100,
  gameSpeed: 1,
  units: [],
  buildings: [],
  research: { completedPlayer: [], activePlayer: null, completedAI: [] },
  aiState,
  dominanceProgress: 0,
  playerTerritoryPercent: 0,
  gameResult: 'ongoing',
  victoryType: 'none',
} as unknown as Parameters<typeof saveToLocalStorage>[0];

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

describe('SaveSystem storage helpers', () => {
  it('preserves normal save and pending-load behavior', () => {
    expect(hasSave()).toBe(false);

    saveToLocalStorage(save);
    expect(hasSave()).toBe(true);
    expect(loadFromLocalStorage()).toMatchObject({ version: 1, mapSeed: 42, faction: 'Romans' });

    setPendingLoad();
    expect(storage.get(PENDING_LOAD_KEY)).toBe('true');
    expect(isPendingLoad()).toBe(true);

    clearPendingLoad();
    expect(isPendingLoad()).toBe(false);

    setPendingLoad();
    clearSave();
    expect(storage.has(SAVE_KEY)).toBe(false);
    expect(storage.has(PENDING_LOAD_KEY)).toBe(false);
  });

  it('accepts ordinary serialized unit and building records', () => {
    storage.set(SAVE_KEY, JSON.stringify({
      ...save,
      units: [{
        type: 'Villager', owner: 0, x: 12, y: 14, hp: 100, maxHp: 100,
        state: 'idle', stance: 'Hold',
      }],
      buildings: [{
        type: 'House', owner: 0, x: 20, y: 24, hp: 250, maxHp: 250, workers: 0,
      }],
    }));

    expect(hasSave()).toBe(true);
    expect(loadFromLocalStorage()).toMatchObject({
      units: [{ type: 'Villager', owner: 0 }],
      buildings: [{ type: 'House', owner: 0 }],
    });
  });

  it('accepts ordinary serialized AI state', () => {
    storage.set(SAVE_KEY, JSON.stringify({
      ...save,
      aiState: {
        ...aiState,
        selectedBlueprint: [{ type: 'Barracks', x: 32, y: -16 }],
      },
    }));

    expect(hasSave()).toBe(true);
    expect(loadFromLocalStorage()).toMatchObject({
      aiState: { selectedBlueprint: [{ type: 'Barracks', x: 32, y: -16 }] },
    });
  });

  it('accepts legacy version-1 AI state when optional restore fields are absent', () => {
    const legacyAIState: Record<string, unknown> = { ...aiState };
    for (const field of OPTIONAL_AI_RESTORE_FIELDS) delete legacyAIState[field];

    storage.set(SAVE_KEY, JSON.stringify({ ...save, aiState: legacyAIState }));

    expect(hasSave()).toBe(true);
    expect(loadFromLocalStorage()).toMatchObject({ aiState: legacyAIState });
  });

  it('rejects a version-compatible save that is missing required runtime state', () => {
    storage.set(SAVE_KEY, JSON.stringify({ version: 1 }));

    expect(hasSave()).toBe(false);
    expect(loadFromLocalStorage()).toBeNull();
  });

  it('rejects malformed entity records before Continue can expose them', () => {
    storage.set(SAVE_KEY, JSON.stringify({ ...save, units: [null] }));
    expect(hasSave()).toBe(false);
    expect(loadFromLocalStorage()).toBeNull();

    storage.set(SAVE_KEY, JSON.stringify({
      ...save,
      buildings: [{ type: 'Not A Building', owner: 0, x: 10, y: 10, hp: 100, maxHp: 100 }],
    }));
    expect(hasSave()).toBe(false);
    expect(loadFromLocalStorage()).toBeNull();
  });

  it('rejects malformed AI state before Continue can replace the live world', () => {
    storage.set(SAVE_KEY, JSON.stringify({
      ...save,
      aiState: { ...aiState, selectedBlueprint: {} },
    }));
    expect(hasSave()).toBe(false);
    expect(loadFromLocalStorage()).toBeNull();

    storage.set(SAVE_KEY, JSON.stringify({
      ...save,
      aiState: {
        ...aiState,
        selectedBlueprint: [{ type: 'Not A Building', x: 10, y: 10 }],
      },
    }));
    expect(hasSave()).toBe(false);
    expect(loadFromLocalStorage()).toBeNull();

    storage.set(SAVE_KEY, JSON.stringify({
      ...save,
      aiState: {
        ...aiState,
        resources: { wood: 'broken', food: 500, gold: 500 },
      },
    }));
    expect(hasSave()).toBe(false);
    expect(loadFromLocalStorage()).toBeNull();
  });

  it.each([
    ['aiCurrentAge', 2],
    ['aiAgeProgress', 'broken'],
    ['aiIsAdvancing', 'broken'],
    ['nextAttackTime', 'broken'],
    ['lastEconomyTick', 'broken'],
    ['lastBuildTick', 'broken'],
    ['lastRecruitTick', 'broken'],
    ['lastDefenseTick', 'broken'],
    ['lastThreatCheck', 'broken'],
    ['lastAttackTick', 'broken'],
    ['lastTauntTime', 'broken'],
    ['hasSpawnedStartingForest', 1],
    ['personalityBonusBuildings', 'broken'],
  ] as const)('rejects malformed optional AI restore field %s when present', (field, malformed) => {
    storage.set(SAVE_KEY, JSON.stringify({
      ...save,
      aiState: { ...aiState, [field]: malformed },
    }));

    expect(hasSave()).toBe(false);
    expect(loadFromLocalStorage()).toBeNull();
  });

  it('propagates failed save writes to the caller', () => {
    const blocked = new Error('storage blocked');
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: () => { throw blocked; },
      removeItem: (key: string) => storage.delete(key),
    });

    expect(() => saveToLocalStorage(save)).toThrow(blocked);
    expect(storage.has(SAVE_KEY)).toBe(false);
  });

  it('keeps non-authoritative storage helpers fail-closed when storage access is blocked', () => {
    const blocked = new Error('storage blocked');
    vi.stubGlobal('localStorage', {
      getItem: () => { throw blocked; },
      setItem: () => { throw blocked; },
      removeItem: () => { throw blocked; },
    });

    expect(hasSave()).toBe(false);
    expect(isPendingLoad()).toBe(false);
    expect(() => setPendingLoad()).not.toThrow();
    expect(() => clearPendingLoad()).not.toThrow();
    expect(() => clearSave()).not.toThrow();
  });
});
