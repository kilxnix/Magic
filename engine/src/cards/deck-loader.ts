/**
 * Deck Loader
 *
 * Converts deck generator output to game engine format.
 */

import type { CardDefinition, CardType, ManaColor } from '../types';
import { populateParsedCache } from './card-parser-cache';

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
  sideboard?: string[];      // Constructed sideboard. Not part of the starting library.
  colors: string[];
  bracket: number;
  theme: string;
}

/**
 * Deck ready for game engine initialization.
 */
export interface EngineDeck {
  commander?: CardDefinition;
  library: CardDefinition[];
  sideboard: CardDefinition[];
}

/**
 * Card lookup function signature.
 */
export type CardLookup = (name: string) => ScryfallCard | undefined;

/**
 * Basic land names by color identity.
 */
const BASIC_LANDS: Record<string, string> = {
  'W': 'Plains', 'U': 'Island', 'B': 'Swamp', 'R': 'Mountain', 'G': 'Forest',
};

/**
 * Valid mana colors for type conversion.
 */
const MANA_COLORS = new Set(['W', 'U', 'B', 'R', 'G', 'C']);

function resolveCommanderNames(commander: string, lookup: CardLookup): string[] {
  if (lookup(commander)) {
    return [commander];
  }
  return commander.includes(' // ')
    ? commander.split(' // ').map(n => n.trim()).filter(Boolean)
    : [commander];
}

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

  const baseDef: CardDefinition = {
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

  return populateParsedCache(baseDef);
}

function convertSideboard(cardNames: string[], lookup: CardLookup): CardDefinition[] {
  const sideboard: CardDefinition[] = [];
  const missingCards: string[] = [];

  for (const cardName of cardNames) {
    const card = lookup(cardName);
    if (!card) {
      missingCards.push(cardName);
      continue;
    }
    sideboard.push(convertCard(card));
  }

  if (missingCards.length > 0) {
    throw new Error(
      `Sideboard cards not found: ${missingCards.slice(0, 5).join(', ')}${missingCards.length > 5 ? ` (and ${missingCards.length - 5} more)` : ''}`,
    );
  }

  return sideboard;
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
  const commanderNames = resolveCommanderNames(deck.commander, lookup);

  // Look up primary commander (first partner)
  const commanderCard = lookup(commanderNames[0]);
  if (!commanderCard) {
    throw new Error(`Commander not found: ${commanderNames[0]}`);
  }

  // Pad short decks with basic lands (handles decks saved without lands)
  const deckList = [...deck.list];
  // For partners, the target library size is 100 - number_of_commanders
  const targetLibrarySize = 100 - commanderNames.length;
  if (deckList.length < targetLibrarySize) {
    const colors = deck.colors.length > 0 ? deck.colors : ['U'];
    const deficit = targetLibrarySize - deckList.length;
    const landsPerColor = Math.floor(deficit / colors.length);
    const remainder = deficit % colors.length;
    for (let i = 0; i < colors.length; i++) {
      const landName = BASIC_LANDS[colors[i]] || 'Island';
      const count = landsPerColor + (i < remainder ? 1 : 0);
      for (let j = 0; j < count; j++) {
        deckList.push(landName);
      }
    }
  }

  // Convert all cards
  const commander = convertCard(commanderCard);
  const library: CardDefinition[] = [];

  // Add second partner to the library (it will be a playable card)
  if (commanderNames.length > 1) {
    const partnerCard = lookup(commanderNames[1]);
    if (partnerCard) {
      library.push(convertCard(partnerCard));
    }
  }
  const missingCards: string[] = [];

  for (const cardName of deckList) {
    const card = lookup(cardName);
    if (!card) {
      missingCards.push(cardName);
      continue;
    }
    library.push(convertCard(card));
  }

  // Log missing cards but don't throw — continue with what we have
  if (missingCards.length > 0 && library.length >= 60) {
    // Pad remaining slots with basic lands
    const colors = deck.colors.length > 0 ? deck.colors : ['U'];
    const landName = BASIC_LANDS[colors[0]] || 'Island';
    const landCard = lookup(landName);
    if (landCard) {
      while (library.length < 99) {
        library.push(convertCard(landCard));
      }
    }
  } else if (missingCards.length > 0) {
    throw new Error(
      `Cards not found: ${missingCards.slice(0, 5).join(', ')}${missingCards.length > 5 ? ` (and ${missingCards.length - 5} more)` : ''}`,
    );
  }

  return { commander, library, sideboard: convertSideboard(deck.sideboard || [], lookup) };
}

/**
 * Convert a Limited deck to engine format.
 *
 * Limited decks have no commander and use the full deck list as the library.
 */
export function convertLimitedDeck(
  deck: GeneratedDeck,
  lookup: CardLookup,
): EngineDeck {
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

  if (library.length < 40) {
    throw new Error(`Limited deck must contain at least 40 cards, got ${library.length}`);
  }

  return { library, sideboard: convertSideboard(deck.sideboard || [], lookup) };
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
