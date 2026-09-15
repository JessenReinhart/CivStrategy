import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../MainScene', () => ({ MainScene: class {} }));

import type { BuildingDef } from '../../types';
import { BuildingType } from '../../types';
import type { MainScene } from '../MainScene';
import { EntityFactory } from './EntityFactory';

function makeHarness(hp: number, maxHp = 100) {
    const data = new Map<string, unknown>([
        ['hp', hp],
        ['maxHp', maxHp],
        ['owner', 0],
        ['constructionComplete', true],
        ['def', {
            type: BuildingType.HOUSE,
            name: 'House',
            width: 48,
            height: 48,
        } as BuildingDef],
    ]);
    const entity = {
        x: 0,
        y: 0,
        getData: vi.fn((key: string) => data.get(key)),
        setData: vi.fn((key: string, value: unknown) => data.set(key, value)),
        destroy: vi.fn(),
    };
    const scene = {
        maxPopulation: 20,
        happiness: 10,
        researchManager: { getSnapshot: vi.fn(() => ({ armorAdd: 0 })) },
        feedbackSystem: {
            showDamageNumber: vi.fn(),
            showHitSpark: vi.fn(),
            notifyBuildingDamaged: vi.fn(),
            notifyBuildingDestroyed: vi.fn(),
            showFloatingText: vi.fn(),
        },
        enemyAI: { sendTauntOnBuildingDestroyed: vi.fn() },
        proceduralSound: { playDemolition: vi.fn() },
        pathfinder: { markGrid: vi.fn() },
        buildingManager: { emitExplosionParticles: vi.fn() },
    } as unknown as MainScene;
    const factory = new EntityFactory(scene);
    const applyDamage = (amount: number) => (factory as unknown as {
        handleDamage(target: typeof entity, amount: number, isUnit: boolean): void;
    }).handleDamage(entity, amount, false);

    return { entity, scene, applyDamage };
}

// Regression for #359: the docstring promises the warning fires at <=50% HP,
// but the original `< 0.5` comparison skipped the exact-half boundary hit,
// leaving a one-hit feedback blind spot right at the threshold.
describe('EntityFactory building damage warning threshold', () => {
    it('warns when a hit brings a building to exactly 50% HP', () => {
        const { scene, applyDamage } = makeHarness(100);

        applyDamage(50); // 100 -> 50 hp, exactly half

        expect(scene.feedbackSystem.notifyBuildingDamaged).toHaveBeenCalledTimes(1);
    });

    it('does not warn while a building is still above 50% HP', () => {
        const { scene, applyDamage } = makeHarness(100);

        applyDamage(49); // 100 -> 51 hp, still above half

        expect(scene.feedbackSystem.notifyBuildingDamaged).not.toHaveBeenCalled();
    });

    it('does not repeat the warning on further damage below 50% HP', () => {
        const { scene, applyDamage } = makeHarness(100);

        applyDamage(50); // crosses to exactly 50%, warns once
        applyDamage(10); // further damage below threshold

        expect(scene.feedbackSystem.notifyBuildingDamaged).toHaveBeenCalledTimes(1);
    });
});
