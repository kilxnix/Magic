/**
 * Deck Loader
 *
 * Converts deck generator output to game engine format.
 */

import type { CardDefinition, CardDefinitionFace, CardType, ManaColor } from '../types';
import { populateParsedCache } from './card-parser-cache';
import { parseCardTypesFromTypeLine, typeLineHasSupertype, typeLineHasType } from '../type-line';

/**
 * Scryfall card face data format (from cards_min.jsonl card_faces).
 */
export interface ScryfallCardFace {
  name: string;
  type_line?: string;
  oracle_text?: string | null;
  mana_cost?: string | null;
  colors?: string[] | null;
  power?: string | null;
  toughness?: string | null;
}

/**
 * Scryfall card data format (from cards_min.jsonl).
 */
export interface ScryfallCard {
  id: string;
  name: string;
  type_line: string;
  oracle_text: string | null;
  mana_cost: string | null;
  cmc: string | number;
  colors: string[] | null;
  color_identity: string[] | null;
  keywords: string[] | null;
  power?: string | null;
  toughness?: string | null;
  layout?: string;
  card_faces?: ScryfallCardFace[] | null;
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
  commanders?: CardDefinition[];
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
  if (!commander.includes(' // ')) {
    return [commander];
  }

  const parts = commander.split(' // ').map(n => n.trim()).filter(Boolean);
  if (parts.length <= 1) return parts.length === 1 ? parts : [commander];

  const front = lookup(parts[0]);
  const otherFaces = parts.slice(1).map(name => lookup(name));
  if (front && otherFaces.some(card => !card)) {
    return [parts[0]];
  }

  const commanderEligibleFaces = parts.filter(name => {
    const card = lookup(name);
    if (!card) return false;
    const oracleText = (card.oracle_text || '').toLowerCase();
    return (
      typeLineHasSupertype(card.type_line, 'legendary')
      && (typeLineHasType(card.type_line, 'creature') || typeLineHasType(card.type_line, 'planeswalker'))
    ) || oracleText.includes('can be your commander');
  });
  if (commanderEligibleFaces.length === 1 && commanderEligibleFaces[0] === parts[0]) {
    return [parts[0]];
  }

  return parts;
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
  return parseCardTypesFromTypeLine(typeLine);
}

/**
 * Parse power/toughness string to number (handles '*' as 0).
 */
function parsePT(value: string | null | undefined): number | undefined {
  if (value == null) return undefined;
  const num = parseInt(value, 10);
  return isNaN(num) ? 0 : num;
}

function colorsFromManaCost(manaCost: string | null | undefined): ManaColor[] {
  if (!manaCost) return [];
  const colors = new Set<ManaColor>();
  for (const match of manaCost.matchAll(/\{([^}]+)\}/g)) {
    const symbol = match[1].toUpperCase();
    for (const color of ['W', 'U', 'B', 'R', 'G'] as ManaColor[]) {
      if (symbol.split('/').includes(color)) colors.add(color);
    }
  }
  return [...colors];
}

function manaValueFromManaCost(manaCost: string | null | undefined): number {
  if (!manaCost) return 0;
  let value = 0;
  for (const match of manaCost.matchAll(/\{([^}]+)\}/g)) {
    const symbol = match[1].toUpperCase();
    if (symbol === 'X') continue;
    if (/^\d+$/.test(symbol)) {
      value += parseInt(symbol, 10);
    } else {
      value += 1;
    }
  }
  return value;
}

function convertFace(card: ScryfallCard, face: ScryfallCardFace, faceIndex: number): CardDefinitionFace {
  const manaCost = face.mana_cost || '';
  return {
    id: `${card.id}:face:${faceIndex}`,
    name: face.name,
    type_line: face.type_line || card.type_line,
    oracle_text: face.oracle_text || '',
    mana_cost: manaCost,
    cmc: manaValueFromManaCost(manaCost),
    colors: toManaColors(face.colors || colorsFromManaCost(manaCost)),
    keywords: card.keywords || [],
    card_types: parseCardTypes(face.type_line || card.type_line),
    power: parsePT(face.power),
    toughness: parsePT(face.toughness),
  };
}

/**
 * Convert a Scryfall card to an engine CardDefinition.
 */
