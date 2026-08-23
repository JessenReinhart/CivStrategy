import { describe, expect, it, vi } from 'vitest';

class Vector2 {
    constructor(public x = 0, public y = 0) {}
}

vi.mock('phaser', () => ({
    default: {
        Math: {
            Vector2,
            Distance: {
                Between: (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay),
            },
            Angle: {
                Between: (ax: number, ay: number, bx: number, by: number) => Math.atan2(by - ay, bx - ax),
            },
        },
    },
}));

vi.mock('../MainScene', () => ({
    MainScene: class {},
}));

import { VillagerSystem } from './VillagerSystem';
import { BuildingType, UnitState, VillagerData } from '../../types';
import { MainScene } from '../MainScene';

function makeBuilding(type: BuildingType, x: number, y: number) {
    const data = new Map<string, unknown>([
        ['def', { type }],
        ['owner', 0],
    ]);
    return {
        x,
        y,
        active: true,
        getData: (key: string) => data.get(key),
        setData: (key: string, value: unknown) => {
            data.set(key, value);
            return value;
        },
    };
}

function makeVillager(x = 0, y = 0): VillagerData {
    return {
        id: 'villager_test',
        x,
        y,
        owner: 0,
        state: UnitState.IDLE,
        path: undefined,
        pathStep: 0,
        carryAmount: 0,
        carryType: null,
        gatherTimer: 0,
    };
}

function makeScene(findPath: ReturnType<typeof vi.fn>): MainScene {
    return {
        pathfinder: { findPath },
        treeSpatialHash: { query: () => [] },
        population: 0,
    } as unknown as MainScene;
}

describe('VillagerSystem worker path handoff', () => {
    it('starts farm work immediately when a one-point path means already arrived', () => {
        const farm = makeBuilding(BuildingType.FARM, 16, 16);
        const villager = makeVillager(10, 10);
        const findPath = vi.fn(() => [new Vector2(farm.x, farm.y)]);
        const system = new VillagerSystem(makeScene(findPath));

        system.assignJob(villager, farm as never);

        expect(villager.state).toBe(UnitState.GATHERING);
        expect(villager.carryType).toBe('food');
        expect(villager.targetResource).toBe(farm);
        expect(villager.jobBuilding).toBe(farm);
        expect(farm.getData('assignedWorker')).toBe(villager);
    });

    it('keeps MOVING_TO_WORK when a real multi-point route exists', () => {
        const farm = makeBuilding(BuildingType.FARM, 160, 160);
        const villager = makeVillager(0, 0);
        const findPath = vi.fn(() => [new Vector2(0, 0), new Vector2(160, 160)]);
        const system = new VillagerSystem(makeScene(findPath));

        system.assignJob(villager, farm as never);

        expect(villager.state).toBe(UnitState.MOVING_TO_WORK);
        expect(villager.path).toHaveLength(2);
        expect(villager.jobBuilding).toBe(farm);
    });

    it('releases an unreachable job instead of leaving the villager deadlocked', () => {
        const farm = makeBuilding(BuildingType.FARM, 500, 500);
        const villager = makeVillager(0, 0);
        // Pathfinder's no-route sentinel is a one-point path at the start.
        const findPath = vi.fn(() => [new Vector2(villager.x, villager.y)]);
        const system = new VillagerSystem(makeScene(findPath));

        system.assignJob(villager, farm as never);

        expect(villager.state).toBe(UnitState.IDLE);
        expect(villager.jobBuilding).toBeUndefined();
        expect(farm.getData('assignedWorker')).toBeUndefined();
    });

    it('does not leave an already-arrived rally move stuck in MOVING_TO_RALLY', () => {
        const villager = makeVillager(20, 20);
        const findPath = vi.fn(() => [new Vector2(20, 20)]);
        const system = new VillagerSystem(makeScene(findPath));

        system.sendToRallyPoint(villager, 20, 20);

        expect(villager.state).toBe(UnitState.IDLE);
        expect(villager.rallyPoint).toBeUndefined();
    });
});
