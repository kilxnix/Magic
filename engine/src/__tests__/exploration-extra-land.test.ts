import { describe, it, expect } from 'vitest';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import { canPlayLand, playLand, maxLandsThisTurn } from '../actions';
import type { ScryfallCard } from '../cards/deck-loader';

describe('Exploration-style "additional land per turn"', () => {
  function setup(extraCardOracleText: string | null) {
    resetInstanceCounter();
    const cards: ScryfallCard[] = [
      { id: 'cmd', name: 'Cmd', type_line: 'Legendary Creature — Goblin', oracle_text: '', mana_cost: '{4}{R}', cmc: 5, colors: ['R'], color_identity: ['R'], keywords: [], power: '3', toughness: '3' },
    ];
    if (extraCardOracleText) {
      cards.push({
        id: 'extra',
        name: 'Extra',
        type_line: 'Enchantment',
        oracle_text: extraCardOracleText,
        mana_cost: '{G}',
        cmc: 1,
        colors: ['G'],
        color_identity: ['G'],
        keywords: [],
      });
    }
    for (let i = 0; i < 99; i++) {
      cards.push({ id: `hf${i}`, name: `HF${i}`, type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [] });
      cards.push({ id: `af${i}`, name: `AF${i}`, type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [] });
    }

    const lookup = createCardLookup(cards);
    const humanList = extraCardOracleText
      ? ['Extra', ...Array.from({ length: 98 }, (_, i) => `HF${i}`)]
      : Array.from({ length: 99 }, (_, i) => `HF${i}`);
    return initGameFromDecks({
      humanDeck: { id: 'h', commander: 'Cmd', list: humanList, colors: ['G'], bracket: 3, theme: '' },
      aiDecks: [{ id: 'a', commander: 'Cmd', list: Array.from({ length: 99 }, (_, i) => `AF${i}`), colors: ['G'], bracket: 3, theme: '' }],
      aiDifficulty: 3, cardLookup: lookup, humanGoesFirst: true, startingLife: 40, startingHandSize: 7,
    });
  }

  it('without Exploration, the player gets 1 land drop per turn', () => {
    let s = setup(null);
    s = { ...s, phase: 'precombat_main' as const, step: 'main' as const };
    expect(maxLandsThisTurn(s, 'human')).toBe(1);
  });

  it('Exploration on the battlefield grants a second land drop per turn', () => {
    let s = setup('You may play an additional land on each of your turns.');
    // Force the Exploration onto the battlefield
    const exp = [...s.cards.values()].find(c => s.cardDefinitions.get(c.definitionId)?.name === 'Extra');
    expect(exp).toBeDefined();
    const newCards = new Map(s.cards);
    newCards.set(exp!.instanceId, { ...exp!, zone: 'battlefield' });
    s = { ...s, cards: newCards, phase: 'precombat_main' as const, step: 'main' as const };
    expect(maxLandsThisTurn(s, 'human')).toBe(2);

    // Find two lands in hand and play both
    const handLands = [...s.cards.values()].filter(c => c.zone === 'hand' && s.cardDefinitions.get(c.definitionId)?.type_line.includes('Land'));
    expect(handLands.length).toBeGreaterThanOrEqual(2);

    expect(canPlayLand(s, 'human', handLands[0].instanceId)).toBe(true);
    s = playLand(s, 'human', handLands[0].instanceId);
    expect(canPlayLand(s, 'human', handLands[1].instanceId)).toBe(true);
    s = playLand(s, 'human', handLands[1].instanceId);

    // After 2 lands, the third should be denied
    if (handLands[2]) {
      expect(canPlayLand(s, 'human', handLands[2].instanceId)).toBe(false);
    }
  });

  it('Azusa-style "two additional lands" grants 3 land drops total', () => {
    let s = setup('You may play two additional lands on each of your turns.');
    const exp = [...s.cards.values()].find(c => s.cardDefinitions.get(c.definitionId)?.name === 'Extra');
    const newCards = new Map(s.cards);
    newCards.set(exp!.instanceId, { ...exp!, zone: 'battlefield' });
    s = { ...s, cards: newCards, phase: 'precombat_main' as const, step: 'main' as const };
    expect(maxLandsThisTurn(s, 'human')).toBe(3);
  });
});
