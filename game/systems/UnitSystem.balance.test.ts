import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Math: {
    Between: (min: number) => min,
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
} } }));
vi.mock('../MainScene', () => ({ MainScene: class {} }));
vi.mock('./FormationSystem', () => ({ FormationSystem: class {} }));

import { UnitSystem } from './UnitSystem';
import { EntityFactory } from './EntityFactory';
import { BUILDING_ARMOR, UNIT_DAMAGE, UNIT_STATS } from '../../constants';
import { BuildingType, FactionType, FormationType, UnitType } from '../../types';
import type { GameUnit } from '../../types';
import type { MainScene } from '../MainScene';

// Exercise attack resolution through real entity HP handling; only projectile
// animation is replaced by immediate impact, so per-arrow armor bugs are visible.
function volley({ hp = 150, damageMult = 1, armorAdd = 0, stress = false, building = true, owner = 0 } = {}) {
    const scene = {
        stressTestConfig: stress ? {} : undefined,
        add: { graphics: () => ({ setDepth() { return this; } }) },
        faction: FactionType.ROMANS, enemyFaction: FactionType.ROMANS,
        terrainSystem: {
            getCombatModifiers: () => ({ attackBonus: 0, defenseBonus: 0 }),
            isRiverAt: () => false, isForestAt: () => false,
        },
        buildingManager: { getWallsNear: () => [] },
        researchManager: { getSnapshot: (factionOwner: number) => ({
            damageMult: factionOwner === owner ? damageMult : 1,
            armorAdd: factionOwner === owner ? 0 : armorAdd,
        }) },
        time: { delayedCall: (_delay: number, callback: () => void) => callback() },
        proceduralSound: { playBowRelease: vi.fn() },
        feedbackSystem: { showDamageNumber: vi.fn(), showHitSpark: vi.fn(), showHitFlash: vi.fn() },

    } as unknown as MainScene;
    const factory = new EntityFactory(scene);
    const targetData = new Map<string, unknown>([
        ['hp', 1000], ['maxHp', 1000], ['owner', 1 - owner],
        ['armor', BUILDING_ARMOR[BuildingType.WALL]], ['formation', FormationType.BOX],
        ['def', building ? { type: BuildingType.WALL } : undefined],
    ]);
    const target = {
        x: 100, y: 0, scene,
        getData: (key: string) => targetData.get(key),
        setData: (key: string, value: unknown) => targetData.set(key, value),
        takeDamage: (amount: number, attackShare?: number) => {
            (factory as unknown as { handleDamage(e: unknown, a: number, unit: boolean, share?: number): void })
                .handleDamage(target, amount, !building, attackShare);
        },
    } as unknown as GameUnit;
    const data: Record<string, unknown> = {
        hp, maxHp: UNIT_STATS[UnitType.ARCHER].maxHp, owner,
        damage: UNIT_DAMAGE[UnitType.ARCHER], range: UNIT_STATS[UnitType.ARCHER].range,
        formation: FormationType.BOX,
    };
    const attacker = { x: 0, y: 0, scene, unitType: UnitType.ARCHER,
        getData: (key: string) => data[key] } as unknown as GameUnit;
    const system = new UnitSystem(scene);
    const impact = (_origin: unknown, hit: { takeDamage(amount: number): void }, amount: number) => hit.takeDamage(amount);
    const internals = system as unknown as {
        performAttack(unit: GameUnit, target: GameUnit): void;
        fireProjectile: typeof impact; scheduleProjectile: typeof impact;
    };
    internals.fireProjectile = impact;
    internals.scheduleProjectile = impact;
    internals.performAttack(attacker, target);
    return 1000 - (targetData.get('hp') as number);
}

describe('ranged volley balance', () => {
    it('retains fractional damage against building armor', () => {
        expect(volley()).toBeCloseTo(4.8);
    });
    it.each([0, 1])('applies military damage research for owner %i', (owner) => {
        expect(volley({ hp: 15, damageMult: 1.15, owner })).toBeCloseTo(volley({ hp: 15, owner }) * 1.15);
    });
    it.each([false, true])('does not multiply flat armor or minimum damage per visual arrow (building=%s)', (building) => {
        expect(volley({ armorAdd: 2, building })).toBeCloseTo(volley({ hp: 15, armorAdd: 2, building }));
        expect(volley({ armorAdd: 2, building })).toBeLessThan(volley({ building }));
    });
    it('keeps stress and normal combat damage consistent', () => {
        expect(volley({ stress: true, damageMult: 1.15, armorAdd: 2 }))
            .toBeCloseTo(volley({ damageMult: 1.15, armorAdd: 2 }));
    });
});


describe('ranged projectile origin safety', () => {
    const makeSystem = () => {
        const scene = {
            add: { graphics: () => ({ setDepth() { return this; } }) },
        } as unknown as MainScene;
        return new UnitSystem(scene);
    };

    const makeAttacker = (x: number, y: number) => ({
        x, y, scene: {},
        unitType: UnitType.ARCHER,
        getData: (key: string) => key === 'range' ? UNIT_STATS[UnitType.ARCHER].range : undefined,
    }) as unknown as GameUnit;

    it('falls back to the authoritative unit position when a cached soldier origin is stale', () => {
        const system = makeSystem() as unknown as {
            resolveProjectileOrigin(unit: GameUnit, soldier: { x: number; y: number }): { x: number; y: number };
        };
        const attacker = makeAttacker(900, 900);

        expect(system.resolveProjectileOrigin(attacker, { x: 120, y: 120 }))
            .toEqual({ x: 900, y: 900 });
    });

    it('keeps a nearby soldier position as the projectile origin', () => {
        const system = makeSystem() as unknown as {
            resolveProjectileOrigin(unit: GameUnit, soldier: { x: number; y: number }): { x: number; y: number };
        };
        const attacker = makeAttacker(900, 900);

        expect(system.resolveProjectileOrigin(attacker, { x: 925, y: 890 }))
            .toEqual({ x: 925, y: 890 });
    });

    it('rejects delayed shots after the target has moved outside attack range', () => {
        const system = makeSystem() as unknown as {
            isTargetWithinAttackRange(unit: GameUnit, target: GameUnit): boolean;
        };
        const attacker = makeAttacker(0, 0);
        const target = {
            x: UNIT_STATS[UnitType.ARCHER].range + 1,
            y: 0,
            scene: {},
            getData: () => undefined,
        } as unknown as GameUnit;

        expect(system.isTargetWithinAttackRange(attacker, target)).toBe(false);
    });
});
