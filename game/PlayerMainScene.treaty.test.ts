import { describe, expect, it } from 'vitest';

import { treatyMinutesToMilliseconds } from './treatyDuration';

describe('treaty duration conversion', () => {
  it('converts configured treaty minutes to simulation milliseconds', () => {
    expect(treatyMinutesToMilliseconds(10)).toBe(10 * 60 * 1000);
  });

  it('keeps zero or missing treaty configuration immediately combat-eligible', () => {
    expect(treatyMinutesToMilliseconds(0)).toBe(0);
    expect(treatyMinutesToMilliseconds(undefined)).toBe(0);
  });

  it('clamps invalid negative or non-finite treaty values to zero', () => {
    expect(treatyMinutesToMilliseconds(-5)).toBe(0);
    expect(treatyMinutesToMilliseconds(Number.NaN)).toBe(0);
    expect(treatyMinutesToMilliseconds(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
