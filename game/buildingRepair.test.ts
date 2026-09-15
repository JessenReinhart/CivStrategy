import { describe, expect, it } from 'vitest';
import { computeRepairTick, REPAIR_DURATION_MS } from './buildingRepair';

const COST = { wood: 100, food: 0, gold: 50 };

describe('computeRepairTick', () => {
    it('is a no-op once the building is already at full HP', () => {
        const result = computeRepairTick({
            hp: 200, maxHp: 200, cost: COST,
            resources: { wood: 1000, food: 1000, gold: 1000 },
            deltaMs: 1000,
        });

        expect(result.hpDelta).toBe(0);
        expect(result.complete).toBe(true);
        expect(result.resourceStarved).toBe(false);
    });

    it('restores HP proportional to elapsed time when resources are plentiful', () => {
        const result = computeRepairTick({
            hp: 0, maxHp: 200, cost: COST,
            resources: { wood: 1000, food: 1000, gold: 1000 },
            deltaMs: REPAIR_DURATION_MS / 2,
        });

        // Half the repair duration elapsed -> half the missing HP restored.
        expect(result.hpDelta).toBeCloseTo(100, 5);
        expect(result.resourceDelta.wood).toBeCloseTo(50, 5);
        expect(result.resourceDelta.gold).toBeCloseTo(25, 5);
        expect(result.complete).toBe(false);
        expect(result.resourceStarved).toBe(false);
    });

    it('never restores more HP than is missing, even with a huge deltaMs', () => {
        const result = computeRepairTick({
            hp: 180, maxHp: 200, cost: COST,
            resources: { wood: 1000, food: 1000, gold: 1000 },
            deltaMs: REPAIR_DURATION_MS * 10,
        });

        expect(result.hpDelta).toBeCloseTo(20, 5);
        expect(result.complete).toBe(true);
    });

    it('scales progress down (not to zero) when only one resource is short', () => {
        const result = computeRepairTick({
            hp: 0, maxHp: 200, cost: COST,
            // Full repair would need 100 wood; only 25 available -> 25% progress.
            resources: { wood: 25, food: 1000, gold: 1000 },
            deltaMs: REPAIR_DURATION_MS,
        });

        expect(result.hpDelta).toBeCloseTo(50, 5); // 25% of the missing 200 HP
        expect(result.resourceDelta.wood).toBeCloseTo(25, 5);
        expect(result.resourceStarved).toBe(true);
        expect(result.complete).toBe(false);
    });

    it('makes no progress and does not throw when a required resource is fully exhausted', () => {
        const result = computeRepairTick({
            hp: 0, maxHp: 200, cost: COST,
            resources: { wood: 0, food: 0, gold: 1000 },
            deltaMs: REPAIR_DURATION_MS,
        });

        expect(result.hpDelta).toBe(0);
        expect(result.resourceDelta.wood).toBe(0);
        expect(result.resourceStarved).toBe(true);
        expect(result.complete).toBe(false);
    });

    it('never deducts resources when the building has a zero-cost definition', () => {
        const result = computeRepairTick({
            hp: 0, maxHp: 200, cost: { wood: 0, food: 0, gold: 0 },
            resources: { wood: 0, food: 0, gold: 0 },
            deltaMs: REPAIR_DURATION_MS,
        });

        expect(result.hpDelta).toBeCloseTo(200, 5);
        expect(result.resourceStarved).toBe(false);
        expect(result.complete).toBe(true);
    });
});
