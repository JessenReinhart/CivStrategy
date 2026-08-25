import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleStressUrlBootstrap, stripStressUrlParams } from './stressUrlBootstrap';

describe('scheduleStressUrlBootstrap', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defers URL stress startup and honors the documented enableEnemies flag', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('?stress=5000&enableEnemies=true', onStart, true);

    expect(onStart).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(onStart).toHaveBeenCalledWith({ unitCount: 5000, enableEnemies: true });
  });

  it('keeps enemies=true as a backwards-compatible alias', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('?stress=2500&enemies=true', onStart, true);
    vi.runAllTimers();

    expect(onStart).toHaveBeenCalledWith({ unitCount: 2500, enableEnemies: true });
  });

  it('keeps stress mode peaceful when enemy flags are missing or false', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('?stress=750&enableEnemies=false&enemies=false', onStart, true);
    vi.runAllTimers();

    expect(onStart).toHaveBeenCalledWith({ unitCount: 750, enableEnemies: false });
  });

  it('cancels a pending URL stress startup during cleanup', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    const cleanup = scheduleStressUrlBootstrap('?stress=1000', onStart, true);
    cleanup();
    vi.runAllTimers();

    expect(onStart).not.toHaveBeenCalled();
  });

  it('does not schedule stress mode without a positive stress count', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('?stress=0&enableEnemies=true', onStart, true);
    vi.runAllTimers();

    expect(onStart).not.toHaveBeenCalled();
  });

  it('does not start URL stress mode when the bootstrap is disabled', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('?stress=5000&enableEnemies=true', onStart, false);
    vi.runAllTimers();

    expect(onStart).not.toHaveBeenCalled();
  });
});

describe('stripStressUrlParams', () => {
  it('removes stress-only parameters while preserving unrelated query state', () => {
    expect(
      stripStressUrlParams('?map=island&stress=5000&enableEnemies=true&seed=42&enemies=true'),
    ).toBe('?map=island&seed=42');
  });

  it('returns an empty search string when only stress parameters were present', () => {
    expect(stripStressUrlParams('?stress=1000&enableEnemies=false')).toBe('');
  });
});
