import { describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../../constants';
import { UnitType } from '../../types';

vi.mock('phaser', () => ({
    default: {
        Math: {
            Vector2: class Vector2 {
                constructor(public x = 0, public y = 0) {}
                set(x: number, y: number) { this.x = x; this.y = y; return this; }
            },
        },
        Scenes: { Events: { SHUTDOWN: 'shutdown' } },
    },
}));

vi.mock('../MainScene', () => ({ MainScene: class MainScene {} }));

import { InputManager } from './InputManager';

describe('InputManager selected-unit lifecycle', () => {
    it('drops defeated units on the next update without churning survivor selection events', () => {
        const emit = vi.fn();
        const defeated = { active: false, unitType: UnitType.PIKESMAN };
        const survivor = { active: true, unitType: UnitType.ARCHER };
        const idleKey = { isDown: false };
        const scene = {
            game: { events: { emit } },
            cameras: { main: { zoom: 1, scrollX: 0, scrollY: 0 } },
            cursors: { left: idleKey, right: idleKey, up: idleKey, down: idleKey },
            wasd: { A: idleKey, D: idleKey, W: idleKey, S: idleKey },
        };
        const manager = Object.create(InputManager.prototype) as InputManager;
        Object.defineProperty(manager, 'scene', { value: scene });
        manager.selectedUnits = [defeated, survivor] as never[];
        manager.selectedBuilding = null;

        manager.update(16);

        expect(manager.selectedUnits).toEqual([survivor]);
        expect(emit).toHaveBeenCalledOnce();
        expect(emit).toHaveBeenCalledWith(EVENTS.SELECTION_CHANGED, {
            count: 1,
            counts: { [UnitType.ARCHER]: 1 },
        });

        manager.update(16);
        expect(manager.selectedUnits).toEqual([survivor]);
        expect(emit).toHaveBeenCalledOnce();
    });
});
