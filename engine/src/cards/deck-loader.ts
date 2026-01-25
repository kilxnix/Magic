/**
 * Deck Loader
 *
 * Converts deck generator output to game engine format.
 */

import type { CardDefinition, CardType, ManaColor } from '../types';

/**
 * Scryfall card data format (from cards_min.jsonl).
 */
export interface ScryfallCard {
  id: string;
  name: string;
  type_line: string;
  oracle_text: string;
  mana_cost: string;
  cmc: string | number;
  colors: string[];
  color_identity: string[];
  keywords: string[];
  power?: string;
  toughness?: string;
  legalities?: Record<string, string>;
  rarity?: string;
  prices?: Record<string, string | null>;
}

/**
 * Generated deck format from the deck generator API.
 */
export interface GeneratedDeck {
  id: string;
  commander: string;        // Commander card name
  list: string[];           // 99 card names (excluding commander)
  colors: string[];
  bracket: number;
  theme: string;
}

/**
 * Deck ready for game engine initialization.
 */
export interface EngineDeck {
  commander: CardDefinition;
  library: CardDefinition[];
}

/**
 * Card lookup function signature.
 */
export type CardLookup = (name: string) => ScryfallCard | undefined;

/**
 * Valid mana colors for type conversion.
 */
const MANA_COLORS = new Set(['W', 'U', 'B', 'R', 'G', 'C']);

/**
 * Convert color string array to typed ManaColor array.
 */
function toManaColors(colors: string[]): ManaColor[] {
  return colors.filter(c => MANA_COLORS.has(c)) as ManaColor[];
}

/**
 * Parse card types from type line.
 */
function parseCardTypes(typeLine: string): CardType[] {
  const types: CardType[] = [];
  const lower = typeLine.toLowerCase();

  if (lower.includes('creature')) types.push('creature');
  if (lower.includes('instant')) types.push('instant');
  if (lower.includes('sorcery')) types.push('sorcery');
  if (lower.includes('artifact')) types.push('artifact');
  if (lower.includes('enchantment')) types.push('enchantment');
  if (lower.includes('planeswalker')) types.push('planeswalker');
  if (lower.includes('land')) types.push('land');
  if (lower.includes('battle')) types.push('battle');

  return types;
}

/**
 * Parse power/toughness string to number (handles '*' as 0).
 */
function parsePT(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const num = parseInt(value, 10);
  return isNaN(num) ? 0 : num;
}

/**
 * Convert a Scryfall card to an engine CardDefinition.
 */
export function convertCard(card: ScryfallCard): CardDefinition {
  const cmc = typeof card.cmc === 'string' ? parseFloat(card.cmc) : card.cmc;

  return {
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text || '',
    mana_cost: card.mana_cost || '',
    cmc: Math.floor(cmc),
    colors: toManaColors(card.colors || []),
    color_identity: toManaColors(card.color_identity || []),
    keywords: card.keywords || [],
    card_types: parseCardTypes(card.type_line),
    power: parsePT(card.power),
    toughness: parsePT(card.toughness),
  };
}

/**
 * Convert a generated deck to engine format.
 *
 * @param deck - The generated deck from the deck generator
 * @param lookup - Function to look up card data by name
 * @returns Engine-ready deck with commander and library
 * @throws Error if commander not found or card count is wrong
 */
export function convertGeneratedDeck(
  deck: GeneratedDeck,
  lookup: CardLookup,
): EngineDeck {
  // Look up commander
  const commanderCard = lookup(deck.commander);
  if (!commanderCard) {
    throw new Error(`Commander not found: ${deck.commander}`);
  }

  // Validate card count (99 cards + 1 commander = 100)
  if (deck.list.length !== 99) {
    throw new Error(
      `Invalid deck size: expected 99 cards, got ${deck.list.length}`,
    );
  }

  // Convert all cards
  const commander = convertCard(commanderCard);
  const library: CardDefinition[] = [];
  const missingCards: string[] = [];

  for (const cardName of deck.list) {
    const card = lookup(cardName);
    if (!card) {
      missingCards.push(cardName);
      continue;
    }
    library.push(convertCard(card));
  }

  if (missingCards.length > 0) {
    throw new Error(
      `Cards not found: ${missingCards.slice(0, 5).join(', ')}${missingCards.length > 5 ? ` (and ${missingCards.length - 5} more)` : ''}`,
    );
  }

  return { commander, library };
}

/**
 * Create a card lookup function from a card database array.
 */
export function createCardLookup(cards: ScryfallCard[]): CardLookup {
  const byName = new Map<string, ScryfallCard>();

  for (const card of cards) {
    // Store by normalized name (lowercase)
    byName.set(card.name.toLowerCase(), card);
  }

  return (name: string) => byName.get(name.toLowerCase());
}

/**
 * Load cards from JSONL content (for browser/mobile use).
 */
export function parseCardsJsonl(jsonlContent: string): ScryfallCard[] {
  const cards: ScryfallCard[] = [];

  for (const line of jsonlContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      cards.push(JSON.parse(trimmed) as ScryfallCard);
    } catch {
      // Skip invalid lines
    }
  }

  return cards;
}
