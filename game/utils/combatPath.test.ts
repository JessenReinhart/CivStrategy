import { describe, it, expect } from 'vitest';
import {
  findResumePathStep,
  shouldRepathChase,
  stalePathAction,
  pathEndNearTarget,
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
    // Unit is near waypoint 2
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
    // Old bug: dist<200 used 150ms recalc → thrash
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

  it('repaths when path exhausted while still out of range', () => {
    expect(
      shouldRepathChase({
        path: basePath,
        pathStep: 3,
        timeSinceRecalc: 50,
        targetMoved: 0,
        distToTarget: 200,
        range: 40,
      }),
    ).toBe(true);
  });

  it('repaths when no path', () => {
    expect(
      shouldRepathChase({
        path: null,
        pathStep: 0,
        timeSinceRecalc: 0,
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
          { x: 80, y: 0 }, // 30 px from target at 110,0 — within range slack but far enough to need repath
        ],
        pathStep: 1,
        timeSinceRecalc: CHASE_REPATH_FAR_MS,
        targetMoved: 0,
        distToTarget: 70, // outside 40 range
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
          { x: 70, y: 0 }, // 20 px from target at 90,0
        ],
        pathStep: 1,
        timeSinceRecalc: CHASE_REPATH_FAR_MS,
        targetMoved: 0,
        distToTarget: 45, // only 5 past range, final approach guard keeps path alive
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
