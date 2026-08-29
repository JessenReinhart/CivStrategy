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

const MAX_SHADOW_ANGLE_FROM_DOWN_RAD = 35 * Math.PI / 180;
const MAX_SIDEWAYS_TO_DOWN_RATIO = Math.tan(MAX_SHADOW_ANGLE_FROM_DOWN_RAD);

/**
 * Converts the screen-space sun angle into a stable isometric ground-plane
 * direction for the sprite-emitter shadows.
 *
 * The emitter-line fake looks convincing while the cast points mostly down the
 * screen, but becomes visibly detached when the solar vector approaches a
 * horizontal direction. Clamp the cast to a downward cone rather than trying
 * to simulate a full 360-degree physical shadow with 2D isometric art.
 */
export function calculateShadowProjection(input: ShadowProjectionInput): ShadowProjection {
  const rawProjectedX = Math.cos(input.shadowAngleRad);
  const projectedY = Math.abs(Math.sin(input.shadowAngleRad)) * 0.55 + 0.12;
  const maxProjectedX = projectedY * MAX_SIDEWAYS_TO_DOWN_RATIO;
  const projectedX = Math.max(-maxProjectedX, Math.min(maxProjectedX, rawProjectedX));
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
