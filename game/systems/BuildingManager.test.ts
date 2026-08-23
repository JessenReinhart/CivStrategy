import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
    class MockRectangle {
        constructor(
            public x: number,
            public y: number,
            public width: number,
            public height: number,
        ) {}

        contains(px: number, py: number) {
            return px >= this.x && px <= this.x + this.width && py >= this.y && py <= this.y + this.height;
        }
    }

    return {
        default: {
            Math: {
                Distance: {
                    Between: (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay),
                },
            },
            Geom: {
                Rectangle: MockRectangle,
                Intersects: {
                    RectangleToRectangle: () => false,
                },
            },
        },
    };
});

vi.mock('../MainScene', () => ({
    MainScene: class {},
}));

vi.mock('../utils/iso', () => ({
    toCartesian: (x: number, y: number) => ({ x, y }),
    toIso: (x: number, y: number) => ({ x, y }),
    toIsoElev: (x: number, y: number) => ({ x, y }),
}));

import { BuildingManager } from './BuildingManager';
import { BuildingType } from '../../types';
import type { MainScene } from '../MainScene';

function makeGraphics() {
    return {
        setDepth: vi.fn().mockReturnThis(),
        clear: vi.fn(),
    };
}

function makeScene() {
    const spawnBuilding = vi.fn();
    const legacySpawnUnit = vi.fn();
    const spawnVillager = vi.fn();
    const showFloatingText = vi.fn();
    const notifyBuildingComplete = vi.fn();
    const updateStats = vi.fn();

    const scene = {
        add: {
            graphics: vi.fn(() => makeGraphics()),
        },
        worldLayer: { add: vi.fn() },
        game: { events: { on: vi.fn(), emit: vi.fn() } },
        resources: { wood: 1000, food: 1000, gold: 1000 },
        cameras: {
            main: {
                scrollX: 0,
                scrollY: 0,
                width: 800,
                height: 600,
                shake: vi.fn(),
            },
        },
        buildings: {
            getChildren: () => [],
            getLength: () => 0,
        },
        units: { getChildren: () => [] },
        trees: { getChildren: () => [] },
        villagerSystem: {
            getAllVillagers: () => [],
            spawnVillager,
        },
        terrainSystem: {
            getSlopeAt: () => ({ slope: 0, isBuildable: true }),
            getHeightAt: () => 1,
        },
        entityFactory: {
            spawnBuilding,
            spawnUnit: legacySpawnUnit,
        },
        proceduralSound: { playConstruction: vi.fn() },
        feedbackSystem: { showFloatingText, notifyBuildingComplete },
        economySystem: { updateStats },
    } as unknown as MainScene;

    return {
        scene,
        spawnBuilding,
        legacySpawnUnit,
        spawnVillager,
        showFloatingText,
        notifyBuildingComplete,
        updateStats,
    };
}

describe('BuildingManager house completion', () => {
    it('grants one real VillagerSystem peasant instead of using EntityFactory', () => {
        const {
            scene,
            spawnBuilding,
            legacySpawnUnit,
            spawnVillager,
            showFloatingText,
            notifyBuildingComplete,
            updateStats,
        } = makeScene();
        const manager = new BuildingManager(scene);
        manager.previewBuildingType = BuildingType.HOUSE;
        vi.spyOn(manager, 'emitDustParticles').mockImplementation(() => undefined);

        manager.tryBuild(0, 0);

        // House is 48x48 and the build position snaps to the tile origin,
        // so its center is (24,24) and the granted peasant uses the legacy
        // +30,+30 exterior offset.
        expect(spawnBuilding).toHaveBeenCalledWith(BuildingType.HOUSE, 24, 24, 0);
        expect(spawnVillager).toHaveBeenCalledTimes(1);
        expect(spawnVillager).toHaveBeenCalledWith(54, 54, 0);
        expect(legacySpawnUnit).not.toHaveBeenCalled();
        expect(showFloatingText).toHaveBeenCalledWith(24, 24, 'Peasant spawned!', '#00ff00');
        expect(notifyBuildingComplete).toHaveBeenCalledWith('House');
        expect(updateStats).toHaveBeenCalledTimes(1);
    });
});
