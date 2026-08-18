import { describe, expect, it, vi } from 'vitest';
import { SimulationRuntime } from './SimulationRuntime';
import { SimulationRuntimeHost } from './SimulationRuntimeHost';
import { createMainSceneSimulationBridge } from './MainSceneSimulationBridge';
import type { SimulationContext } from './SimulationContext';
import type { SimulationServices } from './SimulationServices';
import type { MainScene } from '../MainScene';

function createServices(shouldUpdate = true): SimulationServices {
  const events: string[] = [];
  const mark = (name: string) => vi.fn(() => events.push(name));

  const services: SimulationServices = {
    spatial: {
      get shouldUpdate() {
        return shouldUpdate;
      },
      updateUnitSpatialHash: mark('spatial'),
    },
    villagers: { update: mark('villagers') },
    animals: { update: mark('animals') },
    liquidCombat: { precompute: mark('liquidCombat') },
    units: { update: mark('units') },
    squads: {
      syncPositions: mark('squadSyncPositions'),
      update: mark('squads'),
    },
  };

  return Object.assign(services, { events });
}

function createContext(services: SimulationServices): SimulationContext {
  return {
    services,
    now: 1000,
    dt: 16,
    profile: (_label, work) => work(),
  };
}

describe('SimulationRuntime', () => {
  it('preserves the simulation pipeline ordering', () => {
    const services = createServices(true);
    const events = (services as SimulationServices & { events: string[] }).events;

    new SimulationRuntime().update(createContext(services));

    expect(events).toEqual([
      'spatial',
      'villagers',
      'animals',
      'liquidCombat',
      'units',
      'squadSyncPositions',
      'squads',
    ]);
  });

  it('skips spatial hash work when the adapter disables it', () => {
    const services = createServices(false);
    const events = (services as SimulationServices & { events: string[] }).events;

    new SimulationRuntime().update(createContext(services));

    expect(events).toEqual([
      'villagers',
      'animals',
      'liquidCombat',
      'units',
      'squadSyncPositions',
      'squads',
    ]);
  });

  it('profiles every executed stage', () => {
    const services = createServices(true);
    const labels: string[] = [];
    const context: SimulationContext = {
      ...createContext(services),
      profile: (label: string, work: () => void) => {
        labels.push(label);
        work();
      },
    };

    new SimulationRuntime().update(context);

    expect(labels).toEqual([
      'updateUnitSpatialHash',
      'villagerSystem',
      'animalSystem',
      'liquidCombat',
      'unitSystem',
      'squadSyncPositions',
      'squadSystem',
    ]);
  });
});

describe('SimulationRuntimeHost', () => {
  it('delegates to the runtime with services and profile', () => {
    const services = createServices(true);
    const labels: string[] = [];
    const profile = (label: string, work: () => void) => {
      labels.push(label);
      work();
    };

    const host = new SimulationRuntimeHost(
      new SimulationRuntime(),
      services,
      profile,
    );

    host.update(1000, 16);

    expect(labels).toEqual([
      'updateUnitSpatialHash',
      'villagerSystem',
      'animalSystem',
      'liquidCombat',
      'unitSystem',
      'squadSyncPositions',
      'squadSystem',
    ]);
  });

  it('respects shouldUpdate getter via host services', () => {
    const services = createServices(false);
    const labels: string[] = [];
    const profile = (label: string, work: () => void) => {
      labels.push(label);
      work();
    };

    const host = new SimulationRuntimeHost(
      new SimulationRuntime(),
      services,
      profile,
    );

    host.update(1000, 16);

    expect(labels).toEqual([
      'villagerSystem',
      'animalSystem',
      'liquidCombat',
      'unitSystem',
      'squadSyncPositions',
      'squadSystem',
    ]);
  });
});

describe('createMainSceneSimulationBridge', () => {
  it('assembles host with scene services and profile adapter', () => {
    const labels: string[] = [];
    const mockScene = {
      stressTestConfig: false,
      units: { getLength: () => 100 },
      updateUnitSpatialHash: vi.fn(),
      villagerSystem: { update: vi.fn() },
      animalSystem: { update: vi.fn() },
      liquidCombat: { precompute: vi.fn() },
      unitSystem: { update: vi.fn() },
      squadSystem: {
        syncPositions: vi.fn(),
        update: vi.fn(),
      },
    } as unknown as MainScene;

    const profile = (label: string, work: () => void) => {
      labels.push(label);
      work();
    };

    const host = createMainSceneSimulationBridge(mockScene, profile);

    host.update(1000, 16);

    // Host has correct profile labels
    expect(labels).toEqual([
      'updateUnitSpatialHash',
      'villagerSystem',
      'animalSystem',
      'liquidCombat',
      'unitSystem',
      'squadSyncPositions',
      'squadSystem',
    ]);

    // Scene methods were called via the service adapter
    expect(mockScene.updateUnitSpatialHash).toHaveBeenCalled();
    expect(mockScene.villagerSystem.update).toHaveBeenCalledWith(1000, 16);
    expect(mockScene.animalSystem.update).toHaveBeenCalledWith(1000, 16);
    expect(mockScene.liquidCombat.precompute).toHaveBeenCalled();
    expect(mockScene.unitSystem.update).toHaveBeenCalledWith(1000, 16);
    expect(mockScene.squadSystem.syncPositions).toHaveBeenCalled();
    expect(mockScene.squadSystem.update).toHaveBeenCalledWith(16);
  });

  it('skips spatial hash when scene has many units in stress mode', () => {
    const mockScene = {
      stressTestConfig: true,
      units: { getLength: () => 3000 },
      updateUnitSpatialHash: vi.fn(),
      villagerSystem: { update: vi.fn() },
      animalSystem: { update: vi.fn() },
      liquidCombat: { precompute: vi.fn() },
      unitSystem: { update: vi.fn() },
      squadSystem: {
        syncPositions: vi.fn(),
        update: vi.fn(),
      },
    } as unknown as MainScene;

    const host = createMainSceneSimulationBridge(mockScene, (_l, w) => w());

    host.update(1000, 16);

    expect(mockScene.updateUnitSpatialHash).not.toHaveBeenCalled();
    expect(mockScene.villagerSystem.update).toHaveBeenCalled();
  });
});

