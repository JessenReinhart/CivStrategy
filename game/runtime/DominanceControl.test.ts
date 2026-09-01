import { describe, expect, it, vi } from 'vitest';
import { DOMINANCE_MIN_BUILDINGS } from '../../constants';
import {
  BuildingType,
  GameResult,
  MapMode,
  MapPreset,
} from '../../types';
import type { MainScene } from '../MainScene';
import { checkSpatialDominance } from './DominanceControl';

type TestBuilding = {
  x: number;
  y: number;
  getData(key: string): unknown;
};

function createBuilding(
  owner: 0 | 1,
  type: BuildingType,
  x: number,
  y: number,
  territoryRadius?: number,
): TestBuilding {
  const data: Record<string, unknown> = {
    owner,
    hp: 100,
    def: { type, territoryRadius },
  };
  return {
    x,
    y,
    getData: (key: string) => data[key],
  };
}

function createScene(buildings: TestBuilding[]): MainScene {
  return {
    gameResult: GameResult.PLAYING,
    victoryType: null,
    mapMode: MapMode.FIXED,
    mapPreset: MapPreset.STANDARD,
    mapWidth: 256,
    mapHeight: 256,
    dominanceProgress: 0,
    playerTerritoryPercent: 0,
    buildings: {
      getChildren: () => buildings,
    },
    terrainSystem: {
      getHeightAt: () => 1,
    },
    feedbackSystem: {
      addNotification: vi.fn(),
    },
  } as unknown as MainScene;
}

describe('DominanceControl player expansion gate', () => {
  it('does not let enemy expansion unlock player dominance progress', () => {
    const playerTownCenter = createBuilding(
      0,
      BuildingType.TOWN_CENTER,
      128,
      128,
      600,
    );
    const enemyExpansion = Array.from(
      { length: DOMINANCE_MIN_BUILDINGS },
      (_, index) => createBuilding(1, BuildingType.HOUSE, 10_000 + index * 64, 10_000),
    );
    const scene = createScene([playerTownCenter, ...enemyExpansion]);

    checkSpatialDominance(scene);

    expect(scene.dominanceProgress).toBe(0);
    expect(scene.playerTerritoryPercent).toBe(0);
    expect(scene.gameResult).toBe(GameResult.PLAYING);
  });

  it('starts dominance progress after the player meets the expansion gate', () => {
    const playerTownCenter = createBuilding(
      0,
      BuildingType.TOWN_CENTER,
      128,
      128,
      600,
    );
    const playerExpansion = Array.from(
      { length: DOMINANCE_MIN_BUILDINGS },
      (_, index) => createBuilding(0, BuildingType.HOUSE, 96 + index * 8, 96),
    );
    const scene = createScene([playerTownCenter, ...playerExpansion]);

    checkSpatialDominance(scene);

    expect(scene.playerTerritoryPercent).toBeGreaterThanOrEqual(0.6);
    expect(scene.dominanceProgress).toBe(1000);
    expect(scene.gameResult).toBe(GameResult.PLAYING);
    expect(scene.victoryType).toBeNull();
  });
});
