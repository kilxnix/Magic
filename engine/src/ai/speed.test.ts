import { describe, expect, it } from 'vitest';
import { initGameFromDecks, resetInstanceCounter } from '../game-init';
import { createCardLookup, type ScryfallCard } from '../cards/deck-loader';
import { makeDecision, createAIConfig } from './agent';

function creature(name: string): ScryfallCard {
  return {
    id: name,
    name,
    type_line: 'Creature - Elemental',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: '2',
    toughness: '2',
  };
}

function forest(name: string): ScryfallCard {
  return {
    id: name,
    name,
    type_line: 'Basic Land - Forest',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
  };
}

function commander(): ScryfallCard {
  return {
    id: 'speed-commander',
    name: 'Speed Commander',
    type_line: 'Legendary Creature - Elemental',
    oracle_text: '',
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: '3',
    toughness: '3',
  };
}

describe('Shelector fast move budget', () => {
  it('can choose many legal moves within the interaction budget', () => {
    resetInstanceCounter();

    const allCards: ScryfallCard[] = [commander()];
    const humanList: string[] = [];
    const aiList: string[] = [];

    for (let i = 0; i < 45; i += 1) {
      const humanLand = `Human Forest ${i}`;
      const aiLand = `AI Forest ${i}`;
      allCards.push(forest(humanLand), forest(aiLand));
      humanList.push(humanLand);
      aiList.push(aiLand);
    }
    for (let i = 0; i < 54; i += 1) {
      const humanCreature = `Human Bear ${i}`;
      const aiCreature = `AI Bear ${i}`;
      allCards.push(creature(humanCreature), creature(aiCreature));
      humanList.push(humanCreature);
      aiList.push(aiCreature);
    }

    const lookup = createCardLookup(allCards);
    const state = initGameFromDecks({
      humanDeck: { id: 'human', commander: 'Speed Commander', list: humanList, colors: ['G'], bracket: 3, theme: '' },
      aiDecks: [{ id: 'ai', commander: 'Speed Commander', list: aiList, colors: ['G'], bracket: 3, theme: '' }],
      aiDifficulty: 5,
      cardLookup: lookup,
      humanGoesFirst: true,
      startingLife: 40,
      startingHandSize: 7,
    });

    state.activePlayerIndex = 1;
    state.priorityPlayerIndex = 1;
    state.phase = 'precombat_main';
    state.step = 'main';
    state.hasPriorityPassed = [false, false];
    state.players[0].hasPriority = false;
    state.players[1].hasPriority = true;

    const config = createAIConfig('ai1', 5);
    const started = performance.now();
    let decisions = 0;

    for (let i = 0; i < 100; i += 1) {
      const decision = makeDecision(state, config);
      if (decision) decisions += 1;
    }

    const elapsed = performance.now() - started;
    expect(decisions).toBe(100);
    expect(elapsed).toBeLessThan(1500);
  });
});