export function convertCard(card: ScryfallCard): CardDefinition {
  const firstFace = !card.oracle_text && card.card_faces?.[0] ? card.card_faces[0] : null;
  const cmc = typeof card.cmc === 'string' ? parseFloat(card.cmc) : card.cmc;
  const faces = card.card_faces?.map((face, index) => convertFace(card, face, index)) ?? [];

  const baseDef: CardDefinition = {
    id: card.id,
    name: card.name,
    type_line: firstFace?.type_line || card.type_line,
    oracle_text: firstFace?.oracle_text || card.oracle_text || '',
    mana_cost: firstFace?.mana_cost || card.mana_cost || '',
    cmc: Math.floor(cmc),
    colors: toManaColors(firstFace?.colors || card.colors || []),
    color_identity: toManaColors(card.color_identity || []),
    keywords: card.keywords || [],
    card_types: parseCardTypes(firstFace?.type_line || card.type_line),
    power: parsePT(firstFace?.power ?? card.power),
    toughness: parsePT(firstFace?.toughness ?? card.toughness),
    ...(faces.length > 0 ? { faces } : {}),
  };

  return populateParsedCache(baseDef);
}

function cardFromFace(card: ScryfallCard, face: ScryfallCardFace, faceIndex: number): ScryfallCard {
  const faceManaCost = face.mana_cost ?? '';
  return {
    ...card,
    id: `${card.id}:face:${faceIndex}`,
    name: face.name,
    type_line: face.type_line || card.type_line,
    oracle_text: face.oracle_text ?? '',
    mana_cost: faceManaCost,
    colors: face.colors ?? [],
    color_identity: card.color_identity ?? face.colors ?? [],
    keywords: card.keywords ?? [],
    power: face.power ?? null,
    toughness: face.toughness ?? null,
    card_faces: null,
  };
}

function lookupKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
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
  const commanderCards = commanderNames.map(name => {
    const card = lookup(name);
    if (!card) {
      throw new Error(`Commander not found: ${name}`);
    }
    return card;
  });

  // Pad short decks with basic lands (handles decks saved without lands)
  let deckList = [...deck.list];
  // For partners, the target library size is 100 - number_of_commanders
  const targetLibrarySize = 100 - commanderNames.length;
  if (deckList.length > targetLibrarySize) {
    deckList = deckList.slice(0, targetLibrarySize);
  }
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
  const commanders = commanderCards.map(convertCard);
  const commander = commanders[0];
  const library: CardDefinition[] = [];
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

  return { commander, commanders, library, sideboard: convertSideboard(deck.sideboard || [], lookup) };
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
  const byName = new Map<string, { card: ScryfallCard; score: number }>();
  const scoreCard = (card: ScryfallCard): number => {
    const typeLine = (card.type_line || '').toLowerCase();
    let score = 0;
    if (card.legalities?.commander === 'legal') score += 100;
    if (/(creature|instant|sorcery|artifact|enchantment|planeswalker|battle|land)/.test(typeLine)) score += 20;
    if (card.layout === 'art_series' || typeLine === 'card' || typeLine === 'card // card') score -= 100;
    if (card.oracle_text || card.mana_cost || card.power || card.toughness) score += 5;
    return score;
  };
  const addCard = (name: string | undefined, card: ScryfallCard) => {
    const key = name?.trim().toLowerCase();
    if (!key) return;
    const score = scoreCard(card);
    for (const candidateKey of [key, lookupKey(name || '')]) {
      if (!candidateKey) continue;
      const existing = byName.get(candidateKey);
      if (!existing || score > existing.score) {
        byName.set(candidateKey, { card, score });
      }
    }
  };

  for (const card of cards) {
    // Store by normalized full printed name.
    addCard(card.name, card);

    // Store individual card faces as playable/importable names. Scryfall stores
    // MDFCs/adventures as one top-level card, while decklists often use the
    // front-face name only (for example "Disciple of Freyalise").
    for (const [index, face] of (card.card_faces ?? []).entries()) {
      addCard(face.name, cardFromFace(card, face, index));
    }
  }

  return (name: string) => byName.get(name.trim().toLowerCase())?.card || byName.get(lookupKey(name))?.card;
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
