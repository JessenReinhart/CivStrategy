import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
    default: {
        Math: {
            Linear: (a: number, b: number, t: number) => a + (b - a) * t,
        },
    },
}));

vi.mock('../MainScene', () => ({
    MainScene: class {},
}));

import { LiquidCombatSystem } from './LiquidCombatSystem';
import { MainScene } from '../MainScene';
import { UnitType, GameUnit } from '../../types';

// ── Mock infrastructure ──────────────────────────────────────────────────
// Mock objects are duck-typed stand-ins for Phaser game objects; unchecked
// casts are intentional at the test boundary (structural subset).

interface MockUnitInit {
    unitType: UnitType;
    x: number;
    y: number;
    owner?: number;
    spatialKey?: string;
    velocity?: { x: number; y: number };
}

function makeUnit(init: MockUnitInit): GameUnit {
    const data: Record<string, unknown> = {};
    if (init.owner !== undefined) data.owner = init.owner;
    if (init.spatialKey !== undefined) data.spatialKey = init.spatialKey;
    return {
        unitType: init.unitType,
        x: init.x,
        y: init.y,
        getData: (k: string) => data[k],
        body: init.velocity
            ? { velocity: { x: init.velocity.x, y: init.velocity.y }, enable: true }
            : null,
    } as unknown as GameUnit; // test fixture, structural subset only
}

interface MockSceneInit {
    units: GameUnit[];
    stressTestConfig?: { unitCount: number; enableEnemies?: boolean } | null;
    peacefulMode?: boolean;
    spatialHash?: { query: (x: number, y: number, r: number) => GameUnit[] };
}

function makeScene(init: MockSceneInit): MainScene {
    return {
        units: { getChildren: () => init.units },
        stressTestConfig: init.stressTestConfig ?? null,
        peacefulMode: init.peacefulMode ?? false,
        unitSpatialHash: init.spatialHash ?? { query: () => [] },
    } as unknown as MainScene; // test fixture, structural subset only
}

// Constant copied from the system under test for deterministic expectations.
const CONTACT_RANGE = 60;

