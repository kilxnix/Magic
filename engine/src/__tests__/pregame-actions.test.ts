/**
 * Pre-game actions (CR 103.6): Leyline-style cards in the kept opening hand
 * begin the game on the battlefield, with their abilities registered and no
 * ETB triggers fired.
 */
import { describe, it, expect } from 'vitest';
import { initGameFromDecks, applyPregameActions } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import { getCardsInZone } from '../game-state';
import type { GeneratedDeck } from '../cards/deck-loader';

const LEYLINE_SENTENCE =
  'If this card is in your opening hand, you may begin the game with it on the battlefield.';

const cards = [
  {
    id: 'leyline-guildpact', name: 'Leyline of the Guildpact',
    type_line: 'Enchantment',
    oracle_text: `${LEYLINE_SENTENCE}\nEach creature you control is every color.\nLands you control are every basic land type in addition to their other types.`,
    mana_cost: '{2}{G/W}{G/U}', cmc: 4, colors: ['G'], color_identity: ['G', 'U', 'W'], keywords: [],
  },
  {
    id: 'leyline-sanctity', name: 'Leyline of Sanctity',
    type_line: 'Enchantment',
    oracle_text: `${LEYLINE_SENTENCE}\nYou have hexproof.`,
    mana_cost: '{2}{W}{W}', cmc: 4, colors: ['W'], color_identity: ['W'], keywords: [],
  },
  {
    id: 'etb-drake', name: 'ETB Drake',
    type_line: 'Creature — Drake',
    oracle_text: 'When this creature enters, draw a card.',
    mana_cost: '{2}{U}', cmc: 3, colors: ['U'], color_identity: ['U'], power: '2', toughness: '2', keywords: [],
  },
  {
    id: 'cmdr', name: 'Test Commander',
    type_line: 'Legendary Creature — Human Wizard',
    oracle_text: '', mana_cost: '{2}{W}{U}{G}', cmc: 5, colors: ['W', 'U', 'G'],
    color_identity: ['W', 'U', 'G'], power: '3', toughness: '3', keywords: [],
  },
  {
    id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest',
    oracle_text: '({T}: Add {G}.)', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [],
  },
];

const lookup = createCardLookup(cards as never);

function buildDeck(id: string, list: string[]): GeneratedDeck {
  return { id, commander: 'Test Commander', list, colors: ['G'], bracket: 2, theme: 't' } as GeneratedDeck;
}

function initWithSeed(seed: number) {
  // Front-load the Leylines + ETB creature so they land in the 7-card opening hand:
  // initGameFromDecks shuffles, so instead build with a deck of only those + lands
  // and scan whichever made it to hand.
  const humanList = [
    'Leyline of the Guildpact', 'Leyline of Sanctity', 'ETB Drake',
    ...Array(96).fill('Forest'),
  ];
  return initGameFromDecks({
    humanDeck: buildDeck('h', humanList),
    aiDecks: [buildDeck('a', Array(99).fill('Forest'))],
    aiDifficulty: 3,
    cardLookup: lookup,
    seed,
  });
}

describe('applyPregameActions', () => {
  it('puts Leylines from the opening hand onto the battlefield and leaves other cards in hand', () => {
    // Find a seed where at least one Leyline is in the human opening hand.
    for (let seed = 1; seed < 60; seed++) {
      const state = initWithSeed(seed);
      const humanId = state.players[0].id;
      const handBefore = getCardsInZone(state, humanId, 'hand');
      const leylinesInHand = handBefore.filter(c =>
        c.definitionId === 'leyline-guildpact' || c.definitionId === 'leyline-sanctity');
      if (leylinesInHand.length === 0) continue;

      const nonLeylineHandCount = handBefore.length - leylinesInHand.length;
      const result = applyPregameActions(state, humanId);

      const battlefield = getCardsInZone(result.state, humanId, 'battlefield');
      const handAfter = getCardsInZone(result.state, humanId, 'hand');

      expect(result.placedCardNames.length).toBe(leylinesInHand.length);
      expect(battlefield.length).toBe(leylinesInHand.length);
      for (const placed of battlefield) {
        expect(['leyline-guildpact', 'leyline-sanctity']).toContain(placed.definitionId);
        expect(placed.tapped).toBe(false);
      }
      expect(handAfter.length).toBe(nonLeylineHandCount);
      return; // verified on this seed
    }
    throw new Error('No seed in range put a Leyline into the opening hand');
  });

  it('does not move cards without the begin-the-game sentence and fires no ETB draws', () => {
    for (let seed = 1; seed < 60; seed++) {
      const state = initWithSeed(seed);
      const humanId = state.players[0].id;
      const handBefore = getCardsInZone(state, humanId, 'hand');
      const drake = handBefore.find(c => c.definitionId === 'etb-drake');
      if (!drake) continue;

      const libBefore = getCardsInZone(state, humanId, 'library').length;
      const result = applyPregameActions(state, humanId);

      // Drake stays in hand
      const handAfter = getCardsInZone(result.state, humanId, 'hand');
      expect(handAfter.some(c => c.definitionId === 'etb-drake')).toBe(true);
      // No ETB triggers ran: library unchanged, stack empty
      expect(getCardsInZone(result.state, humanId, 'library').length).toBe(libBefore);
      expect(result.state.stack.length).toBe(0);
      return;
    }
    throw new Error('No seed in range put the ETB Drake into the opening hand');
  });

  it('is a no-op for hands without pre-game cards', () => {
    const state = initWithSeed(7);
    const aiId = state.players[1].id; // AI deck is all Forests
    const result = applyPregameActions(state, aiId);
    expect(result.placedCardNames).toEqual([]);
    expect(getCardsInZone(result.state, aiId, 'battlefield').length).toBe(0);
  });
});
