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

describe('ClashSystem listener ownership and alerts', () => {
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

  it('records and filters active clash alerts', () => {
    ClashSystem.clearClashAlerts();
    ClashSystem.recordClashAlert(100, 200, 1000);
    ClashSystem.recordClashAlert(150, 250, 2500);

    // At t=3500, alert from 1000 is 2500ms old (<=3000ms), alert from 2500 is 1000ms old
    const alertsNow = ClashSystem.getActiveClashAlerts(3500, 3000);
    expect(alertsNow).toHaveLength(2);

    // At t=4500, first alert is 3500ms old (>3000ms), so only second alert remains
    const alertsLater = ClashSystem.getActiveClashAlerts(4500, 3000);
    expect(alertsLater).toHaveLength(1);
    expect(alertsLater[0]).toEqual({ x: 150, y: 250, timestamp: 2500 });
  });
});
