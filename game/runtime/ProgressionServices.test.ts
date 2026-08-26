import { describe, expect, it, vi } from 'vitest';
import { DOMINANCE_HOLD_TIME_MS } from '../../constants';
import { GameResult, MapMode, MapPreset, VictoryType } from '../../types';
import type { MainScene } from '../MainScene';
import { createProgressionServices } from './ProgressionServices';

type TestBuilding = {
  x: number;
  y: number;
  getData(key: string): unknown;
};

function building(x: number, y: number, owner: 0 | 1, territoryRadius = 256): TestBuilding {
  const data = {
    owner,
    hp: 100,
    def: { territoryRadius },
  };
  return {
    x,
    y,
    getData: (key: string) => data[key as keyof typeof data],
  };
}

function createScene(
  buildings: TestBuilding[],
  overrides: Partial<{
    mapMode: MapMode;
    terrainHeightAt: (x: number, y: number) => number;
    dominanceProgress: number;
  }> = {},
): MainScene & { checkWinLose: ReturnType<typeof vi.fn>; notify: ReturnType<typeof vi.fn> } {
  const notify = vi.fn();
  const checkWinLose = vi.fn();
  const scene = {
    stressTestConfig: null,
    gameResult: GameResult.PLAYING,
    victoryType: VictoryType.CONQUEST,
    mapMode: overrides.mapMode ?? MapMode.FIXED,
    mapWidth: 1024,
    mapHeight: 1024,
    mapPreset: MapPreset.STANDARD,
    dominanceProgress: overrides.dominanceProgress ?? 0,
    playerTerritoryPercent: 0,
    buildings: { getChildren: () => buildings },
    terrainSystem: {
      getHeightAt: overrides.terrainHeightAt ?? (() => 1),
    },
    feedbackSystem: { addNotification: notify },
    checkWinLose,
  } as unknown as MainScene & { checkWinLose: ReturnType<typeof vi.fn>; notify: ReturnType<typeof vi.fn> };

  scene.notify = notify;
  return scene;
}

describe('ProgressionServices victory boundary', () => {
  it('does not turn a compact building stack into map dominance', () => {
    const compactPlayerBase = Array.from({ length: 20 }, (_, index) =>
      building(160 + (index % 5) * 8, 160 + Math.floor(index / 5) * 8, 0),
    );
    const scene = createScene([...compactPlayerBase, building(880, 880, 1)]);

    createProgressionServices(scene).victory.check();

    expect(scene.checkWinLose).toHaveBeenCalledOnce();
    expect(scene.playerTerritoryPercent).toBeLessThan(0.6);
    expect(scene.dominanceProgress).toBe(0);
    expect(scene.gameResult).toBe(GameResult.PLAYING);
  });

  it('lets distributed land control complete the existing dominance hold flow', () => {
    const scene = createScene(
      [
        building(220, 220, 0, 420),
        building(760, 220, 0, 420),
        building(220, 760, 0, 420),
        building(760, 760, 0, 420),
        building(980, 980, 1, 256),
      ],
      { dominanceProgress: DOMINANCE_HOLD_TIME_MS - 1000 },
    );

    createProgressionServices(scene).victory.check();

    expect(scene.playerTerritoryPercent).toBeGreaterThanOrEqual(0.6);
    expect(scene.dominanceProgress).toBe(DOMINANCE_HOLD_TIME_MS);
    expect(scene.victoryType).toBe(VictoryType.DOMINANCE);
    expect(scene.gameResult).toBe(GameResult.WON);
    expect(scene.notify).toHaveBeenCalledWith(
      '🏆 Dominance Victory! You control the realm!',
      'success',
      30000,
    );
  });

  it('excludes water from controllable land', () => {
    const scene = createScene(
      [building(240, 512, 0, 700), building(900, 512, 1, 256)],
      {
        terrainHeightAt: (x) => (x < 512 ? 1 : 0),
      },
    );

    createProgressionServices(scene).victory.check();

    expect(scene.playerTerritoryPercent).toBe(1);
    expect(scene.dominanceProgress).toBe(1000);
  });

  it('disables percentage-map dominance in Infinite Realm', () => {
    const scene = createScene(
      [building(256, 256, 0, 800)],
      { mapMode: MapMode.INFINITE, dominanceProgress: 15000 },
    );
    scene.playerTerritoryPercent = 0.9;

    createProgressionServices(scene).victory.check();

    expect(scene.dominanceProgress).toBe(0);
    expect(scene.playerTerritoryPercent).toBe(0);
    expect(scene.gameResult).toBe(GameResult.PLAYING);
  });
});
