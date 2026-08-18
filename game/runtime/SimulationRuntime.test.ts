import { describe, expect, it, vi } from 'vitest';
import { SimulationRuntime } from './SimulationRuntime';
import type { SimulationContext } from './SimulationContext';
import type { SimulationServices } from './SimulationServices';

function createServices(shouldUpdate = true): SimulationServices {
  const mark = (name: string) => vi.fn(() => events.push(name));
  const events: string[] = [];

  const services: SimulationServices = {
    spatial: {
      shouldUpdate,
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
    const context = createContext(services);
    context.profile = (label, work) => {
      labels.push(label);
      work();
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
