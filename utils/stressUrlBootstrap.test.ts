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

  it('parses city stress with explicit high density', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('?stress=city&density=high', onStart, true);
    vi.runAllTimers();

    expect(onStart).toHaveBeenCalledWith({ city: true, density: 'high' });
  });

  it('defaults city stress density to high when omitted', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('?stress=city', onStart, true);
    vi.runAllTimers();

    expect(onStart).toHaveBeenCalledWith({ city: true, density: 'high' });
  });

  it('honors medium and low city densities', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('?stress=city&density=medium', onStart, true);
    vi.runAllTimers();
    expect(onStart).toHaveBeenCalledWith({ city: true, density: 'medium' });

    onStart.mockClear();
    scheduleStressUrlBootstrap('?stress=city&density=low', onStart, true);
    vi.runAllTimers();
    expect(onStart).toHaveBeenCalledWith({ city: true, density: 'low' });
  });

  it('treats an unknown city density as high', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('?stress=city&density=ultra', onStart, true);
    vi.runAllTimers();

    expect(onStart).toHaveBeenCalledWith({ city: true, density: 'high' });
  });

  it('keeps the enemies alias for numeric stress unchanged', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('?stress=2500&enemies=true&density=high', onStart, true);
    vi.runAllTimers();

    expect(onStart).toHaveBeenCalledWith({ unitCount: 2500, enableEnemies: true });
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
  it('does not schedule stress mode when no stress parameter is present', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('', onStart, true);
    vi.runAllTimers();

    expect(onStart).not.toHaveBeenCalled();
  });

  it('does not schedule stress mode for a non-numeric stress value', () => {
    vi.useFakeTimers();
    const onStart = vi.fn();

    scheduleStressUrlBootstrap('?stress=abc', onStart, true);
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
