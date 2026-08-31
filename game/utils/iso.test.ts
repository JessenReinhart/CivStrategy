import { describe, expect, it } from 'vitest';

import { toCartesianElev, toIsoElev } from './iso';

describe('terrain-aware isometric pointer projection', () => {
  it('round-trips a point on elevated terrain', () => {
    const source = { x: 480, y: 360 };
    const terrainHeight = 0.72;
    const screen = toIsoElev(source.x, source.y, terrainHeight);

    const picked = toCartesianElev(screen.x, screen.y, () => terrainHeight);

    expect(picked.x).toBeCloseTo(source.x, 1);
    expect(picked.y).toBeCloseTo(source.y, 1);
  });

  it('still behaves like flat inverse projection below the elevation reference', () => {
    const source = { x: 240, y: 192 };
    const terrainHeight = 0.30;
    const screen = toIsoElev(source.x, source.y, terrainHeight);

    const picked = toCartesianElev(screen.x, screen.y, () => terrainHeight);

    expect(picked.x).toBeCloseTo(source.x, 5);
    expect(picked.y).toBeCloseTo(source.y, 5);
  });

  it('converges when terrain height changes along the pointer ray', () => {
    const getHeight = (x: number, y: number) => 0.45 + x * 0.0002 + y * 0.0001;
    const source = { x: 560, y: 420 };
    const screen = toIsoElev(source.x, source.y, getHeight(source.x, source.y));

    const picked = toCartesianElev(screen.x, screen.y, getHeight);

    expect(picked.x).toBeCloseTo(source.x, 0);
    expect(picked.y).toBeCloseTo(source.y, 0);
  });
});
