import { describe, expect, it, vi } from 'vitest';

vi.mock('../MainScene', () => ({ MainScene: class {} }));

import type { MainScene } from '../MainScene';
import { spawnStartingResourceNodes } from './StartingResourceBootstrap';

describe('starting resource bootstrap', () => {
  it('seeds player and enemy resource nodes before save hydration', () => {
    const spawnStartingForest = vi.fn();
    const spawnStartingGoldMines = vi.fn();
    const scene = {
      enemyAI: { baseX: 320, baseY: 480 },
      mapGenerationSystem: {
        spawnStartingForest,
        spawnStartingGoldMines,
      },
    } as unknown as MainScene;

    spawnStartingResourceNodes(scene, 1024, 1024);

    expect(spawnStartingForest.mock.calls).toEqual([
      [1024, 1024],
      [320, 480],
    ]);
    expect(spawnStartingGoldMines.mock.calls).toEqual([
      [1024, 1024],
      [320, 480],
    ]);
  });
});
