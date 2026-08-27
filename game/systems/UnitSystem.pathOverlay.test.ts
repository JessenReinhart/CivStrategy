import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
    default: {
        Math: {
            Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
        },
    },
}));

vi.mock('../MainScene', () => ({ MainScene: class {} }));
vi.mock('./FormationSystem', () => ({ FormationSystem: class {} }));

import { TERRAIN_CONFIG } from '../../constants';
import { UnitType } from '../../types';
import type { MainScene } from '../MainScene';
import { toIsoElev } from '../utils/iso';
import { UnitSystem } from './UnitSystem';

function makeGraphics() {
    return {
        clear: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        lineStyle: vi.fn(),
        strokePath: vi.fn(),
        setDepth: vi.fn().mockReturnThis(),
    };
}

// Regression for #28: both endpoints must use the same elevation-aware projection as unit visuals.
describe('UnitSystem movement path overlay', () => {
    it('uses terrain elevation for both the origin and every rendered path node', () => {
        const pathGraphics = makeGraphics();
        const unit = {
            x: 120,
            y: 80,
            unitType: UnitType.PIKESMAN,
            path: [{ x: 140, y: 100 }],
            pathStep: 0,
            pathCreatedAt: 900,
            getData: vi.fn((key: string) => key === 'owner' ? 0 : undefined),
        };
        const unitHeight = TERRAIN_CONFIG.WATER_LEVEL + 0.25;
        const nodeHeight = TERRAIN_CONFIG.WATER_LEVEL + 0.4;
        const getHeightAt = vi.fn((x: number, y: number) => (
            x === unit.x && y === unit.y ? unitHeight : nodeHeight
        ));
        const scene = {
            add: { graphics: vi.fn(() => pathGraphics) },
            units: { getChildren: () => [unit] },
            terrainSystem: { getHeightAt },
        } as unknown as MainScene;
        const system = new UnitSystem(scene);

        (system as unknown as { drawUnitPaths(time: number): void }).drawUnitPaths(1000);

        const expectedStart = toIsoElev(unit.x, unit.y, unitHeight);
        const expectedNode = toIsoElev(unit.path[0].x, unit.path[0].y, nodeHeight);
        expect(pathGraphics.moveTo).toHaveBeenCalledWith(expectedStart.x, expectedStart.y);
        expect(pathGraphics.lineTo).toHaveBeenCalledWith(expectedNode.x, expectedNode.y);
        expect(getHeightAt).toHaveBeenCalledWith(unit.x, unit.y);
        expect(getHeightAt).toHaveBeenCalledWith(unit.path[0].x, unit.path[0].y);
    });

    it('does not render enemy movement paths', () => {
        const pathGraphics = makeGraphics();
        const enemyUnit = {
            x: 120,
            y: 80,
            unitType: UnitType.PIKESMAN,
            path: [{ x: 140, y: 100 }],
            pathStep: 0,
            pathCreatedAt: 900,
            getData: vi.fn((key: string) => key === 'owner' ? 1 : undefined),
        };
        const getHeightAt = vi.fn(() => TERRAIN_CONFIG.WATER_LEVEL + 0.25);
        const scene = {
            add: { graphics: vi.fn(() => pathGraphics) },
            units: { getChildren: () => [enemyUnit] },
            terrainSystem: { getHeightAt },
        } as unknown as MainScene;
        const system = new UnitSystem(scene);

        (system as unknown as { drawUnitPaths(time: number): void }).drawUnitPaths(1000);

        expect(pathGraphics.beginPath).not.toHaveBeenCalled();
        expect(pathGraphics.moveTo).not.toHaveBeenCalled();
        expect(pathGraphics.lineTo).not.toHaveBeenCalled();
        expect(pathGraphics.strokePath).not.toHaveBeenCalled();
        expect(getHeightAt).not.toHaveBeenCalled();
    });
});
