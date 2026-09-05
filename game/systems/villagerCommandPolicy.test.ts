import { describe, expect, it } from 'vitest';

import { getVillagerCarryCommandPolicy } from './villagerCommandPolicy';

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
});
