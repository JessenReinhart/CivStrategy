import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleStressUrlBootstrap } from './stressUrlBootstrap';

describe('scheduleStressUrlBootstrap', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defers URL stress startup without blocking the current setup tick', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('?stress=5000&enemies=true', onStart);

    expect(onStart).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(onStart).toHaveBeenCalledWith({ unitCount: 5000, enableEnemies: true });
  });

  it('cancels a pending URL stress startup during cleanup', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    const cleanup = scheduleStressUrlBootstrap('?stress=1000', onStart);
    cleanup();
    vi.runAllTimers();

    expect(onStart).not.toHaveBeenCalled();
  });

  it('does not schedule stress mode without a positive stress count', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('?stress=0&enemies=true', onStart);
    vi.runAllTimers();

    expect(onStart).not.toHaveBeenCalled();
  });
});
