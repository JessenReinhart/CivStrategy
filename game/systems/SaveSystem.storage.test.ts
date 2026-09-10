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
  aiState: {},
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
