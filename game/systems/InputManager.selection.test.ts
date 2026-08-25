import Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../../constants';
import { UnitType } from '../../types';
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
        } as unknown as Phaser.GameObjects.GameObject;

        const unitVisual = {
            getData: vi.fn((key: string) => key === 'unit' ? unit : undefined),
        } as unknown as Phaser.GameObjects.GameObject;

        const hitTestPointer = vi.fn()
            .mockReturnValueOnce([unitVisual])
            .mockReturnValueOnce([]);

        const scene = {
            input: { hitTestPointer },
            game: { events: { emit } },
            proceduralSound: { playUIClick, playCommandAck },
            unitSystem: { commandMove, commandAttack },
        };

        const manager = Object.create(InputManager.prototype) as InputManager;
        Object.defineProperty(manager, 'scene', { value: scene });
        manager.selectedUnits = [];
        manager.selectedBuilding = null;

        const select = (manager as unknown as {
            handleSingleSelection(pointer: Phaser.Input.Pointer): void;
        }).handleSingleSelection.bind(manager);
        const rightClick = (manager as unknown as {
            handleRightClick(pointer: Phaser.Input.Pointer): void;
        }).handleRightClick.bind(manager);

        const pointer = {
            worldX: 640,
            worldY: 360,
            event: { shiftKey: false },
        } as unknown as Phaser.Input.Pointer;

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
});
