import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
    default: {
        Math: {
            Distance: {
                Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
            },
        },
        Geom: {
            Rectangle: class {
                x: number;
                y: number;
                width: number;
                height: number;

                constructor(x: number, y: number, width: number, height: number) {
                    this.x = x;
                    this.y = y;
                    this.width = width;
                    this.height = height;
                }

                contains(x: number, y: number) {
                    return x >= this.x && x <= this.x + this.width && y >= this.y && y <= this.y + this.height;
                }
            },
            Intersects: {
                RectangleToRectangle: vi.fn(() => false),
            },
        },
    },
}));

vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { BUILDINGS } from '../../constants';
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
    const selectionGraphics = makeGraphics();
    const scene = {
        add: { graphics: vi.fn(() => selectionGraphics) },
        worldLayer: { add: vi.fn() },
        terrainSystem: {
            getHeightAt: vi.fn(() => 0.8),
            getSlopeAt: vi.fn(() => ({ slope: 0, isBuildable: true })),
        },
        getFactionColor: vi.fn(() => 0xffffff),
        resources: { wood: 10_000, food: 10_000, gold: 10_000 },
        trees: { getChildren: vi.fn(() => []) },
        buildings: { getChildren: vi.fn(() => []), getLength: vi.fn(() => 0) },
        units: { getChildren: vi.fn(() => []) },
        villagerSystem: { getAllVillagers: vi.fn(() => []) },
        inputManager: { selectedBuilding: null },
        ...overrides,
    };
    return { scene: scene as unknown as MainScene, selectionGraphics };
}

function makeManager(
    scene: MainScene,
    treeHighlightGraphics = makeGraphics(),
    territoryGraphics = makeGraphics(),
) {
    const manager = Object.create(BuildingManager.prototype) as BuildingManager;
    Object.assign(manager as unknown as Record<string, unknown>, {
        scene,
        treeHighlightGraphics,
        territoryGraphics,
        isTerritoryDirty: false,
        activeSelectionBeam: null,
        previewBuildingType: null,
        previewBuilding: null,
        isDemolishMode: false,
        previewText: null,
    });
    return { manager, treeHighlightGraphics, territoryGraphics };
}

function buildValidity(manager: BuildingManager, x: number, y: number) {
    return (manager as unknown as {
        getBuildValidity(x: number, y: number, type: BuildingType): { valid: boolean; reason?: string };
    }).getBuildValidity(x, y, BuildingType.HOUSE);
}

function makeTerritoryBuilding(owner: number, x = 100, y = 100) {
    const def = { territoryRadius: 400 };
    return {
        x,
        y,
        scene: {},
        getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1, height: 1 })),
        getData: vi.fn((key: string) => {
            if (key === 'owner') return owner;
            if (key === 'def') return def;
            return undefined;
        }),
    };
}

function makeOccupiedHouse(boundsX: number, boundsY: number) {
    return {
        x: boundsX + BUILDINGS[BuildingType.HOUSE].width / 2,
        y: boundsY + BUILDINGS[BuildingType.HOUSE].height / 2,
        scene: {},
        getBounds: vi.fn(() => ({
            x: boundsX,
            y: boundsY,
            width: BUILDINGS[BuildingType.HOUSE].width,
            height: BUILDINGS[BuildingType.HOUSE].height,
        })),
        getData: vi.fn((key: string) => {
            if (key === 'owner') return 0;
            if (key === 'def') return BUILDINGS[BuildingType.HOUSE];
            return undefined;
        }),
    };
}

