export interface ShadowEmitterProfile {
  /** Horizontal start of the emitter line, normalized to the sprite texture. */
  leftNorm: number;
  /** Horizontal end of the emitter line, normalized to the sprite texture. */
  rightNorm: number;
  /** Vertical row of the emitter line, normalized to the sprite texture. */
  yNorm: number;
}

export interface ShadowEmitterScanBand {
  minYNorm: number;
  maxYNorm: number;
}

export interface ShadowEmitterDetectionOptions extends ShadowEmitterScanBand {
  alphaThreshold?: number;
  minSpanNorm?: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Finds the widest opaque row inside a configured vertical band of a sprite.
 *
 * Isometric art does not guarantee that its useful shadow origin is centered or
 * at the bottom of the PNG. Returning normalized coordinates lets the renderer
 * map the detected row through the actual child sprite origin and display size.
 */
export function detectShadowEmitterProfile(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: ShadowEmitterDetectionOptions,
): ShadowEmitterProfile | null {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return null;

  const minYNorm = clamp01(Math.min(options.minYNorm, options.maxYNorm));
  const maxYNorm = clamp01(Math.max(options.minYNorm, options.maxYNorm));
  const alphaThreshold = Math.max(0, Math.min(255, options.alphaThreshold ?? 24));
  const minSpan = Math.max(2, Math.ceil(width * clamp01(options.minSpanNorm ?? 0.18)));
  const startY = Math.max(0, Math.min(height - 1, Math.floor(minYNorm * (height - 1))));
  const endY = Math.max(startY, Math.min(height - 1, Math.ceil(maxYNorm * (height - 1))));

  let bestLeft = -1;
  let bestRight = -1;
  let bestY = -1;
  let bestSpan = -1;

  for (let y = startY; y <= endY; y++) {
    let left = -1;
    let right = -1;

    for (let x = 0; x < width; x++) {
      const alpha = rgba[(y * width + x) * 4 + 3];
      if (alpha < alphaThreshold) continue;
      if (left < 0) left = x;
      right = x;
    }

    if (left < 0 || right < left) continue;
    const span = right - left + 1;
    if (span < minSpan) continue;

    // Prefer the widest row. If several adjacent rows are effectively tied,
    // take the lower one so the emitter hugs the painted ground-facing mass.
    if (span > bestSpan || (span >= bestSpan - 1 && y > bestY)) {
      bestLeft = left;
      bestRight = right;
      bestY = y;
      bestSpan = span;
    }
  }

  if (bestY < 0) return null;

  const xDenominator = Math.max(1, width - 1);
  const yDenominator = Math.max(1, height - 1);
  return {
    leftNorm: bestLeft / xDenominator,
    rightNorm: bestRight / xDenominator,
    yNorm: bestY / yDenominator,
  };
}
