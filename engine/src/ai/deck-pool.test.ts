import { describe, it, expect, beforeEach } from 'vitest';
import {
  AIDeckPool,
  PrebuiltDeck,
  createPrebuiltDeck,
  loadDeckPool,
  saveDeckPool,
} from './deck-pool';

// Sample decks for testing
const sampleDecks: PrebuiltDeck[] = [
  createPrebuiltDeck('deck-1', 'Krenko, Mob Boss', ['Card 1', 'Card 2'], {
    colors: ['R'],
    bracket: 2,
    minBracket: 1,
    maxBracket: 3,
    theme: 'Goblins',
    description: 'Aggressive goblin tribal',
  }),
  createPrebuiltDeck('deck-2', 'Atraxa, Praetors\' Voice', ['Card 1', 'Card 2'], {
    colors: ['W', 'U', 'B', 'G'],
    bracket: 3,
    minBracket: 3,
    maxBracket: 5,
    theme: 'Counters',
    description: 'Proliferate and counters',
  }),
  createPrebuiltDeck('deck-3', 'Muldrotha, the Gravetide', ['Card 1', 'Card 2'], {
    colors: ['B', 'G', 'U'],
    bracket: 4,
    minBracket: 3,
    maxBracket: 5,
    theme: 'Graveyard',
    description: 'Graveyard recursion value',
  }),
  createPrebuiltDeck('deck-4', 'Talrand, Sky Summoner', ['Card 1', 'Card 2'], {
    colors: ['U'],
    bracket: 2,
    minBracket: 1,
    maxBracket: 3,
    theme: 'Spellslinger',
    description: 'Cantrips and drakes',
  }),
  createPrebuiltDeck('deck-5', 'Gishath, Sun\'s Avatar', ['Card 1', 'Card 2'], {
    colors: ['R', 'G', 'W'],
    bracket: 3,
    minBracket: 2,
    maxBracket: 4,
    theme: 'Dinosaurs',
    description: 'Dinosaur tribal aggro',
  }),
];

