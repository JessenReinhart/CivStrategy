import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../MainScene', () => ({ MainScene: class {} }));

import type { BuildingDef } from '../../types';
import { BuildingType } from '../../types';
import type { MainScene } from '../MainScene';
import { EntityFactory } from './EntityFactory';

function makeHarness(options: {
    owner?: number;
    constructionComplete?: boolean;
} = {}) {
    const owner = options.owner ?? 0;
    const data = new Map<string, unknown>([
        ['hp', 10],
        ['maxHp', 10],
        ['owner', owner],
        ['constructionComplete', options.constructionComplete],
        ['def', {
            type: BuildingType.HOUSE,
            name: 'House',
            width: 48,
            height: 48,
            populationBonus: 5,
            happinessBonus: 2,
        } as BuildingDef],
    ]);
    const entity = {
        x: 120,
        y: 80,
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
            notifyBuildingDestroyed: vi.fn(),
            showFloatingText: vi.fn(),
        },
        enemyAI: { sendTauntOnBuildingDestroyed: vi.fn() },
        proceduralSound: { playDemolition: vi.fn() },
        pathfinder: { markGrid: vi.fn() },
        buildingManager: { emitExplosionParticles: vi.fn() },
    } as unknown as MainScene;
    const factory = new EntityFactory(scene);
    const destroyByDamage = () => (factory as unknown as {
        handleDamage(target: typeof entity, amount: number, isUnit: boolean): void;
    }).handleDamage(entity, 20, false);

    return { entity, scene, destroyByDamage };
}

describe('EntityFactory building benefit teardown', () => {
    it('does not remove suppressed benefits when an under-construction player House is destroyed', () => {
        const { entity, scene, destroyByDamage } = makeHarness({ constructionComplete: false });

        destroyByDamage();

        expect(scene.maxPopulation).toBe(20);
        expect(scene.happiness).toBe(10);
        expect(entity.destroy).toHaveBeenCalledTimes(1);
    });

    it('removes active benefits exactly once when a completed player House is destroyed', () => {
        const { entity, scene, destroyByDamage } = makeHarness({ constructionComplete: true });

        destroyByDamage();

        expect(scene.maxPopulation).toBe(15);
        expect(scene.happiness).toBe(8);
        expect(entity.destroy).toHaveBeenCalledTimes(1);
    });

    it('does not mutate player benefits when an enemy House is destroyed', () => {
        const { scene, destroyByDamage } = makeHarness({ owner: 1, constructionComplete: true });

        destroyByDamage();

        expect(scene.maxPopulation).toBe(20);
        expect(scene.happiness).toBe(10);
    });
});