describe('BuildingManager terrain-elevated overlays', () => {
    it('centers lumber-camp tree highlights on the elevated tree visual position', () => {
        const tree = { x: 120, y: 80 };
        const { scene } = makeScene({
            trees: { getChildren: vi.fn(() => [tree]) },
        });
        const { manager, treeHighlightGraphics } = makeManager(scene);
        manager.previewBuildingType = BuildingType.LUMBER_CAMP;
        const height = 0.8;

        (manager as unknown as { updateHighlights(cx: number, cy: number, def: { effectRadius: number }): void })
            .updateHighlights(120, 80, { effectRadius: 200 });

        const expected = toIsoElev(tree.x, tree.y, height);
        expect(treeHighlightGraphics.fillEllipse).toHaveBeenCalledWith(expected.x, expected.y, 50, 25);
        expect(scene.terrainSystem.getHeightAt).toHaveBeenCalledWith(tree.x, tree.y);
    });

    it('centers territory and effect-radius ellipses on the elevated building position', () => {
        const def = { territoryRadius: 220, effectRadius: 140 };
        const building = {
            x: 160,
            y: 96,
            getData: vi.fn((key: string) => key === 'def' ? def : 0),
        };
        const { scene } = makeScene({
            buildings: { getChildren: vi.fn(() => [building]) },
        });
        const { manager, territoryGraphics } = makeManager(scene);
        const height = 0.8;

        (manager as unknown as { drawTerritory(): void }).drawTerritory();

        const expected = toIsoElev(building.x, building.y, height);
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
        const { scene, selectionGraphics } = makeScene({
            inputManager: { selectedBuilding: building },
        });
        const { manager } = makeManager(scene);
        const height = 0.8;

        (manager as unknown as { handleBuildingSelection(): void }).handleBuildingSelection();

        const expected = toIsoElev(building.x, building.y, height);
        expect(selectionGraphics.setPosition).toHaveBeenCalledWith(expected.x, expected.y);
        expect(scene.terrainSystem.getHeightAt).toHaveBeenCalledWith(building.x, building.y);
    });
});

describe('BuildingManager player build territory', () => {
    it('rejects placement when only enemy territory covers the target', () => {
        const enemyTownCenter = makeTerritoryBuilding(1);
        const { scene } = makeScene({
            buildings: {
                getChildren: vi.fn(() => [enemyTownCenter]),
                getLength: vi.fn(() => 1),
            },
        });
        const { manager } = makeManager(scene);

        expect(buildValidity(manager, 200, 200)).toEqual({ valid: false, reason: 'Outside Territory' });
    });

    it('keeps placement valid inside player-owned territory', () => {
        const playerTownCenter = makeTerritoryBuilding(0);
        const { scene } = makeScene({
            buildings: {
                getChildren: vi.fn(() => [playerTownCenter]),
                getLength: vi.fn(() => 1),
            },
        });
        const { manager } = makeManager(scene);

        expect(buildValidity(manager, 300, 300)).toEqual({ valid: true });
    });
});

describe('BuildingManager dense footprint placement', () => {
    it('allows a house footprint to touch an existing building edge without overlapping area', () => {
        const playerTownCenter = makeTerritoryBuilding(0, 100, 100);
        const house = BUILDINGS[BuildingType.HOUSE];
        const candidateX = 300;
        const candidateY = 300;
        const candidateRight = candidateX + house.width / 2;
        const existingHouse = makeOccupiedHouse(candidateRight, candidateY - house.height / 2);
        const { scene } = makeScene({
            buildings: {
                getChildren: vi.fn(() => [playerTownCenter, existingHouse]),
                getLength: vi.fn(() => 2),
            },
        });
        const { manager } = makeManager(scene);

        expect(buildValidity(manager, candidateX, candidateY)).toEqual({ valid: true });
    });

    it('rejects placement when the candidate footprint overlaps an existing building by real area', () => {
        const playerTownCenter = makeTerritoryBuilding(0, 100, 100);
        const house = BUILDINGS[BuildingType.HOUSE];
        const candidateX = 300;
        const candidateY = 300;
        const candidateRight = candidateX + house.width / 2;
        const existingHouse = makeOccupiedHouse(candidateRight - 1, candidateY - house.height / 2);
        const { scene } = makeScene({
            buildings: {
                getChildren: vi.fn(() => [playerTownCenter, existingHouse]),
                getLength: vi.fn(() => 2),
            },
        });
        const { manager } = makeManager(scene);

        expect(buildValidity(manager, candidateX, candidateY)).toEqual({ valid: false, reason: 'Space Occupied' });
    });
});
