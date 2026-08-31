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
        const unitVisual = { getData: vi.fn((key: string) => key === 'unit' ? unit : undefined) };
        const hitTestPointer = vi.fn().mockReturnValueOnce([unitVisual]).mockReturnValueOnce([]);
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

        const select = (manager as unknown as { handleSingleSelection(pointer: unknown): void }).handleSingleSelection.bind(manager);
        const rightClick = (manager as unknown as { handleRightClick(pointer: unknown): void }).handleRightClick.bind(manager);
        const pointer = { worldX: 640, worldY: 360, event: { shiftKey: false } };

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
        const selectedUnit = { unitType: UnitType.PIKESMAN, getData: vi.fn((key: string) => key === 'owner' ? 0 : undefined) };
        const friendlyUnit = { unitType: UnitType.PIKESMAN, getData: vi.fn((key: string) => key === 'owner' ? 0 : undefined) };
        const enemyUnit = { unitType: UnitType.PIKESMAN, getData: vi.fn((key: string) => key === 'owner' ? 1 : undefined) };
        const friendlyVisual = { getData: vi.fn((key: string) => key === 'unit' ? friendlyUnit : undefined) };
        const enemyVisual = { getData: vi.fn((key: string) => key === 'unit' ? enemyUnit : undefined) };
        const scene = {
            input: { hitTestPointer: vi.fn(() => [friendlyVisual, enemyVisual]) },
            proceduralSound: { playCommandAck },
            unitSystem: { commandMove, commandAttack },
            units: { getChildren: vi.fn(() => []) },
            cameras: { main: { zoom: 1, getWorldPoint: vi.fn((x: number, y: number) => ({ x, y })) } },
        };
        const manager = Object.create(InputManager.prototype) as InputManager;
        Object.defineProperty(manager, 'scene', { value: scene });
        manager.selectedUnits = [selectedUnit] as never[];
        manager.selectedBuilding = null;

        const rightClick = (manager as unknown as { handleRightClick(pointer: unknown): void }).handleRightClick.bind(manager);
        rightClick({ worldX: 640, worldY: 360, event: { shiftKey: false } });

        expect(commandAttack).toHaveBeenCalledWith([selectedUnit], enemyUnit);
        expect(commandMove).not.toHaveBeenCalled();
        expect(playCommandAck).toHaveBeenCalledOnce();
    });

    it('projects authoritative simulation coordinates when the enemy visual and Phaser world coordinates are stale', () => {
        const commandMove = vi.fn();
        const commandAttack = vi.fn();
        const playCommandAck = vi.fn();
        const selectedUnit = { unitType: UnitType.PIKESMAN, getData: vi.fn((key: string) => key === 'owner' ? 0 : undefined) };
        const enemyUnit = {
            unitType: UnitType.PIKESMAN,
            active: true,
            x: 500,
            y: 140,
            visual: { x: 999, y: 999, active: true, visible: true },
            getData: vi.fn((key: string) => key === 'owner' ? 1 : undefined),
        };
        const getWorldPoint = vi.fn(() => ({ x: 360, y: 310 }));
        const scene = {
            input: { hitTestPointer: vi.fn(() => []) },
            proceduralSound: { playCommandAck },
            unitSystem: { commandMove, commandAttack },
            units: { getChildren: vi.fn(() => [enemyUnit]) },
            cameras: { main: { zoom: 1.5, getWorldPoint } },
            terrainSystem: { getHeightAt: vi.fn(() => 0) },
        };
        const manager = Object.create(InputManager.prototype) as InputManager;
        Object.defineProperty(manager, 'scene', { value: scene });
        manager.selectedUnits = [selectedUnit] as never[];
        manager.selectedBuilding = null;

        const rightClick = (manager as unknown as { handleRightClick(pointer: unknown): void }).handleRightClick.bind(manager);
        rightClick({ x: 864, y: 608, worldX: 272, worldY: 566, event: { shiftKey: false } });

        expect(getWorldPoint).toHaveBeenCalledWith(864, 608);
        expect(scene.terrainSystem.getHeightAt).toHaveBeenCalledWith(500, 140);
        expect(commandAttack).toHaveBeenCalledWith([selectedUnit], enemyUnit);
        expect(commandMove).not.toHaveBeenCalled();
        expect(playCommandAck).toHaveBeenCalledWith(360, 310);
    });

    it('routes the selected-unit RMB lifecycle to an enemy whose rendered container is stale', () => {
        const commandMove = vi.fn();
        const commandAttack = vi.fn();
        const playCommandAck = vi.fn();
        const selectedUnit = { unitType: UnitType.PIKESMAN, getData: vi.fn((key: string) => key === 'owner' ? 0 : undefined) };
        const enemyUnit = {
            unitType: UnitType.PIKESMAN,
            active: true,
            x: 500,
            y: 140,
            visual: { x: 999, y: 999, active: true, visible: true },
            getData: vi.fn((key: string) => key === 'owner' ? 1 : undefined),
        };
        const getWorldPoint = vi.fn(() => ({ x: 360, y: 310 }));
        const scene = {
            minimapSystem: { isPointerOnMinimap: vi.fn(() => false) },
            buildingManager: { isDemolishMode: false, previewBuildingType: null },
            input: { hitTestPointer: vi.fn(() => []) },
            proceduralSound: { playCommandAck },
            unitSystem: { commandMove, commandAttack, commandFollowPath: vi.fn() },
            units: { getChildren: vi.fn(() => [enemyUnit]) },
            cameras: { main: { zoom: 1.5, getWorldPoint } },
            terrainSystem: { getHeightAt: vi.fn(() => 0) },
        };
        const manager = Object.create(InputManager.prototype) as InputManager;
        Object.defineProperty(manager, 'scene', { value: scene });
        manager.selectedUnits = [selectedUnit] as never[];
        manager.selectedBuilding = null;
        Object.assign(manager as unknown as Record<string, unknown>, {
            isRightDragging: false,
            rightDragMoved: false,
            rightDragScreenStart: { x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y; return this; } },
            rightDragPoints: [],
            rightDragGraphics: { clear: vi.fn() },
        });

        const pointer = {
            x: 864,
            y: 608,
            worldX: 272,
            worldY: 566,
            rightButtonDown: () => true,
            event: { shiftKey: false },
        };
        const pointerDown = (manager as unknown as { handlePointerDown(value: unknown): void }).handlePointerDown.bind(manager);
        const pointerUp = (manager as unknown as { handlePointerUp(value: unknown): void }).handlePointerUp.bind(manager);

        pointerDown(pointer);
        pointerUp(pointer);

        expect(getWorldPoint).toHaveBeenCalledWith(864, 608);
        expect(commandAttack).toHaveBeenCalledWith([selectedUnit], enemyUnit);
        expect(commandMove).not.toHaveBeenCalled();
        expect(playCommandAck).toHaveBeenCalledWith(360, 310);
    });

    it('does not turn a stationary right-click into a path drag when the camera moves underneath it', () => {
        const commandMove = vi.fn();
        const commandAttack = vi.fn();
        const commandFollowPath = vi.fn();
        const selectedUnit = { unitType: UnitType.PIKESMAN, getData: vi.fn((key: string) => key === 'owner' ? 0 : undefined) };
        const enemyUnit = {
            unitType: UnitType.PIKESMAN,
            active: true,
            x: 500,
            y: 140,
            getData: vi.fn((key: string) => key === 'owner' ? 1 : undefined),
        };
        const getWorldPoint = vi.fn()
            .mockReturnValueOnce({ x: 320, y: 280 })
            .mockReturnValueOnce({ x: 360, y: 310 })
            .mockReturnValue({ x: 360, y: 310 });
        const scene = {
            minimapSystem: { isPointerOnMinimap: vi.fn(() => false) },
            buildingManager: { isDemolishMode: false, previewBuildingType: null },
            input: { hitTestPointer: vi.fn(() => []) },
            proceduralSound: { playCommandAck: vi.fn() },
            unitSystem: { commandMove, commandAttack, commandFollowPath },
            units: { getChildren: vi.fn(() => [enemyUnit]) },
            cameras: { main: { zoom: 1.5, getWorldPoint } },
            terrainSystem: { getHeightAt: vi.fn(() => 0) },
        };
        const manager = Object.create(InputManager.prototype) as InputManager;
        Object.defineProperty(manager, 'scene', { value: scene });
        manager.selectedUnits = [selectedUnit] as never[];
        manager.selectedBuilding = null;
        Object.assign(manager as unknown as Record<string, unknown>, {
            isDragging: false,
            isRightDragging: false,
            rightDragMoved: false,
            rightDragScreenStart: { x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y; return this; } },
            rightDragPoints: [],
            rightDragGraphics: { clear: vi.fn(), lineStyle: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), strokePath: vi.fn() },
        });

        const pointer = {
            x: 864,
            y: 608,
            worldX: 272,
            worldY: 566,
            rightButtonDown: () => true,
            event: { shiftKey: false },
        };
        const pointerDown = (manager as unknown as { handlePointerDown(value: unknown): void }).handlePointerDown.bind(manager);
        const pointerMove = (manager as unknown as { handlePointerMove(value: unknown): void }).handlePointerMove.bind(manager);
        const pointerUp = (manager as unknown as { handlePointerUp(value: unknown): void }).handlePointerUp.bind(manager);

        pointerDown(pointer);
        pointerMove(pointer);
        pointerUp(pointer);

        expect(commandFollowPath).not.toHaveBeenCalled();
        expect(commandAttack).toHaveBeenCalledWith([selectedUnit], enemyUnit);
        expect(commandMove).not.toHaveBeenCalled();
    });
});
