import { describe, expect, it } from 'vitest';
import { importDeckUrlLocally } from '../src/lib/deckUrlImport';
import { importStandardDeckLocally } from '../src/lib/standardDeckImport';

describe('importDeckUrlLocally', () => {
  it('loads the MTGGoldfish Mono-Green Landfall archetype as a Standard deck', () => {
    const result = importDeckUrlLocally(
      'https://www.mtggoldfish.com/archetype/standard-mono-green-landfall-woe#paper',
    );

    expect(result?.format).toBe('standard');
    expect(result?.title).toBe('Mono-Green Landfall');
    expect(result?.deckText).toContain('4 Badgermole Cub');
    expect(result?.deckText).toContain('Sideboard');

    const deck = importStandardDeckLocally(result!.deckText);
    expect(deck.valid).toBe(true);
    expect(deck.mainDeck).toHaveLength(60);
    expect(deck.sideboard).toHaveLength(15);
  });

  it('also recognizes the resolved MTGGoldfish deck page id', () => {
    const result = importDeckUrlLocally('https://www.mtggoldfish.com/deck/7752458#paper');

    expect(result?.format).toBe('standard');
    expect(result?.deckText).toContain('13 Forest');
  });
});
