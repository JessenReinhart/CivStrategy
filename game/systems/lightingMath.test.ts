import { describe, expect, it } from 'vitest';

import { calculateLocalLightAlpha, calculateSunlightStyle, calculateTorchFlicker } from './lightingMath';

describe('calculateSunlightStyle', () => {
  it('removes direct sunlight at night', () => {
    const style = calculateSunlightStyle(22, 0, 0);

    expect(style.directionalAlpha).toBe(0);
    expect(style.shadeAlpha).toBe(0);
  });

  it('keeps noon highlights restrained while preserving directional shade', () => {
    const style = calculateSunlightStyle(12, 1, 1);

    expect(style.directionalAlpha).toBeGreaterThanOrEqual(0.07);
    expect(style.directionalAlpha).toBeLessThanOrEqual(0.09);
    expect(style.shadeAlpha).toBeGreaterThanOrEqual(0.30);
    expect(style.shadeAlpha).toBeLessThanOrEqual(0.34);
  });

  it('warms and strengthens directional contrast as the sun gets lower', () => {
    const noon = calculateSunlightStyle(12, 1, 1);
    const lateAfternoon = calculateSunlightStyle(17, 0.55, 0.25);

    expect(lateAfternoon.directionalAlpha).toBeGreaterThan(noon.directionalAlpha);
    expect(lateAfternoon.directionalAlpha).toBeLessThan(0.12);
    expect(lateAfternoon.shadeAlpha).toBeGreaterThan(noon.shadeAlpha);
    expect(lateAfternoon.color).not.toBe(noon.color);
  });
});

describe('calculateLocalLightAlpha', () => {
  it('keeps bonfire glow subtle in bright daylight', () => {
    expect(calculateLocalLightAlpha(1, 0.05)).toBeLessThan(0.03);
  });

  it('makes emissive lights much stronger at night', () => {
    const noon = calculateLocalLightAlpha(1, 0.05);
    const night = calculateLocalLightAlpha(0, 0.58);

    expect(night).toBeGreaterThan(0.3);
    expect(night).toBeGreaterThan(noon * 10);
  });
});

describe('calculateTorchFlicker', () => {
  it('keeps scale and alpha modulation within natural hearth bounds', () => {
    for (let t = 0; t <= 2000; t += 125) {
      const flicker = calculateTorchFlicker(t, 1.73);
      expect(flicker.scale).toBeGreaterThan(0.94);
      expect(flicker.scale).toBeLessThan(1.06);
      expect(flicker.alpha).toBeGreaterThanOrEqual(0.84);
      expect(flicker.alpha).toBeLessThanOrEqual(1.0);
      expect(flicker.tint).toBeGreaterThan(0xff0000);
    }
  });

  it('produces distinct phase states for different bonfire seeds', () => {
    const first = calculateTorchFlicker(420, 0.5);
    const second = calculateTorchFlicker(420, 2.9);

    expect(first.scale).not.toBeCloseTo(second.scale, 4);
    expect(first.tint).not.toBe(second.tint);
  });
});
