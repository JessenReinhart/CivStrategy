import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { getSaveMeta, SAVE_KEY } from './SaveSystem';

const storage = new Map<string, string>();

const validSave = {
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
};

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

describe('getSaveMeta', () => {
  it('returns null for an incompatible save version', () => {
    storage.set(SAVE_KEY, JSON.stringify({ ...validSave, version: 999 }));
    expect(getSaveMeta()).toBeNull();
  });

  it('returns metadata for a structurally valid current save', () => {
    storage.set(SAVE_KEY, JSON.stringify(validSave));

    expect(getSaveMeta()).toEqual({
      timestamp: 123,
      faction: 'Romans',
      mapSeed: 42,
      mapPreset: 'standard',
      currentAge: 'Village',
    });
  });

  it('returns null for a version-compatible save missing required runtime state', () => {
    storage.set(SAVE_KEY, JSON.stringify({
      version: 1,
      timestamp: 123,
      faction: 'Romans',
      mapSeed: 42,
      mapPreset: 'standard',
      currentAge: 'Village',
    }));

    expect(getSaveMeta()).toBeNull();
  });

  it('returns null for malformed save JSON', () => {
    storage.set(SAVE_KEY, '{not-json');
    expect(getSaveMeta()).toBeNull();
  });
});
