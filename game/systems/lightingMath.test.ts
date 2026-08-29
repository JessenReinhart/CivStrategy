import { describe, expect, it } from 'vitest';

import { calculateLocalLightAlpha, calculateSunlightStyle } from './lightingMath';

describe('calculateSunlightStyle', () => {
  it('removes direct sunlight at night', () => {
    const style = calculateSunlightStyle(22, 0, 0);

    expect(style.overlayAlpha).toBe(0);
    expect(style.glowAlpha).toBe(0);
  });

  it('keeps noon sunlight visible without washing the scene out', () => {
    const style = calculateSunlightStyle(12, 1, 1);

    expect(style.overlayAlpha).toBeGreaterThanOrEqual(0.07);
    expect(style.overlayAlpha).toBeLessThanOrEqual(0.1);
    expect(style.glowAlpha).toBeGreaterThan(style.overlayAlpha);
  });

  it('gives low daylight a stronger warm-light emphasis', () => {
    const noon = calculateSunlightStyle(12, 1, 1);
    const lateAfternoon = calculateSunlightStyle(17, 0.55, 0.25);

    expect(lateAfternoon.overlayAlpha).toBeGreaterThan(0.05);
    expect(lateAfternoon.color).not.toBe(noon.color);
  });
});

describe('calculateLocalLightAlpha', () => {
  it('keeps bonfire glow subtle in bright daylight', () => {
    expect(calculateLocalLightAlpha(1, 0.12)).toBeLessThan(0.03);
  });

  it('makes emissive lights much stronger at night', () => {
    const noon = calculateLocalLightAlpha(1, 0.12);
    const night = calculateLocalLightAlpha(0, 0.6);

    expect(night).toBeGreaterThan(0.3);
    expect(night).toBeGreaterThan(noon * 10);
  });
});