describe('SimulationServices capability boundary', () => {
  it('shouldUpdate is a getter evaluated per call', () => {
    let shouldUpdate = true;
    const services: SimulationServices = {
      spatial: {
        get shouldUpdate() {
          return shouldUpdate;
        },
        updateUnitSpatialHash: vi.fn(),
      },
      villagers: { update: vi.fn() },
      animals: { update: vi.fn() },
      liquidCombat: { precompute: vi.fn() },
      units: { update: vi.fn() },
      squads: { syncPositions: vi.fn(), update: vi.fn() },
    };

    // First call with shouldUpdate = true
    const ctx1: SimulationContext = { services, now: 0, dt: 0, profile: (_l, w) => w() };
    new SimulationRuntime().update(ctx1);
    expect(services.spatial.updateUnitSpatialHash).toHaveBeenCalledTimes(1);

    // Mutate flag, second call should see new value
    shouldUpdate = false;
    const ctx2: SimulationContext = { services, now: 0, dt: 0, profile: (_l, w) => w() };
    new SimulationRuntime().update(ctx2);
    expect(services.spatial.updateUnitSpatialHash).toHaveBeenCalledTimes(1);
  });

  it('services interface is readonly and readonly profile', () => {
    const services = createServices(true);
    const ctx: SimulationContext = createContext(services);

    // These should compile — interface enforces readonly
    expect(ctx.services.spatial.shouldUpdate).toBe(true);
    expect(typeof ctx.services.spatial.updateUnitSpatialHash).toBe('function');
    expect(typeof ctx.profile).toBe('function');
    expect(typeof ctx.now).toBe('number');
    expect(typeof ctx.dt).toBe('number');

    // Mutating readonly properties should be compile-time error in TS
    // (Runtime test can't enforce, but interface ensures it)
  });

});
describe('SimulationRuntimeHost — per-frame shouldUpdate flip', () => {
  it('reflects shouldUpdate change between frames without new host', () => {
    let frame = 0;
    const services: SimulationServices = {
      spatial: {
        get shouldUpdate() {
          return frame === 0; // true on frame 0, false on frame 1
        },
        updateUnitSpatialHash: vi.fn(),
      },
      villagers: { update: vi.fn() },
      animals: { update: vi.fn() },
      liquidCombat: { precompute: vi.fn() },
      units: { update: vi.fn() },
      squads: { syncPositions: vi.fn(), update: vi.fn() },
    };

    const profile = (label: string, work: () => void) => work();
    const host = new SimulationRuntimeHost(new SimulationRuntime(), services, profile);

    // Frame 0: shouldUpdate = true
    host.update(1000, 16);
    expect(services.spatial.updateUnitSpatialHash).toHaveBeenCalledTimes(1);

    // Frame 1: shouldUpdate = false (getter re-evaluated)
    frame = 1;
    host.update(1016, 16);
    expect(services.spatial.updateUnitSpatialHash).toHaveBeenCalledTimes(1); // not called again
  });
});

