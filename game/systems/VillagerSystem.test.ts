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

import { facingFromMovement, VillagerSystem } from './VillagerSystem';
import type { VillagerData } from '../../types';
import type { MainScene } from '../MainScene';

const FARM = 'Farm';
const LUMBER_CAMP = 'Lumber Camp';
const TOWN_CENTER = 'Town Center';
const IDLE = 'idle';
const MOVING_TO_WORK = 'moving_to_work';
const MOVING_TO_RALLY = 'moving_to_rally';
const GATHERING = 'gathering';
const CARRYING = 'carrying';

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

function makeGoldMine(x: number, y: number, goldRemaining: number) {
    const mine = makeTree(x, y);
    mine.setData('isGoldMine', true);
    mine.setData('isDepleted', false);
    mine.setData('goldRemaining', goldRemaining);
    return mine;
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
        gameTime: 0,
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

    it('keeps a productive worker assigned when a rally command is unreachable', () => {
        const farm = makeBuilding(FARM, 16, 16);
        const villager = makeVillager(10, 10);
        const findPath = vi.fn()
            .mockReturnValueOnce([{ x: farm.x, y: farm.y }])
            .mockReturnValueOnce([{ x: villager.x, y: villager.y }]);
        const system = new VillagerSystem(makeScene(findPath));

        system.assignJob(villager, farm as never);
        system.sendToRallyPoint(villager, 500, 500);

        expect(villager.state).toBe(GATHERING);
        expect(villager.jobBuilding).toBe(farm);
        expect(villager.targetResource).toBe(farm);
        expect(farm.getData('assignedWorker')).toBe(villager);
    });

    it('releases productive work only after a rally route is accepted', () => {
        const farm = makeBuilding(FARM, 16, 16);
        const villager = makeVillager(10, 10);
        const findPath = vi.fn()
            .mockReturnValueOnce([{ x: farm.x, y: farm.y }])
            .mockReturnValueOnce([{ x: villager.x, y: villager.y }, { x: 500, y: 500 }]);
        const system = new VillagerSystem(makeScene(findPath));

        system.assignJob(villager, farm as never);
        system.sendToRallyPoint(villager, 500, 500);

        expect(villager.state).toBe(MOVING_TO_RALLY);
        expect(villager.path).toHaveLength(2);
        expect(villager.jobBuilding).toBeUndefined();
        expect(farm.getData('assignedWorker')).toBeUndefined();
    });
});

describe('facingFromMovement', () => {
    it('uses four cardinal views based on the dominant travel axis', () => {
        expect(facingFromMovement(10, 1)).toBe('east');
        expect(facingFromMovement(-10, 1)).toBe('west');
        expect(facingFromMovement(1, 10)).toBe('south');
        expect(facingFromMovement(1, -10)).toBe('north');
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

        // This test constructs the villager without spawnVillager() to avoid Phaser
        // rendering dependencies, so register it with the system's update set explicitly.
        (system as unknown as { villagers: VillagerData[] }).villagers.push(villager);
        system.assignJob(villager, camp as never);
        expect(villager.state).toBe(GATHERING);
        expect(villager.carryType).toBe('wood');

        // The opening-economy balance uses a 20-wood load at 2 wood per
        // gather tick. Drive one complete gather -> carry -> deposit cycle.
        for (let i = 0; i < 10; i++) {
            system.update(i * 2500, 2500);
        }

        expect(depositResource).toHaveBeenCalledTimes(1);
        expect(depositResource).toHaveBeenCalledWith(0, 'wood', 20);
        expect(villager.carryAmount).toBe(0);
        expect(villager.state).toBe(GATHERING);
        expect(villager.jobBuilding).toBe(camp);
    });

    it('keeps a full load bound to its dropsite until a blocked return route recovers', () => {
        const camp = makeBuilding(LUMBER_CAMP, 0, 0);
        const tree = makeTree(100, 0);
        const villager = makeVillager(0, 0);
        const depositResource = vi.fn();
        const findPath = vi.fn(() => [{ x: tree.x, y: tree.y }])
            .mockReturnValueOnce([{ x: camp.x, y: camp.y }])
            .mockReturnValueOnce([{ x: tree.x, y: tree.y }])
            .mockImplementationOnce(() => [{ x: villager.x, y: villager.y }])
            .mockReturnValueOnce([{ x: camp.x, y: camp.y }]);
        const system = new VillagerSystem(makeScene(findPath, [tree], depositResource));

        (system as unknown as { villagers: VillagerData[] }).villagers.push(villager);
        system.assignJob(villager, camp as never);
        villager.x = tree.x;
        villager.y = tree.y;
        villager.path = undefined;
        villager.pathStep = 0;
        villager.carryAmount = 18;
        villager.gatherTimer = 0;

        system.update(0, 2500);

        expect(villager.state).toBe(CARRYING);
        expect(villager.carryAmount).toBe(20);
        expect(villager.carryType).toBe('wood');
        expect(villager.jobBuilding).toBe(camp);
        expect(camp.getData('assignedWorker')).toBe(villager);
        expect(system.getIdleVillagers(0)).not.toContain(villager);
        expect(depositResource).not.toHaveBeenCalled();

        system.update(500, 500);

        expect(depositResource).toHaveBeenCalledTimes(1);
        expect(depositResource).toHaveBeenCalledWith(0, 'wood', 20);
        expect(villager.carryAmount).toBe(0);
        expect(villager.jobBuilding).toBe(camp);
        expect(villager.state).toBe(GATHERING);
    });

    it('returns a final partial gold load when the source exhausts before carry capacity', () => {
        const townCenter = makeBuilding(TOWN_CENTER, 0, 0);
        const mine = makeGoldMine(10, 0, 1);
        const villager = makeVillager(0, 0);
        const depositResource = vi.fn();
        const findPath = vi.fn((_start, end) => [{ x: end.x, y: end.y }]);
        const system = new VillagerSystem(makeScene(findPath, [mine], depositResource));

        (system as unknown as { villagers: VillagerData[] }).villagers.push(villager);
        system.assignJob(villager, townCenter as never);
        expect(villager.state).toBe(GATHERING);
        expect(villager.carryType).toBe('gold');

        // Mine's final unit is gathered into a partial load. The following tick
        // observes depletion and must return that already-consumed gold instead
        // of letting abortJob discard it.
        system.update(0, 2500);
        expect(mine.getData('goldRemaining')).toBe(0);
        expect(mine.getData('isDepleted')).toBe(true);
        expect(villager.carryAmount).toBe(1);
        expect(depositResource).not.toHaveBeenCalled();

        system.update(2500, 1);

        expect(depositResource).toHaveBeenCalledTimes(1);
        expect(depositResource).toHaveBeenCalledWith(0, 'gold', 1);
        expect(villager.carryAmount).toBe(0);
        expect(villager.state).toBe(IDLE);

        system.update(2501, 500);
        expect(depositResource).toHaveBeenCalledTimes(1);
    });
});
