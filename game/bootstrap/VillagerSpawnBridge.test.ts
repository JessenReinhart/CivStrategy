import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../MainScene', () => ({ MainScene: class {} }));

import { UnitType } from '../../types';
import type { MainScene } from '../MainScene';
import { WORLD_CHARACTER_SCALE } from '../worldScale';
import { installLegacyVillagerSpawnBridge } from './VillagerSpawnBridge';

function makeVillagerVisual() {
  const sprite = { setScale: vi.fn() };
  const shadow = { setScale: vi.fn() };
  const visual = {
    getData: vi.fn((key: string) => key === 'villagerSprite' ? sprite : undefined),
    list: [shadow],
  };
  return { villager: { visual }, sprite, shadow };
}

describe('installLegacyVillagerSpawnBridge', () => {
  it('routes villager requests into VillagerSystem and applies presentation scale', () => {
    const originalSpawnUnit = vi.fn();
    const { villager, sprite, shadow } = makeVillagerVisual();
    const spawnVillager = vi.fn(() => villager);
    const scene = {
      entityFactory: { spawnUnit: originalSpawnUnit },
      villagerSystem: { spawnVillager },
    } as unknown as MainScene;

    installLegacyVillagerSpawnBridge(scene);
    const result = scene.entityFactory.spawnUnit(UnitType.VILLAGER, 54, 54, 0);

    expect(result).toBeUndefined();
    expect(spawnVillager).toHaveBeenCalledTimes(1);
    expect(spawnVillager).toHaveBeenCalledWith(54, 54, 0);
    expect(sprite.setScale).toHaveBeenCalledWith(0.22 * WORLD_CHARACTER_SCALE);
    expect(shadow.setScale).toHaveBeenCalledWith(WORLD_CHARACTER_SCALE);
    expect(originalSpawnUnit).not.toHaveBeenCalled();
  });

  it('also scales callers that use VillagerSystem.spawnVillager directly', () => {
    const { villager, sprite, shadow } = makeVillagerVisual();
    const spawnVillager = vi.fn(() => villager);
    const scene = {
      entityFactory: { spawnUnit: vi.fn() },
      villagerSystem: { spawnVillager },
    } as unknown as MainScene;

    installLegacyVillagerSpawnBridge(scene);
    const result = scene.villagerSystem.spawnVillager(10, 20, 1);

    expect(result).toBe(villager);
    expect(spawnVillager).toHaveBeenCalledWith(10, 20, 1);
    expect(sprite.setScale).toHaveBeenCalledWith(0.22 * WORLD_CHARACTER_SCALE);
    expect(shadow.setScale).toHaveBeenCalledWith(WORLD_CHARACTER_SCALE);
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
