import { describe, expect, it } from 'vitest';

import {
  canBuildingAcceptResource,
  findOptimalDropsite,
  formatVillagerCarryBadge,
  getVillagerCarryCommandPolicy,
  type DropsiteCandidate,
} from './villagerCommandPolicy';

describe('villager carried-resource command policy', () => {
  const currentDropsite = {};
  const anotherBuilding = {};

  it('allows normal commands when the villager has no pending load', () => {
    expect(getVillagerCarryCommandPolicy({
      carryAmount: 0,
      carryType: null,
      jobBuilding: currentDropsite,
    }, anotherBuilding)).toBe('allow');
  });

  it('keeps the current deposit trip when the current dropsite is clicked again', () => {
    expect(getVillagerCarryCommandPolicy({
      carryAmount: 5,
      carryType: 'gold',
      jobBuilding: currentDropsite,
    }, currentDropsite)).toBe('keep-current');
  });

  it('defers a different job or ground rally until the carried load is deposited', () => {
    const villager = {
      carryAmount: 5,
      carryType: 'gold',
      jobBuilding: currentDropsite,
    };

    expect(getVillagerCarryCommandPolicy(villager, anotherBuilding)).toBe('defer');
    expect(getVillagerCarryCommandPolicy(villager, null)).toBe('defer');
  });

  it('matches valid dropsite buildings per resource category', () => {
    expect(canBuildingAcceptResource('Town Center', 'gold')).toBe(true);
    expect(canBuildingAcceptResource('Town Center', 'wood')).toBe(true);
    expect(canBuildingAcceptResource('Lumber Camp', 'wood')).toBe(true);
    expect(canBuildingAcceptResource('Lumber Camp', 'food')).toBe(false);
    expect(canBuildingAcceptResource("Hunter's Lodge", 'food')).toBe(true);
    expect(canBuildingAcceptResource('Quarry', 'stone')).toBe(true);
  });

  it('selects the nearest living dropsite that accepts the carried resource', () => {
    const candidates: DropsiteCandidate[] = [
      { id: 'tc-1', type: 'Town Center', x: 500, y: 500, hp: 1200 },
      { id: 'lc-destroyed', type: 'Lumber Camp', x: 110, y: 110, hp: 0 },
      { id: 'lc-near', type: 'Lumber Camp', x: 180, y: 160, hp: 400 },
      { id: 'hl-near', type: "Hunter's Lodge", x: 120, y: 120, hp: 400 },
    ];

    const bestWood = findOptimalDropsite(100, 100, 'wood', candidates);
    expect(bestWood?.id).toBe('lc-near');

    const bestGold = findOptimalDropsite(100, 100, 'gold', candidates);
    expect(bestGold?.id).toBe('tc-1');
  });

  it('formats carried resource badges cleanly and returns null when empty', () => {
    expect(formatVillagerCarryBadge('wood', 10)).toBe('+10 WOOD');
    expect(formatVillagerCarryBadge('gold', 0)).toBeNull();
    expect(formatVillagerCarryBadge(null, 8)).toBeNull();
  });
});
