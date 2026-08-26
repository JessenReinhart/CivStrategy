import { describe, expect, it } from 'vitest';

import { BuildingType } from '../../types';
import { calculateDominanceControl, DominanceBuildingSnapshot } from './DominanceControl';

function building(
  type: BuildingType,
  x: number,
  y: number,
  owner = 0,
): DominanceBuildingSnapshot {
  return { type, x, y, owner };
}

describe('calculateDominanceControl', () => {
  it('does not treat a compact starting town as control of most of the map', () => {
    const result = calculateDominanceControl({
      mapWidth: 1000,
      mapHeight: 1000,
      gridSize: 10,
      isLand: () => true,
      buildings: [
        building(BuildingType.TOWN_CENTER, 120, 120),
        building(BuildingType.BONFIRE, 170, 120),
        building(BuildingType.HOUSE, 120, 180),
        building(BuildingType.HOUSE, 180, 180),
        building(BuildingType.FARM, 220, 120),
        building(BuildingType.BARRACKS, 120, 230),
        building(BuildingType.TOWN_CENTER, 880, 880, 1),
      ],
    });

    expect(result.playerPercent).toBeLessThan(0.6);
  });

  it('does not reward stacking many buildings on the same territory sector', () => {
    const oneHouse = calculateDominanceControl({
      mapWidth: 1000,
      mapHeight: 1000,
      gridSize: 10,
      isLand: () => true,
      buildings: [building(BuildingType.HOUSE, 200, 200)],
    });

    const stackedHouses = calculateDominanceControl({
      mapWidth: 1000,
      mapHeight: 1000,
      gridSize: 10,
      isLand: () => true,
      buildings: Array.from({ length: 20 }, () => building(BuildingType.HOUSE, 200, 200)),
    });

    expect(stackedHouses.playerPercent).toBe(oneHouse.playerPercent);
  });

  it('allows dominance when influence is genuinely distributed over the realm', () => {
    const spread: DominanceBuildingSnapshot[] = [];
    for (const y of [100, 300, 500, 700, 900]) {
      for (const x of [100, 300, 500, 700, 900]) {
        spread.push(building(BuildingType.CASTLE, x, y));
      }
    }
    spread.push(building(BuildingType.TOWN_CENTER, 950, 950, 1));

    const result = calculateDominanceControl({
      mapWidth: 1000,
      mapHeight: 1000,
      gridSize: 10,
      isLand: () => true,
      buildings: spread,
    });

    expect(result.playerPercent).toBeGreaterThanOrEqual(0.6);
  });

  it('excludes water from the map-control denominator', () => {
    const result = calculateDominanceControl({
      mapWidth: 1000,
      mapHeight: 1000,
      gridSize: 10,
      isLand: (x) => x < 500,
      buildings: [building(BuildingType.CASTLE, 250, 500)],
    });

    expect(result.landSectors).toBe(50);
  });
});
