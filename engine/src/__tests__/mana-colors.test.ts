import { describe, it, expect } from 'vitest';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { createCardLookup } from '../cards/deck-loader';
import type { ScryfallCard } from '../cards/deck-loader';

function card(name: string, typeLine: string, oracle: string, colors: string[] = []): ScryfallCard {
  return { id: name, name, type_line: typeLine, oracle_text: oracle, mana_cost: '', cmc: 0, colors: [], color_identity: colors, keywords: [] };
}

describe('manaProduction cache', () => {
  it('Blood Crypt produces B and R', () => {
    resetInstanceCounter();
    const cards = [
      { ...card('Cmd', 'Legendary Creature', '', ['B','R']), mana_cost: '{B}{R}', cmc: 2, power: '2', toughness: '2' },
      card('Blood Crypt', 'Land — Swamp Mountain', '{T}: Add {B} or {R}.', ['B','R']),
      ...Array.from({length: 98}, (_, i) => card(`Swamp${i}`, 'Basic Land — Swamp', '{T}: Add {B}.', ['B'])),
    ];
    const lookup = createCardLookup(cards);
    const state = initGameFromDecks({
      humanDeck: { id: 'h', commander: 'Cmd', list: ['Blood Crypt', ...Array.from({length: 98}, (_, i) => `Swamp${i}`)], colors: ['B','R'], bracket: 3, theme: '' },
      aiDecks: [{ id: 'a', commander: 'Cmd', list: Array.from({length: 99}, (_, i) => `Swamp${i}`), colors: ['B','R'], bracket: 3, theme: '' }],
      aiDifficulty: 3, cardLookup: lookup,
    });

    // Find Blood Crypt in the deck
    let bcColors: string[] = [];
    state.cards.forEach((inst) => {
      const def = state.cardDefinitions.get(inst.definitionId);
      if (def?.name === 'Blood Crypt' && def.manaProduction) {
        bcColors = def.manaProduction.colors;
      }
    });

    console.log('Blood Crypt colors:', bcColors);
    expect(bcColors).toContain('B');
    expect(bcColors).toContain('R');
    expect(bcColors.length).toBe(2);
  });

  it('Command Tower produces all colors in identity', () => {
    resetInstanceCounter();
    const cards = [
      { ...card('Cmd', 'Legendary Creature', '', ['U','B','R']), mana_cost: '{U}{B}{R}', cmc: 3, power: '3', toughness: '3' },
      card('Command Tower', 'Land', '{T}: Add one mana of any color in your commander\'s color identity.', []),
      ...Array.from({length: 98}, (_, i) => card(`Island${i}`, 'Basic Land — Island', '{T}: Add {U}.', ['U'])),
    ];
    const lookup = createCardLookup(cards);
    const state = initGameFromDecks({
      humanDeck: { id: 'h', commander: 'Cmd', list: ['Command Tower', ...Array.from({length: 98}, (_, i) => `Island${i}`)], colors: ['U','B','R'], bracket: 3, theme: '' },
      aiDecks: [{ id: 'a', commander: 'Cmd', list: Array.from({length: 99}, (_, i) => `Island${i}`), colors: ['U','B','R'], bracket: 3, theme: '' }],
      aiDifficulty: 3, cardLookup: lookup,
    });

    let ctColors: string[] = [];
    state.cards.forEach((inst) => {
      const def = state.cardDefinitions.get(inst.definitionId);
      if (def?.name === 'Command Tower' && def.manaProduction) {
        ctColors = def.manaProduction.colors;
      }
    });

    console.log('Command Tower colors:', ctColors);
    expect(ctColors.length).toBeGreaterThanOrEqual(3);
  });
});
