import { describe, expect, it, vi } from 'vitest';
import { BuildingType } from '../types';
import {
  getPlayerTrainingSelectedBuilding,
  handlePlayerTrainingRequest,
} from './playerTrainingRequest';

describe('player training request population gate', () => {
  it('blocks training at the population cap before the training handler can run', () => {
    const onPopulationCap = vi.fn();
    const train = vi.fn();

    const accepted = handlePlayerTrainingRequest({
      population: 8,
      maxPopulation: 8,
      onPopulationCap,
      train,
    });

    expect(accepted).toBe(false);
    expect(onPopulationCap).toHaveBeenCalledOnce();
    expect(train).not.toHaveBeenCalled();
  });

  it('allows training when population capacity is available', () => {
    const onPopulationCap = vi.fn();
    const train = vi.fn();

    const accepted = handlePlayerTrainingRequest({
      population: 7,
      maxPopulation: 8,
      onPopulationCap,
      train,
    });

    expect(accepted).toBe(true);
    expect(onPopulationCap).not.toHaveBeenCalled();
    expect(train).toHaveBeenCalledOnce();
  });

  it('also blocks already-over-cap states so another unit cannot worsen them', () => {
    const train = vi.fn();

    const accepted = handlePlayerTrainingRequest({
      population: 9,
      maxPopulation: 8,
      onPopulationCap: vi.fn(),
      train,
    });

    expect(accepted).toBe(false);
    expect(train).not.toHaveBeenCalled();
  });
});

describe('player training building selection', () => {
  const building = (type: BuildingType, owner: number, active?: boolean) => ({
    ...(active === undefined ? {} : { active }),
    getData: (key: string) => {
      if (key === 'def') return { type };
      if (key === 'owner') return owner;
      return undefined;
    },
  });

  it('keeps a selected player Barracks as the preferred training source', () => {
    const playerBarracks = building(BuildingType.BARRACKS, 0, true);

    expect(getPlayerTrainingSelectedBuilding(playerBarracks)).toBe(playerBarracks);
  });

  it('keeps legacy/test selections without an active flag compatible', () => {
    const playerBarracks = building(BuildingType.BARRACKS, 0);

    expect(getPlayerTrainingSelectedBuilding(playerBarracks)).toBe(playerBarracks);
  });

  it('rejects a destroyed player Barracks so stale combat selection cannot remain a training source', () => {
    const destroyedBarracks = building(BuildingType.BARRACKS, 0, false);

    expect(getPlayerTrainingSelectedBuilding(destroyedBarracks)).toBeNull();
  });

  it('rejects a selected enemy Barracks so training can fall back to a player Barracks', () => {
    const enemyBarracks = building(BuildingType.BARRACKS, 1, true);

    expect(getPlayerTrainingSelectedBuilding(enemyBarracks)).toBeNull();
  });

  it('rejects selected non-Barracks buildings from the training fast path', () => {
    const playerHouse = building(BuildingType.HOUSE, 0, true);

    expect(getPlayerTrainingSelectedBuilding(playerHouse)).toBeNull();
  });
});
