import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleStressUrlBootstrap } from './stressUrlBootstrap';

describe('scheduleStressUrlBootstrap', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defers URL stress startup and honors the documented enableEnemies flag', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('?stress=5000&enableEnemies=true', onStart);

    expect(onStart).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(onStart).toHaveBeenCalledWith({ unitCount: 5000, enableEnemies: true });
  });

  it('keeps enemies=true as a backwards-compatible alias', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('?stress=2500&enemies=true', onStart);
    vi.runAllTimers();

    expect(onStart).toHaveBeenCalledWith({ unitCount: 2500, enableEnemies: true });
  });

  it('keeps stress mode peaceful when enemy flags are missing or false', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('?stress=750&enableEnemies=false&enemies=false', onStart);
    vi.runAllTimers();

    expect(onStart).toHaveBeenCalledWith({ unitCount: 750, enableEnemies: false });
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

    scheduleStressUrlBootstrap('?stress=0&enableEnemies=true', onStart);
    vi.runAllTimers();

    expect(onStart).not.toHaveBeenCalled();
  });
});