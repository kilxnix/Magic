import { describe, expect, it } from 'vitest';

import { tokenizeOracleText } from './tokens';

describe('tokenizeOracleText', () => {
  it('tokenizes Lightning Bolt (damage + any target)', () => {
    const tokens = tokenizeOracleText('Lightning Bolt deals 3 damage to any target.');
    expect(tokens).toEqual([
      'lightning',
      'bolt',
      'deals',
      '3',
      'damage',
      'to',
      'any',
      'target',
      '.',
    ]);
  });

  it('tokenizes destroy clause with constraints', () => {
    const tokens = tokenizeOracleText('Destroy target creature an opponent controls.');
    expect(tokens).toEqual([
      'destroy',
      'target',
      'creature',
      'an',
      'opponent',
      'controls',
      '.',
    ]);
  });

  it('tokenizes ETB trigger (comma preserved)', () => {
    const tokens = tokenizeOracleText('When ~ enters the battlefield, draw a card.');
    expect(tokens).toEqual([
      'when',
      '~',
      'enters',
      'the',
      'battlefield',
      ',',
      'draw',
      'a',
      'card',
      '.',
    ]);
  });

  it('preserves mana symbols as a single token chunk', () => {
    const tokens = tokenizeOracleText('{1}{R}: Deal 1 damage to any target.');
    expect(tokens).toEqual([
      '{1}{r}',
      ':',
      'deal',
      '1',
      'damage',
      'to',
      'any',
      'target',
      '.',
    ]);
  });
});
