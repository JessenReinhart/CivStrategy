import { describe, expect, it, vi } from 'vitest';
import { handlePlayerTrainingRequest } from './playerTrainingRequest';

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
