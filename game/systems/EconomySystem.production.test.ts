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
import { BuildingType, UnitState } from '../../types';
import type { MainScene } from '../MainScene';
import type { VillagerData } from '../../types';

function makeFarm() {
    const data = new Map<string, unknown>([
        ['owner', 0],
        ['def', { type: BuildingType.FARM, workerNeeds: 1 }],
        ['terrainYield', 1],
    ]);

    return {
        x: 100,
        y: 100,
        active: true,
        visual: { getData: () => undefined },
        getData: (key: string) => data.get(key),
        setData: (key: string, value: unknown) => {
            data.set(key, value);
            return value;
        },
    };
}

describe('EconomySystem resource production regression #29', () => {
    it('makes a staffed farm increase food from the default two-villager start', () => {
        const farm = makeFarm();
        const worker = {
            id: 'farmer',
            x: farm.x,
            y: farm.y,
            owner: 0,
            state: UnitState.GATHERING,
            path: undefined,
            pathStep: 0,
            jobBuilding: farm,
            carryAmount: 0,
            carryType: 'food',
            gatherTimer: 0,
        } as unknown as VillagerData;
        farm.setData('assignedWorker', worker);

        const scene = {
            resources: { wood: 100, food: 100, gold: 100 },
            population: 2,
            maxPopulation: 10,
            happiness: 100,
            taxRate: 0,
            faction: 'Romans',
            enemyFaction: 'Gauls',
            buildings: { getChildren: () => [farm] },
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
            currentAge: undefined,
            ageProgress: undefined,
            nextAge: undefined,
            currentSeason: undefined,
            gameResult: undefined,
            dominanceProgress: undefined,
            playerTerritoryPercent: undefined,
            victoryType: undefined,
            mapSeed: 'test',
            bloomIntensity: 1,
            inputManager: undefined,
            game: { events: { emit: vi.fn() } },
        } as unknown as MainScene;

        const economy = new EconomySystem(scene);
        economy.tickEconomy();

        // User-facing requirement from #29: once a Farm is staffed and working,
        // the visible food total must actually rise over time. This is deliberately
        // a regression assertion rather than an implementation-detail assertion.
        expect(scene.resources.food).toBeGreaterThan(100);
    });
});


describe('happiness recovery after an economy crisis', () => {
    function makeScene() {
        return {
            resources: { wood: 0, food: 1000, gold: 0 },
            population: 2, maxPopulation: 10, happiness: 30, taxRate: 0,
            buildings: { getChildren: () => [] },
            feedbackSystem: { notifyHappinessCritical: vi.fn() },
            gameTime: 0,
        } as unknown as MainScene;
    }

    it('recovers enough happiness to resume population growth after food and housing are restored', () => {
        const scene = makeScene();
        const economy = new EconomySystem(scene);
        vi.spyOn(economy, 'updateStats').mockImplementation(() => {});
        for (let tick = 0; tick < 20; tick++) economy.tickEconomy();
        expect(scene.happiness).toBe(50);
        for (let tick = 0; tick < 100; tick++) economy.tickEconomy();
        expect(scene.happiness).toBe(100);
    });

    it.each(['food', 'housing', 'tax'] as const)('does not recover while %s pressure remains', (pressure) => {
        const scene = makeScene();
        if (pressure === 'food') scene.resources.food = 0;
        if (pressure === 'housing') scene.maxPopulation = 2;
        if (pressure === 'tax') scene.taxRate = 2;
        const economy = new EconomySystem(scene);
        vi.spyOn(economy, 'updateStats').mockImplementation(() => {});
        economy.tickEconomy();
        expect(scene.happiness).toBeLessThan(30);
    });

    it('keeps 20% tax stable without granting the zero-tax recovery bonus', () => {
        const scene = makeScene();
        scene.taxRate = 1;
        const economy = new EconomySystem(scene);
        vi.spyOn(economy, 'updateStats').mockImplementation(() => {});
        economy.tickEconomy();
        expect(scene.happiness).toBe(30);
    });
});
