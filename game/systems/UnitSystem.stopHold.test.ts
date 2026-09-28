import { describe, expect, it, vi } from 'vitest';
import { UnitState, UnitType } from '../../types';

vi.mock('phaser', () => ({
    default: {
        Math: {
            Vector2: class Vector2 {
                constructor(public x = 0, public y = 0) {}
                set(x: number, y: number) { this.x = x; this.y = y; return this; }
            },
            Distance: {
                Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
            },
        },
        Curves: {
            QuadraticBezier: class QuadraticBezier {
                constructor() {}
            },
        },
        GameObjects: {
            Rectangle: class Rectangle {},
            GameObject: class GameObject {},
        },
        Geom: {
            Rectangle: class Rectangle {
                contains() { return true; }
            },
        },
    },
}));

vi.mock('../MainScene', () => ({ MainScene: class MainScene {} }));
vi.mock('../utils/iso', () => ({
    toIso: (x: number, y: number) => ({ x, y }),
    toIsoElev: (x: number, y: number) => ({ x, y }),
    toCartesian: (x: number, y: number) => ({ x, y }),
}));

import { UnitSystem } from './UnitSystem';

describe('UnitSystem commandStop and commandHoldPosition', () => {
    it('commandStop clears path, target, resets velocity, and sets state to IDLE', () => {
        const resetBody = vi.fn();
        const setVelocity = vi.fn();
        const dataStore = new Map<string, unknown>();
        const unit = {
            unitType: UnitType.PIKESMAN,
            x: 100,
            y: 200,
            state: UnitState.CHASING,
            path: [{ x: 120, y: 220 }],
            pathStep: 1,
            target: { scene: {} },
            body: { reset: resetBody, setVelocity },
            setData: (k: string, v: unknown) => dataStore.set(k, v),
            getData: (k: string) => dataStore.get(k),
        };

        const scene = {
            inputManager: { selectedUnits: [] },
            add: {
                graphics: vi.fn(() => ({ clear: vi.fn() })),
            },
        };

        const unitSys = Object.create(UnitSystem.prototype) as UnitSystem;
        Object.defineProperty(unitSys, 'scene', { value: scene });

        unitSys.commandStop([unit as never]);

        expect(unit.path).toBeNull();
        expect(unit.target).toBeNull();
        expect(unit.state).toBe(UnitState.IDLE);
        expect(dataStore.get('holdGround')).toBe(false);
        expect(setVelocity).toHaveBeenCalledWith(0, 0);
        expect(resetBody).toHaveBeenCalledWith(100, 200);
    });

    it('commandHoldPosition sets holdGround and stores anchor/holdPosition', () => {
        const resetBody = vi.fn();
        const setVelocity = vi.fn();
        const dataStore = new Map<string, unknown>();
        const unit = {
            unitType: UnitType.PIKESMAN,
            x: 150,
            y: 250,
            state: UnitState.CHASING,
            path: [{ x: 170, y: 270 }],
            pathStep: 1,
            target: { scene: {} },
            body: { reset: resetBody, setVelocity },
            setData: (k: string, v: unknown) => dataStore.set(k, v),
            getData: (k: string) => dataStore.get(k),
        };

        const scene = {
            inputManager: { selectedUnits: [] },
            add: {
                graphics: vi.fn(() => ({ clear: vi.fn() })),
            },
        };

        const unitSys = Object.create(UnitSystem.prototype) as UnitSystem;
        Object.defineProperty(unitSys, 'scene', { value: scene });

        unitSys.commandHoldPosition([unit as never]);

        expect(unit.path).toBeNull();
        expect(unit.target).toBeNull();
        expect(unit.state).toBe(UnitState.IDLE);
        expect(dataStore.get('holdGround')).toBe(true);
        expect(dataStore.get('holdPosition')).toEqual({ x: 150, y: 250 });
        expect(setVelocity).toHaveBeenCalledWith(0, 0);
        expect(resetBody).toHaveBeenCalledWith(150, 250);
    });
});
