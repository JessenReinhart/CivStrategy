import { describe, expect, it, vi } from 'vitest';
import {
  INITIAL_GAME_LOAD_PROGRESS,
  normalizeGameLoadProgress,
  runBudgetedWork,
} from './gameLoading';

describe('game loading progress', () => {
  it('maps legacy Phaser asset progress into the first loading phase', () => {
    expect(normalizeGameLoadProgress(0.42)).toMatchObject({
      progress: 0.0672,
      phase: 'Loading assets',
    });
    expect(normalizeGameLoadProgress(2).progress).toBe(0.16);
    expect(normalizeGameLoadProgress(-1).progress).toBe(0);
  });

  it('preserves structured realtime work information', () => {
    expect(normalizeGameLoadProgress({
      progress: 0.67,
      phase: 'Shaping coastlines',
      detail: 'Tracing water surface',
      processed: 180,
      total: 256,
    })).toEqual({
      progress: 0.67,
      phase: 'Shaping coastlines',
      detail: 'Tracing water surface',
      processed: 180,
      total: 256,
    });
  });

  it('falls back to the initial state for invalid payloads', () => {
    expect(normalizeGameLoadProgress(null)).toEqual(INITIAL_GAME_LOAD_PROGRESS);
  });
});

describe('runBudgetedWork', () => {
  it('yields between long work slices and reports the final item', async () => {
    function* work() {
      yield { processed: 1, total: 3, detail: 'one' };
      yield { processed: 2, total: 3, detail: 'two' };
      yield { processed: 3, total: 3, detail: 'three' };
    }

    const yieldControl = vi.fn(async () => undefined);
    const onProgress = vi.fn();
    let tick = 0;
    const now = () => {
      tick += 10;
      return tick;
    };

    await runBudgetedWork(work(), onProgress, yieldControl, 8, now);

    expect(yieldControl).toHaveBeenCalled();
    expect(onProgress).toHaveBeenLastCalledWith({
      processed: 3,
      total: 3,
      detail: 'three',
    });
  });
});
