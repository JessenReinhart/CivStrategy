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
  /** Minimum width relative to the widest candidate that can represent the grounded base. */
  minGroundedSpanRatio?: number;
}

interface OpaqueRowSpan {
  y: number;
  left: number;
  right: number;
  span: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Finds a broad opaque row as low as possible inside the configured ground-facing band.
 *
 * Isometric sprites often have their widest row above the painted ground contact. Using
 * that row makes a cast shadow visibly float. We first establish the widest credible
 * base, then choose the lowest row that remains a substantial fraction of that width.
 * Narrow feet, posts, and decorative pixels therefore cannot drag the emitter downward,
 * while asymmetric building silhouettes keep their real left/right grounding.
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
  const minGroundedSpanRatio = clamp01(options.minGroundedSpanRatio ?? 0.65);
  const startY = Math.max(0, Math.min(height - 1, Math.floor(minYNorm * (height - 1))));
  const endY = Math.max(startY, Math.min(height - 1, Math.ceil(maxYNorm * (height - 1))));

  const candidates: OpaqueRowSpan[] = [];
  let widestSpan = 0;

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

    candidates.push({ y, left, right, span });
    widestSpan = Math.max(widestSpan, span);
  }

  if (candidates.length === 0) return null;

  const groundedMinSpan = Math.max(minSpan, Math.ceil(widestSpan * minGroundedSpanRatio));
  let grounded = candidates[0];
  for (const candidate of candidates) {
    if (candidate.span >= groundedMinSpan && candidate.y >= grounded.y) {
      grounded = candidate;
    }
  }

  const xDenominator = Math.max(1, width - 1);
  const yDenominator = Math.max(1, height - 1);
  return {
    leftNorm: grounded.left / xDenominator,
    rightNorm: grounded.right / xDenominator,
    yNorm: grounded.y / yDenominator,
  };
}
