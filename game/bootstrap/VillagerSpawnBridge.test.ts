import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { UnitType } from '../../types';
import type { MainScene } from '../MainScene';
import { installLegacyVillagerSpawnBridge } from './VillagerSpawnBridge';

describe('installLegacyVillagerSpawnBridge', () => {
  it('routes villager requests into VillagerSystem', () => {
    const originalSpawnUnit = vi.fn();
    const spawnVillager = vi.fn();
    const scene = {
      entityFactory: { spawnUnit: originalSpawnUnit },
      villagerSystem: { spawnVillager },
    } as unknown as MainScene;

    installLegacyVillagerSpawnBridge(scene);
    const result = scene.entityFactory.spawnUnit(UnitType.VILLAGER, 54, 54, 0);

    expect(result).toBeUndefined();
    expect(spawnVillager).toHaveBeenCalledTimes(1);
    expect(spawnVillager).toHaveBeenCalledWith(54, 54, 0);
    expect(originalSpawnUnit).not.toHaveBeenCalled();
  });

  it('preserves EntityFactory spawning for non-villager units', () => {
    const sentinel = { id: 'combat-unit' };
    const originalSpawnUnit = vi.fn(() => sentinel);
    const spawnVillager = vi.fn();
    const scene = {
      entityFactory: { spawnUnit: originalSpawnUnit },
      villagerSystem: { spawnVillager },
    } as unknown as MainScene;

    installLegacyVillagerSpawnBridge(scene);
    const result = scene.entityFactory.spawnUnit(UnitType.PIKESMAN, 10, 20, 1);

    expect(result).toBe(sentinel);
    expect(originalSpawnUnit).toHaveBeenCalledWith(UnitType.PIKESMAN, 10, 20, 1);
    expect(spawnVillager).not.toHaveBeenCalled();
  });
});
