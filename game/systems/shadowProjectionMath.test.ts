import { describe, expect, it } from 'vitest';

import { BuildingType } from '../../types';
import { BUILDING_SPRITE_VISUALS } from './BuildingSpriteVisuals';
import { calculateShadowProjection } from './shadowProjectionMath';

const baseInput = {
  shadowAngleRad: Math.PI / 2,
  shadowLength: 100,
  shadowHeightScale: 0.72,
};

describe('calculateShadowProjection', () => {
  it('creates a finite ground-plane projection that extends away from the anchor', () => {
    const projection = calculateShadowProjection(baseInput);

    expect(projection.length).toBeCloseTo(72);
    expect(Number.isFinite(projection.rotation)).toBe(true);
    expect(Number.isFinite(projection.directionX)).toBe(true);
    expect(Number.isFinite(projection.directionY)).toBe(true);
  });

  it('rotates with the solar shadow vector while keeping a unit direction', () => {
    const east = calculateShadowProjection({ ...baseInput, shadowAngleRad: 0 });
    const south = calculateShadowProjection({ ...baseInput, shadowAngleRad: Math.PI / 2 });

    expect(east.directionX).toBeGreaterThan(0.9);
    expect(south.directionY).toBeGreaterThan(0.9);
    expect(Math.hypot(east.directionX, east.directionY)).toBeCloseTo(1, 5);
    expect(Math.hypot(south.directionX, south.directionY)).toBeCloseTo(1, 5);
  });

  it('scales a low-profile caster down without changing its direction', () => {
    const tall = calculateShadowProjection(baseInput);
    const low = calculateShadowProjection({ ...baseInput, shadowHeightScale: 0.2 });

    expect(low.length).toBeCloseTo(20);
    expect(low.directionX).toBeCloseTo(tall.directionX, 5);
    expect(low.directionY).toBeCloseTo(tall.directionY, 5);
  });
});

describe('authored building shadow profiles', () => {
  it('keeps every footprint deterministic and drawable', () => {
    for (const config of Object.values(BUILDING_SPRITE_VISUALS)) {
      expect(Number.isFinite(config.shadowHeightScale)).toBe(true);
      expect(Number.isFinite(config.shadowFootprintScale)).toBe(true);
      expect(Number.isFinite(config.shadowAnchorOffsetY)).toBe(true);
      expect(Number.isFinite(config.shadowEndWidthScale)).toBe(true);
      expect(config.shadowHeightScale).toBeGreaterThan(0);
      expect(config.shadowFootprintScale).toBeGreaterThan(0.4);
      expect(config.shadowEndWidthScale).toBeGreaterThan(0);
      expect(config.shadowEndWidthScale).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the bonfire cast much shorter than a house cast', () => {
    const house = BUILDING_SPRITE_VISUALS[BuildingType.HOUSE];
    const bonfire = BUILDING_SPRITE_VISUALS[BuildingType.BONFIRE];
    const houseProjection = calculateShadowProjection({
      ...baseInput,
      shadowHeightScale: house.shadowHeightScale,
    });
    const bonfireProjection = calculateShadowProjection({
      ...baseInput,
      shadowHeightScale: bonfire.shadowHeightScale,
    });

    expect(houseProjection.length).toBeGreaterThan(bonfireProjection.length * 3);
    expect(bonfire.shadowFootprintScale).toBeLessThan(house.shadowFootprintScale);
  });
});
