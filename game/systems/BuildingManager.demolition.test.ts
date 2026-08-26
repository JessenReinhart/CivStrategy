import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';

vi.mock('phaser', () => ({
    default: {
        Math: {
            Distance: {
                Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
            },
        },
        Geom: {
            Rectangle: class {},
        },
    },
}));

vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { BUILDINGS } from '../../constants';
import { BuildingType, UnitState, type VillagerData } from '../../types';
import type { MainScene } from '../MainScene';
import { BuildingManager } from './BuildingManager';

interface MockBuilding {
    x: number;
    y: number;
    scene: object | undefined;
    active: boolean;
    getData: ReturnType<typeof vi.fn>;
    setData: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    visual: {
        active: boolean;
        destroy: ReturnType<typeof vi.fn>;
    };
}

function makeManager(scene: MainScene): BuildingManager {
    const manager = Object.create(BuildingManager.prototype) as BuildingManager;
    Object.assign(manager as unknown as Record<string, unknown>, {
        scene,
        isTerritoryDirty: false,
    });
    vi.spyOn(manager, 'emitExplosionParticles').mockImplementation(() => undefined);
    return manager;
}

function callDemolish(manager: BuildingManager, building: MockBuilding): boolean {
    return (manager as unknown as {
        demolishBuilding(building: MockBuilding): boolean;
    }).demolishBuilding(building);
}

function makeFixture(options: { owner?: number; destroyFails?: boolean; selected?: boolean } = {}) {
    const def = BUILDINGS[BuildingType.FARM];
    const data = new Map<string, unknown>();
    data.set('def', def);
    data.set('owner', options.owner ?? 0);

    const worker = {
        id: 'worker-1',
        x: 100,
        y: 100,
        owner: 0,
        state: UnitState.WORKING,
        jobBuilding: undefined,
        path: [{ x: 120, y: 120 }],
        pathStep: 0,
        carryAmount: 0,
        carryType: null,
        gatherTimer: 0,
    } as VillagerData;
    data.set('assignedWorker', worker);

    const children: MockBuilding[] = [];
    const visual = {
        active: true,
        destroy: vi.fn(() => {
            visual.active = false;
        }),
    };

    const building = {
        x: 100,
        y: 100,
        scene: {},
        active: true,
        visual,
        getData: vi.fn((key: string) => data.get(key)),
        setData: vi.fn((key: string, value: unknown) => {
            data.set(key, value);
            return building;
        }),
        destroy: vi.fn(() => {
            if (options.destroyFails) throw new Error('destroy failed');
            building.scene = undefined;
            building.active = false;
            const index = children.indexOf(building);
            if (index >= 0) children.splice(index, 1);
        }),
    } satisfies MockBuilding;
    worker.jobBuilding = building as unknown as Phaser.GameObjects.GameObject;
    children.push(building);

    const inputManager = {
        selectedBuilding: options.selected ? building : null,
        deselectBuilding: vi.fn(() => {
            inputManager.selectedBuilding = null;
        }),
    };

    const scene = {
        resources: { wood: 100, food: 0, gold: 0 },
        maxPopulation: 20,
        happiness: 75,
        buildings: { getChildren: vi.fn(() => children) },
        inputManager,
        pathfinder: { markGrid: vi.fn() },
        proceduralSound: { playDemolition: vi.fn() },
        economySystem: { updateStats: vi.fn() },
    } as unknown as MainScene;

    return { scene, building, worker, def, inputManager };
}

describe('BuildingManager demolition transaction', () => {
    it('demolishes an assigned-worker building without assuming a physics body', () => {
        const { scene, building, worker, def, inputManager } = makeFixture({ selected: true });
        const manager = makeManager(scene);
        const startingWood = scene.resources.wood;

        expect(callDemolish(manager, building)).toBe(true);

        expect(building.destroy).toHaveBeenCalledTimes(1);
        expect(scene.resources.wood).toBe(startingWood + Math.floor(def.cost.wood * 0.75));
        expect(worker.state).toBe(UnitState.IDLE);
        expect(worker.jobBuilding).toBeUndefined();
        expect(worker.path).toBeUndefined();
        expect(inputManager.deselectBuilding).toHaveBeenCalledTimes(1);
    });

    it('does not refund the same destroyed building twice', () => {
        const { scene, building, def } = makeFixture();
        const manager = makeManager(scene);
        const startingWood = scene.resources.wood;
        const refund = Math.floor(def.cost.wood * 0.75);

        expect(callDemolish(manager, building)).toBe(true);
        expect(callDemolish(manager, building)).toBe(false);

        expect(scene.resources.wood).toBe(startingWood + refund);
        expect(building.destroy).toHaveBeenCalledTimes(1);
    });

    it('does not refund wood when entity teardown fails', () => {
        const { scene, building } = makeFixture({ destroyFails: true });
        const manager = makeManager(scene);
        const startingWood = scene.resources.wood;
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(callDemolish(manager, building)).toBe(false);

        expect(scene.resources.wood).toBe(startingWood);
        expect(building.getData('isDemolishing')).toBe(false);
        errorSpy.mockRestore();
    });

    it('rejects enemy buildings without teardown or refund', () => {
        const { scene, building } = makeFixture({ owner: 1 });
        const manager = makeManager(scene);
        const startingWood = scene.resources.wood;

        expect(callDemolish(manager, building)).toBe(false);

        expect(building.destroy).not.toHaveBeenCalled();
        expect(scene.resources.wood).toBe(startingWood);
    });
});
