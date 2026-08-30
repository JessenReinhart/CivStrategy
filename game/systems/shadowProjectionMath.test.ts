import { describe, expect, it } from 'vitest';

import { BuildingType } from '../../types';
import { BUILDING_SPRITE_VISUALS } from './BuildingSpriteVisuals';
import { detectShadowEmitterProfile } from './shadowEmitterMath';
import { calculateShadowProjection } from './shadowProjectionMath';

const baseInput = {
  shadowAngleRad: Math.PI / 2,
  shadowLength: 100,
  shadowHeightScale: 0.72,
};

function alphaMask(
  width: number,
  height: number,
  rows: Array<{ y: number; left: number; right: number }>,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (const row of rows) {
    for (let x = row.left; x <= row.right; x++) {
      rgba[(row.y * width + x) * 4 + 3] = 255;
    }
  }
  return rgba;
}

describe('calculateShadowProjection', () => {
  it('creates a finite ground-plane projection that extends away from the anchor', () => {
    const projection = calculateShadowProjection(baseInput);

    expect(projection.length).toBeCloseTo(72);
    expect(Number.isFinite(projection.rotation)).toBe(true);
    expect(Number.isFinite(projection.directionX)).toBe(true);
    expect(Number.isFinite(projection.directionY)).toBe(true);
  });

  it('keeps the solar cast inside a stable downward cone', () => {
    const farLeft = calculateShadowProjection({ ...baseInput, shadowAngleRad: Math.PI });
    const farRight = calculateShadowProjection({ ...baseInput, shadowAngleRad: 0 });
    const down = calculateShadowProjection({ ...baseInput, shadowAngleRad: Math.PI / 2 });

    const maxSideways = Math.sin(60 * Math.PI / 180);
    expect(Math.abs(farLeft.directionX)).toBeLessThanOrEqual(maxSideways + 0.001);
    expect(Math.abs(farRight.directionX)).toBeLessThanOrEqual(maxSideways + 0.001);
    expect(farLeft.directionY).toBeGreaterThanOrEqual(0.49);
    expect(farRight.directionY).toBeGreaterThanOrEqual(0.49);
    expect(down.directionY).toBeGreaterThan(0.99);
    expect(Math.hypot(farLeft.directionX, farLeft.directionY)).toBeCloseTo(1, 5);
    expect(Math.hypot(farRight.directionX, farRight.directionY)).toBeCloseTo(1, 5);
  });

  it('scales a low-profile caster down without changing its direction', () => {
    const tall = calculateShadowProjection(baseInput);
    const low = calculateShadowProjection({ ...baseInput, shadowHeightScale: 0.2 });

    expect(low.length).toBeCloseTo(20);
    expect(low.directionX).toBeCloseTo(tall.directionX, 5);
    expect(low.directionY).toBeCloseTo(tall.directionY, 5);
  });
});

describe('shadow emitter detection', () => {
  it('keeps asymmetric left/right coordinates from the widest row', () => {
    const width = 10;
    const height = 10;
    const profile = detectShadowEmitterProfile(
      alphaMask(width, height, [
        { y: 5, left: 2, right: 7 },
        { y: 6, left: 1, right: 9 },
        { y: 7, left: 3, right: 8 },
      ]),
      width,
      height,
      { minYNorm: 0.4, maxYNorm: 0.8 },
    );

    expect(profile).not.toBeNull();
    expect(profile?.leftNorm).toBeCloseTo(1 / 9);
    expect(profile?.rightNorm).toBeCloseTo(1);
    expect(profile?.yNorm).toBeCloseTo(6 / 9);
  });

  it('ignores a wider roof row outside the configured ground-facing band', () => {
    const width = 12;
    const height = 12;
    const profile = detectShadowEmitterProfile(
      alphaMask(width, height, [
        { y: 2, left: 0, right: 11 },
        { y: 8, left: 2, right: 9 },
      ]),
      width,
      height,
      { minYNorm: 0.55, maxYNorm: 0.9 },
    );

    expect(profile).not.toBeNull();
    expect(profile?.leftNorm).toBeCloseTo(2 / 11);
    expect(profile?.rightNorm).toBeCloseTo(9 / 11);
    expect(profile?.yNorm).toBeCloseTo(8 / 11);
  });
});

describe('building shadow emitter configuration', () => {
  it('keeps every scan band normalized and every taper drawable', () => {
    for (const config of Object.values(BUILDING_SPRITE_VISUALS)) {
      expect(Number.isFinite(config.shadowHeightScale)).toBe(true);
      expect(Number.isFinite(config.shadowEndWidthScale)).toBe(true);
      expect(config.shadowHeightScale).toBeGreaterThan(0);
      expect(config.shadowEndWidthScale).toBeGreaterThan(0.8);
      expect(config.shadowEndWidthScale).toBeLessThanOrEqual(1);
      expect(config.shadowEmitterScanBand.minYNorm).toBeGreaterThanOrEqual(0);
      expect(config.shadowEmitterScanBand.maxYNorm).toBeLessThanOrEqual(1);
      expect(config.shadowEmitterScanBand.minYNorm).toBeLessThan(config.shadowEmitterScanBand.maxYNorm);
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
  });
});
