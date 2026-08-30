import { describe, expect, it } from 'vitest';

import {
    calculateDayNightState,
    DAY_LENGTH_GAME_MS,
    DAY_START_HOUR,
    SHADOW_REFRESH_INTERVAL_MS,
    shouldRefreshDayNightShadows,
} from './dayNightMath';

const gameTimeForHour = (hour: number): number =>
    DAY_LENGTH_GAME_MS * (((hour - DAY_START_HOUR + 24) % 24) / 24);

describe('calculateDayNightState', () => {
    it('starts a twelve-minute day at 08:00 in morning daylight', () => {
        const state = calculateDayNightState(0);

        expect(DAY_LENGTH_GAME_MS).toBe(12 * 60 * 1000);
        expect(state.hour).toBeCloseTo(8, 5);
        expect(state.sunIntensity).toBeGreaterThan(0.5);
        expect(state.shadowLength).toBeGreaterThan(0);
        expect(state.ambientAlpha).toBeGreaterThan(0.18);
        expect(state.ambientAlpha).toBeLessThan(0.20);
    });

    it('keeps midday ambient restrained so directional light owns the contrast', () => {
        const state = calculateDayNightState(gameTimeForHour(12));

        expect(state.hour).toBeCloseTo(12, 5);
        expect(state.sunIntensity).toBeCloseTo(1, 5);
        expect(state.sunElevation).toBeCloseTo(1, 5);
        expect(state.shadowLength).toBeGreaterThanOrEqual(50);
        expect(state.shadowLength).toBeLessThan(60);
        expect(state.shadowAlpha).toBeGreaterThanOrEqual(0.3);
        expect(state.ambientAlpha).toBeGreaterThan(0.07);
        expect(state.ambientAlpha).toBeLessThan(0.08);
    });

    it('lengthens and rotates shadows toward sunset', () => {
        const noon = calculateDayNightState(gameTimeForHour(12));
        const sunset = calculateDayNightState(gameTimeForHour(17));

        expect(sunset.shadowLength).toBeGreaterThan(noon.shadowLength * 2);
        expect(sunset.shadowAngleRad).toBeGreaterThan(noon.shadowAngleRad);
        expect(sunset.ambientAlpha).toBeGreaterThan(noon.ambientAlpha);
    });

    it('fades cast shadows before dawn and dusk become nearly horizontal', () => {
        const noon = calculateDayNightState(gameTimeForHour(12));
        const earlyDawn = calculateDayNightState(gameTimeForHour(6.5));
        const lateDusk = calculateDayNightState(gameTimeForHour(17.5));

        expect(earlyDawn.shadowAlpha).toBeLessThan(noon.shadowAlpha * 0.1);
        expect(lateDusk.shadowAlpha).toBeLessThan(noon.shadowAlpha * 0.1);
    });

    it('removes solar shadows at night and darkens the ambient overlay', () => {
        const state = calculateDayNightState(gameTimeForHour(22));

        expect(state.sunIntensity).toBe(0);
        expect(state.sunElevation).toBe(0);
        expect(state.shadowLength).toBe(0);
        expect(state.shadowAlpha).toBe(0);
        expect(state.ambientAlpha).toBeGreaterThan(0.54);
    });

    it('wraps cleanly after complete days and for negative serialized time', () => {
        const first = calculateDayNightState(0);
        const wrapped = calculateDayNightState(DAY_LENGTH_GAME_MS * 3);
        const previousDay = calculateDayNightState(-DAY_LENGTH_GAME_MS);

        for (const state of [wrapped, previousDay]) {
            expect(state.hour).toBeCloseTo(first.hour, 5);
            expect(state.sunIntensity).toBeCloseTo(first.sunIntensity, 5);
            expect(state.shadowLength).toBeCloseTo(first.shadowLength, 5);
            expect(state.ambientColor).toBe(first.ambientColor);
            expect(state.ambientAlpha).toBeCloseTo(first.ambientAlpha, 5);
        }
    });

    it('keeps ambient color and alpha continuous across keyframes and day wrapping', () => {
        const oneSecond = DAY_LENGTH_GAME_MS / (24 * 60 * 60);
        const beforeSunsetKeyframe = calculateDayNightState(gameTimeForHour(18) - oneSecond);
        const afterSunsetKeyframe = calculateDayNightState(gameTimeForHour(18) + oneSecond);
        const beforeWrap = calculateDayNightState(DAY_LENGTH_GAME_MS - 0.001);
        const afterWrap = calculateDayNightState(0);

        expect(Math.abs(afterSunsetKeyframe.ambientAlpha - beforeSunsetKeyframe.ambientAlpha))
            .toBeLessThan(0.001);
        expect(Math.abs(afterSunsetKeyframe.ambientColor - beforeSunsetKeyframe.ambientColor))
            .toBeLessThan(0x020202);
        expect(Math.abs(afterWrap.ambientAlpha - beforeWrap.ambientAlpha)).toBeLessThan(0.001);
        expect(afterWrap.ambientColor).toBe(beforeWrap.ambientColor);
    });
});

describe('shouldRefreshDayNightShadows', () => {
    it('allows the first refresh immediately', () => {
        expect(shouldRefreshDayNightShadows(0, Number.NEGATIVE_INFINITY)).toBe(true);
    });

    it('enforces 200 ms as a minimum redraw gap', () => {
        expect(SHADOW_REFRESH_INTERVAL_MS).toBe(200);
        expect(shouldRefreshDayNightShadows(1199.999, 1000)).toBe(false);
        expect(shouldRefreshDayNightShadows(1200, 1000)).toBe(true);
        expect(shouldRefreshDayNightShadows(1400, 1200)).toBe(true);
    });

    it('does not demand catch-up redraws after a slow frame', () => {
        const refreshes: number[] = [];
        let lastRefresh = Number.NEGATIVE_INFINITY;

        for (const now of [0, 16, 80, 199, 1200, 1201, 1399, 1400]) {
            if (!shouldRefreshDayNightShadows(now, lastRefresh)) continue;
            refreshes.push(now);
            lastRefresh = now;
        }

        expect(refreshes).toEqual([0, 1200, 1400]);
        expect(refreshes.slice(1).every((time, index) => time - refreshes[index] >= 200))
            .toBe(true);
    });
});
