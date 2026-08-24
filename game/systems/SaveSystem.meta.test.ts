import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { getSaveMeta, SAVE_KEY } from './SaveSystem';

const storage = new Map<string, string>();

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
    storage.set(SAVE_KEY, JSON.stringify({
      version: 999,
      timestamp: 123,
      faction: 'Romans',
      mapSeed: 42,
      mapPreset: 'standard',
      currentAge: 'Village',
    }));

    expect(getSaveMeta()).toBeNull();
  });

  it('returns metadata for the current save version', () => {
    storage.set(SAVE_KEY, JSON.stringify({
      version: 1,
      timestamp: 123,
      faction: 'Romans',
      mapSeed: 42,
      mapPreset: 'standard',
      currentAge: 'Village',
    }));

    expect(getSaveMeta()).toEqual({
      timestamp: 123,
      faction: 'Romans',
      mapSeed: 42,
      mapPreset: 'standard',
      currentAge: 'Village',
    });
  });

  it('returns null for malformed save JSON', () => {
    storage.set(SAVE_KEY, '{not-json');
    expect(getSaveMeta()).toBeNull();
  });
});
