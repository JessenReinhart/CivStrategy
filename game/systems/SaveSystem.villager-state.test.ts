import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { UnitState } from '../../types';
import { normalizeVillagerStateForSaveLoad } from './SaveSystem';

describe('normalizeVillagerStateForSaveLoad', () => {
  it.each([
    UnitState.MOVING_TO_WORK,
    UnitState.WORKING,
    UnitState.GATHERING,
    UnitState.CARRYING,
    UnitState.MOVING_TO_RALLY,
  ])('restarts transient villager state %s as IDLE', (state) => {
    expect(normalizeVillagerStateForSaveLoad(state)).toBe(UnitState.IDLE);
  });

  it.each([
    UnitState.IDLE,
    UnitState.WANDERING,
    UnitState.CHASING,
    UnitState.ATTACKING,
  ])('preserves state %s when it does not depend on the villager work pipeline', (state) => {
    expect(normalizeVillagerStateForSaveLoad(state)).toBe(state);
  });
});
