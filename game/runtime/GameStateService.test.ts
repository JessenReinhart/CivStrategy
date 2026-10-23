import { describe, it, expect } from 'vitest';
import { GameStateService, type GameStateSnapshot } from './GameStateService';

const initialState: GameStateSnapshot = {
  resources: { wood: 250, food: 300, gold: 150 },
  population: 0,
  maxPopulation: 10,
  happiness: 100,
  taxRate: 0,
  peacefulMode: false,
  treatyLength: 0,
  dominanceProgress: 0,
  playerTerritoryPercent: 0,
};

function makeService(dev = true): GameStateService {
  return new GameStateService(initialState, dev);
}

describe('GameStateService', () => {
  it('guards happiness into [0,100] and marks the key dirty', () => {
    const svc = makeService();
    svc.setHappiness(-5);
    expect(svc.getSnapshot().happiness).toBe(0);
    expect(svc.getDirtyKeys().has('happiness')).toBe(true);
    expect(svc.consumeDirty()).toContain('happiness');
    expect(svc.getDirtyKeys().size).toBe(0);

    svc.setHappiness(140);
    expect(svc.getSnapshot().happiness).toBe(100);
  });

  it('rejects negative population as an invariant in dev', () => {
    const svc = makeService();
    expect(() => svc.setPopulation(-1)).toThrow(/population cannot be negative/);
  });

  it('clamped population floors transient underflow to zero', () => {
    const svc = makeService();
    svc.setPopulationClamped(3);
    expect(svc.getSnapshot().population).toBe(3);
    svc.setPopulationClamped(-1);
    expect(svc.getSnapshot().population).toBe(0);
  });

  it('clamps tax rate to [0,5]', () => {
    const svc = makeService();
    svc.setTaxRate(99);
    expect(svc.getSnapshot().taxRate).toBe(5);
  });

  it('spends resources only when fully affordable', () => {
    const svc = makeService();
    expect(svc.spendResources({ wood: 999 })).toBe(false);
    expect(svc.getSnapshot().resources.wood).toBe(250);

    expect(svc.spendResources({ wood: 100, food: 50 })).toBe(true);
    expect(svc.getSnapshot().resources.wood).toBe(150);
    expect(svc.getSnapshot().resources.food).toBe(250);
  });

  it('addResources rejects negative totals as a dev invariant', () => {
    const svc = makeService();
    expect(() => svc.addResources({ gold: -200 })).toThrow(/cannot go negative/);
  });

  it('subscribe emits immediately and only on actual slice change', () => {
    const svc = makeService();
    let count = 0;
    let seen = svc.getSnapshot().happiness;
    const unsub = svc.subscribe('happiness', (s) => s.happiness, (v) => {
      count++;
      seen = v;
    });

    expect(count).toBe(1);
    svc.setHappiness(100); // already 100 -> no change
    expect(count).toBe(1);

    svc.setHappiness(80);
    expect(count).toBe(2);
    expect(seen).toBe(80);

    unsub();
    svc.setHappiness(60);
    expect(count).toBe(2);
  });

  it('freezes snapshots in dev mode', () => {
    const svc = makeService();
    const snap = svc.getSnapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.resources)).toBe(true);
  });
});