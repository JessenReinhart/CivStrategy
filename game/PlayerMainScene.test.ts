import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnitType } from '../types';
import { MainScene } from './MainScene';
import { PlayerMainScene } from './PlayerMainScene';

describe('PlayerMainScene training requests', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks military training at the population cap without delegating to MainScene', () => {
    const baseHandler = vi.spyOn(MainScene.prototype, 'handleUnitSpawnRequest').mockImplementation(() => undefined);
    const showFloatingText = vi.fn();
    const scene = Object.create(PlayerMainScene.prototype) as PlayerMainScene;

    scene.population = 8;
    scene.maxPopulation = 8;
    scene.feedbackSystem = { showFloatingText } as unknown as PlayerMainScene['feedbackSystem'];
    scene.cameras = {
      main: { worldView: { centerX: 320, centerY: 180 } },
    } as unknown as PlayerMainScene['cameras'];

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
    const scene = Object.create(PlayerMainScene.prototype) as PlayerMainScene;

    scene.population = 7;
    scene.maxPopulation = 8;

    scene.handleUnitSpawnRequest(UnitType.ARCHER);

    expect(baseHandler).toHaveBeenCalledOnce();
    expect(baseHandler).toHaveBeenCalledWith(UnitType.ARCHER);
  });
});
