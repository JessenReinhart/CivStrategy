export const DAY_LENGTH_GAME_MS = 12 * 60 * 1000;
export const DAY_START_HOUR = 8;
export const SHADOW_REFRESH_INTERVAL_MS = 200;

export interface DayNightState {
    readonly hour: number;
    readonly normalizedDay: number;
    readonly sunIntensity: number;
    readonly sunElevation: number;
    readonly sunAzimuthRad: number;
    readonly shadowAngleRad: number;
    readonly shadowLength: number;
    readonly shadowAlpha: number;
    readonly ambientColor: number;
    readonly ambientAlpha: number;
}

interface AmbientKeyframe {
    readonly hour: number;
    readonly color: number;
    readonly alpha: number;
}

const AMBIENT_KEYFRAMES: readonly AmbientKeyframe[] = [
    { hour: 0, color: 0x07172f, alpha: 0.48 },
    { hour: 4.8, color: 0x0b1d38, alpha: 0.44 },
    { hour: 6, color: 0x3b2a38, alpha: 0.30 },
    { hour: 7.2, color: 0xe07a45, alpha: 0.12 },
    { hour: 10, color: 0xfff1cf, alpha: 0.02 },
    { hour: 16.5, color: 0xffdfb0, alpha: 0.03 },
    { hour: 18, color: 0xc95a3d, alpha: 0.16 },
    { hour: 19.4, color: 0x24334f, alpha: 0.33 },
    { hour: 21, color: 0x091a34, alpha: 0.46 },
    { hour: 24, color: 0x07172f, alpha: 0.48 },
];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const wrap = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus;

function lerpColor(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 0xff;
    const ag = (a >> 8) & 0xff;
    const ab = a & 0xff;
    const br = (b >> 16) & 0xff;
    const bg = (b >> 8) & 0xff;
    const bb = b & 0xff;

    const red = Math.round(lerp(ar, br, t));
    const green = Math.round(lerp(ag, bg, t));
    const blue = Math.round(lerp(ab, bb, t));
    return (red << 16) | (green << 8) | blue;
}

function getAmbient(hour: number): Pick<DayNightState, 'ambientColor' | 'ambientAlpha'> {
    for (let index = 0; index < AMBIENT_KEYFRAMES.length - 1; index++) {
        const current = AMBIENT_KEYFRAMES[index];
        const next = AMBIENT_KEYFRAMES[index + 1];
        if (hour >= current.hour && hour <= next.hour) {
            const span = next.hour - current.hour || 1;
            const progress = clamp01((hour - current.hour) / span);
            return {
                ambientColor: lerpColor(current.color, next.color, progress),
                ambientAlpha: lerp(current.alpha, next.alpha, progress),
            };
        }
    }

    const fallback = AMBIENT_KEYFRAMES[AMBIENT_KEYFRAMES.length - 1];
    return { ambientColor: fallback.color, ambientAlpha: fallback.alpha };
}

/**
 * Maps serialized game time to a deterministic 24-hour lighting state.
 * One complete visual day lasts twelve game minutes and starts at 08:00.
 */
export function calculateDayNightState(
    gameTimeMs: number,
    dayLengthMs: number = DAY_LENGTH_GAME_MS,
    startHour: number = DAY_START_HOUR,
): DayNightState {
    const safeDayLength = Number.isFinite(dayLengthMs) ? Math.max(1, dayLengthMs) : DAY_LENGTH_GAME_MS;
    const safeGameTime = Number.isFinite(gameTimeMs) ? gameTimeMs : 0;
    const safeStartHour = Number.isFinite(startHour) ? startHour : DAY_START_HOUR;
    const elapsedDay = wrap(safeGameTime, safeDayLength);
    const normalizedDay = elapsedDay / safeDayLength;
    const hour = wrap(safeStartHour + normalizedDay * 24, 24);

    const isDay = hour >= 6 && hour <= 18;
    const daylightProgress = clamp01((hour - 6) / 12);
    const sunElevation = isDay ? Math.max(0, Math.sin(daylightProgress * Math.PI)) : 0;
    const sunIntensity = isDay ? Math.pow(sunElevation, 0.55) : 0;

    // Sweep the visual sun east-to-west across the day. The renderer projects
    // the shadow in the opposite direction for a deliberately screen-space,
    // isometric-friendly result rather than a physical 3D solar simulation.
    const sunAzimuthRad = -0.2 * Math.PI + daylightProgress * 1.4 * Math.PI;
    const shadowAngleRad = sunAzimuthRad + Math.PI;
    const shadowLength = sunIntensity > 0.01
        ? lerp(190, 26, Math.sqrt(sunElevation))
        : 0;
    const shadowAlpha = sunIntensity > 0.01
        ? (0.16 + (1 - sunElevation) * 0.10) * clamp01(sunIntensity * 1.5)
        : 0;

    return {
        hour,
        normalizedDay,
        sunIntensity,
        sunElevation,
        sunAzimuthRad,
        shadowAngleRad,
        shadowLength,
        shadowAlpha,
        ...getAmbient(hour),
    };
}

/**
 * Pure redraw gate used by the renderer. Recording the actual refresh time as
 * `lastRefreshMs` prevents catch-up redraws after a slow frame, so 5 Hz remains
 * an upper bound rather than an expected wall-clock redraw count.
 */
export function shouldRefreshDayNightShadows(
    nowMs: number,
    lastRefreshMs: number,
    refreshIntervalMs: number = SHADOW_REFRESH_INTERVAL_MS,
): boolean {
    if (!Number.isFinite(nowMs)) return false;
    if (lastRefreshMs === Number.NEGATIVE_INFINITY) return true;
    if (!Number.isFinite(lastRefreshMs)) return false;

    const safeInterval = Number.isFinite(refreshIntervalMs)
        ? Math.max(0, refreshIntervalMs)
        : SHADOW_REFRESH_INTERVAL_MS;
    return nowMs - lastRefreshMs >= safeInterval;
}
