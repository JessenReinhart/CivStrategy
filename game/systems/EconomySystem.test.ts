import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
    default: {
        Math: {
            Distance: {
                Between: (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay),
            },
            Between: (min: number) => min,
            Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
        },
    },
}));

vi.mock('../MainScene', () => ({
    MainScene: class {},
}));

import { EconomySystem } from './EconomySystem';
import type { VillagerData } from '../../types';
import type { MainScene } from '../MainScene';

const TOWN_CENTER = 'Town Center';
const FARM = 'Farm';
const IDLE = 'idle';
const MOVING_TO_WORK = 'moving_to_work';

function makeDataObject(x: number, y: number, initialData: Record<string, unknown>) {
    const data = new Map<string, unknown>(Object.entries(initialData));
    return {
        x,
        y,
        active: true,
        scene: {},
        getData: (key: string) => data.get(key),
        setData: (key: string, value: unknown) => {
            data.set(key, value);
            return value;
        },
    };
}

function makeVillager(id: string, x: number): VillagerData {
    return {
        id,
        x,
        y: 0,
        owner: 0,
        state: IDLE as VillagerData['state'],
        path: undefined,
        pathStep: 0,
        carryAmount: 0,
        carryType: null,
        gatherTimer: 0,
    };
}

function makeAssignmentScene(villagers: VillagerData[], extraBuildings: ReturnType<typeof makeDataObject>[] = []) {
    const tc = makeDataObject(0, 0, {
        owner: 0,
        hp: 100,
        def: { type: TOWN_CENTER },
    });
    const mine = makeDataObject(40, 0, {
        isGoldMine: true,
        isDepleted: false,
    });
    const buildings = [tc, ...extraBuildings];

    const assignJob = vi.fn((villager: VillagerData, building: ReturnType<typeof makeDataObject>) => {
        villager.state = MOVING_TO_WORK as VillagerData['state'];
        villager.jobBuilding = building as never;
        building.setData('assignedWorker', villager);
    });

    const scene = {
        buildings: { getChildren: () => buildings },
        treeSpatialHash: { query: () => [mine] },
        villagerSystem: {
            getIdleVillagers: (owner: number) => villagers.filter(v =>
                v.owner === owner && (v.state === IDLE || v.state === 'moving_to_rally')
            ),
            getAllVillagers: () => villagers,
            assignJob,
            sendToRallyPoint: vi.fn(),
        },
    } as unknown as MainScene;

    return { scene, assignJob, mine };
}

describe('EconomySystem worker assignment', () => {
    it('keeps the two starting villagers available instead of auto-assigning both to gold', () => {
        const villagers = [makeVillager('a', 0), makeVillager('b', 10)];
        const { scene, assignJob } = makeAssignmentScene(villagers);
        const economy = new EconomySystem(scene);

        economy.assignJobs();

        expect(assignJob).not.toHaveBeenCalled();
        expect(villagers.every(v => v.state === IDLE)).toBe(true);
    });

    it('uses only surplus idle labor for automatic gold mining', () => {
        const villagers = [makeVillager('a', 0), makeVillager('b', 10), makeVillager('c', 20)];
        const { scene, assignJob, mine } = makeAssignmentScene(villagers);
        const economy = new EconomySystem(scene);

        economy.assignJobs();

        expect(assignJob).toHaveBeenCalledTimes(1);
        expect(assignJob.mock.calls[0][1]).toBe(mine);
        expect(villagers.filter(v => v.state === IDLE)).toHaveLength(2);
    });

    it('prioritizes a newly-built player farm before opportunistic gold work', () => {
        const villagers = [makeVillager('a', 0), makeVillager('b', 10)];
        const farm = makeDataObject(30, 0, {
            owner: 0,
            hp: 100,
            def: { type: FARM, workerNeeds: 1 },
            assignedWorker: undefined,
        });
        const { scene, assignJob } = makeAssignmentScene(villagers, [farm]);
        const economy = new EconomySystem(scene);

        economy.assignJobs();

        expect(assignJob).toHaveBeenCalledTimes(1);
        expect(assignJob.mock.calls[0][1]).toBe(farm);
        expect(farm.getData('assignedWorker')).toBeTruthy();
    });

    it('does not assign player-economy workers to AI resource buildings', () => {
        const villagers = [makeVillager('a', 0), makeVillager('b', 10)];
        const aiFarm = makeDataObject(30, 0, {
            owner: 1,
            hp: 100,
            def: { type: FARM, workerNeeds: 1 },
            assignedWorker: undefined,
        });
        const { scene, assignJob } = makeAssignmentScene(villagers, [aiFarm]);
        const economy = new EconomySystem(scene);

        economy.assignJobs();

        expect(assignJob).not.toHaveBeenCalled();
        expect(aiFarm.getData('assignedWorker')).toBeUndefined();
    });
});

describe('EconomySystem resource ownership', () => {
    it('credits AI carry deposits to the AI pool, never the player pool', () => {
        const scene = {
            resources: { wood: 100, food: 100, gold: 100 },
            enemyAI: { resources: { wood: 50, food: 50, gold: 50 } },
            researchManager: undefined,
            faction: 'Romans',
            enemyFaction: 'Gauls',
        } as unknown as MainScene;
        const economy = new EconomySystem(scene);

        economy.depositResource(1, 'wood', 8);

        expect(scene.resources.wood).toBe(100);
        expect(scene.enemyAI.resources.wood).toBe(58);
    });
});
