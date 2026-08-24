import { describe, expect, it, vi } from 'vitest';
import { attachPhaserReadyHandler } from './phaserReadyLifecycle';

describe('attachPhaserReadyHandler', () => {
  it('runs the ready callback while active', () => {
    let registeredHandler: (() => void) | undefined;
    const emitter = {
      once: vi.fn((_event: 'ready', listener: () => void) => {
        registeredHandler = listener;
      }),
      off: vi.fn(),
    };
    const onReady = vi.fn();

    attachPhaserReadyHandler(emitter, onReady);
    registeredHandler?.();

    expect(onReady).toHaveBeenCalledOnce();
  });

  it('removes and invalidates a stale ready callback during cleanup', () => {
    let registeredHandler: (() => void) | undefined;
    const emitter = {
      once: vi.fn((_event: 'ready', listener: () => void) => {
        registeredHandler = listener;
      }),
      off: vi.fn(),
    };
    const onReady = vi.fn();

    const cleanup = attachPhaserReadyHandler(emitter, onReady);
    cleanup();
    registeredHandler?.();

    expect(emitter.off).toHaveBeenCalledWith('ready', registeredHandler);
    expect(onReady).not.toHaveBeenCalled();
  });
});
