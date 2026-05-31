import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheClear, cacheGet, cacheSet } from './cache';

describe('cache helpers', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
    });
  });

  it('does not throw when localStorage is unavailable', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
    });

    expect(() => cacheSet('missing-storage', { ok: true })).not.toThrow();
    expect(cacheGet('missing-storage')).toBeNull();
    expect(() => cacheClear('missing-storage')).not.toThrow();
  });
});
