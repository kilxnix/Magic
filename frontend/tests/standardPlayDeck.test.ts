import { describe, expect, it } from 'vitest';
import { initGameFromDecks } from 'commander-engine';
import {
  buildDefaultStandardOpponentDeck,
  buildStandardMatchDeck,
} from '../src/lib/standardPlayDeck';
import { importDeckUrlLocally } from '../src/lib/deckUrlImport';
import { importStandardDeckLocally } from '../src/lib/standardDeckImport';
import type { ImportedCards } from '../src/hooks/useShelectorGame';

function toEngineDeck(deck: ImportedCards) {
  return {
    id: deck.commander.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    commander: deck.commander,
    list: [...deck.cards, ...deck.lands],
    sideboard: deck.sideboard || [],
    colors: Array.from(new Set(Object.values(deck.cardData || {}).flatMap(card => card.color_identity || []))),
    bracket: 3,
    theme: '',
  };
}

function cardLookupFrom(decks: ImportedCards[]) {
  const byName = new Map<string, NonNullable<ImportedCards['cardData']>[string]>();
  for (const deck of decks) {
    for (const [name, data] of Object.entries(deck.cardData || {})) {
      byName.set(name.toLowerCase(), data);
      byName.set(data.name.toLowerCase(), data);
    }
  }

  return (name: string) => {
    const data = byName.get(name.toLowerCase());
    if (!data) return undefined;
    return {
      id: `test-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: data.name,
      type_line: data.type_line,
      oracle_text: data.oracle_text,
      mana_cost: data.mana_cost,
      cmc: data.cmc,
      colors: data.colors,
      color_identity: data.color_identity,
      keywords: data.keywords,
      power: data.power ?? undefined,
      toughness: data.toughness ?? undefined,
    };
  };
}

describe('standard match deck builders', () => {
  it('turns the bundled MTGGoldfish Standard import into a playable offline deck', () => {
    const importedUrl = importDeckUrlLocally('https://www.mtggoldfish.com/archetype/standard-mono-green-landfall-woe#paper');
    expect(importedUrl?.format).toBe('standard');

    const parsed = importStandardDeckLocally(importedUrl!.deckText);
    expect(parsed.valid).toBe(true);

    const deck = buildStandardMatchDeck('You', parsed.mainDeck, parsed.sideboard);

    expect(deck.commander).toBe('You');
    expect(deck.cards.length + deck.lands.length).toBe(60);
    expect(deck.sideboard).toHaveLength(15);
    expect([...deck.cards, ...deck.lands]).toContain('Sazh\'s Chocobo');
    expect(deck.lands).toContain('Forest');
    for (const name of new Set([...deck.cards, ...deck.lands, ...deck.sideboard])) {
      expect(deck.cardData?.[name], name).toBeDefined();
    }
  });

  it('provides a bundled 60-card Standard opponent with local card data', () => {
    const opponent = buildDefaultStandardOpponentDeck();

    expect(opponent.commander).toBe('Standard Opponent');
    expect(opponent.cards.length + opponent.lands.length).toBe(60);
    expect(opponent.sideboard).toHaveLength(15);
    for (const name of new Set([...opponent.cards, ...opponent.lands, ...(opponent.sideboard || [])])) {
      expect(opponent.cardData?.[name], name).toBeDefined();
    }
  });

  it('keeps Snow-Covered basics as lands with local card data', () => {
    const deck = buildStandardMatchDeck('You', [
      ...Array.from({ length: 36 }, (_, index) => `Test Spell ${index}`),
      ...Array.from({ length: 24 }, () => 'Snow-Covered Island'),
    ]);

    expect(deck.lands).toHaveLength(24);
    expect(deck.lands.every(card => card === 'Snow-Covered Island')).toBe(true);
    expect(deck.cardData?.['Snow-Covered Island']?.type_line).toContain('Basic Snow Land');
  });

  it('initializes the game engine from the offline Standard match decks', () => {
    const importedUrl = importDeckUrlLocally('https://www.mtggoldfish.com/deck/7752458#paper');
    const parsed = importStandardDeckLocally(importedUrl!.deckText);
    const humanDeck = buildStandardMatchDeck('You', parsed.mainDeck, parsed.sideboard);
    const opponentDeck = buildDefaultStandardOpponentDeck();

    const state = initGameFromDecks({
      humanDeck: toEngineDeck(humanDeck),
      aiDecks: [toEngineDeck(opponentDeck)],
      aiDifficulty: 2,
      cardLookup: cardLookupFrom([humanDeck, opponentDeck]),
      format: 'limited',
      startingLife: 20,
      startingHandSize: 7,
    });

    expect(state.players).toHaveLength(2);
    expect(state.players[0].life).toBe(20);
    expect(state.players[1].life).toBe(20);
    expect([...state.cards.values()].filter(card => card.ownerId === 'human' && card.zone === 'hand')).toHaveLength(7);
  });
});
