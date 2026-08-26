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
                Between: (min: number) => min,
                Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
            },
        },
    };
});

vi.mock('../MainScene', () => ({
    MainScene: class {},
}));

import { EconomySystem } from './EconomySystem';
import { VillagerSystem } from './VillagerSystem';
import { BUILDINGS, INITIAL_RESOURCES } from '../../constants';
import { BuildingType, UnitState } from '../../types';
import type { GameStats, VillagerData } from '../../types';
import type { MainScene } from '../MainScene';

function makeDataObject(x: number, y: number, initialData: Record<string, unknown>) {
    const data = new Map<string, unknown>(Object.entries(initialData));
    return {
        x,
        y,
        active: true,
        scene: {},
        visual: { getData: () => undefined },
        getData: (key: string) => data.get(key),
        setData: (key: string, value: unknown) => {
            data.set(key, value);
            return value;
        },
    };
}

function makeVillager(id: string, x: number, y = 0): VillagerData {
    return {
        id,
        x,
        y,
        owner: 0,
        state: UnitState.IDLE,
        path: undefined,
        pathStep: 0,
        carryAmount: 0,
        carryType: null,
        gatherTimer: 0,
    } as VillagerData;
}

function makeEconomyScene(buildings: ReturnType<typeof makeDataObject>[], population: number) {
    let latestStats: GameStats | undefined;
    const scene = {
        resources: { wood: 100, food: 100, gold: 100 },
        population,
        maxPopulation: 20,
        happiness: 100,
        taxRate: 0,
        faction: 'Romans',
        enemyFaction: 'Gauls',
        buildings: { getChildren: () => buildings },
        researchManager: undefined,
        animalSystem: { getAnimals: () => [] },
        treeSpatialHash: { query: () => [] },
        feedbackSystem: {
            showFloatingResource: vi.fn(),
            notifyHappinessCritical: vi.fn(),
            notifyEnemyApproaching: vi.fn(),
            getNotifications: () => [],
        },
        peacefulMode: false,
        gameTime: 0,
        treatyLength: 0,
        unitSystem: { currentFormation: undefined, currentStance: undefined },
        units: { getChildren: () => [] },
        currentAge: undefined,
        ageProgress: 0,
        nextAge: null,
        currentSeason: undefined,
        gameResult: undefined,
        dominanceProgress: 0,
        playerTerritoryPercent: 0,
        victoryType: undefined,
        mapSeed: 1,
        bloomIntensity: 1,
        inputManager: undefined,
        game: {
            events: {
                emit: vi.fn((_event: string, stats: GameStats) => {
                    latestStats = stats;
                }),
            },
        },
    } as unknown as MainScene;

    return { scene, getLatestStats: () => latestStats };
}

describe('resource accounting invariants', () => {
    it('reports a HUD food net that matches the actual food delta for the tick', () => {
        const farm = makeDataObject(100, 100, {
            owner: 0,
            def: { type: BuildingType.FARM, workerNeeds: 1 },
            terrainYield: 1,
        });
        const worker = makeVillager('farmer', 100, 100);
        worker.state = UnitState.GATHERING;
        worker.carryType = 'food';
        worker.jobBuilding = farm as never;
        farm.setData('assignedWorker', worker);

        const { scene, getLatestStats } = makeEconomyScene([farm], 2);
        const economy = new EconomySystem(scene);
        const before = scene.resources.food;

        economy.tickEconomy();

        const stats = getLatestStats();
        expect(stats).toBeDefined();
        const actualDelta = scene.resources.food - before;
        const hudNet = stats!.rates.food - stats!.rates.foodConsumption;

        // GameUI derives the displayed food production number this way. It must
        // describe the same resource delta the simulation actually applied.
        expect(hudNet).toBe(actualDelta);
    });

    it('lets one staffed baseline farm sustain a modest four-villager village', () => {
        const farm = makeDataObject(100, 100, {
            owner: 0,
            def: { type: BuildingType.FARM, workerNeeds: 1 },
            terrainYield: 1,
        });
        const worker = makeVillager('farmer', 100, 100);
        worker.state = UnitState.GATHERING;
        worker.carryType = 'food';
        worker.jobBuilding = farm as never;
        farm.setData('assignedWorker', worker);

        const { scene, getLatestStats } = makeEconomyScene([farm], 4);
        const economy = new EconomySystem(scene);
        const before = scene.resources.food;

        economy.tickEconomy();

        const stats = getLatestStats();
        expect(stats).toBeDefined();
        expect(scene.resources.food).toBeGreaterThan(before);
        expect(stats!.rates.food - stats!.rates.foodConsumption).toBeGreaterThan(0);
    });
});

