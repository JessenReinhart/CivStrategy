import { describe, expect, it, vi } from 'vitest';

const between = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1);

vi.mock('phaser', () => ({
    default: {
        Math: { Distance: { Between: between } },
    },
}));

vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { BuildingType } from '../../types';
import type { MainScene } from '../MainScene';
import { toIsoElev } from '../utils/iso';
import { BuildingManager } from './BuildingManager';

function makeGraphics() {
    return {
        clear: vi.fn().mockReturnThis(),
        fillStyle: vi.fn().mockReturnThis(),
        lineStyle: vi.fn().mockReturnThis(),
        fillEllipse: vi.fn().mockReturnThis(),
        strokeEllipse: vi.fn().mockReturnThis(),
        beginPath: vi.fn().mockReturnThis(),
        moveTo: vi.fn().mockReturnThis(),
        lineTo: vi.fn().mockReturnThis(),
        closePath: vi.fn().mockReturnThis(),
        fillPath: vi.fn().mockReturnThis(),
        setDepth: vi.fn().mockReturnThis(),
        setPosition: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
    };
}

function makeScene(overrides: Record<string, unknown> = {}) {
    const createdGraphics: ReturnType<typeof makeGraphics>[] = [];
    const scene = {
        add: {
            graphics: vi.fn(() => {
                const graphics = makeGraphics();
                createdGraphics.push(graphics);
                return graphics;
            }),
        },
        worldLayer: { add: vi.fn() },
        game: { events: { on: vi.fn() } },
        terrainSystem: { getHeightAt: vi.fn(() => 0.8) },
        getFactionColor: vi.fn(() => 0xffffff),
        trees: { getChildren: vi.fn(() => []) },
        buildings: { getChildren: vi.fn(() => []) },
        inputManager: { selectedBuilding: null },
        ...overrides,
    };
    return { scene: scene as unknown as MainScene, createdGraphics };
}

describe('BuildingManager terrain-elevated overlays', () => {
    it('centers lumber-camp tree highlights on the elevated tree visual position', () => {
        const tree = { x: 120, y: 80 };
        const { scene, createdGraphics } = makeScene({
            trees: { getChildren: vi.fn(() => [tree]) },
        });
        const manager = new BuildingManager(scene);
        manager.previewBuildingType = BuildingType.LUMBER_CAMP;
        const height = 0.8;

        (manager as unknown as { updateHighlights(cx: number, cy: number, def: { effectRadius: number }): void })
            .updateHighlights(120, 80, { effectRadius: 200 });

        const expected = toIsoElev(tree.x, tree.y, height);
        expect(createdGraphics[0].fillEllipse).toHaveBeenCalledWith(expected.x, expected.y, 50, 25);
        expect(scene.terrainSystem.getHeightAt).toHaveBeenCalledWith(tree.x, tree.y);
    });

    it('centers territory and effect-radius ellipses on the elevated building position', () => {
        const def = { territoryRadius: 220, effectRadius: 140 };
        const building = {
            x: 160,
            y: 96,
            getData: vi.fn((key: string) => key === 'def' ? def : 0),
        };
        const { scene, createdGraphics } = makeScene({
            buildings: { getChildren: vi.fn(() => [building]) },
        });
        const manager = new BuildingManager(scene);
        const height = 0.8;

        (manager as unknown as { drawTerritory(): void }).drawTerritory();

        const expected = toIsoElev(building.x, building.y, height);
        const territoryGraphics = createdGraphics[1];
        expect(territoryGraphics.fillEllipse).toHaveBeenCalledWith(expected.x, expected.y, 440, 220);
        expect(territoryGraphics.strokeEllipse).toHaveBeenCalledWith(expected.x, expected.y, 280, 140);
        expect(scene.terrainSystem.getHeightAt).toHaveBeenCalledWith(building.x, building.y);
    });

    it('positions the selected-building cylinder at the elevated building visual origin', () => {
        const def = { effectRadius: 120 };
        const building = {
            x: 200,
            y: 110,
            getData: vi.fn((key: string) => key === 'def' ? def : 0),
        };
        const { scene, createdGraphics } = makeScene({
            inputManager: { selectedBuilding: building },
        });
        const manager = new BuildingManager(scene);
        const height = 0.8;

        (manager as unknown as { handleBuildingSelection(): void }).handleBuildingSelection();

        const expected = toIsoElev(building.x, building.y, height);
        const beam = createdGraphics[2];
        expect(beam.setPosition).toHaveBeenCalledWith(expected.x, expected.y);
        expect(scene.terrainSystem.getHeightAt).toHaveBeenCalledWith(building.x, building.y);
    });
});
