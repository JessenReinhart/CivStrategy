import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../MainScene', () => ({ MainScene: class {} }));

import type { BuildingDef } from '../../types';
import { BuildingType } from '../../types';
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

function makeHarness(options: { owner?: number; registered?: boolean; destroySucceeds?: boolean } = {}) {
    const owner = options.owner ?? 0;
    const destroySucceeds = options.destroySucceeds ?? true;
    const def = makeDef();
    const order: string[] = [];
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
            if (key === 'assignedWorker') return null;
            return undefined;
        }),
        destroy: vi.fn(),
    };
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
        pathfinder: { markGrid: vi.fn() },
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

    return { building, def, manager, scene, inputManager, order, demolish };
}

describe('BuildingManager demolition economy integrity', () => {
    it('commits one refund only after a registered player building is removed', () => {
        const { building, scene, inputManager, order, demolish } = makeHarness();

        demolish();

        expect(scene.resources.wood).toBe(275);
        expect(scene.maxPopulation).toBe(15);
        expect(scene.happiness).toBe(8);
        expect(inputManager.deselectBuilding).toHaveBeenCalledTimes(1);
        expect(order.indexOf('deselect')).toBeLessThan(order.indexOf('building-destroy'));
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

    it('does not credit resources when entity teardown fails', () => {
        const { building, scene, demolish } = makeHarness({ destroySucceeds: false });

        demolish();

        expect(scene.resources.wood).toBe(200);
        expect(scene.maxPopulation).toBe(20);
        expect(scene.happiness).toBe(10);
        expect(scene.economySystem.updateStats).not.toHaveBeenCalled();
        expect(scene.pathfinder.markGrid).toHaveBeenNthCalledWith(1, 160, 96, 48, 48, false);
        expect(scene.pathfinder.markGrid).toHaveBeenNthCalledWith(2, 160, 96, 48, 48, true);
        expect(building.active).toBe(true);
    });
});
