import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
    default: {
        Math: {
            Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
            Angle: {
                RotateTo: (current: number, _target: number, _step: number) => current,
                Between: (_x1: number, _y1: number, _x2: number, _y2: number) => 0,
            },
            Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
        },
    },
}));

vi.mock('../MainScene', () => ({ MainScene: class {} }));
vi.mock('./FormationSystem', () => ({ FormationSystem: class {} }));

import { TERRAIN_CONFIG } from '../../constants';
import { UnitState, UnitType, type GameUnit } from '../../types';
import type { MainScene } from '../MainScene';
import { UnitSystem } from './UnitSystem';

describe('UnitSystem selection-ring readability', () => {
    it('tints ring red and exposes HP bar when unit enters attack-move contact', () => {
        const hpBar = { setVisible: vi.fn() };
        const ring = { setFillStyle: vi.fn().mockReturnThis() };
        const scene = {
            add: { graphics: vi.fn(() => ({ clear: vi.fn(), setDepth: vi.fn().mockReturnThis() })) },
            units: { getChildren: () => [] },
            terrainSystem: { getHeightAt: () => TERRAIN_CONFIG.WATER_LEVEL + 0.1 },
        } as unknown as MainScene;
        const unit = {
            x: 100,
            y: 60,
            unitType: UnitType.PIKESMAN,
            path: null as null,
            pathStep: 0,
            pathCreatedAt: 0,
            isSelected: false,
            state: UnitState.IDLE,
            getData: (key: string) => {
                if (key === 'owner') return 0;
                if (key === 'hp') return 100;
                if (key === 'maxHp') return 100;
                return undefined;
            },
            visual: { getData: (key: string) => key === 'hpBar' ? hpBar : key === 'selectionRing' ? ring : undefined },
            body: null,
        };
        const system = new UnitSystem(scene);

        const updateColor = system as unknown as { updateSelectionRingColor(unit: GameUnit): void };
        updateColor.updateSelectionRingColor(unit as unknown as GameUnit);
        expect(hpBar.setVisible.mock.calls[0][0]).toBe(false);
        expect(ring.setFillStyle.mock.calls[0]).toEqual([0x4ADE80, 0.5]);

        unit.state = UnitState.ATTACK_MOVE;
        updateColor.updateSelectionRingColor(unit as unknown as GameUnit);

        expect(hpBar.setVisible.mock.calls[1][0]).toBe(true);
        expect(ring.setFillStyle.mock.calls[1]).toEqual([0xEF4444, 0.8]);
    });
});
