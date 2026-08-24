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
  setPendingLoad,
} from './SaveSystem';

const storage = new Map<string, string>();

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
    storage.set(SAVE_KEY, '{}');
    expect(hasSave()).toBe(true);

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

  it('does not throw when storage access is blocked', () => {
    const blocked = new DOMException('blocked', 'SecurityError');
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
