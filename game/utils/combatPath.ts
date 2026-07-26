/**
 * Pure helpers for chase/attack path stability.
 * Keeps UnitSystem from thrashing (repath reset + idle-on-stale mid-chase).
 */

export interface PathPoint {
  x: number;
  y: number;
}

export interface ChaseRepathInput {
  /** Current path (null/empty = none). */
  path: PathPoint[] | null | undefined;
  /** Index of next waypoint on path. */
  pathStep: number;
  /** ms since last successful repath. */
  timeSinceRecalc: number;
  /** How far the chase target moved since last repath (world units). */
  targetMoved: number;
  /** Distance unit → target. */
  distToTarget: number;
  /** Attack range — inside this, no repath needed. */
  range: number;
}

/** Min time between chase repaths (ms). */
export const CHASE_REPATH_MIN_MS = 450;
/** Far-range repath interval when target barely moved. */
export const CHASE_REPATH_FAR_MS = 2500;
/** Target must move this far (world) to force early repath. */
export const CHASE_TARGET_MOVE_THRESH = 28;
/** Path end within this of target counts as "good enough". */
export const CHASE_PATH_END_SLACK = 48;

/**
 * Pick path index to resume after repath.
 * Prefer the closest waypoint still roughly ahead toward the path end —
 * never force step 0 (that walks back to the start cell = thrash).
 */
export function findResumePathStep(
  path: PathPoint[],
  unitX: number,
  unitY: number,
): number {
  if (path.length === 0) return 0;
  if (path.length === 1) return 0;

  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const dx = unitX - p.x;
    const dy = unitY - p.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }

  // If already essentially on best, advance to next so we don't sit/oscillate
  const near = Math.sqrt(bestDist);
  if (near < 6 && best < path.length - 1) {
    return best + 1;
  }
  return best;
}

/**
 * Decide whether a chasing unit should recompute its path.
 * Avoids 150ms full resets that send units walking back to path[0].
 */
export function shouldRepathChase(input: ChaseRepathInput): boolean {
  const { path, pathStep, timeSinceRecalc, targetMoved, distToTarget, range } = input;

  if (distToTarget <= range) return false;

  const hasPath = !!(path && path.length > 1);
  const exhausted = !hasPath || pathStep >= (path?.length ?? 0);

  if (exhausted) return true;

  // Target relocated — repath, but never faster than CHASE_REPATH_MIN_MS
  if (targetMoved >= CHASE_TARGET_MOVE_THRESH && timeSinceRecalc >= CHASE_REPATH_MIN_MS) {
    return true;
  }

  // Periodic refresh for long chases (target may have shifted slowly)
  if (timeSinceRecalc >= CHASE_REPATH_FAR_MS) return true;

  return false;
}

/**
 * Stale-path policy. Mid-chase must NOT drop to IDLE (that causes
 * scan/re-acquire thrash). Clear path so next tick repaths while staying CHASING.
 */
export type StalePathAction = 'keep' | 'clear_repath' | 'clear_idle';

export function stalePathAction(
  pathAgeMs: number,
  staleLifetimeMs: number,
  isChasingOrAttacking: boolean,
): StalePathAction {
  if (pathAgeMs <= staleLifetimeMs) return 'keep';
  if (isChasingOrAttacking) return 'clear_repath';
  return 'clear_idle';
}

/**
 * True if path's last waypoint is close enough to the target that we
 * can keep following instead of repathing for tiny target jitter.
 */
export function pathEndNearTarget(
  path: PathPoint[],
  targetX: number,
  targetY: number,
  slack: number = CHASE_PATH_END_SLACK,
): boolean {
  if (path.length === 0) return false;
  const end = path[path.length - 1];
  const dx = end.x - targetX;
  const dy = end.y - targetY;
  return dx * dx + dy * dy <= slack * slack;
}
