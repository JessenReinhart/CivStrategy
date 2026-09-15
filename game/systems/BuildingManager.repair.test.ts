import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../MainScene', () => ({ MainScene: class {} }));

import type { BuildingDef } from '../../types';
import { BuildingType } from '../../types';
import type { MainScene } from '../MainScene';
import { BuildingManager } from './BuildingManager';
import { REPAIR_DURATION_MS } from '../buildingRepair';

function makeDef(overrides: Partial<BuildingDef> = {}): BuildingDef {
    return {
        type: BuildingType.HOUSE,
        name: 'House',
        width: 48,
        height: 48,
        cost: { wood: 100, food: 0, gold: 50 },
        maxHp: 200,
        ...overrides,
    } as BuildingDef;
}

function makeBuilding(options: {
    owner?: number;
    hp?: number;
    maxHp?: number;
    constructionComplete?: boolean;
    repairing?: boolean;
    repairLastTick?: number;
} = {}) {
    const def = makeDef({ maxHp: options.maxHp ?? 200 });
    const barFill = { scaleX: 1, fillColor: 0x22c55e };
    const hpBar = {
        setVisible: vi.fn(),
        getByName: () => barFill,
    };
    const visual = { getData: (key: string) => (key === 'hpBar' ? hpBar : undefined) };
    const data = new Map<string, unknown>([
        ['owner', options.owner ?? 0],
        ['def', def],
        ['hp', options.hp ?? 100],
        ['maxHp', options.maxHp ?? 200],
        ['constructionComplete', options.constructionComplete ?? true],
        ['repairing', options.repairing ?? false],
        ['repairLastTick', options.repairLastTick ?? 0],
        ['_healthWarned', true],
    ]);
    return {
        def, visual, barFill, hpBar,
        getData: (key: string) => data.get(key),
        setData: (key: string, value: unknown) => { data.set(key, value); return value; },
    };
}

function makeManager(building: ReturnType<typeof makeBuilding>, gameTime: number, resources = { wood: 1000, food: 1000, gold: 1000 }) {
    const scene = {
        gameTime,
        resources,
        buildings: { getChildren: () => [building] },
        feedbackSystem: { notifyBuildingRepaired: vi.fn() },
    } as unknown as MainScene;
    const manager = Object.create(BuildingManager.prototype) as BuildingManager;
    Object.assign(manager as unknown as Record<string, unknown>, { scene });
    return { manager, scene };
}

describe('BuildingManager.requestRepair', () => {
    it('starts repairing an owned, completed, damaged building', () => {
        const building = makeBuilding({ hp: 100, maxHp: 200 });
        const { manager, scene } = makeManager(building, 5000);

        manager.requestRepair(building as unknown as Phaser.GameObjects.GameObject);

        expect(building.getData('repairing')).toBe(true);
        expect(building.getData('repairLastTick')).toBe(scene.gameTime);
    });

    it('ignores enemy buildings', () => {
        const building = makeBuilding({ owner: 1, hp: 100, maxHp: 200 });
        const { manager } = makeManager(building, 5000);

        manager.requestRepair(building as unknown as Phaser.GameObjects.GameObject);

        expect(building.getData('repairing')).toBe(false);
    });

    it('ignores buildings still under construction', () => {
        const building = makeBuilding({ hp: 100, maxHp: 200, constructionComplete: false });
        const { manager } = makeManager(building, 5000);

        manager.requestRepair(building as unknown as Phaser.GameObjects.GameObject);

        expect(building.getData('repairing')).toBe(false);
    });

    it('ignores buildings already at full HP', () => {
        const building = makeBuilding({ hp: 200, maxHp: 200 });
        const { manager } = makeManager(building, 5000);

        manager.requestRepair(building as unknown as Phaser.GameObjects.GameObject);

        expect(building.getData('repairing')).toBe(false);
    });
});

describe('BuildingManager repair tick (private updateRepairs via public update)', () => {
    it('restores HP and deducts proportional resources over time', () => {
        const building = makeBuilding({ hp: 0, maxHp: 200, repairing: true, repairLastTick: 0 });
        const { manager, scene } = makeManager(building, REPAIR_DURATION_MS / 2);

        (manager as unknown as { updateRepairs(): void }).updateRepairs();

        expect(building.getData('hp')).toBeCloseTo(100, 5);
        expect(scene.resources.wood).toBeCloseTo(950, 5); // 1000 - 50% of 100 cost
        expect(scene.resources.gold).toBeCloseTo(975, 5); // 1000 - 50% of 50 cost
        expect(building.getData('repairing')).toBe(true); // not yet complete
    });

    it('completes repair, stops repairing, resets the damage-warning flag, and notifies once', () => {
        const building = makeBuilding({ hp: 190, maxHp: 200, repairing: true, repairLastTick: 0 });
        const { manager, scene } = makeManager(building, REPAIR_DURATION_MS * 10);

        (manager as unknown as { updateRepairs(): void }).updateRepairs();

        expect(building.getData('hp')).toBe(200);
        expect(building.getData('repairing')).toBe(false);
        expect(building.getData('_healthWarned')).toBe(false);
        expect(scene.feedbackSystem.notifyBuildingRepaired).toHaveBeenCalledTimes(1);

        // A further tick after completion must not re-fire or move HP further.
        (manager as unknown as { updateRepairs(): void }).updateRepairs();
        expect(scene.feedbackSystem.notifyBuildingRepaired).toHaveBeenCalledTimes(1);
    });

    it('makes no progress and does not touch resources when the building is not repairing', () => {
        const building = makeBuilding({ hp: 50, maxHp: 200, repairing: false });
        const { manager, scene } = makeManager(building, REPAIR_DURATION_MS);

        (manager as unknown as { updateRepairs(): void }).updateRepairs();

        expect(building.getData('hp')).toBe(50);
        expect(scene.resources.wood).toBe(1000);
    });
});
