import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../MainScene', () => ({ MainScene: class {} }));

import {
  clearPendingLoad,
  clearSave,
  hasSave,
  isPendingLoad,
  PENDING_LOAD_KEY,
  SAVE_KEY,
  saveToLocalStorage,
  setPendingLoad,
} from './SaveSystem';

const storage = new Map<string, string>();
const save = { version: 1 } as unknown as Parameters<typeof saveToLocalStorage>[0];

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
    expect(JSON.parse(storage.get(SAVE_KEY) ?? '{}')).toEqual({ version: 1 });

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
