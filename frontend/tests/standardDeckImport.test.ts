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

  it('handles category headers, MTGO set prefixes, tags, and inline notes', () => {
    const text = [
      'Name Red Deck Wins',
      'Creatures (8)',
      '4 [BRO:144] Monastery Swiftspear *F* # threat',
      '4x Phoenix Chick [DMU] 140',
      'Instants (8)',
      '4 Lightning Strike (DMU) 137',
      '4 Play with Fire',
      'Lands (44)',
      '44 Mountain',
      'Sideboard (2)',
      'SB 2 Witchstalker Frenzy',
      'Maybeboard',
      '4 Stoke the Flames',
    ].join('\n');

    const result = importStandardDeckLocally(text);

    expect(result.valid).toBe(true);
    expect(result.mainDeck).toHaveLength(60);
    expect(result.sideboard).toEqual(['Witchstalker Frenzy', 'Witchstalker Frenzy']);
    expect(result.mainDeck.filter(card => card === 'Monastery Swiftspear')).toHaveLength(4);
    expect(result.mainDeck).not.toContain('Name Red Deck Wins');
    expect(result.mainDeck).not.toContain('Stoke the Flames');
  });

  it('caps impossible quantities without allocating runaway arrays', () => {
    const result = importStandardDeckLocally('999999 Mountain');

    expect(result.mainDeck).toHaveLength(250);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('capped');
  });

  it('allows more than four Snow-Covered basics', () => {
    const result = importStandardDeckLocally('60 Snow-Covered Island');

    expect(result.valid).toBe(true);
    expect(result.mainDeck).toHaveLength(60);
    expect(result.mainDeck.filter(card => card === 'Snow-Covered Island')).toHaveLength(60);
  });
});