describe('createMainSceneSimulationBridge — preserves ordering and profile labels', () => {
  it('calls scene methods in the exact pipeline order with correct args', () => {
    const callOrder: string[] = [];
    const mockScene = {
      stressTestConfig: false,
      units: { getLength: () => 100 },
      updateUnitSpatialHash: vi.fn(() => callOrder.push('spatial')),
      villagerSystem: { update: (_t: number, _d: number) => callOrder.push('villagers') },
      animalSystem: { update: (_t: number, _d: number) => callOrder.push('animals') },
      liquidCombat: { precompute: () => callOrder.push('liquidCombat') },
      unitSystem: { update: (_t: number, _d: number) => callOrder.push('units') },
      squadSystem: {
        syncPositions: () => callOrder.push('squadSyncPositions'),
        update: (_d: number) => callOrder.push('squads'),
      },
    } as unknown as MainScene;

    const profile = (label: string, work: () => void) => {
      callOrder.push(`profile:${label}`);
      work();
    };

    const host = createMainSceneSimulationBridge(mockScene, profile);
    host.update(1000, 16);

    // Profile wrappers surround each stage in order
    expect(callOrder).toEqual([
      'profile:updateUnitSpatialHash', 'spatial',
      'profile:villagerSystem', 'villagers',
      'profile:animalSystem', 'animals',
      'profile:liquidCombat', 'liquidCombat',
      'profile:unitSystem', 'units',
      'profile:squadSyncPositions', 'squadSyncPositions',
      'profile:squadSystem', 'squads',
    ]);
  });

  it('passes now/dt correctly to scene systems', () => {
    const received: Array<{ sys: string; now: number; dt: number }> = [];
    const mockScene = {
      stressTestConfig: false,
      units: { getLength: () => 100 },
      updateUnitSpatialHash: vi.fn(),
      villagerSystem: { update: (now: number, dt: number) => received.push({ sys: 'villagers', now, dt }) },
      animalSystem: { update: (now: number, dt: number) => received.push({ sys: 'animals', now, dt }) },
      liquidCombat: { precompute: vi.fn() },
      unitSystem: { update: (now: number, dt: number) => received.push({ sys: 'units', now, dt }) },
      squadSystem: {
        syncPositions: vi.fn(),
        update: (dt: number) => received.push({ sys: 'squads', now: 0, dt }),
      },
    } as unknown as MainScene;

    const host = createMainSceneSimulationBridge(mockScene, (_l, w) => w());
    host.update(5000, 33);

    expect(received).toEqual([
      { sys: 'villagers', now: 5000, dt: 33 },
      { sys: 'animals', now: 5000, dt: 33 },
      { sys: 'units', now: 5000, dt: 33 },
      { sys: 'squads', now: 0, dt: 33 },
    ]);
  });
});

describe('createMainSceneSimulationBridge — 2000-unit stress boundary', () => {
  it('runs spatial hash when not in stress mode (always)', () => {
    const mockScene = {
      stressTestConfig: false,
      units: { getLength: () => 99999 },
      updateUnitSpatialHash: vi.fn(),
      villagerSystem: { update: vi.fn() },
      animalSystem: { update: vi.fn() },
      liquidCombat: { precompute: vi.fn() },
      unitSystem: { update: vi.fn() },
      squadSystem: { syncPositions: vi.fn(), update: vi.fn() },
    } as unknown as MainScene;

    const host = createMainSceneSimulationBridge(mockScene, (_l, w) => w());
    host.update(1000, 16);

    expect(mockScene.updateUnitSpatialHash).toHaveBeenCalledTimes(1);
  });

  it('runs spatial hash in stress mode when units < 2000', () => {
    const mockScene = {
      stressTestConfig: true,
      units: { getLength: () => 1999 },
      updateUnitSpatialHash: vi.fn(),
      villagerSystem: { update: vi.fn() },
      animalSystem: { update: vi.fn() },
      liquidCombat: { precompute: vi.fn() },
      unitSystem: { update: vi.fn() },
      squadSystem: { syncPositions: vi.fn(), update: vi.fn() },
    } as unknown as MainScene;

    const host = createMainSceneSimulationBridge(mockScene, (_l, w) => w());
    host.update(1000, 16);

    expect(mockScene.updateUnitSpatialHash).toHaveBeenCalledTimes(1);
  });

  it('skips spatial hash in stress mode when units >= 2000', () => {
    const mockScene = {
      stressTestConfig: true,
      units: { getLength: () => 2000 },
      updateUnitSpatialHash: vi.fn(),
      villagerSystem: { update: vi.fn() },
      animalSystem: { update: vi.fn() },
      liquidCombat: { precompute: vi.fn() },
      unitSystem: { update: vi.fn() },
      squadSystem: { syncPositions: vi.fn(), update: vi.fn() },
    } as unknown as MainScene;

    const host = createMainSceneSimulationBridge(mockScene, (_l, w) => w());
    host.update(1000, 16);

    expect(mockScene.updateUnitSpatialHash).not.toHaveBeenCalled();
    expect(mockScene.villagerSystem.update).toHaveBeenCalled();
  });

  it('skips spatial hash in stress mode at high unit counts', () => {
    const mockScene = {
      stressTestConfig: true,
      units: { getLength: () => 3000 },
      updateUnitSpatialHash: vi.fn(),
      villagerSystem: { update: vi.fn() },
      animalSystem: { update: vi.fn() },
      liquidCombat: { precompute: vi.fn() },
      unitSystem: { update: vi.fn() },
      squadSystem: { syncPositions: vi.fn(), update: vi.fn() },
    } as unknown as MainScene;

    const host = createMainSceneSimulationBridge(mockScene, (_l, w) => w());
    host.update(1000, 16);

    expect(mockScene.updateUnitSpatialHash).not.toHaveBeenCalled();
    expect(mockScene.villagerSystem.update).toHaveBeenCalled();
  });
});
