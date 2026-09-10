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
        Scenes: { Events: { SHUTDOWN: 'shutdown' } },
    },
}));

vi.mock('../MainScene', () => ({ MainScene: class MainScene {} }));

import { InputManager } from './InputManager';
import { installVillagerWorkforceInput } from './VillagerWorkforceInput';

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

    it('only lets a player-owned Barracks receive a waypoint command', () => {
        const playerSetWaypoint = vi.fn();
        const hostileSetWaypoint = vi.fn();
        const playerBarracks = {
            getData: vi.fn((key: string) => {
                if (key === 'owner') return 0;
                if (key === 'def') return { type: 'Barracks' };
                return undefined;
            }),
            setWaypoint: playerSetWaypoint,
        };
        const hostileBarracks = {
            getData: vi.fn((key: string) => {
                if (key === 'owner') return 1;
                if (key === 'def') return { type: 'Barracks' };
                return undefined;
            }),
            setWaypoint: hostileSetWaypoint,
        };
        const scene = {
            cameras: { main: { getWorldPoint: vi.fn((x: number, y: number) => ({ x, y })) } },
        };
        const manager = Object.create(InputManager.prototype) as InputManager;
        Object.defineProperty(manager, 'scene', { value: scene });
        manager.selectedUnits = [];

        const rightClick = (manager as unknown as { handleRightClick(pointer: unknown): void }).handleRightClick.bind(manager);
        const pointer = { worldX: 640, worldY: 360, event: { shiftKey: false } };

        manager.selectedBuilding = playerBarracks as never;
        rightClick(pointer);
        expect(playerSetWaypoint).toHaveBeenCalledOnce();

        manager.selectedBuilding = hostileBarracks as never;
        rightClick(pointer);
        expect(hostileSetWaypoint).not.toHaveBeenCalled();
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

    it('lets the idle-villager hotkey select a workforce worker that can immediately receive a job command', () => {
        const keyboardHandlers = new Map<string, () => void>();
        const pointerHandlers = new Map<string, Array<(pointer: unknown) => void>>();
        const eventEmit = vi.fn();
        const clearSelection = vi.fn();
        const deselectBuilding = vi.fn();
        const assignJob = vi.fn();
        const updateStats = vi.fn();
        const playUIClick = vi.fn();
        const playCommandAck = vi.fn();
        const selectionData = new Map<string, unknown>();
        const ring = { destroy: vi.fn(), setStrokeStyle: vi.fn() };
        ring.setStrokeStyle.mockReturnValue(ring);
        const visual = {
            active: true,
            visible: true,
            x: 120,
            y: 160,
            getData: vi.fn((key: string) => selectionData.get(key)),
            setData: vi.fn((key: string, value: unknown) => selectionData.set(key, value)),
            addAt: vi.fn(),
        };
        const villager = {
            id: 7,
            x: 120,
            y: 160,
            carryAmount: 0,
            carryType: null,
            visual,
        };
        const workerBuilding = {
            active: true,
            x: 180,
            y: 180,
            visual: { active: true, visible: true, x: 180, y: 180 },
            getData: vi.fn((key: string) => {
                if (key === 'owner') return 0;
                if (key === 'def') return { workerNeeds: 1 };
                if (key === 'assignedWorker') return undefined;
                return undefined;
            }),
        };
        const buildingVisual = {
            getData: vi.fn((key: string) => key === 'building' ? workerBuilding : undefined),
        };
        const keyboard = {
            on: vi.fn((event: string, handler: () => void) => keyboardHandlers.set(event, handler)),
            off: vi.fn(),
        };
        const scene = {
            cameras: { main: { getWorldPoint: vi.fn((x: number, y: number) => ({ x, y })) } },
            add: { ellipse: vi.fn(() => ring) },
            inputManager: { clearSelection, deselectBuilding },
            input: {
                keyboard,
                hitTestPointer: vi.fn(() => [buildingVisual]),
                on: vi.fn((event: string, handler: (pointer: unknown) => void) => {
                    const handlers = pointerHandlers.get(event) ?? [];
                    handlers.push(handler);
                    pointerHandlers.set(event, handlers);
                }),
                off: vi.fn(),
            },
            villagerSystem: {
                getIdleVillagers: vi.fn(() => [villager]),
                getAllVillagers: vi.fn(() => [villager]),
                getVillagersByOwner: vi.fn(() => [villager]),
                assignJob,
                sendToRallyPoint: vi.fn(),
            },
            buildings: { getChildren: vi.fn(() => [workerBuilding]) },
            buildingManager: { isDemolishMode: false, previewBuildingType: null },
            proceduralSound: { playUIClick, playCommandAck },
            economySystem: { updateStats },
            feedbackSystem: { showFloatingText: vi.fn() },
            game: { events: { emit: eventEmit, on: vi.fn(), off: vi.fn() } },
            events: { once: vi.fn() },
        };
        const originalWindow = globalThis.window;
        vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });

        try {
            installVillagerWorkforceInput(scene as never);
            keyboardHandlers.get('keydown-TWO')?.();

            expect(clearSelection).toHaveBeenCalledOnce();
            expect(deselectBuilding).toHaveBeenCalledOnce();
            expect(selectionData.get('workforceSelectionRing')).toBe(ring);
            expect(playUIClick).toHaveBeenCalledOnce();
            expect(eventEmit).toHaveBeenLastCalledWith(EVENTS.SELECTION_CHANGED, {
                count: 1,
                counts: { [UnitType.VILLAGER]: 1 },
            });

            const rightClickPointer = {
                button: 2,
                x: 180,
                y: 180,
                rightButtonDown: () => true,
            };
            for (const handler of pointerHandlers.get('pointerdown') ?? []) handler(rightClickPointer);

            expect(assignJob).toHaveBeenCalledWith(villager, workerBuilding);
            expect(updateStats).toHaveBeenCalledOnce();
            expect(playCommandAck).toHaveBeenCalledOnce();
        } finally {
            vi.stubGlobal('window', originalWindow);
        }
    });
});