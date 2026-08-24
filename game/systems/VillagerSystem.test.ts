import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
    class MockVector2 {
        constructor(public x = 0, public y = 0) {}
    }

    return {
        default: {
            Math: {
                Vector2: MockVector2,
                Distance: {
                    Between: (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay),
                },
                Angle: {
                    Between: (ax: number, ay: number, bx: number, by: number) => Math.atan2(by - ay, bx - ax),
                },
            },
        },
    };
});

vi.mock('../MainScene', () => ({
    MainScene: class {},
}));

import { VillagerSystem } from './VillagerSystem';
import type { VillagerData } from '../../types';
import type { MainScene } from '../MainScene';

const FARM = 'Farm';
const LUMBER_CAMP = 'Lumber Camp';
const IDLE = 'idle';
const MOVING_TO_WORK = 'moving_to_work';
const GATHERING = 'gathering';

function makeBuilding(type: string, x: number, y: number) {
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

function makeTree(x: number, y: number) {
    const data = new Map<string, unknown>([
        ['isChopped', false],
        ['isGoldMine', false],
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
        state: IDLE as VillagerData['state'],
        path: undefined,
        pathStep: 0,
        carryAmount: 0,
        carryType: null,
        gatherTimer: 0,
    };
}

function makeScene(
    findPath: ReturnType<typeof vi.fn>,
    trees: ReturnType<typeof makeTree>[] = [],
    depositResource: ReturnType<typeof vi.fn> = vi.fn(),
): MainScene {
    return {
        pathfinder: { findPath },
        treeSpatialHash: { query: () => trees },
        population: 0,
        economySystem: { depositResource },
        proceduralSound: { playResourceGather: vi.fn() },
    } as unknown as MainScene;
}

describe('VillagerSystem worker path handoff', () => {
    it('starts farm work immediately when a one-point path means already arrived', () => {
        const farm = makeBuilding(FARM, 16, 16);
        const villager = makeVillager(10, 10);
        const findPath = vi.fn(() => [{ x: farm.x, y: farm.y }]);
        const system = new VillagerSystem(makeScene(findPath));

        system.assignJob(villager, farm as never);

        expect(villager.state).toBe(GATHERING);
        expect(villager.carryType).toBe('food');
        expect(villager.targetResource).toBe(farm);
        expect(villager.jobBuilding).toBe(farm);
        expect(farm.getData('assignedWorker')).toBe(villager);
    });

    it('keeps MOVING_TO_WORK when a real multi-point route exists', () => {
        const farm = makeBuilding(FARM, 160, 160);
        const villager = makeVillager(0, 0);
        const findPath = vi.fn(() => [{ x: 0, y: 0 }, { x: 160, y: 160 }]);
        const system = new VillagerSystem(makeScene(findPath));

        system.assignJob(villager, farm as never);

        expect(villager.state).toBe(MOVING_TO_WORK);
        expect(villager.path).toHaveLength(2);
        expect(villager.jobBuilding).toBe(farm);
    });

    it('releases an unreachable job instead of leaving the villager deadlocked', () => {
        const farm = makeBuilding(FARM, 500, 500);
        const villager = makeVillager(0, 0);
        // Pathfinder's no-route sentinel is a one-point path at the start.
        const findPath = vi.fn(() => [{ x: villager.x, y: villager.y }]);
        const system = new VillagerSystem(makeScene(findPath));

        system.assignJob(villager, farm as never);

        expect(villager.state).toBe(IDLE);
        expect(villager.jobBuilding).toBeUndefined();
        expect(farm.getData('assignedWorker')).toBeUndefined();
    });

    it('does not leave an already-arrived rally move stuck in MOVING_TO_RALLY', () => {
        const villager = makeVillager(20, 20);
        const findPath = vi.fn(() => [{ x: 20, y: 20 }]);
        const system = new VillagerSystem(makeScene(findPath));

        system.sendToRallyPoint(villager, 20, 20);

        expect(villager.state).toBe(IDLE);
        expect(villager.rallyPoint).toBeUndefined();
    });
});

describe('VillagerSystem resource production', () => {
    it('deposits a full lumber carry into the player resource pipeline', () => {
        const camp = makeBuilding(LUMBER_CAMP, 0, 0);
        const tree = makeTree(10, 0);
        const villager = makeVillager(0, 0);
        const depositResource = vi.fn();
        const findPath = vi.fn((_start, end) => [{ x: end.x, y: end.y }]);
        const system = new VillagerSystem(makeScene(findPath, [tree], depositResource));

        system.assignJob(villager, camp as never);
        expect(villager.state).toBe(GATHERING);
        expect(villager.carryType).toBe('wood');

        // Wood capacity is 8 and gathering produces one unit per 2500 ms.
        // Drive the complete gather -> carry -> deposit cycle rather than only
        // asserting that the worker entered the correct state.
        for (let i = 0; i < 8; i++) {
            system.update(i * 2500, 2500);
        }

        expect(depositResource).toHaveBeenCalledTimes(1);
        expect(depositResource).toHaveBeenCalledWith(0, 'wood', 8);
        expect(villager.carryAmount).toBe(0);
        expect(villager.state).toBe(GATHERING);
        expect(villager.jobBuilding).toBe(camp);
    });
});
