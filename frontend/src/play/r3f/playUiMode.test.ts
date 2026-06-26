import { describe, expect, it, afterEach } from 'vitest';
import { getPlayUiMode } from './playUiMode';

afterEach(() => localStorage.removeItem('mb.play.ui'));

describe('getPlayUiMode', () => {
  it('reads the ui query param', () => {
    expect(getPlayUiMode('?ui=3d')).toBe('3d');
    expect(getPlayUiMode('?ui=v2')).toBe('v2');
    expect(getPlayUiMode('?ui=v1')).toBe('v1');
  });

  it('defaults to v1 when nothing is set', () => {
    expect(getPlayUiMode('')).toBe('v1');
  });

  it('falls back to localStorage when no query param', () => {
    localStorage.setItem('mb.play.ui', '3d');
    expect(getPlayUiMode('')).toBe('3d');
  });

  it('query param wins over localStorage', () => {
    localStorage.setItem('mb.play.ui', '3d');
    expect(getPlayUiMode('?ui=v2')).toBe('v2');
  });
});
