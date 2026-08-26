import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../MainScene', () => ({ MainScene: class {} }));

import type { BuildingDef } from '../../types';
import { BuildingType, UnitState } from '../../types';
import type { MainScene } from '../MainScene';
import { BuildingManager } from './BuildingManager';

function makeDef(): BuildingDef {
    return {
        type: BuildingType.HOUSE,
        name: 'House',
        width: 48,
        height: 48,
        cost: { wood: 100, food: 0, gold: 0 },
        populationBonus: 5,
        happinessBonus: 2,
    } as BuildingDef;
}

function makeHarness(options: {
    owner?: number;
    registered?: boolean;
    destroySucceeds?: boolean;
    assignedWorker?: boolean;
} = {}) {
    const owner = options.owner ?? 0;
    const destroySucceeds = options.destroySucceeds ?? true;
    const def = makeDef();
    const order: string[] = [];
    const worker = options.assignedWorker === false ? null : {
        state: UnitState.GATHERING,
        jobBuilding: null as unknown,
        path: [{ x: 1, y: 1 }],
        body: { setVelocity: vi.fn(() => order.push('worker-stop')) },
    };
    const visual = { destroy: vi.fn(() => order.push('visual-destroy')) };
    const building = {
        x: 160,
        y: 96,
        active: true,
        scene: {},
        visual,
        getData: vi.fn((key: string) => {
            if (key === 'def') return def;
            if (key === 'owner') return owner;
            if (key === 'assignedWorker') return worker;
            return undefined;
        }),
        destroy: vi.fn(),
    };
    if (worker) worker.jobBuilding = building;

    const children = options.registered === false ? [] : [building];
    building.destroy.mockImplementation(() => {
        order.push('building-destroy');
        if (!destroySucceeds) return;
        building.active = false;
        building.scene = null as unknown as Record<string, never>;
        const index = children.indexOf(building);
        if (index >= 0) children.splice(index, 1);
    });

    const inputManager = {
        selectedBuilding: building,
        deselectBuilding: vi.fn(() => {
            order.push('deselect');
            inputManager.selectedBuilding = null as unknown as typeof building;
        }),
    };
    const scene = {
        resources: { wood: 200, food: 100, gold: 100 },
        maxPopulation: 20,
        happiness: 10,
        buildings: { getChildren: vi.fn(() => children) },
        inputManager,
        pathfinder: { markGrid: vi.fn(() => order.push('pathfinder-clear')) },
        economySystem: { updateStats: vi.fn() },
        proceduralSound: { playDemolition: vi.fn() },
    } as unknown as MainScene;

    const manager = Object.create(BuildingManager.prototype) as BuildingManager;
    Object.assign(manager as unknown as Record<string, unknown>, {
        scene,
        demolitionsInProgress: new WeakSet(),
        isTerritoryDirty: false,
    });
    manager.emitExplosionParticles = vi.fn();

    const demolish = () => (manager as unknown as {
        demolishBuilding(buildingToDemolish: typeof building): void;
    }).demolishBuilding(building);

    return { building, def, worker, scene, inputManager, order, demolish };
}

describe('BuildingManager demolition transaction', () => {
    it('commits removal, worker release, occupancy, and economy exactly once', () => {
        const { building, worker, scene, inputManager, order, demolish } = makeHarness();

        demolish();

        expect(scene.resources.wood).toBe(275);
        expect(scene.maxPopulation).toBe(15);
        expect(scene.happiness).toBe(8);
        expect(inputManager.deselectBuilding).toHaveBeenCalledTimes(1);
        expect(order.indexOf('deselect')).toBeLessThan(order.indexOf('building-destroy'));
        expect(order.indexOf('building-destroy')).toBeLessThan(order.indexOf('worker-stop'));
        expect(order.indexOf('building-destroy')).toBeLessThan(order.indexOf('pathfinder-clear'));
        expect(worker?.state).toBe(UnitState.IDLE);
        expect(worker?.jobBuilding).toBeNull();
        expect(worker?.path).toBeNull();
        expect(scene.pathfinder.markGrid).toHaveBeenCalledWith(160, 96, 48, 48, false);
        expect(scene.economySystem.updateStats).toHaveBeenCalledTimes(1);
        expect(building.destroy).toHaveBeenCalledTimes(1);

        demolish();

        expect(scene.resources.wood).toBe(275);
        expect(scene.maxPopulation).toBe(15);
        expect(scene.happiness).toBe(8);
        expect(building.destroy).toHaveBeenCalledTimes(1);
        expect(scene.economySystem.updateStats).toHaveBeenCalledTimes(1);
    });

    it('leaves the live building worker and economy untouched when teardown is a no-op', () => {
        const { building, worker, scene, demolish } = makeHarness({ destroySucceeds: false });
        const originalPath = worker?.path;

        demolish();

        expect(building.active).toBe(true);
        expect(scene.resources.wood).toBe(200);
        expect(scene.maxPopulation).toBe(20);
        expect(scene.happiness).toBe(10);
        expect(worker?.state).toBe(UnitState.GATHERING);
        expect(worker?.jobBuilding).toBe(building);
        expect(worker?.path).toBe(originalPath);
        expect(worker?.body.setVelocity).not.toHaveBeenCalled();
        expect(scene.pathfinder.markGrid).not.toHaveBeenCalled();
        expect(scene.economySystem.updateStats).not.toHaveBeenCalled();
    });

    it('rejects enemy and stale building references without changing economy state', () => {
        const enemy = makeHarness({ owner: 1 });
        enemy.demolish();
        expect(enemy.scene.resources.wood).toBe(200);
        expect(enemy.building.destroy).not.toHaveBeenCalled();

        const stale = makeHarness({ registered: false });
        stale.demolish();
        expect(stale.scene.resources.wood).toBe(200);
        expect(stale.building.destroy).not.toHaveBeenCalled();
    });
});