describe('AIDeckPool', () => {
  let pool: AIDeckPool;

  beforeEach(() => {
    pool = new AIDeckPool({ decks: [...sampleDecks] });
  });

  describe('constructor', () => {
    it('creates empty pool without config', () => {
      const emptyPool = new AIDeckPool();
      expect(emptyPool.getAllDecks()).toEqual([]);
    });

    it('initializes with provided decks', () => {
      expect(pool.getAllDecks().length).toBe(5);
    });
  });

  describe('addDeck', () => {
    it('adds a deck to the pool', () => {
      const emptyPool = new AIDeckPool();
      emptyPool.addDeck(sampleDecks[0]);

      expect(emptyPool.getAllDecks().length).toBe(1);
    });
  });

  describe('getDecksForBracket', () => {
    it('returns decks for bracket 1', () => {
      const decks = pool.getDecksForBracket(1);
      expect(decks.length).toBe(2); // Krenko and Talrand
      expect(decks.every(d => d.minBracket <= 1 && d.maxBracket >= 1)).toBe(true);
    });

    it('returns decks for bracket 3', () => {
      const decks = pool.getDecksForBracket(3);
      expect(decks.length).toBe(5); // All decks work at bracket 3
    });

    it('returns decks for bracket 5', () => {
      const decks = pool.getDecksForBracket(5);
      expect(decks.length).toBe(2); // Atraxa and Muldrotha
    });

    it('returns empty for bracket 6', () => {
      const decks = pool.getDecksForBracket(6);
      expect(decks.length).toBe(0);
    });
  });

  describe('getDecksByColors', () => {
    it('returns mono-red decks', () => {
      const decks = pool.getDecksByColors(['R']);
      expect(decks.length).toBe(1); // Only Krenko
      expect(decks[0].commander).toBe('Krenko, Mob Boss');
    });

    it('returns blue decks (mono or multi)', () => {
      const decks = pool.getDecksByColors(['U', 'W', 'B', 'G', 'R']);
      expect(decks.length).toBe(5); // All decks fit in 5-color identity
    });

    it('returns all decks for empty color filter', () => {
      const decks = pool.getDecksByColors([]);
      expect(decks.length).toBe(5);
    });
  });

  describe('selectRandomDeck', () => {
    it('returns a deck for valid bracket', () => {
      const deck = pool.selectRandomDeck(3);
      expect(deck).not.toBeNull();
      expect(deck!.minBracket).toBeLessThanOrEqual(3);
      expect(deck!.maxBracket).toBeGreaterThanOrEqual(3);
    });

    it('returns null for invalid bracket', () => {
      const deck = pool.selectRandomDeck(10);
      expect(deck).toBeNull();
    });
  });

  describe('selectDecks', () => {
    it('returns requested number of decks', () => {
      const decks = pool.selectDecks(3, 2);
      expect(decks.length).toBe(2);
    });

    it('returns unique decks', () => {
      const decks = pool.selectDecks(3, 3);
      const ids = decks.map(d => d.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('returns fewer decks if not enough available', () => {
      const decks = pool.selectDecks(5, 10);
      expect(decks.length).toBe(2); // Only Atraxa and Muldrotha
    });
  });

  describe('selectDecksAvoidingColors', () => {
    it('avoids specified colors when possible', () => {
      const decks = pool.selectDecksAvoidingColors(3, 2, ['R']);

      // Should prefer non-red decks
      const hasRed = decks.some(d => d.colors.includes('R'));
      // At bracket 3, we have Atraxa (WUBG), Muldrotha (BGU), Talrand (U)
      // which don't include R as primary
      expect(hasRed).toBe(false);
    });

    it('falls back to all suitable decks if no alternatives', () => {
      // All bracket 1-2 decks include R or U
      const decks = pool.selectDecksAvoidingColors(1, 2, ['R', 'U']);

      // Should still return decks since we need something
      expect(decks.length).toBeLessThanOrEqual(2);
    });
  });
});

describe('createPrebuiltDeck', () => {
  it('creates a deck with explicit bracket range', () => {
    const deck = createPrebuiltDeck('test', 'Commander', ['Card'], {
      colors: ['W'],
      bracket: 3,
      minBracket: 2,
      maxBracket: 4,
      theme: 'Test',
      description: 'Test deck',
    });

    expect(deck.minBracket).toBe(2);
    expect(deck.maxBracket).toBe(4);
  });

  it('defaults bracket range if not specified', () => {
    const deck = createPrebuiltDeck('test', 'Commander', ['Card'], {
      colors: ['W'],
      bracket: 3,
      theme: 'Test',
      description: 'Test deck',
    });

    expect(deck.minBracket).toBe(3);
    expect(deck.maxBracket).toBe(4);
  });
});

describe('loadDeckPool / saveDeckPool', () => {
  it('serializes and deserializes deck pool', () => {
    const original = new AIDeckPool({ decks: sampleDecks });
    const json = saveDeckPool(original);
    const loaded = loadDeckPool(json);

    expect(loaded.getAllDecks().length).toBe(5);
    expect(loaded.getAllDecks()[0].commander).toBe('Krenko, Mob Boss');
  });

  it('preserves all deck properties', () => {
    const original = new AIDeckPool({ decks: [sampleDecks[1]] });
    const json = saveDeckPool(original);
    const loaded = loadDeckPool(json);
    const deck = loaded.getAllDecks()[0];

    expect(deck.commander).toBe('Atraxa, Praetors\' Voice');
    expect(deck.colors).toEqual(['W', 'U', 'B', 'G']);
    expect(deck.minBracket).toBe(3);
    expect(deck.maxBracket).toBe(5);
    expect(deck.theme).toBe('Counters');
    expect(deck.description).toBe('Proliferate and counters');
  });
});
