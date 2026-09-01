import { describe, expect, it, vi } from 'vitest';

import type { VillagerData } from '../../types';
import { WORLD_CHARACTER_SCALE } from '../worldScale';
import { applyVillagerPresentationScale } from './VillagerPresentationScale';

describe('applyVillagerPresentationScale', () => {
  it('scales only the villager sprite and shadow presentation', () => {
    const sprite = { setScale: vi.fn() };
    const shadow = { setScale: vi.fn() };
    const visual = {
      getData: vi.fn((key: string) => key === 'villagerSprite' ? sprite : undefined),
      list: [shadow],
    };
    const villager = {
      visual,
      state: 'gathering',
      path: [{ x: 10, y: 20 }],
      pathStep: 0,
      jobBuilding: { id: 'lumber-camp' },
    } as unknown as VillagerData;

    const stateBefore = villager.state;
    const pathBefore = villager.path;
    const jobBefore = villager.jobBuilding;

    applyVillagerPresentationScale(villager);

    expect(sprite.setScale).toHaveBeenCalledWith(0.22 * WORLD_CHARACTER_SCALE);
    expect(shadow.setScale).toHaveBeenCalledWith(WORLD_CHARACTER_SCALE);
    expect(villager.state).toBe(stateBefore);
    expect(villager.path).toBe(pathBefore);
    expect(villager.jobBuilding).toBe(jobBefore);
  });
});
