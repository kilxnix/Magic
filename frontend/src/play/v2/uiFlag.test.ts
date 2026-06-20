import { describe, expect, it } from 'vitest';
import { isPlayUiV2 } from './uiFlag';

describe('isPlayUiV2', () => {
  it('is true when ui=v2 is in the query', () => {
    expect(isPlayUiV2('?ui=v2')).toBe(true);
    expect(isPlayUiV2('?ui=v1')).toBe(false);
    expect(isPlayUiV2('')).toBe(false);
  });
});
