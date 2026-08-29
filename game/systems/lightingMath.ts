const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

interface LightColorKeyframe {
  readonly hour: number;
  readonly color: number;
}

export interface SunlightStyle {
  readonly color: number;
  readonly overlayAlpha: number;
  readonly glowAlpha: number;
}

const SUNLIGHT_COLORS: readonly LightColorKeyframe[] = [
  { hour: 6, color: 0xff9862 },
  { hour: 8.5, color: 0xffc990 },
  { hour: 12, color: 0xfff0d6 },
  { hour: 15.5, color: 0xffd39a },
  { hour: 18, color: 0xff8552 },
];

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

function sunlightColorForHour(hour: number): number {
  if (hour <= SUNLIGHT_COLORS[0].hour) return SUNLIGHT_COLORS[0].color;

  for (let index = 0; index < SUNLIGHT_COLORS.length - 1; index++) {
    const current = SUNLIGHT_COLORS[index];
    const next = SUNLIGHT_COLORS[index + 1];
    if (hour < current.hour || hour > next.hour) continue;

    const span = next.hour - current.hour || 1;
    return lerpColor(current.color, next.color, clamp01((hour - current.hour) / span));
  }

  return SUNLIGHT_COLORS[SUNLIGHT_COLORS.length - 1].color;
}

/**
 * Cheap art-directed sunlight. A restrained SCREEN pass keeps noon readable,
 * while low sun receives a little more warmth and directional bloom.
 */
export function calculateSunlightStyle(
  hour: number,
  sunIntensity: number,
  sunElevation: number,
): SunlightStyle {
  const intensity = clamp01(sunIntensity);
  const elevation = clamp01(sunElevation);
  if (intensity <= 0.001) {
    return { color: sunlightColorForHour(hour), overlayAlpha: 0, glowAlpha: 0 };
  }

  const horizonWarmth = 1 - elevation;
  return {
    color: sunlightColorForHour(hour),
    overlayAlpha: clamp01(intensity * (0.08 + horizonWarmth * 0.12)),
    glowAlpha: clamp01(intensity * (0.11 + horizonWarmth * 0.15)),
  };
}

/**
 * Local emissives should barely register at noon but become scene-defining once
 * the ambient pass moves into dusk/night values.
 */
export function calculateLocalLightAlpha(
  sunIntensity: number,
  ambientAlpha: number,
): number {
  const darkness = clamp01((ambientAlpha - 0.14) / 0.42);
  const solarSuppression = 1 - clamp01(sunIntensity) * 0.35;
  return clamp01((0.025 + darkness * 0.34) * solarSuppression);
}
