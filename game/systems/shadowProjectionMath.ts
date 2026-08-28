export interface ShadowProjectionInput {
  shadowAngleRad: number;
  shadowLength: number;
  shadowHeightScale: number;
}

export interface ShadowProjection {
  directionX: number;
  directionY: number;
  perpendicularX: number;
  perpendicularY: number;
  rotation: number;
  length: number;
}

/**
 * Converts the screen-space sun angle into a stable isometric ground-plane
 * direction for tapered footprint shadows.
 */
export function calculateShadowProjection(input: ShadowProjectionInput): ShadowProjection {
  const projectedX = Math.cos(input.shadowAngleRad);
  const projectedY = Math.abs(Math.sin(input.shadowAngleRad)) * 0.55 + 0.12;
  const magnitude = Math.hypot(projectedX, projectedY) || 1;
  const directionX = projectedX / magnitude;
  const directionY = projectedY / magnitude;
  const length = Math.max(0, input.shadowLength * input.shadowHeightScale);

  return {
    directionX,
    directionY,
    perpendicularX: -directionY,
    perpendicularY: directionX,
    rotation: Math.atan2(directionY, directionX) - Math.PI / 2,
    length,
  };
}
