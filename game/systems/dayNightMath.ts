export const DAY_LENGTH_GAME_MS = 12 * 60 * 1000;
export const DAY_START_HOUR = 8;

export interface DayNightState {
  hour: number;
  normalizedDay: number;
  sunIntensity: number;
  sunElevation: number;
  sunAzimuthRad: number;
  shadowAngleRad: number;
  shadowLength: number;
  shadowAlpha: number;
  ambientColor: number;
  ambientAlpha: number;
}

interface AmbientKeyframe {
  hour: number;
  color: number;
  alpha: number;
}

const AMBIENT_KEYFRAMES: AmbientKeyframe[] = [
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

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;

  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const blue = Math.round(lerp(ab, bb, t));
  return (r << 16) | (g << 8) | blue;
}

function getAmbient(hour: number): Pick<DayNightState, 'ambientColor' | 'ambientAlpha'> {
  for (let i = 0; i < AMBIENT_KEYFRAMES.length - 1; i++) {
    const current = AMBIENT_KEYFRAMES[i];
    const next = AMBIENT_KEYFRAMES[i + 1];
    if (hour >= current.hour && hour <= next.hour) {
      const span = next.hour - current.hour || 1;
      const t = clamp01((hour - current.hour) / span);
      return {
        ambientColor: lerpColor(current.color, next.color, t),
        ambientAlpha: lerp(current.alpha, next.alpha, t),
      };
    }
  }

  const fallback = AMBIENT_KEYFRAMES[AMBIENT_KEYFRAMES.length - 1];
  return { ambientColor: fallback.color, ambientAlpha: fallback.alpha };
}

export function calculateDayNightState(
  gameTimeMs: number,
  dayLengthMs: number = DAY_LENGTH_GAME_MS,
  startHour: number = DAY_START_HOUR,
): DayNightState {
  const safeDayLength = Math.max(1, dayLengthMs);
  const elapsedDay = ((gameTimeMs % safeDayLength) + safeDayLength) % safeDayLength;
  const normalizedDay = elapsedDay / safeDayLength;
  const hour = (startHour + normalizedDay * 24) % 24;

  const daylightProgress = clamp01((hour - 6) / 12);
  const isDay = hour >= 6 && hour <= 18;
  const sunElevation = isDay ? Math.max(0, Math.sin(daylightProgress * Math.PI)) : 0;
  const sunIntensity = isDay ? Math.pow(sunElevation, 0.55) : 0;

  // Sweep the visual sun from upper-right/east to lower-left/west across the day.
  // The shadow points in the opposite direction. This is an artistic screen-space
  // model rather than a 3D solar simulation, which is intentional for the 2D renderer.
  const sunAzimuthRad = (-0.2 * Math.PI) + daylightProgress * (1.4 * Math.PI);
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
