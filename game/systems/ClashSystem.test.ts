import { describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../../constants';
import { triggerMeatGrinder } from '../utils/MeatGrinderEffect';
import { ClashSystem } from './ClashSystem';

vi.mock('../utils/MeatGrinderEffect', () => ({
  triggerMeatGrinder: vi.fn(),
}));

class TestEvents {
  private listeners = new Map<string, Set<(payload: unknown) => void>>();

  on(event: string, handler: (payload: unknown) => void): void {
    let handlers = this.listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(event, handlers);
    }
    handlers.add(handler);
  }

  off(event: string, handler?: (payload: unknown) => void): void {
    if (!handler) {
      this.listeners.delete(event);
      return;
    }
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: string, payload: unknown): void {
    for (const handler of this.listeners.get(event) ?? []) handler(payload);
  }
}

describe('ClashSystem listener ownership', () => {
  it('removes only its own CLASH_START listener during teardown', () => {
    const events = new TestEvents();
    const unrelatedListener = vi.fn();
    events.on(EVENTS.CLASH_START, unrelatedListener);

    const clashSystem = new ClashSystem({ events } as never);
    const beforeTeardown = { x: 12, y: 34 };
    events.emit(EVENTS.CLASH_START, beforeTeardown);

    expect(triggerMeatGrinder).toHaveBeenCalledOnce();
    expect(unrelatedListener).toHaveBeenCalledWith(beforeTeardown);

    clashSystem.destroy();

    const afterTeardown = { x: 56, y: 78 };
    events.emit(EVENTS.CLASH_START, afterTeardown);

    expect(triggerMeatGrinder).toHaveBeenCalledOnce();
    expect(unrelatedListener).toHaveBeenCalledTimes(2);
    expect(unrelatedListener).toHaveBeenLastCalledWith(afterTeardown);
  });
});
