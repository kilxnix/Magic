import { describe, expect, it } from 'vitest';
import { importStandardDeckLocally } from '../src/lib/standardDeckImport';

describe('importStandardDeckLocally', () => {
  it('parses a Standard main deck and sideboard without a backend', () => {
    const text = [
      '4 Monastery Swiftspear (BRO) 144',
      '4 Lightning Strike',
      '4 Kumano Faces Kakkazan',
      '4 Play with Fire',
      '4 Phoenix Chick',
      '4 Bloodthirsty Adversary',
      '4 Squee, Dubious Monarch',
      '4 Mishra\'s Foundry',
      '4 Feldon, Ronom Excavator',
      '4 Stoke the Flames',
      '20 Mountain',
      '',
      'Sideboard',
      '3 Lithomantic Barrage',
      '2 Witchstalker Frenzy',
    ].join('\n');

    const result = importStandardDeckLocally(text);

    expect(result.valid).toBe(true);
    expect(result.mainDeck).toHaveLength(60);
    expect(result.sideboard).toHaveLength(5);
    expect(result.total).toBe(60);
    expect(result.mainDeck.filter(card => card === 'Monastery Swiftspear')).toHaveLength(4);
  });

  it('reports local constructed validation errors instead of throwing', () => {
    const text = [
      '5 Lightning Strike',
      '54 Mountain',
      'SB: 1 Lightning Strike',
    ].join('\n');

    const result = importStandardDeckLocally(text);

    expect(result.valid).toBe(false);
    expect(result.mainDeck).toHaveLength(59);
    expect(result.sideboard).toEqual(['Lightning Strike']);
    expect(result.errors.join(' ')).toContain('Main deck has 59 cards');
    expect(result.errors.join(' ')).toContain('Lightning Strike has 6 copies');
  });
});