describe('LiquidCombatSystem', () => {
    describe('pressure grid', () => {
        it('computes max outward force for a fully-packed cell with empty neighbors', () => {
            // 8 military units all in cell (0,0) => density excess = 8/8 = 1.0
            const units: GameUnit[] = [];
            for (let i = 0; i < 8; i++) {
                units.push(makeUnit({ unitType: UnitType.PIKESMAN, x: 20, y: 20, owner: 0, spatialKey: '0,0' }));
            }
            const system = new LiquidCombatSystem(makeScene({ units }));

            system.precompute();

            expect(system.pressureCellCount).toBe(1);
            const pressure = system.getPressure('0,0');
            expect(pressure).not.toBeNull();
            expect(pressure!.force).toBeCloseTo(60, 5); // PRESSURE_FORCE_MAX at density 8/8
            expect(pressure!.density).toBe(8);
        });

        it('pushes outward from the cell centroid toward the cell center', () => {
            // All units clustered at bottom-left corner of cell (0,0); pressure
            // direction points from centroid (20,20) toward cell center (75,75).
            const units: GameUnit[] = [];
            for (let i = 0; i < 8; i++) {
                units.push(makeUnit({ unitType: UnitType.LEGION, x: 20, y: 20, owner: 0, spatialKey: '0,0' }));
            }
            const system = new LiquidCombatSystem(makeScene({ units }));

            system.precompute();

            const pressure = system.getPressure('0,0')!;
            const expected = Math.SQRT1_2; // normalize(55, 55)
            expect(pressure.dirX).toBeCloseTo(expected, 5);
            expect(pressure.dirY).toBeCloseTo(expected, 5);
        });

        it('produces weaker pressure for a half-packed cell', () => {
            // 4 units in the cell => density excess 4/8 = 0.5 => force 60*0.25 = 15
            const units: GameUnit[] = [];
            for (let i = 0; i < 4; i++) {
                units.push(makeUnit({ unitType: UnitType.AXEMAN, x: 20, y: 20, owner: 0, spatialKey: '0,0' }));
            }
            const system = new LiquidCombatSystem(makeScene({ units }));

            system.precompute();

            const pressure = system.getPressure('0,0');
            expect(pressure).not.toBeNull();
            expect(pressure!.force).toBeCloseTo(15, 5);
        });

        it('excludes civilians from pressure contribution', () => {
            const units: GameUnit[] = [];
            for (let i = 0; i < 8; i++) {
                units.push(makeUnit({ unitType: UnitType.VILLAGER, x: 20, y: 20, owner: 0, spatialKey: '0,0' }));
            }
            const system = new LiquidCombatSystem(makeScene({ units }));

            system.precompute();

            expect(system.pressureCellCount).toBe(0);
            expect(system.getPressure('0,0')).toBeNull();
        });

        it('returns null for unknown cells', () => {
            const system = new LiquidCombatSystem(makeScene({ units: [] }));
            system.precompute();
            expect(system.getPressure('99,99')).toBeNull();
        });
    });

    describe('contact lines', () => {
        it('detects an opposing pair within contact range and computes backward push', () => {
            // Player at x=50 in cell 0,0; enemy at x=105 in same cell (55px apart < 60)
            const units: GameUnit[] = [
                makeUnit({ unitType: UnitType.PIKESMAN, x: 50, y: 50, owner: 0, spatialKey: '0,0' }),
                makeUnit({ unitType: UnitType.PIKESMAN, x: 105, y: 50, owner: 1, spatialKey: '0,0' }),
            ];
            const system = new LiquidCombatSystem(makeScene({ units }));

            system.precompute();

            expect(system.contactLineCount).toBeGreaterThan(0);

            // Player (owner 0): normal points +x (toward enemy), so backward push = -x
            const playerForce = system.getContactForce(50, 50, 0);
            expect(playerForce.bx).toBeLessThan(0);
            expect(playerForce.by).toBeCloseTo(0, 5);

            // Enemy (owner 1): normal points -x (toward player), so backward push = +x
            const enemyForce = system.getContactForce(105, 50, 1);
            expect(enemyForce.bx).toBeGreaterThan(0);
            expect(enemyForce.by).toBeCloseTo(0, 5);

            // Symmetry: same magnitude, opposite sign
            expect(enemyForce.bx).toBeCloseTo(-playerForce.bx, 5);
        });

        it('produces no contact line when armies are out of range', () => {
            const units: GameUnit[] = [
                makeUnit({ unitType: UnitType.PIKESMAN, x: 50, y: 50, owner: 0, spatialKey: '0,0' }),
                // 300px away => two cells apart, far beyond CONTACT_RANGE
                makeUnit({ unitType: UnitType.PIKESMAN, x: 350, y: 50, owner: 1, spatialKey: '2,0' }),
            ];
            const system = new LiquidCombatSystem(makeScene({ units }));

            system.precompute();

            expect(system.contactLineCount).toBe(0);
            const force = system.getContactForce(50, 50, 0);
            expect(force.bx).toBe(0);
            expect(force.by).toBe(0);
        });

        it('excludes neutral units (owner < 0)', () => {
            const units: GameUnit[] = [
                makeUnit({ unitType: UnitType.PIKESMAN, x: 50, y: 50, owner: 0, spatialKey: '0,0' }),
                makeUnit({ unitType: UnitType.ANIMAL, x: 80, y: 50, owner: -1, spatialKey: '0,0' }),
            ];
            const system = new LiquidCombatSystem(makeScene({ units }));

            system.precompute();

            expect(system.contactLineCount).toBe(0);
        });

        it('applies lateral tangent force for diagonal formation pairs', () => {
            // Enemy offset in both axes => normal is diagonal, tangent is perpendicular.
            const units: GameUnit[] = [
                makeUnit({ unitType: UnitType.PIKESMAN, x: 50, y: 50, owner: 0, spatialKey: '0,0' }),
                makeUnit({ unitType: UnitType.PIKESMAN, x: 90, y: 80, owner: 1, spatialKey: '0,0' }),
            ];
            const system = new LiquidCombatSystem(makeScene({ units }));

            system.precompute();

            const force = system.getContactForce(50, 50, 0);
            // Lateral (tangent) must be non-zero for a diagonal contact
            expect(force.lx).not.toBe(0);
            expect(force.ly).not.toBe(0);
            // Tangent is perpendicular to backward (both scale the same normal/tangent pair)
            const dot = force.lx * force.bx + force.ly * force.by;
            expect(dot).toBeCloseTo(0, 5);
            // Backward push must point away from the enemy (enemy is +x,+y of player)
            expect(force.bx).toBeLessThan(0);
            expect(force.by).toBeLessThan(0);
        });

        it('applies stronger force when formations are closer', () => {
            const close: GameUnit[] = [
                makeUnit({ unitType: UnitType.PIKESMAN, x: 80, y: 50, owner: 0, spatialKey: '0,0' }),
                makeUnit({ unitType: UnitType.PIKESMAN, x: 105, y: 50, owner: 1, spatialKey: '0,0' }),
            ];
            const far: GameUnit[] = [
                makeUnit({ unitType: UnitType.PIKESMAN, x: 50, y: 50, owner: 0, spatialKey: '0,0' }),
                makeUnit({ unitType: UnitType.PIKESMAN, x: 105, y: 50, owner: 1, spatialKey: '0,0' }),
            ];
            const closeSystem = new LiquidCombatSystem(makeScene({ units: close }));
            const farSystem = new LiquidCombatSystem(makeScene({ units: far }));

            closeSystem.precompute();
            farSystem.precompute();

            const closeForce = closeSystem.getContactForce(80, 50, 0);
            const farForce = farSystem.getContactForce(50, 50, 0);
            expect(Math.abs(closeForce.bx)).toBeGreaterThan(Math.abs(farForce.bx));
        });

        it(`respects CONTACT_RANGE boundary (${CONTACT_RANGE}px)`, () => {
            // 59px apart => contact; 61px apart => none
            const near = makeUnit({ unitType: UnitType.PIKESMAN, x: 1, y: 1, owner: 0, spatialKey: '0,0' });
            const nearEnemy = makeUnit({ unitType: UnitType.PIKESMAN, x: 60, y: 1, owner: 1, spatialKey: '0,0' });
            const nearSystem = new LiquidCombatSystem(makeScene({ units: [near, nearEnemy] }));
            nearSystem.precompute();
            // One contact line per owner side (player sees enemy, enemy sees player)
            expect(nearSystem.contactLineCount).toBe(2);

            const justFar = makeUnit({ unitType: UnitType.PIKESMAN, x: 1, y: 1, owner: 0, spatialKey: '0,0' });
            const farEnemy = makeUnit({ unitType: UnitType.PIKESMAN, x: 62, y: 1, owner: 1, spatialKey: '0,0' });
            const farSystem = new LiquidCombatSystem(makeScene({ units: [justFar, farEnemy] }));
            farSystem.precompute();
            expect(farSystem.contactLineCount).toBe(0);
        });
    });

    describe('velocity alignment', () => {
        it('moves unit velocity toward neighbor average', () => {
            const unit = makeUnit({ unitType: UnitType.LEGION, x: 100, y: 100, owner: 0, spatialKey: '0,0', velocity: { x: 0, y: 0 } });
            const neighbors = [
                makeUnit({ unitType: UnitType.LEGION, x: 105, y: 100, owner: 0, spatialKey: '0,0', velocity: { x: 100, y: 0 } }),
                makeUnit({ unitType: UnitType.LEGION, x: 95, y: 100, owner: 0, spatialKey: '0,0', velocity: { x: 100, y: 0 } }),
                makeUnit({ unitType: UnitType.LEGION, x: 100, y: 105, owner: 0, spatialKey: '0,0', velocity: { x: 100, y: 0 } }),
            ];
            const scene = makeScene({
                units: [unit, ...neighbors],
                spatialHash: { query: () => [unit, ...neighbors] },
            });
            const system = new LiquidCombatSystem(scene);

            system.applyAlignment(unit);

            // 3 neighbors, avg (100,0); strength = min(0.15, 3*0.03) = 0.09
            // vx = 0 + (100-0)*0.09 = 9
            const body = unit.body as { velocity: { x: number; y: number } };
            expect(body.velocity.x).toBeCloseTo(9, 5);
            expect(body.velocity.y).toBeCloseTo(0, 5);
        });

        it('does nothing with fewer than 2 neighbors', () => {
            const unit = makeUnit({ unitType: UnitType.LEGION, x: 100, y: 100, owner: 0, spatialKey: '0,0', velocity: { x: 0, y: 0 } });
            const oneNeighbor = makeUnit({ unitType: UnitType.LEGION, x: 105, y: 100, owner: 0, spatialKey: '0,0', velocity: { x: 100, y: 0 } });
            const scene = makeScene({
                units: [unit, oneNeighbor],
                spatialHash: { query: () => [unit, oneNeighbor] },
            });
            const system = new LiquidCombatSystem(scene);

            system.applyAlignment(unit);

            const body = unit.body as { velocity: { x: number; y: number } };
            expect(body.velocity.x).toBeCloseTo(0, 5);
            expect(body.velocity.y).toBeCloseTo(0, 5);
        });

        it('ignores civilian neighbors in the average', () => {
            const unit = makeUnit({ unitType: UnitType.LEGION, x: 100, y: 100, owner: 0, spatialKey: '0,0', velocity: { x: 0, y: 0 } });
            const villager = makeUnit({ unitType: UnitType.VILLAGER, x: 105, y: 100, owner: 0, spatialKey: '0,0', velocity: { x: 500, y: 0 } });
            const legionA = makeUnit({ unitType: UnitType.LEGION, x: 95, y: 100, owner: 0, spatialKey: '0,0', velocity: { x: 100, y: 0 } });
            const legionB = makeUnit({ unitType: UnitType.LEGION, x: 100, y: 105, owner: 0, spatialKey: '0,0', velocity: { x: 100, y: 0 } });
            const scene = makeScene({
                units: [unit, villager, legionA, legionB],
                spatialHash: { query: () => [unit, villager, legionA, legionB] },
            });
            const system = new LiquidCombatSystem(scene);

            system.applyAlignment(unit);

            // Only 2 valid military neighbors => avg (100,0), strength = 0.06
            const body = unit.body as { velocity: { x: number; y: number } };
            expect(body.velocity.x).toBeCloseTo(6, 5);
        });
    });

    describe('mode gating', () => {
        it('clears everything in peaceful stress mode', () => {
            const units: GameUnit[] = [];
            for (let i = 0; i < 8; i++) {
                units.push(makeUnit({ unitType: UnitType.PIKESMAN, x: 20, y: 20, owner: 0, spatialKey: '0,0' }));
            }
            const scene = makeScene({ units, stressTestConfig: { unitCount: 500, enableEnemies: false } });
            const system = new LiquidCombatSystem(scene);

            system.precompute();

            expect(system.pressureCellCount).toBe(0);
            expect(system.contactLineCount).toBe(0);
        });

        it('computes normally with enemies enabled in stress', () => {
            const units: GameUnit[] = [
                makeUnit({ unitType: UnitType.PIKESMAN, x: 50, y: 50, owner: 0, spatialKey: '0,0' }),
                makeUnit({ unitType: UnitType.PIKESMAN, x: 105, y: 50, owner: 1, spatialKey: '0,0' }),
            ];
            const scene = makeScene({ units, stressTestConfig: { unitCount: 500, enableEnemies: true } });
            const system = new LiquidCombatSystem(scene);

            system.precompute();

            expect(system.contactLineCount).toBeGreaterThan(0);
        });

        it('no-ops entirely when disabled', () => {
            const units: GameUnit[] = [
                makeUnit({ unitType: UnitType.PIKESMAN, x: 50, y: 50, owner: 0, spatialKey: '0,0' }),
                makeUnit({ unitType: UnitType.PIKESMAN, x: 105, y: 50, owner: 1, spatialKey: '0,0' }),
            ];
            const system = new LiquidCombatSystem(makeScene({ units }));
            system.enabled = false;

            system.precompute();

            expect(system.pressureCellCount).toBe(0);
            expect(system.contactLineCount).toBe(0);
        });
    });

    describe('lifecycle', () => {
        it('clears state on destroy', () => {
            const units: GameUnit[] = [
                makeUnit({ unitType: UnitType.PIKESMAN, x: 50, y: 50, owner: 0, spatialKey: '0,0' }),
                makeUnit({ unitType: UnitType.PIKESMAN, x: 105, y: 50, owner: 1, spatialKey: '0,0' }),
            ];
            const system = new LiquidCombatSystem(makeScene({ units }));
            system.precompute();
            expect(system.contactLineCount).toBeGreaterThan(0);

            system.destroy();

            expect(system.pressureCellCount).toBe(0);
            expect(system.contactLineCount).toBe(0);
        });
    });
});