describe('lumber camp real-time production loop', () => {
    it('turns a nearby tree into a visible wood increase through assignment, travel, gather, return, and deposit', () => {
        const camp = makeDataObject(128, 128, {
            owner: 0,
            def: { type: BuildingType.LUMBER_CAMP, workerNeeds: 1, effectRadius: 200 },
            assignedWorker: undefined,
        });
        const tree = makeDataObject(224, 128, {
            isChopped: false,
            isGoldMine: false,
        });
        const villager = makeVillager('woodcutter', 64, 128);

        // A realistic multi-step path instead of the previous one-point
        // "already arrived" mock. Waypoints begin at the current position and
        // end at the requested target, so VillagerSystem must actually move.
        const findPath = vi.fn((start: { x: number; y: number }, end: { x: number; y: number }) => [
            { x: start.x, y: start.y },
            { x: end.x, y: end.y },
        ]);

        const resources = { wood: 100, food: 100, gold: 100 };
        const scene = {
            resources,
            population: 1,
            pathfinder: { findPath },
            treeSpatialHash: { query: () => [tree] },
            buildings: { getChildren: () => [camp] },
            researchManager: undefined,
            faction: 'Romans',
            enemyFaction: 'Gauls',
            feedbackSystem: { showFloatingResource: vi.fn() },
            proceduralSound: { playResourceGather: vi.fn() },
            add: { rectangle: vi.fn() },
        } as unknown as MainScene;

        const villagerSystem = new VillagerSystem(scene);
        (villagerSystem as unknown as { villagers: VillagerData[] }).villagers.push(villager);
        scene.villagerSystem = villagerSystem;
        const economy = new EconomySystem(scene);
        scene.economySystem = economy;

        economy.assignJobs();
        expect(villager.jobBuilding).toBe(camp);

        const before = resources.wood;
        let elapsed = 0;
        // 35 seconds at ~60 FPS. A wood carry needs 20 seconds of gathering
        // plus outbound/return travel, so this is deliberately long enough to
        // prove the player-visible resource count changes.
        while (elapsed < 35_000 && resources.wood === before) {
            villagerSystem.update(elapsed, 16);
            elapsed += 16;
        }

        expect(resources.wood).toBeGreaterThan(before);
        expect(elapsed).toBeLessThan(35_000);
        expect(villager.jobBuilding).toBe(camp);
        expect(findPath).toHaveBeenCalled();
    });

    it('keeps the opening build order progressing after paying for the wood economy', () => {
        const camp = makeDataObject(128, 128, {
            owner: 0,
            def: { type: BuildingType.LUMBER_CAMP, workerNeeds: 1, effectRadius: 200 },
            assignedWorker: undefined,
        });
        const tree = makeDataObject(224, 128, {
            isChopped: false,
            isGoldMine: false,
        });
        const villager = makeVillager('opening-woodcutter', 64, 128);
        const findPath = vi.fn((start: { x: number; y: number }, end: { x: number; y: number }) => [
            { x: start.x, y: start.y },
            { x: end.x, y: end.y },
        ]);

        const resources = { ...INITIAL_RESOURCES };
        const built: BuildingType[] = [];
        const spendBuilding = (type: BuildingType) => {
            const cost = BUILDINGS[type].cost;
            if (resources.wood < cost.wood || resources.food < cost.food || resources.gold < cost.gold) return false;
            resources.wood -= cost.wood;
            resources.food -= cost.food;
            resources.gold -= cost.gold;
            built.push(type);
            return true;
        };

        expect(spendBuilding(BuildingType.LUMBER_CAMP)).toBe(true);
        const woodAfterCamp = resources.wood;
        expect(spendBuilding(BuildingType.HOUSE)).toBe(true);
        expect(spendBuilding(BuildingType.FARM)).toBe(true);
        expect(spendBuilding(BuildingType.BARRACKS)).toBe(false);
        const woodBeforeGathering = resources.wood;

        const scene = {
            resources,
            population: 1,
            pathfinder: { findPath },
            treeSpatialHash: { query: () => [tree] },
            buildings: { getChildren: () => [camp] },
            researchManager: undefined,
            faction: 'Romans',
            enemyFaction: 'Gauls',
            feedbackSystem: { showFloatingResource: vi.fn() },
            proceduralSound: { playResourceGather: vi.fn() },
            add: { rectangle: vi.fn() },
        } as unknown as MainScene;

        const villagerSystem = new VillagerSystem(scene);
        (villagerSystem as unknown as { villagers: VillagerData[] }).villagers.push(villager);
        scene.villagerSystem = villagerSystem;
        const economy = new EconomySystem(scene);
        scene.economySystem = economy;

        economy.assignJobs();
        expect(villager.jobBuilding).toBe(camp);

        let elapsed = 0;
        while (elapsed < 180_000 && !spendBuilding(BuildingType.BARRACKS)) {
            villagerSystem.update(elapsed, 16);
            elapsed += 16;
        }

        const gatheredWood = resources.wood + BUILDINGS[BuildingType.BARRACKS].cost.wood - woodBeforeGathering;
        expect(built).toEqual([
            BuildingType.LUMBER_CAMP,
            BuildingType.HOUSE,
            BuildingType.FARM,
            BuildingType.BARRACKS,
        ]);
        expect(gatheredWood).toBeGreaterThan(0);
        expect(elapsed).toBeGreaterThan(0);
        expect(elapsed).toBeLessThan(180_000);
        expect(resources.wood).toBeGreaterThanOrEqual(0);
        expect(resources.food).toBeGreaterThanOrEqual(0);
        expect(resources.gold).toBeGreaterThanOrEqual(0);
        expect(woodAfterCamp).toBe(INITIAL_RESOURCES.wood - BUILDINGS[BuildingType.LUMBER_CAMP].cost.wood);
        expect(findPath).toHaveBeenCalled();
    });
});
