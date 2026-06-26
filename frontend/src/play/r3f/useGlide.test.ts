import { describe, expect, it } from 'vitest';
import { stepToward } from './useGlide';

describe('stepToward', () => {
  it('moves partway toward the target', () => {
    const next = stepToward([0, 0, 0], [10, 0, 0], 0.1, 5); // 0.1*5 = 0.5 fraction
    expect(next[0]).toBeCloseTo(5);
  });
  it('snaps to target when very close', () => {
    const next = stepToward([9.999, 0, 0], [10, 0, 0], 0.016, 5);
    expect(next).toEqual([10, 0, 0]);
  });
  it('does not overshoot', () => {
    const next = stepToward([0, 0, 0], [1, 0, 0], 1, 100);
    expect(next[0]).toBeLessThanOrEqual(1);
  });
});
