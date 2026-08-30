import { describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../../constants';
import { UnitType } from '../../types';

vi.mock('phaser', () => ({
    default: {
        Math: {
            Vector2: class Vector2 {
                constructor(public x: number, public y: number) {}
            },
            Distance: {
                Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
            },
        },
    },
}));

vi.mock('../MainScene', () => ({ MainScene: class MainScene {} }));

import { InputManager } from './InputManager';

describe('InputManager player command selection', () => {
    it('lets a single-clicked player unit immediately receive a move command', () => {
        const emit = vi.fn();
        const commandMove = vi.fn();
        const commandAttack = vi.fn();
        const playUIClick = vi.fn();
        const playCommandAck = vi.fn();
        const setSelected = vi.fn();

        const unit = {
            unitType: UnitType.PIKESMAN,
            setSelected,
            getData: vi.fn((key: string) => key === 'owner' ? 0 : undefined),
        };

        const unitVisual = {
            getData: vi.fn((key: string) => key === 'unit' ? unit : undefined),
        };

        const hitTestPointer = vi.fn()
            .mockReturnValueOnce([unitVisual])
            .mockReturnValueOnce([]);

        const scene = {
            input: { hitTestPointer },
            game: { events: { emit } },
            proceduralSound: { playUIClick, playCommandAck },
            unitSystem: { commandMove, commandAttack },
            units: { getChildren: vi.fn(() => []) },
            cameras: { main: { zoom: 1, getWorldPoint: vi.fn((x: number, y: number) => ({ x, y })) } },
        };

        const manager = Object.create(InputManager.prototype) as InputManager;
        Object.defineProperty(manager, 'scene', { value: scene });
        manager.selectedUnits = [];
        manager.selectedBuilding = null;

        const select = (manager as unknown as {
            handleSingleSelection(pointer: unknown): void;
        }).handleSingleSelection.bind(manager);
        const rightClick = (manager as unknown as {
            handleRightClick(pointer: unknown): void;
        }).handleRightClick.bind(manager);

        const pointer = {
            worldX: 640,
            worldY: 360,
            event: { shiftKey: false },
        };

        select(pointer);

        expect(manager.selectedUnits).toEqual([unit]);
        expect(setSelected).toHaveBeenCalledWith(true);
        expect(playUIClick).toHaveBeenCalledOnce();
        expect(emit).toHaveBeenLastCalledWith(EVENTS.SELECTION_CHANGED, {
            count: 1,
            counts: { [UnitType.PIKESMAN]: 1 },
        });

        rightClick(pointer);

        expect(commandMove).toHaveBeenCalledOnce();
        expect(commandMove.mock.calls[0][0]).toEqual([unit]);
        expect(commandAttack).not.toHaveBeenCalled();
        expect(playCommandAck).toHaveBeenCalledOnce();
    });

    it('prioritizes an enemy under an overlapping friendly unit for a right-click attack', () => {
        const commandMove = vi.fn();
        const commandAttack = vi.fn();
        const playCommandAck = vi.fn();
        const selectedUnit = {
            unitType: UnitType.PIKESMAN,
            getData: vi.fn((key: string) => key === 'owner' ? 0 : undefined),
        };
        const friendlyUnit = {
            unitType: UnitType.PIKESMAN,
            getData: vi.fn((key: string) => key === 'owner' ? 0 : undefined),
        };
        const enemyUnit = {
            unitType: UnitType.PIKESMAN,
            getData: vi.fn((key: string) => key === 'owner' ? 1 : undefined),
        };
        const friendlyVisual = {
            getData: vi.fn((key: string) => key === 'unit' ? friendlyUnit : undefined),
        };
        const enemyVisual = {
            getData: vi.fn((key: string) => key === 'unit' ? enemyUnit : undefined),
        };
        const scene = {
            input: { hitTestPointer: vi.fn(() => [friendlyVisual, enemyVisual]) },
            proceduralSound: { playCommandAck },
            unitSystem: { commandMove, commandAttack },
            units: { getChildren: vi.fn(() => []) },
        };
        const manager = Object.create(InputManager.prototype) as InputManager;
        Object.defineProperty(manager, 'scene', { value: scene });
        manager.selectedUnits = [selectedUnit] as never[];
        manager.selectedBuilding = null;

        const rightClick = (manager as unknown as {
            handleRightClick(pointer: unknown): void;
        }).handleRightClick.bind(manager);

        rightClick({ worldX: 640, worldY: 360, event: { shiftKey: false } });

        expect(commandAttack).toHaveBeenCalledWith([selectedUnit], enemyUnit);
        expect(commandMove).not.toHaveBeenCalled();
        expect(playCommandAck).toHaveBeenCalledOnce();
    });

    it('uses main-camera coordinates to target a visible enemy when Phaser world coordinates are stale', () => {
        const commandMove = vi.fn();
        const commandAttack = vi.fn();
        const playCommandAck = vi.fn();
        const selectedUnit = {
            unitType: UnitType.PIKESMAN,
            getData: vi.fn((key: string) => key === 'owner' ? 0 : undefined),
        };
        const enemyVisual = {
            x: 640,
            y: 370,
            active: true,
            visible: true,
        };
        const enemyUnit = {
            unitType: UnitType.PIKESMAN,
            active: true,
            visual: enemyVisual,
            getData: vi.fn((key: string) => key === 'owner' ? 1 : undefined),
        };
        const getWorldPoint = vi.fn(() => ({ x: 640, y: 360 }));
        const scene = {
            input: { hitTestPointer: vi.fn(() => []) },
            proceduralSound: { playCommandAck },
            unitSystem: { commandMove, commandAttack },
            units: { getChildren: vi.fn(() => [enemyUnit]) },
            cameras: { main: { zoom: 1.5, getWorldPoint } },
        };
        const manager = Object.create(InputManager.prototype) as InputManager;
        Object.defineProperty(manager, 'scene', { value: scene });
        manager.selectedUnits = [selectedUnit] as never[];
        manager.selectedBuilding = null;

        const rightClick = (manager as unknown as {
            handleRightClick(pointer: unknown): void;
        }).handleRightClick.bind(manager);

        rightClick({ x: 864, y: 608, worldX: 272, worldY: 566, event: { shiftKey: false } });

        expect(getWorldPoint).toHaveBeenCalledWith(864, 608);
        expect(commandAttack).toHaveBeenCalledWith([selectedUnit], enemyUnit);
        expect(commandMove).not.toHaveBeenCalled();
        expect(playCommandAck).toHaveBeenCalledWith(640, 360);
    });
});
