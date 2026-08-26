import { describe, expect, it } from 'vitest';

import {
  calculateDayNightState,
  DAY_LENGTH_GAME_MS,
  DAY_START_HOUR,
} from './dayNightMath';

describe('calculateDayNightState', () => {
  it('starts the game in morning daylight', () => {
    const state = calculateDayNightState(0);

    expect(state.hour).toBeCloseTo(DAY_START_HOUR, 5);
    expect(state.sunIntensity).toBeGreaterThan(0.5);
    expect(state.shadowLength).toBeGreaterThan(0);
    expect(state.ambientAlpha).toBeLessThan(0.15);
  });

  it('produces short strong shadows around noon', () => {
    const fourGameHours = DAY_LENGTH_GAME_MS * (4 / 24);
    const state = calculateDayNightState(fourGameHours);

    expect(state.hour).toBeCloseTo(12, 5);
    expect(state.sunIntensity).toBeGreaterThan(0.99);
    expect(state.sunElevation).toBeGreaterThan(0.99);
    expect(state.shadowLength).toBeLessThan(35);
    expect(state.shadowAlpha).toBeGreaterThan(0.1);
  });

  it('removes solar shadows at night and darkens the ambient overlay', () => {
    const fourteenGameHours = DAY_LENGTH_GAME_MS * (14 / 24);
    const state = calculateDayNightState(fourteenGameHours);

    expect(state.hour).toBeCloseTo(22, 5);
    expect(state.sunIntensity).toBe(0);
    expect(state.sunElevation).toBe(0);
    expect(state.shadowLength).toBe(0);
    expect(state.shadowAlpha).toBe(0);
    expect(state.ambientAlpha).toBeGreaterThan(0.4);
  });

  it('uses longer shadows near sunset than at noon', () => {
    const noon = calculateDayNightState(DAY_LENGTH_GAME_MS * (4 / 24));
    const lateAfternoon = calculateDayNightState(DAY_LENGTH_GAME_MS * (9 / 24));

    expect(lateAfternoon.hour).toBeCloseTo(17, 5);
    expect(lateAfternoon.shadowLength).toBeGreaterThan(noon.shadowLength * 2);
  });

  it('wraps cleanly after one complete day', () => {
    const first = calculateDayNightState(0);
    const wrapped = calculateDayNightState(DAY_LENGTH_GAME_MS);

    expect(wrapped.hour).toBeCloseTo(first.hour, 5);
    expect(wrapped.sunIntensity).toBeCloseTo(first.sunIntensity, 5);
    expect(wrapped.shadowLength).toBeCloseTo(first.shadowLength, 5);
    expect(wrapped.ambientColor).toBe(first.ambientColor);
    expect(wrapped.ambientAlpha).toBeCloseTo(first.ambientAlpha, 5);
  });
});
