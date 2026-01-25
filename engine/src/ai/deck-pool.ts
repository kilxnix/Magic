/**
 * AI Deck Pool
 *
 * Manages prebuilt AI decks for different brackets.
 */

import type { GeneratedDeck } from '../cards/deck-loader';

/**
 * Prebuilt deck metadata.
 */
export interface PrebuiltDeck extends GeneratedDeck {
  minBracket: number;  // Minimum bracket this deck is suitable for
  maxBracket: number;  // Maximum bracket this deck is suitable for
  description: string; // Brief description of the deck's strategy
}

/**
 * Deck pool configuration.
 */
export interface DeckPoolConfig {
  decks: PrebuiltDeck[];
}

/**
 * AI Deck Pool manager.
 */
export class AIDeckPool {
  private decks: PrebuiltDeck[] = [];

  constructor(config?: DeckPoolConfig) {
    if (config) {
      this.decks = config.decks;
    }
  }

  /**
   * Add a deck to the pool.
   */
  addDeck(deck: PrebuiltDeck): void {
    this.decks.push(deck);
  }

  /**
   * Get all decks in the pool.
   */
  getAllDecks(): PrebuiltDeck[] {
    return [...this.decks];
  }

  /**
   * Get decks suitable for a specific bracket.
   */
  getDecksForBracket(bracket: number): PrebuiltDeck[] {
    return this.decks.filter(
      deck => deck.minBracket <= bracket && deck.maxBracket >= bracket
    );
  }

  /**
   * Get decks matching a color identity (subset check).
   */
  getDecksByColors(colors: string[]): PrebuiltDeck[] {
    const colorSet = new Set(colors.map(c => c.toUpperCase()));
    return this.decks.filter(deck => {
      const deckColors = deck.colors.map(c => c.toUpperCase());
      return deckColors.every(c => colorSet.has(c) || colorSet.size === 0);
    });
  }

  /**
   * Select a random deck suitable for the given bracket.
   */
  selectRandomDeck(bracket: number): PrebuiltDeck | null {
    const suitable = this.getDecksForBracket(bracket);
    if (suitable.length === 0) return null;
    return suitable[Math.floor(Math.random() * suitable.length)];
  }

  /**
   * Select multiple unique decks for AI opponents.
   */
  selectDecks(bracket: number, count: number): PrebuiltDeck[] {
    const suitable = this.getDecksForBracket(bracket);
    if (suitable.length === 0) return [];

    // Shuffle and take first N unique decks
    const shuffled = [...suitable].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }

  /**
   * Select decks avoiding a specific color identity (for variety).
   */
  selectDecksAvoidingColors(
    bracket: number,
    count: number,
    avoidColors: string[],
  ): PrebuiltDeck[] {
    const suitable = this.getDecksForBracket(bracket);
    const avoidSet = new Set(avoidColors.map(c => c.toUpperCase()));

    // Prefer decks with different colors
    const preferred = suitable.filter(deck => {
      const deckColors = deck.colors.map(c => c.toUpperCase());
      return !deckColors.some(c => avoidSet.has(c));
    });

    // Use preferred if available, otherwise fall back to all suitable
    const pool = preferred.length > 0 ? preferred : suitable;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }
}

/**
 * Create a prebuilt deck definition.
 */
export function createPrebuiltDeck(
  id: string,
  commander: string,
  list: string[],
  options: {
    colors: string[];
    bracket: number;
    minBracket?: number;
    maxBracket?: number;
    theme: string;
    description: string;
  },
): PrebuiltDeck {
  return {
    id,
    commander,
    list,
    colors: options.colors,
    bracket: options.bracket,
    minBracket: options.minBracket ?? options.bracket,
    maxBracket: options.maxBracket ?? options.bracket + 1,
    theme: options.theme,
    description: options.description,
  };
}

/**
 * Load a deck pool from JSON data.
 */
export function loadDeckPool(json: string): AIDeckPool {
  const data = JSON.parse(json) as { decks: PrebuiltDeck[] };
  return new AIDeckPool({ decks: data.decks });
}

/**
 * Serialize a deck pool to JSON.
 */
export function saveDeckPool(pool: AIDeckPool): string {
  return JSON.stringify({ decks: pool.getAllDecks() }, null, 2);
}
