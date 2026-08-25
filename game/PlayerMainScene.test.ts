import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnitType } from '../types';
import { MainScene } from './MainScene';
import { PlayerMainScene } from './PlayerMainScene';

function createTrainingScene(population: number, maxPopulation: number) {
  const scene = Object.create(PlayerMainScene.prototype) as PlayerMainScene;
  const showFloatingText = vi.fn();

  Object.defineProperties(scene, {
    population: { value: population, writable: true, configurable: true },
    maxPopulation: { value: maxPopulation, writable: true, configurable: true },
    feedbackSystem: {
      value: { showFloatingText },
      writable: true,
      configurable: true,
    },
    cameras: {
      value: { main: { worldView: { centerX: 320, centerY: 180 } } },
      configurable: true,
    },
  });

  return { scene, showFloatingText };
}

describe('PlayerMainScene training requests', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks military training at the population cap without delegating to MainScene', () => {
    const baseHandler = vi.spyOn(MainScene.prototype, 'handleUnitSpawnRequest').mockImplementation(() => undefined);
    const { scene, showFloatingText } = createTrainingScene(8, 8);

    scene.handleUnitSpawnRequest(UnitType.PIKESMAN);

    expect(baseHandler).not.toHaveBeenCalled();
    expect(showFloatingText).toHaveBeenCalledWith(
      320,
      180,
      'Population cap reached! Build a House.',
      '#ff6b6b',
    );
  });

  it('delegates training normally when population capacity is available', () => {
    const baseHandler = vi.spyOn(MainScene.prototype, 'handleUnitSpawnRequest').mockImplementation(() => undefined);
    const { scene } = createTrainingScene(7, 8);

    scene.handleUnitSpawnRequest(UnitType.ARCHER);

    expect(baseHandler).toHaveBeenCalledOnce();
    expect(baseHandler).toHaveBeenCalledWith(UnitType.ARCHER);
  });
});
