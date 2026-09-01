import { describe, expect, it } from 'vitest';

import { BUILDINGS } from '../constants';
import { BuildingType } from '../types';
import { BUILDING_SPRITE_VISUALS } from './systems/BuildingSpriteVisuals';
import { applyBuildingWorldScale, WORLD_CHARACTER_SCALE } from './worldScale';

describe('settlement world scale', () => {
  it('uses dense common footprints while farms occupy more land', () => {
    applyBuildingWorldScale();

    expect(BUILDINGS[BuildingType.HOUSE]).toMatchObject({ width: 32, height: 32 });
    expect(BUILDINGS[BuildingType.LUMBER_CAMP]).toMatchObject({ width: 32, height: 32 });
    expect(BUILDINGS[BuildingType.BARRACKS]).toMatchObject({ width: 48, height: 48 });
    expect(BUILDINGS[BuildingType.FARM]).toMatchObject({ width: 64, height: 64 });
  });

  it('keeps civic and monumental structures physically dominant', () => {
    applyBuildingWorldScale();

    expect(BUILDINGS[BuildingType.TOWN_CENTER]).toMatchObject({ width: 80, height: 80 });
    expect(BUILDINGS[BuildingType.CATHEDRAL]).toMatchObject({ width: 72, height: 72 });
    expect(BUILDINGS[BuildingType.CASTLE]).toMatchObject({ width: 96, height: 96 });
  });

  it('preserves the intended visual hierarchy', () => {
    applyBuildingWorldScale();
    const visualWidth = (type: BuildingType) =>
      BUILDINGS[type].width * BUILDING_SPRITE_VISUALS[type].scaleMultiplier;

    expect(visualWidth(BuildingType.LUMBER_CAMP)).toBeLessThan(visualWidth(BuildingType.HOUSE));
    expect(visualWidth(BuildingType.HOUSE)).toBeLessThan(visualWidth(BuildingType.BARRACKS));
    expect(visualWidth(BuildingType.BARRACKS)).toBeLessThan(visualWidth(BuildingType.FARM));
    expect(visualWidth(BuildingType.FARM)).toBeLessThan(visualWidth(BuildingType.MARKET));
    expect(visualWidth(BuildingType.MARKET)).toBeLessThan(visualWidth(BuildingType.TOWN_CENTER));
    expect(visualWidth(BuildingType.TOWN_CENTER)).toBeLessThan(visualWidth(BuildingType.CATHEDRAL));
    expect(visualWidth(BuildingType.CATHEDRAL)).toBeLessThan(visualWidth(BuildingType.CASTLE));
  });

  it('uses the shared 80% presentation scale for human-sized actors', () => {
    expect(WORLD_CHARACTER_SCALE).toBe(0.8);
  });
});
