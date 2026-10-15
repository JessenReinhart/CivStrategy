import { describe, it, expect } from 'vitest';
import {
  findResumePathStep,
  shouldRepathChase,
  stalePathAction,
  pathEndNearTarget,
  predictChaseInterceptPoint,
  CHASE_REPATH_MIN_MS,
  CHASE_REPATH_FAR_MS,
  CHASE_TARGET_MOVE_THRESH,
} from './combatPath';

describe('findResumePathStep', () => {
  const path = [
    { x: 0, y: 0 },
    { x: 32, y: 0 },
    { x: 64, y: 0 },
    { x: 96, y: 0 },
    { x: 128, y: 0 },
  ];

  it('does not force step 0 when unit is mid-path', () => {
    const step = findResumePathStep(path, 60, 2);
    expect(step).toBeGreaterThanOrEqual(2);
    expect(step).toBeLessThan(path.length);
  });

  it('advances past a waypoint the unit is already on', () => {
    const step = findResumePathStep(path, 64, 0);
    expect(step).toBe(3);
  });

  it('returns 0 for single-point path', () => {
    expect(findResumePathStep([{ x: 10, y: 10 }], 10, 10)).toBe(0);
  });
});

describe('shouldRepathChase', () => {
  const basePath = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
  ];

  it('does not repath every 150ms while path is valid and target steady', () => {
    expect(
      shouldRepathChase({
        path: basePath,
        pathStep: 1,
        timeSinceRecalc: 150,
        targetMoved: 5,
        distToTarget: 180,
        range: 40,
      }),
    ).toBe(false);
  });

  it('does not repath when just outside attack range', () => {
    expect(shouldRepathChase({
      path: basePath,
      pathStep: 1,
      timeSinceRecalc: CHASE_REPATH_FAR_MS,
      targetMoved: CHASE_TARGET_MOVE_THRESH + 100,
      distToTarget: 44,
      range: 40,
    })).toBe(false);
  });

  it('backs off exhausted-path retries until the minimum interval', () => {
    expect(
      shouldRepathChase({
        path: basePath,
        pathStep: 3,
        timeSinceRecalc: CHASE_REPATH_MIN_MS - 1,
        targetMoved: 0,
        distToTarget: 200,
        range: 40,
      }),
    ).toBe(false);

    expect(
      shouldRepathChase({
        path: basePath,
        pathStep: 3,
        timeSinceRecalc: CHASE_REPATH_MIN_MS,
        targetMoved: 0,
        distToTarget: 200,
        range: 40,
      }),
    ).toBe(true);
  });

  it('backs off failed no-path retries until the minimum interval', () => {
    expect(
      shouldRepathChase({
        path: null,
        pathStep: 0,
        timeSinceRecalc: 0,
        targetMoved: 0,
        distToTarget: 400,
        range: 40,
      }),
    ).toBe(false);

    expect(
      shouldRepathChase({
        path: null,
        pathStep: 0,
        timeSinceRecalc: CHASE_REPATH_MIN_MS,
        targetMoved: 0,
        distToTarget: 400,
        range: 40,
      }),
    ).toBe(true);
  });

  it('repaths when target moved far enough after min interval', () => {
    expect(
      shouldRepathChase({
        path: basePath,
        pathStep: 1,
        timeSinceRecalc: CHASE_REPATH_MIN_MS,
        targetMoved: CHASE_TARGET_MOVE_THRESH,
        distToTarget: 300,
        range: 40,
      }),
    ).toBe(true);
  });

  it('does not repath for target move before min interval', () => {
    expect(
      shouldRepathChase({
        path: basePath,
        pathStep: 1,
        timeSinceRecalc: 100,
        targetMoved: CHASE_TARGET_MOVE_THRESH + 10,
        distToTarget: 300,
        range: 40,
      }),
    ).toBe(false);
  });

  it('periodic far repath after long interval', () => {
    expect(
      shouldRepathChase({
        path: basePath,
        pathStep: 1,
        timeSinceRecalc: CHASE_REPATH_FAR_MS,
        targetMoved: 0,
        distToTarget: 500,
        range: 40,
      }),
    ).toBe(true);
  });

  it('never repaths while in attack range', () => {
    expect(
      shouldRepathChase({
        path: null,
        pathStep: 0,
        timeSinceRecalc: 9999,
        targetMoved: 999,
        distToTarget: 30,
        range: 40,
      }),
    ).toBe(false);
  });

  it('repaths when target is just outside attack range and path end is not near target', () => {
    expect(
      shouldRepathChase({
        path: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 80, y: 0 },
        ],
        pathStep: 1,
        timeSinceRecalc: CHASE_REPATH_FAR_MS,
        targetMoved: 0,
        distToTarget: 70,
        range: 40,
      }),
    ).toBe(true);
  });

  it('does not repath when final approach is within a few pixels of range even after far interval', () => {
    expect(
      shouldRepathChase({
        path: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 70, y: 0 },
        ],
        pathStep: 1,
        timeSinceRecalc: CHASE_REPATH_FAR_MS,
        targetMoved: 0,
        distToTarget: 45,
        range: 40,
      }),
    ).toBe(false);
  });
});

describe('stalePathAction', () => {
  it('keeps fresh paths', () => {
    expect(stalePathAction(1000, 5000, true)).toBe('keep');
  });

  it('clears for repath when chasing (does not idle)', () => {
    expect(stalePathAction(6000, 5000, true)).toBe('clear_repath');
  });

  it('clears to idle when not in combat', () => {
    expect(stalePathAction(6000, 5000, false)).toBe('clear_idle');
  });
});

describe('pathEndNearTarget', () => {
  it('true when end near target', () => {
    expect(pathEndNearTarget([{ x: 0, y: 0 }, { x: 100, y: 100 }], 110, 95, 48)).toBe(true);
  });

  it('false when end far from target', () => {
    expect(pathEndNearTarget([{ x: 0, y: 0 }, { x: 100, y: 100 }], 300, 300, 48)).toBe(false);
  });
});

describe('predictChaseInterceptPoint', () => {
  it('returns target position when target is static or chaser is stopped', () => {
    expect(predictChaseInterceptPoint(0, 0, 100, 50, 50, 0, 0)).toEqual({ x: 50, y: 50 });
    expect(predictChaseInterceptPoint(0, 0, 0, 50, 50, 20, 20)).toEqual({ x: 50, y: 50 });
  });

  it('leads ahead along the target velocity vector for moving targets', () => {
    // Distance 100, chaser speed 100 => 1.0s lead time
    const intercept = predictChaseInterceptPoint(0, 0, 100, 100, 0, 50, 0);
    expect(intercept.x).toBeCloseTo(150, 5);
    expect(intercept.y).toBeCloseTo(0, 5);
  });

  it('clamps lead time to maxLeadSec for far targets', () => {
    // Distance 1000, speed 100 => 10s uncontrolled lead, clamped to maxLeadSec 2.0s
    const intercept = predictChaseInterceptPoint(0, 0, 100, 1000, 0, 30, 0, 2.0);
    expect(intercept.x).toBeCloseTo(1060, 5);
    expect(intercept.y).toBeCloseTo(0, 5);
  });
});
