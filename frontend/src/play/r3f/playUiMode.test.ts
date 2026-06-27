import { describe, expect, it, afterEach } from 'vitest';
import { getPlayUiMode, usesPlayExperience } from './playUiMode';

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

describe('usesPlayExperience', () => {
  // PlayPage hosts the rebuilt PlayExperience shells (v2 + 3d) behind this gate;
  // 'v1' / no flag keeps the legacy <GameBoard>. The 3d shell lives inside
  // PlayExperience, so ?ui=3d MUST flip this gate or the shell is unreachable.
  it('enables the new UI for every PlayExperience-hosted mode', () => {
    expect(usesPlayExperience('?ui=v2')).toBe(true);
    expect(usesPlayExperience('?ui=3d')).toBe(true);
    expect(usesPlayExperience('?newui=1')).toBe(true);
  });

  it('keeps the legacy board for v1 / no flag', () => {
    expect(usesPlayExperience('?ui=v1')).toBe(false);
    expect(usesPlayExperience('')).toBe(false);
  });

  it('honors newui=1 even when ui names a legacy mode', () => {
    expect(usesPlayExperience('?newui=1&ui=v1')).toBe(true);
  });
});
