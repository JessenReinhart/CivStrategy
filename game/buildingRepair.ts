import type { BuildingCost } from '../types';

/** Time in ms to fully repair a building from 0 HP to max HP, resources permitting. */
export const REPAIR_DURATION_MS = 10_000;

export interface RepairResources {
    wood: number;
    food: number;
    gold: number;
}

export interface RepairTickInput {
    hp: number;
    maxHp: number;
    cost: BuildingCost;
    resources: RepairResources;
    /** Elapsed simulation time since the last repair tick, in ms. */
    deltaMs: number;
    /** Time to fully repair from 0 to maxHp, resources permitting. */
    durationMs?: number;
}

export interface RepairTickResult {
    /** HP to add to the building this tick (already resource-capped). */
    hpDelta: number;
    /** Resources to deduct this tick (already resource-capped). */
    resourceDelta: RepairResources;
    /** True once hp + hpDelta reaches maxHp. */
    complete: boolean;
    /** True when progress this tick was limited by available resources. */
    resourceStarved: boolean;
}

const RESOURCE_KEYS: (keyof RepairResources)[] = ['wood', 'food', 'gold'];

/**
 * Repairing a building from 0 HP to full costs its full build cost, spread
 * linearly over REPAIR_DURATION_MS (mirrors classic RTS repair economics: you
 * pay a fraction of the build cost proportional to the HP restored). Resource
 * shortfalls scale down the tick's progress rather than reverting it, so a
 * partially-affordable tick still makes partial progress instead of stalling
 * completely at a resource boundary.
 */
export function computeRepairTick(input: RepairTickInput): RepairTickResult {
    const durationMs = input.durationMs ?? REPAIR_DURATION_MS;
    const missingHp = Math.max(0, input.maxHp - input.hp);

    if (missingHp <= 0 || input.deltaMs <= 0 || durationMs <= 0) {
        return {
            hpDelta: 0,
            resourceDelta: { wood: 0, food: 0, gold: 0 },
            complete: missingHp <= 0,
            resourceStarved: false,
        };
    }

    const desiredHpDelta = Math.min(missingHp, input.maxHp * (input.deltaMs / durationMs));
    const costPerHp: RepairResources = {
        wood: input.cost.wood / input.maxHp,
        food: input.cost.food / input.maxHp,
        gold: input.cost.gold / input.maxHp,
    };
    const desiredCost: RepairResources = {
        wood: costPerHp.wood * desiredHpDelta,
        food: costPerHp.food * desiredHpDelta,
        gold: costPerHp.gold * desiredHpDelta,
    };

    let affordableFactor = 1;
    for (const key of RESOURCE_KEYS) {
        if (desiredCost[key] > 0) {
            affordableFactor = Math.min(affordableFactor, Math.max(0, input.resources[key]) / desiredCost[key]);
        }
    }
    affordableFactor = Math.max(0, Math.min(1, affordableFactor));

    const hpDelta = desiredHpDelta * affordableFactor;
    const resourceDelta: RepairResources = {
        wood: desiredCost.wood * affordableFactor,
        food: desiredCost.food * affordableFactor,
        gold: desiredCost.gold * affordableFactor,
    };

    return {
        hpDelta,
        resourceDelta,
        complete: input.hp + hpDelta >= input.maxHp,
        resourceStarved: affordableFactor < 1,
    };
}
