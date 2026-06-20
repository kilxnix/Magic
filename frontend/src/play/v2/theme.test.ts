import { describe, expect, it } from 'vitest';
import { TABLE, MANA, manaHex } from './theme';

describe('v2 theme tokens', () => {
  it('exposes the locked felt + leather hexes', () => {
    expect(TABLE.felt).toBe('#14251c');
    expect(TABLE.leather).toBe('#281c10');
  });
  it('maps mana colors to hex, defaulting colorless to the black token', () => {
    expect(manaHex('G')).toBe(MANA.G);
    expect(manaHex('C')).toBe('#bfb39a');
  });
});
